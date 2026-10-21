# Word highlight during playback — design

Date: 2026-10-21
Status: Proposed for review

## 1. Goal

The learner hears one sentence at a time and types it. Today the media plays the
sentence, but nothing on screen says which word is currently being spoken. Add a
word-level highlight to the existing typing display so the learner can follow the
audio without seeing the words the drill hides. The highlight must never reveal
the letters of a hidden word.

Success: the spoken word is marked while the clip plays; a hidden word is marked
only by its blank word block, never by its letters; uploads and YouTube links
follow the audio closely; sentences without source word timings still get a
reasonable highlight.

## 2. Decisions

- The highlight lives in the typing display, not in a second subtitle line.
- Hidden words glow as their blank character slots; clue words glow as text.
- The feature is always on during playback. No toggle.
- YouTube source order flips: download, then Vibe transcription, then YouTube
  captions only if Vibe fails. Uploads already use Vibe.
- Word timings are exact from Vibe. They are estimated for caption-fallback
  sentences and for sentences edited in Setup.
- A sentence ends at terminal punctuation, a speaker dash, a pause over 0.8 s,
  or the existing 10 s / 160-character caps.
- The active word is the last word whose start time is at or before the current
  media time. It stays marked through pauses and until the clip ends.
- The highlight is a static background wash, not an animation.

## 3. User experience

While the sentence clip plays, the current word's block gets a soft accent
background and rounded corners. The existing typing-cursor class stays separate,
so the spoken word and the word being typed can be marked independently.

- Pausing leaves the last spoken word marked.
- Repeating or seeking recomputes the highlight on the next frame.
- The countdown has no highlight.
- Audio-only mode behaves exactly like video.
- The playback speed selector needs no special handling; media time is
  unaffected by playback rate.
- No new controls and no second place to read the sentence.

## 4. Data model

In `lib/types.ts`:

```ts
export type SentenceWord = {
  text: string;
  start: number;
  end: number;
};

export type Sentence = {
  start: number;
  end: number;
  text: string;
  words?: SentenceWord[];
};
```

- `sentence.text` is always exactly its words joined by one space. This keeps the
  timing list aligned with the typing layout's whitespace split.
- `Clip` extends `Sentence`, so clips inherit `words`.
- Caption sentences omit `words`.
- The optional field flows through both API responses without a shape change.

## 5. Server pipeline

### 5.1 Uploads (Vibe)

`lib/vibe.ts` adds two form fields to every transcription request:

```
word_timestamps=true
max_segment_len=1
```

Vibe then returns roughly one segment per word, with start/end times in seconds.
The probe on this machine returned 36 segments for 25 s of audio, including one
empty leading segment and a `[Music]` tag to drop.

### 5.2 YouTube links

`app/api/youtube/route.ts` keeps the download first because the media is needed
for playback either way. Then:

1. `transcribePath(video.filePath)` with Vibe. On success, `source: 'vibe'` and
   the sentences carry word timings.
2. If Vibe throws, log the failure and call `fetchYouTubeCaptions(video.id)`.
   On success, `source: 'captions'` and the sentences have no word timings.
3. If captions also fail, return one error that names both failures. Keep the
   Vibe error's HTTP status when it is a `VibeError`; otherwise use the caption
   error's status, or 502.

Expected cost, measured on this machine with the model loaded: Vibe runs at
about 17× real time, so a 10-minute video is roughly 35 s and a 60-minute video
roughly 3.5 minutes, after the download. The first run additionally loads the
model. Captions are only the fallback and cost about 1–2 s after the download.
Using Vibe first may produce less accurate text than human-written YouTube
captions; the Setup editor remains the correction path.

### 5.3 Word-based sentence grouping

`buildSentences()` in `lib/sentences.ts` now consumes Vibe word segments. For
each segment:

- Require finite `start` and `end` with `end >= start`. Zero-length words are
  valid and must not be dropped.
- Detect a speaker marker in the original segment text before cleaning: a
  standalone dash (`-`, `–`, `—`) or a leading dash followed by text. Close the
  current sentence, strip the dash, and continue with the remaining text.
- Clean the remaining text with the existing `cleanText()`. Drop empty results
  (tags, parentheticals, music symbols).
- If a segment still contains whitespace-separated tokens, split it into words
  and distribute its duration proportionally by word length. This keeps the
  word list aligned with the sentence text even if the server groups tokens.
- Attach a punctuation-only word (no letters or numbers) to the previous word
  in the current sentence; extend that word's text and end time. Drop it if the
  sentence has no previous word.
- Start a new sentence when any of these is true:
  - the current sentence text ends with terminal punctuation
    (`[.!?]` plus closing quotes or brackets);
  - the next word starts more than 0.8 s after the current sentence's end;
  - adding the word would make the sentence longer than 10 s;
  - adding the word would make the text longer than 160 characters.
- Otherwise append the word.

A finished sentence is:

- `start` = first word start;
- `end` = last word end, with a minimum of `start + 0.1` so playback always has
  a positive length;
- `text` = words joined by one space;
- `words` = the word list with their original timings.

This replaces the phrase-based "next segment starts lowercase" merge on the Vibe
path, so initial sentence boundaries for uploads and YouTube-Vibe will shift
slightly. The Setup editor remains the way to fix a bad boundary.

### 5.4 Caption fallback

`buildCaptionSentences()` is unchanged and returns sentences without `words`.
The client estimates timings for those sentences.

## 6. Client timing and sync

### 6.1 New module: `lib/word-timing.ts`

- `estimateWordTimings(text, start, end): SentenceWord[]`
  Splits the text on whitespace, weights each word by its Unicode character
  count, and distributes `end - start` across the words in order. The last word
  ends exactly at `end`. Returns `[]` when there are no words or `end <= start`.
- `resolveWordTimings(sentence): SentenceWord[]`
  Uses `sentence.words` only when its texts match the sentence text's whitespace
  split exactly and the counts match. Otherwise estimates from the sentence's
  current text, start, and end. This covers caption fallback, text edited in
  Setup, and any stale source data.
- `activeWordIndex(words, time): number`
  Returns the index of the last word whose `start <= time`, or `-1` before the
  first word. Ties use the later word. The index stays on the last word after
  its end until the clip ends.

The typing layout and the resolved word list use the same whitespace split, so
their indices line up.

### 6.2 Setup edits

`SetupScreen.updateSentence` sets `words: undefined` when the text changes. The
practice screen then estimates from the edited text. Removing a sentence needs
no special handling.

### 6.3 PracticeScreen sync

- Resolve timings for the current clip with `useMemo` over the text, start, end,
  and words. Keep the result in a ref for the animation-frame loop.
- In the existing loop, read `video.currentTime`, compute `activeWordIndex()`,
  and update the spoken-word state only when the index changes. Compare against
  a ref so the state setter is not called every frame.
- Reset the spoken word to `-1` in `goTo`, so a new clip starts clean. The first
  play frame sets the applicable word.
- The existing loop already runs only while playing, so pausing needs no extra
  handling.
- Render `spoken` on the matching `evaluation.words` span. Keep the existing
  `active` class for the typing cursor.

### 6.4 Styling

Add `.typing-word.spoken` in `app/globals.css`:

- a soft accent background and rounded corners, using the existing theme
  variables;
- no padding or margin changes, so the sentence does not shift;
- hidden character slots stay transparent;
- no animation; an optional short background transition is acceptable.

## 7. Edge cases and error handling

- **Zero-duration words:** kept; the next word becomes active when its start is
  reached. Two words with the same start resolve to the later one.
- **Before the first word:** no highlight.
- **After the last word:** the last word stays marked until the clip ends.
- **Empty sentence or no letters/numbers:** no words and no highlight. Setup
  already blocks starting with such a sentence.
- **Countdown/paused:** no movement; a paused clip keeps the last mark.
- **Video playback error:** the existing message; no highlight.
- **Vibe failure on YouTube:** captions fallback. If both fail, the combined
  error describes both.
- **First Vibe run:** the existing processing screen and model-load delay are
  unchanged.
- **Clip end/rewind:** the loop stops; the next clip resets the highlight.

## 8. Performance

The highlight scans at most a few dozen words per frame and updates React state
only when the active word changes, so its cost is negligible. The meaningful cost is
the new Vibe-first order for YouTube, which is a deliberate trade of processing
time for exact word timings. Uploads and the caption fallback make no extra
network requests.

## 9. Testing

Unit tests:

- `test/sentences.test.mjs`: words group into sentences; punctuation attaches to
  the previous word; a pause over 0.8 s splits; the 10 s and 160-character caps
  split; a speaker dash splits; tags and empty segments are dropped;
  zero-duration words survive; `text` and `words` stay aligned.
- New `test/word-timing.test.mjs`: estimation (proportional, single word, last
  end, empty/zero-length), resolution (source words, edited text, count
  mismatch), and active-word lookup (before, between, on a start, equal starts,
  after the last word).
- The new test file is added to the `npm test` command.
- The existing suite stays green.

Manual browser checks:

- Upload a clip: the highlight tracks the audio; hidden letters never appear;
  pause, repeat, speed, and audio-only behave correctly.
- YouTube with Vibe: the highlight tracks; the ready summary says Vibe.
- Force the caption fallback (make Vibe unavailable): the estimated highlight
  works; the summary says captions.
- Edit a sentence in Setup: the highlight still works using estimated timing.
- Countdown, last sentence, and restart behave correctly.

## 10. Out of scope

- Parsing YouTube's `<s>` word timings; not needed while Vibe is preferred.
- Revealing hidden words, a karaoke subtitle line, or a feature toggle.
- Aligning Vibe timings to a different caption text.
- Persisting sessions or timings.
- GPU or model tuning.

## 11. Files touched

- `lib/types.ts` — `SentenceWord`, optional `Sentence.words`.
- `lib/vibe.ts` — request `word_timestamps` and `max_segment_len`.
- `lib/sentences.ts` — word-based grouping, punctuation attachment, speaker
  dashes, zero-duration words.
- `app/api/youtube/route.ts` — Vibe first, captions fallback, combined error.
- `components/SetupScreen.tsx` — clear `words` on text edit.
- `lib/word-timing.ts` — new estimation, resolution, and active-word helpers.
- `components/PracticeScreen.tsx` — resolve timings, spoken-word state, frame
  loop update, `spoken` class.
- `app/globals.css` — `.typing-word.spoken`.
- `package.json` — add the new test file.
- `test/sentences.test.mjs` — word-segment coverage.
- `test/word-timing.test.mjs` — new tests.
- `README.md`, `CLAUDE.md` — source order, word highlight, new module, tests.

## 12. Risks

- Whisper `base.en` text can be less accurate than human YouTube captions. The
  learner can edit sentences, but the default text quality may drop for videos
  with good captions.
- Sentence boundaries change on the Vibe paths. Existing uploads may produce
  different clips; the editor is the escape hatch.
- Estimated timing for the caption fallback and edited sentences ignores
  pauses, so those highlights are approximate.
- Very short or zero-duration words can pass quickly; the start-time rule keeps
  pauses from flickering but cannot make a silent token longer.
