import { createPalette } from './palette.js';
import { GROUP_ICONS, HOME_GROUP_ID, SEARCH_ENGINES, STORAGE_KEY, SYNC_STATUS_KEY, WALLPAPER_PRESETS } from './shared/constants.js';
import { listAssetRecords, putAsset } from './shared/assets.js';
import { ICON_REV, createFallbackIconDataUrl, discoverIcon, fetchImageAsDataUrl, listIconCandidates, readUploadedIcon, searchAppStoreIcons } from './shared/favicon.js';
import { styleIcons } from './shared/icon-style.js';
import { icon } from './shared/icons.js';
import {
  getState,
  migrateLegacyLocalData,
  moveShortcutToGroup,
  patchSettings,
  removeBookmark,
  removeGroup,
  removeShortcut,
  reorderShortcuts,
  setItemIcon,
  upsertBookmark,
  upsertGroup,
  upsertShortcut,
} from './shared/storage.js';
import { escapeHtml, getHostname, normalizeUrl, safeJsonParse, toTime } from './shared/utils.js';
import { UNSPLASH_TOPICS } from './shared/unsplash.js';
import { readCachedColor, refreshBingIfStale, resolveWallpaper, saveCustomWallpaper, stepBingWallpaper } from './shared/wallpaper.js';

const $ = (id) => document.getElementById(id);
const els = {
  wpLayers: [$('wp-a'), $('wp-b')],
  dock: $('dock'),
  clock: $('clock'),
  date: $('date'),
  searchForm: $('search-form'),
  searchInput: $('search-input'),
  engineBtn: $('engine-btn'),
  engineMenu: $('engine-menu'),
  shortcuts: $('shortcuts'),
  drawer: $('drawer'),
  drawerBtn: $('drawer-btn'),
  credit: $('credit'),
  syncBtn: $('sync-btn'),
  appearanceBtn: $('appearance-btn'),
  appearance: $('appearance'),
  menu: $('menu'),
  modalRoot: $('modal-root'),
  toast: $('toast'),
};

const GRID_SIZES = [['compact', '小'], ['standard', '中'], ['comfortable', '大']];
const UI_KEYS = { group: 'glasstab:active-group', pinned: 'glasstab:drawer-pinned' };

function readUi(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch (error) {
    return fallback;
  }
}

function writeUi(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    // 忽略
  }
}

const cachedColor = readCachedColor();
if (cachedColor) {
  document.body.style.setProperty('--wp-color', cachedColor);
}

let state = await getState();
let assets = await listAssetRecords();
let syncStatus = {};
let activeGroupId = readUi(UI_KEYS.group, HOME_GROUP_ID);
let drawerPinned = readUi(UI_KEYS.pinned, '1') === '1';
let drawerOpen = drawerPinned;
let drawerQuery = '';
let drawerTag = '';
let dialog = null;
let dragId = null;
let dropHandled = false;
let renderQueued = false;
let activeLayer = -1;
let wallpaperToken = 0;
let currentWallpaper = null;
let wallpaperLoading = false;
let wallpaperError = '';
let toastTimer = null;
let palette = null;

// ---------- 通用 ----------

function iconMarkup(item, label, extraClass = '') {
  const record = assets[item.iconAssetId];
  const src = record?.dataUrl || createFallbackIconDataUrl(label);
  const key = record ? item.iconAssetId : `fallback:${label}`;
  return `<span class="app-icon ${extraClass}" data-icon-key="${escapeHtml(key)}"><img src="${escapeHtml(src)}" alt="" loading="lazy" decoding="async"></span>`;
}

function formatRelative(iso) {
  const diff = Date.now() - toTime(iso);
  if (!toTime(iso)) return '从未';
  if (diff < 60 * 1000) return '刚刚';
  if (diff < 3600 * 1000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400 * 1000) return `${Math.floor(diff / 3600000)} 小时前`;
  return new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function showToast(message, action = null, duration = 4200) {
  clearTimeout(toastTimer);
  els.toast.innerHTML = `<span>${escapeHtml(message)}</span>${action ? `<button type="button">${escapeHtml(action.label)}</button>` : ''}`;
  els.toast.classList.toggle('no-action', !action);
  els.toast.hidden = false;
  if (action) {
    els.toast.querySelector('button').onclick = () => {
      els.toast.hidden = true;
      action.run();
    };
  }
  toastTimer = setTimeout(() => {
    els.toast.hidden = true;
  }, duration);
}

async function refreshData() {
  state = await getState();
  assets = await listAssetRecords();
}

function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    if (dragId) return;
    renderDock();
    renderShortcuts();
    renderDrawer();
    renderEngine();
    renderSync();
    applyAppearanceVars();
  });
}

// ---------- 时钟 ----------

function updateClock() {
  const now = new Date();
  els.clock.textContent = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  els.date.textContent = now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
}

// ---------- 搜索 ----------

function renderEngine() {
  const engineKey = state.settings.searchEngine;
  const engine = SEARCH_ENGINES[engineKey] || SEARCH_ENGINES.bing;
  els.engineBtn.innerHTML = `${escapeHtml(engine.label)}${icon('chevronDown', 13)}`;
  els.engineMenu.innerHTML = Object.entries(SEARCH_ENGINES)
    .map(([key, value]) => `
      <button type="button" role="menuitemradio" aria-checked="${key === engineKey}" data-engine="${key}">
        <span>${escapeHtml(value.label)}</span>${key === engineKey ? icon('check', 14, 'check') : ''}
      </button>`)
    .join('');
}

function setEngineMenu(open) {
  if (open) palette?.close();
  els.engineMenu.hidden = !open;
  els.searchForm.classList.toggle('menu-open', open);
}

function looksLikeUrl(query) {
  if (/\s/.test(query)) return false;
  return /^https?:\/\//i.test(query)
    || /^localhost(:\d+)?(\/|$)/i.test(query)
    || /^(\d{1,3}\.){3}\d{1,3}(:\d+)?(\/\S*)?$/.test(query)
    || /^([\w-]+\.)+[a-z]{2,}(:\d+)?(\/\S*)?$/i.test(query);
}

function runSearch(query, { newTab = false } = {}) {
  if (!query) return;
  let target;
  if (looksLikeUrl(query)) {
    target = /^https?:\/\//i.test(query) ? query : `https://${query}`;
  } else {
    const engine = SEARCH_ENGINES[state.settings.searchEngine] || SEARCH_ENGINES.bing;
    target = `${engine.url}${encodeURIComponent(query)}`;
  }
  if (newTab) chrome.tabs.create({ url: target, active: false });
  else window.location.href = target;
}

// ---------- 分组 Dock ----------

function activeGroup() {
  return state.groups.find((group) => group.id === activeGroupId) || state.groups[0];
}

function groupOf(shortcut) {
  return state.groups.some((group) => group.id === shortcut.groupId) ? shortcut.groupId : HOME_GROUP_ID;
}

function renderDock() {
  const current = activeGroup().id;
  els.dock.innerHTML = `
    ${state.groups.map((group) => `
      <button class="dock-item ${group.id === current ? 'active' : ''}" type="button" data-group="${escapeHtml(group.id)}" title="${escapeHtml(group.name)}">
        ${icon(group.icon, 20)}<span>${escapeHtml(group.name)}</span>
      </button>`).join('')}
    <div class="dock-sep"></div>
    <button class="dock-item dock-add" type="button" data-action="add-group" title="新建分组">${icon('plus', 18)}</button>`;
}

function switchGroup(groupId) {
  if (groupId === activeGroupId) return;
  activeGroupId = groupId;
  writeUi(UI_KEYS.group, groupId);
  renderDock();
  renderShortcuts(true);
}

// ---------- 快捷方式 ----------

function groupShortcuts() {
  const current = activeGroup().id;
  return state.shortcuts.filter((shortcut) => groupOf(shortcut) === current);
}

function renderShortcuts(animate = false) {
  els.shortcuts.className = `launchpad size-${state.settings.gridSize}${animate ? ' enter' : ''}`;
  const list = groupShortcuts();
  const tiles = list.map((shortcut) => `
    <a class="tile" href="${escapeHtml(shortcut.url)}" draggable="true" data-kind="shortcut" data-id="${escapeHtml(shortcut.id)}" title="${escapeHtml(shortcut.name)}">
      ${iconMarkup(shortcut, shortcut.name)}
      <span class="tile-name">${escapeHtml(shortcut.name)}</span>
    </a>`);

  tiles.push(`
    <button class="tile tile-add" type="button" data-action="add-shortcut">
      <span class="app-icon">${icon('plus', 26)}</span>
      <span class="tile-name">添加</span>
    </button>`);

  if (!list.length && state.groups.length > 1) {
    tiles.push('<p class="launchpad-hint">这个分组还是空的。可以把其他分组的图标拖到左侧这个分组上。</p>');
  }

  els.shortcuts.innerHTML = tiles.join('');
  styleIcons(els.shortcuts);
}

function currentTileOrder() {
  return Array.from(els.shortcuts.querySelectorAll('.tile[data-id]')).map((tile) => tile.dataset.id);
}

els.shortcuts.addEventListener('dragstart', (event) => {
  const tile = event.target.closest?.('.tile[data-id]');
  if (!tile) return;
  dragId = tile.dataset.id;
  dropHandled = false;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/uri-list', tile.href);
  requestAnimationFrame(() => tile.classList.add('dragging'));
});

els.shortcuts.addEventListener('dragover', (event) => {
  if (!dragId) return;
  event.preventDefault();
  const dragging = els.shortcuts.querySelector('.tile.dragging');
  const target = event.target.closest('.tile');
  if (!dragging || !target || target === dragging) return;
  if (target.classList.contains('tile-add')) {
    els.shortcuts.insertBefore(dragging, target);
    return;
  }
  const rect = target.getBoundingClientRect();
  const before = event.clientX < rect.left + rect.width / 2;
  els.shortcuts.insertBefore(dragging, before ? target : target.nextSibling);
});

els.shortcuts.addEventListener('drop', (event) => {
  if (dragId) event.preventDefault();
});

els.shortcuts.addEventListener('dragend', async () => {
  if (!dragId) return;
  els.shortcuts.querySelector('.tile.dragging')?.classList.remove('dragging');
  const movedId = dragId;
  dragId = null;
  els.dock.querySelectorAll('.drop-target').forEach((item) => item.classList.remove('drop-target'));
  if (!dropHandled) {
    const order = currentTileOrder();
    const previous = groupShortcuts().map((shortcut) => shortcut.id);
    if (order.join('|') !== previous.join('|')) {
      state = await reorderShortcuts(order);
    }
  } else {
    const shortcut = state.shortcuts.find((item) => item.id === movedId);
    const group = state.groups.find((item) => item.id === shortcut?.groupId);
    if (shortcut && group) showToast(`已将「${shortcut.name}」移到「${group.name}」`);
  }
  queueRender();
});

// 拖到左侧 Dock 的分组上 = 移动到该分组
els.dock.addEventListener('dragover', (event) => {
  const item = event.target.closest('[data-group]');
  if (!dragId || !item) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  els.dock.querySelectorAll('.drop-target').forEach((node) => node !== item && node.classList.remove('drop-target'));
  item.classList.add('drop-target');
});

els.dock.addEventListener('dragleave', (event) => {
  event.target.closest?.('[data-group]')?.classList.remove('drop-target');
});

els.dock.addEventListener('drop', async (event) => {
  const item = event.target.closest('[data-group]');
  if (!dragId || !item) return;
  event.preventDefault();
  dropHandled = true;
  state = await moveShortcutToGroup(dragId, item.dataset.group);
});

// ---------- 书签抽屉 ----------

function dateBucket(iso) {
  const time = toTime(iso);
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  if (time >= startOfToday) return '今天';
  if (time >= startOfToday - 86400000) return '昨天';
  if (time >= startOfToday - 6 * 86400000) return '最近 7 天';
  if (time >= startOfToday - 30 * 86400000) return '最近 30 天';
  return '更早';
}

function drawerBookmarks() {
  const keyword = drawerQuery.trim().toLowerCase();
  return state.bookmarks
    .filter((bookmark) => !drawerTag || (bookmark.tags || []).includes(drawerTag))
    .filter((bookmark) => !keyword || [bookmark.title, bookmark.url, bookmark.summary, bookmark.notes, ...(bookmark.tags || [])].join(' ').toLowerCase().includes(keyword))
    .sort((left, right) => toTime(right.createdAt) - toTime(left.createdAt));
}

function applyDrawerLayout() {
  els.drawer.hidden = !drawerOpen;
  document.body.classList.toggle('drawer-pinned', drawerOpen && drawerPinned);
  els.drawerBtn.classList.toggle('is-active', drawerOpen);
}

function renderDrawerList() {
  const list = els.drawer.querySelector('.drawer-list');
  if (!list) return;
  const bookmarks = drawerBookmarks();
  if (!bookmarks.length) {
    list.innerHTML = `<div class="drawer-empty">${state.bookmarks.length ? '没有匹配的书签' : '还没有书签。<br>浏览网页时点击工具栏里的 GlassTab 图标，<br>或在页面上右键「保存到 GlassTab 书签」。'}</div>`;
    return;
  }
  let lastBucket = '';
  list.innerHTML = bookmarks.map((bookmark) => {
    const bucket = dateBucket(bookmark.createdAt);
    const heading = bucket !== lastBucket ? `<h3>${bucket}</h3>` : '';
    lastBucket = bucket;
    const meta = [getHostname(bookmark.url), ...(bookmark.tags || []).map((tag) => `#${tag}`)].join(' · ');
    const summary = bookmark.summary || bookmark.notes;
    return `${heading}
      <a class="bk" href="${escapeHtml(bookmark.url)}" data-kind="bookmark" data-id="${escapeHtml(bookmark.id)}" title="${escapeHtml(bookmark.url)}">
        ${iconMarkup(bookmark, bookmark.title)}
        <span>
          <span class="bk-title">${escapeHtml(bookmark.title)}</span>
          ${summary ? `<span class="bk-sum">${escapeHtml(summary)}</span>` : ''}
          <span class="bk-meta">${escapeHtml(meta)}</span>
        </span>
        <button class="plain-btn bk-more" type="button" data-menu="bookmark" data-id="${escapeHtml(bookmark.id)}" aria-label="更多操作">${icon('more', 16)}</button>
      </a>`;
  }).join('');
  styleIcons(list);
}

function renderDrawer() {
  applyDrawerLayout();
  if (!drawerOpen) return;

  const tags = Array.from(new Set(state.bookmarks.flatMap((bookmark) => bookmark.tags || [])));
  if (drawerTag && !tags.includes(drawerTag)) drawerTag = '';

  // 搜索框不重建，避免输入时丢焦点。
  if (!els.drawer.querySelector('.drawer-list')) {
    els.drawer.innerHTML = `
      <div class="drawer-head">
        <h2>书签<span id="drawer-count"></span></h2>
        <div class="actions">
          <button class="plain-btn" type="button" data-drawer="pin" id="drawer-pin"></button>
          <button class="plain-btn" type="button" data-drawer="close" title="关闭">${icon('close', 16)}</button>
        </div>
      </div>
      <div class="drawer-search">${icon('search', 14)}<input id="drawer-search" type="text" placeholder="搜索书签" value="${escapeHtml(drawerQuery)}"></div>
      <div class="tag-row" id="drawer-tags"></div>
      <div class="drawer-list"></div>
      <div class="drawer-foot"><a href="bookmarks.html">管理全部书签${icon('chevronRight', 14)}</a></div>`;
  }

  $('drawer-count').textContent = state.bookmarks.length || '';
  const pin = $('drawer-pin');
  pin.innerHTML = icon('pin', 15);
  pin.classList.toggle('on', drawerPinned);
  pin.title = drawerPinned ? '取消固定（打开新标签页时不再自动显示）' : '固定在右侧';
  const tagRow = $('drawer-tags');
  tagRow.hidden = !tags.length;
  tagRow.innerHTML = tags.length
    ? [`<button class="tag-chip ${drawerTag ? '' : 'active'}" type="button" data-tag="">全部</button>`,
      ...tags.map((tag) => `<button class="tag-chip ${tag === drawerTag ? 'active' : ''}" type="button" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`)].join('')
    : '';
  renderDrawerList();
}

function setDrawer(open, pinned = drawerPinned) {
  drawerOpen = open;
  drawerPinned = pinned;
  writeUi(UI_KEYS.pinned, pinned ? '1' : '0');
  renderDrawer();
}

els.drawer.addEventListener('click', (event) => {
  const action = event.target.closest('[data-drawer]')?.dataset.drawer;
  if (action === 'pin') setDrawer(true, !drawerPinned);
  if (action === 'close') setDrawer(false, false);
  const chip = event.target.closest('[data-tag]');
  if (chip) {
    drawerTag = chip.dataset.tag;
    renderDrawer();
  }
});

els.drawer.addEventListener('input', (event) => {
  if (event.target.id === 'drawer-search') {
    drawerQuery = event.target.value;
    renderDrawerList();
  }
});

// ---------- 右键 / 更多菜单 ----------

function showMenu(html, x, y) {
  els.menu.innerHTML = html;
  els.menu.hidden = false;
  const rect = els.menu.getBoundingClientRect();
  els.menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))}px`;
  els.menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))}px`;
}

function menuItem(action, label, iconName, data = {}, extraClass = '') {
  const attrs = Object.entries(data).map(([key, value]) => `data-${key}="${escapeHtml(value)}"`).join(' ');
  return `<button type="button" class="${extraClass}" data-menu-action="${action}" ${attrs}>${iconName ? icon(iconName, 15) : '<span style="width:15px"></span>'}${escapeHtml(label)}</button>`;
}

function openItemMenu(kind, id, x, y) {
  const data = { kind, id };
  const parts = [
    menuItem('open-new', '在新标签页打开', 'external', data),
    menuItem('edit', '编辑…', 'edit', data),
  ];
  if (kind === 'shortcut' && state.groups.length > 1) {
    const shortcut = state.shortcuts.find((item) => item.id === id);
    parts.push('<hr><div class="menu-label">移动到</div>');
    state.groups
      .filter((group) => group.id !== groupOf(shortcut))
      .forEach((group) => parts.push(menuItem('move', group.name, group.icon, { ...data, group: group.id })));
  }
  parts.push('<hr>', menuItem('delete', '删除', 'trash', data, 'danger'));
  showMenu(parts.join(''), x, y);
}

function openGroupMenu(groupId, x, y) {
  const data = { kind: 'group', id: groupId };
  const parts = [menuItem('edit', '编辑分组…', 'edit', data)];
  if (groupId !== HOME_GROUP_ID) {
    parts.push('<hr>', menuItem('delete', '删除分组', 'trash', data, 'danger'));
  }
  showMenu(parts.join(''), x, y);
}

function closeMenu() {
  els.menu.hidden = true;
}

function findItem(kind, id) {
  const list = { shortcut: state.shortcuts, bookmark: state.bookmarks, group: state.groups }[kind] || [];
  return list.find((item) => item.id === id) || null;
}

async function deleteItem(kind, id) {
  const item = findItem(kind, id);
  if (!item) return;
  if (kind === 'shortcut') {
    const previousOrder = state.shortcuts.map((shortcut) => shortcut.id);
    await removeShortcut(id);
    showToast(`已删除「${item.name}」`, {
      label: '撤销',
      run: async () => {
        await upsertShortcut({ ...item });
        await reorderShortcuts(previousOrder);
      },
    });
  } else if (kind === 'bookmark') {
    await removeBookmark(id);
    showToast(`已删除「${item.title}」`, { label: '撤销', run: () => upsertBookmark({ ...item }) });
  } else if (kind === 'group') {
    const count = state.shortcuts.filter((shortcut) => shortcut.groupId === id).length;
    if (count && !window.confirm(`删除分组「${item.name}」？其中的 ${count} 个快捷方式会移回「主页」。`)) return;
    await removeGroup(id);
    if (activeGroupId === id) switchGroup(HOME_GROUP_ID);
  }
}

els.menu.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-menu-action]');
  if (!button) return;
  const { menuAction, kind, id, group } = button.dataset;
  closeMenu();
  const item = findItem(kind, id);
  if (!item) return;
  if (menuAction === 'open-new') {
    chrome.tabs.create({ url: item.url, active: false });
  } else if (menuAction === 'edit') {
    if (kind === 'shortcut') openShortcutDialog(id);
    else if (kind === 'bookmark') openBookmarkDialog(id);
    else openGroupDialog(id);
  } else if (menuAction === 'move') {
    state = await moveShortcutToGroup(id, group);
  } else if (menuAction === 'delete') {
    await deleteItem(kind, id);
  }
});

// ---------- 弹窗 ----------

function modalShell(title, body, submitLabel) {
  return `
    <div class="modal-backdrop" data-backdrop>
      <div class="modal material" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
        <h3>${escapeHtml(title)}</h3>
        <form class="modal-body" id="dialog-form" autocomplete="off">
          ${body}
          <p class="form-status" id="dialog-status"></p>
        </form>
        <div class="modal-foot">
          <button class="btn" type="button" data-close-modal>取消</button>
          <button class="btn btn-primary" type="submit" form="dialog-form">${escapeHtml(submitLabel)}</button>
        </div>
      </div>
    </div>`;
}

function setDialogStatus(message, isError = false) {
  const status = $('dialog-status');
  if (status) {
    status.textContent = message || '';
    status.classList.toggle('error', isError);
  }
}

function openShortcutDialog(shortcutId = null) {
  const shortcut = shortcutId ? findItem('shortcut', shortcutId) : null;
  dialog = {
    kind: 'shortcut',
    id: shortcut?.id || '',
    originalUrl: shortcut?.url || '',
    newIcon: null,
    iconMode: shortcut?.iconMode || 'auto',
  };

  els.modalRoot.innerHTML = modalShell(shortcut ? '编辑快捷方式' : '添加快捷方式', `
    <div class="icon-editor" id="dialog-icon-wrap">
      ${shortcut ? iconMarkup(shortcut, shortcut.name) : `<span class="app-icon is-full" data-icon-key="tmp:new"><img src="${createFallbackIconDataUrl('+')}" alt=""></span>`}
      <div class="icon-actions">
        <button class="btn btn-sm" type="button" id="dialog-pick-icon">选择图标…</button>
        <label class="btn btn-sm">上传图标…<input id="dialog-upload" type="file" accept="image/*" hidden></label>
      </div>
    </div>
    <div class="icon-picker" id="icon-picker" hidden></div>
    <label class="field"><span>网址</span><input id="dialog-url" type="text" value="${escapeHtml(shortcut?.url || '')}" placeholder="example.com" required></label>
    <label class="field"><span>名称</span><input id="dialog-name" type="text" value="${escapeHtml(shortcut?.name || '')}" placeholder="留空则使用域名"></label>
  `, shortcut ? '存储' : '添加');

  styleIcons($('dialog-icon-wrap'));
  $(shortcut ? 'dialog-name' : 'dialog-url').focus();
}

function setDialogIcon(dataUrl) {
  const holder = $('dialog-icon-wrap')?.querySelector('.app-icon');
  if (!holder) return;
  holder.dataset.iconKey = `tmp:${Date.now()}`;
  holder.querySelector('img').src = dataUrl;
  styleIcons($('dialog-icon-wrap'));
}

async function fetchDialogIcon() {
  const url = normalizeUrl($('dialog-url').value);
  if (!url) {
    setDialogStatus('请先填写网址。', true);
    return;
  }
  setDialogStatus('正在查找高清图标…');
  const result = await discoverIcon(url, $('dialog-name').value || getHostname(url));
  if (!dialog) return;
  dialog.newIcon = result;
  dialog.iconMode = 'auto';
  setDialogIcon(result.dataUrl);
  if (result.sourceUrl === 'fallback') {
    setDialogStatus('没找到站点图标，已使用文字图标。点「选择图标…」可以从 App Store 等来源挑一个。');
  } else if (result.width && result.width < 64) {
    setDialogStatus(`网站只提供了 ${result.width}px 的低清图标。点「选择图标…」可以从 App Store 等来源挑一个。`);
  } else {
    setDialogStatus('');
  }
}

// ---------- 图标选择面板：网站 / Google / icon.horse / DuckDuckGo / App Store ----------

const pickerResults = new Map();
let pickerSeq = 0;
let pickerToken = 0;

function pickerItem(result, caption, { remote = false } = {}) {
  const id = `pick${pickerSeq += 1}`;
  pickerResults.set(id, result);
  const size = result.width ? `${result.width}px` : '';
  const low = result.width && result.width < 64;
  const iconHtml = remote
    ? `<span class="app-icon is-full"><img src="${escapeHtml(result.remoteUrl)}" alt="" loading="lazy"></span>`
    : `<span class="app-icon" data-icon-key="tmp:${id}"><img src="${escapeHtml(result.dataUrl)}" alt=""></span>`;
  return `
    <button type="button" class="picker-item" data-pick="${id}" title="${escapeHtml(caption)}${size ? ` · ${size}` : ''}">
      ${iconHtml}
      <span class="picker-caption">${escapeHtml(caption)}</span>
      ${size ? `<span class="picker-size ${low ? 'low' : ''}">${low ? `${size} 低清` : size}</span>` : ''}
    </button>`;
}

async function loadWebCandidates(url) {
  const token = pickerToken;
  const grid = $('picker-web');
  const candidates = await listIconCandidates(url);
  const settled = await Promise.allSettled(candidates.map((candidate) => fetchImageAsDataUrl(candidate.url).then((result) => ({ ...result, source: candidate.source }))));
  if (token !== pickerToken || !grid.isConnected) return;
  const seen = new Set();
  const items = settled
    .filter((item) => item.status === 'fulfilled')
    .map((item) => item.value)
    .filter((item) => !seen.has(item.dataUrl) && seen.add(item.dataUrl))
    .sort((left, right) => (right.opaque ? 1000 : 0) + right.width - ((left.opaque ? 1000 : 0) + left.width));
  grid.innerHTML = items.length
    ? items.map((item) => pickerItem(item, item.source)).join('')
    : '<p class="picker-empty">网站和图标服务都没有返回可用图标。</p>';
  styleIcons(grid);
}

async function searchApps(term) {
  const token = pickerToken;
  const grid = $('picker-apps');
  grid.innerHTML = '<p class="picker-empty">正在搜索 App Store…</p>';
  try {
    const apps = await searchAppStoreIcons(term);
    if (token !== pickerToken || !grid.isConnected) return;
    grid.innerHTML = apps.length
      ? apps.map((app) => pickerItem({ remoteUrl: app.url, width: 512, opaque: true }, app.label, { remote: true })).join('')
      : '<p class="picker-empty">没有搜到相关 App，换个名称试试。</p>';
  } catch (error) {
    if (grid.isConnected) grid.innerHTML = `<p class="picker-empty">${escapeHtml(error.message || 'App Store 搜索失败')}</p>`;
  }
}

function openIconPicker() {
  const url = normalizeUrl($('dialog-url').value);
  if (!url) {
    setDialogStatus('请先填写网址。', true);
    return;
  }
  const picker = $('icon-picker');
  pickerToken += 1;
  pickerResults.clear();
  const term = $('dialog-name').value.trim() || getHostname(url).split('.').slice(-2, -1)[0] || '';
  picker.hidden = false;
  picker.innerHTML = `
    <h4>网站与图标服务</h4>
    <div class="picker-grid" id="picker-web"><p class="picker-empty">正在查找…</p></div>
    <h4>App Store</h4>
    <div class="pop-search">${icon('search', 13)}<input id="picker-app-query" type="text" value="${escapeHtml(term)}" placeholder="按 App 名称搜索，回车" enterkeyhint="search"></div>
    <div class="picker-grid" id="picker-apps"></div>`;
  setDialogStatus('');
  loadWebCandidates(url).catch(() => {});
  searchApps(term);
}

async function pickIcon(button) {
  let result = pickerResults.get(button.dataset.pick);
  if (!result || !dialog) return;
  if (!result.dataUrl && result.remoteUrl) {
    setDialogStatus('正在下载图标…');
    try {
      result = { ...(await fetchImageAsDataUrl(result.remoteUrl)), opaque: true };
    } catch (error) {
      setDialogStatus(`下载失败：${error.message}`, true);
      return;
    }
  }
  dialog.newIcon = result;
  dialog.iconMode = 'custom';
  setDialogIcon(result.dataUrl);
  $('icon-picker').querySelectorAll('.picker-item').forEach((item) => item.classList.toggle('selected', item === button));
  setDialogStatus('已选择，点「存储」生效。');
}

async function saveShortcutDialog() {
  const url = normalizeUrl($('dialog-url').value);
  if (!url) {
    throw new Error('网址不能为空。');
  }
  const name = $('dialog-name').value.trim() || getHostname(url) || '快捷方式';

  if (!dialog.id && state.shortcuts.some((shortcut) => shortcut.url === url)) {
    throw new Error('这个网址已经在快捷方式里了。');
  }

  let iconAssetId;
  if (dialog.newIcon) {
    const asset = await putAsset({
      dataUrl: dialog.newIcon.dataUrl,
      mimeType: dialog.newIcon.mimeType,
      sourceUrl: dialog.newIcon.sourceUrl === 'upload' ? 'upload' : url,
      rev: ICON_REV,
    });
    iconAssetId = asset.id;
  } else if (dialog.id && url !== dialog.originalUrl && dialog.iconMode === 'auto') {
    // 换了网址又没手动指定图标：清空，让页面重新抓。
    iconAssetId = null;
  }

  await upsertShortcut({
    id: dialog.id || undefined,
    name,
    url,
    groupId: dialog.id ? undefined : activeGroup().id,
    iconAssetId,
    iconMode: dialog.iconMode,
  });
}

function openBookmarkDialog(bookmarkId) {
  const bookmark = findItem('bookmark', bookmarkId);
  if (!bookmark) return;
  dialog = { kind: 'bookmark', id: bookmark.id };

  els.modalRoot.innerHTML = modalShell('编辑书签', `
    <label class="field"><span>标题</span><input id="dialog-title" type="text" value="${escapeHtml(bookmark.title)}" required></label>
    <label class="field"><span>网址</span><input id="dialog-url" type="text" value="${escapeHtml(bookmark.url)}" required></label>
    <label class="field"><span>标签（逗号分隔）</span><input id="dialog-tags" type="text" value="${escapeHtml((bookmark.tags || []).join(', '))}" placeholder="工作, AI, 工具"></label>
    <label class="field"><span>摘要</span><textarea id="dialog-summary" rows="2">${escapeHtml(bookmark.summary)}</textarea></label>
    <label class="field"><span>备注</span><input id="dialog-notes" type="text" value="${escapeHtml(bookmark.notes)}" placeholder="可留空"></label>
  `, '存储');

  $('dialog-title').focus();
}

async function saveBookmarkDialog() {
  const url = normalizeUrl($('dialog-url').value);
  if (!url) {
    throw new Error('网址不能为空。');
  }
  await upsertBookmark({
    id: dialog.id,
    title: $('dialog-title').value.trim() || getHostname(url),
    url,
    tags: $('dialog-tags').value.split(/[，,]/).map((tag) => tag.trim()).filter(Boolean).slice(0, 8),
    summary: $('dialog-summary').value.trim(),
    notes: $('dialog-notes').value.trim(),
  });
}

function openGroupDialog(groupId = null) {
  const group = groupId ? findItem('group', groupId) : null;
  dialog = { kind: 'group', id: group?.id || '', icon: group?.icon || 'folder' };
  els.modalRoot.innerHTML = modalShell(group ? '编辑分组' : '新建分组', `
    <label class="field"><span>名称</span><input id="dialog-group-name" type="text" maxlength="12" value="${escapeHtml(group?.name || '')}" placeholder="例如 AI、工作、学习" required></label>
    <div class="field"><span>图标</span>
      <div class="icon-grid" id="dialog-icons">${GROUP_ICONS.map((name) => `<button type="button" class="${name === dialog.icon ? 'active' : ''}" data-group-icon="${name}">${icon(name, 18)}</button>`).join('')}</div>
    </div>
  `, group ? '存储' : '创建');
  $('dialog-group-name').focus();
}

async function saveGroupDialog() {
  const name = $('dialog-group-name').value.trim();
  if (!name) {
    throw new Error('请填写分组名称。');
  }
  const previousIds = new Set(state.groups.map((group) => group.id));
  state = await upsertGroup({ id: dialog.id || undefined, name, icon: dialog.icon });
  if (!dialog.id) {
    const created = state.groups.find((group) => !previousIds.has(group.id));
    if (created) switchGroup(created.id);
  }
}

function closeDialog() {
  dialog = null;
  els.modalRoot.innerHTML = '';
}

let backdropPressed = false;
els.modalRoot.addEventListener('mousedown', (event) => {
  backdropPressed = event.target.hasAttribute?.('data-backdrop');
});

els.modalRoot.addEventListener('click', async (event) => {
  if ((backdropPressed && event.target.hasAttribute('data-backdrop')) || event.target.closest('[data-close-modal]')) {
    closeDialog();
    return;
  }
  const iconBtn = event.target.closest('[data-group-icon]');
  if (iconBtn && dialog) {
    dialog.icon = iconBtn.dataset.groupIcon;
    $('dialog-icons').querySelectorAll('button').forEach((button) => button.classList.toggle('active', button === iconBtn));
    return;
  }
  if (event.target.closest('#dialog-pick-icon')) {
    openIconPicker();
    return;
  }
  const pickBtn = event.target.closest('[data-pick]');
  if (pickBtn) {
    await pickIcon(pickBtn);
  }
});

els.modalRoot.addEventListener('change', async (event) => {
  if (event.target.id === 'dialog-upload' && event.target.files?.[0] && dialog) {
    const result = await readUploadedIcon(event.target.files[0]);
    dialog.newIcon = result;
    dialog.iconMode = 'custom';
    setDialogIcon(result.dataUrl);
    setDialogStatus('');
  }
});

// App Store 搜索框在弹窗表单里，回车只搜索，不提交弹窗。
els.modalRoot.addEventListener('keydown', (event) => {
  if (event.target.id === 'picker-app-query' && event.key === 'Enter') {
    event.preventDefault();
    searchApps(event.target.value);
  }
});

els.modalRoot.addEventListener('focusout', (event) => {
  // 新建快捷方式时，填完网址自动抓一次图标。
  if (event.target.id === 'dialog-url' && dialog?.kind === 'shortcut' && !dialog.id && !dialog.newIcon && event.target.value.trim()) {
    fetchDialogIcon().catch(() => {});
  }
});

els.modalRoot.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!dialog) return;
  const submit = els.modalRoot.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    if (dialog.kind === 'shortcut') await saveShortcutDialog();
    else if (dialog.kind === 'bookmark') await saveBookmarkDialog();
    else await saveGroupDialog();
    closeDialog();
  } catch (error) {
    setDialogStatus(error.message, true);
    submit.disabled = false;
  }
});

// ---------- 同步状态 ----------

function renderSync() {
  const configured = Boolean(state.settings.webdav.serverUrl);
  els.syncBtn.hidden = !configured;
  if (!configured) return;

  if (syncStatus.running) {
    els.syncBtn.innerHTML = icon('sync', 17, 'spin');
    els.syncBtn.title = '正在同步…';
  } else if (syncStatus.lastError) {
    els.syncBtn.innerHTML = `${icon('cloud', 17)}<span class="dot"></span>`;
    els.syncBtn.title = `同步失败：${syncStatus.lastError}\n点击重试`;
  } else {
    els.syncBtn.innerHTML = icon('cloud', 17);
    const mode = state.settings.webdav.autoSync ? '自动同步已开启' : '自动同步未开启';
    els.syncBtn.title = `${mode} · 上次同步 ${formatRelative(syncStatus.lastSyncAt)}\n点击立即同步`;
  }
}

async function syncNow() {
  const response = await chrome.runtime.sendMessage({ type: 'sync-now' });
  if (response?.ok) {
    showToast('同步完成');
  } else {
    showToast(`同步失败：${response?.error || '未知错误'}`, null, 6000);
  }
}

// ---------- 壁纸与外观 ----------

function applyAppearanceVars() {
  const { dim, blur } = state.settings.wallpaper;
  document.documentElement.style.setProperty('--dim', String(dim / 100));
  document.documentElement.style.setProperty('--blur', `${blur}px`);
}

function decodeImage(url) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = resolve;
    image.onerror = resolve;
    image.src = url;
  });
}

function renderCredit() {
  const credit = currentWallpaper?.credit;
  if (!credit) {
    els.credit.innerHTML = '';
    return;
  }
  if (credit.source === 'unsplash') {
    // Unsplash 要求署名常显：摄影师 + Unsplash，均带链接。
    els.credit.innerHTML = `
      <div class="credit credit-unsplash">
        ${credit.title ? `<strong>${escapeHtml(credit.title)}</strong>` : ''}
        <em>摄影 <a href="${escapeHtml(credit.authorUrl)}" target="_blank" rel="noreferrer">${escapeHtml(credit.author)}</a> · <a href="${escapeHtml(credit.unsplashUrl)}" target="_blank" rel="noreferrer">Unsplash</a></em>
      </div>`;
    return;
  }
  // Bing 的 copyright 形如「地点 (© 作者/图库)」
  const [place, rights = ''] = credit.copyright.split(/\s*[(（]©\s*/);
  const detail = [place, rights && `© ${rights.replace(/[)）]\s*$/, '')}`].filter(Boolean).join(' · ');
  const inner = `<strong>${escapeHtml(credit.title || place)}</strong><span>${escapeHtml(detail)}</span>`;
  els.credit.innerHTML = credit.link
    ? `<a class="credit" href="${escapeHtml(credit.link)}" target="_blank" rel="noreferrer" title="${escapeHtml(credit.copyright)}">${inner}</a>`
    : `<div class="credit" title="${escapeHtml(credit.copyright)}">${inner}</div>`;
}

function releaseWallpaper(result) {
  if (result?.url && !result.remote) URL.revokeObjectURL(result.url);
}

async function loadWallpaper({ advance = false } = {}) {
  const token = ++wallpaperToken;
  wallpaperLoading = true;
  if (!els.appearance.hidden) renderAppearance();
  const result = await resolveWallpaper(state.settings.wallpaper, { advance });
  wallpaperLoading = false;
  wallpaperError = result.error || '';
  if (token !== wallpaperToken) {
    releaseWallpaper(result);
    return;
  }
  if (result.kind === 'image') {
    await decodeImage(result.url);
    if (token !== wallpaperToken) {
      releaseWallpaper(result);
      return;
    }
  }

  const nextIndex = activeLayer === 0 ? 1 : 0;
  const next = els.wpLayers[nextIndex];
  next.style.backgroundImage = result.kind === 'image' ? `url("${result.url}")` : result.css;
  document.body.style.setProperty('--wp-color', result.color || '#26282e');
  next.classList.remove('is-hidden');
  if (activeLayer >= 0) {
    els.wpLayers[activeLayer].classList.add('is-hidden');
  }
  const previous = currentWallpaper;
  activeLayer = nextIndex;
  currentWallpaper = result;
  renderCredit();
  if (!els.appearance.hidden) renderAppearance();
  if (previous) {
    setTimeout(() => releaseWallpaper(previous), 1200);
  }
}

function wallpaperNav(title, subtitle) {
  return `
    <div class="wp-nav">
      <button class="round-btn" type="button" data-wp-step="-1" aria-label="上一张">${icon('chevronLeft', 15)}</button>
      <div class="meta"><b>${escapeHtml(title)}</b>${escapeHtml(subtitle)}</div>
      <button class="round-btn" type="button" data-wp-step="1" aria-label="下一张">${wallpaperLoading ? icon('sync', 15, 'spin') : icon('chevronRight', 15)}</button>
    </div>`;
}

function unsplashSection(settings) {
  if (!settings.unsplashKey) {
    return `
      <p class="pop-note">使用 Unsplash 需要先在设置里填写 Access Key。</p>
      <a class="btn btn-block" href="options.html?returnTo=tab#unsplash">去设置填写</a>`;
  }
  const credit = currentWallpaper?.credit?.source === 'unsplash' ? currentWallpaper.credit : null;
  const isTopic = settings.unsplashQuery.startsWith('topic:');
  return `
    ${wallpaperError ? `<p class="pop-note error">${escapeHtml(wallpaperError)}</p>` : wallpaperNav(credit?.title || (credit ? `摄影 ${credit.author}` : '加载中…'), currentWallpaper?.position || '')}
    <div class="pop-chips">${UNSPLASH_TOPICS.map(([value, label]) => `<button type="button" class="tag-chip ${value === settings.unsplashQuery ? 'active' : ''}" data-unsplash-query="${value}">${label}</button>`).join('')}</div>
    <form class="pop-search" id="unsplash-form">
      ${icon('search', 13)}<input id="unsplash-query" type="text" placeholder="自定义关键词，如 mountain、city night" value="${isTopic ? '' : escapeHtml(settings.unsplashQuery)}">
    </form>
    <div class="range-row" style="margin-top:10px"><span>换图</span><div class="seg">
      <button type="button" class="${settings.unsplashRotate === 'daily' ? 'active' : ''}" data-unsplash-rotate="daily">每天一张</button>
      <button type="button" class="${settings.unsplashRotate === 'tab' ? 'active' : ''}" data-unsplash-rotate="tab">每次打开</button>
    </div></div>`;
}

function renderAppearance() {
  const settings = state.settings.wallpaper;
  const { mode, presetId, dim, blur } = settings;
  const modes = [['bing', 'Bing'], ['unsplash', 'Unsplash'], ['custom', '本地'], ['preset', '内置']];
  let modeSection = '';

  if (mode === 'bing') {
    const credit = currentWallpaper?.credit?.source ? null : currentWallpaper?.credit;
    modeSection = wallpaperNav(credit?.title || 'Bing 每日一图', currentWallpaper?.position || '');
  } else if (mode === 'unsplash') {
    modeSection = unsplashSection(settings);
  } else if (mode === 'custom') {
    modeSection = `<label class="btn btn-block">${icon('upload', 14)}选择图片…<input id="wp-upload" type="file" accept="image/*" hidden></label>`;
  } else {
    modeSection = `<div class="swatches">${WALLPAPER_PRESETS.map((preset) => `
      <button class="swatch ${preset.id === presetId ? 'active' : ''}" type="button" data-preset="${preset.id}" title="${escapeHtml(preset.name)}" style="background-image:${preset.css}"></button>`).join('')}</div>`;
  }

  els.appearance.innerHTML = `
    <h3 class="pop-title">外观</h3>
    <div class="seg" role="tablist">${modes.map(([key, label]) => `<button type="button" class="${key === mode ? 'active' : ''}" data-wp-mode="${key}">${label}</button>`).join('')}</div>
    <div class="pop-section">${modeSection}</div>
    <div class="pop-section">
      <div class="range-row"><span>遮罩</span><input type="range" min="0" max="60" value="${dim}" data-range="dim"><output>${dim}%</output></div>
      <div class="range-row"><span>模糊</span><input type="range" min="0" max="20" value="${blur}" data-range="blur"><output>${blur}</output></div>
      <div class="range-row"><span>图标</span><div class="seg">${GRID_SIZES.map(([key, label]) => `<button type="button" class="${key === state.settings.gridSize ? 'active' : ''}" data-grid="${key}">${label}</button>`).join('')}</div></div>
    </div>`;
}

function toggleAppearance(open = els.appearance.hidden) {
  els.appearance.hidden = !open;
  els.appearanceBtn.classList.toggle('is-active', open);
  if (open) renderAppearance();
}

async function saveWallpaperSettings(patch) {
  state = await patchSettings({ wallpaper: patch });
}

els.appearance.addEventListener('click', async (event) => {
  const modeBtn = event.target.closest('[data-wp-mode]');
  if (modeBtn) {
    await saveWallpaperSettings({ mode: modeBtn.dataset.wpMode });
    renderAppearance();
    await loadWallpaper();
    return;
  }
  const stepBtn = event.target.closest('[data-wp-step]');
  if (stepBtn) {
    if (wallpaperLoading) return;
    const delta = Number(stepBtn.dataset.wpStep);
    if (state.settings.wallpaper.mode === 'unsplash') {
      await loadWallpaper({ advance: delta });
    } else {
      await stepBingWallpaper(delta);
      await loadWallpaper();
    }
    return;
  }
  const queryBtn = event.target.closest('[data-unsplash-query]');
  if (queryBtn) {
    await saveWallpaperSettings({ unsplashQuery: queryBtn.dataset.unsplashQuery });
    renderAppearance();
    await loadWallpaper();
    return;
  }
  const rotateBtn = event.target.closest('[data-unsplash-rotate]');
  if (rotateBtn) {
    await saveWallpaperSettings({ unsplashRotate: rotateBtn.dataset.unsplashRotate });
    renderAppearance();
    return;
  }
  const presetBtn = event.target.closest('[data-preset]');
  if (presetBtn) {
    await saveWallpaperSettings({ presetId: presetBtn.dataset.preset });
    renderAppearance();
    await loadWallpaper();
    return;
  }
  const gridBtn = event.target.closest('[data-grid]');
  if (gridBtn) {
    state = await patchSettings({ gridSize: gridBtn.dataset.grid });
    renderAppearance();
    renderShortcuts();
  }
});

els.appearance.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (event.target.id !== 'unsplash-form') return;
  const query = $('unsplash-query').value.trim();
  if (!query) return;
  await saveWallpaperSettings({ unsplashQuery: query });
  renderAppearance();
  await loadWallpaper();
});

els.appearance.addEventListener('input', (event) => {
  const key = event.target.dataset.range;
  if (!key) return;
  const value = Number(event.target.value);
  event.target.nextElementSibling.textContent = key === 'dim' ? `${value}%` : String(value);
  if (key === 'dim') document.documentElement.style.setProperty('--dim', String(value / 100));
  if (key === 'blur') document.documentElement.style.setProperty('--blur', `${value}px`);
});

els.appearance.addEventListener('change', async (event) => {
  const key = event.target.dataset.range;
  if (key) {
    await saveWallpaperSettings({ [key]: Number(event.target.value) });
    return;
  }
  if (event.target.id === 'wp-upload' && event.target.files?.[0]) {
    try {
      await saveCustomWallpaper(event.target.files[0]);
      await loadWallpaper();
    } catch (error) {
      showToast(error.message || '图片读取失败');
    }
  }
});

// ---------- 图标补抓与升级 ----------

function needsIcon(item) {
  const record = assets[item.iconAssetId];
  if (!record) return true;
  // 旧版本抓到的小图标自动换成高清的（手动上传的不动）。
  return item.iconMode !== 'custom' && record.sourceUrl !== 'upload' && (record.rev || 1) < ICON_REV;
}

async function runHydrate() {
  const targets = [
    ...state.shortcuts.map((item) => ({ list: 'shortcuts', item, label: item.name })),
    ...state.bookmarks.map((item) => ({ list: 'bookmarks', item, label: item.title })),
  ].filter(({ item }) => needsIcon(item));

  for (const target of targets) {
    try {
      const result = await discoverIcon(target.item.url, target.label);
      const asset = await putAsset({ dataUrl: result.dataUrl, mimeType: result.mimeType || 'image/png', sourceUrl: target.item.url, rev: ICON_REV });
      await setItemIcon(target.list, target.item.id, asset.id);
    } catch (error) {
      console.warn('GlassTab icon hydration failed:', error);
    }
  }
}

function hydrateMissingIcons() {
  if (!navigator.locks) {
    return runHydrate();
  }
  // 多个新标签页同时打开时，只让一个去抓。
  return navigator.locks.request('glasstab-icon-hydrate', { ifAvailable: true }, (lock) => (lock ? runHydrate() : null));
}

// ---------- 全局事件 ----------

document.addEventListener('click', (event) => {
  const moreBtn = event.target.closest('[data-menu]');
  if (moreBtn) {
    event.preventDefault();
    event.stopPropagation();
    const rect = moreBtn.getBoundingClientRect();
    openItemMenu(moreBtn.dataset.menu, moreBtn.dataset.id, rect.right - 190, rect.bottom + 4);
    return;
  }

  // 用派发时的事件路径判断“点在外面”：处理函数里可能已经重绘，event.target 会脱离文档。
  const path = event.composedPath();
  const inside = (...nodes) => nodes.some((node) => path.includes(node));
  if (!inside(els.menu)) closeMenu();
  if (!inside(els.searchForm)) setEngineMenu(false);
  if (!inside(els.appearance, els.appearanceBtn) && !els.appearance.hidden) toggleAppearance(false);
  if (drawerOpen && !drawerPinned && !inside(els.drawer, els.drawerBtn, els.menu, els.modalRoot)) {
    setDrawer(false);
  }

  const groupBtn = event.target.closest('[data-group]');
  if (groupBtn) switchGroup(groupBtn.dataset.group);

  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'add-shortcut') openShortcutDialog();
  if (action === 'add-group') openGroupDialog();
});

document.addEventListener('contextmenu', (event) => {
  const group = event.target.closest('[data-group]');
  if (group) {
    event.preventDefault();
    openGroupMenu(group.dataset.group, event.clientX, event.clientY);
    return;
  }
  const item = event.target.closest('[data-kind][data-id]');
  if (!item) return;
  event.preventDefault();
  openItemMenu(item.dataset.kind, item.dataset.id, event.clientX, event.clientY);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (!els.menu.hidden) return closeMenu();
    if (dialog) return closeDialog();
    if (!els.appearance.hidden) return toggleAppearance(false);
    if (!els.engineMenu.hidden) return setEngineMenu(false);
    if (drawerOpen && !drawerPinned) return setDrawer(false);
    return undefined;
  }
  // ⌘K / Ctrl+K：聚焦搜索框
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !dialog) {
    event.preventDefault();
    els.searchInput.focus();
    els.searchInput.select();
    return undefined;
  }
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  if (typing || dialog || event.metaKey || event.ctrlKey || event.altKey) return undefined;
  if (event.key === '/' || event.key.length === 1) {
    if (event.key === '/') event.preventDefault();
    els.searchInput.focus();
  }
  return undefined;
});

els.engineBtn.addEventListener('click', () => setEngineMenu(els.engineMenu.hidden));

els.engineMenu.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-engine]');
  if (!button) return;
  setEngineMenu(false);
  state = await patchSettings({ searchEngine: button.dataset.engine });
  renderEngine();
  els.searchInput.focus();
});

els.searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  runSearch(els.searchInput.value.trim());
});

els.syncBtn.addEventListener('click', () => {
  syncNow().catch((error) => showToast(error.message));
});

els.drawerBtn.addEventListener('click', () => {
  if (drawerOpen) setDrawer(false, false);
  else setDrawer(true);
});

els.appearanceBtn.addEventListener('click', () => toggleAppearance());

chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName !== 'local') return;
  if (changes[SYNC_STATUS_KEY]) {
    syncStatus = changes[SYNC_STATUS_KEY].newValue || {};
    renderSync();
  }
  if (changes[STORAGE_KEY]) {
    const previousWallpaper = state.settings.wallpaper;
    await refreshData();
    queueRender();
    const next = state.settings.wallpaper;
    const wallpaperSourceChanged = ['mode', 'presetId', 'unsplashKey', 'unsplashQuery'].some((key) => previousWallpaper[key] !== next[key]);
    if (!dragId && wallpaperSourceChanged) {
      loadWallpaper();
    }
    hydrateMissingIcons();
  }
});

// ---------- 启动 ----------

function readLegacyData() {
  return {
    shortcuts: safeJsonParse(localStorage.getItem('shortcuts'), []),
    searchEngines: safeJsonParse(localStorage.getItem('search_engines'), []),
    gridSize: localStorage.getItem('grid_size') || '',
  };
}

els.drawerBtn.innerHTML = icon('sidebarRight', 17);
$('settings-btn').innerHTML = icon('settings', 17);
els.appearanceBtn.innerHTML = icon('image', 17);
$('search-icon').innerHTML = icon('search', 18);

state = await migrateLegacyLocalData(readLegacyData());
palette = createPalette({
  form: els.searchForm,
  input: els.searchInput,
  getState: () => state,
  iconMarkup,
  onWebSearch: runSearch,
});
syncStatus = (await chrome.storage.local.get(SYNC_STATUS_KEY))[SYNC_STATUS_KEY] || {};
updateClock();
setInterval(updateClock, 1000);
applyAppearanceVars();
renderEngine();
renderDock();
renderShortcuts();
renderDrawer();
renderSync();

loadWallpaper({ advance: 'auto' })
  .then(async () => {
    if (state.settings.wallpaper.mode === 'bing' && (await refreshBingIfStale())) {
      await loadWallpaper();
    }
  })
  .catch((error) => console.warn(error));

chrome.runtime.sendMessage({ type: 'sync-if-stale' }).catch(() => {});
hydrateMissingIcons();
