import { NextResponse } from 'next/server';
import { transcribePath, VibeError } from '@/lib/vibe';
import { downloadYouTube, YouTubeError } from '@/lib/youtube';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let body: { url?: unknown };
  try {
    body = (await request.json()) as { url?: unknown };
  } catch {
    return NextResponse.json({ error: 'Paste a YouTube video link.' }, { status: 400 });
  }

  if (typeof body.url !== 'string' || !body.url.trim() || body.url.length > 2048) {
    return NextResponse.json({ error: 'Paste a YouTube video link.' }, { status: 400 });
  }

  try {
    const video = await downloadYouTube(body.url);
    const transcription = await transcribePath(video.filePath);

    return NextResponse.json({
      title: video.title,
      duration: video.duration,
      mediaUrl: `/api/media/${video.id}`,
      text: transcription.text,
      sentences: transcription.sentences,
    });
  } catch (error) {
    const status =
      error instanceof YouTubeError || error instanceof VibeError ? error.status : 500;
    console.error('YouTube transcription failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not prepare this video.' },
      { status }
    );
  }
}
