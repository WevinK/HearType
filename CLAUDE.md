# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

ListeningType is a local-first English listening drill. The user uploads a video or audio file; a local Vibe (whisper.cpp) server transcribes it; the app groups the transcript into sentences; the learner listens to each sentence from the original media and types it. The app is Next.js 16 (App Router), React 19, and TypeScript. The previous zero-dependency single-file version is archived under `legacy/`.

## Commands

- `npm install`
- `npm run setup:vibe` — downloads vibe-server v0.6.10, ffmpeg, and `ggml-base.en.bin` into `.vibe/` (gitignored). Run once.
- `npm run dev` — http://localhost:3100. Port 3100 avoids another local dev app on 3000.
- `npm run build` / `npm run start` — production build and server, also on 3100.
- `npm test` — Node test runner with `--experimental-strip-types`; covers sentence grouping, scoring/matching, and the legacy zip parser.
- `npm run typecheck`.
- No linter is configured.

## How it fits together

- `app/page.tsx` (client) owns the screen and media lifecycle: setup → practice → results. It creates and revokes the media object URL, remounts `PracticeScreen` on restart with `sessionKey`, and scrolls to the top whenever the screen or session changes.
- `components/SetupScreen.tsx`: selects or drops one media file, POSTs it to `/api/transcribe`, shows processing status, then an editable sentence list (time range + text) and the Start button. It aborts an in-flight request when the file is replaced or cancelled.
- `app/api/transcribe/route.ts` (Node runtime): parses multipart, validates the size, calls `transcribeFile()`, and returns `{ text, sentences }` or `{ error }` with an HTTP status.
- `lib/vibe.ts` (server-only): manages a singleton local vibe-server through `globalThis.__listeningTypeVibe`. It spawns `serve --host 127.0.0.1 --port 0 --exit-with-parent true` from `.vibe/`, parses the ready JSON line, loads the model via `/v1/models/load` (CPU by default; `VIBE_GPU=1` tries GPU), health-checks and restarts once, and forwards uploads to `/v1/audio/transcriptions` with `response_format=verbose_json` and `language=en`. `VIBE_SERVER_URL` attaches to an already running server. Never import this module into a client component. The `turbopackIgnore` comments on the dynamic binary/model paths keep the build from tracing the whole project.
- `lib/sentences.ts`: converts Whisper segments into sentence clips. It strips `[tags]`, `(tags)`, and speaker dashes; skips empty or invalid segments; and joins a continuation when the current text lacks terminal punctuation, the next segment starts lowercase, no new speaker is marked, and the result stays within 20 seconds / 240 characters.
- `lib/listening.ts`: `normalize()` (NFKC, lowercase, apostrophes removed, all other punctuation → space), `formatTime()`, and `scoreSession()` (correct, first try, missed, wrong tries, and perfect only when every clip is correct; reached versus unseen is tracked).
- `components/PracticeScreen.tsx`: owns clips, current index, answer, and timers (kept in refs). One `<video>` element plays both video and audio; `loadedmetadata` switches to the audio stage when `videoWidth === 0`. Each sentence seeks to its `start`; a `requestAnimationFrame` loop stops and rewinds at `end`. The session starts with a 3 × 800 ms countdown; a correct answer auto-advances after 700 ms; typing is checked after a 450 ms pause or on Enter. Next and End session commit a matching typed answer before moving on.
- `components/ResultsScreen.tsx`: score ring, stats, per-sentence breakdown, and focus moved to the result heading on mount.

## Data and configuration

- Media never leaves the local machine; it is sent only to the Vibe server running on `127.0.0.1`. The browser keeps the original file URL for playback. Sessions are not persisted.
- `.vibe/` contains the native server, ffmpeg, and Whisper model and is gitignored. `scripts/setup-vibe.mjs` pins the server/model downloads; `.env.example` documents overrides (`VIBE_SERVER_URL`, `VIBE_SERVER_PATH`, `VIBE_MODEL_PATH`, `VIBE_GPU`, `VIBE_LANGUAGE`, `MAX_UPLOAD_MB`).
- Uploads go through Next rather than directly to Vibe to avoid CORS; the limit is 500 MB and is RAM-bound.
- Tests: `test/sentences.test.mjs`, `test/listening.test.mjs`, and the archived `legacy/test/zip.test.mjs`. The suite relies on `"type": "module"` and Node 22.15+ type stripping.

## Conventions

- Keep it local-first. Do not add cloud transcription, third-party uploads, or persistence of user media.
- Keep UI dependencies at zero; styles live in `app/globals.css` (derived from the legacy design). Do not add a component library.
- Server-only work belongs in `lib/vibe.ts` and route handlers. Client components must not import Node APIs.
- Keep sentence grouping in `lib/sentences.ts` and matching/scoring in `lib/listening.ts`; tests import those modules directly.
- `legacy/` is an archive for reference only. The Next.js app is the product.
