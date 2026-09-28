import { listAssetsMap } from './shared/assets.js';
import { collectTags, filterBookmarks, iconBox, renderTagChips } from './shared/bookmark-view.js';
import { STORAGE_KEY } from './shared/constants.js';
import { styleIcons } from './shared/icon-style.js';
import { icon } from './shared/icons.js';
import { getState, removeBookmark, upsertBookmark } from './shared/storage.js';
import { escapeHtml, getHostname } from './shared/utils.js';

const $ = (id) => document.getElementById(id);
const searchInput = $('bookmark-search');
const tagFilters = $('tag-filters');
const bookmarkCount = $('bookmark-count');
const bookmarkList = $('bookmark-list');
const toast = $('toast');

let state = null;
let assetsMap = {};
let selectedTag = '';
let toastTimer = null;

function formatDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString('zh-CN', sameYear ? { month: 'numeric', day: 'numeric' } : { year: 'numeric', month: 'numeric', day: 'numeric' });
}

function showToast(message, action) {
  clearTimeout(toastTimer);
  toast.innerHTML = `<span>${escapeHtml(message)}</span>${action ? `<button type="button">${escapeHtml(action.label)}</button>` : ''}`;
  toast.classList.toggle('no-action', !action);
  toast.hidden = false;
  if (action) {
    toast.querySelector('button').onclick = () => {
      toast.hidden = true;
      action.run();
    };
  }
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 4500);
}

function render() {
  const all = state?.bookmarks || [];
  const tags = collectTags(all);
  if (selectedTag && !tags.includes(selectedTag)) selectedTag = '';
  const bookmarks = filterBookmarks(all, { query: searchInput.value, tag: selectedTag });

  tagFilters.innerHTML = renderTagChips(tags, selectedTag);
  tagFilters.hidden = !tags.length;
  bookmarkCount.textContent = bookmarks.length === all.length ? `共 ${all.length} 条` : `${bookmarks.length} / ${all.length} 条`;

  if (!bookmarks.length) {
    bookmarkList.innerHTML = `<div class="empty">${all.length ? '没有匹配的书签' : '还没有书签。浏览网页时点击工具栏里的 GlassTab 图标即可收藏。'}</div>`;
    return;
  }

  bookmarkList.innerHTML = bookmarks.map((bookmark) => `
    <a class="bm-row" href="${escapeHtml(bookmark.url)}">
      ${iconBox(assetsMap, bookmark, bookmark.title)}
      <div style="min-width:0">
        <div class="bm-line"><span class="bm-title ellipsis">${escapeHtml(bookmark.title)}</span><span class="bm-host">${escapeHtml(getHostname(bookmark.url))}</span></div>
        ${bookmark.summary ? `<div class="bm-summary">${escapeHtml(bookmark.summary)}</div>` : ''}
        ${bookmark.notes ? `<div class="bm-notes">${escapeHtml(bookmark.notes)}</div>` : ''}
        ${(bookmark.tags || []).length ? `<div class="bm-tags">${bookmark.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
      </div>
      <div class="bm-side">
        <span class="bm-date">${formatDate(bookmark.createdAt)}</span>
        <button class="icon-button danger" type="button" data-delete-id="${escapeHtml(bookmark.id)}" title="删除">${icon('trash', 16)}</button>
      </div>
    </a>`).join('');
  styleIcons(bookmarkList);
}

async function reload() {
  state = await getState();
  assetsMap = await listAssetsMap();
  render();
}

searchInput.addEventListener('input', render);

tagFilters.addEventListener('click', (event) => {
  const chip = event.target.closest('[data-tag]');
  if (!chip) return;
  selectedTag = chip.dataset.tag || '';
  render();
});

bookmarkList.addEventListener('click', async (event) => {
  const deleteButton = event.target.closest('[data-delete-id]');
  if (!deleteButton) return;
  event.preventDefault();
  const bookmark = state.bookmarks.find((item) => item.id === deleteButton.dataset.deleteId);
  if (!bookmark) return;
  await removeBookmark(bookmark.id);
  showToast(`已删除「${bookmark.title}」`, { label: '撤销', run: () => upsertBookmark({ ...bookmark }) });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes[STORAGE_KEY]) {
    reload().catch((error) => console.error(error));
  }
});

$('search-wrap').insertAdjacentHTML('afterbegin', icon('search', 16));
$('options-link').innerHTML = `${icon('settings', 15)}设置`;

reload().catch((error) => {
  bookmarkList.innerHTML = `<div class="empty">${escapeHtml(error.message || String(error))}</div>`;
});
