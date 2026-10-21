import type { Sentence } from './types';

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
const ENDS_SENTENCE = /[.!?]["'”’)\]]*$/;
const MAX_MERGED_SECONDS = 10;
const MAX_MERGED_CHARS = 160;
const MAX_CAPTION_SECONDS = 10;
const MAX_CAPTION_CHARS = 160;
const CAPTION_GAP_SECONDS = 1.2;

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
    if (!text) continue;
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
