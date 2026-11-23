import { ApiError } from './errors.js';
import { getDb } from './db.js';
import { emailNorm, PERFIL_ADMIN, ROL_LIDER } from './utils.js';

export function esAdministrador(user) {
  return user?.role === PERFIL_ADMIN;
}

export async function rolEnProyecto(proyectoId, email) {
  if (!proyectoId || !email) return '';
  const db = await getDb();
  const row = await db.get(
    'SELECT rol FROM assignments WHERE proyecto_id = ? AND email = ?',
    String(proyectoId), emailNorm(email)
  );
  return row?.rol || '';
}

export async function esLiderDelProyecto(user, proyectoId) {
  return (await rolEnProyecto(proyectoId, user?.email)) === ROL_LIDER;
}

export async function puedeEditarRegistro(user, owner, proyectoId) {
  if (emailNorm(owner) && emailNorm(owner) === emailNorm(user?.email)) return true;
  return esLiderDelProyecto(user, proyectoId);
}

export async function assertPuedeEditarRegistro(user, owner, proyectoId) {
  if (!(await puedeEditarRegistro(user, owner, proyectoId))) {
    throw new ApiError('No autorizado: solo el responsable o el líder del proyecto pueden editar este registro.', 403);
  }
}

export async function proyectosAsignados(user) {
  const db = await getDb();
  return db.all(
    `SELECT p.id, p.nombre
       FROM projects p
       JOIN assignments a ON a.proyecto_id = p.id
      WHERE a.email = ?
      ORDER BY p.nombre`,
    emailNorm(user?.email)
  );
}

export async function proyectoDeEntrada(entryId) {
  if (!entryId) return '';
  const db = await getDb();
  const row = await db.get('SELECT project_id FROM entries WHERE id = ?', String(entryId));
  return row?.project_id || '';
}
