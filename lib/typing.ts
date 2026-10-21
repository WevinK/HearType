const TYPEABLE = /[\p{L}\p{N}]/u;

export type TypingChar = {
  char: string;
  hidden: boolean;
  revealed: boolean;
  hiddenIndex: number | null;
};

export type TypingWord = {
  chars: TypingChar[];
  hiddenIndices: number[];
  revealed: boolean;
};

export type TypingLayout = {
  words: TypingWord[];
  hiddenChars: string[];
  hiddenCount: number;
};

export type TypingWordState = 'pending' | 'correct' | 'fixed' | 'wrong' | 'clue';
export type TypingCharState = 'shown' | 'auto' | 'blank' | 'typed' | 'wrong';

export type EvaluatedWord = {
  chars: Array<TypingChar & { state: TypingCharState; typedChar?: string }>;
  hiddenIndices: number[];
  state: TypingWordState;
  complete: boolean;
  active: boolean;
};

export type TypingEvaluation = {
  words: EvaluatedWord[];
  answer: string;
  correct: boolean;
  complete: boolean;
  activeHiddenIndex: number | null;
};

/** A small deterministic PRNG so a clip keeps the same random clue words. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Split a sentence into whole-word clues and whole-word blanks. A random
 * 50% of the typeable words (at least one stays blank) are shown in full.
 */
export function buildTypingLayout(
  text: string,
  revealRatio = 0.5,
  random: () => number = Math.random
): TypingLayout {
  const wordTexts = text.trim().split(/\s+/).filter(Boolean);
  const typeableWords = wordTexts
    .map((word, index) => (Array.from(word).some((char) => TYPEABLE.test(char)) ? index : -1))
    .filter((index) => index >= 0);
  const revealedCount = Math.min(
    Math.max(0, typeableWords.length - 1),
    Math.max(0, Math.floor(typeableWords.length * revealRatio))
  );

  const order = [...typeableWords];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const clueWords = new Set(order.slice(0, revealedCount));

  const hiddenChars: string[] = [];
  const words: TypingWord[] = [];

  for (const [wordIndex, wordText] of wordTexts.entries()) {
    const typeableCount = Array.from(wordText).filter((char) => TYPEABLE.test(char)).length;
    const revealed = clueWords.has(wordIndex) || typeableCount === 0;

    const chars: TypingChar[] = [];
    const hiddenIndices: number[] = [];

    for (const char of Array.from(wordText)) {
      if (!TYPEABLE.test(char)) {
        chars.push({ char, hidden: false, revealed: false, hiddenIndex: null });
        continue;
      }

      if (revealed) {
        chars.push({ char, hidden: false, revealed: true, hiddenIndex: null });
        continue;
      }

      const hiddenIndex = hiddenChars.length;
      hiddenChars.push(char);
      hiddenIndices.push(hiddenIndex);
      chars.push({ char, hidden: true, revealed: false, hiddenIndex });
    }

    words.push({ chars, hiddenIndices, revealed });
  }

  return { words, hiddenChars, hiddenCount: hiddenChars.length };
}

/** Evaluate typed letters against the hidden words and keep mistake history. */
export function evaluateTyping(
  layout: TypingLayout,
  typed: string,
  mistakes: readonly number[] = []
): TypingEvaluation {
  const mistakeSet = new Set(mistakes);
  const activeHiddenIndex = typed.length < layout.hiddenCount ? typed.length : null;
  const activeWord =
    activeHiddenIndex === null
      ? -1
      : layout.words.findIndex((word) => word.hiddenIndices.includes(activeHiddenIndex));

  let anyWrong = false;

  const words: EvaluatedWord[] = layout.words.map((word, wordIndex) => {
    let hasWrong = false;

    const chars: EvaluatedWord['chars'] = word.chars.map(
      (char): EvaluatedWord['chars'][number] => {
        if (!char.hidden) {
          return { ...char, state: char.revealed ? 'shown' : 'auto' };
        }
        if (char.hiddenIndex === null || char.hiddenIndex >= typed.length) {
          return { ...char, state: 'blank' };
        }
        const matches =
          typed[char.hiddenIndex].toLowerCase() === char.char.toLowerCase();
        if (!matches) {
          hasWrong = true;
          anyWrong = true;
        }
        return {
          ...char,
          state: matches ? 'typed' : 'wrong',
          typedChar: typed[char.hiddenIndex],
        };
      }
    );

    const complete =
      word.revealed ||
      word.hiddenIndices.every((hiddenIndex) => hiddenIndex < typed.length);

    let state: TypingWordState = 'pending';
    if (word.revealed) {
      state = 'clue';
    } else if (complete) {
      if (hasWrong) state = 'wrong';
      else {
        state = word.hiddenIndices.some((hiddenIndex) => mistakeSet.has(hiddenIndex))
          ? 'fixed'
          : 'correct';
      }
    }

    return {
      chars,
      hiddenIndices: word.hiddenIndices,
      state,
      complete,
      active: wordIndex === activeWord,
    };
  });

  const answer = words
    .map((word) =>
      word.chars
        .map((char) => {
          if (!char.hidden) return char.char;
          if (char.hiddenIndex === null || char.hiddenIndex >= typed.length) return '_';
          return typed[char.hiddenIndex];
        })
        .join('')
    )
    .join(' ');

  const complete = typed.length >= layout.hiddenCount;

  return {
    words,
    answer,
    correct: complete && !anyWrong,
    complete,
    activeHiddenIndex,
  };
}

/**
 * Hidden slots that are wrong in `next` and changed since `previous`. A paste
 * or a caret edit can turn several slots wrong at once.
 */
export function addedWrongSlots(
  previous: string,
  next: string,
  hiddenChars: readonly string[]
): number[] {
  const added: number[] = [];
  for (let slot = 0; slot < next.length; slot++) {
    const target = hiddenChars[slot];
    if (!target || next[slot].toLowerCase() === target.toLowerCase()) continue;
    if (slot < previous.length && previous[slot] === next[slot]) continue;
    added.push(slot);
  }
  return added;
}
