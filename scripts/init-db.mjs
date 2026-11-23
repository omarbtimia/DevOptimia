import { initDb } from '../src/lib/db.js';
import { usarAurora } from '../src/lib/dsql.js';

await initDb();
console.log(usarAurora() ? 'Conexión Aurora DSQL verificada.' : 'Base de datos SQLite lista.');
