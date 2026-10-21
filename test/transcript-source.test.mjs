import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseTranscript } from '../lib/transcript-source.ts';
import { VibeError } from '../lib/vibe.ts';
import { YouTubeError } from '../lib/youtube.ts';

const sentence = {
  start: 0,
  end: 1,
  text: 'Hello',
  words: [{ text: 'Hello', start: 0, end: 1 }],
};

test('prefers Vibe and keeps its word timings', async () => {
  const choice = await chooseTranscript(
    'id',
    'file',
    async () => ({ sentences: [sentence] }),
    async () => {
      throw new Error('captions should not be called');
    }
  );

  assert.equal(choice.source, 'vibe');
  assert.equal(choice.sentences[0], sentence);
});

test('falls back to captions when Vibe fails', async () => {
  const choice = await chooseTranscript(
    'id',
    'file',
    async () => {
      throw new Error('vibe down');
    },
    async () => [sentence]
  );

  assert.equal(choice.source, 'captions');
  assert.equal(choice.sentences[0], sentence);
});

test('reports both failures with the Vibe status', async () => {
  await assert.rejects(
    chooseTranscript(
      'id',
      'file',
      async () => {
        throw new VibeError('Vibe is down', 503);
      },
      async () => {
        throw new Error('no captions');
      }
    ),
    (error) => {
      assert.ok(error instanceof YouTubeError);
      assert.match(error.message, /Vibe is down/);
      assert.match(error.message, /no captions/);
      assert.equal(error.status, 503);
      return true;
    }
  );
});
