import { NextResponse } from 'next/server';
import { getDocuments } from '@/lib/db';

export async function GET(request) {
  const expectedKey = process.env.HR_INTEGRATION_KEY;
  if (!expectedKey) {
    return NextResponse.json({ error: 'HR_INTEGRATION_KEY not configured' }, { status: 503 });
  }

  const searchKey = request.nextUrl?.searchParams?.get('key') ||
    new URL(request.url).searchParams.get('key');
  const key = request.headers.get('x-tms-api-key') || searchKey;

  if (key !== expectedKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const docs = await getDocuments();
    const manuals = (docs || [])
      .filter((d) => d.category === 'driver-manuals')
      .map((d) => ({
        id: d.id,
        name: d.name,
        videoUrl: d.fileName,
        source: d.size,
        accessRoles: d.accessRoles || [],
        updatedAt: d.updatedAt,
      }));

    return NextResponse.json({ manuals });
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Failed to load driver manuals' }, { status: 500 });
  }
}
