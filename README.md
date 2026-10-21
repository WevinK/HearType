# ListeningType

English listening practice built from your own videos.

Upload a clip or paste a public YouTube link. [Vibe](https://thewh1teagle.github.io/vibe/) transcribes the speech locally into sentences. Then you listen to each sentence and type it. A correct answer advances automatically, and the final screen shows exactly what you missed.

Everything runs on your machine. No audio or video is sent to a cloud service.

## How it works

- **Upload or link** — choose a video/audio file (up to 500 MB), or paste a public YouTube link. Vibe's transcription server only accepts files, so YouTube videos are fetched with `yt-dlp` (the same downloader the Vibe desktop app uses) and cached in `.vibe/media/`.
- **Transcribe** — the Next.js API starts a local `vibe-server`, loads a Whisper model, and asks it for timestamped segments. Adjacent segments are joined into sentence-sized clips.
- **Review** — fix any transcription mistakes, remove bad lines, then start.
- **Practice** — the media is served locally with HTTP range requests and plays one sentence at a time by seeking to its timestamps. Type what you hear; punctuation and capitalisation are ignored. A correct answer moves on after 700 ms.
- **Review the session** — accuracy, first-try count, missed sentences, wrong tries, and a sentence-by-sentence breakdown.

## Requirements

- Node.js 22.15 or newer.
- Windows, macOS, or Linux.
- On Linux, `ffmpeg` must be on `PATH`. The Windows and macOS setup downloads a bundled ffmpeg.
- About 400 MB of disk for the local server, ffmpeg, yt-dlp, and the Whisper model.
- YouTube links must point to public, non-live videos. Age-restricted or region-blocked videos may need cookies and are not handled here.

## Setup

```bash
npm install
npm run setup:vibe
npm run dev
```

Open **http://localhost:3100**.

The setup command downloads `vibe-server v0.6.10`, `yt-dlp`, ffmpeg, and `ggml-base.en.bin` into `.vibe/` (ignored by git). The first transcription also loads the model, so it can take a little longer than later ones.

### Production

```bash
npm run build
npm run start
```

This app is designed to run locally because it starts a native Vibe process. It is not suitable for serverless hosting as-is.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Start Next.js on port 3100 |
| `npm run build` | Production build |
| `npm run start` | Start the production server on port 3100 |
| `npm test` | Run sentence, scoring, and legacy tests |
| `npm run typecheck` | Run TypeScript with no emit |
| `npm run setup:vibe` | Download vibe-server, ffmpeg, and the model into `.vibe/` |

## Configuration

Copy `.env.example` to `.env.local` if you need overrides.

| Variable | Default | Purpose |
| --- | --- | --- |
| `VIBE_SERVER_URL` | spawn locally | Use an already running vibe-server |
| `VIBE_SERVER_PATH` | `.vibe/vibe-server[.exe]` | Server binary path |
| `VIBE_MODEL_PATH` | `.vibe/models/ggml-base.en.bin` | Whisper model path |
| `VIBE_GPU` | CPU | Set to `1` to try the GPU backend |
| `VIBE_LANGUAGE` | `en` | Whisper language |
| `MAX_UPLOAD_MB` | `500` | Upload and YouTube download limit |
| `MAX_YOUTUBE_MINUTES` | `60` | Longest YouTube video |
| `YT_DLP_PATH` | `.vibe/yt-dlp[.exe]` | yt-dlp binary path |
| `VIBE_FFMPEG_PATH` | `.vibe/ffmpeg[.exe]` or `ffmpeg` | ffmpeg used by yt-dlp |

The setup script can target another server release with `VIBE_SERVER_VERSION` (for example `server-v0.6.9`).

## Project layout

```
app/                 Next.js App Router pages, styles, and API routes
app/api/youtube/     YouTube download + transcription endpoint
app/api/media/[id]/  Range-enabled local media streaming
components/          Setup, practice, and results screens
lib/vibe.ts          Server-only Vibe process management and transcription
lib/youtube.ts       yt-dlp download, validation, caching, and cleanup
lib/youtube-url.ts   YouTube URL allowlist/normalisation
lib/sentences.ts     Whisper segment → sentence grouping
lib/listening.ts     Matching, scoring, and time formatting
scripts/setup-vibe.mjs
test/                Sentence, scoring, YouTube URL, and legacy parser tests
legacy/              Previous zero-dependency single-file version (reference only)
```

The legacy app is kept for reference and has its own sample pack in `legacy/Videos/`. The Next.js app does not use it.

## Notes

- `vibe-server` handles one transcription at a time; concurrent requests receive a busy response.
- Transcription quality depends on the model and the source audio. `ggml-base.en.bin` is a good balance for English speech; you can point `VIBE_MODEL_PATH` at another compatible model.
- YouTube videos are limited to 60 minutes and 500 MB, and live streams/playlists are rejected. Downloaded files are cached in `.vibe/media/` for 24 hours.
- Only download or transcribe content you have the rights to use.
- Sessions and uploaded files are not persisted. A refresh starts clean.
- Whisper segments are merged into editable sentence clips; timestamps come from Whisper.
