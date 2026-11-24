import { getDsqlPool } from '../src/lib/dsql.js';
import { PgAdapter } from '../src/lib/dbAdapter.js';

async function main() {
  const pool = getDsqlPool('crud');
  const db = new PgAdapter(pool);
  try {
    await db.get('SELECT 1 AS ok');
    console.log('Conexión Aurora DSQL verificada.');
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
