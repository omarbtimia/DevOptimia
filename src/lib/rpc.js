import { randomUUID } from 'node:crypto';
import { getDb } from './db.js';
import { hashPassword } from './crypto.js';
import { requireAdmin } from './auth.js';
import { ApiError } from './errors.js';
import { audit } from './audit.js';
import {
  fetchAllEntriesData,
  fetchEntriesData,
  saveAtrasoAvance,
  saveEntry,
  saveGeneralProjectInfo,
  saveNota,
} from './entries.js';
import {
  assertPuedeEditarRegistro,
  esLiderDelProyecto,
  proyectoDeEntrada,
  proyectosAsignados,
} from './permissions.js';
import { consultarChatLiderBedrock } from './chat.js';
import {
  emailNorm,
  normalizarPerfil,
  normalizarRolProyecto,
  PERFIL_ADMIN,
  todayBogota,
} from './utils.js';

function cfgGetAllData() {
  const db = getDb();
  const asignaciones = db.prepare(
    'SELECT proyecto_id AS proyectoId, email, rol FROM assignments ORDER BY proyectoId, email'
  ).all().map((r) => ({
    proyectoId: String(r.proyectoId),
    email: r.email,
    rol: r.rol,
  }));

  return {
    usuarios: db.prepare(
      "SELECT email, nombre, role AS rol FROM users WHERE activo = 1 ORDER BY nombre, email"
    ).all(),
    proyectos: db.prepare('SELECT id, nombre FROM projects ORDER BY nombre').all()
      .map((p) => ({
        id: p.id,
        nombre: p.nombre,
        lider: asignaciones.find((a) => a.proyectoId === String(p.id) && a.rol === 'Líder')?.email || '',
      })),
    categorias: db.prepare('SELECT id, nombre, creado_por, fecha FROM categories ORDER BY nombre').all()
      .map((r) => ({ id: r.id, nombre: r.nombre, creadoPor: r.creado_por, fecha: r.fecha })),
    asignaciones,
  };
}

function getAppData(user) {
  const db = getDb();
  const email = emailNorm(user.email);
  const usuarios = db.prepare(
    "SELECT email, nombre, role AS rol FROM users WHERE activo = 1 ORDER BY nombre, email"
  ).all();
  const userList = usuarios.map((u) => u.email);
  const asignaciones = db.prepare(
    'SELECT proyecto_id AS proyectoId, email, rol FROM assignments'
  ).all().map((r) => ({
    proyectoId: String(r.proyectoId),
    email: emailNorm(r.email),
    rol: r.rol,
  }));

  return {
    access: true,
    email,
    role: user.role,
    usuarios,
    userList,
    projects: proyectosAsignados(user).map((p) => ({
      id: p.id,
      nombre: p.nombre,
      lider: asignaciones.find((a) => a.proyectoId === String(p.id) && a.rol === 'Líder')?.email || '',
    })),
    asignaciones,
    categorias: db.prepare('SELECT id, nombre FROM categories ORDER BY nombre').all()
      .map((r) => ({ id: r.id, nombre: r.nombre })),
  };
}

function cfgSaveUsuario(data, user) {
  requireAdmin(user);
  const db = getDb();
  const email = emailNorm(data.email);
  const nombre = String(data.nombre || '').trim() || email.split('@')[0];
  const rol = normalizarPerfil(data.rol);
  const password = data.password ? String(data.password) : '';
  if (!email) throw new ApiError('El email es obligatorio.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError('El email no es válido.');

  const existing = db.prepare('SELECT id, role, password_hash FROM users WHERE email = ?').get(email);
  if (existing) {
    if (existing.role === PERFIL_ADMIN && rol !== PERFIL_ADMIN) {
      const total = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'Administrador' AND activo = 1").get().n;
      if (total <= 1) throw new ApiError('Debe quedar al menos un usuario con perfil Administrador.');
    }
    db.prepare('UPDATE users SET nombre = ?, role = ?, password_hash = ? WHERE id = ?')
      .run(nombre, rol, password ? hashPassword(password) : existing.password_hash, existing.id);
    audit('EDITAR', 'Usuario', email, `Nombre: ${nombre} | Perfil: ${rol}`, user);
  } else {
    if (!password) throw new ApiError('La contraseña es obligatoria para nuevos usuarios.');
    db.prepare('INSERT INTO users (username, email, nombre, password_hash, role) VALUES (?, ?, ?, ?, ?)')
      .run(email, email, nombre, hashPassword(password), rol);
    audit('CREAR', 'Usuario', email, `Nombre: ${nombre} | Perfil: ${rol}`, user);
  }
  return cfgGetAllData();
}

function cfgSaveProyecto(data, user) {
  requireAdmin(user);
  const db = getDb();
  const nombre = String(data.nombre || '').trim();
  if (!nombre) throw new ApiError('El nombre del proyecto es obligatorio.');

  const existing = data.id ? db.prepare('SELECT id FROM projects WHERE id = ?').get(String(data.id)) : null;
  if (existing) {
    db.prepare('UPDATE projects SET nombre = ? WHERE id = ?').run(nombre, existing.id);
    audit('EDITAR', 'Proyecto', existing.id, nombre, user);
  } else {
    const id = randomUUID();
    db.prepare('INSERT INTO projects (id, nombre) VALUES (?, ?)').run(id, nombre);
    audit('CREAR', 'Proyecto', id, nombre, user);
  }
  return cfgGetAllData();
}

function cfgSaveCategoria(data, user) {
  requireAdmin(user);
  const db = getDb();
  const nombre = String(data.nombre || '').trim();
  if (!nombre) throw new ApiError('El nombre es obligatorio.');
  const existing = data.id ? db.prepare('SELECT id FROM categories WHERE id = ?').get(String(data.id)) : null;
  if (existing) {
    db.prepare('UPDATE categories SET nombre = ? WHERE id = ?').run(nombre, existing.id);
    audit('EDITAR', 'Categoria', existing.id, nombre, user);
  } else {
    const id = randomUUID();
    db.prepare('INSERT INTO categories (id, nombre, creado_por, fecha) VALUES (?, ?, ?, ?)')
      .run(id, nombre, emailNorm(user.email), todayBogota());
    audit('CREAR', 'Categoria', id, nombre, user);
  }
  return cfgGetAllData();
}

function cfgAgregarAsignacion(params, user) {
  requireAdmin(user);
  const [proyectoId, email, rolRaw] = params;
  const db = getDb();
  const proyecto = db.prepare('SELECT id FROM projects WHERE id = ?').get(String(proyectoId));
  if (!proyecto) throw new ApiError('Proyecto no encontrado.');
  const normalized = emailNorm(email);
  if (!normalized) throw new ApiError('Usuario no válido.');
  const rol = normalizarRolProyecto(rolRaw);
  db.prepare(
    `INSERT INTO assignments (proyecto_id, email, rol) VALUES (?, ?, ?)
     ON CONFLICT(proyecto_id, email) DO UPDATE SET rol = excluded.rol`
  ).run(String(proyectoId), normalized, rol);
  audit('CREAR', 'Asignacion', String(proyectoId), `${normalized} (${rol})`, user);
  return cfgGetAllData();
}

function cfgQuitarAsignacion(params, user) {
  requireAdmin(user);
  const [proyectoId, email] = params;
  const normalized = emailNorm(email);
  const result = getDb().prepare('DELETE FROM assignments WHERE proyecto_id = ? AND email = ?')
    .run(String(proyectoId), normalized);
  if (result.changes) audit('ELIMINAR', 'Asignacion', String(proyectoId), normalized, user);
  return cfgGetAllData();
}

function fetchEntries(params, user) {
  const [targetUser, projectId] = params;
  const owner = emailNorm(targetUser);
  assertPuedeEditarRegistro(user, owner, projectId);
  return fetchEntriesData(owner, projectId);
}

function fetchAllEntries(params, user) {
  const [userList, projectId] = params;
  const lista = esLiderDelProyecto(user, projectId)
    ? userList
    : (userList || []).filter((u) => emailNorm(u) === emailNorm(user.email));
  return fetchAllEntriesData(lista, projectId);
}

export const HANDLERS = {
  getAppData: (_params, user) => getAppData(user),
  cfgGetAll: (_params, user) => {
    requireAdmin(user);
    return cfgGetAllData();
  },
  cfgSaveUsuario: (params, user) => cfgSaveUsuario(params[0] || {}, user),
  cfgSaveProyecto: (params, user) => cfgSaveProyecto(params[0] || {}, user),
  cfgSaveCategoria: (params, user) => cfgSaveCategoria(params[0] || {}, user),
  cfgAgregarAsignacion,
  cfgQuitarAsignacion,
  fetchEntries,
  fetchAllEntries,
  saveOrUpdateEntry: (params, user) => {
    const data = params[0] || {};
    assertPuedeEditarRegistro(user, data.userOwner, data.projectId);
    return saveEntry(data, user);
  },
  saveNota: (params, user) => {
    const data = params[0] || {};
    assertPuedeEditarRegistro(user, data.owner, data.projectId || proyectoDeEntrada(data.tareaId));
    return saveNota(data, user);
  },
  saveGeneralProjectInfo: (params, user) => {
    const data = params[0] || {};
    assertPuedeEditarRegistro(user, data.owner, data.projectId);
    return saveGeneralProjectInfo(data, user);
  },
  saveAtrasoAvance: (params, user) => {
    const data = params[0] || {};
    assertPuedeEditarRegistro(user, data.owner, data.projectId || proyectoDeEntrada(data.avanceId));
    return saveAtrasoAvance(data, user);
  },
  consultarChatLiderBedrock: async (params, user) => {
    const data = params[0] || {};
    const resultado = await consultarChatLiderBedrock(data, user);
    audit('CONSULTAR', 'Chat', String(data.projectId || ''),
      `Pregunta: ${String(data.question || '').slice(0, 160)}`, user);
    return resultado;
  },
};
