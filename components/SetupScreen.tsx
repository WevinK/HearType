'use client';

import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent, KeyboardEvent } from 'react';
import { formatTime } from '@/lib/listening';
import { loadRecent, saveRecent } from '@/lib/recent';
import type { RecentEntry, RecentRecord } from '@/lib/recent';
import { normalizeYouTubeUrl } from '@/lib/youtube-url';
import type {
  MediaKind,
  PlayableSource,
  Sentence,
  TranscribeResponse,
  TranscriptSource,
  YouTubeResponse,
} from '@/lib/types';

type Props = {
  onStart: (source: PlayableSource, sentences: Sentence[]) => void;
};

type SourceMode = 'file' | 'youtube';
type RemoteMedia = { url: string; title: string; source: TranscriptSource };

const MAX_UPLOAD_MB = 500;
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
const MEDIA_EXT = /\.(mp4|m4v|webm|mov|mp3|wav|m4a|aac|ogg|oga|opus)$/i;

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const mb = bytes / 1024 / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`;
}

function isMediaFile(file: File): boolean {
  return MEDIA_EXT.test(file.name);
}

export default function SetupScreen({ onStart }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [remote, setRemote] = useState<RemoteMedia | null>(null);
  const [sourceMode, setSourceMode] = useState<SourceMode>('file');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [status, setStatus] = useState<'idle' | 'processing' | 'ready' | 'error'>('idle');
  const [processingLabel, setProcessingLabel] = useState('Transcribing with Vibe');
  const [sentences, setSentences] = useState<Sentence[]>([]);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [recent, setRecent] = useState<RecentEntry | null>(null);
  const [showSentences, setShowSentences] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const recentTokenRef = useRef(0);

  useEffect(() => {
    let active = true;
    void loadRecent().then((entry) => {
      if (active) setRecent(entry);
    });
    return () => {
      active = false;
      abortRef.current?.abort();
    };
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

  function remember(record: RecentRecord, blob: Blob, token: number) {
    void saveRecent(record, blob)
      .then(() => {
        if (recentTokenRef.current === token) setRecent({ ...record, blob });
      })
      .catch(() => undefined);
  }

  function resetToIdle() {
    abortRef.current?.abort();
    abortRef.current = null;
    setFile(null);
    setRemote(null);
    setSentences([]);
    setError('');
    setElapsed(0);
    setStatus('idle');
    setShowSentences(false);
  }

  async function transcribe(selected: File, controller: AbortController, token: number) {
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

      setRemote(null);
      setSentences(data.sentences);
      setStatus('ready');
      setShowSentences(false);
      if (recentTokenRef.current === token) {
        remember(
          {
            title: selected.name,
            kind: selected.type.startsWith('audio/') ? 'audio' : 'video',
            origin: 'upload',
            source: 'vibe',
            sentences: data.sentences,
            fileName: selected.name,
            mime: selected.type || 'application/octet-stream',
          },
          selected,
          token
        );
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : 'Transcription failed.');
      setStatus('error');
    }
  }

  function begin(selected: File) {
    if (!isMediaFile(selected)) {
      setFile(null);
      setRemote(null);
      setSentences([]);
      setError('Choose a video or audio file.');
      setStatus('error');
      return;
    }
    if (selected.size > MAX_UPLOAD_BYTES) {
      setFile(null);
      setRemote(null);
      setSentences([]);
      setError(`This file is ${formatBytes(selected.size)}. Choose a file under ${MAX_UPLOAD_MB} MB.`);
      setStatus('error');
      return;
    }

    const token = ++recentTokenRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setSourceMode('file');
    setFile(selected);
    setRemote(null);
    setSentences([]);
    setError('');
    setElapsed(0);
    setProcessingLabel('Transcribing with Vibe');
    setStatus('processing');
    void transcribe(selected, controller, token);
  }

  async function beginYouTube() {
    const normalized = normalizeYouTubeUrl(youtubeUrl);
    if (!normalized) {
      setFile(null);
      setRemote(null);
      setSentences([]);
      setError('Paste a public YouTube video link, not a playlist or channel.');
      setStatus('error');
      return;
    }

    const token = ++recentTokenRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setSourceMode('youtube');
    setFile(null);
    setRemote(null);
    setSentences([]);
    setError('');
    setElapsed(0);
    setProcessingLabel('Transcribing with Vibe');
    setStatus('processing');

    try {
      const response = await fetch('/api/youtube', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: normalized }),
        signal: controller.signal,
      });
      const data = (await response.json().catch(() => ({}))) as Partial<YouTubeResponse> & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error || `Could not prepare this video (${response.status}).`);
      }
      if (!data.mediaUrl || !Array.isArray(data.sentences) || data.sentences.length === 0) {
        throw new Error('No sentences were returned for this video.');
      }

      const title = data.title?.trim() || 'YouTube video';
      const source: TranscriptSource = data.source === 'vibe' ? 'vibe' : 'captions';
      setRemote({ url: data.mediaUrl, title, source });
      setSentences(data.sentences);
      setStatus('ready');
      setShowSentences(false);

      const mediaUrl = data.mediaUrl;
      const savedSentences = data.sentences;
      void (async () => {
        try {
          const media = await fetch(mediaUrl);
          if (!media.ok) return;
          const blob = await media.blob();
          if (recentTokenRef.current !== token) return;
          remember(
            {
              title,
              kind: 'video',
              origin: 'youtube',
              source,
              sentences: savedSentences,
              fileName: `${title}.mp4`,
              mime: blob.type || 'video/mp4',
            },
            blob,
            token
          );
        } catch {
          // The current session still works; the recent stays best-effort.
        }
      })();
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : 'Could not prepare this video.');
      setStatus('error');
    }
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

  function onUrlKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void beginYouTube();
  }

  function updateSentence(index: number, text: string) {
    setSentences((current) =>
      current.map((sentence, i) =>
        i === index ? { ...sentence, text, words: undefined, custom: true } : sentence
      )
    );
  }

  function removeSentence(index: number) {
    setSentences((current) => current.filter((_, i) => i !== index));
  }

  function start() {
    const prepared = sentences
      .map((sentence) => ({ ...sentence, text: sentence.text.trim() }))
      .filter((sentence) => /[\p{L}\p{N}]/u.test(sentence.text));
    if (!prepared.length || prepared.length !== sentences.length) return;

    if (remote) {
      onStart({ kind: 'video', url: remote.url }, prepared);
      return;
    }
    if (file) {
      const kind: MediaKind = file.type.startsWith('audio/') ? 'audio' : 'video';
      onStart({ kind, file }, prepared);
    }
  }

  function useRecent() {
    if (!recent) return;
    abortRef.current?.abort();
    abortRef.current = null;
    const file = new File([recent.blob], recent.fileName, { type: recent.mime });
    setSourceMode(recent.origin === 'youtube' ? 'youtube' : 'file');
    setFile(file);
    setRemote(null);
    setSentences(recent.sentences);
    setError('');
    setElapsed(0);
    setStatus('ready');
    setShowSentences(false);
  }

  const hasInvalid = sentences.some((sentence) => !/[\p{L}\p{N}]/u.test(sentence.text));
  const isAudio = file?.type.startsWith('audio/') ?? false;
  const canRetry = Boolean(file) || (sourceMode === 'youtube' && youtubeUrl.trim());

  return (
    <section className="screen setup">
      <input
        ref={inputRef}
        type="file"
        accept=".mp4,.m4v,.webm,.mov,.mp3,.wav,.m4a,.aac,.ogg,.oga,.opus"
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
          Upload a video, audio file, or YouTube link. Vibe transcribes everything
          locally; YouTube captions are the fallback. Then you listen and type each
          sentence, line by line.
        </p>
      </div>

      {status === 'idle' && recent && (
        <div className="recent-card">
          <div className="recent-meta">
            <span className="chip">Recent</span>
            <span className="recent-title" title={recent.title}>
              {recent.title}
            </span>
            <span className="recent-sub">
              {recent.origin === 'youtube' ? 'YouTube' : 'Upload'} ·{' '}
              {recent.sentences.length}{' '}
              {recent.sentences.length === 1 ? 'sentence' : 'sentences'} ·{' '}
              {recent.source === 'vibe' ? 'Vibe transcript' : 'YouTube captions'}
            </span>
          </div>
          <button className="btn btn-primary btn-sm" type="button" onClick={useRecent}>
            Use recent
          </button>
        </div>
      )}

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
              <span className="audio-kicker">{processingLabel}</span>
              <p className="drop-title">
                {file?.name ?? (sourceMode === 'youtube' ? 'YouTube video' : 'Working…')}
              </p>
              <p className="drop-sub">
                {file
                  ? `${formatBytes(file.size)} · `
                  : sourceMode === 'youtube'
                    ? 'Downloading and preparing locally · '
                    : ''}
                {elapsed}s elapsed
              </p>
              <p className="hint" style={{ marginTop: 0 }}>
                The first run can take a minute while the model loads. Everything stays
                on this machine.
              </p>
              <button className="btn btn-ghost btn-sm" type="button" onClick={resetToIdle}>
                Cancel
              </button>
            </div>
          )}

          {status === 'error' && (
            <div className="processing">
              <div className="notice">{error}</div>
              <div className="row" style={{ marginTop: 16 }}>
                {canRetry && (
                  <button
                    className="btn btn-primary"
                    type="button"
                    onClick={() => {
                      if (sourceMode === 'youtube') void beginYouTube();
                      else if (file) begin(file);
                    }}
                  >
                    Try again
                  </button>
                )}
                <button className="btn btn-ghost" type="button" onClick={resetToIdle}>
                  Start over
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
              <p className="drop-title">Upload a video or paste a YouTube link</p>
              <p className="drop-sub">
                Vibe transcribes uploads and YouTube links; captions are the fallback.
              </p>

              <div className="source-tabs" role="tablist" aria-label="Video source">
                <button
                  className={`source-tab${sourceMode === 'file' ? ' active' : ''}`}
                  type="button"
                  role="tab"
                  aria-selected={sourceMode === 'file'}
                  onClick={() => setSourceMode('file')}
                >
                  Upload file
                </button>
                <button
                  className={`source-tab${sourceMode === 'youtube' ? ' active' : ''}`}
                  type="button"
                  role="tab"
                  aria-selected={sourceMode === 'youtube'}
                  onClick={() => setSourceMode('youtube')}
                >
                  YouTube link
                </button>
              </div>

              {sourceMode === 'file' ? (
                <>
                  <div className="row">
                    <button className="btn btn-primary" type="button" onClick={pickFile}>
                      Choose a file
                    </button>
                  </div>
                  <p className="hint">
                    MP4, MOV, WebM, MP3, M4A, WAV · up to {MAX_UPLOAD_MB} MB · clear speech
                    works best.
                  </p>
                </>
              ) : (
                <>
                  <div className="url-row">
                    <input
                      className="url-input"
                      type="url"
                      value={youtubeUrl}
                      onChange={(event) => setYoutubeUrl(event.target.value)}
                      onKeyDown={onUrlKeyDown}
                      placeholder="https://www.youtube.com/watch?v=..."
                      aria-label="YouTube video URL"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <button
                      className="btn btn-primary"
                      type="button"
                      onClick={() => void beginYouTube()}
                      disabled={!youtubeUrl.trim()}
                    >
                      Fetch video
                    </button>
                  </div>
                  <p className="hint">
                    Public YouTube videos up to 1 hour. The video is downloaded locally for
                    playback and transcribed with Vibe; English captions are the fallback.
                  </p>
                </>
              )}
            </>
          )}
        </div>
      )}

      {status === 'ready' && (
        <>
          <div className="file-summary">
            <div className="file-meta">
              <span className="chip">
                {remote ? 'YouTube' : isAudio ? 'Audio' : 'Video'}
              </span>
              <span className="file-name" title={remote?.title ?? file?.name}>
                {remote?.title ?? file?.name}
              </span>
              <span className="file-size">
                {remote
                  ? remote.source === 'vibe'
                    ? 'Vibe transcript'
                    : 'YouTube captions'
                  : file
                    ? formatBytes(file.size)
                    : ''}
              </span>
            </div>
            <button className="btn btn-ghost btn-sm" type="button" onClick={resetToIdle}>
              Choose another
            </button>
          </div>

          <div className="clip-section" ref={listRef}>
            <div className="clip-head">
              <h2>
                <span>{sentences.length}</span>{' '}
                {sentences.length === 1 ? 'sentence' : 'sentences'} ready
              </h2>
              <button
                className="clip-toggle"
                type="button"
                aria-expanded={showSentences}
                aria-controls="clip-list"
                onClick={() => setShowSentences((value) => !value)}
              >
                {showSentences ? 'Hide list' : 'Show list'}
                <svg
                  viewBox="0 0 24 24"
                  width="14"
                  height="14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
            </div>

            <div id="clip-list" hidden={!showSentences}>
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
            </div>

            {hasInvalid && (
              <p className="feedback bad" style={{ textAlign: 'left' }}>
                Each sentence needs words before you can start. Fill it in or remove it.
              </p>
            )}

            <button
              className="btn btn-primary btn-xl"
              type="button"
              onClick={start}
              disabled={hasInvalid || sentences.length === 0}
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
