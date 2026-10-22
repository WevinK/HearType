import { estimateWordTimings } from './word-timing.ts';
import type { Sentence, SentenceWord } from './types';

type RawSegment = {
  start?: unknown;
  end?: unknown;
  text?: unknown;
};

type RawCaptionCue = {
  text?: unknown;
  offset?: unknown;
  duration?: unknown;
};

const SPEAKER_PREFIX = /^[-–—]\s+/;
const SPEAKER_ONLY = /^[-–—]$/;
const ENDS_SENTENCE = /[.!?]["'”’)\]]*$/;
const CONTINUATION_ELLIPSIS = /(?:\.{2,}|…)\s*$/;
const HAS_WORD = /[\p{L}\p{N}]/u;
const MAX_MERGED_SECONDS = 10;
const MAX_MERGED_CHARS = 160;
const MAX_WORD_GAP_SECONDS = 0.8;
const MIN_SENTENCE_SECONDS = 0.1;
const MAX_CAPTION_SECONDS = 10;
const MAX_CAPTION_CHARS = 160;
const CAPTION_GAP_SECONDS = 1.2;
const SHORT_CLIP_SECONDS = 2.5;

type WorkingSentence = Sentence & { words: SentenceWord[] };

/** An ellipsis at a cue boundary usually means the caption continues. */
function endsSentence(text: string): boolean {
  return ENDS_SENTENCE.test(text) && !CONTINUATION_ELLIPSIS.test(text);
}

function isShortClip(sentence: Sentence): boolean {
  return sentence.end - sentence.start < SHORT_CLIP_SECONDS;
}

function mergeClips(first: Sentence, second: Sentence): Sentence {
  return {
    start: Math.min(first.start, second.start),
    end: Math.max(first.end, second.end),
    text: `${first.text} ${second.text}`,
    ...(first.words && second.words ? { words: [...first.words, ...second.words] } : {}),
  };
}

/** Merge a short clip into a neighbour when the gap and combined caps allow. */
function mergeShortClips(
  sentences: Sentence[],
  options: {
    gapSeconds: number;
    maxSeconds: number;
    maxChars: number;
    breaks?: boolean[];
  }
): Sentence[] {
  const merged: Sentence[] = [];

  for (let index = 0; index < sentences.length; index++) {
    const sentence = sentences[index];
    const previous = merged[merged.length - 1];

    if (previous) {
      const start = Math.min(previous.start, sentence.start);
      const end = Math.max(previous.end, sentence.end);
      const canMerge =
        !(options.breaks?.[index] ?? false) &&
        sentence.start - previous.end <= options.gapSeconds &&
        (isShortClip(previous) || isShortClip(sentence)) &&
        end - start <= options.maxSeconds &&
        previous.text.length + sentence.text.length + 1 <= options.maxChars;

      if (canMerge) {
        merged[merged.length - 1] = mergeClips(previous, sentence);
        continue;
      }
    }

    merged.push(sentence);
  }

  return merged;
}

function cleanText(text: string): string {
  return text
    .replace(SPEAKER_PREFIX, '')
    .replace(/\[[^\]]*\]|\([^)]*\)|♪/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Whisper word segments become sentence clips. Words join until terminal
 * punctuation, a speaker dash, or a pause over 0.8 s. A long sentence stays
 * whole; the 10 s / 160-character caps only limit merging short clips.
 */
export function buildSentences(segments: unknown): Sentence[] {
  if (!Array.isArray(segments)) return [];

  const sentences: Sentence[] = [];
  const sentenceBreaks: boolean[] = [];
  let current: WorkingSentence | null = null;
  let forceNew = false;
  let breakBefore = false;

  const makeSentence = (word: SentenceWord): WorkingSentence => ({
    start: word.start,
    end: word.end,
    text: word.text,
    words: [word],
  });

  const close = () => {
    if (!current) return;
    current.end = Math.max(current.end, current.start + MIN_SENTENCE_SECONDS);
    sentences.push(current);
    sentenceBreaks.push(breakBefore);
    breakBefore = false;
    current = null;
  };

  const append = (word: SentenceWord) => {
    if (!current) return;
    current.words.push(word);
    current.end = Math.max(current.end, word.end);
    current.text = current.words.map((item) => item.text).join(' ');
  };

  for (const raw of segments) {
    if (!raw || typeof raw !== 'object') continue;
    const segment = raw as RawSegment;
    const start = Number(segment.start);
    const end = Number(segment.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;

    let original = typeof segment.text === 'string' ? segment.text.trim() : '';
    if (!original) continue;

    if (SPEAKER_ONLY.test(original)) {
      close();
      forceNew = true;
      breakBefore = true;
      continue;
    }

    if (SPEAKER_PREFIX.test(original)) {
      close();
      forceNew = true;
      breakBefore = true;
      original = original.replace(SPEAKER_PREFIX, '');
      if (!original) continue;
    }

    const text = cleanText(original);
    if (!text) continue;

    const textStart = Math.max(0, start);
    const wordTimings =
      end > textStart
        ? estimateWordTimings(text, textStart, end)
        : text
            .split(/\s+/)
            .filter(Boolean)
            .map((word) => ({ text: word, start: textStart, end }));

    for (const word of wordTimings) {
      if (!HAS_WORD.test(word.text)) {
        if (current) {
          const last = current.words[current.words.length - 1];
          last.text += word.text;
          last.end = Math.max(last.end, word.end);
          current.end = Math.max(current.end, last.end);
          current.text = current.words.map((item) => item.text).join(' ');
        }
        continue;
      }

      if (forceNew || !current) {
        close();
        current = makeSentence(word);
        forceNew = false;
        continue;
      }

      const finish =
        endsSentence(current.text) ||
        word.start - current.end > MAX_WORD_GAP_SECONDS;

      if (finish) {
        close();
        current = makeSentence(word);
      } else {
        append(word);
      }
    }
  }

  close();
  return mergeShortClips(sentences, {
    gapSeconds: MAX_WORD_GAP_SECONDS,
    maxSeconds: MAX_MERGED_SECONDS,
    maxChars: MAX_MERGED_CHARS,
    breaks: sentenceBreaks,
  });
}

/**
 * YouTube caption cues are short fragments, often without punctuation. Group
 * them by pauses and sentence punctuation; a long unpunctuated group stays
 * whole. The package returns milliseconds for srv3 tracks and seconds for
 * classic tracks, so infer the unit from the cue durations.
 */
export function buildCaptionSentences(cues: unknown): Sentence[] {
  if (!Array.isArray(cues)) return [];

  const rows: Array<{ text: string; offset: number; duration: number }> = [];
  for (const raw of cues) {
    if (!raw || typeof raw !== 'object') continue;
    const cue = raw as RawCaptionCue;
    const offset = Number(cue.offset);
    const duration = Number(cue.duration);
    if (!Number.isFinite(offset) || !Number.isFinite(duration)) continue;
    if (offset < 0 || duration <= 0) continue;

    const text = cleanText(typeof cue.text === 'string' ? cue.text : '');
    if (!text || !HAS_WORD.test(text)) continue;
    rows.push({ text, offset, duration });
  }
  if (!rows.length) return [];

  const durations = rows.map((row) => row.duration).sort((a, b) => a - b);
  const medianDuration = durations[Math.floor(durations.length / 2)];
  const scale = medianDuration > 100 ? 0.001 : 1;

  const prepared = rows
    .map((row) => ({
      start: row.offset * scale,
      end: (row.offset + row.duration) * scale,
      text: row.text,
    }))
    .filter((cue) => cue.end > cue.start + 0.05);

  const sentences: Sentence[] = [];
  let current: Sentence | null = null;

  for (const cue of prepared) {
    if (!current) {
      current = { ...cue };
      continue;
    }

    const canMerge =
      !endsSentence(current.text) &&
      cue.start - current.end <= CAPTION_GAP_SECONDS;

    if (canMerge) {
      const head = current.text.replace(CONTINUATION_ELLIPSIS, '').trimEnd();
      current.text = head ? `${head} ${cue.text}` : cue.text;
      current.end = Math.max(current.end, cue.end);
    } else {
      // Caption display windows overlap; end the old clip where the new one starts.
      if (cue.start > current.start && current.end > cue.start) current.end = cue.start;
      sentences.push(current);
      current = { ...cue };
    }
  }

  if (current) sentences.push(current);
  return mergeShortClips(sentences, {
    gapSeconds: CAPTION_GAP_SECONDS,
    maxSeconds: MAX_CAPTION_SECONDS,
    maxChars: MAX_CAPTION_CHARS,
  });
}
