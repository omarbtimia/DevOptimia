import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDsqlPool } from '../src/lib/dsql.js';
import { PgAdapter } from '../src/lib/dbAdapter.js';
import { hashPassword } from '../src/lib/crypto.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LECTURA = process.env.AURORA_DSQL_READ_USER || 'optimia_read';
const CRUD = process.env.AURORA_DSQL_CRUD_USER || 'optimia_crud';

function dividirSql(contenido) {
  return contenido
    .split(';')
    .map((bloque) => bloque.trim())
    .filter(Boolean);
}

function validarArn(arn, nombre) {
  const valor = String(arn || '').trim();
  if (!/^arn:aws:iam::\d{12}:role\/[\w+=,.@/-]+$/.test(valor)) {
    throw new Error(`${nombre} no es un ARN de rol IAM de AWS válido.`);
  }
  return valor;
}

async function crearRolSiFalta(db, rol) {
  const existe = await db.get('SELECT 1 AS ok FROM pg_roles WHERE rolname = ?', rol);
  if (!existe) await db.exec(`CREATE ROLE ${rol} WITH LOGIN`);
}

async function mapearIamSiFalta(db, rol, arn) {
  const existe = await db.get(
    'SELECT 1 AS ok FROM sys.iam_pg_role_mappings WHERE pg_role_name = ? AND arn = ?',
    rol, arn
  );
  if (!existe) await db.exec(`AWS IAM GRANT ${rol} TO '${arn}'`);
}

async function sembrarAdmin(db) {
  const existe = await db.get('SELECT id FROM users WHERE username = ?', 'admin');
  if (existe) return;
  await db.run(
    'INSERT INTO users (username, email, nombre, password_hash, role) VALUES (?, ?, ?, ?, ?)',
    'admin', 'admin@optimia.local', 'Administrador', hashPassword('admin'), 'Administrador'
  );
}

const arnLectura = validarArn(process.env.AURORA_DSQL_READ_IAM_ROLE_ARN, 'AURORA_DSQL_READ_IAM_ROLE_ARN');
const arnCrud = validarArn(process.env.AURORA_DSQL_CRUD_IAM_ROLE_ARN, 'AURORA_DSQL_CRUD_IAM_ROLE_ARN');
const pool = getDsqlPool('admin');
const db = new PgAdapter(pool);

try {
  const esquema = readFileSync(path.join(ROOT, 'db', 'aurora-schema.sql'), 'utf8');
  for (const sentencia of dividirSql(esquema)) await db.exec(sentencia);

  await sembrarAdmin(db);

  await crearRolSiFalta(db, LECTURA);
  await crearRolSiFalta(db, CRUD);
  await mapearIamSiFalta(db, LECTURA, arnLectura);
  await mapearIamSiFalta(db, CRUD, arnCrud);

  await db.exec('GRANT USAGE ON SCHEMA public TO ' + LECTURA);
  await db.exec('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ' + LECTURA);
  await db.exec('GRANT SELECT ON projects, categories, assignments, entries TO ' + LECTURA);

  await db.exec('GRANT USAGE ON SCHEMA public TO ' + CRUD);
  await db.exec('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ' + CRUD);

  console.log('Esquema y roles de Aurora DSQL aplicados.');
} finally {
  await pool.end();
}
