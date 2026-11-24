import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDsqlPool } from '../src/lib/dsql.js';
import { PgAdapter } from '../src/lib/dbAdapter.js';
import {
  asegurarBaseline,
  asegurarTablasControl,
  actualizarEstadoEsquema,
  dividirSql,
  ejecutarSql,
  leerMigraciones,
  obtenerAplicadas,
  obtenerEstadoEsquema,
  registrarAplicada,
  checksumContenido,
} from './lib/aurora.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modoEstado = process.argv.includes('--status');
const permitirDestructivas = process.env.AURORA_ALLOW_DESTRUCTIVE === '1';

async function main() {
  const esquema = readFileSync(path.join(root, 'db', 'aurora-schema.sql'), 'utf8');
  const checksumEsquema = checksumContenido(esquema);
  const migraciones = leerMigraciones(root);
  const db = new PgAdapter(getDsqlPool('admin'));

  try {
    if (modoEstado) {
      const aplicadas = await obtenerAplicadas(db);
      console.log('Estado de migraciones Aurora DSQL');
      for (const version of [...aplicadas.keys()].sort()) console.log(`[APLICADA] ${version}`);
      for (const migracion of migraciones) {
        const estado = aplicadas.has(migracion.version) ? 'APLICADA' : 'PENDIENTE';
        console.log(`[${estado}] ${migracion.version} ${migracion.ruta}`);
      }
      const estadoEsquema = await obtenerEstadoEsquema(db);
      if (estadoEsquema === null) console.log('[ESQUEMA] sin estado');
      else console.log(estadoEsquema === checksumEsquema ? '[ESQUEMA] actualizado' : '[ESQUEMA] desactualizado');
      return;
    }

    await asegurarTablasControl(db);
    await asegurarBaseline(db, checksumEsquema);

    const aplicadas = await obtenerAplicadas(db);
    const pendientes = migraciones.filter((migracion) => !aplicadas.has(migracion.version));

    for (const migracion of migraciones) {
      const checksumAplicado = aplicadas.get(migracion.version);
      if (checksumAplicado && checksumAplicado !== migracion.checksum) {
        throw new Error(`${migracion.ruta} cambió después de aplicarse; crea una nueva migración.`);
      }
    }

    const estadoEsquema = await obtenerEstadoEsquema(db);
    if (estadoEsquema && estadoEsquema !== checksumEsquema && pendientes.length === 0) {
      throw new Error('db/aurora-schema.sql cambió sin una migración nueva.');
    }

    for (const migracion of pendientes) {
      if (migracion.patronDestructivo && !migracion.marcadorDestructivo) {
        throw new Error(`${migracion.ruta} contiene DDL destructivo; agrega -- @destructive.`);
      }
      if (migracion.marcadorDestructivo && !permitirDestructivas) {
        throw new Error(`${migracion.ruta} es destructiva; ejecuta con AURORA_ALLOW_DESTRUCTIVE=1.`);
      }
      console.log(`[APLICANDO] ${migracion.version} ${migracion.ruta}`);
      for (const sentencia of dividirSql(migracion.contenido)) await ejecutarSql(db, sentencia);
      await registrarAplicada(db, migracion.version, migracion.ruta, migracion.checksum);
      console.log(`[APLICADA] ${migracion.version} ${migracion.ruta}`);
    }

    await actualizarEstadoEsquema(db, checksumEsquema);
    console.log(pendientes.length ? `[OK] ${pendientes.length} migración(es) aplicadas.` : '[OK] No hay migraciones pendientes.');
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
