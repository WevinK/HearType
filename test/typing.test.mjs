import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addedWrongSlots,
  buildTypingLayout,
  evaluateTyping,
  seededRandom,
} from '../lib/typing.ts';

const high = () => 0.99;
const low = () => 0;

test('reveals whole words and blanks whole words', () => {
  const layout = buildTypingLayout('Hello there.', 0.5, high);

  assert.equal(layout.words[0].revealed, true);
  assert.equal(layout.words[1].revealed, false);
  assert.ok(layout.words[0].chars.every((char) => char.hidden === false));
  assert.equal(
    layout.words[1].chars.filter((char) => char.hidden).length,
    5
  );
  assert.equal(layout.hiddenChars.join(''), 'there');
  assert.equal(layout.hiddenCount, 5);
  assert.equal(layout.words[1].chars.at(-1).char, '.');
  assert.equal(layout.words[1].chars.at(-1).hidden, false);
});

test('randomly chooses which whole words are clues', () => {
  const clueFirst = buildTypingLayout('Hello there.', 0.5, high);
  const clueSecond = buildTypingLayout('Hello there.', 0.5, low);

  assert.equal(clueFirst.words[0].revealed, true);
  assert.equal(clueFirst.words[1].revealed, false);
  assert.equal(clueSecond.words[0].revealed, false);
  assert.equal(clueSecond.words[1].revealed, true);
  assert.equal(clueSecond.hiddenChars.join(''), 'Hello');
});

test('reveals 50 percent of the sentence words as clues', () => {
  const layout = buildTypingLayout('one two three four', 0.5, () => 0.5);

  assert.equal(layout.words.length, 4);
  assert.equal(layout.words.filter((word) => word.revealed).length, 2);
  assert.equal(layout.words.filter((word) => !word.revealed).length, 2);

  for (const word of layout.words) {
    const typeable = word.chars.filter((char) => /[\p{L}\p{N}]/u.test(char.char));
    assert.ok(typeable.every((char) => char.hidden === !word.revealed));
  }
});

test('leaves at least one whole word to type', () => {
  const layout = buildTypingLayout('Hello', 0.5, high);

  assert.equal(layout.words[0].revealed, false);
  assert.equal(layout.hiddenChars.join(''), 'Hello');
});

test('has a repeatable seeded random source', () => {
  const first = seededRandom(12345);
  const second = seededRandom(12345);

  assert.deepEqual(
    [first(), first(), first(), first()],
    [second(), second(), second(), second()]
  );
});

test('marks the clue word as a clue and the hidden word active', () => {
  const layout = buildTypingLayout('Hello there.', 0.5, high);
  const result = evaluateTyping(layout, 'th', []);

  assert.equal(result.words[0].state, 'clue');
  assert.equal(result.words[0].chars[0].state, 'shown');
  assert.equal(result.words[1].state, 'pending');
  assert.equal(result.words[1].active, true);
  assert.equal(result.words[1].chars[0].state, 'typed');
  assert.equal(result.words[1].chars[1].state, 'typed');
  assert.equal(result.words[1].chars[2].state, 'blank');
  assert.equal(result.complete, false);
  assert.equal(result.correct, false);
});

test('keeps correct letters white and only the wrong key red in an unfinished word', () => {
  const layout = buildTypingLayout('Hello there.', 0.5, high);
  const result = evaluateTyping(layout, 'thx', []);

  assert.equal(result.words[1].state, 'pending');
  assert.equal(result.words[1].complete, false);
  assert.equal(result.words[1].chars[0].state, 'typed');
  assert.equal(result.words[1].chars[1].state, 'typed');
  assert.equal(result.words[1].chars[2].state, 'wrong');
  assert.equal(result.words[1].chars[2].typedChar, 'x');
});

test('marks a completed hidden word red when a wrong letter remains', () => {
  const layout = buildTypingLayout('Hello there.', 0.5, high);
  const result = evaluateTyping(layout, 'thxre', []);

  assert.equal(result.words[1].state, 'wrong');
  assert.equal(result.words[1].chars[2].state, 'wrong');
  assert.equal(result.words[1].chars[2].typedChar, 'x');
  assert.equal(result.correct, false);
});

test('turns a hidden word yellow after a corrected mistake', () => {
  const layout = buildTypingLayout('Hello there.', 0.5, high);
  const result = evaluateTyping(layout, 'there', [2]);

  assert.equal(result.words[1].state, 'fixed');
  assert.equal(result.words[1].complete, true);
  assert.equal(result.correct, true);
  assert.equal(result.answer, 'Hello there.');
});

test('accepts a completed sentence and keeps clue words and punctuation', () => {
  const layout = buildTypingLayout('Hello there.', 0.5, high);
  const result = evaluateTyping(layout, 'there', []);

  assert.equal(result.words[0].state, 'clue');
  assert.equal(result.words[1].state, 'correct');
  assert.equal(result.complete, true);
  assert.equal(result.correct, true);
  assert.equal(result.answer, 'Hello there.');
});

test('matches typed letters without caring about case', () => {
  const layout = buildTypingLayout('Hello there.', 0.5, high);
  const result = evaluateTyping(layout, 'THERE', []);

  assert.equal(result.correct, true);
});

test('blanks whole numbers and keeps their punctuation automatic', () => {
  const layout = buildTypingLayout('I am 11.13', 0.5, high);

  assert.equal(layout.words[0].revealed, true);
  assert.equal(layout.hiddenChars.join(''), 'am1113');
  assert.equal(layout.words[2].chars[2].char, '.');
  assert.equal(layout.words[2].chars[2].hidden, false);
});

test('keeps a typeable word hidden when punctuation is its own word', () => {
  const layout = buildTypingLayout('hello —', 0.5, high);

  assert.equal(layout.words[0].revealed, false);
  assert.equal(layout.hiddenChars.join(''), 'hello');
});

test('counts wrong slots added by a paste or edit', () => {
  const hidden = ['t', 'h', 'e', 'r', 'e'];

  assert.deepEqual(addedWrongSlots('th', 'thxre', hidden), [2]);
  assert.deepEqual(addedWrongSlots('thxre', 'thxre', hidden), []);
  assert.deepEqual(addedWrongSlots('th', 'tX', hidden), [1]);
  assert.deepEqual(addedWrongSlots('thx', 'thy', hidden), [2]);
  assert.deepEqual(addedWrongSlots('thx', 'th', hidden), []);
});

test('counts a blank slot as not typed', () => {
  const hidden = ['t', 'h', 'e', 'r', 'e'];

  assert.deepEqual(addedWrongSlots('th', 'th  e', hidden), []);
});

test('uses the caret position for the active word', () => {
  const layout = buildTypingLayout('Hello there.', 0.5, high);
  const result = evaluateTyping(layout, 'there', [], 2);

  assert.equal(result.words[1].active, true);
});

test('treats blank slots as unfilled', () => {
  const layout = buildTypingLayout('Hello there.', 0.5, high);
  const result = evaluateTyping(layout, 'th  e', []);

  assert.equal(result.words[1].chars[2].state, 'blank');
  assert.equal(result.words[1].chars[3].state, 'blank');
  assert.equal(result.words[1].chars[4].state, 'typed');
  assert.equal(result.complete, false);
  assert.equal(result.correct, false);
});
