'use client';

import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { scoreSession } from '@/lib/listening';
import type { Clip } from '@/lib/types';

type Props = {
  clips: Clip[];
  onRestart: () => void;
  onNew: () => void;
};

export default function ResultsScreen({ clips, onRestart, onNew }: Props) {
  const score = scoreSession(clips);
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <section className="screen results">
      <p className="eyebrow">Session complete</p>

      <div className="result-hero">
        <div
          className="ring"
          style={{ '--pct': String(score.shownPct) } as CSSProperties}
        >
          <div className="ring-inner">
            <span id="scorePct">{score.shownPct}%</span>
            <small>accuracy</small>
          </div>
        </div>
        <div>
          <h1 id="resultTitle" ref={titleRef} tabIndex={-1}>
            {score.title}
          </h1>
          <p className="sub">
            {score.correct} of {score.total} {score.total === 1 ? 'sentence' : 'sentences'} correct
            {score.notReached ? ` · ${score.notReached} not reached` : ''}.
          </p>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat">
          <span>{score.correct}</span>
          <label>Correct</label>
        </div>
        <div className="stat">
          <span>{score.firstTry}</span>
          <label>First try</label>
        </div>
        <div className="stat">
          <span>{score.skipped + score.pending}</span>
          <label>Missed</label>
        </div>
        <div className="stat">
          <span>{score.wrongTries}</span>
          <label>Wrong tries</label>
        </div>
      </div>

      <h2 className="section-title">Sentence by sentence</h2>
      <ol className="detail-list">
        {clips.map((clip, index) => {
          let answerText = '—';
          if (clip.result === 'correct' && clip.lastWrong) {
            answerText = `wrong: “${clip.lastWrong}”`;
          } else if (clip.result === 'skipped' && clip.answer) {
            answerText = `typed: “${clip.answer}”`;
          } else if (clip.result === 'skipped') {
            answerText = 'skipped';
          } else if (clip.result === 'pending') {
            answerText = clip.answer
              ? `typed: “${clip.answer}”`
              : clip.reached
                ? 'no answer'
                : 'left blank';
          }

          const pill =
            clip.result === 'correct' ? 'ok' : clip.result === 'skipped' ? 'skip' : 'miss';
          const pillText =
            clip.result === 'correct'
              ? 'Correct'
              : clip.result === 'skipped'
                ? 'Skipped'
                : clip.reached
                  ? 'No answer'
                  : 'Not reached';

          return (
            <li className="detail-row" key={`${clip.start}-${clip.end}-${index}`}>
              <span className="idx">{String(index + 1).padStart(2, '0')}</span>
              <strong className="d-word">{clip.text || '—'}</strong>
              <span className="d-answer">{answerText}</span>
              <span className={`pill ${pill}`}>{pillText}</span>
              <span className="d-tries">{clip.attempts} wrong</span>
            </li>
          );
        })}
      </ol>

      <div className="row result-actions">
        <button className="btn btn-primary" type="button" onClick={onRestart}>
          Restart from beginning
        </button>
        <button className="btn btn-ghost" type="button" onClick={onNew}>
          Upload a new video
        </button>
      </div>
    </section>
  );
}
