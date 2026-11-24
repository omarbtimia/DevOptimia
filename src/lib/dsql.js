import { DsqlSigner } from '@aws-sdk/dsql-signer';
import pg from 'pg';

const { Pool } = pg;
const pools = new Map();
const tokens = new Map();

function regionFromHost(host) {
  const match = String(host || '').match(/\.dsql\.([^.]+)\.on\.aws/i);
  return match?.[1] || '';
}

function hostLimpio(value) {
  return String(value || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

export function configDsql(tipo = 'crud') {
  const host = hostLimpio(process.env.AURORA_DSQL_HOST);
  if (!host) throw new Error('Falta AURORA_DSQL_HOST para usar Aurora DSQL.');

  const region = String(process.env.AURORA_DSQL_REGION || process.env.AWS_REGION || regionFromHost(host)).trim();
  if (!region) throw new Error('Falta AURORA_DSQL_REGION para usar Aurora DSQL.');

  const usuarios = {
    admin: 'admin',
    crud: process.env.AURORA_DSQL_CRUD_USER || 'optimia_crud',
    read: process.env.AURORA_DSQL_READ_USER || 'optimia_read',
  };

  return {
    host,
    region,
    port: Number(process.env.AURORA_DSQL_PORT || 5432),
    database: process.env.AURORA_DSQL_DATABASE || 'postgres',
    user: usuarios[tipo] || usuarios.crud,
    admin: tipo === 'admin',
  };
}

function proveedorToken(config) {
  const clave = `${config.host}:${config.region}:${config.user}:${config.admin ? 'admin' : 'db'}`;
  if (tokens.has(clave)) return tokens.get(clave);

  const vencimiento = Math.max(60, Number(process.env.AURORA_DSQL_TOKEN_EXPIRES_IN || 900));
  const renovarCada = Math.min(
    vencimiento - 60,
    Math.max(30, Number(process.env.AURORA_DSQL_TOKEN_TTL || 780))
  );
  const signer = new DsqlSigner({
    hostname: config.host,
    region: config.region,
    expiresIn: vencimiento,
  });

  let cache = null;
  const proveedor = async () => {
    const ahora = Date.now();
    if (cache && ahora < cache.hasta) return cache.token;
    const token = config.admin
      ? await signer.getDbConnectAdminAuthToken()
      : await signer.getDbConnectAuthToken();
    cache = { token, hasta: ahora + renovarCada * 1000 };
    return token;
  };

  tokens.set(clave, proveedor);
  return proveedor;
}

export function getDsqlPool(tipo = 'crud') {
  const config = configDsql(tipo);
  if (pools.has(config.user)) return pools.get(config.user);

  const pool = new Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    ssl: { rejectUnauthorized: true },
    max: Number(process.env.AURORA_DSQL_POOL_MAX || 8),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    maxLifetimeSeconds: 55 * 60,
    password: proveedorToken(config),
  });
  pool.on('error', () => {});

  pools.set(config.user, pool);
  return pool;
}
