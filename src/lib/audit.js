import { getDb } from './db.js';
import { emailNorm, nowBogota } from './utils.js';

export function audit(accion, tipo, idRegistro, detalle, user) {
  getDb()
    .prepare(
      'INSERT INTO audit (timestamp, usuario, accion, tipo, id_registro, detalle) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(
      nowBogota(),
      emailNorm(user?.email),
      String(accion || ''),
      String(tipo || ''),
      String(idRegistro || ''),
      String(detalle || '')
    );
}

