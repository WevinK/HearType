import { NextResponse } from 'next/server';
import { transcribeFile, VibeError } from '@/lib/vibe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 500);
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

export async function POST(request: Request) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_UPLOAD_BYTES + 1024 * 1024) {
    return NextResponse.json(
      { error: `This file is too large. The limit is ${MAX_UPLOAD_MB} MB.` },
      { status: 413 }
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Could not read the upload.' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Choose a video or audio file first.' }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'That file is empty.' }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `This file is too large. The limit is ${MAX_UPLOAD_MB} MB.` },
      { status: 413 }
    );
  }

  try {
    const result = await transcribeFile(file);
    return NextResponse.json(result);
  } catch (error) {
    const status = error instanceof VibeError ? error.status : 500;
    console.error('Transcription failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Transcription failed.' },
      { status }
    );
  }
}
