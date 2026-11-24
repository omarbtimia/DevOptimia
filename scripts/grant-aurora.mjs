import { getDsqlPool } from '../src/lib/dsql.js';
import { PgAdapter } from '../src/lib/dbAdapter.js';
import { aplicarGrants } from './lib/aurora.mjs';

const lectura = String(process.env.AURORA_DSQL_READ_USER || 'optimia_read').trim();
const crud = String(process.env.AURORA_DSQL_CRUD_USER || 'optimia_crud').trim();

function validarRol(rol, variable) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(rol)) {
    throw new Error(`${variable} no es un nombre de rol DB válido.`);
  }
  return rol;
}

async function main() {
  validarRol(lectura, 'AURORA_DSQL_READ_USER');
  validarRol(crud, 'AURORA_DSQL_CRUD_USER');

  const db = new PgAdapter(getDsqlPool('admin'));
  try {
    await aplicarGrants(db, lectura, crud);
    console.log('Permisos de Aurora DSQL aplicados.');
  } finally {
    await db.pool.end();
  }
}

try {
  await main();
} catch (error) {
  console.error(`[ERROR] ${error?.message || error}`);
  process.exitCode = 1;
}
