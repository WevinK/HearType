'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import { normalize } from '@/lib/listening';
import type { Clip, MediaKind, Sentence } from '@/lib/types';

type Props = {
  mediaUrl: string;
  mediaKind: MediaKind;
  sentences: Sentence[];
  onFinish: (clips: Clip[]) => void;
};

function createClips(sentences: Sentence[]): Clip[] {
  return sentences.map((sentence, index) => ({
    ...sentence,
    attempts: 0,
    answer: '',
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
}: Props) {
  const [clips, setClips] = useState<Clip[]>(() => createClips(sentences));
  const clipsRef = useRef(clips);
  const [index, setIndex] = useState(0);
  const indexRef = useRef(0);
  const clipRef = useRef<Clip | null>(clips[0] ?? null);

  const [answer, setAnswer] = useState('');
  const answerRef = useRef('');
  const [readOnly, setReadOnly] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>({ text: '', kind: '' });
  const [attemptHint, setAttemptHint] = useState('Press Enter to check');
  const [shake, setShake] = useState(false);

  const [counting, setCounting] = useState(true);
  const [countdown, setCountdown] = useState(3);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isAudioUI, setIsAudioUI] = useState(mediaKind === 'audio');
  const [showTap, setShowTap] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const advanceRef = useRef<number | null>(null);
  const checkRef = useRef<number | null>(null);
  const shakeRef = useRef<number | null>(null);

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

      if (advanceRef.current !== null) {
        window.clearTimeout(advanceRef.current);
        advanceRef.current = null;
      }
      if (checkRef.current !== null) {
        window.clearTimeout(checkRef.current);
        checkRef.current = null;
      }

      const nextClips = all.map((clip, i) => (i === nextIndex ? { ...clip, reached: true } : clip));
      const currentClip = nextClips[nextIndex];
      clipsRef.current = nextClips;
      clipRef.current = currentClip;
      indexRef.current = nextIndex;
      setClips(nextClips);
      setIndex(nextIndex);

      const restored = currentClip.result === 'correct' ? currentClip.text : currentClip.answer;
      setAnswer(restored);
      answerRef.current = restored;
      setReadOnly(currentClip.result === 'correct');
      setShake(false);
      setShowTap(false);
      setAttemptHint(
        currentClip.attempts
          ? `${currentClip.attempts} wrong ${currentClip.attempts === 1 ? 'try' : 'tries'}`
          : 'Press Enter to check'
      );
      setFeedback(
        currentClip.result === 'correct'
          ? { text: 'Already solved — press Enter for the next sentence.', kind: 'good' }
          : { text: '', kind: '' }
      );

      if (autoplay) seekAndPlay(currentClip.start);
      inputRef.current?.focus({ preventScroll: true });
    },
    [seekAndPlay]
  );

  const finish = useCallback(() => {
    if (advanceRef.current !== null) {
      window.clearTimeout(advanceRef.current);
      advanceRef.current = null;
    }
    if (checkRef.current !== null) {
      window.clearTimeout(checkRef.current);
      checkRef.current = null;
    }
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

    if (checkRef.current !== null) {
      window.clearTimeout(checkRef.current);
      checkRef.current = null;
    }
    updateClips((all) =>
      all.map((item, i) =>
        i === currentIndex ? { ...item, result: 'correct' as const, answer: item.text } : item
      )
    );
    setReadOnly(true);
    setShake(false);
    setFeedback({ text: '✓ Correct!', kind: 'good' });
    advanceRef.current = window.setTimeout(advance, 700);
  }, [advance, updateClips]);

  const pulseWrong = useCallback(() => {
    setShake(false);
    window.requestAnimationFrame(() => setShake(true));
    if (shakeRef.current !== null) window.clearTimeout(shakeRef.current);
    shakeRef.current = window.setTimeout(() => setShake(false), 450);
  }, []);

  function onAnswerChange(event: ChangeEvent<HTMLInputElement>) {
    const value = event.target.value;
    setAnswer(value);
    answerRef.current = value;

    if (readOnly || counting) return;

    const currentIndex = indexRef.current;
    updateClips((all) =>
      all.map((clip, i) => (i === currentIndex ? { ...clip, answer: value } : clip))
    );
    if (checkRef.current !== null) {
      window.clearTimeout(checkRef.current);
      checkRef.current = null;
    }
    setShake(false);
    if (!value.trim()) return;

    checkRef.current = window.setTimeout(() => {
      if (indexRef.current !== currentIndex) return;
      const clip = clipsRef.current[currentIndex];
      if (!clip || clip.result === 'correct') return;
      if (normalize(value) === normalize(clip.text)) markCorrect();
    }, 450);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (counting) return;

    if (checkRef.current !== null) {
      window.clearTimeout(checkRef.current);
      checkRef.current = null;
    }

    const currentIndex = indexRef.current;
    const clip = clipsRef.current[currentIndex];
    if (!clip) return;

    if (clip.result === 'correct') {
      advance();
      return;
    }

    const value = answerRef.current.trim();
    if (!value) {
      setFeedback({ text: 'Type what you hear first.', kind: 'bad' });
      pulseWrong();
      return;
    }

    if (normalize(value) === normalize(clip.text)) {
      markCorrect();
      return;
    }

    const attempts = clip.attempts + 1;
    updateClips((all) =>
      all.map((item, i) =>
        i === currentIndex ? { ...item, attempts, answer: value, lastWrong: value } : item
      )
    );
    setFeedback({
      text: `Not quite — wrong try ${attempts}. Listen again.`,
      kind: 'bad',
    });
    setAttemptHint(`${attempts} wrong ${attempts === 1 ? 'try' : 'tries'}`);
    pulseWrong();
  }

  function goNext() {
    if (counting) return;
    if (advanceRef.current !== null) {
      window.clearTimeout(advanceRef.current);
      advanceRef.current = null;
    }
    if (checkRef.current !== null) {
      window.clearTimeout(checkRef.current);
      checkRef.current = null;
    }

    const currentIndex = indexRef.current;
    const clip = clipsRef.current[currentIndex];
    if (!clip) return;

    if (clip.result === 'pending') {
      const value = answerRef.current;
      if (value.trim() && normalize(value) === normalize(clip.text)) {
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
                answer: value.trim(),
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
    if (
      clip &&
      clip.result === 'pending' &&
      answerRef.current.trim() &&
      normalize(answerRef.current) === normalize(clip.text)
    ) {
      updateClips((all) =>
        all.map((item, i) =>
          i === currentIndex ? { ...item, result: 'correct' as const, answer: item.text } : item
        )
      );
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
      if (advanceRef.current !== null) window.clearTimeout(advanceRef.current);
      if (checkRef.current !== null) window.clearTimeout(checkRef.current);
      if (shakeRef.current !== null) window.clearTimeout(shakeRef.current);
    };
  }, []);

  const current = clips[index];
  if (!current) return null;

  const liveScore = clips.filter((clip) => clip.result === 'correct').length;
  const progress = (index + 1) / clips.length * 100;
  const inputClass = [readOnly ? 'correct' : '', shake ? 'shake wrong' : '']
    .filter(Boolean)
    .join(' ');

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

      <div className={`video-wrap${isAudioUI ? ' audio' : ''}`}>
        <video
          ref={videoRef}
          src={mediaUrl}
          playsInline
          preload="auto"
          onClick={togglePlayback}
        />

        {isAudioUI && (
          <div className="audio-stage" onClick={togglePlayback}>
            <span className="audio-kicker">Listen</span>
            <div className="audio-wave" aria-hidden="true">
              {Array.from({ length: 9 }).map((_, i) => (
                <span key={i} />
              ))}
            </div>
            <p className="audio-speaker">Audio clip</p>
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

      <div className="answer">
        <label htmlFor="answerInput">Type what you heard</label>
        <input
          id="answerInput"
          ref={inputRef}
          className={inputClass}
          value={answer}
          onChange={onAnswerChange}
          onKeyDown={onKeyDown}
          readOnly={readOnly}
          disabled={counting}
          placeholder="…"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="done"
          aria-invalid={feedback.kind === 'bad'}
        />
        <p className={`feedback${feedback.kind ? ` ${feedback.kind}` : ''}`} aria-live="polite">
          {feedback.text}
        </p>
        <div className="answer-meta">
          <span>{attemptHint}</span>
          <span>Auto-plays next when correct</span>
        </div>
      </div>

      <button className="link-btn" type="button" onClick={endSession}>
        End session
      </button>
    </section>
  );
}
