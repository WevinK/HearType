'use client';

import { useEffect, useRef, useState } from 'react';
import PracticeScreen from '@/components/PracticeScreen';
import ResultsScreen from '@/components/ResultsScreen';
import SetupScreen from '@/components/SetupScreen';
import type { Clip, MediaKind, PlayableSource, Sentence } from '@/lib/types';

type Screen = 'setup' | 'practice' | 'results';
type MediaAsset = { url: string; kind: MediaKind };

export default function Home() {
  const [screen, setScreen] = useState<Screen>('setup');
  const [media, setMedia] = useState<MediaAsset | null>(null);
  const [sentences, setSentences] = useState<Sentence[]>([]);
  const [results, setResults] = useState<Clip[]>([]);
  const [sessionKey, setSessionKey] = useState(0);
  const mediaUrlRef = useRef<string | null>(null);
  const mediaRevokeRef = useRef(false);

  useEffect(() => {
    return () => {
      if (mediaUrlRef.current && mediaRevokeRef.current) {
        URL.revokeObjectURL(mediaUrlRef.current);
      }
    };
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [screen, sessionKey]);

  function clearMedia() {
    if (mediaUrlRef.current && mediaRevokeRef.current) {
      URL.revokeObjectURL(mediaUrlRef.current);
    }
    mediaUrlRef.current = null;
    mediaRevokeRef.current = false;
    setMedia(null);
    setSentences([]);
    setResults([]);
  }

  function handleStart(source: PlayableSource, nextSentences: Sentence[]) {
    clearMedia();

    const url = 'file' in source ? URL.createObjectURL(source.file) : source.url;
    const revoke = 'file' in source;
    mediaUrlRef.current = url;
    mediaRevokeRef.current = revoke;

    setMedia({ url, kind: source.kind });
    setSentences(nextSentences);
    setSessionKey((key) => key + 1);
    setScreen('practice');
  }

  function handleFinish(clips: Clip[]) {
    setResults(clips);
    setScreen('results');
  }

  function handleRestart() {
    setResults([]);
    setSessionKey((key) => key + 1);
    setScreen('practice');
  }

  function handleNew() {
    clearMedia();
    setScreen('setup');
  }

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </span>
          <span>
            Hear<em>Type</em>
          </span>
        </div>
      </header>

      <main>
        {screen === 'setup' && <SetupScreen onStart={handleStart} />}

        {screen === 'practice' && media && (
          <PracticeScreen
            key={sessionKey}
            mediaUrl={media.url}
            mediaKind={media.kind}
            sentences={sentences}
            onFinish={handleFinish}
            onRestart={handleRestart}
          />
        )}

        {screen === 'results' && (
          <ResultsScreen clips={results} onRestart={handleRestart} onNew={handleNew} />
        )}
      </main>
    </>
  );
}
