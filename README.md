# DevOptimia - Guia de configuracion

Este documento sirve como base para configurar y operar el proyecto **Optimia** (Google Apps Script + HTML Service) en nuevos entornos.

## 1) Descripcion rapida

Aplicacion web en Apps Script para gestionar:

- Proyectos abiertos (`Index.html`)
- Proyectos cerrados (`Cerrados.html`)
- Configuracion de usuarios, proyectos, categorias y asignaciones (`Config.html`)

Backend principal en `Codigo.gs`.

## 2) Estructura del proyecto

- `Codigo.gs`: logica de negocio y acceso a Google Sheets.
- `Home.html`: menu principal.
- `Index.html`: gestion de proyectos abiertos.
- `Cerrados.html`: gestion de proyectos cerrados.
- `Config.html`: administracion de catalogos y asignaciones.
- `appsscript.json`: manifiesto Apps Script.
- `.clasp.json`: enlace local con el proyecto Apps Script.
- `.github/workflows/deploy.yml`: despliegue automatico via GitHub Actions.

## 3) Prerrequisitos

1. Cuenta Google con permisos para Apps Script y Google Sheets.
2. Proyecto Apps Script creado y enlazado con `clasp`.
3. Google Sheet de datos creado y compartido con los usuarios que corresponda.
4. (Opcional) Repositorio GitHub para despliegue CI/CD.

## 4) Identificadores importantes (IDs)

### 4.1 ID del proyecto Apps Script

Se define en `.clasp.json`:

```json
{
  "scriptId": "<APPS_SCRIPT_ID>",
  "rootDir": "."
}
```

### 4.2 ID del Google Sheet de datos

Actualmente se usa en `Codigo.gs` como variable global (`SHEET_ID`).

Recomendacion: mover este valor a **Script Properties** para no hardcodearlo en codigo.

## 5) Configuracion de secretos

### 5.1 Secretos para GitHub Actions

El workflow `deploy.yml` requiere estos secretos:

- `CLASPRC_JSON`: contenido JSON de `~/.clasprc.json` de una cuenta con acceso al script.
- `DEPLOYMENT_ID`: ID del deployment de Apps Script a actualizar.

> Nota: si usas ramas por ambiente, define secretos por entorno (dev/qa/prod) en GitHub Environments.

### 5.2 Secretos/propiedades en Apps Script (recomendado)

Configurar en **Project Settings > Script properties**:

- `SHEET_ID`: ID del Google Sheet de datos.
- `APP_ENV`: `dev` | `qa` | `prod`.
- `ALLOWED_DOMAIN` (opcional): dominio permitido para acceso.

Ejemplo de lectura en `Codigo.gs`:

```javascript
function getSheetId_() {
  const v = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!v) throw new Error('Falta Script Property SHEET_ID');
  return v;
}
```

Y luego usarlo en `getDB()`.

## 6) Estructura minima del Google Sheet

La app crea/usa estas hojas:

- `Usuarios`
- `Proyectos`
- `Categorias`
- `Asignaciones`
- `Auditoria`
- Hojas por usuario (proyectos abiertos)
- Hojas por proyecto cerrado (nombre sin espacios)

### 6.1 Encabezados esperados

#### Hojas de usuario (abiertos)

`OPEN_ENTRY_HEADERS` en `Codigo.gs`:

- ID
- Tipo
- Parent_ID
- Descripcion
- Fecha Inicio
- Fecha Fin
- Estado
- ID_Proyecto
- Alerta
- Bloqueante
- Categoria
- Nota
- Jira
- MSD
- Especificacion Tecnica
- Especificacion Funcional
- Evidencia
- Sin Entregable
- Observaciones
- Entregable
- Interno

#### Hoja `Proyectos`

- ID
- NOMBRE
- LIDER_EMAIL
- ESTADO
- FECHA_CIERRE
- SDA
- DURACION_SEMANAS

#### Hoja `Usuarios`

- CORREO
- ROL

#### Hoja `Asignaciones`

- ID_PROYECTO
- EMAIL_USUARIO

## 7) Roles y acceso

Roles manejados por la app:

- `Lider`: acceso global, configuracion y proyectos cerrados.
- `Colaborador`: acceso a proyectos asignados.

El manifiesto actual (`appsscript.json`) esta como:

- `executeAs: USER_DEPLOYING`
- `access: ANYONE`

Recomendacion para produccion:

- Limitar acceso a dominio o usuarios autorizados.
- Validar email y rol al inicio (`getAppData`).

## 8) Despliegue

### 8.1 Manual con clasp

1. `clasp login`
2. `clasp push -f`
3. `clasp deploy` (nuevo) o `clasp deploy -i <DEPLOYMENT_ID>` (actualizar)

### 8.2 Automatico con GitHub Actions

Se ejecuta en push a `main` y realiza:

1. Checkout
2. Instalacion de `@google/clasp`
3. Carga de `CLASPRC_JSON`
4. `clasp push -f`
5. `clasp deploy -i $DEPLOYMENT_ID`

## 9) Consideraciones de seguridad

1. No exponer IDs ni tokens en commits.
2. Mover `SHEET_ID` desde codigo a Script Properties.
3. Separar ambientes (dev/prod) con distintos Sheets y deployment IDs.
4. Revisar permisos de comparticion del Sheet periodicamente.
5. Mantener auditoria activa (`Auditoria`).

## 10) Checklist de puesta en marcha

- [ ] Crear/validar proyecto Apps Script.
- [ ] Configurar `.clasp.json` con `scriptId` correcto.
- [ ] Crear Google Sheet y registrar `SHEET_ID` en Script Properties.
- [ ] Verificar hojas base (`Usuarios`, `Proyectos`, `Categorias`, `Asignaciones`).
- [ ] Cargar usuario administrador con rol `Lider`.
- [ ] Configurar secretos `CLASPRC_JSON` y `DEPLOYMENT_ID` (si aplica CI/CD).
- [ ] Desplegar Web App y validar acceso con usuario lider y colaborador.

## 11) Problemas comunes

- **No tienes acceso / pantalla vacia**: validar que el correo exista en `Usuarios` y tenga rol.
- **No aparecen proyectos**: revisar `Asignaciones` y estado del proyecto (`Abierto`/`Cerrado`).
- **Error al guardar**: confirmar encabezados de hoja y permisos de edicion del Sheet.
- **Fallo en deploy CI/CD**: validar formato JSON de `CLASPRC_JSON` y vigencia de `DEPLOYMENT_ID`.

---

Si vas a productivizar, se recomienda como siguiente paso:

1. Externalizar `SHEET_ID` a Script Properties.
2. Endurecer `webapp.access`.
3. Definir estrategia de ambientes y rotacion de secretos.

