import { cookies } from 'next/headers';
import { getDb } from './db.js';
import { newToken, sha256 } from './crypto.js';
import { ApiError } from './errors.js';
import { audit } from './audit.js';

const COOKIE_NAME = 'optimia_session';
const GOOGLE_OAUTH_STATE_COOKIE = 'optimia_google_oauth_state';
const MAX_AGE_SECONDS = 60 * 60 * 12;

function sqlNow(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString().replace('T', ' ').slice(0, 19);
}

export async function getSessionUser() {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const row = getDb().prepare(
    `SELECT u.id, u.username, u.email, u.role
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ? AND u.activo = 1`
  ).get(sha256(token), sqlNow());
  return row || null;
}

export async function requireUser() {
  const user = await getSessionUser();
  if (!user) throw new ApiError('Sesión no válida o expirada.', 401);
  return user;
}

export function requireAdmin(user) {
  if (user.role !== 'Administrador') throw new ApiError('Acceso denegado: se requiere perfil Administrador.', 403);
}

export async function createSession(userId) {
  const token = newToken();
  getDb().prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(sha256(token), userId, sqlNow(MAX_AGE_SECONDS * 1000));
  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function setGoogleOAuthState(state) {
  const jar = await cookies();
  jar.set(GOOGLE_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 10,
  });
}

export async function consumeGoogleOAuthState() {
  const jar = await cookies();
  const state = jar.get(GOOGLE_OAUTH_STATE_COOKIE)?.value || '';
  jar.delete(GOOGLE_OAUTH_STATE_COOKIE);
  return state;
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (token) {
    const user = getDb().prepare(
      `SELECT u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`
    ).get(sha256(token));
    getDb().prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
    if (user) audit('LOGOUT', 'Sesion', user.email, 'Cierre de sesión', user);
  }
  jar.delete(COOKIE_NAME);
}
