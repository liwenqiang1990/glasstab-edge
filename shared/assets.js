import { ASSET_DB_NAME, ASSET_STORE_NAME, WALLPAPER_STORE_NAME } from './constants.js';
import { generateId, nowIso } from './utils.js';

let databasePromise;

function openDatabase() {
  if (databasePromise) {
    return databasePromise;
  }

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(ASSET_DB_NAME, 2);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ASSET_STORE_NAME)) {
        db.createObjectStore(ASSET_STORE_NAME, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(WALLPAPER_STORE_NAME)) {
        db.createObjectStore(WALLPAPER_STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('打开本地资产库失败'));
  });

  return databasePromise;
}

async function withStore(storeName, mode, runner) {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);

    runner(store, resolve, reject);

    transaction.onerror = () => reject(transaction.error || new Error('本地资产事务失败'));
  });
}

function normalizeAssetRecord(record) {
  return {
    id: record.id || generateId('asset'),
    kind: record.kind || 'icon',
    mimeType: record.mimeType || 'image/png',
    dataUrl: record.dataUrl,
    sourceUrl: record.sourceUrl || '',
    rev: Number(record.rev) || 1,
    updatedAt: record.updatedAt || nowIso(),
  };
}

export async function putAsset(record) {
  const asset = normalizeAssetRecord({ ...record, updatedAt: nowIso() });

  await withStore(ASSET_STORE_NAME, 'readwrite', (store, resolve, reject) => {
    const request = store.put(asset);
    request.onsuccess = () => resolve(asset);
    request.onerror = () => reject(request.error || new Error('保存本地资产失败'));
  });

  return asset;
}

export async function listAssets() {
  return withStore(ASSET_STORE_NAME, 'readonly', (store, resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error || new Error('读取资产列表失败'));
  });
}

export async function listAssetRecords() {
  const records = await listAssets();
  return Object.fromEntries(records.map((record) => [record.id, record]));
}

export async function listAssetsMap() {
  const records = await listAssets();
  return records.reduce((accumulator, record) => {
    accumulator[record.id] = record.dataUrl;
    return accumulator;
  }, {});
}

// 批量写入/删除，不清空已有资产。
export async function applyAssetChanges({ put = [], remove = [] } = {}) {
  if (!put.length && !remove.length) {
    return;
  }

  await withStore(ASSET_STORE_NAME, 'readwrite', (store, resolve, reject) => {
    let pending = put.length + remove.length;
    const done = () => {
      pending -= 1;
      if (pending === 0) {
        resolve();
      }
    };

    put.forEach((record) => {
      const request = store.put(normalizeAssetRecord(record));
      request.onsuccess = done;
      request.onerror = () => reject(request.error || new Error('写入资产失败'));
    });
    remove.forEach((assetId) => {
      const request = store.delete(assetId);
      request.onsuccess = done;
      request.onerror = () => reject(request.error || new Error('删除资产失败'));
    });
  });
}

export async function replaceAllAssets(records = []) {
  await withStore(ASSET_STORE_NAME, 'readwrite', (store, resolve, reject) => {
    const clearRequest = store.clear();
    clearRequest.onerror = () => reject(clearRequest.error || new Error('清空本地资产失败'));
    clearRequest.onsuccess = () => {
      if (!records.length) {
        resolve();
        return;
      }

      let pending = records.length;
      records.forEach((record) => {
        const putRequest = store.put(normalizeAssetRecord(record));
        putRequest.onerror = () => reject(putRequest.error || new Error('恢复资产失败'));
        putRequest.onsuccess = () => {
          pending -= 1;
          if (pending === 0) {
            resolve();
          }
        };
      });
    };
  });
}

// 壁纸图片单独存放（Blob），不参与 WebDAV 同步。
export async function getWallpaperRecord(id) {
  return withStore(WALLPAPER_STORE_NAME, 'readonly', (store, resolve, reject) => {
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error('读取壁纸失败'));
  });
}

export async function putWallpaperRecord(record) {
  await withStore(WALLPAPER_STORE_NAME, 'readwrite', (store, resolve, reject) => {
    const request = store.put({ ...record, updatedAt: nowIso() });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error('保存壁纸失败'));
  });
}

export async function pruneWallpaperRecords(keepIds) {
  const keep = new Set(keepIds);
  await withStore(WALLPAPER_STORE_NAME, 'readwrite', (store, resolve, reject) => {
    const request = store.getAllKeys();
    request.onerror = () => reject(request.error || new Error('清理壁纸缓存失败'));
    request.onsuccess = () => {
      (request.result || []).filter((key) => !keep.has(key)).forEach((key) => store.delete(key));
      resolve();
    };
  });
}
