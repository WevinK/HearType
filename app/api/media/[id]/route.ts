import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { parseRange } from '@/lib/media-range';
import { MEDIA_DIR } from '@/lib/youtube';
import { VIDEO_ID } from '@/lib/youtube-url';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

async function lookup(id: string) {
  if (!VIDEO_ID.test(id)) return null;
  const filePath = path.join(MEDIA_DIR, `${id}.mp4`);
  try {
    const info = await stat(/* turbopackIgnore: true */ filePath);
    return info.isFile() && info.size > 0 ? { filePath, size: info.size } : null;
  } catch {
    return null;
  }
}

function baseHeaders(size: number): HeadersInit {
  return {
    'Content-Type': 'video/mp4',
    'Content-Length': String(size),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=3600',
  };
}

export async function HEAD(_request: Request, { params }: Context) {
  const { id } = await params;
  const file = await lookup(id);
  if (!file) return new Response(null, { status: 404 });
  return new Response(null, { headers: baseHeaders(file.size) });
}

export async function GET(request: Request, { params }: Context) {
  const { id } = await params;
  const file = await lookup(id);
  if (!file) return new Response('Not found', { status: 404 });

  const range = request.headers.get('range');
  if (!range) {
    const stream = createReadStream(/* turbopackIgnore: true */ file.filePath);
    return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
      headers: baseHeaders(file.size),
    });
  }

  const parsed = parseRange(range, file.size);
  if (!parsed) {
    return new Response('Range not satisfiable', {
      status: 416,
      headers: { 'Content-Range': `bytes */${file.size}` },
    });
  }
  const { start, end } = parsed;

  const stream = createReadStream(/* turbopackIgnore: true */ file.filePath, { start, end });
  return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
    status: 206,
    headers: {
      ...baseHeaders(end - start + 1),
      'Content-Range': `bytes ${start}-${end}/${file.size}`,
    },
  });
}
