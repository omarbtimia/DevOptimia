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

async function cfgGetAllData() {
  const db = await getDb();
  const asignaciones = (await db.all(
    'SELECT proyecto_id AS "proyectoId", email, rol FROM assignments ORDER BY "proyectoId", email'
  )).map((r) => ({
    proyectoId: String(r.proyectoId),
    email: r.email,
    rol: r.rol,
  }));

  return {
    usuarios: await db.all(
      "SELECT email, nombre, role AS rol FROM users WHERE activo = 1 ORDER BY nombre, email"
    ),
    proyectos: (await db.all('SELECT id, nombre FROM projects ORDER BY nombre'))
      .map((p) => ({
        id: p.id,
        nombre: p.nombre,
        lider: asignaciones.find((a) => a.proyectoId === String(p.id) && a.rol === 'Líder')?.email || '',
      })),
    categorias: (await db.all('SELECT id, nombre, creado_por, fecha FROM categories ORDER BY nombre'))
      .map((r) => ({ id: r.id, nombre: r.nombre, creadoPor: r.creado_por, fecha: r.fecha })),
    asignaciones,
  };
}

async function getAppData(user) {
  const db = await getDb();
  const email = emailNorm(user.email);
  const usuarios = await db.all(
    "SELECT email, nombre, role AS rol FROM users WHERE activo = 1 ORDER BY nombre, email"
  );
  const userList = usuarios.map((u) => u.email);
  const asignaciones = (await db.all(
    'SELECT proyecto_id AS "proyectoId", email, rol FROM assignments'
  )).map((r) => ({
    proyectoId: String(r.proyectoId),
    email: emailNorm(r.email),
    rol: r.rol,
  }));
  const proyectos = await proyectosAsignados(user);

  return {
    access: true,
    email,
    role: user.role,
    usuarios,
    userList,
    projects: proyectos.map((p) => ({
      id: p.id,
      nombre: p.nombre,
      lider: asignaciones.find((a) => a.proyectoId === String(p.id) && a.rol === 'Líder')?.email || '',
    })),
    asignaciones,
    categorias: (await db.all('SELECT id, nombre FROM categories ORDER BY nombre'))
      .map((r) => ({ id: r.id, nombre: r.nombre })),
  };
}

async function cfgSaveUsuario(data, user) {
  requireAdmin(user);
  const db = await getDb();
  const email = emailNorm(data.email);
  const nombre = String(data.nombre || '').trim() || email.split('@')[0];
  const rol = normalizarPerfil(data.rol);
  const password = data.password ? String(data.password) : '';
  if (!email) throw new ApiError('El email es obligatorio.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError('El email no es válido.');

  const existing = await db.get('SELECT id, role, password_hash FROM users WHERE email = ?', email);
  if (existing) {
    if (existing.role === PERFIL_ADMIN && rol !== PERFIL_ADMIN) {
      const total = await db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'Administrador' AND activo = 1");
      if (Number(total?.n || 0) <= 1) throw new ApiError('Debe quedar al menos un usuario con perfil Administrador.');
    }
    await db.run(
      'UPDATE users SET nombre = ?, role = ?, password_hash = ? WHERE id = ?',
      nombre, rol, password ? hashPassword(password) : existing.password_hash, existing.id
    );
    await audit('EDITAR', 'Usuario', email, `Nombre: ${nombre} | Perfil: ${rol}`, user);
  } else {
    if (!password) throw new ApiError('La contraseña es obligatoria para nuevos usuarios.');
    await db.run(
      'INSERT INTO users (username, email, nombre, password_hash, role) VALUES (?, ?, ?, ?, ?)',
      email, email, nombre, hashPassword(password), rol
    );
    await audit('CREAR', 'Usuario', email, `Nombre: ${nombre} | Perfil: ${rol}`, user);
  }
  return cfgGetAllData();
}

async function cfgSaveProyecto(data, user) {
  requireAdmin(user);
  const db = await getDb();
  const nombre = String(data.nombre || '').trim();
  if (!nombre) throw new ApiError('El nombre del proyecto es obligatorio.');

  const existing = data.id ? await db.get('SELECT id FROM projects WHERE id = ?', String(data.id)) : null;
  if (existing) {
    await db.run('UPDATE projects SET nombre = ? WHERE id = ?', nombre, existing.id);
    await audit('EDITAR', 'Proyecto', existing.id, nombre, user);
  } else {
    const id = randomUUID();
    await db.run('INSERT INTO projects (id, nombre) VALUES (?, ?)', id, nombre);
    await audit('CREAR', 'Proyecto', id, nombre, user);
  }
  return cfgGetAllData();
}

async function cfgSaveCategoria(data, user) {
  requireAdmin(user);
  const db = await getDb();
  const nombre = String(data.nombre || '').trim();
  if (!nombre) throw new ApiError('El nombre es obligatorio.');
  const existing = data.id ? await db.get('SELECT id FROM categories WHERE id = ?', String(data.id)) : null;
  if (existing) {
    await db.run('UPDATE categories SET nombre = ? WHERE id = ?', nombre, existing.id);
    await audit('EDITAR', 'Categoria', existing.id, nombre, user);
  } else {
    const id = randomUUID();
    await db.run(
      'INSERT INTO categories (id, nombre, creado_por, fecha) VALUES (?, ?, ?, ?)',
      id, nombre, emailNorm(user.email), todayBogota()
    );
    await audit('CREAR', 'Categoria', id, nombre, user);
  }
  return cfgGetAllData();
}

async function cfgAgregarAsignacion(params, user) {
  requireAdmin(user);
  const [proyectoId, email, rolRaw] = params;
  const db = await getDb();
  const proyecto = await db.get('SELECT id FROM projects WHERE id = ?', String(proyectoId));
  if (!proyecto) throw new ApiError('Proyecto no encontrado.');
  const normalized = emailNorm(email);
  if (!normalized) throw new ApiError('Usuario no válido.');
  const rol = normalizarRolProyecto(rolRaw);
  await db.run(
    `INSERT INTO assignments (proyecto_id, email, rol) VALUES (?, ?, ?)
     ON CONFLICT(proyecto_id, email) DO UPDATE SET rol = excluded.rol`,
    String(proyectoId), normalized, rol
  );
  await audit('CREAR', 'Asignacion', String(proyectoId), `${normalized} (${rol})`, user);
  return cfgGetAllData();
}

async function cfgQuitarAsignacion(params, user) {
  requireAdmin(user);
  const [proyectoId, email] = params;
  const db = await getDb();
  const normalized = emailNorm(email);
  const result = await db.run(
    'DELETE FROM assignments WHERE proyecto_id = ? AND email = ?',
    String(proyectoId), normalized
  );
  if (result.changes) await audit('ELIMINAR', 'Asignacion', String(proyectoId), normalized, user);
  return cfgGetAllData();
}

async function fetchEntries(params, user) {
  const [targetUser, projectId] = params;
  const owner = emailNorm(targetUser);
  await assertPuedeEditarRegistro(user, owner, projectId);
  return fetchEntriesData(owner, projectId);
}

async function fetchAllEntries(params, user) {
  const [userList, projectId] = params;
  const esLider = await esLiderDelProyecto(user, projectId);
  const lista = esLider
    ? userList
    : (userList || []).filter((u) => emailNorm(u) === emailNorm(user.email));
  return fetchAllEntriesData(lista, projectId);
}

export const HANDLERS = {
  getAppData: async (_params, user) => getAppData(user),
  cfgGetAll: async (_params, user) => {
    requireAdmin(user);
    return cfgGetAllData();
  },
  cfgSaveUsuario: async (params, user) => cfgSaveUsuario(params[0] || {}, user),
  cfgSaveProyecto: async (params, user) => cfgSaveProyecto(params[0] || {}, user),
  cfgSaveCategoria: async (params, user) => cfgSaveCategoria(params[0] || {}, user),
  cfgAgregarAsignacion: async (params, user) => cfgAgregarAsignacion(params, user),
  cfgQuitarAsignacion: async (params, user) => cfgQuitarAsignacion(params, user),
  fetchEntries: async (params, user) => fetchEntries(params, user),
  fetchAllEntries: async (params, user) => fetchAllEntries(params, user),
  saveOrUpdateEntry: async (params, user) => {
    const data = params[0] || {};
    await assertPuedeEditarRegistro(user, data.userOwner, data.projectId);
    return saveEntry(data, user);
  },
  saveNota: async (params, user) => {
    const data = params[0] || {};
    const proyecto = data.projectId || await proyectoDeEntrada(data.tareaId);
    await assertPuedeEditarRegistro(user, data.owner, proyecto);
    return saveNota(data, user);
  },
  saveGeneralProjectInfo: async (params, user) => {
    const data = params[0] || {};
    await assertPuedeEditarRegistro(user, data.owner, data.projectId);
    return saveGeneralProjectInfo(data, user);
  },
  saveAtrasoAvance: async (params, user) => {
    const data = params[0] || {};
    const proyecto = data.projectId || await proyectoDeEntrada(data.avanceId);
    await assertPuedeEditarRegistro(user, data.owner, proyecto);
    return saveAtrasoAvance(data, user);
  },
  consultarChatLiderBedrock: async (params, user) => {
    const data = params[0] || {};
    const resultado = await consultarChatLiderBedrock(data, user);
    await audit('CONSULTAR', 'Chat', String(data.projectId || ''),
      `Pregunta: ${String(data.question || '').slice(0, 160)}`, user);
    return resultado;
  },
};
