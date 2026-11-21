import { ApiError } from './errors.js';
import { getDb } from './db.js';
import { emailNorm, PERFIL_ADMIN, ROL_LIDER } from './utils.js';

export function esAdministrador(user) {
  return user?.role === PERFIL_ADMIN;
}

export function rolEnProyecto(proyectoId, email) {
  if (!proyectoId || !email) return '';
  const row = getDb().prepare(
    'SELECT rol FROM assignments WHERE proyecto_id = ? AND email = ?'
  ).get(String(proyectoId), emailNorm(email));
  return row?.rol || '';
}

export function esLiderDelProyecto(user, proyectoId) {
  return rolEnProyecto(proyectoId, user?.email) === ROL_LIDER;
}

export function puedeEditarRegistro(user, owner, proyectoId) {
  if (emailNorm(owner) && emailNorm(owner) === emailNorm(user?.email)) return true;
  return esLiderDelProyecto(user, proyectoId);
}

export function assertPuedeEditarRegistro(user, owner, proyectoId) {
  if (!puedeEditarRegistro(user, owner, proyectoId)) {
    throw new ApiError('No autorizado: solo el responsable o el líder del proyecto pueden editar este registro.', 403);
  }
}

export function proyectosAsignados(user) {
  return getDb().prepare(
    `SELECT p.id, p.nombre
       FROM projects p
       JOIN assignments a ON a.proyecto_id = p.id
      WHERE a.email = ?
      ORDER BY p.nombre`
  ).all(emailNorm(user?.email));
}

export function proyectoDeEntrada(entryId) {
  if (!entryId) return '';
  const row = getDb().prepare('SELECT project_id FROM entries WHERE id = ?').get(String(entryId));
  return row?.project_id || '';
}
