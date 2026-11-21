import { randomUUID } from 'node:crypto';
import { getDb } from './db.js';
import { ApiError } from './errors.js';
import { audit } from './audit.js';
import { emailNorm, mapEntryRow, normalizarEstado_, nowBogota, todayBogota } from './utils.js';

export function allowedCollaborators(projectId) {
  if (!projectId) return null;
  const db = getDb();
  const allowed = new Set();

  db.prepare('SELECT email FROM assignments WHERE proyecto_id = ?').all(String(projectId))
    .forEach((r) => {
      const email = emailNorm(r.email);
      if (email) allowed.add(email);
    });

  return allowed;
}

export function fetchEntriesData(targetUser, projectId) {
  const owner = emailNorm(targetUser);
  if (!owner) return [];
  const db = getDb();
  const rows = projectId
    ? db.prepare('SELECT * FROM entries WHERE owner_email = ? AND project_id = ?').all(owner, String(projectId))
    : db.prepare('SELECT * FROM entries WHERE owner_email = ?').all(owner);
  return rows.map(mapEntryRow);
}

export function fetchAllEntriesData(userList, projectId) {
  const permitidos = allowedCollaborators(projectId);
  const users = [...new Set((userList || []).map(emailNorm).filter(Boolean))];
  let all = [];
  users.forEach((user) => {
    if (permitidos && !permitidos.has(user)) return;
    all = all.concat(fetchEntriesData(user, projectId));
  });
  return all;
}

function tieneHijosAbiertos(parentId) {
  const rows = getDb().prepare('SELECT estado FROM entries WHERE parent_id = ?').all(String(parentId));
  return rows.some((r) => {
    const estado = normalizarEstado_(r.estado);
    return estado !== 'Completado' && estado !== 'Eliminada';
  });
}

function entryRowFrom(data, existing) {
  const esNuevo = !existing;
  const hoy = todayBogota();
  const estado = normalizarEstado_(data.estado);
  const owner = emailNorm(data.userOwner);
  const detenido = data.tipo === 'Avance' && estado === 'Detenido';

  return {
    id: data.id || existing?.id || randomUUID(),
    owner_email: owner,
    project_id: data.projectId || '',
    tipo: data.tipo,
    parent_id: data.parentId || '',
    descripcion: data.desc || '',
    fecha_inicio: esNuevo ? data.fechaInicio || hoy : data.fechaInicio || existing.fecha_inicio || hoy,
    fecha_fin: data.fechaFin || '',
    estado,
    alerta: detenido ? data.alerta || '' : '',
    bloqueante: detenido ? data.bloqueante || '' : '',
    categoria: data.categoria || '',
    nota: data.nota !== undefined ? data.nota : existing?.nota || '',
    jira: data.jira || '',
    msd: data.msd || '',
    esp_tecnica: data.espTecnica || '',
    esp_funcional: data.espFuncional || '',
    evidencia: data.evidencia || '',
    sin_entregable: data.sinEntregable ? 1 : 0,
    observaciones: data.observaciones || '',
    entregable: data.entregable || '',
    interno: data.interno ? 1 : 0,
    descripcion_tarea:
      data.tipo === 'Tarea'
        ? data.descripcionTarea !== undefined
          ? data.descripcionTarea
          : existing?.descripcion_tarea || ''
        : '',
  };
}

export function saveEntry(data, user) {
  const db = getDb();
  const existing = data.id ? db.prepare('SELECT * FROM entries WHERE id = ?').get(String(data.id)) : null;

  if (
    existing &&
    normalizarEstado_(data.estado) === 'Completado' &&
    (data.tipo === 'Tarea' || data.tipo === 'Subtarea') &&
    tieneHijosAbiertos(existing.id)
  ) {
    const tipoHijo = data.tipo === 'Tarea' ? 'subtareas' : 'avances/actividades';
    throw new ApiError(`No se puede marcar como "Completado": existen ${tipoHijo} sin completar dentro de este elemento.`);
  }

  const row = entryRowFrom(data, existing);
  const columnas = Object.keys(row);
  const valores = columnas.map((c) => row[c]);
  db.prepare(
    `INSERT INTO entries (${columnas.join(', ')})
     VALUES (${columnas.map(() => '?').join(', ')})
     ON CONFLICT(id) DO UPDATE SET
       ${columnas.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(', ')},
       updated_at = datetime('now')`
  ).run(...valores);

  audit(existing ? 'EDITAR' : 'CREAR', data.tipo, row.id,
    `Proyecto: ${row.project_id} | Estado: ${row.estado} | Cat: ${row.categoria || '-'}`, user);
  return { success: true };
}

export function saveNota(data, user) {
  const db = getDb();
  const owner = emailNorm(data.owner);
  const result = db.prepare('UPDATE entries SET nota = ?, updated_at = datetime(?) WHERE id = ? AND owner_email = ?')
    .run(data.contenido || '', nowBogota(), String(data.tareaId), owner);
  if (!result.changes) return { success: false };
  audit('EDITAR', 'Nota', String(data.tareaId), `Owner: ${owner}`, user);
  return { success: true };
}

export function saveGeneralProjectInfo(data, user) {
  const db = getDb();
  const owner = emailNorm(data.owner);
  const projectId = String(data.projectId || '');
  const existing = db.prepare(
    "SELECT * FROM entries WHERE tipo = 'General' AND owner_email = ? AND project_id = ? LIMIT 1"
  ).get(owner, projectId);
  const row = {
    id: existing?.id || randomUUID(),
    owner_email: owner,
    project_id: projectId,
    tipo: 'General',
    parent_id: '',
    descripcion: 'Información General del Proyecto',
    fecha_inicio: existing?.fecha_inicio || todayBogota(),
    fecha_fin: '',
    estado: 'En proceso',
    alerta: data.alerta || '',
    bloqueante: data.bloqueante || '',
    categoria: '',
    nota: data.nota || '',
    jira: '',
    msd: '',
    esp_tecnica: '',
    esp_funcional: '',
    evidencia: '',
    sin_entregable: 0,
    observaciones: '',
    entregable: '',
    interno: 0,
    descripcion_tarea: '',
  };
  const columnas = Object.keys(row);
  db.prepare(
    `INSERT INTO entries (${columnas.join(', ')})
     VALUES (${columnas.map(() => '?').join(', ')})
     ON CONFLICT(id) DO UPDATE SET
       ${columnas.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(', ')},
       updated_at = datetime('now')`
  ).run(...columnas.map((c) => row[c]));
  audit(existing ? 'EDITAR' : 'CREAR', 'InfoGeneral', row.id, `Proyecto: ${projectId} | Owner: ${owner}`, user);
  return { success: true };
}

export function saveAtrasoAvance(data, user) {
  const db = getDb();
  const owner = emailNorm(data.owner);
  const row = db.prepare('SELECT observaciones FROM entries WHERE id = ? AND owner_email = ?')
    .get(String(data.avanceId), owner);
  if (!row) return { success: false };

  const fecha = todayBogota();
  const nuevaEntrada = `[${fecha}]::${String(data.justificacion || '').trim()}`;
  const actual = String(row.observaciones || '').trim();
  const observaciones = actual ? `${actual}homoplato${nuevaEntrada}` : nuevaEntrada;
  db.prepare('UPDATE entries SET observaciones = ?, updated_at = datetime(?) WHERE id = ?')
    .run(observaciones, nowBogota(), String(data.avanceId));
  audit('EDITAR', 'AtrasoAvance', String(data.avanceId), `Owner: ${owner} | Fecha: ${fecha}`, user);
  return { success: true, fecha };
}
