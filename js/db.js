// IndexedDB persistence. All health data stays in the browser - nothing here
// talks to a network. Threads are stored as single documents (captures,
// distillations, and reconciliations nested inside), matching the data
// model in ARCHITECTURE.md. Writes are always additive: existing capture,
// distillation, and reconciliation entries are never edited or removed.

const DB_NAME = 'doctors-note-db';
const DB_VERSION = 1;
const STORE_NAME = 'threads';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'thread_id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function putThread(thread) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(thread);
    tx.oncomplete = () => resolve(thread);
    tx.onerror = () => reject(tx.error);
  }));
}

export function getAllThreads() {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => {
      const threads = req.result.sort((a, b) => b.created_at.localeCompare(a.created_at));
      resolve(threads);
    };
    req.onerror = () => reject(req.error);
  }));
}

export function getThread(threadId) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(threadId);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  }));
}

export function createThread(label) {
  const thread = {
    thread_id: crypto.randomUUID(),
    label,
    created_at: new Date().toISOString(),
    captures: [],
    distillations: [],
    reconciliations: [],
  };
  return putThread(thread);
}

export async function addCapture(threadId, rawText, inputMode) {
  const thread = await getThread(threadId);
  const capture = {
    capture_id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    input_mode: inputMode,
    raw_text: rawText,
  };
  thread.captures.push(capture);
  await putThread(thread);
  return capture;
}

export async function addDistillation(threadId, distillation) {
  const thread = await getThread(threadId);
  const entry = {
    distillation_id: crypto.randomUUID(),
    generated_at: new Date().toISOString(),
    ...distillation,
  };
  thread.distillations.push(entry);
  await putThread(thread);
  return entry;
}

export async function addReconciliation(threadId, reconciliation) {
  const thread = await getThread(threadId);
  const entry = {
    reconciliation_id: crypto.randomUUID(),
    ...reconciliation,
  };
  thread.reconciliations.push(entry);
  await putThread(thread);
  return entry;
}
