# Optimia (Next.js + Aurora DSQL)

Migración de la app Apps Script a una aplicación Next.js 16 (App Router) con backend propio y **Aurora DSQL como único motor**. Local y Amplify usan las mismas variables de entorno y los mismos roles DB. No hay SQLite en runtime.

## Requisitos previos

- Node.js >= 22.5 (recomendado 24) y npm.
- Un cluster Aurora DSQL ya creado.
- AWS CLI con SSO, perfil o STS para firmar tokens DSQL.
- Una identidad AWS con `dsql:DbConnectAdmin` para el aprovisionamiento inicial.
- Los roles IAM que se mapearán a los roles DB `optimia_crud` y `optimia_read`.

## Configuración local (paso a paso)

1. Instala dependencias:

   ```bash
   npm install
   ```

2. Crea el archivo de entorno:

   ```bash
   cp .env.example .env.local
   ```

3. Completa `.env.local`.

   Obligatorias:

   | Variable | Uso |
   | --- | --- |
   | `AURORA_DSQL_HOST` | Endpoint del cluster, sin `https://`. |
   | `AURORA_DSQL_REGION` | Región AWS del cluster. |
   | `AURORA_DSQL_CRUD_USER` | Rol DB de lectura/escritura. |
   | `AURORA_DSQL_READ_USER` | Rol DB de solo lectura. |
   | `GOOGLE_CLIENT_ID` | Cliente OAuth 2.0 de Google. |
   | `GOOGLE_CLIENT_SECRET` | Secreto OAuth 2.0 de Google. |
   | `GOOGLE_REDIRECT_URI` | Callback autorizado en Google. |

   Opcionales:

   | Variable | Uso |
   | --- | --- |
   | `AURORA_DSQL_DATABASE` | Base DSQL. Por defecto `postgres`. |
   | `AURORA_DSQL_PORT` | Puerto DSQL. Por defecto `5432`. |
   | `AURORA_DSQL_POOL_MAX` | Tamaño del pool. Por defecto `8`. |
   | `AURORA_DSQL_TOKEN_EXPIRES_IN` | Vigencia del token IAM. |
   | `AURORA_DSQL_TOKEN_TTL` | Renovación del token IAM. |
   | `AURORA_DSQL_READ_IAM_ROLE_ARN` | ARN IAM del rol de solo lectura. Requerida por `db:init:aurora`. |
   | `AURORA_DSQL_CRUD_IAM_ROLE_ARN` | ARN IAM del rol de lectura/escritura. Requerida por `db:init:aurora`. |
   | `AWS_BEARER_TOKEN_BEDROCK` | Token para el chat Morgan. |

   Los marcadores de `.env.example` cuentan como variables faltantes. Ninguna variable debe usar el prefijo `NEXT_PUBLIC_`.

4. Autentica AWS con el mismo rol IAM que se usará en Amplify:

   ```bash
   aws sso login --profile <perfil>
   ```

   No pongas credenciales AWS estáticas en `.env.local`; la app usa la cadena estándar de AWS y tokens IAM de corta vida firmados con `@aws-sdk/dsql-signer`.

5. Aprovisiona Aurora una sola vez, con la identidad que tenga `dsql:DbConnectAdmin`:

   ```bash
   npm run db:init:aurora
   ```

   Este paso aplica `db/aurora-schema.sql`, crea/mapea los roles DB y otorga los permisos correspondientes.

6. Valida el entorno:

   ```bash
   npm run env:check
   ```

   Muestra solo nombre y estado (`[OK]`, `[FALTA]` u `[OPCIONAL]`); nunca imprime valores.

7. Verifica la conexión con el rol de lectura/escritura:

   ```bash
   npm run db:init
   ```

8. Arranca la app:

   ```bash
   npm run dev
   ```

## Configuración en producción (AWS Amplify)

1. En **Amplify → App settings → Environment variables**, configura por rama las mismas variables que en local:

   ```text
   AURORA_DSQL_HOST=xxx.dsql.us-east-1.on.aws
   AURORA_DSQL_REGION=us-east-1
   AURORA_DSQL_CRUD_USER=optimia_crud
   AURORA_DSQL_READ_USER=optimia_read
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   GOOGLE_REDIRECT_URI=https://<dominio>/api/auth/google/callback

   AURORA_DSQL_DATABASE=postgres
   AURORA_DSQL_PORT=5432
   AURORA_DSQL_POOL_MAX=8
   AURORA_DSQL_TOKEN_EXPIRES_IN=900
   AURORA_DSQL_TOKEN_TTL=780
   AWS_BEARER_TOKEN_BEDROCK=...
   ```

2. Asigna a la app un **Compute role** de Amplify con permisos DSQL y mapéalo en la base a `optimia_crud` y `optimia_read`. Debe ser el mismo rol IAM usado en local.

3. En Google Cloud, registra exactamente la URI definida en `GOOGLE_REDIRECT_URI` como callback autorizado.

4. Aprovisiona Aurora una vez fuera del pipeline, con la identidad `dsql:DbConnectAdmin` y los ARNs de los roles IAM. No incluyas `db:init:aurora` en el build de Amplify.

5. Despliega. `amplify.yml` instala Node 22, ejecuta `npm ci`, copia las variables a `.env.production`, ejecuta `npm run env:check` y compila con `npm run build`.

## GitHub Actions

- El workflow toma `AURORA_DSQL_HOST`, `AURORA_DSQL_REGION`, `AURORA_DSQL_CRUD_USER`, `AURORA_DSQL_READ_USER`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` y `AWS_BEARER_TOKEN_BEDROCK` de GitHub Actions Secrets.
- Ejecuta `npm ci`, `npm run env:check`, `npm run lint` y `npm run build`.
- No se conecta a Aurora durante CI.
- En pull requests desde forks se omite `env:check` porque GitHub no entrega secrets.

## Migraciones de esquema

- `db/aurora-schema.sql` sigue siendo el esquema gobernado y la base para una instalación nueva.
- Los cambios posteriores se entregan como archivos numerados en `db/migrations/`, por ejemplo `db/migrations/0002_nueva_columna.sql`. Cada cambio de `db/aurora-schema.sql` debe venir acompañado de una migración nueva.
- La tabla `schema_migrations` registra versión, archivo, checksum y fecha de aplicación. La tabla `schema_state` guarda el checksum del esquema gobernado.
- Un archivo ya aplicado no debe modificarse: el runner falla por diferencia de checksum. Para corregirlo, crea una nueva migración.
- Un cambio en `db/aurora-schema.sql` sin migración nueva también falla.
- Los índices `CREATE INDEX ASYNC` se esperan antes de continuar. Los errores temporales de concurrencia `40001/OC001` se reintentan automáticamente.
- Cada sentencia se ejecuta por separado porque Aurora DSQL no permite varias DDL ni mezclar DDL con DML en una misma transacción.

### Workflow `Aurora DB schema`

- Se dispara con push a `develop` o `main` cuando cambian `db/**`, los scripts de migración o las dependencias. También puede ejecutarse manualmente con `workflow_dispatch`.
- Usa un solo cluster, sin separación por entornos.
- Secrets requeridos: `AURORA_DSQL_HOST`, `AURORA_DSQL_REGION`, `AURORA_DSQL_CRUD_USER`, `AURORA_DSQL_READ_USER` y `AWS_ROLE_TO_ASSUME`.
- Secrets opcionales: `AURORA_DSQL_DATABASE`, `AURORA_DSQL_PORT`, `AURORA_DSQL_TOKEN_EXPIRES_IN` y `AURORA_DSQL_TOKEN_TTL`.
- `AWS_ROLE_TO_ASSUME` debe ser un rol IAM asumible por OIDC con permiso `dsql:DbConnectAdmin`. No se usan claves AWS estáticas.
- El workflow aplica migraciones, reaplica grants y verifica la conexión con el rol de lectura/escritura. No se ejecuta en el build de Amplify.
- Las migraciones destructivas están bloqueadas. Para permitirlas, la migración debe incluir `-- @destructive` y el workflow debe ejecutarse manualmente con `allow_destructive=true`.

## Comandos

| Comando | Descripción |
| --- | --- |
| `npm run dev` | Servidor de desarrollo. |
| `npm run build` / `npm start` | Build y servidor de producción. |
| `npm run lint` | ESLint. |
| `npm run env:check` | Valida variables obligatorias mostrando solo nombres y estado. |
| `npm run db:init` | Verifica la conexión Aurora con el rol de lectura/escritura. |
| `npm run db:init:aurora` | Aplica `db/aurora-schema.sql`, registra el baseline, crea/mapea roles DB y otorga permisos. |
| `npm run db:migrate` | Aplica las migraciones pendientes y actualiza el estado del esquema. |
| `npm run db:migrate:status` | Muestra migraciones aplicadas, pendientes y estado del esquema. |
| `npm run db:grant` | Reaplica permisos de los roles DB sobre todas las tablas. |
| `npm run ui:sync` | Regenera `src/generated/*` desde `legacy/*.html`. |

## Estructura

- `legacy/Home.html`, `legacy/Index.html`, `legacy/Config.html`: fuente visual de las tres pantallas.
- `src/generated/*.css|markup.js|client.js`: copias generadas. No editar a mano; editar `legacy/`.
- `src/app/(app)/`: rutas protegidas `/`, `/abiertos` y `/config`.
- `src/app/login/`: login con usuario/contraseña y Google.
- `src/app/api/auth/*`: login/logout y OAuth de Google.
- `src/app/api/rpc/`: endpoint que despacha a `src/lib/rpc.js`.
- `src/components/rpcShim.js`: compatibilidad con `google.script.run...`.
- `src/lib/`: capa DSQL, auth, entradas, permisos, chat Bedrock y helpers.
- `db/aurora-schema.sql`: esquema gobernado de Aurora DSQL.
- `db/migrations/*.sql`: migraciones versionadas posteriores al baseline.
- `scripts/init-aurora.mjs`: aprovisionamiento inicial del esquema y los roles.
- `scripts/migrate-aurora.mjs`: runner de migraciones.
- `scripts/grant-aurora.mjs`: reaplicación de permisos.
- `scripts/lib/aurora.mjs`: utilidades compartidas de SQL, checksum, reintentos e índices.

## Base de datos

Zona horaria de la app: `America/Bogota`. `getDb()` y `getReadOnlyDb()` son async y exponen `get/all/run/exec` sobre `PgAdapter`; los parámetros `?` y `:nombre` se convierten a `$1`, `$2`, etc.

- `optimia_crud`: permisos de lectura/escritura en todas las tablas. Lo usa toda la app.
- `optimia_read`: permisos de solo lectura sobre `projects`, `categories`, `assignments` y `entries`. Lo usa Morgan para ejecutar el SQL validado.
- `schema_migrations` y `schema_state` son tablas internas del runner. No se otorgan al rol de solo lectura.
- Los tokens IAM se cachean por menos de su vigencia y se renuevan automáticamente en cada conexión nueva.

### Columnas por tabla

| Tabla | Columna | Tipo |
| --- | --- | --- |
| `users` | `id` | `BIGINT` |
| `users` | `username` | `TEXT` |
| `users` | `email` | `TEXT` |
| `users` | `nombre` | `TEXT` |
| `users` | `password_hash` | `TEXT` |
| `users` | `role` | `TEXT` |
| `users` | `activo` | `INTEGER` |
| `users` | `created_at` | `TIMESTAMPTZ` |
| `sessions` | `token_hash` | `TEXT` |
| `sessions` | `user_id` | `BIGINT` |
| `sessions` | `created_at` | `TIMESTAMPTZ` |
| `sessions` | `expires_at` | `TEXT` |
| `projects` | `id` | `TEXT` |
| `projects` | `nombre` | `TEXT` |
| `projects` | `lider_email` | `TEXT` |
| `projects` | `created_at` | `TIMESTAMPTZ` |
| `categories` | `id` | `TEXT` |
| `categories` | `nombre` | `TEXT` |
| `categories` | `creado_por` | `TEXT` |
| `categories` | `fecha` | `TEXT` |
| `categories` | `created_at` | `TIMESTAMPTZ` |
| `assignments` | `proyecto_id` | `TEXT` |
| `assignments` | `email` | `TEXT` |
| `assignments` | `rol` | `TEXT` |
| `entries` | `id` | `TEXT` |
| `entries` | `owner_email` | `TEXT` |
| `entries` | `project_id` | `TEXT` |
| `entries` | `tipo` | `TEXT` |
| `entries` | `parent_id` | `TEXT` |
| `entries` | `descripcion` | `TEXT` |
| `entries` | `fecha_inicio` | `TEXT` |
| `entries` | `fecha_fin` | `TEXT` |
| `entries` | `estado` | `TEXT` |
| `entries` | `alerta` | `TEXT` |
| `entries` | `bloqueante` | `TEXT` |
| `entries` | `categoria` | `TEXT` |
| `entries` | `nota` | `TEXT` |
| `entries` | `jira` | `TEXT` |
| `entries` | `msd` | `TEXT` |
| `entries` | `esp_tecnica` | `TEXT` |
| `entries` | `esp_funcional` | `TEXT` |
| `entries` | `evidencia` | `TEXT` |
| `entries` | `sin_entregable` | `INTEGER` |
| `entries` | `observaciones` | `TEXT` |
| `entries` | `entregable` | `TEXT` |
| `entries` | `interno` | `INTEGER` |
| `entries` | `descripcion_tarea` | `TEXT` |
| `entries` | `created_at` | `TIMESTAMPTZ` |
| `entries` | `updated_at` | `TIMESTAMPTZ` |
| `audit` | `id` | `BIGINT` |
| `audit` | `timestamp` | `TEXT` |
| `audit` | `usuario` | `TEXT` |
| `audit` | `accion` | `TEXT` |
| `audit` | `tipo` | `TEXT` |
| `audit` | `id_registro` | `TEXT` |
| `audit` | `detalle` | `TEXT` |
| `schema_migrations` | `version` | `TEXT` |
| `schema_migrations` | `filename` | `TEXT` |
| `schema_migrations` | `checksum` | `TEXT` |
| `schema_migrations` | `applied_at` | `TIMESTAMPTZ` |
| `schema_migrations` | `applied_by` | `TEXT` |
| `schema_state` | `id` | `TEXT` |
| `schema_state` | `schema_checksum` | `TEXT` |
| `schema_state` | `updated_at` | `TIMESTAMPTZ` |

### Claves e índices

| Tabla | PK | FK | Índices |
| --- | --- | --- | --- |
| `users` | `id` | — | `UNIQUE ASYNC (lower(username))`, `UNIQUE ASYNC (lower(email))` |
| `sessions` | `token_hash` | `user_id → users.id` | — |
| `projects` | `id` | — | — |
| `categories` | `id` | — | — |
| `assignments` | `(proyecto_id, email)` | `proyecto_id → projects.id` | `INDEX ASYNC (email)` |
| `entries` | `id` | — | `INDEX ASYNC (owner_email, project_id)`, `INDEX ASYNC (parent_id)`, `INDEX ASYNC (project_id)` |
| `audit` | `id` | — | — |
| `schema_migrations` | `version` | — | — |
| `schema_state` | `id` | — | — |

Los defaults, `NOT NULL`, `CHECK`, el resto de relaciones y la definición completa de los índices de las tablas de aplicación están en `db/aurora-schema.sql`, que es la fuente gobernada de la estructura. Las tablas internas del runner se definen en `scripts/lib/aurora.mjs`.
