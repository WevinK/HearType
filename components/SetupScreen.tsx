'use client';

import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import { formatTime } from '@/lib/listening';
import type { MediaKind, Sentence, TranscribeResponse } from '@/lib/types';

type Props = {
  onStart: (file: File, sentences: Sentence[], kind: MediaKind) => void;
};

const MAX_UPLOAD_MB = 500;
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
const MEDIA_EXT =
  /\.(mp4|m4v|webm|mov|mkv|avi|ogv|mp3|wav|m4a|aac|ogg|oga|opus|flac)$/i;

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const mb = bytes / 1024 / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`;
}

function isMediaFile(file: File): boolean {
  return (
    file.type.startsWith('video/') ||
    file.type.startsWith('audio/') ||
    MEDIA_EXT.test(file.name)
  );
}

export default function SetupScreen({ onStart }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<'idle' | 'processing' | 'ready' | 'error'>('idle');
  const [sentences, setSentences] = useState<Sentence[]>([]);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (status !== 'processing') return;
    const id = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(id);
  }, [status]);

  useEffect(() => {
    if (status === 'ready') {
      listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [status]);

  function pickFile() {
    inputRef.current?.click();
  }

  function cancel() {
    abortRef.current?.abort();
    abortRef.current = null;
    setFile(null);
    setSentences([]);
    setError('');
    setElapsed(0);
    setStatus('idle');
  }

  async function transcribe(selected: File, controller: AbortController) {
    try {
      const body = new FormData();
      body.append('file', selected);

      const response = await fetch('/api/transcribe', {
        method: 'POST',
        body,
        signal: controller.signal,
      });
      const data = (await response.json().catch(() => ({}))) as Partial<TranscribeResponse> & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error || `Transcription failed (${response.status}).`);
      }
      if (!Array.isArray(data.sentences) || data.sentences.length === 0) {
        throw new Error('No sentences were returned. Try a clearer clip.');
      }

      setSentences(data.sentences);
      setStatus('ready');
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : 'Transcription failed.');
      setStatus('error');
    }
  }

  function begin(selected: File) {
    if (!isMediaFile(selected)) {
      setFile(null);
      setSentences([]);
      setError('Choose a video or audio file.');
      setStatus('error');
      return;
    }
    if (selected.size > MAX_UPLOAD_BYTES) {
      setFile(null);
      setSentences([]);
      setError(`This file is ${formatBytes(selected.size)}. Choose a file under ${MAX_UPLOAD_MB} MB.`);
      setStatus('error');
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setFile(selected);
    setSentences([]);
    setError('');
    setElapsed(0);
    setStatus('processing');
    void transcribe(selected, controller);
  }

  function onInputChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    event.target.value = '';
    if (selected) begin(selected);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const selected = event.dataTransfer.files?.[0];
    if (selected) begin(selected);
  }

  function onDragLeave(event: DragEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node)) {
      setDragging(false);
    }
  }

  function updateSentence(index: number, text: string) {
    setSentences((current) =>
      current.map((sentence, i) => (i === index ? { ...sentence, text } : sentence))
    );
  }

  function removeSentence(index: number) {
    setSentences((current) => current.filter((_, i) => i !== index));
  }

  function start() {
    if (!file) return;
    const prepared = sentences
      .map((sentence) => ({ ...sentence, text: sentence.text.trim() }))
      .filter((sentence) => sentence.text);
    if (!prepared.length || prepared.length !== sentences.length) return;

    const kind: MediaKind = file.type.startsWith('audio/') ? 'audio' : 'video';
    onStart(file, prepared, kind);
  }

  const hasEmpty = sentences.some((sentence) => !sentence.text.trim());
  const isAudio = file?.type.startsWith('audio/') ?? false;

  return (
    <section className="screen setup">
      <input
        ref={inputRef}
        type="file"
        accept="video/*,audio/*"
        hidden
        onChange={onInputChange}
      />

      <div className="hero">
        <p className="eyebrow">Local · Sentence practice</p>
        <h1>
          Hear it. <span className="grad">Type it.</span>
          <br />
          Own it.
        </h1>
        <p className="sub">
          Upload a video or audio clip. Vibe transcribes the speech locally, then you
          listen and type each sentence, line by line.
        </p>
      </div>

      {status !== 'ready' && (
        <div
          className={`dropzone${dragging ? ' dragging' : ''}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          {status === 'processing' && (
            <div className="processing">
              <div className="audio-wave" aria-hidden="true">
                {Array.from({ length: 9 }).map((_, index) => (
                  <span key={index} style={{ animationDelay: `${index * 0.07}s` }} />
                ))}
              </div>
              <span className="audio-kicker">Transcribing with Vibe</span>
              <p className="drop-title">{file?.name}</p>
              <p className="drop-sub">
                {file ? formatBytes(file.size) : ''} · {elapsed}s elapsed
              </p>
              <p className="hint" style={{ marginTop: 0 }}>
                The first run can take a minute while the model loads. Everything stays
                on this machine.
              </p>
              <button className="btn btn-ghost btn-sm" type="button" onClick={cancel}>
                Cancel
              </button>
            </div>
          )}

          {status === 'error' && (
            <div className="processing">
              <div className="notice">{error}</div>
              <div className="row" style={{ marginTop: 16 }}>
                {file && (
                  <button className="btn btn-primary" type="button" onClick={() => begin(file)}>
                    Try again
                  </button>
                )}
                <button className="btn btn-ghost" type="button" onClick={pickFile}>
                  Choose another file
                </button>
              </div>
              <p className="hint">
                Vibe runs locally. If this is the first run, install it with{' '}
                <code>npm run setup:vibe</code>.
              </p>
            </div>
          )}

          {status === 'idle' && (
            <>
              <div className="drop-icon" aria-hidden="true">
                <svg
                  viewBox="0 0 24 24"
                  width="26"
                  height="26"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 16V4" />
                  <path d="m6 10 6-6 6 6" />
                  <path d="M4 20h16" />
                </svg>
              </div>
              <p className="drop-title">Upload a video or audio clip</p>
              <p className="drop-sub">
                Vibe turns the speech into sentences you can practice.
              </p>
              <div className="row">
                <button className="btn btn-primary" type="button" onClick={pickFile}>
                  Choose a file
                </button>
              </div>
              <p className="hint">
                MP4, MOV, WebM, MP3 · up to {MAX_UPLOAD_MB} MB · clear speech works best.
              </p>
            </>
          )}
        </div>
      )}

      {status === 'ready' && (
        <>
          <div className="file-summary">
            <div className="file-meta">
              <span className="chip">{isAudio ? 'Audio' : 'Video'}</span>
              <span className="file-name" title={file?.name}>
                {file?.name}
              </span>
              <span className="file-size">{file ? formatBytes(file.size) : ''}</span>
            </div>
            <button className="btn btn-ghost btn-sm" type="button" onClick={pickFile}>
              Replace file
            </button>
          </div>

          <div className="clip-section" ref={listRef}>
            <div className="clip-head">
              <h2>
                <span>{sentences.length}</span>{' '}
                {sentences.length === 1 ? 'sentence' : 'sentences'} ready
              </h2>
            </div>

            <ol className="clip-list">
              {sentences.map((sentence, index) => (
                <li className="clip-row" key={`${sentence.start}-${sentence.end}-${index}`}>
                  <span className="clip-num">{String(index + 1).padStart(2, '0')}</span>
                  <span className="clip-name">
                    {formatTime(sentence.start)} – {formatTime(sentence.end)}
                  </span>
                  <input
                    className="clip-target"
                    value={sentence.text}
                    onChange={(event) => updateSentence(index, event.target.value)}
                    aria-label={`Sentence ${index + 1}`}
                  />
                  <button
                    className="remove-btn"
                    type="button"
                    title="Remove sentence"
                    aria-label={`Remove sentence ${index + 1}`}
                    onClick={() => removeSentence(index)}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      width="16"
                      height="16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      aria-hidden="true"
                    >
                      <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
                  </button>
                </li>
              ))}
            </ol>

            {hasEmpty && (
              <p className="feedback bad" style={{ textAlign: 'left' }}>
                Each sentence needs text before you can start. Fill it in or remove it.
              </p>
            )}

            <button
              className="btn btn-primary btn-xl"
              type="button"
              onClick={start}
              disabled={hasEmpty || sentences.length === 0}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M8 5.14v13.72a1 1 0 0 0 1.53.85l10.2-6.86a1 1 0 0 0 0-1.7L9.53 4.3A1 1 0 0 0 8 5.14z" />
              </svg>
              Start practice
            </button>
          </div>
        </>
      )}
    </section>
  );
}
