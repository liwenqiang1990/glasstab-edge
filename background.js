import { summarizePage } from './shared/ai.js';
import { buildBackupPayload, restoreBackupPayload } from './shared/backup.js';
import { markBackupFinished, patchSettings, upsertBookmark, upsertShortcut, getState } from './shared/storage.js';
import { backupToWebDav, restoreFromWebDav } from './shared/webdav.js';
import { getHostname, normalizeUrl, nowIso } from './shared/utils.js';

const ADD_BOOKMARK_MENU_ID = 'glasstab-add-bookmark';
let autoBackupTimer = null;

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

async function bookmarkTab(payload) {
  const url = normalizeUrl(payload.url);
  const title = payload.title || getHostname(url) || '未命名页面';

  let summary = '';
  if (payload.withSummary) {
    if (!payload.tabId || !isHttpUrl(url)) {
      throw new Error('当前页面不支持 AI 摘要。');
    }
    const state = await getState();
    const page = await extractPageContent(payload.tabId);
    summary = await summarizePage(page, state.settings.ai);
  }

  const state = await upsertBookmark({
    url,
    title,
    source: payload.source || 'popup',
    summary,
  });

  scheduleAutoBackup();

  return {
    bookmark: state.bookmarks.find((bookmark) => bookmark.url === url) || null,
    summary,
  };
}

async function shortcutTab(payload) {
  const url = normalizeUrl(payload.url);
  const name = payload.name || payload.title || getHostname(url) || '快捷方式';

  const state = await upsertShortcut({
    id: payload.id,
    name,
    url,
    iconMode: 'auto',
  });

  scheduleAutoBackup();

  return {
    shortcut: state.shortcuts.find((shortcut) => shortcut.url === url) || null,
  };
}

async function runBackup() {
  const state = await getState();
  const url = await backupToWebDav(await buildBackupPayload(), state.settings.webdav);
  await markBackupFinished(nowIso());
  return { url };
}

async function runRestore() {
  const state = await getState();
  const payload = await restoreFromWebDav(state.settings.webdav);
  const restoredState = await restoreBackupPayload(payload);
  chrome.runtime.sendMessage({ type: 'glasstab-data-restored' }).catch(() => {});
  return { restoredState };
}

function scheduleAutoBackup() {
  clearTimeout(autoBackupTimer);
  autoBackupTimer = setTimeout(async () => {
    try {
      const state = await getState();
      if (!state.settings.webdav.autoBackup || !state.settings.webdav.serverUrl) {
        return;
      }
      await runBackup();
    } catch (error) {
      console.error('GlassTab auto backup failed:', error);
    }
  }, 1200);
}

chrome.runtime.onInstalled.addListener(() => {
  refreshContextMenus().catch((error) => console.error(error));
});

chrome.runtime.onStartup.addListener(() => {
  refreshContextMenus().catch((error) => console.error(error));
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== ADD_BOOKMARK_MENU_ID || !tab?.url) {
    return;
  }

  bookmarkTab({
    title: tab.title || '',
    url: tab.url,
    source: 'context-menu',
    withSummary: true,
    tabId: tab.id,
  }).catch((error) => console.error('GlassTab context menu failed:', error));
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
        scheduleAutoBackup();
        return { ok: true };
      case 'backup-now':
        clearTimeout(autoBackupTimer);
        return runBackup();
      case 'restore-now':
        clearTimeout(autoBackupTimer);
        return runRestore();
      case 'schedule-auto-backup':
        scheduleAutoBackup();
        return { ok: true };
      default:
        return { ok: false };
    }
  })()
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));

  return true;
});
