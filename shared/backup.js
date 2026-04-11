import { APP_SCHEMA_VERSION } from './constants.js';
import { listAssets, replaceAllAssets } from './assets.js';
import { getState, saveState } from './storage.js';
import { nowIso } from './utils.js';

export async function buildBackupPayload() {
  return {
    schemaVersion: APP_SCHEMA_VERSION,
    exportedAt: nowIso(),
    state: await getState(),
    assets: await listAssets(),
  };
}

export async function restoreBackupPayload(payload) {
  if (!payload?.state) {
    throw new Error('备份文件缺少 state 字段。');
  }

  await saveState(payload.state);
  await replaceAllAssets(payload.assets || []);
  return getState();
}
