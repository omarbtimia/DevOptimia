//  CONFIGURACIÓN — ID del Google Sheet de datos
var SHEET_ID = '1EeZQn_f2vf9Il57z8qA_xMYafto4habUjnZjrP6F_XE';

//  CONFIGURACIÓN AWS BEDROCK (Chat exclusivo para Líderes)
//  Puedes pegar tu token aquí o configurarlo en Propiedades del Script como 'AWS_BEARER_TOKEN_BEDROCK'
const AWS_BEARER_TOKEN_BEDROCK = '';
const BEDROCK_REGION = 'us-east-1';
const BEDROCK_MODEL = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';
const BEDROCK_FALLBACK_MODEL = 'us.anthropic.claude-3-5-haiku-20241022-v1:0';

const OPEN_ENTRY_HEADERS = [
  'ID', 'Tipo', 'Parent_ID', 'Descripcion', 'Fecha Inicio', 'Fecha Fin',
  'Estado', 'ID_Proyecto', 'Alerta', 'Bloqueante', 'Categoria', 'Nota',
  'Jira', 'MSD', 'Especificacion Tecnica', 'Especificacion Funcional',
  'Evidencia', 'Sin Entregable', 'Observaciones', 'Entregable', 'Interno',
  'Descripcion_Tarea'
];

// Obtiene el correo del usuario de forma segura tanto en USER_ACCESSING como en USER_DEPLOYING
function obtenerEmailUsuarioActivo_() {
  const active = Session.getActiveUser().getEmail();
  if (active && String(active).trim() !== '') {
    return String(active).trim().toLowerCase();
  }
  const effective = Session.getEffectiveUser().getEmail();
  return String(effective || '').trim().toLowerCase();
}

// ══════════════════════════════════════════════════
//  FUNCIÓN PARA AUTORIZAR Y PROBAR BEDROCK DESDE EL EDITOR
// ══════════════════════════════════════════════════
function autorizarPermisosBedrock() {
  const apiKey = (AWS_BEARER_TOKEN_BEDROCK && AWS_BEARER_TOKEN_BEDROCK.trim()) ||
                 PropertiesService.getScriptProperties().getProperty('AWS_BEARER_TOKEN_BEDROCK') || '';
  const url = `https://bedrock-runtime.${BEDROCK_REGION}.amazonaws.com/model/${encodeURIComponent(BEDROCK_MODEL)}/converse`;
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + apiKey },
    payload: JSON.stringify({
      messages: [{ role: 'user', content: [{ text: 'Responde solo: OK' }] }],
      inferenceConfig: { maxTokens: 10 }
    }),
    muteHttpExceptions: true
  });
  Logger.log('HTTP Status: ' + res.getResponseCode());
  Logger.log('Respuesta de Bedrock recibida: ' + res.getContentText());
}

function ensureOpenEntriesSchema_(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(OPEN_ENTRY_HEADERS);
    return;
  }
  for (let i = 0; i < OPEN_ENTRY_HEADERS.length; i++) {
    const col = i + 1;
    const current = String(sheet.getRange(1, col).getValue() || '').trim();
    if (!current) sheet.getRange(1, col).setValue(OPEN_ENTRY_HEADERS[i]);
  }
}

// Normaliza estados antiguos hacia el nuevo modelo de 4 estados:
// 'No iniciado', 'En proceso', 'Detenido', 'Completado' (más 'Eliminada')
function normalizarEstado_(estadoRaw) {
  const st = String(estadoRaw || '').trim();
  if (st === 'Por Iniciar' || st === 'No iniciado') return 'No iniciado';
  if (st === 'En Pausa' || st === 'Bloqueada' || st === 'Detenido') return 'Detenido';
  if (st === 'Terminada' || st === 'Completado') return 'Completado';
  if (st === 'Eliminada') return 'Eliminada';
  return 'En proceso';
}

function getDB() {
  return SpreadsheetApp.openById(SHEET_ID);
}

// ══════════════════════════════════════════════════
//  ROUTING
// ══════════════════════════════════════════════════
function doGet() {
  return HtmlService.createTemplateFromFile('Home')
    .evaluate()
    .setTitle('Optimia - Dashboard')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getView(vista) {
  const map = { home: 'Home', abiertos: 'Index', cerrados: 'Cerrados', config: 'Config' };
  return HtmlService.createTemplateFromFile(map[vista] || 'Home').evaluate().getContent();
}

// ══════════════════════════════════════════════════
//  CONFIGURACIÓN — lectura completa para Config.html
// ══════════════════════════════════════════════════
function cfgGetAll() {
  const ss = getDB();

  const usuSheet = ss.getSheetByName('Usuarios');
  const usuarios = usuSheet ? usuSheet.getDataRange().getValues().slice(1)
    .filter(r => r[0] && r[0] !== 'CORREO')
    .map(r => ({ email: r[0], rol: r[1] })) : [];

  const projSheet = ss.getSheetByName('Proyectos');
  const proyectos = projSheet && projSheet.getLastRow() > 1
    ? projSheet.getDataRange().getValues().slice(1)
        .filter(r => r[0])
        .map(r => ({ id: r[0], nombre: r[1], lider: r[2], estado: r[3] || 'Abierto' }))
    : [];

  const catSheet  = ss.getSheetByName('Categorias');
  const categorias = catSheet && catSheet.getLastRow() > 1
    ? catSheet.getDataRange().getValues().slice(1)
        .filter(r => r[0])
        .map(r => ({ id: r[0], nombre: r[1], creadoPor: r[2], fecha: r[3] instanceof Date
          ? Utilities.formatDate(r[3], Session.getScriptTimeZone(), 'yyyy-MM-dd') : r[3] }))
    : [];

  const asigSheet   = ss.getSheetByName('Asignaciones');
  const asignaciones = asigSheet && asigSheet.getLastRow() > 1
    ? asigSheet.getDataRange().getValues().slice(1)
        .filter(r => r[0] && r[1])
        .map(r => ({ proyectoId: r[0], email: r[1] }))
    : [];

  return { usuarios, proyectos, categorias, asignaciones };
}

function cfgSaveUsuario(data) {
  const ss = getDB();
  const sheet = ss.getSheetByName('Usuarios') || ss.insertSheet('Usuarios');
  const values = sheet.getDataRange().getValues();
  const idx = values.findIndex(r => r[0].toLowerCase() === data.email.toLowerCase());
  if (idx !== -1) {
    sheet.getRange(idx + 1, 2).setValue(data.rol);
    registrarAuditoria('EDITAR', 'Usuario', data.email, `Rol: ${data.rol}`);
  } else {
    sheet.appendRow([data.email.toLowerCase(), data.rol]);
    registrarAuditoria('CREAR', 'Usuario', data.email, `Rol: ${data.rol}`);
  }
  return cfgGetAll();
}

function cfgSaveProyecto(data) {
  const ss = getDB();
  let sheet = ss.getSheetByName('Proyectos');
  if (!sheet) {
    sheet = ss.insertSheet('Proyectos');
    sheet.appendRow(['ID','NOMBRE','LIDER_EMAIL','ESTADO','FECHA_CIERRE','SDA','DURACION_SEMANAS']);
  }
  const values = sheet.getDataRange().getValues();
  const idx = values.findIndex(r => r[0] === data.id);
  if (idx !== -1) {
    sheet.getRange(idx + 1, 2).setValue(data.nombre);
    sheet.getRange(idx + 1, 3).setValue(data.lider);
    sheet.getRange(idx + 1, 4).setValue(data.estado);
    registrarAuditoria('EDITAR', 'Proyecto', data.id, `${data.nombre} | Estado: ${data.estado}`);
  } else {
    const newId = Utilities.getUuid();
    sheet.appendRow([newId, data.nombre, data.lider, data.estado || 'Abierto', '', '', '']);
    let asigSheet = ss.getSheetByName('Asignaciones') || ss.insertSheet('Asignaciones');
    asigSheet.appendRow([newId, data.lider.toLowerCase()]);
    registrarAuditoria('CREAR', 'Proyecto', newId, data.nombre);
  }
  return cfgGetAll();
}

function cfgSaveCategoria(data) {
  const ss = getDB();
  let sheet = ss.getSheetByName('Categorias');
  if (!sheet) {
    sheet = ss.insertSheet('Categorias');
    sheet.appendRow(['ID','NOMBRE','CREADO_POR','FECHA']);
  }
  const email = obtenerEmailUsuarioActivo_();
  const fecha = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const values = sheet.getDataRange().getValues();
  const idx = values.findIndex(r => r[0] === data.id);
  if (idx !== -1) {
    sheet.getRange(idx + 1, 2).setValue(data.nombre.trim());
    registrarAuditoria('EDITAR', 'Categoria', data.id, data.nombre.trim());
  } else {
    const newId = Utilities.getUuid();
    sheet.appendRow([newId, data.nombre.trim(), email, fecha]);
    registrarAuditoria('CREAR', 'Categoria', newId, data.nombre.trim());
  }
  return cfgGetAll();
}

function cfgAgregarAsignacion(proyectoId, email) {
  const ss = getDB();
  let sheet = ss.getSheetByName('Asignaciones') || ss.insertSheet('Asignaciones');
  const values = sheet.getDataRange().getValues();
  const existe = values.some(r => String(r[0]) === String(proyectoId) && r[1].toLowerCase() === email.toLowerCase());
  if (!existe) {
    sheet.appendRow([proyectoId, email.toLowerCase()]);
    registrarAuditoria('CREAR', 'Asignacion', proyectoId, email);
  }
  return cfgGetAll();
}

function cfgQuitarAsignacion(proyectoId, email) {
  const ss = getDB();
  const sheet = ss.getSheetByName('Asignaciones');
  if (!sheet) return cfgGetAll();
  const values = sheet.getDataRange().getValues();
  for (let i = values.length - 1; i >= 1; i--) {
    if (String(values[i][0]) === String(proyectoId) && values[i][1].toLowerCase() === email.toLowerCase()) {
      sheet.deleteRow(i + 1);
      registrarAuditoria('ELIMINAR', 'Asignacion', proyectoId, email);
      break;
    }
  }
  return cfgGetAll();
}

function registrarAuditoria(accion, tipo, idRegistro, detalle) {
  const ss = getDB();
  let sheet = ss.getSheetByName('Auditoria');
  if (!sheet) {
    sheet = ss.insertSheet('Auditoria');
    sheet.appendRow(['Timestamp', 'Usuario', 'Accion', 'Tipo', 'ID_Registro', 'Detalle']);
    sheet.getRange(1, 1, 1, 6).setFontWeight('bold');
  }
  const email = obtenerEmailUsuarioActivo_();
  const ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  sheet.appendRow([ts, email, accion, tipo || '', idRegistro || '', detalle || '']);
}

function getCategorias() {
  const ss = getDB();
  let sheet = ss.getSheetByName('Categorias');
  if (!sheet) {
    sheet = ss.insertSheet('Categorias');
    sheet.appendRow(['ID', 'NOMBRE', 'CREADO_POR', 'FECHA']);
    return [];
  }
  if (sheet.getLastRow() < 2) return [];
  const data = sheet.getDataRange().getValues();
  data.shift();
  return data.filter(r => r[0] !== '').map(r => ({ id: r[0], nombre: r[1] }));
}

function addCategoria(nombre) {
  const ss = getDB();
  let sheet = ss.getSheetByName('Categorias');
  if (!sheet) {
    sheet = ss.insertSheet('Categorias');
    sheet.appendRow(['ID', 'NOMBRE', 'CREADO_POR', 'FECHA']);
  }
  const email = obtenerEmailUsuarioActivo_();
  const newId = Utilities.getUuid();
  const fecha = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  sheet.appendRow([newId, nombre.trim(), email, fecha]);
  registrarAuditoria('CREAR', 'Categoria', newId, nombre.trim());
  return { success: true };
}

function getAppData() {
  const email = obtenerEmailUsuarioActivo_();
  const ss = getDB();

  let configSheet = ss.getSheetByName('Usuarios') || ss.insertSheet('Usuarios');
  const usersData = configSheet.getDataRange().getValues();
  const userRow = usersData.find(r => String(r[0] || '').toLowerCase() === email);

  if (!userRow) return { access: false, email: email };
  const role = userRow[1];

  let projSheet = ss.getSheetByName('Proyectos') || ss.insertSheet('Proyectos');
  if (projSheet.getLastRow() === 0) {
    projSheet.appendRow(['ID', 'NOMBRE', 'LIDER_EMAIL', 'ESTADO', 'FECHA_CIERRE', 'SDA', 'DURACION_SEMANAS']);
  }
  const allProj = projSheet.getDataRange().getValues();
  allProj.shift();

  const openProjects = allProj.filter(r => !r[3] || r[3].toString().toLowerCase() !== 'cerrado');

  let asignSheet = ss.getSheetByName('Asignaciones') || ss.insertSheet('Asignaciones');
  if (asignSheet.getLastRow() === 0) asignSheet.appendRow(['ID_PROYECTO', 'EMAIL_USUARIO']);
  const asignations = asignSheet.getLastRow() > 1 ? asignSheet.getDataRange().getValues().slice(1) : [];

  let myProjects = [];
  if (role === 'Líder') {
    myProjects = openProjects.map(r => ({ id: r[0], nombre: r[1], lider: r[2] || '' }));
  } else {
    const idsAsigned = asignations.filter(r => r[1] && r[1].toLowerCase() === email).map(r => String(r[0]));
    myProjects = openProjects.filter(r => idsAsigned.includes(String(r[0]))).map(r => ({ id: r[0], nombre: r[1], lider: r[2] || '' }));
  }

  return {
    access:       true,
    email:        email,
    role:         role,
    userList:     usersData.map(r => r[0]).filter(e => e !== '' && e !== 'CORREO'),
    projects:     myProjects,
    asignaciones: asignations.filter(r => r[0] && r[1]).map(r => ({ proyectoId: String(r[0]), email: r[1].toLowerCase() })),
    categorias:   getCategorias()
  };
}

function saveNota(data) {
  const ss = getDB();
  const sheet = ss.getSheetByName(data.owner);
  if (!sheet) return { success: false };
  ensureOpenEntriesSchema_(sheet);
  const values = sheet.getDataRange().getValues();
  const rowIndex = values.findIndex(r => r[0] === data.tareaId);
  if (rowIndex === -1) return { success: false };
  sheet.getRange(rowIndex + 1, 12).setValue(data.contenido);
  registrarAuditoria('EDITAR', 'Nota', data.tareaId, `Owner: ${data.owner}`);
  return { success: true };
}

// ══════════════════════════════════════════════════
//  ALERTAS, BLOQUEANTES Y NOTAS GENERALES (SIN TAREA/SUBTAREA)
//  Se guarda una fila de Tipo = 'General' por usuario y proyecto
// ══════════════════════════════════════════════════
function saveGeneralProjectInfo(data) {
  const ss = getDB();
  let sheet = ss.getSheetByName(data.owner) || ss.insertSheet(data.owner);
  ensureOpenEntriesSchema_(sheet);

  const values = sheet.getDataRange().getValues();
  const rowIndex = values.findIndex(r =>
    String(r[1]) === 'General' && String(r[7]) === String(data.projectId)
  );
  const hoy = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const entryId = rowIndex !== -1 ? values[rowIndex][0] : Utilities.getUuid();
  const esNuevo = rowIndex === -1;

  const newRow = [
    entryId,
    'General',
    '',
    'Información General del Proyecto',
    esNuevo ? hoy : (values[rowIndex][4] || hoy),
    '',
    'En proceso',
    data.projectId || '',
    data.alerta || '',
    data.bloqueante || '',
    '',
    data.nota || '',
    '', '', '', '', '', 'No', '', '', 'No',
    ''
  ];

  if (!esNuevo) sheet.getRange(rowIndex + 1, 1, 1, 22).setValues([newRow]);
  else sheet.appendRow(newRow);

  registrarAuditoria(
    esNuevo ? 'CREAR' : 'EDITAR',
    'InfoGeneral',
    entryId,
    `Proyecto: ${data.projectId} | Owner: ${data.owner}`
  );

  return { success: true };
}

// ══════════════════════════════════════════════════
//  JUSTIFICACIÓN DE ATRASO — avances abiertos > 7 días
//  Almacena en columna 19 (Observaciones) del avance, separadas por "homoplato"
//  Formato de cada entrada: [FECHA]::TEXTO
// ══════════════════════════════════════════════════
function saveAtrasoAvance(data) {
  const ss = getDB();
  const sheet = ss.getSheetByName(data.owner);
  if (!sheet) return { success: false };
  ensureOpenEntriesSchema_(sheet);
  const values = sheet.getDataRange().getValues();
  const rowIndex = values.findIndex(r => r[0] === data.avanceId);
  if (rowIndex === -1) return { success: false };

  const hoy = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const nuevaEntrada = '[' + hoy + ']::' + data.justificacion.trim();

  // Columna 19 = Observaciones (índice 18, base-0)
  const actual = String(sheet.getRange(rowIndex + 1, 19).getValue() || '').trim();
  const nuevo = actual ? actual + 'homoplato' + nuevaEntrada : nuevaEntrada;
  sheet.getRange(rowIndex + 1, 19).setValue(nuevo);

  registrarAuditoria('EDITAR', 'AtrasoAvance', data.avanceId, `Owner: ${data.owner} | Fecha: ${hoy}`);
  return { success: true, fecha: hoy };
}

// ══════════════════════════════════════════════════
//  VALIDACIÓN DE JERARQUÍA — no cerrar padres con hijos abiertos
// ══════════════════════════════════════════════════
const RESERVED_SHEETS_ = ['Usuarios', 'Proyectos', 'Categorias', 'Asignaciones', 'Auditoria'];

function tieneHijosAbiertos_(ss, parentId) {
  const sheets = ss.getSheets();
  for (let s = 0; s < sheets.length; s++) {
    const sheet = sheets[s];
    const name = sheet.getName();
    if (RESERVED_SHEETS_.indexOf(name) !== -1) continue;
    if (sheet.getLastRow() < 2) continue;

    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (String(row[2]) === String(parentId)) {
        const estado = normalizarEstado_(row[6]);
        if (estado !== 'Completado' && estado !== 'Eliminada') return true;
      }
    }
  }
  return false;
}

function saveOrUpdateEntry(data) {
  const ss = getDB();
  let sheet = ss.getSheetByName(data.userOwner) || ss.insertSheet(data.userOwner);
  ensureOpenEntriesSchema_(sheet);

  const entryId  = data.id || Utilities.getUuid();
  const values   = sheet.getDataRange().getValues();
  const rowIndex = values.findIndex(r => r[0] === data.id);
  const esNuevo  = rowIndex === -1;

  const estadoNormalizado = normalizarEstado_(data.estado);

  if (!esNuevo && estadoNormalizado === 'Completado' && (data.tipo === 'Tarea' || data.tipo === 'Subtarea')) {
    if (tieneHijosAbiertos_(ss, entryId)) {
      const tipoHijo = data.tipo === 'Tarea' ? 'subtareas' : 'avances/actividades';
      throw new Error(`No se puede marcar como "Completado": existen ${tipoHijo} sin completar dentro de este elemento.`);
    }
  }

  const hoy      = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const fechaInicio = esNuevo
    ? (data.fechaInicio || hoy)
    : (data.fechaInicio || values[rowIndex][4] || hoy);

  const notaActual = !esNuevo ? (values[rowIndex][11] || '') : '';
  const descTareaActual = !esNuevo ? (values[rowIndex][21] || '') : '';

  const alertaGuardar = (data.tipo === 'Avance' && estadoNormalizado === 'Detenido') ? (data.alerta || '') : '';
  const bloqGuardar   = (data.tipo === 'Avance' && estadoNormalizado === 'Detenido') ? (data.bloqueante || '') : '';

  const newRow = [
      entryId,
      data.tipo,
      data.parentId   || '',
      data.desc,
      fechaInicio,
      data.fechaFin   || '',
      estadoNormalizado,
      data.projectId  || '',
      alertaGuardar,
      bloqGuardar,
      data.categoria  || '',
      data.nota !== undefined ? data.nota : notaActual,
      data.jira       || '',
      data.msd        || '',
      data.espTecnica || '',
      data.espFuncional || '',
      data.evidencia    || '',
      data.sinEntregable ? 'Sí' : 'No',
      data.observaciones || '',
      data.entregable   || '',
      data.interno ? 'Sí' : 'No',
      data.tipo === 'Tarea' ? (data.descripcionTarea !== undefined ? data.descripcionTarea : descTareaActual) : ''
    ];

  if (!esNuevo) sheet.getRange(rowIndex + 1, 1, 1, 22).setValues([newRow]);
  else sheet.appendRow(newRow);

  registrarAuditoria(
    esNuevo ? 'CREAR' : 'EDITAR',
    data.tipo,
    entryId,
    `Proyecto: ${data.projectId} | Estado: ${estadoNormalizado} | Cat: ${data.categoria || '-'}`
  );

  return { success: true };
}

function addProject(nombre, lider) {
  const ss = getDB();
  const sheet = ss.getSheetByName('Proyectos');
  const newId = Utilities.getUuid();
  sheet.appendRow([newId, nombre, lider, 'Abierto', '', '', '']);
  let asignSheet = ss.getSheetByName('Asignaciones') || ss.insertSheet('Asignaciones');
  asignSheet.appendRow([newId, lider.toLowerCase()]);
  registrarAuditoria('CREAR', 'Proyecto', newId, nombre);
  return { success: true };
}

function addUser(correo, rol) {
  const ss = getDB();
  const sheet = ss.getSheetByName('Usuarios');
  sheet.appendRow([correo, rol]);
  registrarAuditoria('CREAR', 'Usuario', correo, `Rol: ${rol}`);
  return { success: true };
}

function fetchEntries(targetUser, projectId) {
  const ss = getDB();
  const sheet = ss.getSheetByName(targetUser);
  if (!sheet || sheet.getLastRow() < 2) return [];
  ensureOpenEntriesSchema_(sheet);
  const data = sheet.getDataRange().getValues();
  data.shift();
  return data
    .filter(r => !projectId || String(r[7]) === String(projectId))
    .map(r => {
      const tipo = r[1];
      const estadoRaw = String(r[6] || '').trim();
      const estadoNorm = normalizarEstado_(estadoRaw);
      let alerta = r[8] || '';
      let bloqueante = r[9] || '';

      if (tipo === 'Subtarea' || tipo === 'Tarea') {
        alerta = '';
        bloqueante = '';
      } else if (tipo === 'Avance' && estadoNorm !== 'Detenido') {
        alerta = '';
        bloqueante = '';
      }

      return {
        id:               r[0],
        tipo:             tipo,
        parentId:         r[2],
        desc:             r[3],
        fechaInicio:      r[4] instanceof Date ? Utilities.formatDate(r[4], Session.getScriptTimeZone(), 'yyyy-MM-dd') : r[4],
        fechaFin:         r[5] instanceof Date ? Utilities.formatDate(r[5], Session.getScriptTimeZone(), 'yyyy-MM-dd') : r[5],
        estado:           estadoNorm,
        owner:            targetUser,
        projectId:        r[7],
        alerta:           alerta,
        bloqueante:       bloqueante,
        categoria:        r[10] || '',
        nota:             r[11] || '',
        jira:             r[12] || '',
        msd:              r[13] || '',
        espTecnica:       r[14] || '',
        espFuncional:     r[15] || '',
        evidencia:        r[16] || '',
        sinEntregable:    (r[17] || '') === 'Sí',
        observaciones:    r[18] || '',
        entregable:       r[19] || '',
        interno:          (r[20] || '') === 'Sí',
        descripcionTarea: r[21] || ''
      };
    });
}

// Obtiene únicamente los usuarios asignados actualmente al proyecto en la hoja 'Asignaciones' (más su líder)
function obtenerUsuariosAsignadosProyecto_(ss, projectId) {
  if (!projectId) return null;
  const permitidos = {};

  const asigSheet = ss.getSheetByName('Asignaciones');
  if (asigSheet && asigSheet.getLastRow() > 1) {
    const rows = asigSheet.getDataRange().getValues().slice(1);
    rows.forEach(r => {
      if (String(r[0]) === String(projectId) && r[1]) {
        permitidos[String(r[1]).trim().toLowerCase()] = true;
      }
    });
  }

  const projSheet = ss.getSheetByName('Proyectos');
  if (projSheet && projSheet.getLastRow() > 1) {
    const pRows = projSheet.getDataRange().getValues().slice(1);
    const proj = pRows.find(r => String(r[0]) === String(projectId));
    if (proj && proj[2]) {
      permitidos[String(proj[2]).trim().toLowerCase()] = true;
    }
  }

  return permitidos;
}

function fetchAllEntries(userList, projectId) {
  const ss = getDB();
  const permitidosMap = obtenerUsuariosAsignadosProyecto_(ss, projectId);
  let all = [];

  (userList || []).forEach(user => {
    const emailNorm = String(user || '').trim().toLowerCase();
    if (!emailNorm) return;
    if (permitidosMap && !permitidosMap[emailNorm]) return;
    all = all.concat(fetchEntries(emailNorm, projectId));
  });

  return all;
}

// ══════════════════════════════════════════════════
//  MORGAN: CHAT BUSCADOR EXCLUSIVO PARA LÍDERES (AWS BEDROCK)
//  Consulta TODO lo registrado en el proyecto seleccionado sin filtro de fecha
// ══════════════════════════════════════════════════
function limpiarHtmlATexto_(html) {
  if (!html) return '';
  return String(html)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatearObservacionesContexto_(obs) {
  if (!obs) return '';
  return String(obs)
    .split('homoplato')
    .map(p => p.trim())
    .filter(Boolean)
    .join(' | ');
}

function calcularInfoAtrasoBackend_(av) {
  if (!av || av.estado === 'Completado' || av.estado === 'Eliminada' || !av.fechaInicio) {
    return { enAtraso: false, diasAtraso: 0, ultimaRef: '' };
  }
  const hoyStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const partes = String(av.observaciones || '').split('homoplato').map(e => e.trim()).filter(Boolean);
  let ultimaFechaRef = String(av.fechaInicio).trim();

  partes.forEach(p => {
    const m = p.match(/^\[(\d{4}-\d{2}-\d{2})\]::([\s\S]*)$/);
    if (m && m[1]) ultimaFechaRef = m[1];
  });

  const d1 = new Date(ultimaFechaRef + 'T00:00:00');
  const d2 = new Date(hoyStr + 'T00:00:00');
  if (isNaN(d1.getTime()) || isNaN(d2.getTime())) {
    return { enAtraso: false, diasAtraso: 0, ultimaRef: ultimaFechaRef };
  }

  const dias = Math.floor((d2.getTime() - d1.getTime()) / 86400000);
  return {
    enAtraso: dias >= 7,
    diasAtraso: dias,
    ultimaRef: ultimaFechaRef
  };
}

function construirContextoProyectoChat_(ss, projectId, projectName) {
  const permitidosMap = obtenerUsuariosAsignadosProyecto_(ss, projectId) || {};
  const colaboradores = Object.keys(permitidosMap).sort();

  // Trae TODO el historial registrado por cada colaborador asignado al proyecto (sin filtro de fecha)
  let entries = [];
  colaboradores.forEach(email => {
    entries = entries.concat(fetchEntries(email, projectId));
  });

  entries = entries.filter(e => e.estado !== 'Eliminada');

  const hoyStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const lineas = [];
  lineas.push(`PROYECTO SELECCIONADO: ${projectName || projectId}`);
  lineas.push(`FECHA ACTUAL: ${hoyStr}`);
  lineas.push(`COLABORADORES ASIGNADOS: ${colaboradores.length ? colaboradores.join(', ') : 'Ninguno'}`);
  lineas.push('');

  // 1. Información General del Proyecto
  const generales = entries.filter(e => e.tipo === 'General');
  if (generales.length > 0) {
    lineas.push('=== INFORMACIÓN GENERAL DEL PROYECTO ===');
    generales.forEach(g => {
      const al = limpiarHtmlATexto_(g.alerta);
      const bl = limpiarHtmlATexto_(g.bloqueante);
      const nt = limpiarHtmlATexto_(g.nota);
      if (al) lineas.push(`- Alerta General (Colaborador: ${g.owner}): ${al}`);
      if (bl) lineas.push(`- Bloqueante General (Colaborador: ${g.owner}): ${bl}`);
      if (nt) lineas.push(`- Nota General (Colaborador: ${g.owner}): ${nt}`);
    });
    lineas.push('');
  }

  // 2. Estructura completa por Nombre de Tarea -> Nombre de Subtarea -> Nombre de Actividad (Sin numeraciones artificiales)
  const tareas = entries.filter(e => e.tipo === 'Tarea');
  const subtareas = entries.filter(e => e.tipo === 'Subtarea');
  const avances = entries.filter(e => e.tipo === 'Avance');

  lineas.push('=== REGISTRO COMPLETO DE TAREAS, SUBTAREAS Y ACTIVIDADES DEL PROYECTO ===');

  if (tareas.length === 0) {
    lineas.push('No hay tareas registradas en este proyecto.');
  } else {
    tareas.forEach(t => {
      const nombreTarea = limpiarHtmlATexto_(t.desc);
      const descContexto = limpiarHtmlATexto_(t.descripcionTarea);
      const notaTarea = limpiarHtmlATexto_(t.nota);
      const condicionTarea = t.estado !== 'Completado' ? 'ABIERTA/ACTIVA' : 'COMPLETADA';

      lineas.push(`TAREA: "${nombreTarea}" | Estado: ${t.estado} (${condicionTarea}) | Creada por: ${t.owner} | Inicio: ${t.fechaInicio || '-'}`);
      if (descContexto) lineas.push(`  Contexto de "${nombreTarea}": ${descContexto}`);
      if (notaTarea)    lineas.push(`  Notas de "${nombreTarea}": ${notaTarea}`);

      const stsHijas = subtareas.filter(st => String(st.parentId) === String(t.id));
      if (stsHijas.length === 0) {
        lineas.push('  (Sin subtareas registradas)');
      } else {
        stsHijas.forEach(st => {
          const nombreSt = limpiarHtmlATexto_(st.desc);
          const condicionSt = st.estado !== 'Completado' ? 'ABIERTA/ACTIVA' : 'COMPLETADA';
          const metaSt = [
            `Estado: ${st.estado} (${condicionSt})`,
            `Responsable: ${st.owner}`,
            st.jira ? `Ticket Jira: ${st.jira}` : '',
            st.msd ? `Ticket MSD: ${st.msd}` : '',
            st.espTecnica ? `Esp. Técnica: ${limpiarHtmlATexto_(st.espTecnica)}` : '',
            st.espFuncional ? `Esp. Funcional: ${limpiarHtmlATexto_(st.espFuncional)}` : ''
          ].filter(Boolean).join(' | ');

          lineas.push(`  SUBTAREA: "${nombreSt}" [Pertenece a Tarea: "${nombreTarea}"] (${metaSt})`);

          const avsHijos = avances.filter(av => String(av.parentId) === String(st.id));
          if (avsHijos.length === 0) {
            lineas.push('    (Sin actividades registradas)');
          } else {
            avsHijos.forEach(av => {
              const descAv = limpiarHtmlATexto_(av.desc);
              const alertaAv = limpiarHtmlATexto_(av.alerta);
              const bloqAv = limpiarHtmlATexto_(av.bloqueante);
              const obsAv = formatearObservacionesContexto_(av.observaciones);
              const infoRezago = calcularInfoAtrasoBackend_(av);
              const condicionAv = av.estado !== 'Completado' ? 'ABIERTA/ACTIVA' : 'COMPLETADA';

              const detallesAv = [
                `Realizada por / Responsable: ${av.owner}`,
                `Estado: ${av.estado} (${condicionAv})`,
                `Categoría: ${av.categoria || '-'}`,
                `Inicio: ${av.fechaInicio || '-'}`,
                `Fin: ${av.fechaFin || 'En curso'}`,
                infoRezago.enAtraso
                  ? `REZAGO ACTIVO (+7 días): Sí (${infoRezago.diasAtraso} días sin avance desde ${infoRezago.ultimaRef})`
                  : 'REZAGO ACTIVO (+7 días): No',
                av.evidencia ? `Evidencia: ${av.evidencia}` : '',
                av.entregable ? `Entregable: ${av.entregable}` : '',
                alertaAv ? `Alerta: ${alertaAv}` : '',
                bloqAv ? `Bloqueante: ${bloqAv}` : '',
                obsAv ? `Observaciones: ${obsAv}` : ''
              ].filter(Boolean).join(' | ');

              lineas.push(`    * ACTIVIDAD: "${descAv}" [Tarea: "${nombreTarea}" > Subtarea: "${nombreSt}"] -> ${detallesAv}`);
            });
          }
        });
      }
      lineas.push('');
    });
  }

  return lineas.join('\n');
}

function invocarEndpointBedrock_(modelId, apiKey, requestBody) {
  const url = `https://bedrock-runtime.${BEDROCK_REGION}.amazonaws.com/model/${encodeURIComponent(modelId)}/converse`;
  Logger.log('Invocando Bedrock URL: ' + url);
  return UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'Authorization': 'Bearer ' + apiKey
    },
    payload: JSON.stringify(requestBody),
    muteHttpExceptions: true
  });
}

function consultarChatLiderBedrock(payload) {
  const email = obtenerEmailUsuarioActivo_();
  const ss = getDB();

  // 1. Verificar que el usuario tenga estrictamente el rol 'Líder'
  const usuSheet = ss.getSheetByName('Usuarios');
  if (!usuSheet) return { success: false, error: 'No se encontró la hoja de Usuarios.' };
  const usersData = usuSheet.getDataRange().getValues();
  const userRow = usersData.find(r => String(r[0] || '').toLowerCase() === email);
  if (!userRow || String(userRow[1] || '').trim() !== 'Líder') {
    return { success: false, error: 'Acceso denegado: este chat está habilitado únicamente para usuarios con rol Líder.' };
  }

  const pregunta = String((payload && payload.question) || '').trim();
  const projectId = String((payload && payload.projectId) || '').trim();
  const projectName = String((payload && payload.projectName) || '').trim();

  if (!pregunta) return { success: false, error: 'Por favor escribe una pregunta.' };
  if (!projectId) return { success: false, error: 'Selecciona un proyecto válido.' };

  // 2. Obtener API Key de Bedrock (desde constante o desde ScriptProperties)
  const apiKey = (AWS_BEARER_TOKEN_BEDROCK && AWS_BEARER_TOKEN_BEDROCK.trim()) ||
                 PropertiesService.getScriptProperties().getProperty('AWS_BEARER_TOKEN_BEDROCK') || '';

  if (!apiKey) {
    return {
      success: false,
      error: 'Falta configurar AWS_BEARER_TOKEN_BEDROCK en Código.gs o en las Propiedades del Script.'
    };
  }

  // 3. Construir contexto completo del proyecto seleccionado (sin filtros de fecha)
  const contextoProyecto = construirContextoProyectoChat_(ss, projectId, projectName);

  const systemInstruction = [
    'Eres Morgan, el asistente y buscador exclusivo del proyecto seleccionado en Optimia.',
    'REGLAS OBLIGATORIAS:',
    '1. RESTRICCIÓN AL PROYECTO ACTUAL: Responde ÚNICAMENTE con los datos del proyecto incluidos en el contexto (que contiene todo lo registrado por cada colaborador sin importar fechas). Si preguntan sobre temas generales o ajenos al proyecto, responde exactamente: "Solo puedo responder consultas sobre la información registrada en el proyecto seleccionado."',
    '2. RESPETO ESTRICTO POR LOS ESTADOS: Ten siempre presente el Estado de cada elemento (No iniciado, En proceso, Detenido, Completado). Si piden cosas "activas" o "abiertas", muestra SOLO lo que NO esté en estado Completado. Si buscan una palabra o quién hizo algo, muestra todas las coincidencias indicando claramente su Estado actual y quién la realizó (correo del colaborador).',
    '3. PROHIBIDO USAR CÓDIGOS GENÉRICOS: NUNCA escribas "TAREA 1", "TAREA-ss" ni numeraciones artificiales. Escribe SIEMPRE el nombre real de la Tarea, el nombre real de la Subtarea y la descripción de la Actividad.',
    '4. FORMATO HTML LIMPIO Y CORTO: Sé muy claro, corto y directo. Responde usando HTML limpio (<ul>, <li>, <strong>, <em>, <br>, <p>) para listas y jerarquías. NO envuelvas la respuesta en bloques ```html ni uses sintaxis Markdown (** o #).'
  ].join('\n');

  const promptUsuario = `DATOS COMPLETOS DEL PROYECTO SELECCIONADO:\n${contextoProyecto}\n\nCONSULTA O BÚSQUEDA DEL LÍDER:\n${pregunta}`;

  const requestBody = {
    system: [{ text: systemInstruction }],
    messages: [
      {
        role: 'user',
        content: [{ text: promptUsuario }]
      }
    ],
    inferenceConfig: {
      maxTokens: 900
    }
  };

  try {
    let res = invocarEndpointBedrock_(BEDROCK_MODEL, apiKey, requestBody);
    let status = res.getResponseCode();
    let rawText = res.getContentText();

    // Si el perfil principal no está activo o el ID difiere en la cuenta AWS, intenta con el fallback
    if ((status === 400 || status === 404) && BEDROCK_FALLBACK_MODEL && BEDROCK_FALLBACK_MODEL !== BEDROCK_MODEL) {
      res = invocarEndpointBedrock_(BEDROCK_FALLBACK_MODEL, apiKey, requestBody);
      status = res.getResponseCode();
      rawText = res.getContentText();
    }

    if (status < 200 || status >= 300) {
      return { success: false, error: `Error Bedrock (${status}): ${rawText}` };
    }

    const data = JSON.parse(rawText);
    const rawAnswer = (data && data.output && data.output.message && data.output.message.content && data.output.message.content[0])
      ? data.output.message.content[0].text
      : 'Sin respuesta del modelo.';

    // Limpiar eventuales bloques ```html o markdown residual conservando las etiquetas HTML limpias
    const cleanHtmlAnswer = String(rawAnswer)
      .replace(/^```html\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```$/i, '')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .trim();

    return { success: true, answer: cleanHtmlAnswer };
  } catch (e) {
    return { success: false, error: 'Excepción al conectar con Bedrock: ' + e.message };
  }
}

// ══════════════════════════════════════════════════
//  PROYECTOS CERRADOS
// ══════════════════════════════════════════════════
function cObtenerProyectosCerrados() {
  const email = obtenerEmailUsuarioActivo_();
  const ss = getDB();
  const configSheet = ss.getSheetByName('Usuarios');
  if (!configSheet) return [];

  const usersData = configSheet.getDataRange().getValues();
  const userRow = usersData.find(r => String(r[0] || '').toLowerCase() === email);
  if (!userRow) return [];
  const role = userRow[1];

  const projSheet = ss.getSheetByName('Proyectos');
  if (!projSheet || projSheet.getLastRow() < 2) return [];
  const allProj = projSheet.getDataRange().getValues();
  allProj.shift();

  const cerrados = allProj.filter(r => r[3] && r[3].toString().toLowerCase() === 'cerrado');
  const format = r => ({ id: r[0], nombre: r[1], lider: r[2], sda: r[5] || '', duracion: r[6] || '' });

  if (role === 'Líder') return cerrados.map(format);

  const asignSheet = ss.getSheetByName('Asignaciones');
  if (!asignSheet) return [];
  const asignations = asignSheet.getDataRange().getValues();
  const idsAsigned = asignations.filter(r => r[1].toLowerCase() === email).map(r => String(r[0]));
  return cerrados.filter(r => idsAsigned.includes(String(r[0]))).map(format);
}

function cCrearProyectoCerrado(nombre, sda, duracion, liderEmail) {
  const ss = getDB();
  let projSheet = ss.getSheetByName('Proyectos');
  if (!projSheet) {
    projSheet = ss.insertSheet('Proyectos');
    projSheet.appendRow(['ID', 'NOMBRE', 'LIDER_EMAIL', 'ESTADO', 'FECHA_CIERRE', 'SDA', 'DURACION_SEMANAS']);
  }
  const newId = Utilities.getUuid();
  const fechaHoy = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  projSheet.appendRow([newId, nombre, liderEmail, 'Cerrado', fechaHoy, sda, duracion]);

  const sheetName = nombre.replace(/\s+/g, '');
  if (!ss.getSheetByName(sheetName)) {
    const ps = ss.insertSheet(sheetName);
    ps.appendRow(['ID', 'Tipo', 'Parent_ID', 'Descripcion', 'Fecha Inicio', 'Fecha Fin', 'Estado', 'ID_Proyecto', 'Owner', 'Semana Inicio', 'Semana Fin']);
  }
  let asignSheet = ss.getSheetByName('Asignaciones') || ss.insertSheet('Asignaciones');
  asignSheet.appendRow([newId, liderEmail.toLowerCase()]);

  registrarAuditoria('CREAR', 'ProyectoCerrado', newId, `${nombre} | SDA: ${sda} | Semanas: ${duracion}`);
  return { success: true };
}

function cGuardarGestionSemana(data) {
  const ss = getDB();
  const sheetName = data.nombreProyecto.replace(/\s+/g, '');
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.appendRow(['ID','Tipo','Parent_ID','Descripcion','Fecha Inicio','Fecha Fin','Estado',
                     'ID_Proyecto','Owner','Semana Inicio','Semana Fin',
                     'Gestion_Pct','Gestion_Alerta','Gestion_Bloqueante']);
  }

  const header = sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0];
  if (header.length < 14) {
    sheet.getRange(1, 12, 1, 3).setValues([['Gestion_Pct','Gestion_Alerta','Gestion_Bloqueante']]);
  }

  const values = sheet.getDataRange().getValues();
  const rowIndex = values.findIndex(r =>
    String(r[1]) === 'Gestion' && String(r[2]) === String(data.avanceId) && String(r[9]) === String(data.semana)
  );
  const fecha = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const entryId = rowIndex !== -1 ? values[rowIndex][0] : Utilities.getUuid();
  const esNuevo = rowIndex === -1;
  const newRow = [
    entryId, 'Gestion', data.avanceId, 'Gestion S' + data.semana,
    fecha, '', '', data.projectId, data.userOwner || '',
    data.semana, data.semana, data.pct, data.alerta || '', data.bloqueante || ''
  ];

  if (!esNuevo) sheet.getRange(rowIndex + 1, 1, 1, 14).setValues([newRow]);
  else sheet.appendRow(newRow);

  registrarAuditoria(esNuevo ? 'CREAR' : 'EDITAR', 'GestionSemana', entryId, `Proyecto: ${data.projectId} | Semana: ${data.semana} | Pct: ${data.pct}%`);
  return { success: true };
}

function cFetchGestionSemanas(projectId) { return []; }

function cFetchEntradas(nombreProyecto, projectId) {
  const ss = getDB();
  const sheetName = nombreProyecto.replace(/\s+/g, '');
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const data = sheet.getDataRange().getValues();
  data.shift();

  return data
    .filter(r => r[0] !== '' && (!projectId || String(r[7]) === String(projectId)))
    .map(r => ({
      id:                r[0],
      tipo:              r[1],
      parentId:          r[2],
      desc:              r[3],
      fechaInicio:       r[4] instanceof Date ? Utilities.formatDate(r[4], Session.getScriptTimeZone(), 'yyyy-MM-dd') : (r[4] || ''),
      fechaFin:          r[5] instanceof Date ? Utilities.formatDate(r[5], Session.getScriptTimeZone(), 'yyyy-MM-dd') : (r[5] || ''),
      estado:            r[6],
      projectId:         r[7],
      owner:             r[8]  || '',
      semanaInicio:      r[9]  !== undefined ? r[9]  : '',
      semanaFin:         r[10] !== undefined ? r[10] : '',
      gestionPct:        r[11] !== undefined ? r[11] : '',
      gestionAlerta:     r[12] || '',
      gestionBloqueante: r[13] || ''
    }));
}

function cGuardarEntradaCerrado(data) {
  const ss = getDB();
  const sheetName = data.nombreProyecto.replace(/\s+/g, '');
  let sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.appendRow(['ID', 'Tipo', 'Parent_ID', 'Descripcion', 'Fecha Inicio', 'Fecha Fin', 'Estado', 'ID_Proyecto', 'Owner', 'Semana Inicio', 'Semana Fin']);
  }

  const entryId = data.id || Utilities.getUuid();
  const values = sheet.getDataRange().getValues();
  const rowIndex = values.findIndex(r => r[0] === data.id);
  const esNuevo = rowIndex === -1;

  const newRow = [
    entryId, data.tipo, data.parentId || '', data.desc,
    data.fechaInicio || '', data.fechaFin || '', data.estado,
    data.projectId || '', data.userOwner || '', data.semanaInicio || '', data.semanaFin || ''
  ];

  if (!esNuevo) sheet.getRange(rowIndex + 1, 1, 1, 11).setValues([newRow]);
  else sheet.appendRow(newRow);

  registrarAuditoria(esNuevo ? 'CREAR' : 'EDITAR', data.tipo, entryId, `Proyecto: ${data.projectId} | Estado: ${data.estado}`);
  return { success: true };
}