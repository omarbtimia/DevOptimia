import { DatabaseSync } from 'node:sqlite';
import { getDsqlPool } from './dsql.js';

function esObjeto(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function extraerParametros(args) {
  if (args.length === 0) return [];
  if (args.length === 1 && (Array.isArray(args[0]) || esObjeto(args[0]))) return args[0];
  return args;
}

function invocarSqlite(statement, metodo, parametros) {
  if (esObjeto(parametros)) return statement[metodo](parametros);
  return statement[metodo](...(Array.isArray(parametros) ? parametros : []));
}

export class SqliteAdapter {
  constructor(db) {
    this.db = db;
  }

  async all(sql, ...args) {
    return invocarSqlite(this.db.prepare(sql), 'all', extraerParametros(args));
  }

  async get(sql, ...args) {
    return invocarSqlite(this.db.prepare(sql), 'get', extraerParametros(args)) || null;
  }

  async run(sql, ...args) {
    const resultado = invocarSqlite(this.db.prepare(sql), 'run', extraerParametros(args));
    return { changes: resultado?.changes || 0 };
  }

  async exec(sql) {
    this.db.exec(sql);
  }

  async close() {
    this.db.close();
  }
}

function convertirParametrosPg(sql, parametros) {
  if (esObjeto(parametros)) {
    const nombres = [];
    const texto = sql.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_, nombre) => {
      let indice = nombres.indexOf(nombre);
      if (indice === -1) indice = nombres.push(nombre) - 1;
      return `$${indice + 1}`;
    });
    return { text: texto, values: nombres.map((nombre) => parametros[nombre]) };
  }

  const valores = Array.isArray(parametros) ? parametros : [];
  let indice = 0;
  return {
    text: sql.replace(/\?/g, () => `$${++indice}`),
    values: valores,
  };
}

export class PgAdapter {
  constructor(pool) {
    this.pool = pool;
  }

  async all(sql, ...args) {
    const { text, values } = convertirParametrosPg(sql, extraerParametros(args));
    const resultado = await this.pool.query(text, values);
    return resultado.rows;
  }

  async get(sql, ...args) {
    const filas = await this.all(sql, ...args);
    return filas[0] || null;
  }

  async run(sql, ...args) {
    const { text, values } = convertirParametrosPg(sql, extraerParametros(args));
    const resultado = await this.pool.query(text, values);
    return { changes: resultado.rowCount || 0 };
  }

  async exec(sql) {
    await this.pool.query(sql);
  }

  async close() {}
}

export function abrirSqlite(file, readOnly = false) {
  const db = readOnly ? new DatabaseSync(file, { readOnly: true }) : new DatabaseSync(file);
  if (!readOnly) db.exec('PRAGMA foreign_keys = ON;');
  return new SqliteAdapter(db);
}
