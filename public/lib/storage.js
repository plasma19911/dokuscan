// Ausschließlich lokale Speicherung im Browser (IndexedDB).
// Dieses Modul enthält absichtlich keinerlei fetch/XMLHttpRequest-Aufruf.

const DB_NAME = 'dokuscan';
const STORE_NAME = 'documents';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function addDocument({ type, pdfBlob, pageCount, createdAt }) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const req = tx.objectStore(STORE_NAME).add({
      type,
      pdfBlob,
      pageCount,
      createdAt: createdAt || new Date().toISOString(),
    });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function listDocuments() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => {
      const docs = req.result || [];
      docs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      resolve(docs);
    };
    req.onerror = () => reject(req.error);
  });
}

async function deleteDocument(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

window.DokuStorage = { addDocument, listDocuments, deleteDocument };
