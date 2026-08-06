import type { StreamRecord } from "./types";
import { cloneStreamRecord } from "./stream-snapshot";

const DB_NAME = "sse-devtools-archives";
const DB_VERSION = 1;
const STORE_NAME = "archives";

export interface StreamArchiveEntry {
  id: string;
  name: string;
  savedAt: number;
  stream: StreamRecord;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error("Failed to open IndexedDB"));
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("savedAt", "savedAt", { unique: false });
        store.createIndex("name", "name", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

export async function listStreamArchives(): Promise<StreamArchiveEntry[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => {
      const rows = (req.result as StreamArchiveEntry[]).slice();
      rows.sort((a, b) => b.savedAt - a.savedAt);
      resolve(rows);
    };
    req.onerror = () => reject(req.error ?? new Error("Failed to list archives"));
  });
}

export async function getStreamArchive(id: string): Promise<StreamArchiveEntry | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result as StreamArchiveEntry | undefined);
    req.onerror = () => reject(req.error ?? new Error("Failed to read archive"));
  });
}

export async function saveStreamArchive(
  name: string,
  stream: StreamRecord,
): Promise<StreamArchiveEntry> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Archive name is required");

  const entry: StreamArchiveEntry = {
    id: `arc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: trimmed,
    savedAt: Date.now(),
    stream: cloneStreamRecord(stream),
  };

  const db = await openDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  tx.objectStore(STORE_NAME).put(entry);
  await txDone(tx);
  return entry;
}

export async function deleteStreamArchive(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  tx.objectStore(STORE_NAME).delete(id);
  await txDone(tx);
}
