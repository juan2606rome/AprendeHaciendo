/**
 * fs.js
 * Envoltorio delgado sobre la File System Access API del navegador
 * (funciona en Chrome / Edge / Opera; NO en Firefox ni Safari).
 * También guarda el "handle" de la carpeta elegida en IndexedDB para
 * poder ofrecer "reanudar acceso" sin volver a elegir la carpeta cada vez
 * (el navegador igual pedirá un clic de confirmación por seguridad).
 */

const FS = (() => {
  const DB_NAME = 'aprendeHaciendo-fs';
  const STORE = 'handles';
  const KEY = 'data-dir';

  function isSupported() {
    return typeof window.showDirectoryPicker === 'function';
  }

  /** Detección oficial de Brave (no es 100% infalible, pero es la recomendada por Brave mismo). */
  async function isBrave() {
    return !!(navigator.brave && (await navigator.brave.isBrave()));
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function saveHandle(handle) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(handle, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function loadHandle() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function clearHandle() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function verifyPermission(handle, mode = 'readwrite') {
    const opts = { mode };
    if ((await handle.queryPermission(opts)) === 'granted') return true;
    if ((await handle.requestPermission(opts)) === 'granted') return true;
    return false;
  }

  async function pickDirectory() {
    if (!window.showDirectoryPicker) {
      throw new Error('NO_SUPPORT');
    }
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    await saveHandle(handle);
    return handle;
  }

  /** Lista todos los archivos directos de un directorio (no recursivo). */
  async function listFiles(dirHandle) {
    const files = [];
    for await (const [name, handle] of dirHandle.entries()) {
      if (handle.kind === 'file') files.push({ name, handle });
    }
    return files;
  }

  async function readText(fileHandle) {
    const file = await fileHandle.getFile();
    return file.text();
  }

  async function writeText(dirHandle, filename, content) {
    const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
    return fileHandle;
  }

  /** Igual que writeText pero para contenido binario (fotos, etc.): acepta un File/Blob. */
  async function writeBinary(dirHandle, filename, blob) {
    const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
    return fileHandle;
  }

  return {
    saveHandle, loadHandle, clearHandle,
    verifyPermission, pickDirectory,
    listFiles, readText, writeText, writeBinary,
    isSupported, isBrave,
  };
})();
