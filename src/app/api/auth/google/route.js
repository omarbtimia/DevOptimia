import { NextResponse } from 'next/server';
import { newToken } from '@/lib/crypto';
import { getPublicOrigin, googleAuthorizationUrl } from '@/lib/googleOAuth';
import { setGoogleOAuthState } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET(request) {
  try {
    const state = newToken();
    await setGoogleOAuthState(state);
    return NextResponse.redirect(googleAuthorizationUrl(request, state));
  } catch (error) {
    const loginUrl = new URL('/login', getPublicOrigin(request));
    loginUrl.searchParams.set('error', error.message || 'No fue posible iniciar el acceso con Google.');
    return NextResponse.redirect(loginUrl);
  }
}
