import type { Sentence } from './types';

// Vibe word ends can be a little early, so give the last word a short tail.
export const CLIP_TAIL_SECONDS = 0.6;

export function clipPlaybackEnd(sentence: Pick<Sentence, 'end'>, mediaDuration: number): number {
  const target = sentence.end + CLIP_TAIL_SECONDS;
  return mediaDuration > 0 ? Math.min(target, mediaDuration) : target;
}
