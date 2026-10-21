import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTime, normalize, scoreSession } from '../lib/listening.ts';

function clip(overrides = {}) {
  return {
    start: 0,
    end: 1,
    text: 'word',
    attempts: 0,
    answer: '',
    lastWrong: '',
    result: 'correct',
    skippedOnce: false,
    reached: true,
    ...overrides,
  };
}

test('normalizes case, punctuation, and apostrophes', () => {
  assert.equal(normalize('  I’m lost!  '), 'im lost');
  assert.equal(normalize('According to my nava-computer, the-'), 'according to my nava computer the');
});

test('formats sentence timestamps', () => {
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(65), '1:05');
  assert.equal(formatTime(3723), '1:02:03');
});

test('a 199/200 session is not perfect', () => {
  const clips = Array.from({ length: 200 }, (_, index) =>
    clip({
      result: index === 0 ? 'skipped' : 'correct',
      skippedOnce: index === 0,
    })
  );
  const score = scoreSession(clips);

  assert.equal(score.correct, 199);
  assert.equal(score.skipped, 1);
  assert.equal(score.pending, 0);
  assert.equal(score.firstTry, 199);
  assert.equal(score.perfect, false);
  assert.equal(score.shownPct, 99);
  assert.equal(score.title, 'Sharp listening.');
});

test('a fully correct session is perfect', () => {
  const score = scoreSession(Array.from({ length: 20 }, () => clip()));
  assert.equal(score.correct, 20);
  assert.equal(score.perfect, true);
  assert.equal(score.shownPct, 100);
  assert.equal(score.title, 'Perfect ear.');
});

test('separates reached pending sentences from unseen ones', () => {
  const score = scoreSession([
    clip({ result: 'correct' }),
    clip({ result: 'pending', reached: true, answer: 'typed' }),
    clip({ result: 'pending', reached: false }),
  ]);

  assert.equal(score.pending, 2);
  assert.equal(score.notReached, 1);
  assert.equal(score.firstTry, 1);
});
