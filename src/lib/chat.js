import { getDb, getReadOnlyDb } from './db.js';
import { esLiderDelProyecto } from './permissions.js';
import { todayBogota } from './utils.js';
import {
  ANSWER_SYSTEM_INSTRUCTION,
  SQL_SYSTEM_INSTRUCTION,
  extraerSql,
  validarSql,
} from './sqlGovernance.js';

const REGION = 'us-east-1';
const MODEL = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';
const FALLBACK_MODEL = 'us.anthropic.claude-3-5-haiku-20241022-v1:0';

async function construirDirectorio(projectId) {
  const db = await getDb();
  const filas = await db.all(
    `SELECT a.email, COALESCE(NULLIF(TRIM(u.nombre), ''), '') AS nombre
       FROM assignments a
       LEFT JOIN users u ON u.email = a.email
      WHERE a.proyecto_id = ?
      ORDER BY nombre, a.email`,
    String(projectId)
  );

  const directorio = filas.map((f) => {
    const correo = String(f.email || '');
    const nombre = String(f.nombre || '').trim() || correo.split('@')[0] || correo;
    return `${correo} -> ${nombre}`;
  });
  return directorio.length ? directorio.join('\n') : 'No hay colaboradores asignados.';
}

function invocarEndpoint(modelId, apiKey, requestBody) {
  const url = `https://bedrock-runtime.${REGION}.amazonaws.com/model/${encodeURIComponent(modelId)}/converse`;
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(requestBody),
  }).then(async (res) => ({ status: res.status, rawText: await res.text() }));
}

async function invocarModelo(apiKey, system, texto, maxTokens) {
  const requestBody = {
    system: [{ text: system }],
    messages: [{ role: 'user', content: [{ text: texto }] }],
    inferenceConfig: { maxTokens },
  };

  let { status, rawText } = await invocarEndpoint(MODEL, apiKey, requestBody);
  if ((status === 400 || status === 404) && FALLBACK_MODEL !== MODEL) {
    ({ status, rawText } = await invocarEndpoint(FALLBACK_MODEL, apiKey, requestBody));
  }
  if (status < 200 || status >= 300) throw new Error(`Error Bedrock (${status}): ${rawText}`);

  const data = JSON.parse(rawText);
  const respuesta = data?.output?.message?.content?.[0]?.text;
  if (!respuesta) throw new Error('Sin respuesta del modelo.');
  return String(respuesta);
}

async function ejecutarSqlSeguro(consulta, projectId) {
  const parametros = { projectId: String(projectId) };
  if (consulta.includes(':hoy')) parametros.hoy = todayBogota();

  const db = await getReadOnlyDb();
  try {
    return await db.all(consulta, parametros);
  } finally {
    await db.close();
  }
}

function limitarResultados(filas) {
  return filas.map((fila) => Object.fromEntries(
    Object.entries(fila).map(([columna, valor]) => [
      columna,
      typeof valor === 'string' && valor.length > 1500 ? `${valor.slice(0, 1500)}…` : valor,
    ])
  ));
}

function limpiarRespuestaHtml(texto) {
  return String(texto || '')
    .replace(/^```html\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .trim();
}

export async function consultarChatLiderBedrock(payload, user) {
  const projectId = String(payload?.projectId || '').trim();
  if (!(await esLiderDelProyecto(user, projectId))) {
    return { success: false, error: 'Acceso denegado: este chat está habilitado únicamente para líderes del proyecto seleccionado.' };
  }

  const pregunta = String(payload?.question || '').trim();
  const projectName = String(payload?.projectName || '').trim();
  if (!pregunta) return { success: false, error: 'Por favor escribe una pregunta.' };
  if (!projectId) return { success: false, error: 'Selecciona un proyecto válido.' };

  const apiKey = process.env.AWS_BEARER_TOKEN_BEDROCK || '';
  if (!apiKey) {
    return { success: false, error: 'Falta configurar AWS_BEARER_TOKEN_BEDROCK en el archivo .env local.' };
  }

  try {
    const directorio = await construirDirectorio(projectId);
    const sqlCrudo = await invocarModelo(
      apiKey,
      SQL_SYSTEM_INSTRUCTION,
      `PROYECTO: ${projectName || projectId}\nPREGUNTA DEL LÍDER: ${pregunta}\n\nDevuelve solo el SQL.`,
      400
    );
    const consulta = validarSql(extraerSql(sqlCrudo), projectId);
    const filas = limitarResultados(await ejecutarSqlSeguro(consulta, projectId));

    const respuestaCruda = await invocarModelo(
      apiKey,
      ANSWER_SYSTEM_INSTRUCTION,
      `PREGUNTA ORIGINAL:\n${pregunta}\n\nDIRECTORIO SEGURO (solo para mostrar nombres, no es una tabla consultable):\n${directorio}\n\nRESULTADOS SQL (${filas.length} filas):\n${JSON.stringify(filas)}`,
      900
    );

    return { success: true, answer: limpiarRespuestaHtml(respuestaCruda) };
  } catch (e) {
    return { success: false, error: `No pude responder con la información del proyecto: ${e.message}` };
  }
}
