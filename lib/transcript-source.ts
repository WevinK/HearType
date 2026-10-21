import type { Sentence, TranscriptSource } from './types';
import { VibeError } from './vibe.ts';
import { YouTubeError } from './youtube.ts';

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
  captions: CaptionFetcher,
  preference: TranscriptSource = 'vibe'
): Promise<TranscriptChoice> {
  const fromVibe = async (): Promise<TranscriptChoice> => ({
    sentences: (await vibe(filePath)).sentences,
    source: 'vibe',
  });
  const fromCaptions = async (): Promise<TranscriptChoice> => {
    const sentences = await captions(videoId);
    if (!sentences.length) throw new Error('No caption sentences were found.');
    return { sentences, source: 'captions' };
  };

  const captionsFirst = preference === 'captions';
  const first = captionsFirst ? fromCaptions : fromVibe;
  const second = captionsFirst ? fromVibe : fromCaptions;
  const firstLabel = captionsFirst ? 'YouTube captions are unavailable' : 'Vibe transcription unavailable';

  try {
    return await first();
  } catch (firstError) {
    console.warn(
      `${firstLabel}; falling back to the other transcript source:`,
      firstError instanceof Error ? firstError.message : firstError
    );

    try {
      return await second();
    } catch (secondError) {
      const firstMessage = firstError instanceof Error ? firstError.message : 'unknown error';
      const secondMessage = secondError instanceof Error ? secondError.message : 'unknown error';
      const status =
        firstError instanceof VibeError || firstError instanceof YouTubeError
          ? firstError.status
          : secondError instanceof VibeError || secondError instanceof YouTubeError
            ? secondError.status
            : 502;
      throw new YouTubeError(
        `${captionsFirst ? 'YouTube captions are unavailable' : 'Vibe could not transcribe this video'} (${firstMessage}), and ${captionsFirst ? 'Vibe could not transcribe this video' : 'YouTube captions are unavailable'} (${secondMessage}).`,
        status
      );
    }
  }
}
