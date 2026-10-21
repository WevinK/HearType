export type MediaKind = 'video' | 'audio';

export type Sentence = {
  start: number;
  end: number;
  text: string;
};

export type ClipResult = 'pending' | 'correct' | 'skipped';

export type Clip = Sentence & {
  attempts: number;
  answer: string;
  lastWrong: string;
  result: ClipResult;
  skippedOnce: boolean;
  reached: boolean;
};

export type TranscribeResponse = {
  text: string;
  sentences: Sentence[];
};

export type TranscriptSource = 'captions' | 'vibe';

export type YouTubeResponse = TranscribeResponse & {
  title: string;
  duration: number;
  mediaUrl: string;
  source: TranscriptSource;
};

export type PlayableSource =
  | { kind: MediaKind; file: File }
  | { kind: MediaKind; url: string };
