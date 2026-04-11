import { listAssetsMap } from './shared/assets.js';
import { createFallbackIconDataUrl } from './shared/favicon.js';
import { getState, removeBookmark } from './shared/storage.js';
import { getHostname } from './shared/utils.js';

const searchInput = document.getElementById('bookmark-search');
const tagFilters = document.getElementById('tag-filters');
const bookmarkCount = document.getElementById('bookmark-count');
const bookmarkList = document.getElementById('bookmark-list');
const homeButton = document.getElementById('home-btn');
const optionsButton = document.getElementById('options-btn');

let state = null;
let assetsMap = {};
let selectedTag = '';
let searchQuery = '';

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function collectTags() {
  const tags = new Set();
  (state?.bookmarks || []).forEach((bookmark) => {
    (bookmark.tags || []).forEach((tag) => tags.add(tag));
  });
  return Array.from(tags).sort((left, right) => left.localeCompare(right, 'zh-CN'));
}

function filteredBookmarks() {
  const query = searchQuery.trim().toLowerCase();
  return (state?.bookmarks || []).filter((bookmark) => {
    if (selectedTag && !(bookmark.tags || []).includes(selectedTag)) {
      return false;
    }

    if (!query) {
      return true;
    }

    const haystack = [
      bookmark.title,
      bookmark.url,
      bookmark.summary,
      bookmark.notes,
      ...(bookmark.tags || []),
    ].join(' ').toLowerCase();

    return haystack.includes(query);
  });
}

function renderTags() {
  const tags = collectTags();
  tagFilters.innerHTML = [
    `<button class="chip ${selectedTag ? '' : 'active'}" type="button" data-tag="">全部</button>`,
    ...tags.map((tag) => `<button class="chip ${selectedTag === tag ? 'active' : ''}" type="button" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`),
  ].join('');
}

function renderBookmarks() {
  const bookmarks = filteredBookmarks();
  bookmarkCount.textContent = `共 ${state?.bookmarks?.length || 0} 条，当前显示 ${bookmarks.length} 条`;

  if (!bookmarks.length) {
    bookmarkList.innerHTML = '<div class="empty">没有匹配的书签。</div>';
    return;
  }

  bookmarkList.innerHTML = bookmarks.map((bookmark) => {
    const icon = assetsMap[bookmark.iconAssetId] || createFallbackIconDataUrl(bookmark.title || 'B');
    return `
      <article class="item" data-url="${escapeHtml(bookmark.url)}">
        <div class="icon"><img src="${icon}" alt=""></div>
        <div>
          <div class="item-title">${escapeHtml(bookmark.title)}</div>
          <div class="item-site">${escapeHtml(getHostname(bookmark.url))}</div>
          <div class="item-summary">${escapeHtml(bookmark.summary || bookmark.notes || '暂无摘要')}</div>
          <div class="item-tags">${escapeHtml((bookmark.tags || []).join(' / ') || '无标签')}</div>
        </div>
        <button class="delete-btn" type="button" data-delete-id="${bookmark.id}" title="删除">删</button>
      </article>
    `;
  }).join('');
}

async function reload() {
  state = await getState();
  assetsMap = await listAssetsMap();
  renderTags();
  renderBookmarks();
}

searchInput.addEventListener('input', () => {
  searchQuery = searchInput.value;
  renderBookmarks();
});

tagFilters.addEventListener('click', (event) => {
  const button = event.target.closest('[data-tag]');
  if (!button) {
    return;
  }
  selectedTag = button.dataset.tag || '';
  renderTags();
  renderBookmarks();
});

bookmarkList.addEventListener('click', async (event) => {
  const deleteButton = event.target.closest('[data-delete-id]');
  if (deleteButton) {
    event.stopPropagation();
    await removeBookmark(deleteButton.dataset.deleteId);
    await reload();
    chrome.runtime.sendMessage({ type: 'schedule-auto-backup' }).catch(() => {});
    return;
  }

  const item = event.target.closest('[data-url]');
  if (!item?.dataset.url) {
    return;
  }

  window.location.href = item.dataset.url;
});

homeButton.addEventListener('click', () => {
  window.location.href = chrome.runtime.getURL('tab.html');
});

optionsButton.addEventListener('click', () => {
  window.location.href = chrome.runtime.getURL('options.html?returnTo=tab');
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') {
    return;
  }
  reload().catch((error) => console.error(error));
});

reload().catch((error) => {
  bookmarkList.innerHTML = `<div class="empty">${escapeHtml(error.message || String(error))}</div>`;
});
