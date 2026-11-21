import { allowedCollaborators, fetchEntriesData } from './entries.js';
import { esLiderDelProyecto } from './permissions.js';
import { todayBogota } from './utils.js';

const REGION = 'us-east-1';
const MODEL = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';
const FALLBACK_MODEL = 'us.anthropic.claude-3-5-haiku-20241022-v1:0';

const SYSTEM_INSTRUCTION = [
  'Eres Morgan, el asistente y buscador exclusivo del proyecto seleccionado en Optimia.',
  'REGLAS OBLIGATORIAS:',
  '1. RESTRICCIÓN AL PROYECTO ACTUAL: Responde ÚNICAMENTE con los datos del proyecto incluidos en el contexto (que contiene todo lo registrado por cada colaborador sin importar fechas). Si preguntan sobre temas generales o ajenos al proyecto, responde exactamente: "Solo puedo responder consultas sobre la información registrada en el proyecto seleccionado."',
  '2. RESPETO ESTRICTO POR LOS ESTADOS: Ten siempre presente el Estado de cada elemento (No iniciado, En proceso, Detenido, Completado). Si piden cosas "activas" o "abiertas", muestra SOLO lo que NO esté en estado Completado. Si buscan una palabra o quién hizo algo, muestra todas las coincidencias indicando claramente su Estado actual y quién la realizó (correo del colaborador).',
  '3. PROHIBIDO USAR CÓDIGOS GENÉRICOS: NUNCA escribas "TAREA 1", "TAREA-ss" ni numeraciones artificiales. Escribe SIEMPRE el nombre real de la Tarea, el nombre real de la Subtarea y la descripción de la Actividad.',
  '4. FORMATO HTML LIMPIO Y CORTO: Sé muy claro, corto y directo. Responde usando HTML limpio (<ul>, <li>, <strong>, <em>, <br>, <p>) para listas y jerarquías. NO envuelvas la respuesta en bloques ```html ni uses sintaxis Markdown (** o #).',
].join('\n');

function limpiarHtmlATexto(html) {
  if (!html) return '';
  return String(html)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatearObservacionesContexto(obs) {
  if (!obs) return '';
  return String(obs)
    .split('homoplato')
    .map((p) => p.trim())
    .filter(Boolean)
    .join(' | ');
}

function calcularInfoAtrasoBackend(av) {
  if (!av || av.estado === 'Completado' || av.estado === 'Eliminada' || !av.fechaInicio) {
    return { enAtraso: false, diasAtraso: 0, ultimaRef: '' };
  }
  const hoyStr = todayBogota();
  const partes = String(av.observaciones || '').split('homoplato').map((e) => e.trim()).filter(Boolean);
  let ultimaFechaRef = String(av.fechaInicio).trim();
  partes.forEach((p) => {
    const m = p.match(/^\[(\d{4}-\d{2}-\d{2})\]::([\s\S]*)$/);
    if (m && m[1]) ultimaFechaRef = m[1];
  });

  const d1 = new Date(`${ultimaFechaRef}T00:00:00`);
  const d2 = new Date(`${hoyStr}T00:00:00`);
  if (Number.isNaN(d1.getTime()) || Number.isNaN(d2.getTime())) {
    return { enAtraso: false, diasAtraso: 0, ultimaRef: ultimaFechaRef };
  }
  const dias = Math.floor((d2.getTime() - d1.getTime()) / 86400000);
  return { enAtraso: dias >= 7, diasAtraso: dias, ultimaRef: ultimaFechaRef };
}

export function buildProjectContext(projectId, projectName) {
  const colaboradores = [...(allowedCollaborators(projectId) || new Set())].sort();
  let entries = [];
  colaboradores.forEach((email) => {
    entries = entries.concat(fetchEntriesData(email, projectId));
  });
  entries = entries.filter((e) => e.estado !== 'Eliminada');

  const lineas = [
    `PROYECTO SELECCIONADO: ${projectName || projectId}`,
    `FECHA ACTUAL: ${todayBogota()}`,
    `COLABORADORES ASIGNADOS: ${colaboradores.length ? colaboradores.join(', ') : 'Ninguno'}`,
    '',
  ];

  const generales = entries.filter((e) => e.tipo === 'General');
  if (generales.length) {
    lineas.push('=== INFORMACIÓN GENERAL DEL PROYECTO ===');
    generales.forEach((g) => {
      const al = limpiarHtmlATexto(g.alerta);
      const bl = limpiarHtmlATexto(g.bloqueante);
      const nt = limpiarHtmlATexto(g.nota);
      if (al) lineas.push(`- Alerta General (Colaborador: ${g.owner}): ${al}`);
      if (bl) lineas.push(`- Bloqueante General (Colaborador: ${g.owner}): ${bl}`);
      if (nt) lineas.push(`- Nota General (Colaborador: ${g.owner}): ${nt}`);
    });
    lineas.push('');
  }

  const tareas = entries.filter((e) => e.tipo === 'Tarea');
  const subtareas = entries.filter((e) => e.tipo === 'Subtarea');
  const avances = entries.filter((e) => e.tipo === 'Avance');

  lineas.push('=== REGISTRO COMPLETO DE TAREAS, SUBTAREAS Y ACTIVIDADES DEL PROYECTO ===');
  if (!tareas.length) {
    lineas.push('No hay tareas registradas en este proyecto.');
  } else {
    tareas.forEach((t) => {
      const nombreTarea = limpiarHtmlATexto(t.desc);
      const descContexto = limpiarHtmlATexto(t.descripcionTarea);
      const notaTarea = limpiarHtmlATexto(t.nota);
      const condicionTarea = t.estado !== 'Completado' ? 'ABIERTA/ACTIVA' : 'COMPLETADA';

      lineas.push(`TAREA: "${nombreTarea}" | Estado: ${t.estado} (${condicionTarea}) | Creada por: ${t.owner} | Inicio: ${t.fechaInicio || '-'}`);
      if (descContexto) lineas.push(`  Contexto de "${nombreTarea}": ${descContexto}`);
      if (notaTarea) lineas.push(`  Notas de "${nombreTarea}": ${notaTarea}`);

      const stsHijas = subtareas.filter((st) => String(st.parentId) === String(t.id));
      if (!stsHijas.length) {
        lineas.push('  (Sin subtareas registradas)');
      } else {
        stsHijas.forEach((st) => {
          const nombreSt = limpiarHtmlATexto(st.desc);
          const condicionSt = st.estado !== 'Completado' ? 'ABIERTA/ACTIVA' : 'COMPLETADA';
          const metaSt = [
            `Estado: ${st.estado} (${condicionSt})`,
            `Responsable: ${st.owner}`,
            st.jira ? `Ticket Jira: ${st.jira}` : '',
            st.msd ? `Ticket MSD: ${st.msd}` : '',
            st.espTecnica ? `Esp. Técnica: ${limpiarHtmlATexto(st.espTecnica)}` : '',
            st.espFuncional ? `Esp. Funcional: ${limpiarHtmlATexto(st.espFuncional)}` : '',
          ].filter(Boolean).join(' | ');

          lineas.push(`  SUBTAREA: "${nombreSt}" [Pertenece a Tarea: "${nombreTarea}"] (${metaSt})`);

          const avsHijos = avances.filter((av) => String(av.parentId) === String(st.id));
          if (!avsHijos.length) {
            lineas.push('    (Sin actividades registradas)');
          } else {
            avsHijos.forEach((av) => {
              const descAv = limpiarHtmlATexto(av.desc);
              const alertaAv = limpiarHtmlATexto(av.alerta);
              const bloqAv = limpiarHtmlATexto(av.bloqueante);
              const obsAv = formatearObservacionesContexto(av.observaciones);
              const infoRezago = calcularInfoAtrasoBackend(av);
              const condicionAv = av.estado !== 'Completado' ? 'ABIERTA/ACTIVA' : 'COMPLETADA';

              const detallesAv = [
                `Realizada por / Responsable: ${av.owner}`,
                `Estado: ${av.estado} (${condicionAv})`,
                `Categoría: ${av.categoria || '-'}`,
                `Inicio: ${av.fechaInicio || '-'}`,
                `Fin: ${av.fechaFin || 'En curso'}`,
                infoRezago.enAtraso
                  ? `REZAGO ACTIVO (+7 días): Sí (${infoRezago.diasAtraso} días sin avance desde ${infoRezago.ultimaRef})`
                  : 'REZAGO ACTIVO (+7 días): No',
                av.evidencia ? `Evidencia: ${av.evidencia}` : '',
                av.entregable ? `Entregable: ${av.entregable}` : '',
                alertaAv ? `Alerta: ${alertaAv}` : '',
                bloqAv ? `Bloqueante: ${bloqAv}` : '',
                obsAv ? `Observaciones: ${obsAv}` : '',
              ].filter(Boolean).join(' | ');

              lineas.push(`    * ACTIVIDAD: "${descAv}" [Tarea: "${nombreTarea}" > Subtarea: "${nombreSt}"] -> ${detallesAv}`);
            });
          }
        });
      }
      lineas.push('');
    });
  }

  return lineas.join('\n');
}

async function invocarEndpoint(modelId, apiKey, requestBody) {
  const url = `https://bedrock-runtime.${REGION}.amazonaws.com/model/${encodeURIComponent(modelId)}/converse`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(requestBody),
  });
  return { status: res.status, rawText: await res.text() };
}

export async function consultarChatLiderBedrock(payload, user) {
  const projectId = String(payload?.projectId || '').trim();
  if (!esLiderDelProyecto(user, projectId)) {
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

  const contexto = buildProjectContext(projectId, projectName);
  const requestBody = {
    system: [{ text: SYSTEM_INSTRUCTION }],
    messages: [{ role: 'user', content: [{ text: `DATOS COMPLETOS DEL PROYECTO SELECCIONADO:\n${contexto}\n\nCONSULTA O BÚSQUEDA DEL LÍDER:\n${pregunta}` }] }],
    inferenceConfig: { maxTokens: 900 },
  };

  try {
    let { status, rawText } = await invocarEndpoint(MODEL, apiKey, requestBody);
    if ((status === 400 || status === 404) && FALLBACK_MODEL !== MODEL) {
      ({ status, rawText } = await invocarEndpoint(FALLBACK_MODEL, apiKey, requestBody));
    }
    if (status < 200 || status >= 300) {
      return { success: false, error: `Error Bedrock (${status}): ${rawText}` };
    }

    const data = JSON.parse(rawText);
    const rawAnswer = data?.output?.message?.content?.[0]?.text || 'Sin respuesta del modelo.';
    const cleanHtmlAnswer = String(rawAnswer)
      .replace(/^```html\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```$/i, '')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .trim();
    return { success: true, answer: cleanHtmlAnswer };
  } catch (e) {
    return { success: false, error: `Excepción al conectar con Bedrock: ${e.message}` };
  }
}
