import { emailNorm } from './utils.js';

const AUTHORIZATION_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USER_INFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

function config() {
  const clientId = String(process.env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.GOOGLE_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) {
    throw new Error('El acceso con Google no está configurado.');
  }
  return { clientId, clientSecret };
}

export function getPublicOrigin(request) {
  const forwardedHost = request.headers.get('x-forwarded-host');
  const host = (forwardedHost || request.headers.get('host') || '')
    .split(',')[0]
    .trim();
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const proto = (forwardedProto || 'https').split(',')[0].trim();

  if (host && !host.startsWith('localhost') && !host.startsWith('127.0.0.1')) {
    return `${proto}://${host}`;
  }
  return new URL(request.url).origin;
}

export function googleRedirectUri(request) {
  const configured = String(process.env.GOOGLE_REDIRECT_URI || '').trim();
  return configured || new URL('/api/auth/google/callback', getPublicOrigin(request)).toString();
}

export function googleAuthorizationUrl(request, state) {
  const { clientId } = config();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: googleRedirectUri(request),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  return `${AUTHORIZATION_URL}?${params}`;
}

export async function getGoogleUser(request, code) {
  const { clientId, clientSecret } = config();
  const tokenResponse = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: googleRedirectUri(request),
      grant_type: 'authorization_code',
    }),
    cache: 'no-store',
  });

  if (!tokenResponse.ok) throw new Error('Google no pudo validar la autorización.');
  const tokens = await tokenResponse.json();
  if (!tokens.access_token) throw new Error('Google no devolvió un token de acceso.');

  const userResponse = await fetch(USER_INFO_URL, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
    cache: 'no-store',
  });
  if (!userResponse.ok) throw new Error('No fue posible obtener el perfil de Google.');

  const profile = await userResponse.json();
  const email = emailNorm(profile.email);
  if (!email || profile.email_verified !== true) {
    throw new Error('La cuenta de Google no tiene un correo verificado.');
  }

  return {
    email,
    nombre: String(profile.name || '').trim() || email.split('@')[0],
  };
}
