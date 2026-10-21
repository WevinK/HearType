import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, 'inline script not found');

// The page script expects a DOM. A no-op element is enough for its top-level
// event registrations; this test only calls the zip functions.
const fakeElement = { addEventListener() {} };
const sandbox = {
  document: { querySelector: () => fakeElement },
  window: { addEventListener() {} },
  console,
  Blob,
  DecompressionStream,
  TextDecoder,
  setTimeout,
  clearTimeout,
};
vm.createContext(sandbox);
vm.runInContext(
  script + '\nglobalThis.__test = { extractPack, normalize };',
  sandbox,
  { filename: 'index.html:inline-script' }
);

const zipBytes = readFileSync(join(root, 'Videos', 'you_are_a_toy.zip'));
const zipBuffer = zipBytes.buffer.slice(zipBytes.byteOffset, zipBytes.byteOffset + zipBytes.byteLength);
const packFile = { size: zipBytes.byteLength, arrayBuffer: async () => zipBuffer };

test('reads the sample pack', async () => {
  const packed = await sandbox.__test.extractPack(packFile);
  assert.equal(packed.skipped, 0);
  assert.equal(packed.clips.length, 20);
  assert.equal(packed.clips[0].name, '01_buzz.mp3');
  assert.equal(packed.clips[0].target, 'According to my nava-computer, the-');
  assert.equal(packed.clips[0].speaker, 'Buzz');
  assert.equal(packed.clips[0].kind, 'audio');
  assert.equal(packed.clips[1].speaker, 'Woody');
  assert.equal(packed.clips.at(-1).name, '10_woody.mp3');
  assert.equal(packed.clips.at(-1).target, 'Rendezvous with Star Command.');
});

test('rejects a zip over the size cap', async () => {
  const oversize = { size: 300 * 1024 * 1024, arrayBuffer: async () => zipBuffer };
  await assert.rejects(() => sandbox.__test.extractPack(oversize), /over 256 MB/);
});

test('ignores punctuation and apostrophes when matching', () => {
  const norm = sandbox.__test.normalize;
  assert.equal(norm('According to my nava-computer, the-'), 'according to my nava computer the');
  assert.equal(norm('I’m lost!'), 'im lost');
});
