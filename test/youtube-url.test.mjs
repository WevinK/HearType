import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeYouTubeUrl } from '../lib/youtube-url.ts';

test('accepts common YouTube video URLs', () => {
  assert.equal(
    normalizeYouTubeUrl('https://www.youtube.com/watch?v=jNQXAC9IVRw'),
    'https://www.youtube.com/watch?v=jNQXAC9IVRw'
  );
  assert.equal(
    normalizeYouTubeUrl(' https://youtu.be/jNQXAC9IVRw '),
    'https://youtu.be/jNQXAC9IVRw'
  );
  assert.ok(normalizeYouTubeUrl('https://www.youtube.com/shorts/jNQXAC9IVRw'));
  assert.ok(normalizeYouTubeUrl('https://m.youtube.com/watch?v=jNQXAC9IVRw'));
  assert.ok(normalizeYouTubeUrl('https://music.youtube.com/watch?v=jNQXAC9IVRw'));
  assert.ok(
    normalizeYouTubeUrl('https://www.youtube.com/watch?v=jNQXAC9IVRw&list=PL123')
  );
});

test('rejects non-video, non-YouTube, and unsafe URLs', () => {
  assert.equal(normalizeYouTubeUrl('https://vimeo.com/123'), null);
  assert.equal(normalizeYouTubeUrl('https://www.youtube.com/playlist?list=PL123'), null);
  assert.equal(normalizeYouTubeUrl('https://www.youtube.com/@somechannel'), null);
  assert.equal(normalizeYouTubeUrl('https://youtube.com.evil.test/watch?v=jNQXAC9IVRw'), null);
  assert.equal(normalizeYouTubeUrl('javascript:alert(1)'), null);
  assert.equal(normalizeYouTubeUrl('not a url'), null);
  assert.equal(normalizeYouTubeUrl('https://youtu.be/'), null);
  assert.equal(normalizeYouTubeUrl('https://user:pass@youtube.com/watch?v=jNQXAC9IVRw'), null);
});
