import type { Sentence } from './types';

type RawSegment = {
  start?: unknown;
  end?: unknown;
  text?: unknown;
};

const SPEAKER_PREFIX = /^[-–—]\s+/;
const ENDS_SENTENCE = /[.!?]["'”’)\]]*$/;
const MAX_MERGED_SECONDS = 20;
const MAX_MERGED_CHARS = 240;

function cleanText(text: string): string {
  return text
    .replace(SPEAKER_PREFIX, '')
    .replace(/\[[^\]]*\]|\([^)]*\)|♪/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Whisper returns subtitle-like segments, not always full sentences. Join a
 * segment with the next one when the sentence clearly continues: no terminal
 * punctuation, the next line starts lowercase, no new speaker, and the result
 * stays a sensible clip length.
 */
export function buildSentences(segments: unknown): Sentence[] {
  if (!Array.isArray(segments)) return [];

  const prepared: Array<Sentence & { newSpeaker: boolean }> = [];
  for (const raw of segments) {
    if (!raw || typeof raw !== 'object') continue;
    const segment = raw as RawSegment;
    const start = Number(segment.start);
    const end = Number(segment.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start + 0.05) continue;

    const original = typeof segment.text === 'string' ? segment.text.trim() : '';
    if (!original) continue;

    const text = cleanText(original);
    if (!text) continue;

    prepared.push({
      start: Math.max(0, start),
      end,
      text,
      newSpeaker: SPEAKER_PREFIX.test(original),
    });
  }

  const sentences: Sentence[] = [];
  let current: Sentence | null = null;

  for (const segment of prepared) {
    if (!current) {
      current = { start: segment.start, end: segment.end, text: segment.text };
      continue;
    }

    const canMerge =
      !segment.newSpeaker &&
      !ENDS_SENTENCE.test(current.text) &&
      /^[a-z]/.test(segment.text) &&
      segment.end - current.start <= MAX_MERGED_SECONDS &&
      current.text.length + segment.text.length + 1 <= MAX_MERGED_CHARS;

    if (canMerge) {
      current.text += ' ' + segment.text;
      current.end = segment.end;
    } else {
      sentences.push(current);
      current = { start: segment.start, end: segment.end, text: segment.text };
    }
  }

  if (current) sentences.push(current);
  return sentences;
}
