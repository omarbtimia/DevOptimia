export const SQL_GOVERNANCE = `
GOBIERNO DE DATOS DE OPTIMIA — SOLO LECTURA

Tablas permitidas y columnas permitidas:
- projects: id, nombre
- categories: id, nombre, creado_por, fecha
- assignments: proyecto_id, email, rol
- entries: id, owner_email, project_id, tipo, parent_id, descripcion, fecha_inicio, fecha_fin, estado, alerta, bloqueante, categoria, nota, jira, msd, esp_tecnica, esp_funcional, evidencia, observaciones, entregable, interno, descripcion_tarea

Tablas y datos PROHIBIDOS: cualquier tabla distinta de las anteriores. Nunca consultes ni menciones estructuras de acceso, credenciales, secretos, hashes, perfiles globales ni bitácoras.

Relaciones:
- entries.parent_id apunta a entries.id. Jerarquía: Tarea -> Subtarea -> Avance.
- entries.project_id y assignments.proyecto_id apuntan a projects.id.
- entries.owner_email y assignments.email identifican al colaborador por correo. En la respuesta final se mostrará el nombre indicado en el directorio seguro que se entrega por separado.

Valores exactos:
- entries.tipo: Tarea, Subtarea, Avance, General.
- entries.estado: No iniciado, En proceso, Detenido, Completado, Eliminada.
- assignments.rol: Líder, Colaborador.
- "abierto", "activo" o "pendiente" significa estado distinto de Completado y de Eliminada.
- observaciones guarda el historial de atrasos como segmentos [YYYY-MM-DD]::texto separados por la palabra homoplato.
- :hoy es la fecha actual en Bogotá en formato YYYY-MM-DD. Un avance está rezagado si no está Completado ni Eliminada y han pasado 7 días o más desde su fecha de referencia.

Parámetros obligatorios:
- Usa SIEMPRE el parámetro :projectId en toda consulta que toque projects, entries o assignments.
- Usa :hoy para comparar fechas.
- Nunca escribas el valor del proyecto literalmente.

Salida SQL:
- Un único SELECT válido en SQLite.
- Empieza con SELECT y usa FROM.
- No incluyas SELECT *, comillas triples, bloques de código, comentarios, explicaciones, punto y coma ni LIMIT.
- Selecciona únicamente las columnas necesarias para responder la pregunta.
- Usa alias claros en español.
`.trim();

export const SQL_SYSTEM_INSTRUCTION = [
  'Eres un generador de SQL de solo lectura para Optimia.',
  SQL_GOVERNANCE,
  'REGLAS ABSOLUTAS:',
  '1. Devuelve únicamente el texto del SQL. No expliques nada.',
  '2. El SQL debe responder exactamente la pregunta del líder usando solo las tablas permitidas.',
  '3. Toda consulta debe llevar :projectId. Nunca uses VALUES literales para el proyecto.',
  '4. No escribas LIMIT; el sistema lo agrega automáticamente.',
  '5. Si la pregunta no puede responderse con las tablas permitidas, devuelve: SELECT \'SIN DATOS\' AS mensaje FROM projects WHERE :projectId = :projectId',
].join('\n');

export const ANSWER_SYSTEM_INSTRUCTION = [
  'Eres Morgan, el asistente del proyecto seleccionado en Optimia.',
  'REGLAS OBLIGATORIAS:',
  '1. Responde SOLO con base en los RESULTADOS SQL entregados. No inventes datos.',
  '2. Si los resultados están vacíos o dicen SIN DATOS, responde: "No encontré información registrada en el proyecto para esa consulta."',
  '3. Si preguntan por algo ajeno al proyecto, responde exactamente: "Solo puedo responder consultas sobre la información registrada en el proyecto seleccionado."',
  '4. Usa el DIRECTORIO SEGURO para mostrar nombres en lugar de correos cuando esté disponible.',
  '5. Nunca escribas "TAREA 1", "TAREA-ss" ni numeraciones artificiales. Usa los nombres reales de tareas, subtareas y actividades.',
  '6. Indica siempre el estado actual de cada elemento cuando aparezca.',
  '7. Sé claro, corto y directo. Usa HTML limpio (<ul>, <li>, <strong>, <em>, <br>, <p>) sin bloques ```html ni Markdown.',
].join('\n');

export function extraerSql(texto) {
  let sql = String(texto || '').trim();
  sql = sql.replace(/^```(?:sql)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const inicio = sql.search(/\bSELECT\b/i);
  if (inicio > 0) sql = sql.slice(inicio);
  return sql.split(';')[0].trim();
}

export function validarSql(sql, projectId = '') {
  const consulta = String(sql || '').trim();
  if (!/^SELECT\s/i.test(consulta)) throw new Error('El modelo no devolvió una consulta SELECT válida.');
  if (!/\bFROM\b/i.test(consulta)) throw new Error('La consulta generada no indica una tabla permitida.');
  if (!consulta.includes(':projectId')) throw new Error('La consulta generada no está limitada al proyecto seleccionado.');
  if (projectId && consulta.includes(projectId)) throw new Error('La consulta generada no debe incluir el id del proyecto literalmente.');
  if (/SELECT\s+\*/i.test(consulta)) throw new Error('No se permite SELECT *.');
  if (/;\s*\S/.test(consulta)) throw new Error('Solo se permite una consulta.');
  if (/--|\/\*|\*\//.test(consulta)) throw new Error('No se permiten comentarios en SQL.');

  const prohibidas = [
    'users', 'sessions', 'audit', 'pragma', 'attach', 'detach',
    'insert', 'update', 'delete', 'drop', 'alter', 'create', 'replace',
    'vacuum', 'reindex', 'begin', 'commit', 'rollback', 'trigger', 'index',
    'password', 'token', 'cookie', 'secret', 'hash', 'contraseña',
  ];
  const patron = new RegExp(`\\b(${prohibidas.join('|')}|sqlite_\\w*)\\b`, 'i');
  if (patron.test(consulta)) throw new Error('La consulta intenta acceder a datos no permitidos.');

  if (/\b(LIMIT|OFFSET)\b/i.test(consulta)) throw new Error('La consulta no debe incluir LIMIT.');
  if (/\bOR\s+1\s*=\s*1\b/i.test(consulta) || /\bOR\s+'1'\s*=\s*'1'\b/i.test(consulta)) {
    throw new Error('La consulta contiene una condición no permitida.');
  }

  const parametros = [...consulta.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]);
  const permitidos = new Set(['projectId', 'hoy']);
  if (parametros.some((p) => !permitidos.has(p))) throw new Error('La consulta usa parámetros no permitidos.');

  return `${consulta.replace(/;\s*$/, '')} LIMIT 200`;
}
