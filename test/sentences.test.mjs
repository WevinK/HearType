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
});

test('drops non-speech tags and invalid segments', () => {
  const sentences = buildSentences([
    { start: 0, end: 1, text: '[Music]' },
    { start: 1, end: 2, text: '♪' },
    { start: 3, end: 2.9, text: 'Backwards.' },
    { start: 2, end: 3, text: '(inaudible)' },
    { start: 4, end: 5.5, text: 'Hello there.' },
  ]);

  assert.deepEqual(sentences, [{ start: 4, end: 5.5, text: 'Hello there.' }]);
});

test('keeps long continuations separate after twenty seconds', () => {
  const sentences = buildSentences([
    { start: 0, end: 21, text: 'This keeps going and going without a stop' },
    { start: 21, end: 22, text: ' and then stops.' },
  ]);

  assert.equal(sentences.length, 2);
  assert.equal(sentences[0].text, 'This keeps going and going without a stop');
  assert.equal(sentences[1].text, 'and then stops.');
});
