//  CONFIGURACIÓN — ID del Google Sheet de datos
var SHEET_ID = '1EeZQn_f2vf9Il57z8qA_xMYafto4habUjnZjrP6F_XE';

const OPEN_ENTRY_HEADERS = [
  'ID', 'Tipo', 'Parent_ID', 'Descripcion', 'Fecha Inicio', 'Fecha Fin',
  'Estado', 'ID_Proyecto', 'Alerta', 'Bloqueante', 'Categoria', 'Nota',
  'Jira', 'MSD', 'Especificacion Tecnica', 'Especificacion Funcional',
  'Evidencia', 'Sin Entregable', 'Observaciones', 'Entregable', 'Interno'
];

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
  const email = Session.getActiveUser().getEmail().toLowerCase();
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
  const email = Session.getActiveUser().getEmail().toLowerCase();
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
  const email = Session.getActiveUser().getEmail().toLowerCase();
  const newId = Utilities.getUuid();
  const fecha = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  sheet.appendRow([newId, nombre.trim(), email, fecha]);
  registrarAuditoria('CREAR', 'Categoria', newId, nombre.trim());
  return { success: true };
}

function getAppData() {
  const email = Session.getActiveUser().getEmail().toLowerCase();
  const ss = getDB();

  let configSheet = ss.getSheetByName('Usuarios') || ss.insertSheet('Usuarios');
  const usersData = configSheet.getDataRange().getValues();
  const userRow = usersData.find(r => r[0].toLowerCase() === email);

  if (!userRow) return { access: false, email: email };
  const role = userRow[1];

  let projSheet = ss.getSheetByName('Proyectos') || ss.insertSheet('Proyectos');
  if (projSheet.getLastRow() === 0) {
    projSheet.appendRow(['ID', 'NOMBRE', 'LIDER_EMAIL', 'ESTADO', 'FECHA_CIERRE', 'SDA', 'DURACION_SEMANAS']);
  }
  const allProj = projSheet.getDataRange().getValues();
  allProj.shift();

  const openProjects = allProj.filter(r => !r[3] || r[3].toString().toLowerCase() !== 'cerrado');

  let myProjects = [];
  if (role === 'Líder') {
    myProjects = openProjects.map(r => ({ id: r[0], nombre: r[1] }));
  } else {
    let asignSheet = ss.getSheetByName('Asignaciones') || ss.insertSheet('Asignaciones');
    if (asignSheet.getLastRow() === 0) asignSheet.appendRow(['ID_PROYECTO', 'EMAIL_USUARIO']);
    const asignations = asignSheet.getDataRange().getValues();
    const idsAsigned = asignations.filter(r => r[1].toLowerCase() === email).map(r => String(r[0]));
    myProjects = openProjects.filter(r => idsAsigned.includes(String(r[0]))).map(r => ({ id: r[0], nombre: r[1] }));
  }

  return {
    access:     true,
    email:      email,
    role:       role,
    userList:   usersData.map(r => r[0]).filter(e => e !== '' && e !== 'CORREO'),
    projects:   myProjects,
    categorias: getCategorias()
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

// Busca en TODAS las hojas de owners (Tareas/Subtareas/Avances pueden
// estar asignadas a usuarios distintos del padre) si existe algún hijo
// directo (Parent_ID === parentId) cuyo Estado no sea 'Terminada' ni 'Eliminada'.
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
        const estado = String(row[6] || '').trim();
        if (estado !== 'Terminada' && estado !== 'Eliminada') return true;
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

  // 🔒 Validación de jerarquía (respaldo de servidor): no se puede cerrar
  // una Tarea/Subtarea si aún tiene hijos (Subtareas/Avances) sin cerrar.
  if (!esNuevo && data.estado === 'Terminada' && (data.tipo === 'Tarea' || data.tipo === 'Subtarea')) {
    if (tieneHijosAbiertos_(ss, entryId)) {
      const tipoHijo = data.tipo === 'Tarea' ? 'subtareas' : 'avances/actividades';
      throw new Error(`No se puede marcar como "Terminada": existen ${tipoHijo} sin cerrar dentro de este elemento.`);
    }
  }

  const hoy      = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const fechaInicio = esNuevo
    ? (data.fechaInicio || hoy)
    : (data.fechaInicio || values[rowIndex][4] || hoy);

  const newRow = [
      entryId,
      data.tipo,
      data.parentId   || '',
      data.desc,
      fechaInicio,
      data.fechaFin   || '',
      data.estado,
      data.projectId  || '',
      data.alerta     || '',
      data.bloqueante || '',
      data.categoria  || '',
      data.nota       || '',
      data.jira       || '',
      data.msd        || '',
      data.espTecnica || '',
      data.espFuncional || '',
      data.evidencia    || '',
      data.sinEntregable ? 'Sí' : 'No',
      data.observaciones || '',
      data.entregable   || '',
      data.interno ? 'Sí' : 'No'
    ];

  if (!esNuevo) sheet.getRange(rowIndex + 1, 1, 1, 21).setValues([newRow]);
  else sheet.appendRow(newRow);

  registrarAuditoria(
    esNuevo ? 'CREAR' : 'EDITAR',
    data.tipo,
    entryId,
    `Proyecto: ${data.projectId} | Estado: ${data.estado} | Cat: ${data.categoria || '-'}`
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
    .map(r => ({
      id:          r[0],
      tipo:        r[1],
      parentId:    r[2],
      desc:        r[3],
      fechaInicio: r[4] instanceof Date ? Utilities.formatDate(r[4], Session.getScriptTimeZone(), 'yyyy-MM-dd') : r[4],
      fechaFin:    r[5] instanceof Date ? Utilities.formatDate(r[5], Session.getScriptTimeZone(), 'yyyy-MM-dd') : r[5],
      estado:      r[6],
      owner:       targetUser,
      projectId:   r[7],
      alerta:      r[8]  || '',
      bloqueante:  r[9]  || '',
      categoria:   r[10] || '',
      nota:        r[11] || '',
      jira:        r[12] || '',
      msd:         r[13] || '',
      espTecnica:  r[14] || '',
      espFuncional:r[15] || '',
      evidencia:   r[16] || '',
      sinEntregable: (r[17] || '') === 'Sí',
      observaciones: r[18] || '',
      entregable:  r[19] || '',
      interno:     (r[20] || '') === 'Sí'
    }));
}

function fetchAllEntries(userList, projectId) {
  let all = [];
  userList.forEach(user => { all = all.concat(fetchEntries(user, projectId)); });
  return all;
}

function cObtenerProyectosCerrados() {
  const email = Session.getActiveUser().getEmail().toLowerCase();
  const ss = getDB();
  const configSheet = ss.getSheetByName('Usuarios');
  if (!configSheet) return [];

  const usersData = configSheet.getDataRange().getValues();
  const userRow = usersData.find(r => r[0].toLowerCase() === email);
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