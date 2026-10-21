# Word Highlight During Playback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mark the word currently being spoken in the practice typing display, without revealing hidden letters.

**Architecture:** Vibe returns word-level segments; `buildSentences` groups them into clips carrying optional `words`; the client resolves or estimates timings and drives a spoken-word index from the existing media frame loop.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Node test runner with `--experimental-strip-types`.

**Spec:** `docs/superpowers/specs/2026-10-21-word-highlight-design.md`

## Global Constraints

- No new dependencies. UI dependencies stay at zero; styles live in `app/globals.css`.
- Node 22.15 or newer; tests run with `--experimental-strip-types`.
- Server-only work belongs in `lib/vibe.ts`, `lib/youtube.ts`, `lib/transcript-source.ts`, and route handlers. Client components must not import Node APIs.
- `lib/sentences.ts` owns sentence grouping; `lib/word-timing.ts` owns estimate/resolve/active-word logic; tests import those modules directly.
- YouTube order: download → Vibe → captions fallback. `source` remains `'vibe' | 'captions'`.
- Sentence caps stay 10 seconds / 160 characters; the word pause threshold is 0.8 seconds. The active word is the last word whose `start <= currentTime`.
- The highlight never reveals hidden letters. `spoken` is a background wash, separate from the typing-cursor `active` class.
- Run `npm test`, `npm run typecheck`, and `npm run build` before the final task commit.

**Prerequisite:** The working tree currently holds an uncommitted audit-fix set across 19 files. Resolve it before Task 1 — commit it separately or stash it — so each task commit here contains only that task's changes. Do not fold the audit fixes into this plan's commits.

## Review Focus

1. **Hidden letters stay hidden.** The spoken background must not make a blank slot's letter visible. Verified visually in Task 4.
2. **Both transcript sources fail.** Vibe and captions both throwing must produce one error naming both failures and keeping the Vibe status. Pinned by `test/transcript-source.test.mjs` in Task 3.
3. **Caption fallback has no word timings.** A sentence without `words` must still highlight using estimated timing. Pinned by the estimate tests in Task 1 and the manual fallback check in Task 4.
4. **Edited sentence text invalidates source timings.** Editing text in Setup must fall back to estimation. Pinned by the resolve tests in Task 1 and the manual edit check in Task 4.
5. **Pause, repeat, and clip end.** The highlight must not stick to the wrong word or fail to reset. Verified manually in Task 4.

---

### Task 1: Word timing model and helpers

**Files:**
- Modify: `lib/types.ts`
- Create: `lib/word-timing.ts`
- Create: `test/word-timing.test.mjs`
- Modify: `package.json` (add the test file to the `test` script)

**Interfaces:**
- Produces:
  - `type SentenceWord = { text: string; start: number; end: number }`
  - `type Sentence = { start: number; end: number; text: string; words?: SentenceWord[] }`
  - `estimateWordTimings(text: string, start: number, end: number): SentenceWord[]`
  - `resolveWordTimings(sentence: Sentence): SentenceWord[]`
  - `activeWordIndex(words: readonly SentenceWord[], time: number): number`
- Consumes: nothing.

- [ ] **Step 1: Write the failing tests**

Create `test/word-timing.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activeWordIndex,
  estimateWordTimings,
  resolveWordTimings,
} from '../lib/word-timing.ts';

test('distributes a sentence duration by word length', () => {
  assert.deepEqual(estimateWordTimings('aa bbbb', 0, 6), [
    { text: 'aa', start: 0, end: 2 },
    { text: 'bbbb', start: 2, end: 6 },
  ]);
});

test('keeps word spans contiguous and ends at the sentence end', () => {
  const words = estimateWordTimings('one two three', 10, 16);

  assert.equal(words.length, 3);
  assert.equal(words[0].start, 10);
  assert.equal(words.at(-1).end, 16);
  assert.ok(words.every((word, i) => i === 0 || word.start === words[i - 1].end));
});

test('returns no timings for empty text or a non-positive span', () => {
  assert.deepEqual(estimateWordTimings('   ', 0, 5), []);
  assert.deepEqual(estimateWordTimings('hello', 5, 5), []);
});

test('uses source words while they match the sentence text', () => {
  const words = [
    { text: 'Hi', start: 0, end: 1 },
    { text: 'there', start: 1, end: 4 },
  ];
  const sentence = { start: 0, end: 4, text: '  Hi   there ', words };

  assert.equal(resolveWordTimings(sentence), words);
});

test('estimates after the sentence text is edited', () => {
  const words = [
    { text: 'Hi', start: 0, end: 1 },
    { text: 'there', start: 1, end: 4 },
  ];
  const result = resolveWordTimings({ start: 0, end: 4, text: 'Hi friend', words });

  assert.deepEqual(result.map((word) => word.text), ['Hi', 'friend']);
  assert.equal(result[0].start, 0);
  assert.equal(result.at(-1).end, 4);
});

test('finds the current word from its start time', () => {
  const words = [
    { text: 'one', start: 1, end: 2 },
    { text: 'two', start: 3, end: 4 },
  ];

  assert.equal(activeWordIndex(words, 0), -1);
  assert.equal(activeWordIndex(words, 1), 0);
  assert.equal(activeWordIndex(words, 2.5), 0);
  assert.equal(activeWordIndex(words, 3), 1);
  assert.equal(activeWordIndex(words, 99), 1);
  assert.equal(
    activeWordIndex(
      [
        { text: 'a', start: 1, end: 1 },
        { text: 'b', start: 1, end: 2 },
      ],
      1
    ),
    1
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --experimental-strip-types --test test/word-timing.test.mjs`
Expected: FAIL — `lib/word-timing.ts` does not exist or exports are missing.

- [ ] **Step 3: Add the types and implement the helpers**

In `lib/types.ts`, add `SentenceWord` and replace the existing `Sentence` type with the version below (it keeps `start`, `end`, and `text` and adds optional `words`):

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

Create `lib/word-timing.ts`:

```ts
import type { Sentence, SentenceWord } from './types';

export function estimateWordTimings(text: string, start: number, end: number): SentenceWord[] {
  const texts = text.trim().split(/\s+/).filter(Boolean);
  if (!texts.length || end <= start) return [];

  const weights = texts.map((word) => Array.from(word).length);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = start;

  return texts.map((word, index) => {
    const wordEnd =
      index === texts.length - 1 ? end : cursor + ((end - start) * weights[index]) / total;
    const timing = { text: word, start: cursor, end: wordEnd };
    cursor = wordEnd;
    return timing;
  });
}

export function resolveWordTimings(sentence: Sentence): SentenceWord[] {
  const texts = sentence.text.trim().split(/\s+/).filter(Boolean);
  if (
    sentence.words &&
    sentence.words.length === texts.length &&
    sentence.words.every((word, index) => word.text === texts[index])
  ) {
    return sentence.words;
  }
  return estimateWordTimings(sentence.text, sentence.start, sentence.end);
}

export function activeWordIndex(words: readonly SentenceWord[], time: number): number {
  let active = -1;
  for (let index = 0; index < words.length; index++) {
    if (words[index].start > time) break;
    active = index;
  }
  return active;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --experimental-strip-types --test test/word-timing.test.mjs`
Expected: PASS, 6/6.

- [ ] **Step 5: Add the test file to the suite and run everything**

Append `test/word-timing.test.mjs` to the `test` script in `package.json`.

Run: `npm test`
Expected: PASS, all tests including the 6 new ones.

- [ ] **Step 6: Commit**

```bash
git add lib/types.ts lib/word-timing.ts test/word-timing.test.mjs package.json
git commit -m "feat: add word timing helpers" -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: Word-based sentence grouping and Vibe word request

**Files:**
- Modify: `lib/sentences.ts`
- Modify: `lib/vibe.ts` (`transcribeBlob` form fields, around the `response_format` and `language` appends)
- Modify: `test/sentences.test.mjs`

**Interfaces:**
- Consumes: `estimateWordTimings`, `Sentence`, `SentenceWord` from Task 1.
- Produces: `buildSentences(segments: unknown): Sentence[]` where each sentence includes `words: SentenceWord[]`, `text === words.map(w => w.text).join(' ')`, and `start`/`end` span the words. `buildCaptionSentences` is unchanged and returns no `words`.

- [ ] **Step 1: Update the sentence tests**

Add these tests to `test/sentences.test.mjs`:

```js
test('groups word segments and preserves timings', () => {
  const sentences = buildSentences([
    { start: 0, end: 0.4, text: ' Hello,' },
    { start: 0.4, end: 1, text: ' welcome' },
    { start: 1, end: 1.3, text: ' to' },
    { start: 1.3, end: 1.7, text: ' the' },
    { start: 1.7, end: 2, text: ' course.' },
  ]);

  assert.equal(sentences.length, 1);
  assert.equal(sentences[0].text, 'Hello, welcome to the course.');
  assert.deepEqual(
    sentences[0].words.map((word) => word.text),
    ['Hello,', 'welcome', 'to', 'the', 'course.']
  );
  assert.equal(sentences[0].start, 0);
  assert.equal(sentences[0].end, 2);
});

test('drops empty and non-speech words', () => {
  const sentences = buildSentences([
    { start: 0, end: 0.1, text: '' },
    { start: 0.1, end: 0.5, text: ' [Music]' },
    { start: 1, end: 1.4, text: ' Hello' },
    { start: 1.4, end: 1.9, text: ' there.' },
  ]);

  assert.equal(sentences.length, 1);
  assert.equal(sentences[0].text, 'Hello there.');
  assert.equal(sentences[0].start, 1);
  assert.equal(sentences[0].end, 1.9);
});

test('splits after terminal punctuation', () => {
  const sentences = buildSentences([
    { start: 0, end: 0.5, text: ' Hello.' },
    { start: 0.5, end: 0.8, text: ' How' },
    { start: 0.8, end: 1, text: ' are' },
    { start: 1, end: 1.3, text: ' you?' },
  ]);

  assert.deepEqual(
    sentences.map((sentence) => sentence.text),
    ['Hello.', 'How are you?']
  );
});

test('splits after a pause over 0.8 seconds', () => {
  const sentences = buildSentences([
    { start: 0, end: 0.5, text: ' First' },
    { start: 1.4, end: 2, text: ' second.' },
  ]);

  assert.equal(sentences.length, 2);
});

test('splits at the ten-second cap', () => {
  const sentences = buildSentences([
    { start: 0, end: 5, text: ' This' },
    { start: 5, end: 10.5, text: ' continues' },
  ]);

  assert.equal(sentences.length, 2);
});

test('splits at the 160-character cap', () => {
  const long = 'a'.repeat(100);
  const sentences = buildSentences([
    { start: 0, end: 1, text: ` ${long}` },
    { start: 1, end: 2, text: ` ${long}` },
  ]);

  assert.equal(sentences.length, 2);
});

test('keeps zero-duration words', () => {
  const sentences = buildSentences([
    { start: 1, end: 1, text: ' Now,' },
    { start: 1, end: 1.2, text: ' you' },
    { start: 1.2, end: 1.8, text: ' listen.' },
  ]);

  assert.equal(sentences[0].text, 'Now, you listen.');
  assert.equal(sentences[0].words[0].start, 1);
  assert.equal(sentences[0].words[0].end, 1);
});

test('attaches punctuation-only words to the previous word', () => {
  const sentences = buildSentences([
    { start: 0, end: 0.5, text: ' Hello' },
    { start: 0.5, end: 0.6, text: ',' },
    { start: 0.7, end: 1.2, text: ' there' },
  ]);

  assert.equal(sentences[0].text, 'Hello, there');
  assert.equal(sentences[0].words[0].text, 'Hello,');
});

test('treats a standalone dash as a speaker change', () => {
  const sentences = buildSentences([
    { start: 0, end: 0.5, text: ' Hello' },
    { start: 0.5, end: 0.6, text: ' -' },
    { start: 0.7, end: 1.2, text: ' Not' },
    { start: 1.2, end: 1.8, text: ' whomever.' },
  ]);

  assert.deepEqual(
    sentences.map((sentence) => sentence.text),
    ['Hello', 'Not whomever.']
  );
});

test('splits a multi-word segment proportionally', () => {
  const sentences = buildSentences([{ start: 0, end: 2, text: ' hello there' }]);

  assert.deepEqual(
    sentences[0].words.map((word) => word.text),
    ['hello', 'there']
  );
  assert.equal(sentences[0].words[0].start, 0);
  assert.equal(sentences[0].words[0].end, 1);
  assert.equal(sentences[0].words[1].end, 2);
});
```

Update the existing Whisper tests:

- Keep the "joins a sentence split across two Whisper segments" case; assert `text`, `start`, `end`, and `words.map(w => w.text)` instead of relying on the absence of `words`.
- Keep the new-speaker test; the phrase segment `- Not whomever.` must split at the dash.
- Update "drops non-speech tags and invalid segments" to assert `sentences[0].text`, `start`, `end`, and word texts instead of a full `deepEqual`.
- Replace "keeps a continuation separate when it would pass ten seconds" with the ten-second cap test above, since grouping is now per word.
- Keep the caption tests unchanged.

- [ ] **Step 2: Run the sentence tests to verify they fail**

Run: `node --experimental-strip-types --test test/sentences.test.mjs`
Expected: FAIL — word segments are grouped as phrase text and `words` is missing.

- [ ] **Step 3: Implement word-based grouping in `lib/sentences.ts`**

Use the existing `cleanText`, `ENDS_SENTENCE`, `MAX_MERGED_SECONDS`, `MAX_MERGED_CHARS`, and `HAS_WORD` constants. Add `MAX_WORD_GAP_SECONDS = 0.8`, `MIN_SENTENCE_SECONDS = 0.1`, and a standalone-dash check. Import `estimateWordTimings` from `./word-timing`.

For each raw segment:

1. Require finite `start` and `end` with `end >= start`; clamp `start` to 0.
2. Trim `text`; skip empty.
3. If the original is a standalone dash (`-`, `–`, `—`), close the current sentence and mark the next word as a new speaker. If it starts with a dash followed by whitespace, close the sentence, strip the dash, and continue with the rest.
4. `cleanText` the remaining text; skip empty results.
5. Call `estimateWordTimings(cleaned, start, end)` and process each returned word:
   - A punctuation-only word (`!HAS_WORD.test(word.text)`) attaches to the last word of the current sentence: append the text with no space, extend that word's `end`, and rebuild the sentence text. Skip it when there is no current sentence.
   - Otherwise, start a new sentence when: the next word is forced by a speaker dash; there is no current sentence; the current text ends with `ENDS_SENTENCE`; `word.start - current.end > MAX_WORD_GAP_SECONDS`; `word.end - current.start > MAX_MERGED_SECONDS`; or `current.text.length + word.text.length + 1 > MAX_MERGED_CHARS`.
   - Otherwise append the word, extend `end`, and rebuild `text` as the words joined by one space.
6. On close, push a sentence with `start` from the first word, `end` from the last word (clamped to at least `start + MIN_SENTENCE_SECONDS`), `text` joined from the words, and `words` in order.

The shape to build:

```ts
type WorkingSentence = Sentence & { words: SentenceWord[] };
// makeSentence(word) -> { start: word.start, end: word.end, text: word.text, words: [word] }
// append(current, word) -> words.push, end = max(end, word.end), text = words.join(' ')
// close() -> sentences.push(current), current = null
```

Keep `buildCaptionSentences` unchanged. Remove the old phrase-based merge and the old `newSpeaker` field.

- [ ] **Step 4: Request word timings from Vibe**

In `lib/vibe.ts`, inside `transcribeBlob`, after the existing `response_format` and `language` appends:

```ts
form.append('word_timestamps', 'true');
form.append('max_segment_len', '1');
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `npm test`
Expected: PASS, all suites.

Run: `npm run typecheck`
Expected: PASS (no errors).

- [ ] **Step 6: Commit**

```bash
git add lib/sentences.ts lib/vibe.ts test/sentences.test.mjs
git commit -m "feat: group Whisper words into timed sentences" -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: Vibe-first transcript source for YouTube

**Files:**
- Create: `lib/transcript-source.ts`
- Create: `test/transcript-source.test.mjs`
- Modify: `app/api/youtube/route.ts`
- Modify: `package.json` (add the test file to the `test` script)

**Interfaces:**
- Consumes: `buildSentences` output from Task 2 (`Sentence[]` with optional `words`); `transcribePath` and `fetchYouTubeCaptions` keep their current signatures.
- Produces: `chooseTranscript(id, filePath, vibe, captions): Promise<{ sentences: Sentence[]; source: TranscriptSource }>`; `app/api/youtube` returns `{ title, mediaUrl, source, sentences }`.

- [ ] **Step 1: Write the failing tests**

Create `test/transcript-source.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseTranscript } from '../lib/transcript-source.ts';
import { VibeError } from '../lib/vibe.ts';
import { YouTubeError } from '../lib/youtube.ts';

const sentence = {
  start: 0,
  end: 1,
  text: 'Hello',
  words: [{ text: 'Hello', start: 0, end: 1 }],
};

test('prefers Vibe and keeps its word timings', async () => {
  const choice = await chooseTranscript(
    'id',
    'file',
    async () => ({ sentences: [sentence] }),
    async () => {
      throw new Error('captions should not be called');
    }
  );

  assert.equal(choice.source, 'vibe');
  assert.equal(choice.sentences[0], sentence);
});

test('falls back to captions when Vibe fails', async () => {
  const choice = await chooseTranscript(
    'id',
    'file',
    async () => {
      throw new Error('vibe down');
    },
    async () => [sentence]
  );

  assert.equal(choice.source, 'captions');
  assert.equal(choice.sentences[0], sentence);
});

test('reports both failures with the Vibe status', async () => {
  await assert.rejects(
    chooseTranscript(
      'id',
      'file',
      async () => {
        throw new VibeError('Vibe is down', 503);
      },
      async () => {
        throw new Error('no captions');
      }
    ),
    (error) => {
      assert.ok(error instanceof YouTubeError);
      assert.match(error.message, /Vibe is down/);
      assert.match(error.message, /no captions/);
      assert.equal(error.status, 503);
      return true;
    }
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --experimental-strip-types --test test/transcript-source.test.mjs`
Expected: FAIL — `lib/transcript-source.ts` does not exist.

- [ ] **Step 3: Implement `lib/transcript-source.ts`**

```ts
import type { Sentence, TranscriptSource } from './types';
import { VibeError } from './vibe';
import { YouTubeError } from './youtube';

type VibeTranscriber = (filePath: string) => Promise<{ sentences: Sentence[] }>;
type CaptionFetcher = (videoId: string) => Promise<Sentence[]>;

export type TranscriptChoice = {
  sentences: Sentence[];
  source: TranscriptSource;
};

export async function chooseTranscript(
  videoId: string,
  filePath: string,
  vibe: VibeTranscriber,
  captions: CaptionFetcher
): Promise<TranscriptChoice> {
  try {
    return { sentences: (await vibe(filePath)).sentences, source: 'vibe' };
  } catch (vibeError) {
    console.warn(
      'Vibe transcription unavailable; falling back to YouTube captions:',
      vibeError instanceof Error ? vibeError.message : vibeError
    );

    try {
      const sentences = await captions(videoId);
      if (!sentences.length) throw new Error('No caption sentences were found.');
      return { sentences, source: 'captions' };
    } catch (captionError) {
      const vibeMessage = vibeError instanceof Error ? vibeError.message : 'unknown error';
      const captionMessage = captionError instanceof Error ? captionError.message : 'unknown error';
      const status =
        vibeError instanceof VibeError
          ? vibeError.status
          : captionError instanceof YouTubeError
            ? captionError.status
            : 502;
      throw new YouTubeError(
        `Vibe could not transcribe this video (${vibeMessage}), and YouTube captions are unavailable (${captionMessage}).`,
        status
      );
    }
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --experimental-strip-types --test test/transcript-source.test.mjs`
Expected: PASS, 3/3.

- [ ] **Step 5: Use the helper in the YouTube route**

In `app/api/youtube/route.ts`, replace the captions-then-Vibe block with:

```ts
const video = await downloadYouTube(body.url);
const { sentences, source } = await chooseTranscript(
  video.id,
  video.filePath,
  transcribePath,
  fetchYouTubeCaptions
);

return NextResponse.json({
  title: video.title,
  mediaUrl: `/api/media/${video.id}`,
  source,
  sentences,
});
```

Keep the outer catch and the `VibeError` import used for status mapping. Remove now-unused `Sentence`/`TranscriptSource` imports if the route no longer names them.

Add `test/transcript-source.test.mjs` to the `test` script in `package.json`.

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Verify the source order against the real route**

Start `npm run dev` and query a short public video:

```bash
curl -s -X POST http://127.0.0.1:3100/api/youtube \
  -H "content-type: application/json" \
  -d '{"url":"https://www.youtube.com/watch?v=jNQXAC9IVRw"}' |
node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s);console.log('source:',r.source,'words:',r.sentences?.[0]?.words?.length,'error:',r.error)})"
```

Expected: `source: vibe` and `words:` greater than 0.

Stop the dev server, start it with Vibe unavailable (`$env:VIBE_SERVER_PATH='C:\missing\vibe-server.exe'; npm run dev` in PowerShell), and repeat the request.

Expected: `source: captions` and `words: undefined` (no `words` field). If the machine is offline, record that the live route check was not run and rely on the unit tests.

- [ ] **Step 7: Commit**

```bash
git add lib/transcript-source.ts test/transcript-source.test.mjs app/api/youtube/route.ts package.json
git commit -m "feat: prefer Vibe transcripts for YouTube links" -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: Practice screen highlight, setup edit fallback, styling, docs

**Files:**
- Modify: `components/SetupScreen.tsx` (`updateSentence`)
- Modify: `components/PracticeScreen.tsx`
- Modify: `app/globals.css`
- Modify: `README.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: `resolveWordTimings`, `activeWordIndex`, `SentenceWord` from Task 1; `Sentence.words` from Tasks 2–3.
- Produces: the visible spoken-word highlight.

- [ ] **Step 1: Clear source timings when a sentence is edited**

In `components/SetupScreen.tsx`, change `updateSentence` to:

```ts
setSentences((current) =>
  current.map((sentence, i) =>
    i === index ? { ...sentence, text, words: undefined } : sentence
  )
);
```

- [ ] **Step 2: Add spoken-word state and sync to `PracticeScreen.tsx`**

Import:

```ts
import { activeWordIndex, resolveWordTimings } from '@/lib/word-timing';
import type { Clip, MediaKind, Sentence, SentenceWord } from '@/lib/types';
```

Near the other refs, add:

```ts
const [spokenWord, setSpokenWord] = useState(-1);
const spokenWordRef = useRef(-1);
```

After the `evaluation` memo, add:

```ts
const wordTimings = useMemo(
  () => (current ? resolveWordTimings(current) : []),
  [current?.text, current?.start, current?.end, current?.words]
);
const wordTimingsRef = useRef<SentenceWord[]>(wordTimings);

useEffect(() => {
  wordTimingsRef.current = wordTimings;
}, [wordTimings]);
```

In `goTo`, after the clip/index state is set and before `seekAndPlay`:

```ts
wordTimingsRef.current = resolveWordTimings(currentClip);
spokenWordRef.current = -1;
setSpokenWord(-1);
```

In the existing animation-frame `tick`, before the clip-end check:

```ts
const nextWord = activeWordIndex(wordTimingsRef.current, video.currentTime);
if (nextWord !== spokenWordRef.current) {
  spokenWordRef.current = nextWord;
  setSpokenWord(nextWord);
}
```

In the typing display, add the class:

```tsx
className={`typing-word ${word.state}${word.active ? ' active' : ''}${
  wordIndex === spokenWord ? ' spoken' : ''
}`}
```

- [ ] **Step 3: Add the spoken style**

In `app/globals.css`, next to the other `.typing-word` rules:

```css
.typing-word.spoken {
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 8%, transparent);
  border-radius: 5px;
}
```

Do not add padding or change the character colors. `typing-char.blank` stays transparent.

- [ ] **Step 4: Update the docs**

`README.md`:
- In "Get the text", change the YouTube order to Vibe first, English captions only as fallback.
- In "Practice", add one sentence: the word being spoken is highlighted in the typing display, and hidden words glow only as blank slots.
- In "Notes", change "English captions are fetched from YouTube when available; if they are missing, the downloaded media is transcribed with Vibe" to the new order.
- Add `lib/word-timing.ts` to the project layout and "word timing" to the test description.

`CLAUDE.md`:
- `lib/vibe.ts`: mention the `word_timestamps` and `max_segment_len` form fields.
- `app/api/youtube/route.ts`: Vibe first, captions fallback.
- `lib/sentences.ts`: word-based grouping and the 0.8 s pause rule.
- `lib/word-timing.ts`: new estimate/resolve/active helpers.
- `components/PracticeScreen.tsx`: spoken-word highlight from the frame loop.
- Tests: add `test/word-timing.test.mjs` and `test/transcript-source.test.mjs`.

- [ ] **Step 5: Run the full automated checks**

Run: `npm test`
Expected: PASS, all suites.

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run build`
Expected: PASS.

- [ ] **Step 6: Manual browser check**

1. `npm run dev`, upload `video/Easy-English-Listening-SnapYT.App.mp4` if present, start practice. During the countdown there is no highlight. The spoken word advances with the audio; hidden words show only the background, never letters. Pause, repeat, change speed, and toggle Audio only; the highlight behaves correctly.
2. Paste `https://www.youtube.com/watch?v=jNQXAC9IVRw`; the ready summary says "Vibe transcript"; start and verify the highlight.
3. Restart the dev server with `VIBE_SERVER_PATH` pointing at a missing file; fetch the same link. The summary says "YouTube captions"; the estimated highlight still advances.
4. Edit one sentence's text in Setup, then start. The highlight still advances using the edited text.
5. Let a sentence end and press repeat; verify the highlight restarts at the first word and does not stick to the last word of the previous clip.

- [ ] **Step 7: Commit**

```bash
git add components/SetupScreen.tsx components/PracticeScreen.tsx app/globals.css README.md CLAUDE.md
git commit -m "feat: highlight the spoken word during playback" -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```
