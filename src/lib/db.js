import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { hashPassword } from './crypto.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  nombre        TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('Administrador', 'Usuario')),
  activo        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  nombre      TEXT NOT NULL,
  lider_email TEXT NOT NULL DEFAULT '' COLLATE NOCASE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id         TEXT PRIMARY KEY,
  nombre     TEXT NOT NULL,
  creado_por TEXT NOT NULL DEFAULT '',
  fecha      TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS assignments (
  proyecto_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  email       TEXT NOT NULL COLLATE NOCASE,
  rol         TEXT NOT NULL DEFAULT 'Colaborador' CHECK (rol IN ('Líder', 'Colaborador')),
  PRIMARY KEY (proyecto_id, email)
);

CREATE TABLE IF NOT EXISTS entries (
  id                TEXT PRIMARY KEY,
  owner_email       TEXT NOT NULL COLLATE NOCASE,
  project_id        TEXT NOT NULL DEFAULT '',
  tipo              TEXT NOT NULL CHECK (tipo IN ('Tarea', 'Subtarea', 'Avance', 'General')),
  parent_id         TEXT NOT NULL DEFAULT '',
  descripcion       TEXT NOT NULL DEFAULT '',
  fecha_inicio      TEXT NOT NULL DEFAULT '',
  fecha_fin         TEXT NOT NULL DEFAULT '',
  estado            TEXT NOT NULL DEFAULT 'En proceso',
  alerta            TEXT NOT NULL DEFAULT '',
  bloqueante        TEXT NOT NULL DEFAULT '',
  categoria         TEXT NOT NULL DEFAULT '',
  nota              TEXT NOT NULL DEFAULT '',
  jira              TEXT NOT NULL DEFAULT '',
  msd               TEXT NOT NULL DEFAULT '',
  esp_tecnica       TEXT NOT NULL DEFAULT '',
  esp_funcional     TEXT NOT NULL DEFAULT '',
  evidencia         TEXT NOT NULL DEFAULT '',
  sin_entregable    INTEGER NOT NULL DEFAULT 0,
  observaciones     TEXT NOT NULL DEFAULT '',
  entregable        TEXT NOT NULL DEFAULT '',
  interno           INTEGER NOT NULL DEFAULT 0,
  descripcion_tarea TEXT NOT NULL DEFAULT '',
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_entries_owner_project ON entries(owner_email, project_id);
CREATE INDEX IF NOT EXISTS idx_entries_parent ON entries(parent_id);

CREATE TABLE IF NOT EXISTS audit (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp   TEXT NOT NULL,
  usuario     TEXT NOT NULL,
  accion      TEXT NOT NULL,
  tipo        TEXT NOT NULL DEFAULT '',
  id_registro TEXT NOT NULL DEFAULT '',
  detalle     TEXT NOT NULL DEFAULT ''
);
`;

function migrarPerfiles(db) {
  const fila = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get();
  const sql = fila?.sql || '';
  if (!sql.includes("'Líder'") && !sql.includes("'Colaborador'")) return;

  db.exec(`
    PRAGMA foreign_keys = OFF;
    DROP TABLE IF EXISTS users_migracion;
    BEGIN TRANSACTION;
    CREATE TABLE users_migracion (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
      email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL CHECK (role IN ('Administrador', 'Usuario')),
      activo        INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO users_migracion (id, username, email, password_hash, role, activo, created_at)
      SELECT id, username, email, password_hash,
             CASE WHEN role = 'Líder' THEN 'Administrador' ELSE 'Usuario' END,
             activo, created_at
        FROM users;
    DROP TABLE users;
    ALTER TABLE users_migracion RENAME TO users;
    COMMIT;
    PRAGMA foreign_keys = ON;
  `);
}

function migrarAsignaciones(db) {
  const columnas = db.prepare('PRAGMA table_info(assignments)').all();
  if (!columnas.some((c) => c.name === 'rol')) {
    db.exec("ALTER TABLE assignments ADD COLUMN rol TEXT NOT NULL DEFAULT 'Colaborador'");
  }
  db.exec(`
    UPDATE assignments
       SET rol = 'Líder'
     WHERE email IN (SELECT lider_email FROM projects WHERE lider_email <> '');
  `);
}

function migrarNombre(db) {
  const columnas = db.prepare('PRAGMA table_info(users)').all();
  if (!columnas.some((c) => c.name === 'nombre')) {
    db.exec("ALTER TABLE users ADD COLUMN nombre TEXT NOT NULL DEFAULT ''");
  }
  db.exec(`
    UPDATE users
       SET nombre = CASE WHEN instr(email, '@') > 0
                         THEN substr(email, 1, instr(email, '@') - 1)
                         ELSE email END
     WHERE nombre IS NULL OR nombre = '';
  `);
}

function seedAdmin(db) {
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (existing) return;
  db.prepare(
    'INSERT INTO users (username, email, nombre, password_hash, role) VALUES (?, ?, ?, ?, ?)'
  ).run('admin', 'admin@optimia.local', 'Administrador', hashPassword('admin'), 'Administrador');
}

function rutaDb() {
  return path.join(process.cwd(), 'data', path.basename(process.env.SQLITE_PATH || 'optimia.sqlite'));
}

function adaptarSqlite(db) {
  return Object.assign(db, {
    get(sql, ...params) {
      return db.prepare(sql).get(...params);
    },
    all(sql, ...params) {
      return db.prepare(sql).all(...params);
    },
    run(sql, ...params) {
      return db.prepare(sql).run(...params);
    },
  });
}

export function getDb() {
  if (globalThis.__optimiaDb) return adaptarSqlite(globalThis.__optimiaDb);

  const file = rutaDb();
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  migrarPerfiles(db);
  migrarNombre(db);
  migrarAsignaciones(db);
  seedAdmin(db);
  globalThis.__optimiaDb = adaptarSqlite(db);
  return globalThis.__optimiaDb;
}

export function getReadOnlyDb() {
  return adaptarSqlite(new DatabaseSync(rutaDb(), { readOnly: true }));
}
