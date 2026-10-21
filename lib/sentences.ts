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
const HAS_WORD = /[\p{L}\p{N}]/u;
const MAX_MERGED_SECONDS = 10;
const MAX_MERGED_CHARS = 160;
const MAX_WORD_GAP_SECONDS = 0.8;
const MIN_SENTENCE_SECONDS = 0.1;
const MAX_CAPTION_SECONDS = 10;
const MAX_CAPTION_CHARS = 160;
const CAPTION_GAP_SECONDS = 1.2;

type WorkingSentence = Sentence & { words: SentenceWord[] };

function cleanText(text: string): string {
  return text
    .replace(SPEAKER_PREFIX, '')
    .replace(/\[[^\]]*\]|\([^)]*\)|♪/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Whisper word segments become sentence clips. Words join until terminal
 * punctuation, a speaker dash, a pause over 0.8 s, or the 10 s / 160-character
 * caps. Each sentence keeps the word timings for playback highlighting.
 */
export function buildSentences(segments: unknown): Sentence[] {
  if (!Array.isArray(segments)) return [];

  const sentences: Sentence[] = [];
  let current: WorkingSentence | null = null;
  let forceNew = false;

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
      continue;
    }

    if (SPEAKER_PREFIX.test(original)) {
      close();
      forceNew = true;
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
        ENDS_SENTENCE.test(current.text) ||
        word.start - current.end > MAX_WORD_GAP_SECONDS ||
        word.end - current.start > MAX_MERGED_SECONDS ||
        current.text.length + word.text.length + 1 > MAX_MERGED_CHARS;

      if (finish) {
        close();
        current = makeSentence(word);
      } else {
        append(word);
      }
    }
  }

  close();
  return sentences;
}

/**
 * YouTube caption cues are short fragments, often without punctuation. Group
 * them by pauses and length. The package returns milliseconds for srv3 tracks
 * and seconds for classic tracks, so infer the unit from the cue durations.
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
      !ENDS_SENTENCE.test(current.text) &&
      cue.start - current.end <= CAPTION_GAP_SECONDS &&
      cue.end - current.start <= MAX_CAPTION_SECONDS &&
      current.text.length + cue.text.length + 1 <= MAX_CAPTION_CHARS;

    if (canMerge) {
      current.text += ' ' + cue.text;
      current.end = Math.max(current.end, cue.end);
    } else {
      // Caption display windows overlap; end the old clip where the new one starts.
      if (cue.start > current.start && current.end > cue.start) current.end = cue.start;
      sentences.push(current);
      current = { ...cue };
    }
  }

  if (current) sentences.push(current);
  return sentences;
}
