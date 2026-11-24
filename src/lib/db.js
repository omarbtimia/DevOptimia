import { PgAdapter } from './dbAdapter.js';
import { getDsqlPool } from './dsql.js';

function crearAdapter(tipo) {
  return new PgAdapter(getDsqlPool(tipo));
}

export function getDb() {
  if (!globalThis.__optimiaDbPromise) {
    globalThis.__optimiaDbPromise = Promise.resolve(crearAdapter('crud')).catch((error) => {
      delete globalThis.__optimiaDbPromise;
      throw error;
    });
  }
  return globalThis.__optimiaDbPromise;
}

export async function getReadOnlyDb() {
  return crearAdapter('read');
}

export async function initDb() {
  const db = await getDb();
  await db.get('SELECT 1 AS ok');
  return db;
}
