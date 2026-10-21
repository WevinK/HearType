# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

ListeningType is a zero-dependency, single-page English listening/typing drill. Users load video clips, audio clips, or zip packs, hear a word/line in each, type it, and a correct answer auto-advances to the next clip. Markup, styles, and logic all live in `index.html`. There is no package manager, build step, or lint. One dependency-free parser test lives in `test/zip.test.mjs`.

## Run & verify

- Open `index.html` directly in a browser, or serve the folder: `python -m http.server 8000` → http://localhost:8000
- Chrome or Edge recommended. Folder loading uses a `webkitdirectory` file input; zip packs need `DecompressionStream("deflate-raw")`, available in current Chrome/Edge/Firefox/Safari.
- A real sample pack lives in `Videos/you_are_a_toy.zip`: 20 MP3 dialogue lines with `.txt` captions. Load it via **Open .zip** and expect 20 audio clips, captions as answers, and Buzz/Woody speaker labels.
- MP4 (H.264), MP3, and WebM are the safest formats; unsupported codecs trigger a toast.
- Test: `node --test test/zip.test.mjs`. This needs Node 22+ for `DecompressionStream`; it evaluates the real inline parser against the sample pack. No install step.
- Manual test: load 2–3 clips or the sample pack, confirm the derived/captioned answers, Start, wait through the 3-count, type an answer and confirm auto-advance, finish, and check the breakdown.

## Architecture

- Three screens (`#setupScreen`, `#playScreen`, `#resultScreen`) inside one `<main>`, toggled by `showScreen()`; no router or framework.
- Loading (`loadFiles()`): direct video/audio files and zip packs can be mixed. Direct media get a target from the filename (`deriveTarget()`: `ice-cream.mp4` → "ice cream"). Zip parsing lives in the `zip packs` section.
- Zip packs: `extractPack()` reads the central directory, loads `.txt` sidecars, and uses `caption="..."` / `dub_characters=[...]` as the target and speaker. If any media candidate has a caption, only captioned media are loaded (this skips full scene videos, backing tracks, and artwork); otherwise every audio/video entry is loaded with a filename target. Zips over 256 MB, single entries over 256 MB, and unpacked totals over 512 MB are rejected; unreadable clips are skipped and reported. The parser is deliberately minimal: store + deflate methods, no Zip64, encryption, or multi-part zips.
- Flow: selection → `startSession()` resets scores and runs a 3-second countdown (session start only) → clips play with prev/repeat/pause/next → a correct match auto-advances after 700 ms → `finishSession()` renders results.
- `state.clips` entries hold `{name, path, kind, speaker, url, target, attempts, answer, lastWrong, result, skippedOnce, reached}`. `kind` is `audio` or `video`; the audio stage is corrected from `video.videoWidth` once metadata loads, so audio-only MP4/WebM files get the audio UI. `result` is `pending | correct | skipped`. Prev can revisit and solve an earlier clip; Next or End session commits a currently typed correct answer first (Next otherwise marks a pending clip skipped). Results distinguish reached-but-unanswered clips from never-reached ones. Scoring: percentage = correct / total; "First try" excludes clips with wrong tries or a prior skip; "Missed" = skipped + pending; "Wrong tries" sums `attempts`; only a fully correct session shows 100% and "Perfect ear."
- Answer checking uses `normalize()` (NFKC, lowercase, apostrophes removed, all other punctuation → space); keep filename parsing, caption parsing, target editing, and typed answers using it. Typing is checked after a 450 ms pause (Enter checks immediately) so a short target is not accepted as a prefix of a longer word.
- Countdown and auto-advance use `state.countdownToken` / `state.advanceTimer`. `cancelCountdown()` invalidates the token and must run whenever leaving the play screen; `finishSession()`, `disposeMedia()`, and session restarts already call it.
- Object URLs are created in `loadFiles()`, revoked in `disposeMedia()` (new selection / Clear) and `removeClip()`. Preserve that lifecycle for both direct files and zip-extracted blobs.
- The custom transport controls drive the `<video>` element directly; native `controls` are intentionally off. The audio overlay and video surface both call `togglePlayback()`.

## Conventions

- Keep the app a single self-contained `index.html` with no dependencies or build step; it is meant to run offline by double-click.
- Do not add a zip library; the in-file parser intentionally covers the pack format and common store/deflate zips only.
- Style through the CSS variables at `:root`; dark theme only. `[hidden] { display: none !important; }` is load-bearing for screen switching and icon toggles.
- Results rows render filenames/targets with `textContent`; filenames and zip metadata are untrusted input, so do not switch them to `innerHTML`.
