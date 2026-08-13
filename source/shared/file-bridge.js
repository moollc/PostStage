import { context } from './permissions.js';

const DB_NAME = 'app-handles';

async function openDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('handles');
    req.onsuccess = e => res(e.target.result);
    req.onerror = rej;
  });
}

async function storeHandle(handle) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('handles', 'readwrite');
    tx.objectStore('handles').put(handle, 'workingDir');
    tx.oncomplete = res; tx.onerror = rej;
  });
}

async function loadHandle() {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('handles', 'readonly');
    const req = tx.objectStore('handles').get('workingDir');
    req.onsuccess = e => res(e.target.result);
    req.onerror = rej;
  });
}

async function getFileSystemHandle() {
  const stored = await loadHandle();
  if (stored) {
    let perm = await stored.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') perm = await stored.requestPermission({ mode: 'readwrite' });
    if (perm === 'granted') return stored;
  }
  const handle = await window.showDirectoryPicker();
  await storeHandle(handle);
  return handle;
}

async function getOPFSHandle() {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle('app-data', { create: true });
}

async function getIndexedDBStore() {
  const db = await openDB();
  return db.transaction('handles', 'readwrite').objectStore('handles');
}

export async function getStorage() {
  if (context.hasFilePicker)                                    return getFileSystemHandle();
  if ('storage' in navigator && 'getDirectory' in navigator.storage) return getOPFSHandle();
  return getIndexedDBStore();
}
