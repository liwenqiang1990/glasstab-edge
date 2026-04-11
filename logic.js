import { SEARCH_ENGINES } from './shared/constants.js';
import { listAssetsMap, putAsset } from './shared/assets.js';
import { createFallbackIconDataUrl, discoverIcon, readUploadedIcon } from './shared/favicon.js';
import { getState, migrateLegacyLocalData, patchSettings, removeBookmark, removeShortcut, upsertBookmark, upsertShortcut } from './shared/storage.js';
import { escapeHtml, getHostname, normalizeUrl, safeJsonParse } from './shared/utils.js';

const root = document.getElementById('root');
const gridOrder = ['compact', 'standard', 'comfortable'];
const BOOKMARK_COLLAPSED_COUNT = 6;

let state = await getState();
let assetsMap = await listAssetsMap();
let wallpaper = generateWallpaper();
let shortcutDialog = null;
let bookmarkDialog = null;
let bookmarksExpanded = false;
const iconTasks = new Set();

function generateWallpaper() {
  const baseHue = Math.floor(Math.random() * 360);
  const color1 = `hsl(${baseHue}, 70%, 30%)`;
  const color2 = `hsl(${(baseHue + 38) % 360}, 75%, 58%)`;
  const color3 = `hsl(${(baseHue + 170) % 360}, 72%, 62%)`;
  const color4 = `hsl(${(baseHue + 286) % 360}, 78%, 52%)`;
  return [
    `radial-gradient(120% 100% at 10% 10%, rgba(255,255,255,0.16) 0%, transparent 42%)`,
    `radial-gradient(120% 100% at 88% 112%, ${color4} 8%, transparent 56%)`,
    `radial-gradient(120% 100% at 16% 110%, ${color3} 10%, transparent 58%)`,
    `radial-gradient(100% 100% at 62% 126%, ${color2} 0%, transparent 54%)`,
    `linear-gradient(180deg, ${color1} 0%, hsl(${baseHue}, 48%, 16%) 100%)`,
  ].join(',');
}

function readLegacyData() {
  return {
    shortcuts: safeJsonParse(localStorage.getItem('shortcuts'), []),
    searchEngines: safeJsonParse(localStorage.getItem('search_engines'), []),
    gridSize: localStorage.getItem('grid_size') || '',
  };
}

async function refreshState() {
  state = await getState();
  assetsMap = await listAssetsMap();
}

function gridLabel(gridSize) {
  if (gridSize === 'compact') return 'Compact';
  if (gridSize === 'comfortable') return 'Comfort';
  return 'Standard';
}

function iconFor(item, label) {
  return assetsMap[item.iconAssetId] || createFallbackIconDataUrl(label);
}

function visibleBookmarks() {
  if (bookmarksExpanded || state.bookmarks.length <= BOOKMARK_COLLAPSED_COUNT) {
    return state.bookmarks;
  }
  return state.bookmarks.slice(0, BOOKMARK_COLLAPSED_COUNT);
}

function renderSearchCard(engineKey, index) {
  const engine = SEARCH_ENGINES[engineKey] || SEARCH_ENGINES.baidu;
  return `
    <form class="search-form" data-form="search" data-index="${index}">
      <select data-role="engine" data-index="${index}">
        ${Object.entries(SEARCH_ENGINES)
          .map(([key, value]) => `<option value="${key}" ${key === engineKey ? 'selected' : ''}>${escapeHtml(value.label)}</option>`)
          .join('')}
      </select>
      <input type="text" placeholder="搜索 ${escapeHtml(engine.name)}" data-role="query">
    </form>
  `;
}

function renderShortcuts() {
  return state.shortcuts
    .map((shortcut) => `
      <article class="shortcut-card" data-action="open-shortcut" data-id="${shortcut.id}">
        <div class="shortcut-tools">
          <button class="mini-btn" type="button" data-action="edit-shortcut" data-id="${shortcut.id}" title="编辑">✎</button>
          <button class="mini-btn" type="button" data-action="delete-shortcut" data-id="${shortcut.id}" title="删除">×</button>
        </div>
        <div class="shortcut-icon">
          <img src="${iconFor(shortcut, shortcut.name)}" alt="${escapeHtml(shortcut.name)}">
        </div>
        <div class="shortcut-name">${escapeHtml(shortcut.name)}</div>
      </article>
    `)
    .join('');
}

function renderBookmarks() {
  if (!state.bookmarks.length) {
    return `
      <div class="empty-state">
        还没有书签。浏览网页时点击扩展图标，就可以把当前页面加入 GlassTab 书签；如果开启 AI，也可以在加入书签时顺手生成一句话摘要。
      </div>
    `;
  }

  return visibleBookmarks()
    .map((bookmark) => `
      <article class="bookmark-card" data-action="open-bookmark" data-id="${bookmark.id}">
        <div class="bookmark-tools">
          <button class="mini-btn" type="button" data-action="edit-bookmark" data-id="${bookmark.id}" title="编辑">✎</button>
          <button class="mini-btn" type="button" data-action="delete-bookmark" data-id="${bookmark.id}" title="删除">×</button>
        </div>
        <div class="bookmark-icon">
          <img src="${iconFor(bookmark, bookmark.title)}" alt="${escapeHtml(bookmark.title)}">
        </div>
        <div>
          <p class="bookmark-headline">
            <span class="bookmark-title">${escapeHtml(bookmark.title)}</span>
            <span class="bookmark-site-inline">${escapeHtml(getHostname(bookmark.url))}</span>
          </p>
          <p class="bookmark-summary-inline" title="${escapeHtml(bookmark.summary || bookmark.notes || '暂无摘要')}">
            ${escapeHtml(bookmark.summary || bookmark.notes || ((bookmark.tags || []).join(' / ') || '暂无摘要'))}
          </p>
        </div>
      </article>
    `)
    .join('');
}

function renderShortcutDialog() {
  if (!shortcutDialog) {
    return '';
  }

  const previewSrc =
    shortcutDialog.previewDataUrl ||
    createFallbackIconDataUrl(shortcutDialog.name || shortcutDialog.url || 'G');

  return `
    <div class="modal-overlay" data-action="close-dialog">
      <div class="modal-card" data-action="noop" data-stop-propagation="true">
        <div class="modal-head">
          <strong>${shortcutDialog.mode === 'edit' ? '编辑 Shortcut' : '新增 Shortcut'}</strong>
          <button class="mini-btn" type="button" data-action="close-dialog">×</button>
        </div>
        <form class="modal-body" id="shortcut-form">
          <label>
            名称
            <input id="shortcut-name" type="text" value="${escapeHtml(shortcutDialog.name)}" required>
          </label>
          <label>
            URL
            <input id="shortcut-url" type="text" value="${escapeHtml(shortcutDialog.url)}" placeholder="https://example.com" required>
          </label>
          <div class="preview-row">
            <div class="preview-box">
              <img src="${previewSrc}" alt="preview" id="shortcut-preview-image">
            </div>
            <div style="display:grid; gap:10px;">
              <div>
                <button class="ghost-btn" type="button" data-action="fetch-shortcut-icon">自动获取 logo</button>
              </div>
              <div>
                <label class="ghost-btn" style="display:inline-flex; align-items:center; gap:8px; cursor:pointer;">
                  上传自定义 logo
                  <input id="shortcut-upload" class="hidden" type="file" accept="image/*">
                </label>
              </div>
            </div>
          </div>
          <div class="status-line" id="shortcut-dialog-status">${escapeHtml(shortcutDialog.status || '')}</div>
        </form>
        <div class="modal-actions">
          <button class="ghost-btn" type="button" data-action="close-dialog">取消</button>
          <button class="primary-btn" type="submit" form="shortcut-form">${shortcutDialog.mode === 'edit' ? '保存修改' : '添加 Shortcut'}</button>
        </div>
      </div>
    </div>
  `;
}

function openBookmarkDialog(bookmarkId) {
  const bookmark = state.bookmarks.find((item) => item.id === bookmarkId);
  if (!bookmark) {
    return;
  }

  bookmarkDialog = {
    id: bookmark.id,
    title: bookmark.title || '',
    tagsText: (bookmark.tags || []).join(', '),
    notes: bookmark.notes || '',
    summary: bookmark.summary || '',
    status: '',
  };
  render();
}

function closeBookmarkDialog() {
  bookmarkDialog = null;
  render();
}

function renderBookmarkDialog() {
  if (!bookmarkDialog) {
    return '';
  }

  return `
    <div class="modal-overlay" data-action="close-bookmark-dialog">
      <div class="modal-card" data-action="noop" data-stop-propagation="true">
        <div class="modal-head">
          <strong>编辑书签</strong>
          <button class="mini-btn" type="button" data-action="close-bookmark-dialog">×</button>
        </div>
        <form class="modal-body" id="bookmark-form">
          <label>
            标题
            <input id="bookmark-title-input" type="text" value="${escapeHtml(bookmarkDialog.title)}" required>
          </label>
          <label>
            标签
            <input id="bookmark-tags-input" type="text" value="${escapeHtml(bookmarkDialog.tagsText)}" placeholder="例如 工作, AI, 工具">
          </label>
          <label>
            备注
            <input id="bookmark-notes-input" type="text" value="${escapeHtml(bookmarkDialog.notes)}" placeholder="可留空">
          </label>
          <div class="status-line">${escapeHtml(bookmarkDialog.summary || '')}</div>
          <div class="status-line">${escapeHtml(bookmarkDialog.status || '')}</div>
        </form>
        <div class="modal-actions">
          <button class="ghost-btn" type="button" data-action="close-bookmark-dialog">取消</button>
          <button class="primary-btn" type="submit" form="bookmark-form">保存书签</button>
        </div>
      </div>
    </div>
  `;
}

function render() {
  const hiddenBookmarkCount = Math.max(0, state.bookmarks.length - BOOKMARK_COLLAPSED_COUNT);
  root.innerHTML = `
    <div class="app-shell">
      <div class="wallpaper" style="background:${wallpaper}"></div>
      <div class="overlay"></div>

      <div class="toolbar">
        <div class="brand">
          <h1 class="brand-title">GlassTab</h1>
          <p class="brand-subtitle">本地化 Shortcut、书签、AI 摘要、WebDAV 备份。</p>
        </div>
        <div class="toolbar-actions">
          <button class="ghost-btn" type="button" data-action="open-options">打开设置</button>
          <button class="primary-btn" type="button" data-action="open-shortcut-dialog">新增 Shortcut</button>
        </div>
      </div>

      <section class="hero">
        <h2 class="time-text" id="time-text"></h2>
        <p class="date-text" id="date-text"></p>
      </section>

      <section class="search-grid">
        ${state.settings.searchEngines.map((engineKey, index) => renderSearchCard(engineKey, index)).join('')}
      </section>

      <section class="panel">
        <div class="panel-head">
          <div>
            <h2 class="panel-title">Shortcut</h2>
            <p class="panel-subtitle">logo 自动落本地；如果自动结果不符合要求，可以直接编辑并上传覆盖。</p>
          </div>
          <div class="status-line">当前布局: ${gridLabel(state.settings.gridSize)}</div>
        </div>
        <div class="shortcut-grid grid-${state.settings.gridSize}">
          ${renderShortcuts()}
          <article class="shortcut-card add-card" data-action="open-shortcut-dialog">
            <div class="shortcut-icon">
              <div style="font-size:32px;">＋</div>
            </div>
            <div class="shortcut-name">添加</div>
          </article>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <div>
            <h2 class="panel-title">书签</h2>
            <p class="panel-subtitle">在浏览网页时点击扩展图标即可添加书签，并可直接生成一句话 AI 摘要。</p>
          </div>
          <div style="display:flex; gap:10px; flex-wrap:wrap;">
            <button class="ghost-btn" type="button" data-action="open-bookmarks-page">书签页面</button>
            ${state.bookmarks.length > BOOKMARK_COLLAPSED_COUNT ? `
            <button class="ghost-btn" type="button" data-action="toggle-bookmarks">
              ${bookmarksExpanded ? '收起书签' : `展开全部 (${hiddenBookmarkCount} 条隐藏)`}
            </button>
            ` : ''}
          </div>
        </div>
        <div class="bookmark-list">
          ${renderBookmarks()}
        </div>
      </section>

      <div class="floating-footer">
        <button class="ghost-btn" type="button" data-action="refresh-wallpaper">换壁纸</button>
        <button class="ghost-btn" type="button" data-action="toggle-grid">网格: ${gridLabel(state.settings.gridSize)}</button>
        <button class="ghost-btn" type="button" data-action="open-options">WebDAV / AI</button>
      </div>

      ${renderShortcutDialog()}
      ${renderBookmarkDialog()}
    </div>
  `;

  updateClock();
}

function updateClock() {
  const timeEl = document.getElementById('time-text');
  const dateEl = document.getElementById('date-text');
  if (!timeEl || !dateEl) {
    return;
  }

  const now = new Date();
  timeEl.textContent = now.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  dateEl.textContent = now.toLocaleDateString([], {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function openShortcutDialog(shortcutId = null) {
  const shortcut = state.shortcuts.find((item) => item.id === shortcutId);
  shortcutDialog = {
    mode: shortcut ? 'edit' : 'create',
    id: shortcut?.id || '',
    name: shortcut?.name || '',
    url: shortcut?.url || '',
    iconAssetId: shortcut?.iconAssetId || null,
    previewDataUrl: shortcut?.iconAssetId ? assetsMap[shortcut.iconAssetId] : '',
    iconMode: shortcut?.iconMode || 'auto',
    status: '',
  };
  render();
}

function closeShortcutDialog() {
  shortcutDialog = null;
  render();
}

async function saveBookmarkDialog() {
  if (!bookmarkDialog) {
    return;
  }

  const sourceBookmark = state.bookmarks.find((item) => item.id === bookmarkDialog.id);
  if (!sourceBookmark) {
    throw new Error('书签不存在。');
  }

  const tags = bookmarkDialog.tagsText
    .split(/[，,]/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 8);

  await upsertBookmark({
    ...sourceBookmark,
    title: bookmarkDialog.title.trim() || sourceBookmark.title,
    notes: bookmarkDialog.notes.trim(),
    tags,
  });

  bookmarkDialog = null;
  await refreshState();
  render();
  chrome.runtime.sendMessage({ type: 'schedule-auto-backup' }).catch(() => {});
}

async function saveShortcutDialog() {
  const name = normalizeUrl(shortcutDialog.url) ? (shortcutDialog.name || getHostname(shortcutDialog.url) || '快捷方式') : shortcutDialog.name;
  const url = normalizeUrl(shortcutDialog.url);

  if (!url) {
    throw new Error('Shortcut URL 不能为空。');
  }

  let previewDataUrl = shortcutDialog.previewDataUrl;
  if (!previewDataUrl) {
    const fallbackName = shortcutDialog.name || getHostname(url) || 'G';
    previewDataUrl = createFallbackIconDataUrl(fallbackName);
  }

  const mimeTypeMatch = /^data:([^;]+);/i.exec(previewDataUrl);
  const asset = await putAsset({
    dataUrl: previewDataUrl,
    mimeType: mimeTypeMatch?.[1] || 'image/png',
    sourceUrl: url,
  });

  await upsertShortcut({
    id: shortcutDialog.id || undefined,
    name,
    url,
    iconAssetId: asset.id,
    iconMode: shortcutDialog.iconMode,
  });

  shortcutDialog = null;
  await refreshState();
  render();
  chrome.runtime.sendMessage({ type: 'schedule-auto-backup' }).catch(() => {});
}

async function fetchShortcutIcon() {
  if (!shortcutDialog) {
    return;
  }
  if (!shortcutDialog.url.trim()) {
    throw new Error('请先填写站点 URL。');
  }

  shortcutDialog.status = '正在自动抓取 logo...';
  render();

  const icon = await discoverIcon(shortcutDialog.url || '', shortcutDialog.name || getHostname(shortcutDialog.url || ''));
  shortcutDialog.previewDataUrl = icon.dataUrl;
  shortcutDialog.iconMode = 'auto';
  shortcutDialog.status = '已自动获取并预览 logo，保存后会落本地。';
  render();
}

async function hydrateMissingIcons() {
  const targets = [
    ...state.shortcuts.map((item) => ({ list: 'shortcuts', item, label: item.name })),
    ...state.bookmarks.map((item) => ({ list: 'bookmarks', item, label: item.title })),
  ];

  for (const target of targets) {
    if (target.item.iconAssetId && assetsMap[target.item.iconAssetId]) {
      continue;
    }
    if (iconTasks.has(target.item.id)) {
      continue;
    }

    iconTasks.add(target.item.id);
    try {
      const icon = await discoverIcon(target.item.url, target.label);
      const asset = await putAsset({
        dataUrl: icon.dataUrl,
        mimeType: icon.mimeType || 'image/png',
        sourceUrl: target.item.url,
      });

      if (target.list === 'shortcuts') {
        await upsertShortcut({
          ...target.item,
          iconAssetId: asset.id,
          iconMode: target.item.iconMode || 'auto',
        });
      } else {
        await upsertBookmark({
          ...target.item,
          iconAssetId: asset.id,
        });
      }

      await refreshState();
      render();
    } catch (error) {
      console.error('GlassTab icon hydration failed:', error);
    } finally {
      iconTasks.delete(target.item.id);
    }
  }
}

root.addEventListener('click', async (event) => {
  const target = event.target;
  const actionEl = target.closest('[data-action]');
  if (!actionEl) {
    return;
  }

  if (actionEl.dataset.stopPropagation === 'true') {
    event.stopPropagation();
    return;
  }

  const { action, id } = actionEl.dataset;

  if (action !== 'open-shortcut' && action !== 'open-bookmark') {
    event.preventDefault();
  }

  switch (action) {
    case 'noop':
      break;
    case 'open-options':
      window.location.href = chrome.runtime.getURL('options.html?returnTo=tab');
      break;
    case 'open-bookmarks-page':
      window.location.href = chrome.runtime.getURL('bookmarks.html');
      break;
    case 'refresh-wallpaper':
      wallpaper = generateWallpaper();
      render();
      break;
    case 'toggle-grid': {
      const index = gridOrder.indexOf(state.settings.gridSize);
      const nextGrid = gridOrder[(index + 1) % gridOrder.length];
      await patchSettings({ gridSize: nextGrid });
      await refreshState();
      render();
      break;
    }
    case 'toggle-bookmarks':
      bookmarksExpanded = !bookmarksExpanded;
      render();
      break;
    case 'edit-bookmark':
      openBookmarkDialog(id);
      break;
    case 'open-shortcut-dialog':
      openShortcutDialog();
      break;
    case 'edit-shortcut':
      openShortcutDialog(id);
      break;
    case 'delete-shortcut':
      await removeShortcut(id);
      await refreshState();
      render();
      chrome.runtime.sendMessage({ type: 'schedule-auto-backup' }).catch(() => {});
      break;
    case 'open-shortcut': {
      const shortcut = state.shortcuts.find((item) => item.id === id);
      if (shortcut?.url) {
        window.location.href = shortcut.url;
      }
      break;
    }
    case 'open-bookmark': {
      const bookmark = state.bookmarks.find((item) => item.id === id);
      if (bookmark?.url) {
        window.location.href = bookmark.url;
      }
      break;
    }
    case 'delete-bookmark':
      await removeBookmark(id);
      await refreshState();
      render();
      chrome.runtime.sendMessage({ type: 'schedule-auto-backup' }).catch(() => {});
      break;
    case 'close-bookmark-dialog':
      closeBookmarkDialog();
      break;
    case 'close-dialog':
      closeShortcutDialog();
      break;
    case 'fetch-shortcut-icon':
      try {
        await fetchShortcutIcon();
      } catch (error) {
        shortcutDialog.status = error.message;
        render();
      }
      break;
    default:
      break;
  }
});

root.addEventListener('input', (event) => {
  const target = event.target;
  if (shortcutDialog && target.id === 'shortcut-name') {
    shortcutDialog.name = target.value;
  }
  if (shortcutDialog && target.id === 'shortcut-url') {
    shortcutDialog.url = target.value;
  }
  if (bookmarkDialog && target.id === 'bookmark-title-input') {
    bookmarkDialog.title = target.value;
  }
  if (bookmarkDialog && target.id === 'bookmark-tags-input') {
    bookmarkDialog.tagsText = target.value;
  }
  if (bookmarkDialog && target.id === 'bookmark-notes-input') {
    bookmarkDialog.notes = target.value;
  }
});

root.addEventListener('change', async (event) => {
  const target = event.target;

  if (target.dataset.role === 'engine') {
    const index = Number(target.dataset.index);
    const nextEngines = [...state.settings.searchEngines];
    nextEngines[index] = target.value;
    await patchSettings({ searchEngines: nextEngines });
    await refreshState();
    render();
    return;
  }

  if (target.id === 'shortcut-upload' && shortcutDialog && target.files?.[0]) {
    const icon = await readUploadedIcon(target.files[0]);
    shortcutDialog.previewDataUrl = icon.dataUrl;
    shortcutDialog.iconMode = 'custom';
    shortcutDialog.status = '已选择本地上传 logo，保存后会落本地。';
    render();
  }
});

root.addEventListener('submit', async (event) => {
  const form = event.target;
  event.preventDefault();

  if (form.dataset.form === 'search') {
    const index = Number(form.dataset.index);
    const engineKey = state.settings.searchEngines[index] || 'baidu';
    const query = form.querySelector('[data-role="query"]').value.trim();
    if (!query) {
      return;
    }
    window.location.href = `${SEARCH_ENGINES[engineKey].url}${encodeURIComponent(query)}`;
    return;
  }

  if (form.id === 'shortcut-form') {
    try {
      await saveShortcutDialog();
    } catch (error) {
      shortcutDialog.status = error.message;
      render();
    }
  }

  if (form.id === 'bookmark-form') {
    try {
      await saveBookmarkDialog();
    } catch (error) {
      bookmarkDialog.status = error.message;
      render();
    }
  }
});

chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName !== 'local') {
    return;
  }
  await refreshState();
  render();
  hydrateMissingIcons().catch((error) => console.error(error));
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'glasstab-data-restored') {
    refreshState()
      .then(() => {
        render();
        return hydrateMissingIcons();
      })
      .catch((error) => console.error(error));
  }
});

await migrateLegacyLocalData(readLegacyData());
await refreshState();
render();
updateClock();
setInterval(updateClock, 1000);
hydrateMissingIcons().catch((error) => console.error(error));
