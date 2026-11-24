import { initDb } from '../src/lib/db.js';

await initDb();
console.log('Conexión Aurora DSQL verificada.');
