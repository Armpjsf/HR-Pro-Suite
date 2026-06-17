import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    publicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '',
    enabled: Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY),
  });
}
