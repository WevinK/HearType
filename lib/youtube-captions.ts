import { YoutubeTranscript } from 'youtube-transcript';
import { buildCaptionSentences } from './sentences.ts';
import type { Sentence } from './types';

const CAPTION_FETCH_TIMEOUT_MS = 20_000;

/** Fetch English captions and group the short cues into practice clips. */
export async function fetchYouTubeCaptions(
  videoId: string,
  fetchImpl: typeof globalThis.fetch = fetch
): Promise<Sentence[]> {
  const cues = await YoutubeTranscript.fetchTranscript(videoId, {
    lang: 'en',
    fetch: (input, init) =>
      fetchImpl(input, { ...init, signal: AbortSignal.timeout(CAPTION_FETCH_TIMEOUT_MS) }),
  });
  return buildCaptionSentences(cues);
}
