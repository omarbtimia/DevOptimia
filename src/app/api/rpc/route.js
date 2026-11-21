import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { ApiError } from '@/lib/errors';
import { HANDLERS } from '@/lib/rpc';

export const runtime = 'nodejs';

export async function POST(request) {
  try {
    const user = await requireUser();
    const { method, params = [] } = await request.json();
    const handler = HANDLERS[method];
    if (!handler) throw new ApiError(`Método no soportado: ${method}`, 404);
    const result = await handler(Array.isArray(params) ? params : [params], user);
    return NextResponse.json({ result });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Error interno' }, { status: error.status || 400 });
  }
}
