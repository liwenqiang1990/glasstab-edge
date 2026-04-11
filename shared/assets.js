import { ASSET_DB_NAME, ASSET_STORE_NAME } from './constants.js';
import { generateId, nowIso } from './utils.js';

let databasePromise;

function openDatabase() {
  if (databasePromise) {
    return databasePromise;
  }

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(ASSET_DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ASSET_STORE_NAME)) {
        db.createObjectStore(ASSET_STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('打开本地资产库失败'));
  });

  return databasePromise;
}

async function withStore(mode, runner) {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(ASSET_STORE_NAME, mode);
    const store = transaction.objectStore(ASSET_STORE_NAME);

    runner(store, resolve, reject);

    transaction.onerror = () => reject(transaction.error || new Error('本地资产事务失败'));
  });
}

export async function putAsset(record) {
  const asset = {
    id: record.id || generateId('asset'),
    kind: record.kind || 'icon',
    mimeType: record.mimeType || 'image/png',
    dataUrl: record.dataUrl,
    sourceUrl: record.sourceUrl || '',
    updatedAt: nowIso(),
  };

  await withStore('readwrite', (store, resolve, reject) => {
    const request = store.put(asset);
    request.onsuccess = () => resolve(asset);
    request.onerror = () => reject(request.error || new Error('保存本地资产失败'));
  });

  return asset;
}

export async function getAsset(assetId) {
  if (!assetId) {
    return null;
  }

  return withStore('readonly', (store, resolve, reject) => {
    const request = store.get(assetId);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error('读取本地资产失败'));
  });
}

export async function listAssets() {
  return withStore('readonly', (store, resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error || new Error('读取资产列表失败'));
  });
}

export async function listAssetsMap() {
  const records = await listAssets();
  return records.reduce((accumulator, record) => {
    accumulator[record.id] = record.dataUrl;
    return accumulator;
  }, {});
}

export async function deleteAsset(assetId) {
  if (!assetId) {
    return;
  }

  await withStore('readwrite', (store, resolve, reject) => {
    const request = store.delete(assetId);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error('删除本地资产失败'));
  });
}

export async function replaceAllAssets(records = []) {
  await withStore('readwrite', (store, resolve, reject) => {
    const clearRequest = store.clear();
    clearRequest.onerror = () => reject(clearRequest.error || new Error('清空本地资产失败'));
    clearRequest.onsuccess = () => {
      if (!records.length) {
        resolve();
        return;
      }

      let pending = records.length;
      records.forEach((record) => {
        const putRequest = store.put({
          id: record.id || generateId('asset'),
          kind: record.kind || 'icon',
          mimeType: record.mimeType || 'image/png',
          dataUrl: record.dataUrl,
          sourceUrl: record.sourceUrl || '',
          updatedAt: record.updatedAt || nowIso(),
        });

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
