import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activeWordIndex,
  estimateWordTimings,
  resolveWordTimings,
} from '../lib/word-timing.ts';

test('distributes a sentence duration by word length', () => {
  assert.deepEqual(estimateWordTimings('aa bbbb', 0, 6), [
    { text: 'aa', start: 0, end: 2 },
    { text: 'bbbb', start: 2, end: 6 },
  ]);
});

test('keeps word spans contiguous and ends at the sentence end', () => {
  const words = estimateWordTimings('one two three', 10, 16);

  assert.equal(words.length, 3);
  assert.equal(words[0].start, 10);
  assert.equal(words.at(-1).end, 16);
  assert.ok(words.every((word, i) => i === 0 || word.start === words[i - 1].end));
});

test('returns no timings for empty text or a non-positive span', () => {
  assert.deepEqual(estimateWordTimings('   ', 0, 5), []);
  assert.deepEqual(estimateWordTimings('hello', 5, 5), []);
});

test('uses source words while they match the sentence text', () => {
  const words = [
    { text: 'Hi', start: 0, end: 1 },
    { text: 'there', start: 1, end: 4 },
  ];
  const sentence = { start: 0, end: 4, text: '  Hi   there ', words };

  assert.equal(resolveWordTimings(sentence), words);
});

test('estimates after the sentence text is edited', () => {
  const words = [
    { text: 'Hi', start: 0, end: 1 },
    { text: 'there', start: 1, end: 4 },
  ];
  const result = resolveWordTimings({ start: 0, end: 4, text: 'Hi friend', words });

  assert.deepEqual(result.map((word) => word.text), ['Hi', 'friend']);
  assert.equal(result[0].start, 0);
  assert.equal(result.at(-1).end, 4);
});

test('finds the current word from its start time', () => {
  const words = [
    { text: 'one', start: 1, end: 2 },
    { text: 'two', start: 3, end: 4 },
  ];

  assert.equal(activeWordIndex(words, 0), -1);
  assert.equal(activeWordIndex(words, 1), 0);
  assert.equal(activeWordIndex(words, 2.5), 0);
  assert.equal(activeWordIndex(words, 3), 1);
  assert.equal(activeWordIndex(words, 99), 1);
  assert.equal(
    activeWordIndex(
      [
        { text: 'a', start: 1, end: 1 },
        { text: 'b', start: 1, end: 2 },
      ],
      1
    ),
    1
  );
});
