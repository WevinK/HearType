import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { normalizeYouTubeUrl, VIDEO_ID } from './youtube-url';

const VIBE_DIR = path.join(process.cwd(), '.vibe');
export const MEDIA_DIR = path.join(VIBE_DIR, 'media');
const YT_DLP_PATH =
  process.env.YT_DLP_PATH ||
  path.join(VIBE_DIR, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 500);
const MAX_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
const MAX_MINUTES = Number(process.env.MAX_YOUTUBE_MINUTES || 60);
const MEDIA_MAX_AGE_MS = 24 * 60 * 60 * 1000;

type YtInfo = {
  _type?: unknown;
  entries?: unknown;
  id?: unknown;
  title?: unknown;
  duration?: unknown;
  is_live?: unknown;
  live_status?: unknown;
};

export class YouTubeError extends Error {
  status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = 'YouTubeError';
    this.status = status;
  }
}

function ffmpegPath(): string {
  if (process.env.VIBE_FFMPEG_PATH) return process.env.VIBE_FFMPEG_PATH;
  const bundled = path.join(VIBE_DIR, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  return existsSync(/* turbopackIgnore: true */ bundled) ? bundled : 'ffmpeg';
}

function runYtDlp(args: string[], timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      /* turbopackIgnore: true */
      YT_DLP_PATH,
      args,
      { timeout, maxBuffer: 32 * 1024 * 1024, windowsHide: true, encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (!error) {
          resolve(stdout);
          return;
        }
        const failure = error as Error & { killed?: boolean };
        if (failure.killed) {
          reject(new YouTubeError('The YouTube download timed out. Try a shorter video.', 504));
          return;
        }
        const detail = [stderr, stdout, error.message]
          .filter(Boolean)
          .join('\n')
          .replace(/\u001b\[[0-9;]*m/g, '')
          .trim()
          .split('\n')
          .slice(-4)
          .join(' ');
        reject(new YouTubeError(`yt-dlp could not fetch this video: ${detail}`, 502));
      }
    );
  });
}

async function fileSize(filePath: string): Promise<number> {
  try {
    const info = await stat(/* turbopackIgnore: true */ filePath);
    return info.isFile() ? info.size : 0;
  } catch {
    return 0;
  }
}

async function cleanupMedia(): Promise<void> {
  let names: string[];
  try {
    names = await readdir(/* turbopackIgnore: true */ MEDIA_DIR);
  } catch {
    return;
  }

  const cutoff = Date.now() - MEDIA_MAX_AGE_MS;
  await Promise.all(
    names.map(async (name) => {
      if (!/\.mp4$/i.test(name)) return;
      const filePath = path.join(MEDIA_DIR, name);
      try {
        const info = await stat(/* turbopackIgnore: true */ filePath);
        if (info.mtimeMs < cutoff) await unlink(/* turbopackIgnore: true */ filePath);
      } catch {
        // A file may have been removed by another request.
      }
    })
  );
}

export type DownloadedYouTubeVideo = {
  id: string;
  title: string;
  filePath: string;
};

const downloads = globalThis as typeof globalThis & {
  __hearTypeDownloads?: Map<string, Promise<DownloadedYouTubeVideo>>;
};

export async function downloadYouTube(input: string): Promise<DownloadedYouTubeVideo> {
  const url = normalizeYouTubeUrl(input);
  if (!url) {
    throw new YouTubeError('Paste a public YouTube video link, not a playlist or channel.', 400);
  }
  if (!existsSync(/* turbopackIgnore: true */ YT_DLP_PATH)) {
    throw new YouTubeError(
      'YouTube support is not installed. Run "npm run setup:vibe" once, then try again.',
      503
    );
  }

  await mkdir(/* turbopackIgnore: true */ MEDIA_DIR, { recursive: true });

  const metadataRaw = await runYtDlp(
    ['--dump-single-json', '--no-playlist', '--no-warnings', '--no-progress', url],
    120_000
  );

  let info: YtInfo;
  try {
    info = JSON.parse(metadataRaw.trim().split('\n').filter(Boolean).pop() || '{}') as YtInfo;
  } catch {
    throw new YouTubeError('Could not read this YouTube video. Check that it is public.', 502);
  }

  if (info._type === 'playlist' || Array.isArray(info.entries)) {
    throw new YouTubeError('Paste a single video link, not a playlist.', 400);
  }
  if (info.is_live === true || info.live_status === 'is_live' || info.live_status === 'is_upcoming') {
    throw new YouTubeError('Live streams cannot be transcribed. Use a finished video.', 400);
  }

  const id = typeof info.id === 'string' ? info.id : '';
  if (!VIDEO_ID.test(id)) {
    throw new YouTubeError('Could not identify this YouTube video.', 502);
  }

  const duration = Number(info.duration);
  if (Number.isFinite(duration) && duration > MAX_MINUTES * 60) {
    throw new YouTubeError(`This video is longer than ${MAX_MINUTES} minutes.`, 400);
  }

  const title =
    typeof info.title === 'string' && info.title.trim()
      ? info.title.trim().slice(0, 200)
      : 'YouTube video';

  await cleanupMedia();
  const filePath = path.join(MEDIA_DIR, `${id}.mp4`);

  const inFlight = downloads.__hearTypeDownloads ?? (downloads.__hearTypeDownloads = new Map());
  const pending = inFlight.get(id);
  if (pending) return pending;

  const job = (async () => {
    if ((await fileSize(filePath)) > 0) return { id, title, filePath };

    const ytDlpFormat = [
      'bv*[vcodec^=avc1][height<=720][ext=mp4]+ba[ext=m4a]',
      'b[height<=720][ext=mp4]',
      'b[height<=720]',
      'b',
    ].join('/');

    // Download to a unique name; a partial file must never look like a cache hit.
    const tempBase = path.join(
      MEDIA_DIR,
      `${id}.${process.pid.toString(36)}${Math.random().toString(36).slice(2, 8)}`
    );

    await runYtDlp(
      [
        '--no-playlist',
        '--no-warnings',
        '--no-progress',
        '--newline',
        '--ffmpeg-location',
        ffmpegPath(),
        '--max-filesize',
        `${MAX_UPLOAD_MB}M`,
        '-f',
        ytDlpFormat,
        '--merge-output-format',
        'mp4',
        '--remux-video',
        'mp4',
        '-o',
        `${tempBase}.%(ext)s`,
        url,
      ],
      15 * 60 * 1000
    );

    const tempPath = `${tempBase}.mp4`;
    const size = await fileSize(tempPath);
    if (size === 0) {
      throw new YouTubeError('The YouTube download did not produce a playable MP4.', 502);
    }
    if (size > MAX_BYTES) {
      await unlink(/* turbopackIgnore: true */ tempPath).catch(() => undefined);
      throw new YouTubeError(`The downloaded video is larger than ${MAX_UPLOAD_MB} MB.`, 413);
    }

    await rename(/* turbopackIgnore: true */ tempPath, filePath);
    return { id, title, filePath };
  })();

  inFlight.set(id, job);
  try {
    return await job;
  } finally {
    inFlight.delete(id);
  }
}
