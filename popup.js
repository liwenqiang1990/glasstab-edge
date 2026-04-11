import { listAssetsMap } from './shared/assets.js';
import { createFallbackIconDataUrl } from './shared/favicon.js';
import { getState, removeBookmark } from './shared/storage.js';
import { getHostname } from './shared/utils.js';

const pageTitle = document.getElementById('page-title');
const pageUrl = document.getElementById('page-url');
const statusLine = document.getElementById('status');
const summaryBox = document.getElementById('summary');
const bookmarkList = document.getElementById('bookmark-list');
const bookmarkCount = document.getElementById('bookmark-count');
const bookmarkSearch = document.getElementById('bookmark-search');
const tagFilters = document.getElementById('tag-filters');
const bookmarkButton = document.getElementById('bookmark-btn');
const bookmarkSummaryButton = document.getElementById('bookmark-summary-btn');
const summaryButton = document.getElementById('summary-btn');
const shortcutButton = document.getElementById('shortcut-btn');
const bookmarksPageButton = document.getElementById('bookmarks-page-btn');
const optionsButton = document.getElementById('options-btn');

let currentTab = null;
let busy = false;
let popupState = null;
let assetsMap = {};
let selectedTag = '';
let searchQuery = '';

function setBusy(nextBusy) {
  busy = nextBusy;
  [bookmarkButton, bookmarkSummaryButton, summaryButton, shortcutButton].forEach((button) => {
    button.disabled = busy || !currentTab || !/^https?:/i.test(currentTab.url || '');
  });
}

function setStatus(message, summary = '') {
  statusLine.textContent = message || '';
  summaryBox.textContent = summary || '';
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function allTags() {
  const tags = new Set();
  (popupState?.bookmarks || []).forEach((bookmark) => {
    (bookmark.tags || []).forEach((tag) => tags.add(tag));
  });
  return Array.from(tags).sort((left, right) => left.localeCompare(right, 'zh-CN'));
}

function filteredBookmarks() {
  const query = searchQuery.trim().toLowerCase();

  return (popupState?.bookmarks || []).filter((bookmark) => {
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
    ]
      .join(' ')
      .toLowerCase();

    return haystack.includes(query);
  });
}

function renderTagFilters() {
  const tags = allTags();
  const chips = [
    `<button class="chip ${selectedTag ? '' : 'active'}" type="button" data-tag="">全部</button>`,
    ...tags.map((tag) => `<button class="chip ${selectedTag === tag ? 'active' : ''}" type="button" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`),
  ];

  tagFilters.innerHTML = chips.join('');
}

function renderBookmarks() {
  const bookmarks = filteredBookmarks();
  bookmarkCount.textContent = `${bookmarks.length} / ${(popupState?.bookmarks || []).length}`;

  if (!bookmarks.length) {
    bookmarkList.innerHTML = '<div class="tip">没有匹配的书签。</div>';
    return;
  }

  bookmarkList.innerHTML = bookmarks.map((bookmark) => {
    const icon = assetsMap[bookmark.iconAssetId] || createFallbackIconDataUrl(bookmark.title || 'B');
    const summary = bookmark.summary || bookmark.notes || '暂无摘要';
    return `
      <article class="bookmark-item" data-url="${escapeHtml(bookmark.url)}">
        <div class="bookmark-icon"><img src="${icon}" alt=""></div>
        <div>
          <div class="bookmark-title">${escapeHtml(bookmark.title)}</div>
          <div class="bookmark-site">${escapeHtml(getHostname(bookmark.url))}</div>
          <div class="bookmark-summary">${escapeHtml(summary)}</div>
        </div>
        <button class="bookmark-delete" type="button" data-delete-id="${bookmark.id}" title="删除">删</button>
      </article>
    `;
  }).join('');
}

async function reloadBookmarks() {
  popupState = await getState();
  assetsMap = await listAssetsMap();
  renderTagFilters();
  renderBookmarks();
}

async function callBackground(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, payload });
  if (!response?.ok) {
    throw new Error(response?.error || '后台请求失败');
  }
  return response;
}

async function withAction(action) {
  if (busy) {
    return;
  }

  try {
    setBusy(true);
    await action();
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusy(false);
  }
}

async function init() {
  await reloadBookmarks();
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tabs[0] || null;

  if (!currentTab) {
    pageTitle.textContent = '未找到当前标签页';
    setStatus('无法读取当前标签页。');
    setBusy(true);
    return;
  }

  pageTitle.textContent = currentTab.title || '未命名页面';
  pageUrl.textContent = currentTab.url || '';

  if (!/^https?:/i.test(currentTab.url || '')) {
    setStatus('当前页面不是普通网页，不能加入书签或做 AI 摘要。');
  }

  setBusy(false);
}

bookmarkButton.addEventListener('click', () => {
  withAction(async () => {
    setStatus('正在保存书签并生成 AI 摘要...');
    const response = await callBackground('bookmark-tab', {
      tabId: currentTab.id,
      title: currentTab.title,
      url: currentTab.url,
      withSummary: true,
      source: 'popup',
    });
    setStatus('已加入 GlassTab 书签。', response.summary || '');
    await reloadBookmarks();
  });
});

bookmarkSummaryButton.addEventListener('click', () => {
  withAction(async () => {
    setStatus('正在保存书签...');
    await callBackground('bookmark-tab', {
      tabId: currentTab.id,
      title: currentTab.title,
      url: currentTab.url,
      withSummary: false,
      source: 'popup',
    });
    setStatus('已保存书签。');
    await reloadBookmarks();
  });
});

summaryButton.addEventListener('click', () => {
  withAction(async () => {
    setStatus('AI 正在总结当前页面...');
    const response = await callBackground('summarize-tab', {
      tabId: currentTab.id,
    });
    setStatus('摘要已生成。', response.summary || '');
  });
});

shortcutButton.addEventListener('click', () => {
  withAction(async () => {
    setStatus('正在添加到 Shortcut...');
    await callBackground('shortcut-tab', {
      title: currentTab.title,
      url: currentTab.url,
    });
    setStatus('已添加到 Shortcut。');
  });
});

optionsButton.addEventListener('click', async () => {
  await chrome.tabs.create({
    url: chrome.runtime.getURL('options.html?returnTo=tab'),
  });
  window.close();
});

bookmarksPageButton.addEventListener('click', async () => {
  await chrome.tabs.create({
    url: chrome.runtime.getURL('bookmarks.html'),
  });
  window.close();
});

bookmarkSearch.addEventListener('input', () => {
  searchQuery = bookmarkSearch.value;
  renderBookmarks();
});

tagFilters.addEventListener('click', (event) => {
  const button = event.target.closest('[data-tag]');
  if (!button) {
    return;
  }
  selectedTag = button.dataset.tag || '';
  renderTagFilters();
  renderBookmarks();
});

bookmarkList.addEventListener('click', async (event) => {
  const deleteButton = event.target.closest('[data-delete-id]');
  if (deleteButton) {
    event.stopPropagation();
    await removeBookmark(deleteButton.dataset.deleteId);
    await reloadBookmarks();
    chrome.runtime.sendMessage({ type: 'schedule-auto-backup' }).catch(() => {});
    return;
  }

  const item = event.target.closest('.bookmark-item');
  if (!item?.dataset.url) {
    return;
  }

  await chrome.tabs.create({ url: item.dataset.url });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') {
    return;
  }
  reloadBookmarks().catch((error) => setStatus(error.message));
});

init().catch((error) => {
  setStatus(error.message);
  setBusy(true);
});
