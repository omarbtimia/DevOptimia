const TIME_ZONE = 'America/Bogota';

export const PERFIL_ADMIN = 'Administrador';
export const PERFIL_USUARIO = 'Usuario';
export const ROL_LIDER = 'Líder';
export const ROL_COLABORADOR = 'Colaborador';

export function normalizarPerfil(valor) {
  return valor === PERFIL_ADMIN ? PERFIL_ADMIN : PERFIL_USUARIO;
}

export function normalizarRolProyecto(valor) {
  return valor === ROL_LIDER ? ROL_LIDER : ROL_COLABORADOR;
}

export function todayBogota() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function nowBogota() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date());
}

export function normalizarEstado_(estadoRaw) {
  const st = String(estadoRaw || '').trim();
  if (st === 'Por Iniciar' || st === 'No iniciado') return 'No iniciado';
  if (st === 'En Pausa' || st === 'Bloqueada' || st === 'Detenido') return 'Detenido';
  if (st === 'Terminada' || st === 'Completado') return 'Completado';
  if (st === 'Eliminada') return 'Eliminada';
  return 'En proceso';
}

export function emailNorm(value) {
  return String(value || '').trim().toLowerCase();
}

export function mapEntryRow(r) {
  const estado = normalizarEstado_(r.estado);
  const sinAlerta =
    r.tipo === 'Tarea' ||
    r.tipo === 'Subtarea' ||
    (r.tipo === 'Avance' && estado !== 'Detenido');

  return {
    id: r.id,
    tipo: r.tipo,
    parentId: r.parent_id || '',
    desc: r.descripcion || '',
    fechaInicio: r.fecha_inicio || '',
    fechaFin: r.fecha_fin || '',
    estado,
    owner: r.owner_email,
    projectId: r.project_id || '',
    alerta: sinAlerta ? '' : r.alerta || '',
    bloqueante: sinAlerta ? '' : r.bloqueante || '',
    categoria: r.categoria || '',
    nota: r.nota || '',
    jira: r.jira || '',
    msd: r.msd || '',
    espTecnica: r.esp_tecnica || '',
    espFuncional: r.esp_funcional || '',
    evidencia: r.evidencia || '',
    sinEntregable: Number(r.sin_entregable) === 1,
    observaciones: r.observaciones || '',
    entregable: r.entregable || '',
    interno: Number(r.interno) === 1,
    descripcionTarea: r.descripcion_tarea || '',
  };
}
