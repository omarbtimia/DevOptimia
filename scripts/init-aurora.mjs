import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDsqlPool } from '../src/lib/dsql.js';
import { PgAdapter } from '../src/lib/dbAdapter.js';
import { hashPassword } from '../src/lib/crypto.js';
import {
  aplicarGrants,
  asegurarBaseline,
  asegurarTablasControl,
  actualizarEstadoEsquema,
  checksumContenido,
  dividirSql,
  ejecutarSql,
  obtenerEstadoEsquema,
} from './lib/aurora.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lectura = validarRol(process.env.AURORA_DSQL_READ_USER || 'optimia_read', 'AURORA_DSQL_READ_USER');
const crud = validarRol(process.env.AURORA_DSQL_CRUD_USER || 'optimia_crud', 'AURORA_DSQL_CRUD_USER');

function validarRol(rol, nombre) {
  const valor = String(rol || '').trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(valor)) {
    throw new Error(`${nombre} no es un nombre de rol DB válido.`);
  }
  return valor;
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
  if (!existe) await ejecutarSql(db, `CREATE ROLE ${rol} WITH LOGIN`);
}

async function mapearIamSiFalta(db, rol, arn) {
  const existe = await db.get(
    'SELECT 1 AS ok FROM sys.iam_pg_role_mappings WHERE pg_role_name = ? AND arn = ?',
    rol,
    arn
  );
  if (!existe) await ejecutarSql(db, `AWS IAM GRANT ${rol} TO '${arn}'`);
}

async function sembrarAdmin(db) {
  const existe = await db.get('SELECT id FROM users WHERE username = ?', 'admin');
  if (existe) return;
  await ejecutarSql(
    db,
    'INSERT INTO users (username, email, nombre, password_hash, role) VALUES (?, ?, ?, ?, ?)',
    ['admin', 'admin@optimia.local', 'Administrador', hashPassword('admin'), 'Administrador']
  );
}

async function main() {
  const arnLectura = validarArn(process.env.AURORA_DSQL_READ_IAM_ROLE_ARN, 'AURORA_DSQL_READ_IAM_ROLE_ARN');
  const arnCrud = validarArn(process.env.AURORA_DSQL_CRUD_IAM_ROLE_ARN, 'AURORA_DSQL_CRUD_IAM_ROLE_ARN');
  const esquema = readFileSync(path.join(root, 'db', 'aurora-schema.sql'), 'utf8');
  const pool = getDsqlPool('admin');
  const db = new PgAdapter(pool);

  try {
    for (const sentencia of dividirSql(esquema)) await ejecutarSql(db, sentencia);
    await asegurarTablasControl(db);
    const checksum = checksumContenido(esquema);
    await asegurarBaseline(db, checksum);
    if (!(await obtenerEstadoEsquema(db))) await actualizarEstadoEsquema(db, checksum);
    await sembrarAdmin(db);
    await crearRolSiFalta(db, lectura);
    await crearRolSiFalta(db, crud);
    await mapearIamSiFalta(db, lectura, arnLectura);
    await mapearIamSiFalta(db, crud, arnCrud);
    await aplicarGrants(db, lectura, crud);
    console.log('Esquema, estado y roles de Aurora DSQL aplicados.');
  } finally {
    await pool.end();
  }
}

try {
  await main();
} catch (error) {
  console.error(`[ERROR] ${error?.message || error}`);
  process.exitCode = 1;
}
