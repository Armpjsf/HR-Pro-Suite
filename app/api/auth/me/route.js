import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';

export async function GET(request) {
  const { user, error, status } = requireAuth(request);
  
  if (error) {
    return NextResponse.json({ error }, { status });
  }

  return NextResponse.json({ user });
}
