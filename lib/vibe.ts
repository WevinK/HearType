import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, openAsBlob } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { buildSentences } from './sentences.ts';
import type { TranscribeResponse } from './types';

const VIBE_DIR = path.join(process.cwd(), '.vibe');
const SERVER_PATH =
  process.env.VIBE_SERVER_PATH ||
  path.join(VIBE_DIR, process.platform === 'win32' ? 'vibe-server.exe' : 'vibe-server');
const MODEL_PATH =
  process.env.VIBE_MODEL_PATH || path.join(VIBE_DIR, 'models', 'ggml-base.en.bin');
const USE_GPU = process.env.VIBE_GPU === '1';
const LANGUAGE = process.env.VIBE_LANGUAGE || 'en';

export class VibeError extends Error {
  status: number;

  constructor(message: string, status = 503) {
    super(message);
    this.name = 'VibeError';
    this.status = status;
  }
}

type Server = {
  baseUrl: string;
  child: ChildProcess | null;
};

const cache = globalThis as typeof globalThis & {
  __hearTypeVibe?: Promise<Server>;
};

export async function ensureVibe(attempt = 0): Promise<Server> {
  if (!cache.__hearTypeVibe) {
    cache.__hearTypeVibe = startVibe().catch((error) => {
      delete cache.__hearTypeVibe;
      throw error;
    });
  }

  const server = await cache.__hearTypeVibe;
  if (await isHealthy(server.baseUrl)) return server;

  // A busy CPU can make /health slow; never kill a server that is still running.
  if (server.child && server.child.exitCode === null && server.child.signalCode === null) {
    return server;
  }

  delete cache.__hearTypeVibe;
  if (server.child) server.child.kill();
  if (attempt >= 1) {
    throw new VibeError('The local Vibe server stopped unexpectedly. Try again.');
  }
  return ensureVibe(attempt + 1);
}

async function startVibe(): Promise<Server> {
  const external = process.env.VIBE_SERVER_URL?.trim();
  if (external) {
    const baseUrl = external.replace(/\/+$/, '');
    await ensureModel(baseUrl);
    return { baseUrl, child: null };
  }

  if (!existsSync(/* turbopackIgnore: true */ SERVER_PATH)) {
    throw new VibeError('Vibe is not installed yet. Run "npm run setup:vibe" once, then try again.');
  }
  if (!existsSync(/* turbopackIgnore: true */ MODEL_PATH)) {
    throw new VibeError('The Whisper model is missing. Run "npm run setup:vibe" once, then try again.');
  }

  const child = spawn(
    /* turbopackIgnore: true */
    SERVER_PATH,
    ['serve', '--host', '127.0.0.1', '--port', '0', '--exit-with-parent', 'true'],
    {
      cwd: path.dirname(SERVER_PATH),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  try {
    const baseUrl = await waitForReady(child);
    await ensureModel(baseUrl);
    return { baseUrl, child };
  } catch (error) {
    child.kill();
    throw error;
  }
}

function waitForReady(child: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!child.stdout) {
      reject(new VibeError('Could not read the Vibe server output.'));
      return;
    }

    const lines = readline.createInterface({ input: child.stdout });
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;

    const cleanup = () => {
      clearTimeout(timer);
      lines.off('line', onLine);
      child.off('error', onError);
      child.off('exit', onExit);
    };

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const onLine = (line: string) => {
      if (settled) return;
      try {
        const message = JSON.parse(line) as { status?: string; port?: number };
        if (message.status === 'ready' && Number.isFinite(message.port)) {
          settled = true;
          cleanup();
          resolve(`http://127.0.0.1:${message.port}`);
        }
      } catch {
        // The server may print other log lines before the ready JSON.
      }
    };

    const onError = (error: Error) => {
      fail(new VibeError(`Could not start the Vibe server: ${error.message}`));
    };

    const onExit = (code: number | null) => {
      fail(new VibeError(`The Vibe server stopped before it was ready (exit ${code ?? 'unknown'}).`));
    };

    timer = setTimeout(() => {
      fail(new VibeError('The Vibe server did not start in time.'));
    }, 60_000);

    lines.on('line', onLine);
    child.on('error', onError);
    child.on('exit', onExit);
    child.stderr?.on('data', (chunk: Buffer) => {
      console.error('[vibe]', chunk.toString().trim());
    });
  });
}

async function isHealthy(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/health`, {
      signal: AbortSignal.timeout(2_000),
      cache: 'no-store',
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureModel(baseUrl: string): Promise<void> {
  let ready: Response;
  try {
    ready = await fetch(`${baseUrl}/ready`, {
      signal: AbortSignal.timeout(5_000),
      cache: 'no-store',
    });
  } catch {
    throw new VibeError(`Could not reach the Vibe server at ${baseUrl}.`);
  }
  if (ready.ok) return;

  if (!existsSync(/* turbopackIgnore: true */ MODEL_PATH)) {
    throw new VibeError('The Whisper model is missing. Run "npm run setup:vibe" once, then try again.');
  }

  const response = await fetch(`${baseUrl}/v1/models/load`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: MODEL_PATH, no_gpu: !USE_GPU }),
    signal: AbortSignal.timeout(180_000),
  });

  if (!response.ok) {
    throw new VibeError(`Vibe could not load the Whisper model: ${await readError(response)}`);
  }
}

export async function transcribeFile(file: File): Promise<TranscribeResponse> {
  return transcribeBlob(file, file.name);
}

export async function transcribePath(filePath: string): Promise<TranscribeResponse> {
  let blob: Blob;
  try {
    blob = await openAsBlob(/* turbopackIgnore: true */ filePath);
  } catch {
    throw new VibeError('Could not read the downloaded video.');
  }
  return transcribeBlob(blob, path.basename(filePath));
}

async function transcribeBlob(blob: Blob, filename: string): Promise<TranscribeResponse> {
  const { baseUrl } = await ensureVibe();

  const form = new FormData();
  form.append('file', blob, filename);
  form.append('response_format', 'verbose_json');
  form.append('language', LANGUAGE);
  form.append('word_timestamps', 'true');
  form.append('max_segment_len', '1');

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/v1/audio/transcriptions`, {
      method: 'POST',
      body: form,
    });
  } catch (error) {
    throw new VibeError(
      `Could not reach the local Vibe server: ${error instanceof Error ? error.message : 'unknown error'}`
    );
  }

  if (!response.ok) {
    const detail = await readError(response);
    if (response.status === 429) {
      throw new VibeError('Vibe is still busy with another transcription. Try again in a moment.', 429);
    }
    throw new VibeError(`Vibe could not transcribe this file: ${detail}`, response.status === 400 ? 400 : 502);
  }

  const data = (await response.json()) as { segments?: unknown };
  const sentences = buildSentences(data.segments);
  if (!sentences.length) {
    throw new VibeError('No speech was found in this file. Try a clearer clip.', 422);
  }

  return { sentences };
}

async function readError(response: Response): Promise<string> {
  const body = await response.text();
  try {
    const data = JSON.parse(body) as { error?: { message?: string; code?: string } };
    return data.error?.message || data.error?.code || body || `HTTP ${response.status}`;
  } catch {
    return body || `HTTP ${response.status}`;
  }
}
