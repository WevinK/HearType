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
