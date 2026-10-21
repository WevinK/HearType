import type { MediaKind, Sentence, TranscriptSource } from './types';

export type RecentOrigin = 'upload' | 'youtube';

export type RecentRecord = {
  title: string;
  kind: MediaKind;
  origin: RecentOrigin;
  source: TranscriptSource;
  sentences: Sentence[];
  fileName: string;
  mime: string;
};

export type RecentEntry = RecentRecord & { blob: Blob };

const DB_NAME = 'heartype';
const DB_VERSION = 1;
const META_STORE = 'recent-meta';
const MEDIA_STORE = 'recent-media';
const KEY = 'current';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
      if (!db.objectStoreNames.contains(MEDIA_STORE)) db.createObjectStore(MEDIA_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** Keep one recent session in this browser; the next save replaces it. */
export async function saveRecent(record: RecentRecord, blob: Blob): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([META_STORE, MEDIA_STORE], 'readwrite');
  tx.objectStore(META_STORE).put(record, KEY);
  tx.objectStore(MEDIA_STORE).put(blob, KEY);
  await transactionDone(tx);
}

export async function loadRecent(): Promise<RecentEntry | null> {
  try {
    const db = await openDb();
    const tx = db.transaction([META_STORE, MEDIA_STORE], 'readonly');
    const metaRequest = tx.objectStore(META_STORE).get(KEY);
    const blobRequest = tx.objectStore(MEDIA_STORE).get(KEY);
    const [meta, blob] = await Promise.all([
      requestResult(metaRequest),
      requestResult(blobRequest),
    ]);
    if (!meta || !(blob instanceof Blob)) return null;
    return { ...(meta as RecentRecord), blob };
  } catch {
    return null;
  }
}
