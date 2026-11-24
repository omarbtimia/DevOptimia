import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { verifyPassword } from '@/lib/crypto';
import { createSession } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { ApiError } from '@/lib/errors';
import { emailNorm } from '@/lib/utils';

export const runtime = 'nodejs';

export async function POST(request) {
  let login = '';
  try {
    const { username, password } = await request.json();
    login = String(username || '').trim();
    const db = await getDb();
    const user = await db.get(
      'SELECT id, email, role, password_hash FROM users WHERE username = ? OR email = ?',
      login, emailNorm(login)
    );

    if (!user || !verifyPassword(password, user.password_hash)) {
      throw new ApiError('Usuario o contraseña incorrectos.', 401);
    }

    await createSession(user.id);
    await audit('LOGIN', 'Sesion', user.email, 'Inicio de sesión', user);
    return NextResponse.json({ ok: true, user: { email: user.email, role: user.role } });
  } catch (error) {
    if (error.status === 401 && login) {
      await audit('LOGIN_FALLIDO', 'Sesion', login, 'Intento de inicio de sesión fallido', { email: login });
    }
    return NextResponse.json({ error: error.message || 'Error al iniciar sesión' }, { status: error.status || 400 });
  }
}
