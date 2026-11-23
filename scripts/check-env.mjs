import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const archivos = ['.env', '.env.local', '.env.production'];

const obligatorias = [
  ['GOOGLE_CLIENT_ID', 'Cliente OAuth 2.0 de Google'],
  ['GOOGLE_CLIENT_SECRET', 'Secreto OAuth 2.0 de Google'],
  ['GOOGLE_REDIRECT_URI', 'URI de retorno autorizada en Google'],
];

const opcionales = [
  ['SQLITE_PATH', 'Archivo SQLite (usa optimia.sqlite si falta)'],
  ['AWS_BEARER_TOKEN_BEDROCK', 'Token del chat Morgan'],
];

function leerArchivo(nombre) {
  const ruta = path.join(root, nombre);
  if (!existsSync(ruta)) return {};

  const resultado = {};
  for (const linea of readFileSync(ruta, 'utf8').split(/\r?\n/)) {
    const texto = linea.trim();
    if (!texto || texto.startsWith('#')) continue;
    const separador = texto.indexOf('=');
    if (separador === -1) continue;

    const clave = texto.slice(0, separador).trim().replace(/^export\s+/, '');
    let valor = texto.slice(separador + 1).trim();
    if (
      (valor.startsWith('"') && valor.endsWith('"')) ||
      (valor.startsWith("'") && valor.endsWith("'"))
    ) {
      valor = valor.slice(1, -1);
    }
    resultado[clave] = valor;
  }
  return resultado;
}

function valorDe(nombre, archivosLeidos) {
  if (process.env[nombre] !== undefined && String(process.env[nombre]).trim()) {
    return String(process.env[nombre]).trim();
  }
  for (const valores of archivosLeidos) {
    if (valores[nombre] !== undefined && String(valores[nombre]).trim()) {
      return String(valores[nombre]).trim();
    }
  }
  return '';
}

function esMarcador(valor) {
  return /^(?:\.\.\.|<.*>|pega[-\s].*|cambiar.*|placeholder|xxx+)$/i.test(valor);
}

function informada(valor) {
  return Boolean(valor) && !esMarcador(valor);
}

const archivosLeidos = archivos.map(leerArchivo);
const faltan = [];

console.log('Verificación de variables de entorno');
console.log('Solo se muestran nombres y estado; nunca los valores.\n');

for (const [nombre, descripcion] of obligatorias) {
  const valor = valorDe(nombre, archivosLeidos);
  const ok = informada(valor);
  if (!ok) faltan.push(nombre);
  console.log(`[${ok ? 'OK' : 'FALTA'}] ${nombre.padEnd(26)} ${descripcion}`);
}

for (const [nombre, descripcion] of opcionales) {
  const valor = valorDe(nombre, archivosLeidos);
  const estado = informada(valor) ? 'OK' : 'OPCIONAL';
  console.log(`[${estado}] ${nombre.padEnd(26)} ${descripcion}`);
}

if (faltan.length) {
  console.log(`\nFaltan ${faltan.length} variable(s) obligatoria(s): ${faltan.join(', ')}`);
  console.log('Configúralas en .env.local, en Amplify o en GitHub Actions Secrets/Variables.');
  process.exitCode = 1;
} else {
  console.log('\nTodas las variables obligatorias están informadas.');
}
