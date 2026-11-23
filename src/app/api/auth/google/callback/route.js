import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { audit } from '@/lib/audit';
import { consumeGoogleOAuthState, createSession } from '@/lib/auth';
import { hashPassword, newToken } from '@/lib/crypto';
import { getGoogleUser } from '@/lib/googleOAuth';

export const runtime = 'nodejs';

function loginRedirect(request, error = '') {
  const url = new URL(error ? '/login' : '/', request.url);
  if (error) url.searchParams.set('error', error);
  return NextResponse.redirect(url);
}

export async function GET(request) {
  let auditIdentity = 'google';
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get('code') || '';
    const returnedState = url.searchParams.get('state') || '';
    const expectedState = await consumeGoogleOAuthState();

    if (url.searchParams.has('error')) throw new Error('La autorización con Google fue cancelada.');
    if (!code || !expectedState || returnedState !== expectedState) {
      throw new Error('La autorización con Google no es válida o expiró.');
    }

    const googleUser = await getGoogleUser(request, code);
    auditIdentity = googleUser.email;
    const db = getDb();
    let user = db.prepare(
      'SELECT id, email, nombre, role, activo FROM users WHERE email = ?'
    ).get(googleUser.email);

    if (user && Number(user.activo) !== 1) {
      throw new Error('El usuario está inactivo. Contacta a un administrador.');
    }

    if (!user) {
      db.prepare(
        `INSERT INTO users (username, email, nombre, password_hash, role)
         VALUES (?, ?, ?, ?, ?)`
      ).run(
        googleUser.email,
        googleUser.email,
        googleUser.nombre,
        hashPassword(newToken()),
        'Usuario'
      );
      user = db.prepare(
        'SELECT id, email, nombre, role, activo FROM users WHERE email = ?'
      ).get(googleUser.email);
      audit(
        'CREAR',
        'Usuario',
        user.email,
        `Registro automático con Google | Nombre: ${user.nombre} | Perfil: Usuario`,
        user
      );
    }

    await createSession(user.id);
    audit('LOGIN', 'Sesion', user.email, 'Inicio de sesión con Google', user);
    return loginRedirect(request);
  } catch (error) {
    audit(
      'LOGIN_FALLIDO',
      'Sesion',
      auditIdentity,
      `Intento de inicio de sesión con Google fallido: ${error.message || 'Error desconocido'}`,
      { email: auditIdentity }
    );
    return loginRedirect(request, error.message || 'No fue posible iniciar sesión con Google.');
  }
}
