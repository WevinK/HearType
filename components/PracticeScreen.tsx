'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { formatTime } from '@/lib/listening';
import { clipPlaybackEnd } from '@/lib/playback';
import { addedWrongSlots, buildTypingLayout, evaluateTyping, seededRandom } from '@/lib/typing';
import { activeWordIndex, resolveWordTimings } from '@/lib/word-timing';
import type { Clip, MediaKind, Sentence, SentenceWord } from '@/lib/types';

type Props = {
  mediaUrl: string;
  mediaKind: MediaKind;
  sentences: Sentence[];
  cluePercent: number;
  onFinish: (clips: Clip[]) => void;
  onRestart: () => void;
};

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5];

function fieldValueOf(typed: string, indices: number[]): string {
  let value = '';
  for (const index of indices) {
    const char = typed[index];
    if (!char || char === ' ') break;
    value += char;
  }
  return value;
}

function writeField(
  typed: string,
  indices: number[],
  value: string,
  hiddenCount: number
): string {
  const chars = typed.slice(0, hiddenCount).padEnd(hiddenCount, ' ').split('');
  indices.forEach((index, position) => {
    chars[index] = position < value.length ? value[position] : ' ';
  });
  return chars.join('');
}

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
  cluePercent,
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
  const [fieldIndex, setFieldIndex] = useState(0);
  const fieldIndexRef = useRef(0);
  const [mistakes, setMistakes] = useState<number[]>([]);
  const mistakesRef = useRef<number[]>([]);
  const [readOnly, setReadOnly] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>({ text: '', kind: '' });
  const [attemptHint, setAttemptHint] = useState('Type the missing letters');
  const [shakeSlot, setShakeSlot] = useState<number | null>(null);

  const [counting, setCounting] = useState(true);
  const [countdown, setCountdown] = useState(3);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isAudioUI, setIsAudioUI] = useState(mediaKind === 'audio');
  const [hideVideo, setHideVideo] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(0);
  const [volume, setVolume] = useState(1);
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
        cluePercent / 100,
        seededRandom(current?.revealSeed ?? 0)
      ),
    [current?.text, current?.revealSeed, cluePercent]
  );
  const fields = useMemo(
    () =>
      layout.words
        .filter((word) => !word.revealed)
        .map((word) => ({ indices: word.hiddenIndices })),
    [layout]
  );
  const activeField = fields[fieldIndex] ?? null;
  const caretOffset = activeField ? fieldValueOf(typed, activeField.indices).length : 0;
  const caretSlot =
    activeField && activeField.indices.length
      ? activeField.indices[Math.min(caretOffset, activeField.indices.length - 1)]
      : null;
  const caretAfter = !!activeField && caretOffset === activeField.indices.length;
  const evaluation = useMemo(
    () => evaluateTyping(layout, typed, mistakes, readOnly ? null : caretSlot),
    [layout, typed, mistakes, readOnly, caretSlot]
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
      fieldIndexRef.current = 0;
      setFieldIndex(0);
      setMistakes(currentClip.mistakes);
      mistakesRef.current = currentClip.mistakes;
      setReadOnly(currentClip.result === 'correct');
      setShakeSlot(null);
      setShowTap(false);
      const wrongHint = currentClip.attempts
        ? `${currentClip.attempts} wrong ${currentClip.attempts === 1 ? 'key' : 'keys'}`
        : '';
      setAttemptHint(
        currentClip.result === 'correct' ? wrongHint : wrongHint || 'Type the missing letters'
      );
      setFeedback(
        currentClip.result === 'correct' ? { text: 'Already solved.', kind: 'good' } : { text: '', kind: '' }
      );

      if (autoplay) seekAndPlay(currentClip.start);
      inputRef.current?.focus({ preventScroll: true });
    },
    [seekAndPlay]
  );

  function seekWithinClip(value: number) {
    const video = videoRef.current;
    const clip = clipRef.current;
    if (!video || !clip) return;

    const target = Math.min(
      clipPlaybackEnd(clip, video.duration),
      Math.max(clip.start, clip.start + value)
    );
    try {
      video.currentTime = target;
    } catch {
      // Metadata is not ready yet; the browser will keep the seek queued.
    }
    setCurrentTime(target);
    const nextWord = activeWordIndex(wordTimingsRef.current, target);
    spokenWordRef.current = nextWord;
    setSpokenWord(nextWord);
  }

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
    setShakeSlot(null);
    setAttemptHint(
      clip.attempts ? `${clip.attempts} wrong ${clip.attempts === 1 ? 'key' : 'keys'}` : ''
    );
    setFeedback({ text: '✓ Correct!', kind: 'good' });
  }, [updateClips]);

  useEffect(() => {
    if (!counting && current && current.result === 'pending' && layout.hiddenCount === 0) {
      markCorrect();
    }
  }, [counting, current, layout.hiddenCount, markCorrect]);

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

  const pulseWrong = useCallback((slot: number) => {
    buzz();
    setShakeSlot(null);
    window.requestAnimationFrame(() => setShakeSlot(slot));
    if (shakeRef.current !== null) window.clearTimeout(shakeRef.current);
    shakeRef.current = window.setTimeout(() => setShakeSlot(null), 450);
  }, [buzz]);

  function paddedTyped(value: string): string {
    return value.slice(0, layout.hiddenCount).padEnd(layout.hiddenCount, ' ');
  }

  function focusField(index: number) {
    if (!fields.length) return;
    const nextIndex = Math.max(0, Math.min(fields.length - 1, index));
    fieldIndexRef.current = nextIndex;
    setFieldIndex(nextIndex);
  }

  function commitTyped(value: string, nextField: number, wrongSlots?: number[]) {
    if (readOnly || counting) return;

    const previous = paddedTyped(typedRef.current);
    const next = paddedTyped(value);
    const fieldAt = fields.length
      ? Math.max(0, Math.min(fields.length - 1, nextField))
      : 0;

    fieldIndexRef.current = fieldAt;
    setFieldIndex(fieldAt);

    if (next === previous) return;

    const currentIndex = indexRef.current;
    const clip = clipsRef.current[currentIndex];
    if (!clip) return;

    const added = wrongSlots ?? addedWrongSlots(previous, next, layout.hiddenChars);
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
              answer: next.trim() ? nextEvaluation.answer : '',
              lastWrong: wrongAdded ? nextEvaluation.answer : item.lastWrong,
            }
          : item
      )
    );

    if (wrongAdded) {
      setFeedback({ text: 'Not quite — check the red key.', kind: 'bad' });
      setAttemptHint(`${attempts} wrong ${attempts === 1 ? 'key' : 'keys'}`);
      pulseWrong(added[0]);
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

  function typeText(text: string) {
    if (readOnly || counting) return;

    const field = fields[fieldIndexRef.current];
    if (!field) return;

    const letters = Array.from(text).filter((char) => /[\p{L}\p{N}]/u.test(char));
    if (!letters.length) return;

    const max = field.indices.length;
    const before = fieldValueOf(typedRef.current, field.indices);
    let value = before;
    for (const letter of letters) {
      if (value.length >= max) break;
      value += letter;
    }

    const next = writeField(typedRef.current, field.indices, value, layout.hiddenCount);
    let nextField = fieldIndexRef.current;
    if (before.length < max && value.length >= max) {
      for (let i = fieldIndexRef.current + 1; i < fields.length; i++) {
        if (fieldValueOf(next, fields[i].indices).length < fields[i].indices.length) {
          nextField = i;
          break;
        }
      }
    }

    commitTyped(next, nextField);
  }

  function eraseBackward() {
    if (readOnly || counting) return;

    const currentIndex = fieldIndexRef.current;
    const field = fields[currentIndex];
    if (!field) return;

    const value = fieldValueOf(typedRef.current, field.indices);
    if (value.length) {
      commitTyped(
        writeField(typedRef.current, field.indices, value.slice(0, -1), layout.hiddenCount),
        currentIndex,
        []
      );
      return;
    }

    // On an empty word, erase the nearest earlier written word.
    for (let i = currentIndex - 1; i >= 0; i--) {
      const previous = fields[i];
      const previousValue = fieldValueOf(typedRef.current, previous.indices);
      if (previousValue.length) {
        commitTyped(
          writeField(
            typedRef.current,
            previous.indices,
            previousValue.slice(0, -1),
            layout.hiddenCount
          ),
          i,
          []
        );
        return;
      }
    }

    focusField(0);
  }

  function moveField(direction: -1 | 1) {
    if (readOnly || counting) return;
    focusField(fieldIndexRef.current + direction);
  }

  function handleTypingClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (readOnly || counting) return;
    inputRef.current?.focus({ preventScroll: true });

    const target = (event.target as HTMLElement).closest<HTMLElement>('.typing-char');
    if (!target) return;

    const chars = [...event.currentTarget.querySelectorAll<HTMLElement>('.typing-char')];
    let slotChar: HTMLElement | null = target;

    if (target.dataset.slot === undefined) {
      const clickedIndex = chars.indexOf(target);
      slotChar = null;
      for (let i = clickedIndex + 1; i < chars.length; i++) {
        if (chars[i].dataset.slot !== undefined) {
          slotChar = chars[i];
          break;
        }
      }
      if (!slotChar) {
        for (let i = clickedIndex; i >= 0; i--) {
          if (chars[i].dataset.slot !== undefined) {
            slotChar = chars[i];
            break;
          }
        }
      }
      if (!slotChar) return;
    }

    const slot = Number(slotChar.dataset.slot);
    const fieldAt = fields.findIndex((field) => field.indices.includes(slot));
    if (fieldAt >= 0) focusField(fieldAt);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;

    if (event.key === 'Enter') {
      event.preventDefault();
      if (counting) return;

      const clip = clipsRef.current[indexRef.current];
      if (!clip) return;

      if (clip.result === 'correct') {
        advance();
        return;
      }

      if (!typedRef.current.trim()) {
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
      return;
    }

    if (readOnly || counting || event.ctrlKey || event.metaKey || event.altKey) return;

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      moveField(-1);
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      moveField(1);
      return;
    }
    if (event.key === 'Backspace') {
      event.preventDefault();
      eraseBackward();
      return;
    }
    if (event.key === 'Delete') {
      event.preventDefault();
      return;
    }
    if (event.key.length === 1) {
      event.preventDefault();
      typeText(event.key);
    }
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
    setShakeSlot(null);
    fieldIndexRef.current = 0;
    setFieldIndex(0);
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
                answer: value.trim() ? result.answer : '',
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
    if (clip && clip.result === 'pending' && typedRef.current.trim()) {
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
      if (
        video.currentTime >= clipPlaybackEnd(clip, video.duration) - 0.05 ||
        video.currentTime < clip.start - 0.05
      ) {
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
    if (videoRef.current) videoRef.current.volume = volume;
  }, [volume]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onPlay = () => {
      setIsPlaying(true);
      setShowTap(false);
    };
    const onPause = () => setIsPlaying(false);
    const onEnded = () => setIsPlaying(false);
    const onMetadata = () => {
      setIsAudioUI(video.videoWidth === 0);
      setMediaDuration(Number.isFinite(video.duration) ? video.duration : 0);
    };
    const onTimeUpdate = () => setCurrentTime(video.currentTime);
    const onError = () =>
      setFeedback({ text: 'This browser could not play that file.', kind: 'bad' });

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onEnded);
    video.addEventListener('loadedmetadata', onMetadata);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('error', onError);
    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('loadedmetadata', onMetadata);
      video.removeEventListener('timeupdate', onTimeUpdate);
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
      if (clip && !video.paused && video.currentTime >= clipPlaybackEnd(clip, video.duration)) {
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
  const clipDuration = clipPlaybackEnd(current, mediaDuration) - current.start;
  const clipTime = Math.max(0, Math.min(currentTime - current.start, clipDuration));

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

        <div className="player-bar">
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

          <span className="player-time">
            {formatTime(clipTime)} / {formatTime(clipDuration)}
          </span>

          <input
            className="seek-bar"
            type="range"
            min={0}
            max={clipDuration}
            step={0.1}
            value={clipTime}
            onChange={(event) => seekWithinClip(Number(event.target.value))}
            disabled={counting || clipDuration <= 0}
            aria-label="Seek within sentence"
          />

          <label className="volume-control">
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M11 5 6 9H3v6h3l5 4V5z" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              <path d="M18.36 5.64a9 9 0 0 1 0 12.72" />
            </svg>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(event) => setVolume(Number(event.target.value))}
              aria-label="Volume"
            />
          </label>

          <label className="speed-control">
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
      </div>

      <div className="answer-row">
        <button
          className="icon-btn answer-nav"
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

      <div className="answer">
        <div className="answer-head">
          <div className="answer-title">
            <label htmlFor="answerInput">Type the missing letters</label>
            {current.custom && (
              <span
                className="custom-chip"
                title="Word timing is estimated from your edited text."
              >
                Custom sentence
              </span>
            )}
          </div>
          <button
            className="clear-btn"
            type="button"
            onClick={clearInput}
            disabled={counting || readOnly || !typed.trim()}
          >
            Clear input
          </button>
        </div>
        <div className="typing-shell" onClick={handleTypingClick}>
          <div className="typing-display" aria-hidden="true">
            {evaluation.words.map((word, wordIndex) => (
              <span
                key={wordIndex}
                className={`typing-word ${word.state}${word.active ? ' active' : ''}${
                  wordIndex === spokenWord ? ' spoken' : ''
                }`}
              >
                {word.chars.map((char, charIndex) => (
                  <span
                    key={charIndex}
                    data-slot={char.hiddenIndex ?? undefined}
                    className={`typing-char ${char.state}${
                      !readOnly &&
                      !caretAfter &&
                      char.hiddenIndex !== null &&
                      char.hiddenIndex === caretSlot
                        ? ' caret'
                        : ''
                    }${
                      !readOnly &&
                      caretAfter &&
                      char.hiddenIndex !== null &&
                      char.hiddenIndex === caretSlot
                        ? ' caret-after'
                        : ''
                    }${
                      char.hiddenIndex !== null && char.hiddenIndex === shakeSlot
                        ? ' shake'
                        : ''
                    }`}
                  >
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
            onChange={() => undefined}
            onKeyDown={onKeyDown}
            onBeforeInput={(event) => {
              const native = event.nativeEvent as InputEvent;
              if (native.inputType === 'insertText') {
                event.preventDefault();
                if (native.data) typeText(native.data);
                return;
              }
              if (native.inputType === 'deleteContentBackward') {
                event.preventDefault();
                eraseBackward();
                return;
              }
              if (native.inputType.startsWith('insert') || native.inputType.startsWith('delete')) {
                event.preventDefault();
              }
            }}
            onPaste={(event) => {
              event.preventDefault();
              typeText(event.clipboardData.getData('text'));
            }}
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
        <div className="answer-status">
          <p
            id="answerFeedback"
            className={`feedback${feedback.kind ? ` ${feedback.kind}` : ''}`}
            aria-live="polite"
          >
            {feedback.text}
          </p>
          <span className="answer-hint">
            {current.result === 'correct' ? 'Press Enter to continue' : attemptHint}
          </span>
        </div>
        {current.result === 'correct' && !counting && (
          <button className="btn btn-primary continue-btn" type="button" onClick={advance}>
            {index >= clips.length - 1 ? 'See results' : 'Continue'}
          </button>
        )}
      </div>

        <button
          className="icon-btn answer-nav"
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
