import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

function esSoloComentario(texto) {
  return texto.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim() === '';
}

export function dividirSql(contenido) {
  const sentencias = [];
  let actual = '';
  let comilla = null;
  let etiquetaDolar = null;
  let bloque = false;
  let linea = false;

  for (let i = 0; i < contenido.length; i += 1) {
    const caracter = contenido[i];
    const siguiente = contenido[i + 1];

    if (linea) {
      actual += caracter;
      if (caracter === '\n') linea = false;
      continue;
    }

    if (bloque) {
      actual += caracter;
      if (caracter === '*' && siguiente === '/') {
        actual += siguiente;
        i += 1;
        bloque = false;
      }
      continue;
    }

    if (comilla) {
      actual += caracter;
      if (caracter === '\\' && siguiente !== undefined) {
        actual += siguiente;
        i += 1;
        continue;
      }
      if (caracter === comilla) comilla = null;
      continue;
    }

    if (etiquetaDolar) {
      actual += caracter;
      if (contenido.startsWith(etiquetaDolar, i)) {
        actual += etiquetaDolar.slice(1);
        i += etiquetaDolar.length - 1;
        etiquetaDolar = null;
      }
      continue;
    }

    if (caracter === '-' && siguiente === '-') {
      actual += caracter + siguiente;
      i += 1;
      linea = true;
      continue;
    }

    if (caracter === '/' && siguiente === '*') {
      actual += caracter + siguiente;
      i += 1;
      bloque = true;
      continue;
    }

    if (caracter === "'" || caracter === '"') {
      comilla = caracter;
      actual += caracter;
      continue;
    }

    if (caracter === '$') {
      const etiqueta = contenido.slice(i).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
      if (etiqueta) {
        etiquetaDolar = etiqueta[0];
        actual += etiquetaDolar;
        i += etiquetaDolar.length - 1;
        continue;
      }
    }

    if (caracter === ';') {
      if (!esSoloComentario(actual)) sentencias.push(actual.trim());
      actual = '';
      continue;
    }

    actual += caracter;
  }

  if (!esSoloComentario(actual) && actual.trim()) sentencias.push(actual.trim());
  return sentencias;
}

export function checksumContenido(contenido) {
  return createHash('sha256').update(String(contenido).replace(/\r\n/g, '\n')).digest('hex');
}

export function tieneMarcadorDestructivo(contenido) {
  return /^\s*--\s*@destructive\b/im.test(String(contenido));
}

export function esDestructivo(contenido) {
  return /\b(DROP|TRUNCATE|RENAME)\b|\bALTER\s+COLUMN\b[\s\S]*?\bTYPE\b|\bSET\s+NOT\s+NULL\b/i.test(String(contenido));
}

export function leerMigraciones(root) {
  const directorio = path.join(root, 'db', 'migrations');
  if (!existsSync(directorio)) return [];

  return readdirSync(directorio)
    .filter((archivo) => archivo.endsWith('.sql'))
    .sort()
    .map((archivo) => {
      const version = archivo.match(/^(\d{4,})_/)?.[1];
      if (!version) throw new Error(`Nombre de migración inválido: ${archivo}`);
      const contenido = readFileSync(path.join(directorio, archivo), 'utf8');
      return {
        version,
        archivo,
        ruta: path.posix.join('db', 'migrations', archivo),
        contenido,
        checksum: checksumContenido(contenido),
        marcadorDestructivo: tieneMarcadorDestructivo(contenido),
        patronDestructivo: esDestructivo(contenido),
      };
    });
}

function esOcc(error) {
  return error?.code === '40001' || /OC001|schema has been updated/i.test(String(error?.message || ''));
}

function esperar(ms) {
  return new Promise((resolver) => setTimeout(resolver, ms));
}

async function conReintentos(operacion) {
  for (let intento = 1; intento <= 5; intento += 1) {
    try {
      return await operacion();
    } catch (error) {
      if (!esOcc(error) || intento === 5) throw error;
      await esperar(200 * 2 ** (intento - 1));
    }
  }
  return undefined;
}

async function esperarIndice(db, jobId) {
  const filas = await conReintentos(async () => {
    try {
      return await db.all('CALL sys.wait_for_job(?)', [jobId]);
    } catch (error) {
      if (!/42809|sys\.wait_for_job|procedure/i.test(String(error?.message || ''))) throw error;
      return db.all('SELECT sys.wait_for_job(?) AS ok', [jobId]);
    }
  });
  const fila = filas[0] || {};
  const exito = fila.succeeded ?? fila.ok ?? fila.wait_for_job;
  if (exito === false) {
    const estado = await db.get('SELECT status, details FROM sys.jobs WHERE job_id = ?', jobId);
    throw new Error(`Índice asíncrono ${jobId} falló: ${estado?.details || estado?.status || 'sin detalle'}`);
  }
}

export async function ejecutarSql(db, sql, valores = []) {
  return conReintentos(async () => {
    const resultado = await db.all(sql, valores);
    if (/^\s*CREATE\s+(?:UNIQUE\s+)?INDEX\s+ASYNC\b/i.test(sql)) {
      const jobId = resultado?.[0]?.job_id;
      if (jobId) await esperarIndice(db, jobId);
    }
    return resultado;
  });
}

export async function tablaExiste(db, nombre) {
  const fila = await conReintentos(() => db.get(
    'SELECT 1 AS ok FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ?',
    nombre
  ));
  return Boolean(fila);
}

export async function asegurarTablasControl(db) {
  const sentencias = [
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      applied_by TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS schema_state (
      id TEXT PRIMARY KEY,
      schema_checksum TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  ];
  for (const sentencia of sentencias) await ejecutarSql(db, sentencia);
}

export async function obtenerAplicadas(db) {
  if (!(await tablaExiste(db, 'schema_migrations'))) return new Map();
  const filas = await conReintentos(() => db.all('SELECT version, checksum FROM schema_migrations'));
  return new Map(filas.map((fila) => [fila.version, fila.checksum]));
}

export async function obtenerEstadoEsquema(db) {
  if (!(await tablaExiste(db, 'schema_state'))) return null;
  const fila = await conReintentos(() => db.get('SELECT schema_checksum FROM schema_state WHERE id = ?', 'current'));
  return fila?.schema_checksum ?? null;
}

export async function registrarAplicada(db, version, archivo, checksum) {
  await ejecutarSql(
    db,
    'INSERT INTO schema_migrations (version, filename, checksum, applied_by) VALUES (?, ?, ?, CURRENT_USER)',
    [version, archivo, checksum]
  );
}

export async function actualizarEstadoEsquema(db, checksum) {
  await ejecutarSql(
    db,
    `INSERT INTO schema_state (id, schema_checksum) VALUES ('current', ?)
     ON CONFLICT (id) DO UPDATE SET schema_checksum = EXCLUDED.schema_checksum, updated_at = CURRENT_TIMESTAMP`,
    [checksum]
  );
}

export async function asegurarBaseline(db, checksum) {
  const aplicadas = await obtenerAplicadas(db);
  if (aplicadas.has('0001_baseline') || !(await tablaExiste(db, 'users'))) return false;
  await registrarAplicada(db, '0001_baseline', 'db/aurora-schema.sql', checksum);
  return true;
}

export async function aplicarGrants(db, lectura, crud) {
  const sentencias = [
    `GRANT USAGE ON SCHEMA public TO ${lectura}`,
    `GRANT USAGE ON SCHEMA public TO ${crud}`,
    `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${lectura}`,
    `GRANT SELECT ON projects, categories, assignments, entries TO ${lectura}`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${crud}`,
  ];
  for (const sentencia of sentencias) await ejecutarSql(db, sentencia);
}
