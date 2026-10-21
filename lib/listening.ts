import type { Clip } from './types';

export function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
  }
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

export function scoreSession(clips: Clip[]) {
  const total = clips.length;
  const correct = clips.filter((clip) => clip.result === 'correct').length;
  const skipped = clips.filter((clip) => clip.result === 'skipped').length;
  const pending = total - correct - skipped;
  const notReached = clips.filter((clip) => clip.result === 'pending' && !clip.reached).length;
  const firstTry = clips.filter(
    (clip) => clip.result === 'correct' && clip.attempts === 0 && !clip.skippedOnce
  ).length;
  const wrongTries = clips.reduce((sum, clip) => sum + clip.attempts, 0);
  const perfect = total > 0 && correct === total;
  const rounded = total ? Math.round((correct / total) * 100) : 0;
  const shownPct = perfect ? 100 : Math.min(99, rounded);
  const title = perfect
    ? 'Perfect ear.'
    : shownPct >= 80
      ? 'Sharp listening.'
      : shownPct >= 50
        ? 'Solid session.'
        : 'Every replay helps.';

  return {
    total,
    correct,
    skipped,
    pending,
    notReached,
    firstTry,
    wrongTries,
    shownPct,
    perfect,
    title,
  };
}
