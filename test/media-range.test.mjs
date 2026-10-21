import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRange } from '../lib/media-range.ts';

test('parses a closed range', () => {
  assert.deepEqual(parseRange('bytes=100-200', 1000), { start: 100, end: 200 });
});

test('parses open-ended and suffix ranges', () => {
  assert.deepEqual(parseRange('bytes=100-', 1000), { start: 100, end: 999 });
  assert.deepEqual(parseRange('bytes=-500', 1000), { start: 500, end: 999 });
  assert.deepEqual(parseRange('bytes=-5000', 1000), { start: 0, end: 999 });
});

test('clamps an end past the file size', () => {
  assert.deepEqual(parseRange('bytes=990-2000', 1000), { start: 990, end: 999 });
});

test('rejects ranges that cannot be served', () => {
  assert.equal(parseRange('bytes=1000-', 1000), null);
  assert.equal(parseRange('bytes=500-100', 1000), null);
  assert.equal(parseRange('bytes=-0', 1000), null);
  assert.equal(parseRange('bytes=', 1000), null);
  assert.equal(parseRange('bytes=0-1,5-6', 1000), null);
  assert.equal(parseRange('items=0-10', 1000), null);
  assert.equal(parseRange('bytes=abc', 1000), null);
});
