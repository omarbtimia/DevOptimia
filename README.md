# Optimia (Next.js + SQLite / Aurora DSQL)

Migración de la app Apps Script a una aplicación Next.js 16 (App Router) con backend propio. Localmente usa SQLite; en producción puede usar Aurora DSQL con dos roles: `optimia_crud` para la app y `optimia_read` solo para el SQL de Morgan. El comportamiento y la interfaz de **proyectos abiertos, configuración y chat de líderes de proyecto** se conservan; **proyectos cerrados fueron eliminados** por completo.

## Requisitos y arranque

- Node.js >= 22.5 (recomendado 24) y npm.
- No se necesita Google Sheets ni `clasp`.

```bash
npm install
npm run db:init      # crea ./data/optimia.sqlite y siembra el usuario admin
npm run dev          # http://localhost:3000
```

La base se crea sola en el primer arranque si no existe. `npm run db:init` es explícito y seguro. Las bases anteriores se migran solas: el antiguo perfil `Líder` pasa a `Administrador`, `Colaborador` pasa a `Usuario`, y cada asignación recibe su propio rol.

### Acceso inicial

| Usuario | Contraseña | Perfil |
| --- | --- | --- |
| `admin` | `admin` | `Administrador` |

Cámbiala en **Configuración → Usuarios → Editar admin → Contraseña**. El login acepta el `username` o el `email`. Los usuarios nuevos se crean en Configuración con nombre, email, contraseña inicial y perfil (`Administrador` o `Usuario`). El perfil `Administrador` da acceso a **Configuración**; en la vista abierta los permisos de edición global y chat dependen del rol de la asignación en ese proyecto.

### Variables de entorno

Copia `.env.example` a `.env.local`:

| Variable | Uso |
| --- | --- |
| `DB_DRIVER` | `sqlite` (local, por defecto) o `aurora`/`dsql`. Si está vacío, Aurora se activa automáticamente cuando existe `AURORA_DSQL_HOST`. |
| `SQLITE_PATH` | Nombre del archivo dentro de `./data` (por defecto `optimia.sqlite`). |
| `AURORA_DSQL_HOST` | Endpoint del cluster DSQL, sin `https://`. Ejemplo: `xxx.dsql.us-east-1.on.aws`. |
| `AURORA_DSQL_REGION` | Región AWS del cluster. Se infiere del host si falta. |
| `AURORA_DSQL_DATABASE` / `AURORA_DSQL_PORT` | Base y puerto (por defecto `postgres` / `5432`). |
| `AURORA_DSQL_CRUD_USER` / `AURORA_DSQL_READ_USER` | Roles DB usados por la app y por Morgan (por defecto `optimia_crud` / `optimia_read`). |
| `AURORA_DSQL_TOKEN_EXPIRES_IN` / `AURORA_DSQL_TOKEN_TTL` | Vigencia y renovación del token IAM en segundos (900 / 780 por defecto). |
| `AURORA_DSQL_READ_IAM_ROLE_ARN` / `AURORA_DSQL_CRUD_IAM_ROLE_ARN` | ARNs IAM mapeados por `npm run db:init:aurora`. No son necesarios para arrancar la app. |
| `AWS_BEARER_TOKEN_BEDROCK` | Token bearer para el chat "Morgan" (solo para quien esté asignado como `Líder` en el proyecto activo). Sin él, el chat devuelve un error controlado. |

Las credenciales AWS se toman de la cadena estándar (variables de entorno, perfil local o rol IAM). Nunca se guardan passwords de base de datos: DSQL usa tokens IAM de corta vida firmados con `@aws-sdk/dsql-signer`.

### Despliegue en AWS Amplify

El archivo `amplify.yml` copia durante el build las variables privadas de servidor a `.env.production`, como requiere el hosting SSR de Next.js. Configura en **Amplify → App settings → Environment variables**, por cada rama:

```text
DB_DRIVER=aurora
AURORA_DSQL_HOST=xxx.dsql.us-east-1.on.aws
AURORA_DSQL_REGION=us-east-1
AURORA_DSQL_CRUD_USER=optimia_crud
AURORA_DSQL_READ_USER=optimia_read
AWS_BEARER_TOKEN_BEDROCK=...
```

Asigna además un **Compute role** a la aplicación Amplify con permisos de conexión a Aurora DSQL. La app utiliza ese rol para generar tokens IAM temporales; no necesita una contraseña de base de datos. Ninguna de estas variables debe usar el prefijo `NEXT_PUBLIC_`, porque ese prefijo expone el valor al navegador.

Los secretos de GitHub Actions son independientes. `AWS_ROLE_TO_ASSUME` y los valores utilizados por `npm run db:init:aurora` se configuran en **GitHub → Settings → Secrets and variables → Actions**. El workflow usa OIDC para asumir el rol y omite la inicialización de Aurora cuando esos secretos no están disponibles, como sucede en pull requests desde forks.

## Comandos

| Comando | Descripción |
| --- | --- |
| `npm run dev` | Servidor de desarrollo. |
| `npm run build` / `npm start` | Build y servidor de producción. |
| `npm run lint` | ESLint. |
| `npm run db:init` | Crea/verifica esquema SQLite o comprueba la conexión Aurora con el rol CRUD. |
| `npm run db:init:aurora` | Aplica `db/aurora-schema.sql`, siembra admin, crea/mapear roles y otorga permisos en Aurora DSQL (requiere identidad con `dsql:DbConnectAdmin`). |
| `npm run ui:sync` | Regenera `src/generated/*` desde `legacy/*.html`. |

## Estructura

- `legacy/Home.html`, `legacy/Index.html`, `legacy/Config.html`: **fuente visual** de las tres pantallas (idénticas a las originales salvo navegación, quita de cerrados y campo de contraseña).
- `src/generated/*.css|markup.js|client.js`: copias generadas que consume Next. **No editar a mano**; editar `legacy/` y correr `npm run ui:sync`.
- `src/app/(app)/`: rutas protegidas `/` (Home), `/abiertos` (Index), `/config` (solo `Administrador`).
- `src/app/login/`: login con usuario/contraseña.
- `src/app/api/auth/*`: login/logout (cookie `optimia_session`, httpOnly, 12 h).
- `src/app/api/rpc/`: único endpoint backend. Recibe `{ method, params }` y despacha a `src/lib/rpc.js`, manteniendo los nombres de las funciones de Apps Script (`getAppData`, `cfgGetAll`, `fetchEntries`, `saveOrUpdateEntry`, …).
- `src/components/rpcShim.js`: compatibilidad con `google.script.run.withSuccessHandler(...).withFailureHandler(...).metodo(...)` para que el JS legado funcione sin cambios.
- `src/lib/`: capa DB dual (`db.js`, `dbAdapter.js`, `dsql.js`), auth, entradas, permisos, chat Bedrock y helpers.
- `db/aurora-schema.sql`: DDL de Aurora DSQL; `scripts/init-aurora.mjs` lo aplica y crea los roles.

## Base de datos

Archivo local: `data/optimia.sqlite` (ignorado por git). Zona horaria de la app: `America/Bogota`.

### Modos de ejecución

- **Local por defecto:** sin `AURORA_DSQL_HOST` (o con `DB_DRIVER=sqlite`), toda la app usa SQLite. No se requiere AWS.
- **Producción con Aurora:** con `DB_DRIVER=aurora` y las variables DSQL, la app usa el rol `optimia_crud` para todas las operaciones y `optimia_read` únicamente para ejecutar el SQL generado por Morgan. El esquema y los roles se crean en CI con `npm run db:init:aurora`.
- `optimia_read` solo tiene `SELECT` sobre `projects`, `categories`, `assignments` y `entries`; no puede leer `users`, `sessions`, `audit` ni ejecutar DDL/DML.
- `optimia_crud` tiene `SELECT/INSERT/UPDATE/DELETE` y es el único rol usado por mutations, login, sesiones y auditoría.
- Los tokens IAM se cachean por menos de su vigencia y se renuevan automáticamente por `pg` en cada conexión nueva.

### Tablas

#### `users`
| Columna | Tipo | Restricción | Descripción |
| --- | --- | --- | --- |
| `id` | INTEGER | PK, AUTOINCREMENT | Identificador interno. |
| `username` | TEXT | UNIQUE, NOCASE | Login (admin = `admin`; usuarios nuevos = su email). |
| `email` | TEXT | UNIQUE, NOCASE | Email usado como "hoja/owner" y en asignaciones. |
| `nombre` | TEXT | DEFAULT `''` | Nombre visible en la UI; se rellena desde el email si falta. |
| `password_hash` | TEXT | NOT NULL | `scrypt$salt$hash` (Nunca texto plano). |
| `role` | TEXT | `Administrador` \| `Usuario` | Perfil global. `Administrador` accede a Configuración; no otorga privilegios automáticos en proyectos abiertos. |
| `activo` | INTEGER | DEFAULT 1 | 1 = activo. |
| `created_at` | TEXT | datetime UTC | Alta. |

#### `sessions`
| Columna | Tipo | Restricción | Descripción |
| --- | --- | --- | --- |
| `token_hash` | TEXT | PK | SHA-256 del token de la cookie (el token sin hashear no se guarda). |
| `user_id` | INTEGER | FK → `users.id` ON DELETE CASCADE | Usuario de la sesión. |
| `created_at` | TEXT | datetime UTC | Creación. |
| `expires_at` | TEXT | datetime UTC | Expira a las 12 h. |

#### `projects`
| Columna | Tipo | Restricción | Descripción |
| --- | --- | --- | --- |
| `id` | TEXT | PK | UUID. |
| `nombre` | TEXT | NOT NULL | Nombre del proyecto. |
| `lider_email` | TEXT | NOCASE, DEFAULT `''` | Solo compatibilidad con BD migradas. La fuente real del líder es `assignments.rol = 'Líder'`. |
| `created_at` | TEXT | datetime UTC | Alta. |

> No existe columna de estado: todos los proyectos son abiertos. Las columnas `FECHA_CIERRE`, `SDA`, `DURACION_SEMANAS` y las hojas de proyectos cerrados se eliminaron.

#### `categories`
| Columna | Tipo | Descripción |
| --- | --- | --- |
| `id` | TEXT | PK (UUID). |
| `nombre` | TEXT | Nombre de categoría. |
| `creado_por` | TEXT | Email de quien la creó. |
| `fecha` | TEXT | `YYYY-MM-DD` (Bogotá). |
| `created_at` | TEXT | datetime UTC. |

#### `assignments`
| Columna | Tipo | Restricción | Descripción |
| --- | --- | --- | --- |
| `proyecto_id` | TEXT | PK, FK → `projects.id` ON DELETE CASCADE | Proyecto. |
| `email` | TEXT | PK, NOCASE | Usuario asignado (pool de la vista abierta y contexto de Morgan). |
| `rol` | TEXT | `Líder` \| `Colaborador`, DEFAULT `Colaborador` | Rol **en este proyecto**. Define edición global, vista `VISTA GLOBAL` y chat. |

#### `entries`
Una fila por Tarea / Subtarea / Avance / Información general. Sustituye las hojas por usuario.

| Columna BD | Columna hoja original | Tipo | Descripción |
| --- | --- | --- | --- |
| `id` | `ID` | TEXT PK | UUID. |
| `owner_email` | (nombre de la hoja) | TEXT NOCASE | Dueño de la fila. |
| `project_id` | `ID_Proyecto` | TEXT | Proyecto (sin FK para conservar el comportamiento legado). |
| `tipo` | `Tipo` | TEXT | `Tarea` \| `Subtarea` \| `Avance` \| `General`. |
| `parent_id` | `Parent_ID` | TEXT | Jerarquía Tarea → Subtarea → Avance. |
| `descripcion` | `Descripcion` | TEXT | HTML de CKEditor. |
| `fecha_inicio` | `Fecha Inicio` | TEXT | `YYYY-MM-DD`. |
| `fecha_fin` | `Fecha Fin` | TEXT | `YYYY-MM-DD` o vacío. |
| `estado` | `Estado` | TEXT | `No iniciado`, `En proceso`, `Detenido`, `Completado`, `Eliminada`. |
| `alerta` | `Alerta` | TEXT | Solo se guarda en Avances `Detenido`. |
| `bloqueante` | `Bloqueante` | TEXT | Solo se guarda en Avances `Detenido`. |
| `categoria` | `Categoria` | TEXT | Nombre de categoría. |
| `nota` | `Nota` | TEXT | HTML de la nota de la Tarea. |
| `jira` | `Jira` | TEXT | Ticket. |
| `msd` | `MSD` | TEXT | Ticket. |
| `esp_tecnica` | `Especificacion Tecnica` | TEXT | HTML. |
| `esp_funcional` | `Especificacion Funcional` | TEXT | HTML. |
| `evidencia` | `Evidencia` | TEXT | URL o texto. |
| `sin_entregable` | `Sin Entregable` | INTEGER | 0/1 (antes `No`/`Sí`). |
| `observaciones` | `Observaciones` | TEXT | Historial de atrasos: `[YYYY-MM-DD]::texto`, separado por `homoplato`. |
| `entregable` | `Entregable` | TEXT | URL o texto. |
| `interno` | `Interno` | INTEGER | 0/1 (antes `No`/`Sí`). |
| `descripcion_tarea` | `Descripcion_Tarea` | TEXT | Solo Tareas. |
| `created_at` / `updated_at` | — | TEXT | datetime UTC. |

Índices: `(owner_email, project_id)` y `(parent_id)`.

#### `audit`
| Columna | Tipo | Descripción |
| --- | --- | --- |
| `id` | INTEGER | PK. |
| `timestamp` | TEXT | `YYYY-MM-DD HH:mm:ss` (Bogotá). |
| `usuario` | TEXT | Email de quien ejecuta la acción. |
| `accion` | TEXT | `CREAR`, `EDITAR`, `ELIMINAR`, `LOGIN`, `LOGIN_FALLIDO`, `LOGOUT`, `CONSULTAR`. |
| `tipo` | TEXT | Entidad afectada. |
| `id_registro` | TEXT | Id de la entidad. |
| `detalle` | TEXT | Detalle libre. |

Toda mutación de la app (configuración, entradas, notas, atrasos, login/logout y consultas a Morgan) genera una fila mediante `src/lib/audit.js`. Todavía no hay visualización de auditoría en la interfaz.

### Correspondencia con las hojas antiguas

| Hoja Apps Script | Tabla SQLite |
| --- | --- |
| `Usuarios` | `users` (+ `username`, `password_hash`) |
| `Proyectos` | `projects` (sin estado ni columnas de cierre) |
| `Categorias` | `categories` |
| `Asignaciones` | `assignments` |
| `Auditoria` | `audit` |
| Hoja por correo (abiertos) | `entries` filtrando por `owner_email` |
| Hojas de proyectos cerrados | **Eliminadas** |

## Reglas conservadas

- Normalización de estados: `Por Iniciar`→`No iniciado`, `En Pausa`/`Bloqueada`→`Detenido`, `Terminada`→`Completado`, resto→`En proceso`.
- No se puede completar una Tarea/Subtarea con hijos sin completar o eliminados.
- Todos los usuarios (incluido `Administrador`) ven en proyectos abiertos solo los proyectos donde tienen una asignación.
- La asignación indica si el usuario actúa como `Líder` o `Colaborador` en ese proyecto. Un usuario puede ser líder de uno o varios proyectos y colaborador en otros; un proyecto puede tener varios líderes.
- Editar registros ajenos, usar `VISTA GLOBAL` y consultar Morgan exigen rol `Líder` **en el proyecto activo** (no basta con el perfil `Administrador`).
- El chat de Morgan usa un gobierno SQL (`src/lib/sqlGovernance.js`): recibe solo las tablas permitidas del proyecto, devuelve un `SELECT` con `:projectId`/`:hoy`, ese SQL se ejecuta en una conexión de solo lectura y sus filas se devuelven al modelo para redactar la respuesta. Nunca se envían estructuras de acceso, credenciales, perfiles globales ni bitácoras.

## Verificación

```bash
npm run lint
npm run build
```
