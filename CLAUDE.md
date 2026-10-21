# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

HearType is a local-first English listening drill. The user uploads a video/audio file or pastes a YouTube link (fetched with yt-dlp for playback); uploaded files and YouTube links are transcribed by a local Vibe (whisper.cpp) server, with YouTube's English captions as the fallback; the app groups the text into sentences; the learner listens to each sentence from the original media and types it. The app is Next.js 16 (App Router), React 19, and TypeScript. The previous zero-dependency single-file version is archived under `legacy/`.

## Commands

- `npm install`
- `npm run setup:vibe` — downloads vibe-server v0.6.10, ffmpeg, yt-dlp, and `ggml-base.en.bin` into `.vibe/` (gitignored). Run once.
- `npm run dev` — http://127.0.0.1:3100. Port 3100 avoids another local dev app on 3000.
- `npm run build` / `npm run start` — production build and server, also on 3100.
- `npm test` — Node test runner with `--experimental-strip-types`; covers sentence/caption grouping, typing slots and word states, word timing, transcript source selection, scoring, media range parsing, YouTube URL validation, and the legacy zip parser.
- `npm run typecheck`.
- No linter is configured.

## How it fits together

- `app/page.tsx` (client) owns the screen and media lifecycle: setup → practice → results. It accepts a `PlayableSource` (`{ file }` for uploads, `{ url }` for YouTube), creates and revokes an object URL only for uploads, remounts `PracticeScreen` on restart with `sessionKey`, and scrolls to the top whenever the screen or session changes.
- `components/SetupScreen.tsx`: supports two sources. It selects or drops one media file and POSTs it to `/api/transcribe`; or takes a YouTube URL and POSTs it to `/api/youtube`. Both show processing status, then an editable sentence list (time range + text) and Start. It aborts an in-flight request when the source is replaced or cancelled. The ready summary shows whether the text came from YouTube captions or Vibe.
- `app/api/transcribe/route.ts` (Node runtime): parses multipart, validates the size, calls `transcribeFile()`, and returns `{ sentences }` or `{ error }` with an HTTP status.
- `app/api/youtube/route.ts`: validates the URL, downloads the video with yt-dlp into `.vibe/media/`, then uses `chooseTranscript()` to prefer `transcribePath()` with Vibe and fall back to `fetchYouTubeCaptions()`. Returns `{ title, mediaUrl, source, sentences }`. The player uses the same `/api/media/[id]` URL.
- `app/api/media/[id]/route.ts`: streams the cached MP4 with HTTP range support so the browser can seek per sentence. IDs are allowlisted; only `.vibe/media/<id>.mp4` is served.
- `lib/vibe.ts` (server-only): manages a singleton local vibe-server through `globalThis.__hearTypeVibe`. It spawns `serve --host 127.0.0.1 --port 0 --exit-with-parent true` from `.vibe/`, parses the ready JSON line, loads the model via `/v1/models/load` (CPU by default; `VIBE_GPU=1` tries GPU), health-checks and restarts once, and forwards uploads to `/v1/audio/transcriptions` with `response_format=verbose_json`, `language=en`, `word_timestamps=true`, and `max_segment_len=1`. `transcribePath()` wraps `openAsBlob()` so downloaded videos are not read into memory. `VIBE_SERVER_URL` attaches to an already running server. Never import this module into a client component. The `turbopackIgnore` comments on dynamic paths keep the build from tracing the whole project.
- `lib/youtube.ts` (server-only): validates the URL through `lib/youtube-url.ts`, rejects playlists/live videos, enforces the duration and size caps, runs yt-dlp with `execFile` (no shell), prefers H.264, caches the MP4, and removes cache files older than 24 hours. `lib/youtube-url.ts` is pure and shared with the client and tests.
- `lib/youtube-captions.ts` (server-only): wraps the `youtube-transcript` package, requests English captions with a 20-second timeout per request, and passes the cues to `buildCaptionSentences()`. The YouTube route uses this only when Vibe fails.
- `lib/sentences.ts`: converts Whisper word segments into sentence clips and keeps each word's timing. It strips `[tags]`, `(tags)`, and speaker dashes; drops empty or non-speech words; attaches punctuation-only words to the previous word; and ends a sentence at terminal punctuation, a speaker dash, a pause over 0.8 seconds, or the 10-second / 160-character caps. `buildCaptionSentences()` groups YouTube caption cues by pause and the same 10-second / 160-character cap; it infers milliseconds versus seconds from cue durations, drops non-speech cues, and trims overlapping clip ends. Caption sentences carry no word timings.
- `lib/word-timing.ts` (client-safe): `estimateWordTimings()` spreads a sentence span across words by length when the source has no timings; `resolveWordTimings()` uses source words only while they match the sentence text and otherwise estimates; `activeWordIndex()` returns the last word whose start is at or before the current media time.
- `lib/typing.ts` (client-safe): `buildTypingLayout()` randomly reveals about half of the sentence's typeable words as clues and leaves at least one fully blank; punctuation stays visible. `seededRandom()` keeps each clip's clue selection stable across revisits. `addedWrongSlots()` counts the wrong keys a paste or edit adds. `evaluateTyping()` returns per-character slot states and per-word states: clue for a fully shown word, green for a clean completed hidden word, yellow for completed after a corrected mistake, and red only when a completed hidden word still contains a wrong letter. An unfinished hidden word keeps correct letters white and shows only the wrong slot red. It also builds the reconstructed answer used by the results screen.
- `lib/listening.ts`: `formatTime()` and `scoreSession()` (correct, first try, missed, wrong keys, and perfect only when every clip is correct; reached versus unseen is tracked).
- `components/PracticeScreen.tsx`: owns clips, current index, typed characters, per-word mistake history, reveal seeds, playback speed, video visibility, and timers (kept in refs). One `<video>` element plays both video and audio; `loadedmetadata` switches to the audio stage when `videoWidth === 0`. Each sentence seeks to its `start`; a `requestAnimationFrame` loop stops and rewinds at `end` and updates the spoken-word highlight. The current spoken word gets a `spoken` background while hidden letters stay hidden. The session starts with a 3 × 800 ms countdown; a hidden input captures every key, with spaces and punctuation filled automatically. Clue words are shown whole at the same font size as typed words; every other word is a whole-word slot. A wrong key buzzes and marks its slot red; completed words turn green/yellow/red as above. A correct sentence shows a Continue button instead of auto-advancing; Enter (from the input or the button) or a click advances. Next and End session commit a matching typed answer before moving on. Attempts count wrong key presses, not sentence submissions. Controls sit inside the video: play/pause, repeat, speed, a seek slider for the current sentence, volume, and Audio only; Previous and Next flank the typing card. Controls: speed selector (0.5–1.5×), Audio only toggle (hides the video and shows the animated audio wave), Clear input (resets the typed answer and word colors but keeps the wrong-key count), and Start from beginning (`onRestart`, which remounts the practice with fresh clips).
- `components/ResultsScreen.tsx`: score ring, stats (including wrong keys), per-sentence breakdown, and focus moved to the result heading on mount.

## Data and configuration

- Media never leaves the local machine; it is sent only to the Vibe server running on `127.0.0.1`. YouTube media is transcribed locally with Vibe; captions are fetched from YouTube as text only when Vibe fails. The browser keeps the original file URL for playback. Sessions are not persisted.
- `.vibe/` contains the native server, ffmpeg, yt-dlp, the Whisper model, and the 24-hour YouTube media cache; it is gitignored. `scripts/setup-vibe.mjs` pins the server/model downloads, verifies their SHA-256 checksums, and fetches the latest yt-dlp. `.env.example` documents overrides (`VIBE_SERVER_URL`, `VIBE_SERVER_PATH`, `VIBE_MODEL_PATH`, `VIBE_GPU`, `VIBE_LANGUAGE`, `MAX_UPLOAD_MB`, `MAX_YOUTUBE_MINUTES`, `YT_DLP_PATH`, `VIBE_FFMPEG_PATH`).
- Uploads and YouTube downloads go through Next rather than directly to Vibe to avoid CORS; the 500 MB limit is RAM-bound. The downloaded YouTube file is streamed from disk to Vibe with `openAsBlob`.
- Tests: `test/sentences.test.mjs`, `test/typing.test.mjs`, `test/listening.test.mjs`, `test/youtube-url.test.mjs`, `test/youtube-captions.test.mjs`, `test/media-range.test.mjs`, `test/word-timing.test.mjs`, `test/transcript-source.test.mjs`, and the archived `legacy/test/zip.test.mjs`. The suite relies on `"type": "module"` and Node 22.15+ type stripping.

## Conventions

- Keep it local-first. Do not add cloud transcription, third-party uploads, or persistence of user media.
- Keep UI dependencies at zero; styles live in `app/globals.css` (derived from the legacy design). Do not add a component library.
- Server-only work belongs in `lib/vibe.ts`, `lib/youtube.ts`, and route handlers. Client components must not import Node APIs.
- Keep YouTube support behind the host allowlist and `execFile` arguments. Never pass the URL to a shell, and never serve a file path that was not derived from a validated YouTube ID.
- Keep sentence grouping in `lib/sentences.ts`, the slot/word-state model in `lib/typing.ts`, media range parsing in `lib/media-range.ts`, and scoring in `lib/listening.ts`; tests import those modules directly.
- `legacy/` is an archive for reference only. The Next.js app is the product.
