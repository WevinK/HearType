const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'youtube-nocookie.com',
]);

const ID_PATH = /^\/(?:shorts|live|embed|v)\/([A-Za-z0-9_-]{6,20})(?:[/?#]|$)/;
export const VIDEO_ID = /^[A-Za-z0-9_-]{6,20}$/;

/** Return a normalized YouTube video URL, or null for anything else. */
export function normalizeYouTubeUrl(input: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    return null;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password) return null;

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (!YOUTUBE_HOSTS.has(host)) return null;

  let id = '';
  if (host === 'youtu.be') {
    id = parsed.pathname.split('/').filter(Boolean)[0] ?? '';
  } else if (parsed.pathname === '/watch') {
    id = parsed.searchParams.get('v') ?? '';
  } else {
    id = ID_PATH.exec(parsed.pathname)?.[1] ?? '';
  }

  return VIDEO_ID.test(id) ? parsed.toString() : null;
}
