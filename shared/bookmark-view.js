import { createFallbackIconDataUrl } from './favicon.js';
import { escapeHtml, toTime } from './utils.js';

// popup 与书签页共用的书签筛选/渲染小工具。

export function collectTags(bookmarks = []) {
  const counts = new Map();
  bookmarks.forEach((bookmark) => {
    (bookmark.tags || []).forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1));
  });
  return Array.from(counts.keys()).sort((left, right) => counts.get(right) - counts.get(left) || left.localeCompare(right, 'zh-CN'));
}

export function filterBookmarks(bookmarks = [], { query = '', tag = '' } = {}) {
  const keyword = query.trim().toLowerCase();
  return bookmarks
    .filter((bookmark) => {
      if (tag && !(bookmark.tags || []).includes(tag)) {
        return false;
      }
      if (!keyword) {
        return true;
      }
      return [bookmark.title, bookmark.url, bookmark.summary, bookmark.notes, ...(bookmark.tags || [])]
        .join(' ')
        .toLowerCase()
        .includes(keyword);
    })
    .sort((left, right) => toTime(right.createdAt) - toTime(left.createdAt));
}

export function renderTagChips(tags, selectedTag) {
  if (!tags.length) {
    return '';
  }
  return [
    `<button class="chip ${selectedTag ? '' : 'active'}" type="button" data-tag="">全部</button>`,
    ...tags.map((tag) => `<button class="chip ${selectedTag === tag ? 'active' : ''}" type="button" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`),
  ].join('');
}

// 输出 .app-icon 结构，渲染后调用 icon-style.js 的 styleIcons() 决定铺满还是配底色。
export function iconBox(assetsMap, item, label) {
  const src = assetsMap[item.iconAssetId];
  const key = src ? item.iconAssetId : `fallback:${label}`;
  return `<span class="app-icon" data-icon-key="${escapeHtml(key)}"><img src="${escapeHtml(src || createFallbackIconDataUrl(label))}" alt="" loading="lazy"></span>`;
}
