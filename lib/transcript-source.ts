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
