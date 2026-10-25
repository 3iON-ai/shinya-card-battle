// --- 登録キャラの保存（IndexedDB）---
// シート画像は1枚数百KB〜あり、localStorageの上限に収まらないためIndexedDBを使う
const Storage = (() => {
  const DB_NAME = 'fe-like-game';
  const STORE = 'characters';
  let dbPromise = null;

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  async function run(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
    });
  }

  return {
    getAll: () => run('readonly', s => s.getAll()),
    get: id => run('readonly', s => s.get(id)),
    put: ch => run('readwrite', s => s.put(ch)),
    remove: id => run('readwrite', s => s.delete(id)),
  };
})();
