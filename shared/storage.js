import { AI_PROVIDERS, APP_SCHEMA_VERSION, BACKUP_FILE_NAME, DEFAULT_SHORTCUTS, STORAGE_KEY } from './constants.js';
import { deepClone, ensureArray, generateId, normalizeUrl, nowIso } from './utils.js';

function createDefaultSettings(timestamp) {
  return {
    gridSize: 'compact',
    searchEngines: ['baidu', 'bing', 'github'],
    ai: {
      enabled: false,
      provider: 'qwen',
      endpoint: AI_PROVIDERS.qwen.endpoint,
      model: AI_PROVIDERS.qwen.defaultModel,
      apiKey: '',
      systemPrompt: '请用一句简体中文总结网页的主要内容和功能。',
      summaryLength: 48,
      temperature: 0.2,
    },
    webdav: {
      serverUrl: '',
      remotePath: '/glasstab',
      fileName: BACKUP_FILE_NAME,
      username: '',
      password: '',
      autoBackup: false,
      lastBackupAt: '',
    },
    wallpaperSeed: timestamp,
  };
}

export function createDefaultState() {
  const timestamp = nowIso();
  return {
    schemaVersion: APP_SCHEMA_VERSION,
    createdAt: timestamp,
    updatedAt: timestamp,
    meta: {
      legacyMigratedAt: '',
    },
    settings: createDefaultSettings(timestamp),
    shortcuts: DEFAULT_SHORTCUTS.map((shortcut) => ({
      ...shortcut,
      createdAt: timestamp,
      updatedAt: timestamp,
      iconAssetId: null,
      iconMode: 'auto',
    })),
    bookmarks: [],
  };
}

function normalizeShortcut(shortcut, fallbackCreatedAt = nowIso()) {
  return {
    id: shortcut.id || generateId('shortcut'),
    name: String(shortcut.name || '快捷方式').trim() || '快捷方式',
    url: normalizeUrl(shortcut.url),
    iconAssetId: shortcut.iconAssetId || null,
    iconMode: shortcut.iconMode || 'auto',
    createdAt: shortcut.createdAt || fallbackCreatedAt,
    updatedAt: shortcut.updatedAt || nowIso(),
  };
}

function normalizeBookmark(bookmark, fallbackCreatedAt = nowIso()) {
  return {
    id: bookmark.id || generateId('bookmark'),
    title: String(bookmark.title || '未命名书签').trim() || '未命名书签',
    url: normalizeUrl(bookmark.url),
    iconAssetId: bookmark.iconAssetId || null,
    summary: String(bookmark.summary || '').trim(),
    notes: String(bookmark.notes || '').trim(),
    tags: ensureArray(bookmark.tags)
      .map((tag) => String(tag || '').trim())
      .filter(Boolean)
      .slice(0, 8),
    source: bookmark.source || 'manual',
    createdAt: bookmark.createdAt || fallbackCreatedAt,
    updatedAt: bookmark.updatedAt || nowIso(),
  };
}

function normalizeSettings(rawSettings = {}, defaultSettings) {
  const searchEngines = ensureArray(rawSettings.searchEngines).slice(0, 3);
  return {
    ...defaultSettings,
    ...rawSettings,
    searchEngines: [
      searchEngines[0] || defaultSettings.searchEngines[0],
      searchEngines[1] || defaultSettings.searchEngines[1],
      searchEngines[2] || defaultSettings.searchEngines[2],
    ],
    ai: {
      ...defaultSettings.ai,
      ...(rawSettings.ai || {}),
    },
    webdav: {
      ...defaultSettings.webdav,
      ...(rawSettings.webdav || {}),
    },
  };
}

export function normalizeState(rawState = {}) {
  const defaults = createDefaultState();
  const timestamp = nowIso();

  return {
    ...defaults,
    ...rawState,
    schemaVersion: APP_SCHEMA_VERSION,
    updatedAt: rawState.updatedAt || timestamp,
    meta: {
      ...defaults.meta,
      ...(rawState.meta || {}),
    },
    settings: normalizeSettings(rawState.settings, defaults.settings),
    shortcuts: ensureArray(rawState.shortcuts)
      .map((shortcut) => normalizeShortcut(shortcut))
      .filter((shortcut) => shortcut.url),
    bookmarks: ensureArray(rawState.bookmarks)
      .map((bookmark) => normalizeBookmark(bookmark))
      .filter((bookmark) => bookmark.url),
  };
}

export async function getState() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return normalizeState(result[STORAGE_KEY] || {});
}

export async function saveState(nextState) {
  const normalized = normalizeState(nextState);
  normalized.updatedAt = nowIso();
  await chrome.storage.local.set({ [STORAGE_KEY]: normalized });
  return normalized;
}

export async function updateState(mutator) {
  const current = await getState();
  const draft = deepClone(current);
  const next = (await mutator(draft)) || draft;
  return saveState(next);
}

export async function upsertShortcut(shortcut) {
  const normalized = normalizeShortcut(shortcut);

  return updateState((state) => {
    const index = state.shortcuts.findIndex((item) => item.id === normalized.id || item.url === normalized.url);
    if (index >= 0) {
      const current = state.shortcuts[index];
      state.shortcuts[index] = normalizeShortcut({
        ...current,
        name: normalized.name || current.name,
        url: normalized.url || current.url,
        iconAssetId: normalized.iconAssetId || current.iconAssetId || null,
        iconMode: normalized.iconMode || current.iconMode || 'auto',
        createdAt: current.createdAt,
        updatedAt: nowIso(),
      }, current.createdAt);
    } else {
      state.shortcuts.push(normalized);
    }
    return state;
  });
}

export async function removeShortcut(shortcutId) {
  return updateState((state) => {
    state.shortcuts = state.shortcuts.filter((shortcut) => shortcut.id !== shortcutId);
    return state;
  });
}

export async function upsertBookmark(bookmark) {
  const normalized = normalizeBookmark(bookmark);

  return updateState((state) => {
    const index = state.bookmarks.findIndex((item) => item.id === normalized.id || item.url === normalized.url);
    if (index >= 0) {
      const current = state.bookmarks[index];
      state.bookmarks[index] = normalizeBookmark({
        ...current,
        title: normalized.title || current.title,
        url: normalized.url || current.url,
        iconAssetId: normalized.iconAssetId || current.iconAssetId || null,
        summary: normalized.summary || current.summary || '',
        notes: normalized.notes || current.notes || '',
        tags: normalized.tags?.length ? normalized.tags : current.tags || [],
        source: normalized.source || current.source || 'manual',
        createdAt: current.createdAt,
        updatedAt: nowIso(),
      }, current.createdAt);
    } else {
      state.bookmarks.unshift(normalized);
    }
    return state;
  });
}

export async function removeBookmark(bookmarkId) {
  return updateState((state) => {
    state.bookmarks = state.bookmarks.filter((bookmark) => bookmark.id !== bookmarkId);
    return state;
  });
}

export async function patchSettings(partialSettings) {
  return updateState((state) => {
    state.settings = normalizeSettings({
      ...state.settings,
      ...partialSettings,
      ai: {
        ...state.settings.ai,
        ...(partialSettings.ai || {}),
      },
      webdav: {
        ...state.settings.webdav,
        ...(partialSettings.webdav || {}),
      },
    }, createDefaultSettings(nowIso()));
    return state;
  });
}

export async function markBackupFinished(timestamp = nowIso()) {
  return patchSettings({
    webdav: {
      lastBackupAt: timestamp,
    },
  });
}

export async function migrateLegacyLocalData(legacyData) {
  const state = await getState();
  if (state.meta.legacyMigratedAt) {
    return state;
  }

  const next = deepClone(state);
  const timestamp = nowIso();

  if (ensureArray(legacyData.shortcuts).length) {
    next.shortcuts = legacyData.shortcuts
      .map((shortcut) => normalizeShortcut(shortcut, timestamp))
      .filter((shortcut) => shortcut.url);
  }

  if (ensureArray(legacyData.searchEngines).length) {
    next.settings.searchEngines = legacyData.searchEngines.slice(0, 3);
  }

  if (legacyData.gridSize) {
    next.settings.gridSize = legacyData.gridSize;
  }

  next.meta.legacyMigratedAt = timestamp;

  return saveState(next);
}
