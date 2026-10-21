import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, mkdir, rename, rm, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vibeDir = path.join(root, '.vibe');
const modelDir = path.join(vibeDir, 'models');
const serverVersion = process.env.VIBE_SERVER_VERSION || 'server-v0.6.10';
const modelName = 'ggml-base.en.bin';
const modelPath = path.join(modelDir, modelName);
const modelRevision = '5359861c739e955e79d9a303bcbc70fb988958b1';
const modelSha256 = 'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002';
const modelUrl = `https://huggingface.co/ggerganov/whisper.cpp/resolve/${modelRevision}/${modelName}`;

// SHA-256 digests from the server-v0.6.10 release. A custom version has no pin.
const serverSha256 = {
  'server-v0.6.10': {
    'vibe-server-windows-amd64-with-ffmpeg.zip':
      'f5193e9407acf8f963983e4c1eaf37e40664d71657c25476d72b218a8a8db9e9',
    'vibe-server-darwin-arm64-with-ffmpeg.tar.gz':
      'faae324da3c01069d7af76eefaa72063dc066386e1c1c13ba3f42e7488aa3614',
    'vibe-server-darwin-amd64-with-ffmpeg.tar.gz':
      '421bb1dc5a618e1d1336d4ca06e56f5b1f3a3ec48c709c21f4e346906fa233e9',
    'vibe-server-linux-amd64':
      'c6fa295d59f30799dfcc3ab466ff4efd6ce407e1ea36c218b180d3c7c18a2719',
    'vibe-server-linux-arm64':
      '00fdfebae44aa33314c1edcf66c27e2a0795afc77b3fa1bd1bb3f7c0ff83da92',
  },
};

function assetName() {
  if (process.platform === 'win32' && process.arch === 'x64') {
    return 'vibe-server-windows-amd64-with-ffmpeg.zip';
  }
  if (process.platform === 'darwin' && process.arch === 'arm64') {
    return 'vibe-server-darwin-arm64-with-ffmpeg.tar.gz';
  }
  if (process.platform === 'darwin' && process.arch === 'x64') {
    return 'vibe-server-darwin-amd64-with-ffmpeg.tar.gz';
  }
  if (process.platform === 'linux' && process.arch === 'x64') {
    return 'vibe-server-linux-amd64';
  }
  if (process.platform === 'linux' && process.arch === 'arm64') {
    return 'vibe-server-linux-arm64';
  }
  throw new Error(`Unsupported platform: ${process.platform} ${process.arch}`);
}

function ytDlpAssetName() {
  if (process.platform === 'win32' && process.arch === 'x64') return 'yt-dlp.exe';
  if (process.platform === 'win32' && process.arch === 'arm64') return 'yt-dlp_arm64.exe';
  if (process.platform === 'darwin') return 'yt-dlp_macos';
  if (process.platform === 'linux' && process.arch === 'x64') return 'yt-dlp_linux';
  if (process.platform === 'linux' && process.arch === 'arm64') return 'yt-dlp_linux_aarch64';
  throw new Error(`Unsupported platform for YouTube support: ${process.platform} ${process.arch}`);
}

const asset = assetName();
const serverHash = serverSha256[serverVersion]?.[asset];
const downloadUrl = `https://github.com/thewh1teagle/vibe/releases/download/${serverVersion}/${asset}`;
const archivePath = path.join(vibeDir, asset);
const serverPath = path.join(vibeDir, process.platform === 'win32' ? 'vibe-server.exe' : 'vibe-server');
const ffmpegPath = path.join(vibeDir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
const ytDlpAsset = ytDlpAssetName();
const ytDlpPath = path.join(vibeDir, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
const ytDlpUrl = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${ytDlpAsset}`;

async function fileExists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function download(url, destination, label, expectedSha256) {
  console.log(`Downloading ${label}…`);
  const response = await fetch(url, {
    headers: { 'user-agent': 'hear-type-setup' },
    redirect: 'follow',
  });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status}) for ${url}`);
  }
  const total = Number(response.headers.get('content-length') || 0);
  if (total) console.log(`  ${(total / 1024 / 1024).toFixed(0)} MB`);
  const part = `${destination}.part`;
  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(part));
    if (expectedSha256) {
      const actual = await sha256(part);
      if (actual !== expectedSha256) {
        throw new Error(`Checksum mismatch for ${label}: expected ${expectedSha256}, got ${actual}.`);
      }
    } else {
      console.warn(`  No pinned checksum for ${label}; skipping verification.`);
    }
    await rename(part, destination);
  } catch (error) {
    await rm(part, { force: true });
    throw error;
  }
}

async function main() {
  await mkdir(vibeDir, { recursive: true });

  const needsServer = !(await fileExists(serverPath));
  const needsFfmpeg = process.platform !== 'linux' && !(await fileExists(ffmpegPath));

  if (needsServer || needsFfmpeg) {
    if (asset.endsWith('.zip') || asset.endsWith('.tar.gz')) {
      await download(downloadUrl, archivePath, asset, serverHash);
      console.log('Extracting vibe-server…');
      execFileSync('tar', ['-xf', archivePath, '-C', vibeDir], { stdio: 'inherit' });
      await rm(archivePath, { force: true });
    } else {
      await download(downloadUrl, serverPath, asset, serverHash);
      await chmod(serverPath, 0o755);
    }
  } else {
    console.log('vibe-server already installed.');
  }

  if (process.platform === 'linux') {
    try {
      execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    } catch {
      console.warn('ffmpeg was not found on PATH. Install it so Vibe can read videos.');
    }
  }

  if (!(await fileExists(ytDlpPath))) {
    await download(ytDlpUrl, ytDlpPath, ytDlpAsset);
    if (process.platform !== 'win32') await chmod(ytDlpPath, 0o755);
  } else {
    console.log('yt-dlp already installed.');
  }

  const modelExists = (await fileExists(modelPath)) && (await stat(modelPath)).size > 100_000_000;
  if (!modelExists) {
    await mkdir(modelDir, { recursive: true });
    await download(modelUrl, modelPath, modelName, modelSha256);
  } else {
    console.log('Whisper model already present.');
  }

  console.log('\nVibe is ready.');
  console.log(`  server: ${serverPath}`);
  console.log(`  model:  ${modelPath}`);
  console.log(`  yt-dlp: ${ytDlpPath}`);
  console.log('Run npm run dev and upload a video or paste a YouTube link.');
}

main().catch((error) => {
  console.error(`\nSetup failed: ${error.message}`);
  process.exitCode = 1;
});
