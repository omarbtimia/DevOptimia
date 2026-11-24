import { getDb } from './db.js';
import { emailNorm, nowBogota } from './utils.js';

export async function audit(accion, tipo, idRegistro, detalle, user) {
  const db = await getDb();
  await db.run(
    'INSERT INTO audit (timestamp, usuario, accion, tipo, id_registro, detalle) VALUES (?, ?, ?, ?, ?, ?)',
    nowBogota(),
    emailNorm(user?.email),
    String(accion || ''),
    String(tipo || ''),
    String(idRegistro || ''),
    String(detalle || '')
  );
}
