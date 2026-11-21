import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { verifyPassword } from '@/lib/crypto';
import { createSession } from '@/lib/auth';
import { ApiError } from '@/lib/errors';
import { emailNorm } from '@/lib/utils';

export const runtime = 'nodejs';

export async function POST(request) {
  try {
    const { username, password } = await request.json();
    const login = String(username || '').trim();
    const user = getDb()
      .prepare('SELECT id, email, role, password_hash FROM users WHERE username = ? OR email = ?')
      .get(login, emailNorm(login));

    if (!user || !verifyPassword(password, user.password_hash)) {
      throw new ApiError('Usuario o contraseña incorrectos.', 401);
    }

    await createSession(user.id);
    return NextResponse.json({ ok: true, user: { email: user.email, role: user.role } });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Error al iniciar sesión' }, { status: error.status || 400 });
  }
}
