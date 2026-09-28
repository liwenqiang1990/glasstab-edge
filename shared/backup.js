import { APP_SCHEMA_VERSION } from './constants.js';
import { listAssets, replaceAllAssets } from './assets.js';
import { getState, normalizeState, saveState } from './storage.js';
import { referencedAssetIds } from './sync.js';
import { nowIso } from './utils.js';

// 上传到远端的内容：去掉本机专属设置，只带被引用的图标。
export function buildPayload(state, assets) {
  const referenced = referencedAssetIds(state);
  const exported = normalizeState(state);
  exported.meta.pristine = false;
  exported.settings.webdav = { ...exported.settings.webdav, password: '', username: '' };
  delete exported.settings.wallpaper;

  return {
    schemaVersion: APP_SCHEMA_VERSION,
    exportedAt: nowIso(),
    state: exported,
    assets: assets.filter((asset) => referenced.has(asset.id)),
  };
}

export async function buildBackupPayload() {
  return buildPayload(await getState(), await listAssets());
}

// 强制用远端覆盖本地（保留本机的 WebDAV 账号和壁纸设置）。
export async function restoreBackupPayload(payload) {
  if (!payload?.state) {
    throw new Error('备份文件缺少 state 字段。');
  }

  const local = await getState();
  const restored = normalizeState(payload.state);
  restored.settings.webdav = local.settings.webdav;
  restored.settings.wallpaper = local.settings.wallpaper;
  restored.meta.pristine = false;

  await replaceAllAssets(payload.assets || []);
  await saveState(restored);
  return getState();
}
