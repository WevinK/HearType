import test from 'node:test';
import assert from 'node:assert/strict';

const sentencesModule = await import('../lib/sentences.ts');
const captionsModule = await import('../lib/youtube-captions.ts');

test('groups millisecond caption cues into sentence clips', () => {
  assert.equal(typeof sentencesModule.buildCaptionSentences, 'function');

  const result = sentencesModule.buildCaptionSentences([
    { text: '[Music]', offset: 700, duration: 3550 },
    { text: 'hello welcome to the english', offset: 7359, duration: 6320 },
    { text: 'easy practice course', offset: 10000, duration: 5759 },
    { text: 'now you will listen to some daily conversations.', offset: 13679, duration: 4321 },
    { text: 'this is a new sentence', offset: 18000, duration: 2000 },
  ]);

  assert.equal(result.length, 2);
  assert.equal(
    result[0].text,
    'hello welcome to the english easy practice course now you will listen to some daily conversations.'
  );
  assert.ok(Math.abs(result[0].start - 7.359) < 1e-9);
  assert.equal(result[0].end, 18);
  assert.equal(result[1].text, 'this is a new sentence');
  assert.equal(result[1].start, 18);
  assert.equal(result[1].end, 20);
});

test('handles second-based caption cues and sentence punctuation', () => {
  const result = sentencesModule.buildCaptionSentences([
    { text: 'Hello there.', offset: 1, duration: 1 },
    { text: 'How are you?', offset: 2.5, duration: 1 },
  ]);

  assert.deepEqual(result, [
    { start: 1, end: 2, text: 'Hello there.' },
    { start: 2.5, end: 3.5, text: 'How are you?' },
  ]);
});

test('starts a new caption clip after a pause without punctuation', () => {
  const result = sentencesModule.buildCaptionSentences([
    { text: 'first part', offset: 0, duration: 1 },
    { text: 'second part', offset: 3, duration: 1 },
  ]);

  assert.deepEqual(result, [
    { start: 0, end: 1, text: 'first part' },
    { start: 3, end: 4, text: 'second part' },
  ]);
});

test('drops non-speech caption cues', () => {
  const result = sentencesModule.buildCaptionSentences([
    { text: '[Music]', offset: 0, duration: 1 },
    { text: '♪', offset: 1, duration: 1 },
    { text: '(inaudible)', offset: 2, duration: 1 },
    { text: 'Hello there.', offset: 4, duration: 1.5 },
  ]);

  assert.deepEqual(result, [{ start: 4, end: 5.5, text: 'Hello there.' }]);
});

test('does not overlap clips when a long caption group splits', () => {
  const result = sentencesModule.buildCaptionSentences([
    { text: 'a', offset: 0, duration: 10000 },
    { text: 'b', offset: 6000, duration: 10000 },
    { text: 'c', offset: 12000, duration: 2000 },
  ]);

  assert.equal(result.length, 2);
  assert.equal(result[0].end, 6);
  assert.equal(result[1].start, 6);
});

test('keeps caption clips within the time cap', () => {
  const cues = Array.from({ length: 6 }, (_, index) => ({
    text: 'word '.repeat(10).trim(),
    offset: index * 5000,
    duration: 5000,
  }));

  const result = sentencesModule.buildCaptionSentences(cues);

  assert.equal(result.length, 2);
  assert.ok(result.every((sentence) => sentence.end - sentence.start <= 15 + 1e-9));
});

test('fetches caption cues through the YouTubeTranscript package', async () => {
  assert.equal(typeof captionsModule.fetchYouTubeCaptions, 'function');

  const fakeFetch = async (input) => {
    const url = String(input);
    if (url.includes('/youtubei/v1/player')) {
      return new Response(
        JSON.stringify({
          captions: {
            playerCaptionsTracklistRenderer: {
              captionTracks: [
                {
                  baseUrl: 'https://www.youtube.com/api/timedtext?v=abc12345678&lang=en',
                  languageCode: 'en',
                },
              ],
            },
          },
        }),
        { status: 200 }
      );
    }
    if (url.includes('/api/timedtext')) {
      return new Response(
        '<transcript><text start="0" dur="1.5">Hello there</text><text start="1.6" dur="1.5">How are you</text></transcript>',
        { status: 200 }
      );
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const result = await captionsModule.fetchYouTubeCaptions('abc12345678', fakeFetch);

  assert.equal(result.length, 1);
  assert.equal(result[0].text, 'Hello there How are you');
  assert.equal(result[0].start, 0);
  assert.equal(result[0].end, 3.1);
});
