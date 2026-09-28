import { summarizePage } from './shared/ai.js';
import { applyAssetChanges, listAssets, putAsset } from './shared/assets.js';
import { buildPayload, restoreBackupPayload } from './shared/backup.js';
import { STORAGE_KEY, SYNC_STATUS_KEY } from './shared/constants.js';
import { ICON_REV, discoverIcon } from './shared/favicon.js';
import { getState, patchSettings, setItemIcon, updateState, upsertBookmark, upsertShortcut } from './shared/storage.js';
import { mergeStates, referencedAssetIds, syncFingerprint } from './shared/sync.js';
import { WebDavConflictError, fetchRemote, pushRemote } from './shared/webdav.js';
import { ensureArray, getHostname, normalizeUrl, nowIso, toTime } from './shared/utils.js';

const ADD_BOOKMARK_MENU_ID = 'glasstab-add-bookmark';
const STALE_SYNC_MS = 60 * 1000;
const ORPHAN_ASSET_GRACE_MS = 10 * 60 * 1000;

let autoSyncTimer = null;
let runningSync = null;
let pendingSync = null;

function isHttpUrl(rawUrl) {
  return /^https?:/i.test(rawUrl || '');
}

async function refreshContextMenus() {
  await new Promise((resolve) => chrome.contextMenus.removeAll(resolve));
  chrome.contextMenus.create({
    id: ADD_BOOKMARK_MENU_ID,
    title: '保存到 GlassTab 书签',
    contexts: ['page'],
  });
}

async function flashBadge(text, color) {
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 2400);
}

async function extractPageContent(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const headingElements = Array.from(document.querySelectorAll('h1, h2')).slice(0, 6);
      const headings = headingElements
        .map((element) => element.textContent?.trim() || '')
        .filter(Boolean);

      const description =
        document.querySelector('meta[name="description"]')?.content?.trim() ||
        document.querySelector('meta[property="og:description"]')?.content?.trim() ||
        '';

      const root = document.querySelector('article') || document.querySelector('main') || document.body;
      const text = (root?.innerText || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 4000);

      return {
        title: document.title || '',
        url: location.href,
        description,
        headings,
        text,
      };
    },
  });

  return results?.[0]?.result || null;
}

// 先按站点找高清图标，标签页自带的 favicon 作为兜底候选。
async function saveIconForPage(pageUrl, favIconUrl, label) {
  try {
    const extra = /^(https?:|data:image\/)/i.test(favIconUrl || '') ? [{ url: favIconUrl, score: 20 }] : [];
    const icon = await discoverIcon(pageUrl, label, extra);
    const asset = await putAsset({ dataUrl: icon.dataUrl, mimeType: icon.mimeType, sourceUrl: pageUrl, rev: ICON_REV });
    return asset.id;
  } catch (error) {
    return null;
  }
}

// 图标在后台慢慢找，不拖慢收藏。
function fetchIconLater(listName, itemId, pageUrl, favIconUrl, label) {
  saveIconForPage(pageUrl, favIconUrl, label)
    .then((assetId) => assetId && setItemIcon(listName, itemId, assetId))
    .catch((error) => console.warn('GlassTab icon fetch failed:', error));
}

async function bookmarkTab(payload) {
  const url = normalizeUrl(payload.url);
  const title = payload.title || getHostname(url) || '未命名页面';
  const existing = (await getState()).bookmarks.find((bookmark) => bookmark.url === url);

  let summary = '';
  let summaryError = '';
  if (payload.withSummary) {
    try {
      if (!payload.tabId || !isHttpUrl(url)) {
        throw new Error('当前页面不支持 AI 摘要。');
      }
      const state = await getState();
      const page = await extractPageContent(payload.tabId);
      summary = await summarizePage(page, state.settings.ai);
    } catch (error) {
      // 摘要失败不影响收藏本身。
      summaryError = error.message || String(error);
    }
  }

  const state = await upsertBookmark({
    url,
    title,
    source: payload.source || 'popup',
    summary,
  });
  const bookmark = state.bookmarks.find((item) => item.url === url) || null;
  if (bookmark && !bookmark.iconAssetId) {
    fetchIconLater('bookmarks', bookmark.id, url, payload.favIconUrl, title);
  }

  return {
    bookmark,
    summary,
    summaryError,
    alreadyExisted: Boolean(existing),
  };
}

async function shortcutTab(payload) {
  const url = normalizeUrl(payload.url);
  const name = payload.name || payload.title || getHostname(url) || '快捷方式';
  const existing = (await getState()).shortcuts.find((shortcut) => shortcut.url === url);
  const state = await upsertShortcut({
    id: payload.id,
    name,
    url,
    groupId: existing ? undefined : payload.groupId,
    iconMode: 'auto',
  });
  const shortcut = state.shortcuts.find((item) => item.url === url) || null;
  if (shortcut && !existing?.iconAssetId) {
    fetchIconLater('shortcuts', shortcut.id, url, payload.favIconUrl, name);
  }

  return { shortcut };
}

async function getSyncStatus() {
  const result = await chrome.storage.local.get(SYNC_STATUS_KEY);
  return result[SYNC_STATUS_KEY] || {};
}

async function setSyncStatus(patch) {
  const current = await getSyncStatus();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ [SYNC_STATUS_KEY]: next });
  return next;
}

// 同步 = 拉取远端 → 与本地合并 → 有差异才写回。不会再用本地旧数据直接覆盖远端。
async function doSync() {
  const initial = await getState();
  const webdav = initial.settings.webdav;
  if (!webdav.serverUrl) {
    throw new Error('请先在设置页填写 WebDAV 地址。');
  }

  await setSyncStatus({ running: true });

  try {
    let pushed = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { payload: remotePayload, etag } = await fetchRemote(webdav);
      const local = await getState();
      const localAssets = await listAssets();
      const merged = mergeStates(local, remotePayload?.state || null);
      const mergedFingerprint = syncFingerprint(merged);

      const needed = referencedAssetIds(merged);
      const localAssetIds = new Set(localAssets.map((asset) => asset.id));
      const remoteAssets = ensureArray(remotePayload?.assets).filter((asset) => asset?.id && asset.dataUrl);
      const remoteAssetIds = new Set(remoteAssets.map((asset) => asset.id));
      const incomingAssets = remoteAssets.filter((asset) => needed.has(asset.id) && !localAssetIds.has(asset.id));
      const allAssets = [...localAssets, ...incomingAssets];

      const remoteMissingAssets = Array.from(needed).some((id) => !remoteAssetIds.has(id) && localAssetIds.has(id));
      const needPush = !remotePayload || syncFingerprint(remotePayload.state) !== mergedFingerprint || remoteMissingAssets;

      if (needPush) {
        try {
          // 最后一次重试不带 If-Match，兼容不支持条件请求的 WebDAV 服务。
          await pushRemote(buildPayload(merged, allAssets), webdav, { etag, conditional: attempt < 2 });
          pushed = true;
        } catch (error) {
          if (error instanceof WebDavConflictError) {
            continue;
          }
          throw error;
        }
      }

      await applyAssetChanges({ put: incomingAssets });
      await setSyncStatus({ lastFingerprint: mergedFingerprint });
      if (syncFingerprint(local) !== mergedFingerprint) {
        // 期间本地若有新改动，再合并一次，不丢。
        await updateState((current) => mergeStates(current, merged));
      }

      await cleanupOrphanAssets();
      return setSyncStatus({
        running: false,
        lastSyncAt: nowIso(),
        lastError: '',
        lastPushedAt: pushed ? nowIso() : (await getSyncStatus()).lastPushedAt || '',
      });
    }
    throw new Error('远端文件频繁变动，同步暂未完成，稍后会自动重试。');
  } catch (error) {
    await setSyncStatus({ running: false, lastError: error.message || String(error), lastErrorAt: nowIso() });
    throw error;
  }
}

async function cleanupOrphanAssets() {
  const state = await getState();
  const keep = referencedAssetIds(state);
  const cutoff = Date.now() - ORPHAN_ASSET_GRACE_MS;
  const orphans = (await listAssets())
    .filter((asset) => !keep.has(asset.id) && toTime(asset.updatedAt) < cutoff)
    .map((asset) => asset.id);
  await applyAssetChanges({ remove: orphans });
}

// 串行执行；运行中再次请求只排队一次。
function runSync() {
  if (pendingSync) {
    return pendingSync;
  }
  const start = () => {
    pendingSync = null;
    runningSync = doSync().finally(() => {
      runningSync = null;
    });
    return runningSync;
  };
  if (!runningSync) {
    return start();
  }
  pendingSync = runningSync.catch(() => {}).then(start);
  return pendingSync;
}

async function autoSyncEnabled() {
  const state = await getState();
  return state.settings.webdav.autoSync && Boolean(state.settings.webdav.serverUrl);
}

async function syncIfEnabled({ staleOnly = false } = {}) {
  if (!(await autoSyncEnabled())) {
    return { skipped: true };
  }
  if (staleOnly) {
    const status = await getSyncStatus();
    if (Date.now() - toTime(status.lastSyncAt) < STALE_SYNC_MS) {
      return { skipped: true };
    }
  }
  await runSync();
  return { skipped: false };
}

function scheduleAutoSync() {
  clearTimeout(autoSyncTimer);
  autoSyncTimer = setTimeout(() => {
    syncIfEnabled().catch((error) => console.error('GlassTab auto sync failed:', error));
  }, 1500);
}

async function runRestore() {
  const state = await getState();
  const { payload } = await fetchRemote(state.settings.webdav);
  if (!payload) {
    throw new Error('远端还没有备份文件。');
  }
  const restoredState = await restoreBackupPayload(payload);
  await setSyncStatus({ lastFingerprint: syncFingerprint(restoredState), lastSyncAt: nowIso(), lastError: '' });
  return { ok: true };
}

async function runOverwriteRemote() {
  const state = await getState();
  const url = await pushRemote(buildPayload(state, await listAssets()), state.settings.webdav, { conditional: false });
  await setSyncStatus({ lastFingerprint: syncFingerprint(state), lastSyncAt: nowIso(), lastPushedAt: nowIso(), lastError: '' });
  return { url };
}

chrome.runtime.onInstalled.addListener(() => {
  refreshContextMenus().catch((error) => console.error(error));
  setSyncStatus({ running: false }).catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  refreshContextMenus().catch((error) => console.error(error));
  setSyncStatus({ running: false })
    .then(() => syncIfEnabled())
    .catch((error) => console.error('GlassTab startup sync failed:', error));
});

// 任何页面改了数据都会走到这里，不再依赖各页面手动通知。
chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName !== 'local' || !changes[STORAGE_KEY]?.newValue) {
    return;
  }
  const status = await getSyncStatus();
  if (syncFingerprint(changes[STORAGE_KEY].newValue) !== status.lastFingerprint) {
    scheduleAutoSync();
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== ADD_BOOKMARK_MENU_ID || !tab?.url) {
    return;
  }

  bookmarkTab({
    title: tab.title || '',
    url: tab.url,
    favIconUrl: tab.favIconUrl || '',
    source: 'context-menu',
    withSummary: true,
    tabId: tab.id,
  })
    .then(() => flashBadge('✓', '#16a34a'))
    .catch((error) => {
      console.error('GlassTab context menu failed:', error);
      flashBadge('!', '#dc2626');
    });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case 'bookmark-tab':
        return bookmarkTab(message.payload || {});
      case 'shortcut-tab':
        return shortcutTab(message.payload || {});
      case 'summarize-tab': {
        const state = await getState();
        const page = await extractPageContent(message.payload?.tabId);
        const summary = await summarizePage(page, state.settings.ai);
        return { summary };
      }
      case 'save-settings':
        await patchSettings(message.payload || {});
        return { ok: true };
      case 'sync-now':
      case 'backup-now':
        return { status: await runSync() };
      case 'sync-if-stale':
        return syncIfEnabled({ staleOnly: true });
      case 'restore-now':
        clearTimeout(autoSyncTimer);
        return runRestore();
      case 'overwrite-remote':
        clearTimeout(autoSyncTimer);
        return runOverwriteRemote();
      default:
        return { ok: false };
    }
  })()
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));

  return true;
});
