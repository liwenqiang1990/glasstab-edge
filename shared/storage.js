import { AI_PROVIDERS, APP_SCHEMA_VERSION, BACKUP_FILE_NAME, DEFAULT_SHORTCUTS, GROUP_ICONS, HOME_GROUP_ID, SEARCH_ENGINES, STORAGE_KEY, WALLPAPER_PRESETS } from './constants.js';
import { deepClone, ensureArray, generateId, normalizeUrl, nowIso } from './utils.js';

// 会随 WebDAV 同步的设置项；其余（WebDAV 账号、壁纸）只保存在本机。
export const SYNCED_SETTING_KEYS = ['gridSize', 'searchEngine', 'ai'];

function createDefaultSettings() {
  return {
    gridSize: 'standard',
    searchEngine: 'bing',
    ai: {
      enabled: false,
      provider: 'qwen',
      endpoint: AI_PROVIDERS.qwen.endpoint,
      model: AI_PROVIDERS.qwen.defaultModel,
      apiKey: '',
      systemPrompt: '请用一句简体中文总结网页的主要内容和功能。',
      summaryLength: 48,
      temperature: 0.2,
      // AI 搜索时是否允许把历史记录标题发给 AI（书签摘要默认允许）
      searchHistory: false,
    },
    webdav: {
      serverUrl: '',
      remotePath: '/glasstab',
      fileName: BACKUP_FILE_NAME,
      username: '',
      password: '',
      autoSync: false,
    },
    wallpaper: {
      mode: 'bing',
      presetId: WALLPAPER_PRESETS[0].id,
      dim: 18,
      blur: 0,
      // Unsplash：Access Key 只存本机（壁纸设置整体不参与同步和备份）
      unsplashKey: '',
      unsplashQuery: 'topic:wallpapers',
      unsplashRotate: 'daily',
    },
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
      // 从未被用户改动过的全新安装。首次同步时直接采用远端数据，避免默认快捷方式“复活”。
      pristine: true,
      settingsUpdatedAt: '',
      orderUpdatedAt: '',
      groupOrderUpdatedAt: '',
    },
    settings: createDefaultSettings(),
    groups: [createHomeGroup(timestamp)],
    shortcuts: DEFAULT_SHORTCUTS.map((shortcut) => ({
      ...shortcut,
      groupId: HOME_GROUP_ID,
      createdAt: timestamp,
      updatedAt: timestamp,
      iconAssetId: null,
      iconMode: 'auto',
      iconUpdatedAt: '',
    })),
    bookmarks: [],
    tombstones: {},
  };
}

function createHomeGroup(timestamp = '') {
  return { id: HOME_GROUP_ID, name: '主页', icon: 'home', createdAt: timestamp, updatedAt: timestamp };
}

export function normalizeGroup(group, fallbackTime = nowIso()) {
  const createdAt = group.createdAt || group.updatedAt || fallbackTime;
  return {
    id: group.id || generateId('group'),
    name: String(group.name || '分组').trim().slice(0, 12) || '分组',
    icon: GROUP_ICONS.includes(group.icon) ? group.icon : 'folder',
    createdAt,
    updatedAt: group.updatedAt || createdAt,
  };
}

// 图标单独带时间戳：补抓/更换图标不影响名称等字段的合并。
export function normalizeShortcut(shortcut, fallbackTime = nowIso()) {
  const createdAt = shortcut.createdAt || shortcut.updatedAt || fallbackTime;
  return {
    id: shortcut.id || generateId('shortcut'),
    name: String(shortcut.name || '快捷方式').trim() || '快捷方式',
    url: normalizeUrl(shortcut.url),
    groupId: shortcut.groupId || HOME_GROUP_ID,
    iconAssetId: shortcut.iconAssetId || null,
    iconMode: shortcut.iconMode || 'auto',
    iconUpdatedAt: shortcut.iconUpdatedAt || '',
    createdAt,
    updatedAt: shortcut.updatedAt || createdAt,
  };
}

export function normalizeBookmark(bookmark, fallbackTime = nowIso()) {
  const createdAt = bookmark.createdAt || bookmark.updatedAt || fallbackTime;
  return {
    id: bookmark.id || generateId('bookmark'),
    title: String(bookmark.title || '未命名书签').trim() || '未命名书签',
    url: normalizeUrl(bookmark.url),
    iconAssetId: bookmark.iconAssetId || null,
    iconUpdatedAt: bookmark.iconUpdatedAt || '',
    summary: String(bookmark.summary || '').trim(),
    notes: String(bookmark.notes || '').trim(),
    tags: ensureArray(bookmark.tags)
      .map((tag) => String(tag || '').trim())
      .filter(Boolean)
      .slice(0, 8),
    source: bookmark.source || 'manual',
    createdAt,
    updatedAt: bookmark.updatedAt || createdAt,
  };
}

function normalizeSettings(rawSettings = {}, defaults = createDefaultSettings()) {
  const rawWebdav = rawSettings.webdav || {};
  const legacyEngine = ensureArray(rawSettings.searchEngines)[0];
  const searchEngine = [rawSettings.searchEngine, legacyEngine].find((key) => SEARCH_ENGINES[key]) || defaults.searchEngine;
  const gridSize = ['compact', 'standard', 'comfortable'].includes(rawSettings.gridSize) ? rawSettings.gridSize : defaults.gridSize;
  const wallpaper = { ...defaults.wallpaper, ...(rawSettings.wallpaper || {}) };

  return {
    gridSize,
    searchEngine,
    ai: {
      ...defaults.ai,
      ...(rawSettings.ai || {}),
    },
    webdav: {
      serverUrl: rawWebdav.serverUrl ?? defaults.webdav.serverUrl,
      remotePath: rawWebdav.remotePath || defaults.webdav.remotePath,
      fileName: rawWebdav.fileName || defaults.webdav.fileName,
      username: rawWebdav.username ?? defaults.webdav.username,
      password: rawWebdav.password ?? defaults.webdav.password,
      autoSync: Boolean(rawWebdav.autoSync ?? rawWebdav.autoBackup ?? defaults.webdav.autoSync),
    },
    wallpaper: {
      mode: ['bing', 'unsplash', 'custom', 'preset'].includes(wallpaper.mode) ? wallpaper.mode : 'bing',
      presetId: WALLPAPER_PRESETS.some((preset) => preset.id === wallpaper.presetId) ? wallpaper.presetId : defaults.wallpaper.presetId,
      dim: Math.min(70, Math.max(0, Number(wallpaper.dim) || 0)),
      blur: Math.min(30, Math.max(0, Number(wallpaper.blur) || 0)),
      unsplashKey: String(wallpaper.unsplashKey || '').trim(),
      unsplashQuery: String(wallpaper.unsplashQuery || '').trim() || defaults.wallpaper.unsplashQuery,
      unsplashRotate: wallpaper.unsplashRotate === 'tab' ? 'tab' : 'daily',
    },
  };
}

function normalizeGroups(rawGroups, fallbackTime) {
  const groups = ensureArray(rawGroups).map((group) => normalizeGroup(group, fallbackTime));
  const seen = new Set();
  const unique = groups.filter((group) => !seen.has(group.id) && seen.add(group.id));
  const home = unique.find((group) => group.id === HOME_GROUP_ID) || createHomeGroup();
  return [home, ...unique.filter((group) => group.id !== HOME_GROUP_ID)];
}

function normalizeTombstones(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  return Object.fromEntries(Object.entries(raw).filter(([id, time]) => id && typeof time === 'string'));
}

export function normalizeState(rawState = {}) {
  const defaults = createDefaultState();
  const hasStoredState = Boolean(rawState.meta || rawState.shortcuts || rawState.bookmarks);
  const rawMeta = rawState.meta || {};

  return {
    schemaVersion: APP_SCHEMA_VERSION,
    createdAt: rawState.createdAt || defaults.createdAt,
    updatedAt: rawState.updatedAt || defaults.updatedAt,
    meta: {
      legacyMigratedAt: rawMeta.legacyMigratedAt || '',
      pristine: hasStoredState ? rawMeta.pristine === true : true,
      settingsUpdatedAt: rawMeta.settingsUpdatedAt || '',
      orderUpdatedAt: rawMeta.orderUpdatedAt || '',
      groupOrderUpdatedAt: rawMeta.groupOrderUpdatedAt || '',
    },
    settings: normalizeSettings(rawState.settings, defaults.settings),
    groups: normalizeGroups(rawState.groups, defaults.createdAt),
    shortcuts: (hasStoredState ? ensureArray(rawState.shortcuts) : defaults.shortcuts)
      .map((shortcut) => normalizeShortcut(shortcut, defaults.createdAt))
      .filter((shortcut) => shortcut.url),
    bookmarks: ensureArray(rawState.bookmarks)
      .map((bookmark) => normalizeBookmark(bookmark, defaults.createdAt))
      .filter((bookmark) => bookmark.url),
    tombstones: normalizeTombstones(rawState.tombstones),
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

function markUserEdit(state, id) {
  state.meta.pristine = false;
  if (id) {
    delete state.tombstones[id];
  }
}

// 只合并调用方显式传入的字段，允许把备注、标签等清空。
function pickDefined(source, keys) {
  return Object.fromEntries(keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
}

export async function upsertShortcut(shortcut) {
  const url = normalizeUrl(shortcut.url);
  return updateState((state) => {
    const index = state.shortcuts.findIndex((item) => (shortcut.id && item.id === shortcut.id) || (url && item.url === url));
    const timestamp = nowIso();
    if (index >= 0) {
      const current = state.shortcuts[index];
      state.shortcuts[index] = normalizeShortcut({
        ...current,
        ...pickDefined({ ...shortcut, url: url || undefined }, ['name', 'url', 'groupId', 'iconAssetId', 'iconMode']),
        ...(shortcut.iconAssetId !== undefined ? { iconUpdatedAt: timestamp } : {}),
        id: current.id,
        createdAt: current.createdAt,
        updatedAt: timestamp,
      });
      markUserEdit(state, current.id);
    } else {
      const created = normalizeShortcut({ ...shortcut, url, createdAt: timestamp, updatedAt: timestamp, iconUpdatedAt: shortcut.iconAssetId ? timestamp : '' });
      state.shortcuts.push(created);
      markUserEdit(state, created.id);
    }
    return state;
  });
}

export async function removeShortcut(shortcutId) {
  return updateState((state) => {
    state.shortcuts = state.shortcuts.filter((shortcut) => shortcut.id !== shortcutId);
    state.tombstones[shortcutId] = nowIso();
    markUserEdit(state);
    return state;
  });
}

// orderedIds 可以只是某个分组内的顺序：只重排这些条目占据的位置，其他分组不动。
export async function reorderShortcuts(orderedIds) {
  return updateState((state) => {
    const byId = new Map(state.shortcuts.map((shortcut) => [shortcut.id, shortcut]));
    const ordered = orderedIds.map((id) => byId.get(id)).filter(Boolean);
    const idSet = new Set(ordered.map((shortcut) => shortcut.id));
    let cursor = 0;
    state.shortcuts = state.shortcuts.map((shortcut) => (idSet.has(shortcut.id) ? ordered[cursor++] : shortcut));
    state.meta.orderUpdatedAt = nowIso();
    markUserEdit(state);
    return state;
  });
}

export async function moveShortcutToGroup(shortcutId, groupId) {
  return updateState((state) => {
    const index = state.shortcuts.findIndex((shortcut) => shortcut.id === shortcutId);
    if (index < 0 || state.shortcuts[index].groupId === groupId) {
      return state;
    }
    const [shortcut] = state.shortcuts.splice(index, 1);
    state.shortcuts.push({ ...shortcut, groupId, updatedAt: nowIso() });
    state.meta.orderUpdatedAt = nowIso();
    markUserEdit(state, shortcutId);
    return state;
  });
}

export async function upsertGroup(group) {
  return updateState((state) => {
    const timestamp = nowIso();
    const index = state.groups.findIndex((item) => item.id === group.id);
    if (index >= 0) {
      state.groups[index] = normalizeGroup({ ...state.groups[index], ...pickDefined(group, ['name', 'icon']), updatedAt: timestamp });
      markUserEdit(state, group.id);
    } else {
      const created = normalizeGroup({ ...group, createdAt: timestamp, updatedAt: timestamp });
      state.groups.push(created);
      state.meta.groupOrderUpdatedAt = timestamp;
      markUserEdit(state, created.id);
    }
    return state;
  });
}

// 删除分组时，里面的快捷方式移回主页。
export async function removeGroup(groupId) {
  if (groupId === HOME_GROUP_ID) {
    throw new Error('主页分组不能删除。');
  }
  return updateState((state) => {
    const timestamp = nowIso();
    state.groups = state.groups.filter((group) => group.id !== groupId);
    state.shortcuts = state.shortcuts.map((shortcut) => (
      shortcut.groupId === groupId ? { ...shortcut, groupId: HOME_GROUP_ID, updatedAt: timestamp } : shortcut
    ));
    state.tombstones[groupId] = timestamp;
    state.meta.groupOrderUpdatedAt = timestamp;
    markUserEdit(state);
    return state;
  });
}

export async function upsertBookmark(bookmark) {
  const url = normalizeUrl(bookmark.url);
  return updateState((state) => {
    const index = state.bookmarks.findIndex((item) => (bookmark.id && item.id === bookmark.id) || (url && item.url === url));
    const timestamp = nowIso();
    if (index >= 0) {
      const current = state.bookmarks[index];
      const patch = pickDefined({ ...bookmark, url: url || undefined }, ['title', 'url', 'iconAssetId', 'summary', 'notes', 'tags', 'source']);
      // 重复收藏同一页面时，没拿到新摘要就保留旧摘要。
      if (!patch.summary) {
        delete patch.summary;
      }
      if (patch.iconAssetId !== undefined) {
        patch.iconUpdatedAt = timestamp;
      }
      state.bookmarks[index] = normalizeBookmark({
        ...current,
        ...patch,
        id: current.id,
        createdAt: current.createdAt,
        updatedAt: timestamp,
      });
      markUserEdit(state, current.id);
    } else {
      const created = normalizeBookmark({ ...bookmark, url, createdAt: bookmark.createdAt || timestamp, updatedAt: timestamp, iconUpdatedAt: bookmark.iconAssetId ? timestamp : '' });
      state.bookmarks.unshift(created);
      markUserEdit(state, created.id);
    }
    return state;
  });
}

export async function removeBookmark(bookmarkId) {
  return updateState((state) => {
    state.bookmarks = state.bookmarks.filter((bookmark) => bookmark.id !== bookmarkId);
    state.tombstones[bookmarkId] = nowIso();
    markUserEdit(state);
    return state;
  });
}

// 补抓/升级图标：只刷新 iconUpdatedAt，不动 updatedAt，避免盖掉别的设备对名称等的修改。
export async function setItemIcon(listName, itemId, iconAssetId) {
  return updateState((state) => {
    const item = state[listName]?.find((entry) => entry.id === itemId);
    if (item) {
      item.iconAssetId = iconAssetId;
      item.iconUpdatedAt = nowIso();
    }
    return state;
  });
}

export async function patchSettings(partialSettings = {}) {
  return updateState((state) => {
    state.settings = normalizeSettings({
      ...state.settings,
      ...partialSettings,
      ai: { ...state.settings.ai, ...(partialSettings.ai || {}) },
      webdav: { ...state.settings.webdav, ...(partialSettings.webdav || {}) },
      wallpaper: { ...state.settings.wallpaper, ...(partialSettings.wallpaper || {}) },
    });
    if (SYNCED_SETTING_KEYS.some((key) => key in partialSettings)) {
      state.meta.settingsUpdatedAt = nowIso();
    }
    return state;
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
    next.meta.pristine = false;
  }

  if (ensureArray(legacyData.searchEngines).length && SEARCH_ENGINES[legacyData.searchEngines[0]]) {
    next.settings.searchEngine = legacyData.searchEngines[0];
  }

  if (legacyData.gridSize) {
    next.settings.gridSize = legacyData.gridSize;
  }

  next.meta.legacyMigratedAt = timestamp;

  return saveState(next);
}
