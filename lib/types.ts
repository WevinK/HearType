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
