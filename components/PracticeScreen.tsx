'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import { addedWrongSlots, buildTypingLayout, evaluateTyping, seededRandom } from '@/lib/typing';
import { activeWordIndex, resolveWordTimings } from '@/lib/word-timing';
import type { Clip, MediaKind, Sentence, SentenceWord } from '@/lib/types';

type Props = {
  mediaUrl: string;
  mediaKind: MediaKind;
  sentences: Sentence[];
  onFinish: (clips: Clip[]) => void;
  onRestart: () => void;
};

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5];

function createClips(sentences: Sentence[]): Clip[] {
  return sentences.map((sentence, index) => ({
    ...sentence,
    attempts: 0,
    answer: '',
    typed: '',
    mistakes: [],
    revealSeed: Math.floor(Math.random() * 0xffffffff),
    lastWrong: '',
    result: 'pending' as const,
    skippedOnce: false,
    reached: index === 0,
  }));
}

type Feedback = { text: string; kind: '' | 'good' | 'bad' };

export default function PracticeScreen({
  mediaUrl,
  mediaKind,
  sentences,
  onFinish,
  onRestart,
}: Props) {
  const [clips, setClips] = useState<Clip[]>(() => createClips(sentences));
  const clipsRef = useRef(clips);
  const [index, setIndex] = useState(0);
  const indexRef = useRef(0);
  const clipRef = useRef<Clip | null>(clips[0] ?? null);

  const [typed, setTyped] = useState('');
  const typedRef = useRef('');
  const [mistakes, setMistakes] = useState<number[]>([]);
  const mistakesRef = useRef<number[]>([]);
  const [readOnly, setReadOnly] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>({ text: '', kind: '' });
  const [attemptHint, setAttemptHint] = useState('Type the missing letters');
  const [shake, setShake] = useState(false);

  const [counting, setCounting] = useState(true);
  const [countdown, setCountdown] = useState(3);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isAudioUI, setIsAudioUI] = useState(mediaKind === 'audio');
  const [hideVideo, setHideVideo] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showTap, setShowTap] = useState(false);
  const showAudioStage = isAudioUI || hideVideo;

  const videoRef = useRef<HTMLVideoElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const shakeRef = useRef<number | null>(null);
  const [spokenWord, setSpokenWord] = useState(-1);
  const spokenWordRef = useRef(-1);

  const current = clips[index];
  const layout = useMemo(
    () =>
      buildTypingLayout(
        current?.text ?? '',
        0.5,
        seededRandom(current?.revealSeed ?? 0)
      ),
    [current?.text, current?.revealSeed]
  );
  const evaluation = useMemo(
    () => evaluateTyping(layout, typed, mistakes),
    [layout, typed, mistakes]
  );
  const wordTimings = useMemo(
    () => (current ? resolveWordTimings(current) : []),
    [current?.text, current?.start, current?.end, current?.words]
  );
  const wordTimingsRef = useRef<SentenceWord[]>(wordTimings);

  useEffect(() => {
    wordTimingsRef.current = wordTimings;
  }, [wordTimings]);

  useEffect(() => {
    clipsRef.current = clips;
    clipRef.current = clips[index] ?? null;
  }, [clips, index]);

  const updateClips = useCallback((updater: (previous: Clip[]) => Clip[]) => {
    const next = updater(clipsRef.current);
    clipsRef.current = next;
    setClips(next);
  }, []);

  const seekAndPlay = useCallback((start: number) => {
    const video = videoRef.current;
    if (!video) return;
    setShowTap(false);
    try {
      video.currentTime = Math.max(0, start);
    } catch {
      // Metadata is not ready yet; the browser will keep the seek queued.
    }
    const attempt = video.play();
    if (attempt) attempt.catch(() => setShowTap(true));
  }, []);

  const goTo = useCallback(
    (nextIndex: number, autoplay = true) => {
      const all = clipsRef.current;
      if (nextIndex < 0 || nextIndex >= all.length) return;

      const nextClips = all.map((clip, i) => (i === nextIndex ? { ...clip, reached: true } : clip));
      const currentClip = nextClips[nextIndex];
      clipsRef.current = nextClips;
      clipRef.current = currentClip;
      indexRef.current = nextIndex;
      setClips(nextClips);
      setIndex(nextIndex);
      wordTimingsRef.current = resolveWordTimings(currentClip);
      spokenWordRef.current = -1;
      setSpokenWord(-1);

      setTyped(currentClip.typed);
      typedRef.current = currentClip.typed;
      setMistakes(currentClip.mistakes);
      mistakesRef.current = currentClip.mistakes;
      setReadOnly(currentClip.result === 'correct');
      setShake(false);
      setShowTap(false);
      setAttemptHint(
        currentClip.result === 'correct'
          ? 'Correct — press Enter or Continue.'
          : currentClip.attempts
            ? `${currentClip.attempts} wrong ${currentClip.attempts === 1 ? 'key' : 'keys'}`
            : 'Type the missing letters'
      );
      setFeedback(
        currentClip.result === 'correct'
          ? { text: 'Already solved — press Enter or Continue.', kind: 'good' }
          : { text: '', kind: '' }
      );

      if (autoplay) seekAndPlay(currentClip.start);
      inputRef.current?.focus({ preventScroll: true });
    },
    [seekAndPlay]
  );

  const finish = useCallback(() => {
    videoRef.current?.pause();
    onFinish(clipsRef.current);
  }, [onFinish]);

  const advance = useCallback(() => {
    if (indexRef.current >= clipsRef.current.length - 1) finish();
    else goTo(indexRef.current + 1);
  }, [finish, goTo]);

  const markCorrect = useCallback(() => {
    const currentIndex = indexRef.current;
    const clip = clipsRef.current[currentIndex];
    if (!clip || clip.result === 'correct') return;

    updateClips((all) =>
      all.map((item, i) =>
        i === currentIndex ? { ...item, result: 'correct' as const, answer: item.text } : item
      )
    );
    setReadOnly(true);
    setShake(false);
    setAttemptHint('Correct — press Enter or Continue.');
    setFeedback({ text: '✓ Correct! Press Enter or Continue.', kind: 'good' });
  }, [updateClips]);

  const buzz = useCallback(() => {
    try {
      const AudioContextClass = window.AudioContext;
      if (!AudioContextClass) return;
      const context = audioRef.current ?? new AudioContextClass();
      audioRef.current = context;
      if (context.state === 'suspended') void context.resume();

      const now = context.currentTime;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'square';
      oscillator.frequency.setValueAtTime(110, now);
      gain.gain.setValueAtTime(0.045, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.1);
    } catch {
      // Sound is optional; the red key is the primary feedback.
    }
  }, []);

  const pulseWrong = useCallback(() => {
    buzz();
    setShake(false);
    window.requestAnimationFrame(() => setShake(true));
    if (shakeRef.current !== null) window.clearTimeout(shakeRef.current);
    shakeRef.current = window.setTimeout(() => setShake(false), 450);
  }, [buzz]);

  function onTypingChange(event: ChangeEvent<HTMLInputElement>) {
    if (readOnly || counting) return;

    const previous = typedRef.current;
    const next = event.target.value
      .replace(/[^\p{L}\p{N}]/gu, '')
      .slice(0, layout.hiddenCount);

    if (next === previous) {
      event.target.value = next;
      return;
    }

    const currentIndex = indexRef.current;
    const clip = clipsRef.current[currentIndex];
    if (!clip) return;

    const added = addedWrongSlots(previous, next, layout.hiddenChars);
    let nextMistakes = mistakesRef.current;
    let wrongAdded = 0;

    if (added.length) {
      const known = new Set(nextMistakes);
      for (const slot of added) known.add(slot);
      nextMistakes = [...known];
      wrongAdded = added.length;
    }

    const nextEvaluation = evaluateTyping(layout, next, nextMistakes);
    const attempts = clip.attempts + wrongAdded;

    typedRef.current = next;
    setTyped(next);
    mistakesRef.current = nextMistakes;
    setMistakes(nextMistakes);
    updateClips((all) =>
      all.map((item, i) =>
        i === currentIndex
          ? {
              ...item,
              typed: next,
              mistakes: nextMistakes,
              attempts,
              answer: next ? nextEvaluation.answer : '',
              lastWrong: wrongAdded ? nextEvaluation.answer : item.lastWrong,
            }
          : item
      )
    );

    if (wrongAdded) {
      setFeedback({ text: 'Not quite — check the red key.', kind: 'bad' });
      setAttemptHint(`${attempts} wrong ${attempts === 1 ? 'key' : 'keys'}`);
      pulseWrong();
    } else {
      setFeedback({ text: '', kind: '' });
      setAttemptHint(
        nextEvaluation.complete && !nextEvaluation.correct
          ? 'Fix the red letters or press Next'
          : attempts
            ? `${attempts} wrong ${attempts === 1 ? 'key' : 'keys'}`
            : 'Type the missing letters'
      );
    }

    if (nextEvaluation.correct) markCorrect();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (counting) return;

    const clip = clipsRef.current[indexRef.current];
    if (!clip) return;

    if (clip.result === 'correct') {
      advance();
      return;
    }

    if (!typedRef.current) {
      setFeedback({ text: 'Type the missing letters first.', kind: 'bad' });
      return;
    }

    const result = evaluateTyping(layout, typedRef.current, mistakesRef.current);
    if (result.correct) {
      markCorrect();
      return;
    }

    setFeedback({
      text: result.complete
        ? 'Not quite — fix the red letters or press Next.'
        : 'Finish the missing letters.',
      kind: 'bad',
    });
  }

  function clearInput() {
    if (counting || readOnly) return;
    const currentIndex = indexRef.current;
    const clip = clipsRef.current[currentIndex];
    if (!clip || clip.result !== 'pending') return;

    typedRef.current = '';
    setTyped('');
    mistakesRef.current = [];
    setMistakes([]);
    updateClips((all) =>
      all.map((item, i) =>
        i === currentIndex
          ? { ...item, typed: '', mistakes: [], answer: '', lastWrong: '' }
          : item
      )
    );
    setFeedback({ text: '', kind: '' });
    setAttemptHint(
      clip.attempts
        ? `${clip.attempts} wrong ${clip.attempts === 1 ? 'key' : 'keys'}`
        : 'Type the missing letters'
    );
    setShake(false);
    inputRef.current?.focus({ preventScroll: true });
  }

  function goNext() {
    if (counting) return;

    const currentIndex = indexRef.current;
    const clip = clipsRef.current[currentIndex];
    if (!clip) return;

    if (clip.result === 'pending') {
      const value = typedRef.current;
      const result = evaluateTyping(layout, value, mistakesRef.current);
      if (result.correct) {
        markCorrect();
        advance();
        return;
      }
      updateClips((all) =>
        all.map((item, i) =>
          i === currentIndex
            ? {
                ...item,
                result: 'skipped' as const,
                skippedOnce: true,
                answer: value ? result.answer : '',
              }
            : item
        )
      );
    }
    advance();
  }

  function endSession() {
    const currentIndex = indexRef.current;
    const clip = clipsRef.current[currentIndex];
    if (clip && clip.result === 'pending' && typedRef.current) {
      const result = evaluateTyping(layout, typedRef.current, mistakesRef.current);
      if (result.correct) markCorrect();
    }
    finish();
  }

  const togglePlayback = useCallback(() => {
    if (counting) return;
    const video = videoRef.current;
    const clip = clipRef.current;
    if (!video || !clip) return;

    if (video.paused) {
      if (video.currentTime >= clip.end - 0.05 || video.currentTime < clip.start - 0.05) {
        seekAndPlay(clip.start);
      } else {
        const attempt = video.play();
        if (attempt) attempt.catch(() => setShowTap(true));
      }
    } else {
      video.pause();
    }
  }, [counting, seekAndPlay]);

  function repeat() {
    if (counting) return;
    const clip = clipRef.current;
    if (clip) seekAndPlay(clip.start);
  }

  function handleTap() {
    const clip = clipRef.current;
    if (clip) seekAndPlay(clip.start);
  }

  useEffect(() => {
    setCounting(true);
    setCountdown(3);
    const timers = [
      window.setTimeout(() => setCountdown(2), 800),
      window.setTimeout(() => setCountdown(1), 1600),
      window.setTimeout(() => {
        setCounting(false);
        const first = clipsRef.current[0];
        if (first) seekAndPlay(first.start);
      }, 2400),
    ];
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [seekAndPlay]);

  useEffect(() => {
    if (!counting) inputRef.current?.focus({ preventScroll: true });
  }, [counting]);

  useEffect(() => {
    document.body.classList.toggle('playing', isPlaying);
    return () => document.body.classList.remove('playing');
  }, [isPlaying]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = speed;
  }, [speed]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onPlay = () => {
      setIsPlaying(true);
      setShowTap(false);
    };
    const onPause = () => setIsPlaying(false);
    const onEnded = () => setIsPlaying(false);
    const onMetadata = () => setIsAudioUI(video.videoWidth === 0);
    const onError = () =>
      setFeedback({ text: 'This browser could not play that file.', kind: 'bad' });

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onEnded);
    video.addEventListener('loadedmetadata', onMetadata);
    video.addEventListener('error', onError);
    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('loadedmetadata', onMetadata);
      video.removeEventListener('error', onError);
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let frame = 0;

    const tick = () => {
      const nextWord = activeWordIndex(wordTimingsRef.current, video.currentTime);
      if (nextWord !== spokenWordRef.current) {
        spokenWordRef.current = nextWord;
        setSpokenWord(nextWord);
      }

      const clip = clipRef.current;
      if (clip && !video.paused && video.currentTime >= clip.end) {
        video.pause();
        try {
          video.currentTime = clip.start;
        } catch {
          // Ignore a seek race while the media is changing.
        }
        return;
      }
      frame = window.requestAnimationFrame(tick);
    };

    const onPlay = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(tick);
    };
    const onPause = () => window.cancelAnimationFrame(frame);

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    return () => {
      window.cancelAnimationFrame(frame);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (shakeRef.current !== null) window.clearTimeout(shakeRef.current);
      if (audioRef.current) void audioRef.current.close().catch(() => undefined);
    };
  }, []);

  if (!current) return null;

  const liveScore = clips.filter((clip) => clip.result === 'correct').length;
  const progress = (index + 1) / clips.length * 100;

  return (
    <section className="screen play">
      <h1 className="sr-only">Listening practice</h1>

      <div className="progress-rail" aria-hidden="true">
        <div id="progressFill" style={{ width: `${progress}%` }} />
      </div>

      <div className="play-head">
        <span className="chip">
          {index + 1} / {clips.length}
        </span>
        <span className="score-chip">
          <span className="dot" aria-hidden="true" />
          <b>{liveScore}</b>&nbsp;correct
        </span>
      </div>

      <div className={`video-wrap${showAudioStage ? ' audio' : ''}`}>
        <video
          ref={videoRef}
          src={mediaUrl}
          playsInline
          preload="auto"
          onClick={togglePlayback}
        />

        {showAudioStage && (
          <div className="audio-stage" onClick={togglePlayback}>
            <span className="audio-kicker">Listen</span>
            <div className="audio-wave" aria-hidden="true">
              {Array.from({ length: 9 }).map((_, i) => (
                <span key={i} />
              ))}
            </div>
            <p className="audio-speaker">
              {hideVideo && !isAudioUI ? 'Audio only' : 'Audio clip'}
            </p>
          </div>
        )}

        {showTap && (
          <button className="tap-play" type="button" onClick={handleTap}>
            Tap to play
          </button>
        )}

        {counting && (
          <div className="countdown">
            <div className="countdown-inner">
              <span className="countdown-label">Get ready</span>
              <span id="countdownNum" className="pop" key={countdown} aria-live="polite">
                {countdown}
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="transport">
        <button
          className="icon-btn"
          type="button"
          aria-label="Previous sentence"
          title="Previous sentence"
          disabled={counting || index === 0}
          onClick={() => goTo(indexRef.current - 1)}
        >
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M19 20 9 12l10-8" />
            <path d="M5 19V5" />
          </svg>
        </button>

        <button
          className="icon-btn"
          type="button"
          aria-label="Repeat sentence"
          title="Repeat sentence"
          disabled={counting}
          onClick={repeat}
        >
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m17 2 4 4-4 4" />
            <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
            <path d="m7 22-4-4 4-4" />
            <path d="M21 13v1a4 4 0 0 1-4 4H3" />
          </svg>
        </button>

        <button
          className="icon-btn play-btn"
          type="button"
          aria-label={isPlaying ? 'Pause' : 'Play'}
          title={isPlaying ? 'Pause' : 'Play'}
          disabled={counting}
          onClick={togglePlayback}
        >
          {isPlaying ? (
            <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
              <rect x="6" y="5" width="4" height="14" rx="1.2" />
              <rect x="14" y="5" width="4" height="14" rx="1.2" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
              <path d="M8 5.14v13.72a1 1 0 0 0 1.53.85l10.2-6.86a1 1 0 0 0 0-1.7L9.53 4.3A1 1 0 0 0 8 5.14z" />
            </svg>
          )}
        </button>

        <button
          className="icon-btn"
          type="button"
          aria-label="Next sentence"
          title="Next sentence"
          disabled={counting}
          onClick={goNext}
        >
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m5 4 10 8-10 8" />
            <path d="M19 5v14" />
          </svg>
        </button>
      </div>

      <div className="play-tools">
        <label className="speed-control">
          <span>Speed</span>
          <select
            value={speed}
            onChange={(event) => setSpeed(Number(event.target.value))}
            aria-label="Playback speed"
          >
            {SPEEDS.map((value) => (
              <option key={value} value={value}>
                {value}×
              </option>
            ))}
          </select>
        </label>
        {!isAudioUI && (
          <button
            className={`tool-btn${hideVideo ? ' active' : ''}`}
            type="button"
            aria-pressed={hideVideo}
            title={hideVideo ? 'Show the video' : 'Hide the video and show audio only'}
            onClick={() => setHideVideo((value) => !value)}
          >
            {hideVideo ? 'Show video' : 'Audio only'}
          </button>
        )}
      </div>

      <div className="answer">
        <div className="answer-head">
          <label htmlFor="answerInput">Type the missing letters</label>
          <button
            className="clear-btn"
            type="button"
            onClick={clearInput}
            disabled={counting || readOnly || !typed}
          >
            Clear input
          </button>
        </div>
        <div className={`typing-shell${shake ? ' shake' : ''}`}>
          <div className="typing-display" aria-hidden="true">
            {evaluation.words.map((word, wordIndex) => (
              <span
                key={wordIndex}
                className={`typing-word ${word.state}${word.active ? ' active' : ''}${
                  wordIndex === spokenWord ? ' spoken' : ''
                }`}
              >
                {word.chars.map((char, charIndex) => (
                  <span key={charIndex} className={`typing-char ${char.state}`}>
                    {char.state === 'blank' ? ' ' : (char.typedChar ?? char.char)}
                  </span>
                ))}
              </span>
            ))}
          </div>
          <input
            id="answerInput"
            ref={inputRef}
            className="typing-capture"
            value={typed}
            onChange={onTypingChange}
            onKeyDown={onKeyDown}
            readOnly={readOnly}
            disabled={counting}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="done"
            inputMode="text"
            aria-invalid={feedback.kind === 'bad'}
            aria-describedby="answerFeedback"
          />
        </div>
        <p
          id="answerFeedback"
          className={`feedback${feedback.kind ? ` ${feedback.kind}` : ''}`}
          aria-live="polite"
        >
          {feedback.text}
        </p>
        <div className="answer-meta">
          <span>{attemptHint}</span>
          <span>{current.result === 'correct' ? 'Press Enter or Continue' : 'Every key is checked'}</span>
        </div>
        {current.result === 'correct' && !counting && (
          <button className="btn btn-primary continue-btn" type="button" onClick={advance}>
            {index >= clips.length - 1 ? 'See results' : 'Continue'}
          </button>
        )}
      </div>

      <div className="session-actions">
        <button className="link-btn" type="button" onClick={onRestart}>
          Start from beginning
        </button>
        <button className="link-btn" type="button" onClick={endSession}>
          End session
        </button>
      </div>
    </section>
  );
}
