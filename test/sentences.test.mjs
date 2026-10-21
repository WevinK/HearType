import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSentences } from '../lib/sentences.ts';

test('joins a sentence split across two Whisper segments', () => {
  const sentences = buildSentences([
    { start: 6.68, end: 8.6, text: ' Michael is right, it’s a made up word' },
    { start: 8.6, end: 9.96, text: ' used to trick students.' },
  ]);

  assert.equal(sentences.length, 1);
  assert.equal(sentences[0].start, 6.68);
  assert.equal(sentences[0].end, 9.96);
  assert.equal(
    sentences[0].text,
    'Michael is right, it’s a made up word used to trick students.'
  );
  assert.deepEqual(
    sentences[0].words.map((word) => word.text),
    ['Michael', 'is', 'right,', 'it’s', 'a', 'made', 'up', 'word', 'used', 'to', 'trick', 'students.']
  );
});

test('does not join across a new speaker and strips speaker dashes', () => {
  const sentences = buildSentences([
    { start: 0, end: 2.6, text: "It's whoever, not whomever." },
    { start: 2.6, end: 3.44, text: ' - Not whomever.' },
    { start: 3.44, end: 5.44, text: ' - No, whomever is never actually right.' },
  ]);

  assert.deepEqual(
    sentences.map((sentence) => sentence.text),
    ["It's whoever, not whomever.", 'Not whomever.', 'No, whomever is never actually right.']
  );
  assert.deepEqual(
    sentences.map((sentence) => sentence.words.map((word) => word.text)),
    [
      ["It's", 'whoever,', 'not', 'whomever.'],
      ['Not', 'whomever.'],
      ['No,', 'whomever', 'is', 'never', 'actually', 'right.'],
    ]
  );
});

test('drops non-speech tags and invalid segments', () => {
  const sentences = buildSentences([
    { start: 0, end: 1, text: '[Music]' },
    { start: 1, end: 2, text: '♪' },
    { start: 3, end: 2.9, text: 'Backwards.' },
    { start: 2, end: 3, text: '(inaudible)' },
    { start: 3, end: 3.5, text: '…' },
    { start: 3.5, end: 4, text: '—' },
    { start: 4, end: 5.5, text: 'Hello there.' },
  ]);

  assert.equal(sentences.length, 1);
  assert.equal(sentences[0].text, 'Hello there.');
  assert.equal(sentences[0].start, 4);
  assert.equal(sentences[0].end, 5.5);
  assert.deepEqual(
    sentences[0].words.map((word) => word.text),
    ['Hello', 'there.']
  );
});

test('groups word segments and preserves timings', () => {
  const sentences = buildSentences([
    { start: 0, end: 0.4, text: ' Hello,' },
    { start: 0.4, end: 1, text: ' welcome' },
    { start: 1, end: 1.3, text: ' to' },
    { start: 1.3, end: 1.7, text: ' the' },
    { start: 1.7, end: 2, text: ' course.' },
  ]);

  assert.equal(sentences.length, 1);
  assert.equal(sentences[0].text, 'Hello, welcome to the course.');
  assert.deepEqual(
    sentences[0].words.map((word) => word.text),
    ['Hello,', 'welcome', 'to', 'the', 'course.']
  );
  assert.equal(sentences[0].start, 0);
  assert.equal(sentences[0].end, 2);
});

test('drops empty and non-speech words', () => {
  const sentences = buildSentences([
    { start: 0, end: 0.1, text: '' },
    { start: 0.1, end: 0.5, text: ' [Music]' },
    { start: 1, end: 1.4, text: ' Hello' },
    { start: 1.4, end: 1.9, text: ' there.' },
  ]);

  assert.equal(sentences.length, 1);
  assert.equal(sentences[0].text, 'Hello there.');
  assert.equal(sentences[0].start, 1);
  assert.equal(sentences[0].end, 1.9);
});

test('merges short sentences across terminal punctuation', () => {
  const sentences = buildSentences([
    { start: 0, end: 0.5, text: ' Hello.' },
    { start: 0.5, end: 0.8, text: ' How' },
    { start: 0.8, end: 1, text: ' are' },
    { start: 1, end: 1.3, text: ' you?' },
  ]);

  assert.deepEqual(
    sentences.map((sentence) => sentence.text),
    ['Hello. How are you?']
  );
  assert.equal(sentences[0].start, 0);
  assert.equal(sentences[0].end, 1.3);
});

test('splits long sentences at terminal punctuation', () => {
  const sentences = buildSentences([
    { start: 0, end: 4, text: ' This sentence is long enough to stand alone.' },
    { start: 4, end: 8, text: ' This second sentence is also long enough.' },
  ]);

  assert.equal(sentences.length, 2);
});

test('merges a short clip into a long previous clip', () => {
  const sentences = buildSentences([
    { start: 0, end: 4, text: ' This is a fairly long sentence.' },
    { start: 4, end: 5, text: ' Yes.' },
  ]);

  assert.equal(sentences.length, 1);
  assert.equal(sentences[0].text, 'This is a fairly long sentence. Yes.');
  assert.equal(sentences[0].end, 5);
});

test('merges a short clip with the next when the previous is too long', () => {
  const sentences = buildSentences([
    { start: 0, end: 9.5, text: ' This sentence is long enough to stand alone.' },
    { start: 9.5, end: 10.5, text: ' Short.' },
    { start: 10.5, end: 12.5, text: ' This one is next.' },
  ]);

  assert.deepEqual(
    sentences.map((sentence) => sentence.text),
    ['This sentence is long enough to stand alone.', 'Short. This one is next.']
  );
});

test('splits after a pause over 0.8 seconds', () => {
  const sentences = buildSentences([
    { start: 0, end: 0.5, text: ' First' },
    { start: 1.4, end: 2, text: ' second.' },
  ]);

  assert.equal(sentences.length, 2);
});

test('splits at the ten-second cap', () => {
  const sentences = buildSentences([
    { start: 0, end: 5, text: ' This' },
    { start: 5, end: 10.5, text: ' continues' },
  ]);

  assert.equal(sentences.length, 2);
});

test('splits at the 160-character cap', () => {
  const long = 'a'.repeat(100);
  const sentences = buildSentences([
    { start: 0, end: 1, text: ` ${long}` },
    { start: 1, end: 2, text: ` ${long}` },
  ]);

  assert.equal(sentences.length, 2);
});

test('keeps zero-duration words', () => {
  const sentences = buildSentences([
    { start: 1, end: 1, text: ' Now,' },
    { start: 1, end: 1.2, text: ' you' },
    { start: 1.2, end: 1.8, text: ' listen.' },
  ]);

  assert.equal(sentences[0].text, 'Now, you listen.');
  assert.equal(sentences[0].words[0].start, 1);
  assert.equal(sentences[0].words[0].end, 1);
});

test('attaches punctuation-only words to the previous word', () => {
  const sentences = buildSentences([
    { start: 0, end: 0.5, text: ' Hello' },
    { start: 0.5, end: 0.6, text: ',' },
    { start: 0.7, end: 1.2, text: ' there' },
  ]);

  assert.equal(sentences[0].text, 'Hello, there');
  assert.equal(sentences[0].words[0].text, 'Hello,');
});

test('treats a standalone dash as a speaker change', () => {
  const sentences = buildSentences([
    { start: 0, end: 0.5, text: ' Hello' },
    { start: 0.5, end: 0.6, text: ' -' },
    { start: 0.7, end: 1.2, text: ' Not' },
    { start: 1.2, end: 1.8, text: ' whomever.' },
  ]);

  assert.deepEqual(
    sentences.map((sentence) => sentence.text),
    ['Hello', 'Not whomever.']
  );
});

test('splits a multi-word segment proportionally', () => {
  const sentences = buildSentences([{ start: 0, end: 2, text: ' hello there' }]);

  assert.deepEqual(
    sentences[0].words.map((word) => word.text),
    ['hello', 'there']
  );
  assert.equal(sentences[0].words[0].start, 0);
  assert.equal(sentences[0].words[0].end, 1);
  assert.equal(sentences[0].words[1].end, 2);
});
