# HearType

English listening practice built from your own videos.

Upload a clip or paste a public YouTube link. [Vibe](https://thewh1teagle.github.io/vibe/) transcribes uploads locally. YouTube links are downloaded for playback and can use Vibe or YouTube's English captions. Then you listen to each sentence and type it. A correct answer shows a Continue button; press Enter or click it to move on, and the final screen shows exactly what you missed.

Everything runs on your machine. No audio or video is sent to a cloud service.

## How it works

- **Upload or link** — choose a video/audio file (up to 500 MB), or paste a public YouTube link. YouTube videos are fetched with `yt-dlp` (the same downloader the Vibe desktop app uses) and cached in `.vibe/media/` for playback.
- **Get the text** — uploads are transcribed by the local `vibe-server` and Whisper. For a YouTube link, choose Vibe or YouTube's English captions; the chosen source is tried first and the other is the fallback. Whisper word segments and caption cues are grouped into sentence-sized clips; a long sentence stays one clip, and short clips are merged with a neighbour when the combined clip stays under the limits.
- **Reuse** — the most recent upload or YouTube video and its transcript stay in this browser; use **Use recent** on the setup screen to start again without processing.
- **Review** — fix any transcription mistakes, remove bad lines, set the **Clue words** percentage (default 50%), then start. The sentence list starts collapsed; use **Show list** to edit it.
- **Practice** — the media is served locally with HTTP range requests and plays one sentence at a time by seeking to its timestamps. The word being spoken is highlighted in the typing display, and a hidden word glows only as its blank slots. Playback runs a short tail past the last word so a fast final word is not cut off. A sentence edited in Setup shows a **Custom sentence** chip and uses estimated word timing. Controls sit inside the video: play/pause, a seek slider for the current sentence, volume, speed, repeat, and Audio only. Previous and Next flank the typing card. The chosen percentage of the sentence's words is shown in full (50% by default); filler responses such as “hmm” are always shown; the other words appear as underlined character slots. A clip made only of fillers is shown in full and marked done. Each hidden word is its own field: the caret stays at the end of the selected word, and ←/→ switch to the previous or next word. Click any slot to select its word. Typing appends; a full word moves you to the next word automatically. Backspace erases from the end, and on an empty word it erases the previous word's last letter, so holding it clears every word back to the first. Every key is checked: a wrong key buzzes, shakes that slot, and turns it red; spaces and punctuation fill themselves; completed words turn green when clean, yellow when corrected, or red when a wrong letter remains. A correct sentence shows a Continue button; press Enter or click it to move on. Use the speed selector (0.5–1.5×), the Audio only toggle to hide the video and show the audio wave, Clear input to retype the sentence, and Start from beginning to reset the session.
- **Review the session** — accuracy, first-try count, missed sentences, wrong keys, and a sentence-by-sentence breakdown. Adjust **Clue words** here and restart to try the same media with a different mix.

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

Open **http://127.0.0.1:3100**.

The setup command downloads `vibe-server v0.6.10`, `yt-dlp`, ffmpeg, and `ggml-base.en.bin` into `.vibe/` (ignored by git). It verifies pinned SHA-256 checksums for the server and model; a custom `VIBE_SERVER_VERSION` and the latest `yt-dlp` are not pinned. The first transcription also loads the model, so it can take a little longer than later ones.

### Production

```bash
npm run build
npm run start
```

This app is designed to run locally because it starts a native Vibe process. It is not suitable for serverless hosting as-is.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Start Next.js on 127.0.0.1:3100 |
| `npm run build` | Production build |
| `npm run start` | Start the production server on 127.0.0.1:3100 |
| `npm test` | Run sentence, scoring, YouTube URL, caption, typing, range, playback, and word timing tests |
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
app/api/youtube/     YouTube download + caption/transcription endpoint
app/api/media/[id]/  Range-enabled local media streaming
components/          Setup, practice, and results screens
lib/vibe.ts          Server-only Vibe process management and transcription
lib/youtube.ts       yt-dlp download, validation, caching, and cleanup
lib/youtube-captions.ts YouTube caption fetch and grouping boundary
lib/youtube-url.ts   YouTube URL allowlist/normalisation
lib/sentences.ts     Whisper word segments → timed sentence clips (10s / 160 chars)
lib/word-timing.ts   Word timing estimate, fallback, and active-word lookup
lib/playback.ts      Clip playback tail so the last word is not cut off
lib/typing.ts        Whole-word clue layout and per-key word states
lib/listening.ts     Scoring and time formatting
lib/media-range.ts   HTTP range parsing for local media playback
lib/transcript-source.ts Vibe/captions preference and fallback policy
lib/recent.ts        Browser-local recent session cache (IndexedDB)
scripts/setup-vibe.mjs
test/                Sentence, scoring, YouTube URL, caption, typing, range, playback, word timing, and legacy parser tests
legacy/              Previous zero-dependency single-file version (reference only)
```

The legacy app is kept for reference and has its own sample pack in `legacy/Videos/`. The Next.js app does not use it.

## Notes

- `vibe-server` handles one transcription at a time; concurrent requests receive a busy response.
- Transcription quality depends on the model and the source audio. `ggml-base.en.bin` is a good balance for English speech; you can point `VIBE_MODEL_PATH` at another compatible model.
- YouTube videos are limited to 60 minutes and 500 MB, and live streams/playlists are rejected. The downloaded media uses the chosen transcript source first (Vibe by default); if it fails, the other source is used. Downloaded files are cached in `.vibe/media/` for 24 hours.
- Only download or transcribe content you have the rights to use.
- The most recent upload or YouTube video and its transcript are stored in this browser (IndexedDB) until the next successful source; use **Use recent** to reuse them. Other sessions are not persisted.
- Whisper words and caption cues are grouped into editable sentence clips of at most 10 seconds / 160 characters; timestamps come from the source.
