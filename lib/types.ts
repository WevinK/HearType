export type MediaKind = 'video' | 'audio';

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
  custom?: boolean;
};

export type ClipResult = 'pending' | 'correct' | 'skipped';

export type Clip = Sentence & {
  attempts: number;
  answer: string;
  typed: string;
  mistakes: number[];
  revealSeed: number;
  lastWrong: string;
  result: ClipResult;
  skippedOnce: boolean;
  reached: boolean;
};

export type TranscribeResponse = {
  sentences: Sentence[];
};

export type TranscriptSource = 'captions' | 'vibe';

export type YouTubeResponse = TranscribeResponse & {
  title: string;
  mediaUrl: string;
  source: TranscriptSource;
};

export type PlayableSource =
  | { kind: MediaKind; file: File }
  | { kind: MediaKind; url: string };
