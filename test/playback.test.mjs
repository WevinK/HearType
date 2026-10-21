import assert from 'node:assert/strict';
import test from 'node:test';
import { CLIP_TAIL_SECONDS, clipPlaybackEnd } from '../lib/playback.ts';

test('a clip plays a short tail past its last word', () => {
  assert.equal(clipPlaybackEnd({ end: 12 }, 0), 12 + CLIP_TAIL_SECONDS);
});

test('the tail never runs past the media', () => {
  assert.equal(clipPlaybackEnd({ end: 18.8 }, 19), 19);
});
