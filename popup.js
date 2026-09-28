import { listAssetsMap } from './shared/assets.js';
import { collectTags, filterBookmarks, iconBox, renderTagChips } from './shared/bookmark-view.js';
import { HOME_GROUP_ID, STORAGE_KEY, SYNC_STATUS_KEY } from './shared/constants.js';
import { styleIcons } from './shared/icon-style.js';
import { icon } from './shared/icons.js';
import { getState, removeBookmark } from './shared/storage.js';
import { escapeHtml, getHostname, normalizeUrl, toTime } from './shared/utils.js';

const $ = (id) => document.getElementById(id);
const els = {
  pageIcon: $('page-icon'),
  pageTitle: $('page-title'),
  pageUrl: $('page-url'),
  bookmarkBtn: $('bookmark-btn'),
  withSummary: $('with-summary'),
  summaryToggleLabel: $('summary-toggle-label'),
  shortcutBtn: $('shortcut-btn'),
  groupSelect: $('group-select'),
  summaryBtn: $('summary-btn'),
  resultWrap: $('result-wrap'),
  status: $('status'),
  summary: $('summary'),
  bookmarkCount: $('bookmark-count'),
  searchWrap: $('search-wrap'),
  search: $('bookmark-search'),
  tagFilters: $('tag-filters'),
  list: $('bookmark-list'),
  syncMeta: $('sync-meta'),
  bookmarksPageBtn: $('bookmarks-page-btn'),
  optionsBtn: $('options-btn'),
};

const SUMMARY_PREF_KEY = 'glasstab:popup-with-summary';
const GROUP_PREF_KEY = 'glasstab:popup-group';

let currentTab = null;
let state = null;
let assetsMap = {};
let busy = false;
let selectedTag = '';

function isWebPage() {
  return /^https?:/i.test(currentTab?.url || '');
}

function aiReady() {
  return Boolean(state?.settings.ai.enabled && state?.settings.ai.apiKey);
}

function existingBookmark() {
  if (!currentTab) return null;
  const url = normalizeUrl(currentTab.url);
  return state?.bookmarks.find((bookmark) => bookmark.url === url) || null;
}

function showResult(message, summary = '', isError = false) {
  els.resultWrap.hidden = !message && !summary;
  els.status.textContent = message || '';
  els.status.classList.toggle('error', isError);
  els.summary.textContent = summary || '';
  els.summary.hidden = !summary;
}

function renderActions() {
  const saved = existingBookmark();
  els.bookmarkBtn.classList.toggle('is-saved', Boolean(saved));
  els.bookmarkBtn.innerHTML = saved
    ? `${icon('check', 16)}已在书签中 · 再次保存可更新`
    : `${icon('bookmark', 16)}保存到书签`;

  const disabled = busy || !isWebPage();
  els.bookmarkBtn.disabled = disabled;
  els.shortcutBtn.disabled = disabled;
  els.summaryBtn.disabled = disabled || !aiReady();
  els.withSummary.disabled = !aiReady();
  els.groupSelect.disabled = disabled;
  els.summaryToggleLabel.textContent = aiReady() ? '同时生成 AI 摘要' : 'AI 摘要未开启（在设置中配置）';
  if (!aiReady()) els.withSummary.checked = false;
}

function renderList() {
  const all = state?.bookmarks || [];
  const tags = collectTags(all);
  if (selectedTag && !tags.includes(selectedTag)) selectedTag = '';
  const bookmarks = filterBookmarks(all, { query: els.search.value, tag: selectedTag });

  els.bookmarkCount.textContent = all.length ? `${bookmarks.length} / ${all.length}` : '';
  els.tagFilters.innerHTML = renderTagChips(tags, selectedTag);
  els.tagFilters.hidden = !tags.length;

  if (!bookmarks.length) {
    els.list.innerHTML = `<div class="empty">${all.length ? '没有匹配的书签' : '还没有书签'}</div>`;
    return;
  }

  els.list.innerHTML = bookmarks.map((bookmark) => `
    <div class="item" data-url="${escapeHtml(bookmark.url)}" title="${escapeHtml(bookmark.summary || bookmark.url)}">
      ${iconBox(assetsMap, bookmark, bookmark.title)}
      <div class="item-body">
        <div class="item-title ellipsis">${escapeHtml(bookmark.title)}</div>
        <div class="item-sub ellipsis">${escapeHtml(bookmark.summary || getHostname(bookmark.url))}</div>
      </div>
      <button class="icon-button" type="button" data-delete-id="${escapeHtml(bookmark.id)}" title="删除">${icon('trash', 14)}</button>
    </div>`).join('');
  styleIcons(els.list);
}

function renderGroups() {
  const groups = state?.groups || [];
  let preferred = HOME_GROUP_ID;
  try {
    preferred = localStorage.getItem(GROUP_PREF_KEY) || HOME_GROUP_ID;
  } catch (error) {
    // 忽略
  }
  const selected = groups.some((group) => group.id === (els.groupSelect.value || preferred)) ? (els.groupSelect.value || preferred) : HOME_GROUP_ID;
  els.groupSelect.innerHTML = groups.map((group) => `<option value="${escapeHtml(group.id)}">${escapeHtml(group.name)}</option>`).join('');
  els.groupSelect.value = selected;
}

function renderSyncMeta(status = {}) {
  if (!state?.settings.webdav.serverUrl) {
    els.syncMeta.textContent = '';
    return;
  }
  if (status.running) {
    els.syncMeta.textContent = '同步中…';
  } else if (status.lastError) {
    els.syncMeta.textContent = '同步失败';
  } else if (toTime(status.lastSyncAt)) {
    els.syncMeta.textContent = `已同步 ${new Date(status.lastSyncAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
  }
}

async function reload() {
  state = await getState();
  assetsMap = await listAssetsMap();
  renderActions();
  renderGroups();
  renderList();
}

async function callBackground(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, payload });
  if (!response?.ok) {
    throw new Error(response?.error || '后台请求失败');
  }
  return response;
}

async function withAction(action) {
  if (busy) return;
  busy = true;
  renderActions();
  try {
    await action();
  } catch (error) {
    showResult(error.message, '', true);
  } finally {
    busy = false;
    renderActions();
  }
}

function tabPayload(extra = {}) {
  return {
    tabId: currentTab.id,
    title: currentTab.title,
    url: currentTab.url,
    favIconUrl: currentTab.favIconUrl || '',
    ...extra,
  };
}

els.bookmarkBtn.addEventListener('click', () => {
  withAction(async () => {
    const withSummary = els.withSummary.checked;
    showResult(withSummary ? '正在保存并生成摘要…' : '正在保存…');
    const response = await callBackground('bookmark-tab', tabPayload({ withSummary, source: 'popup' }));
    const verb = response.alreadyExisted ? '已更新书签' : '已保存到书签';
    if (response.summaryError) {
      showResult(`${verb}，但摘要生成失败：${response.summaryError}`, '', true);
    } else {
      showResult(verb, response.summary || '');
    }
    await reload();
  });
});

els.shortcutBtn.addEventListener('click', () => {
  withAction(async () => {
    const groupId = els.groupSelect.value || HOME_GROUP_ID;
    try {
      localStorage.setItem(GROUP_PREF_KEY, groupId);
    } catch (error) {
      // 忽略
    }
    await callBackground('shortcut-tab', tabPayload({ groupId }));
    const group = state.groups.find((item) => item.id === groupId);
    showResult(`已添加到快捷方式「${group?.name || '主页'}」`);
  });
});

els.summaryBtn.addEventListener('click', () => {
  withAction(async () => {
    showResult('AI 正在阅读页面…');
    const response = await callBackground('summarize-tab', { tabId: currentTab.id });
    showResult('摘要', response.summary || '');
  });
});

els.withSummary.addEventListener('change', () => {
  try {
    localStorage.setItem(SUMMARY_PREF_KEY, els.withSummary.checked ? '1' : '0');
  } catch (error) {
    // 忽略
  }
});

els.search.addEventListener('input', renderList);

els.tagFilters.addEventListener('click', (event) => {
  const chip = event.target.closest('[data-tag]');
  if (!chip) return;
  selectedTag = chip.dataset.tag || '';
  renderList();
});

els.list.addEventListener('click', async (event) => {
  const deleteBtn = event.target.closest('[data-delete-id]');
  if (deleteBtn) {
    event.stopPropagation();
    await removeBookmark(deleteBtn.dataset.deleteId);
    await reload();
    return;
  }
  const item = event.target.closest('.item');
  if (item?.dataset.url) {
    await chrome.tabs.create({ url: item.dataset.url });
    window.close();
  }
});

els.bookmarksPageBtn.addEventListener('click', async () => {
  await chrome.tabs.create({ url: chrome.runtime.getURL('bookmarks.html') });
  window.close();
});

els.optionsBtn.addEventListener('click', async () => {
  await chrome.runtime.openOptionsPage();
  window.close();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (changes[STORAGE_KEY]) reload().catch(() => {});
  if (changes[SYNC_STATUS_KEY]) renderSyncMeta(changes[SYNC_STATUS_KEY].newValue || {});
});

async function init() {
  els.searchWrap.insertAdjacentHTML('afterbegin', icon('search', 14));
  els.bookmarksPageBtn.innerHTML = `${icon('bookmark', 15)}全部书签`;
  els.optionsBtn.innerHTML = `${icon('settings', 15)}设置`;

  try {
    els.withSummary.checked = localStorage.getItem(SUMMARY_PREF_KEY) !== '0';
  } catch (error) {
    els.withSummary.checked = true;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab || null;
  await reload();

  if (!currentTab) {
    els.pageTitle.textContent = '未找到当前标签页';
    return;
  }

  els.pageTitle.textContent = currentTab.title || '未命名页面';
  els.pageUrl.textContent = currentTab.url || '';
  // 当前页用标签页自带的 favicon，失败则用文字图标。
  const label = currentTab.title || getHostname(currentTab.url);
  els.pageIcon.innerHTML = iconBox({}, {}, label);
  if (currentTab.favIconUrl) {
    const holder = els.pageIcon.querySelector('.app-icon');
    const img = holder.querySelector('img');
    img.onload = () => {
      holder.dataset.iconKey = `tmp:${currentTab.favIconUrl}`;
      styleIcons(els.pageIcon);
    };
    img.src = currentTab.favIconUrl;
  }
  styleIcons(els.pageIcon);

  if (!isWebPage()) {
    showResult('当前页面不是普通网页，无法收藏或生成摘要。');
  }

  const status = (await chrome.storage.local.get(SYNC_STATUS_KEY))[SYNC_STATUS_KEY] || {};
  renderSyncMeta(status);
  // 打开 popup 时顺便拉一次远端，减少冲突。
  chrome.runtime.sendMessage({ type: 'sync-if-stale' }).catch(() => {});
}

init().catch((error) => showResult(error.message, '', true));
