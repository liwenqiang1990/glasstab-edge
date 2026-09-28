import { aiReady } from './shared/ai.js';
import { aiFindPages } from './shared/ai-search.js';
import { SEARCH_ENGINES } from './shared/constants.js';
import { createFallbackIconDataUrl } from './shared/favicon.js';
import { styleIcons } from './shared/icon-style.js';
import { icon } from './shared/icons.js';
import { escapeHtml, getHostname } from './shared/utils.js';

// 新标签页搜索框的下拉建议（类似 Spotlight）：
// 网页搜索 / 快捷方式 / 书签 / 已打开的标签页 / 历史记录，以及可选的 AI 自然语言查找。

const LIMITS = { shortcut: 4, bookmark: 5, tab: 4, history: 6 };
const KIND_LABEL = { shortcut: '快捷方式', bookmark: '书签', tab: '已打开', history: '历史记录' };
const HISTORY_PERMISSION = { permissions: ['history'] };

function faviconUrl(pageUrl) {
  return `${chrome.runtime.getURL('/_favicon/')}?pageUrl=${encodeURIComponent(pageUrl)}&size=32`;
}

function looksLikeUrl(query) {
  if (/\s/.test(query)) return false;
  return /^https?:\/\//i.test(query)
    || /^localhost(:\d+)?(\/|$)/i.test(query)
    || /^(\d{1,3}\.){3}\d{1,3}(:\d+)?(\/\S*)?$/.test(query)
    || /^([\w-]+\.)+[a-z]{2,}(:\d+)?(\/\S*)?$/i.test(query);
}

// 只在命中时加分，没命中保持 0（会被过滤掉）。
function boosted(score, bonus) {
  return score > 0 ? score + bonus : 0;
}

// 多个词都要命中；标题开头命中得分最高。
function matchScore(tokens, { title = '', url = '', extra = '' }) {
  const lowerTitle = title.toLowerCase();
  const host = getHostname(url).toLowerCase();
  const lowerUrl = url.toLowerCase();
  const lowerExtra = extra.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (lowerTitle.startsWith(token)) score += 30;
    else if (lowerTitle.includes(token)) score += 20;
    else if (host.includes(token)) score += 12;
    else if (lowerUrl.includes(token)) score += 6;
    else if (lowerExtra.includes(token)) score += 4;
    else return 0;
  }
  return score;
}

function formatWhen(time) {
  if (!time) return '';
  const diff = Date.now() - time;
  if (diff < 3600000) return `${Math.max(1, Math.round(diff / 60000))} 分钟前`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)} 小时前`;
  if (diff < 30 * 86400000) return `${Math.round(diff / 86400000)} 天前`;
  return new Date(time).toLocaleDateString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric' });
}

export function createPalette({ form, input, getState, iconMarkup, onWebSearch }) {
  const panel = document.createElement('div');
  panel.className = 'suggest material';
  panel.hidden = true;
  panel.setAttribute('role', 'listbox');
  form.appendChild(panel);

  let query = '';
  let rows = [];
  let selected = 0;
  let requestSeq = 0;
  let historyGranted = false;
  let ai = null; // { query, status: 'loading' | 'done' | 'error', results, message }
  let currentTabId = null;

  chrome.permissions.contains(HISTORY_PERMISSION).then((granted) => { historyGranted = granted; });
  chrome.tabs.getCurrent().then((tab) => { currentTabId = tab?.id ?? null; }).catch(() => {});

  function siteIcon(url, label) {
    return `<span class="app-icon suggest-favicon"><img src="${escapeHtml(faviconUrl(url))}" data-fallback="${escapeHtml(createFallbackIconDataUrl(label))}" alt=""></span>`;
  }

  async function collect(text) {
    const state = getState();
    const tokens = text.toLowerCase().split(/\s+/).filter(Boolean);
    const pick = (list, limit) => list.filter((item) => item.score > 0).sort((left, right) => right.score - left.score).slice(0, limit);

    const shortcuts = pick(state.shortcuts.map((item) => ({
      kind: 'shortcut', title: item.name, url: item.url, subtitle: getHostname(item.url), iconHtml: iconMarkup(item, item.name),
      score: matchScore(tokens, { title: item.name, url: item.url }),
    })), LIMITS.shortcut);

    const bookmarks = pick(state.bookmarks.map((item) => ({
      kind: 'bookmark', title: item.title, url: item.url, subtitle: item.summary || getHostname(item.url), iconHtml: iconMarkup(item, item.title),
      score: matchScore(tokens, { title: item.title, url: item.url, extra: [item.summary, item.notes, ...(item.tags || [])].join(' ') }),
    })), LIMITS.bookmark);

    const openTabs = await chrome.tabs.query({});
    const tabs = pick(openTabs.filter((tab) => tab.id !== currentTabId && /^https?:/i.test(tab.url || '')).map((tab) => ({
      kind: 'tab', title: tab.title || tab.url, url: tab.url, subtitle: getHostname(tab.url), tabId: tab.id, windowId: tab.windowId,
      iconHtml: siteIcon(tab.url, tab.title), score: boosted(matchScore(tokens, { title: tab.title || '', url: tab.url || '' }), 5),
    })), LIMITS.tab);

    let history = [];
    if (historyGranted) {
      const known = new Set([...shortcuts, ...bookmarks, ...tabs].map((item) => item.url));
      const items = await chrome.history.search({ text, maxResults: 40, startTime: 0 });
      history = pick(items.filter((item) => item.url && !known.has(item.url) && /^https?:/i.test(item.url)).map((item) => ({
        kind: 'history', title: item.title || item.url, url: item.url, subtitle: `${getHostname(item.url)} · ${formatWhen(item.lastVisitTime)}`,
        iconHtml: siteIcon(item.url, item.title || item.url),
        score: boosted(matchScore(tokens, { title: item.title || '', url: item.url }), Math.min(item.visitCount || 0, 20)),
      })), LIMITS.history);
    }

    return { shortcuts, bookmarks, tabs, history };
  }

  function webRow(text) {
    if (looksLikeUrl(text)) {
      return { kind: 'web', title: `打开 ${text}`, url: /^https?:\/\//i.test(text) ? text : `https://${text}`, iconHtml: `<span class="suggest-glyph">${icon('link', 16)}</span>` };
    }
    const engine = SEARCH_ENGINES[getState().settings.searchEngine] || SEARCH_ENGINES.bing;
    return { kind: 'web', title: `用 ${engine.label} 搜索「${text}」`, search: text, iconHtml: `<span class="suggest-glyph">${icon('search', 16)}</span>` };
  }

  function aiRows(text) {
    const settings = getState().settings.ai;
    if (!aiReady(settings) || text.length < 2) return [];
    if (!ai || ai.query !== text) {
      return [{ kind: 'ai', title: `用 AI 找「${text}」`, subtitle: '用自然语言描述，比如「上周看的讲向量数据库的文章」', iconHtml: `<span class="suggest-glyph ai">${icon('sparkles', 16)}</span>`, hint: '⇧↵' }];
    }
    if (ai.status === 'loading') {
      return [{ kind: 'ai-status', title: 'AI 正在查找…', iconHtml: `<span class="suggest-glyph ai">${icon('sync', 16, 'spin')}</span>` }];
    }
    if (ai.status === 'error') {
      return [{ kind: 'ai', title: `AI 查找失败：${ai.message}`, subtitle: '点击重试', iconHtml: `<span class="suggest-glyph ai">${icon('alert', 16)}</span>` }];
    }
    if (!ai.results.length) {
      return [{ kind: 'ai-status', title: 'AI 没有找到相符的网页', iconHtml: `<span class="suggest-glyph ai">${icon('sparkles', 16)}</span>` }];
    }
    return ai.results.map(({ kind, item, reason }) => ({
      kind: 'ai-result',
      source: kind,
      title: item.title || item.url,
      url: item.url,
      subtitle: reason || getHostname(item.url),
      iconHtml: kind === 'bookmark' ? iconMarkup(item, item.title) : siteIcon(item.url, item.title || item.url),
      label: kind === 'bookmark' ? '书签' : `历史 · ${formatWhen(item.lastVisitTime)}`,
    }));
  }

  function render(groups) {
    const text = query;
    const sections = [];
    rows = [];
    const addSection = (title, list) => {
      if (!list.length) return;
      sections.push({ title, start: rows.length, list });
      rows.push(...list);
    };
    addSection('', [webRow(text)]);
    const aiList = aiRows(text);
    if (ai?.query === text) addSection('AI 结果', aiList);
    addSection('快捷方式', groups.shortcuts);
    addSection('已打开的标签页', groups.tabs);
    addSection('书签', groups.bookmarks);
    addSection('历史记录', groups.history);
    if (ai?.query !== text) addSection('', aiList);
    if (!historyGranted) {
      addSection('', [{ kind: 'permission', title: '同时搜索浏览历史', subtitle: '需要授权读取历史记录，只在本机搜索', iconHtml: `<span class="suggest-glyph">${icon('book', 16)}</span>` }]);
    }
    selected = Math.min(selected, rows.length - 1);

    panel.innerHTML = sections.map((section) => `
      ${section.title ? `<div class="suggest-head">${escapeHtml(section.title)}</div>` : ''}
      ${section.list.map((row, offset) => {
        const index = section.start + offset;
        const label = row.label || KIND_LABEL[row.kind] || '';
        return `
          <div class="suggest-row ${index === selected ? 'selected' : ''} kind-${row.kind}" role="option" data-index="${index}">
            ${row.iconHtml || ''}
            <span class="suggest-text">
              <span class="suggest-title">${escapeHtml(row.title)}</span>
              ${row.subtitle ? `<span class="suggest-sub">${escapeHtml(row.subtitle)}</span>` : ''}
            </span>
            ${row.hint ? `<kbd>${row.hint}</kbd>` : label ? `<span class="suggest-kind">${escapeHtml(label)}</span>` : ''}
          </div>`;
      }).join('')}`).join('');
    styleIcons(panel);
    setOpen(true);
  }

  function setOpen(open) {
    panel.hidden = !open;
    form.classList.toggle('suggest-open', open);
  }

  async function update() {
    query = input.value.trim();
    if (!query) {
      setOpen(false);
      rows = [];
      return;
    }
    const seq = ++requestSeq;
    const groups = await collect(query);
    if (seq !== requestSeq) return;
    render(groups);
  }

  function refresh() {
    selected = 0;
    update().catch((error) => console.warn('GlassTab suggest failed:', error));
  }

  async function runAi() {
    const text = query;
    const state = getState();
    ai = { query: text, status: 'loading', results: [] };
    refresh();
    try {
      const includeHistory = historyGranted && Boolean(state.settings.ai.searchHistory);
      const { results } = await aiFindPages(text, { bookmarks: state.bookmarks, includeHistory }, state.settings.ai);
      if (ai?.query !== text) return;
      ai = { query: text, status: 'done', results };
    } catch (error) {
      if (ai?.query !== text) return;
      ai = { query: text, status: 'error', message: error.message || String(error), results: [] };
    }
    selected = 1;
    update();
  }

  async function requestHistory() {
    try {
      historyGranted = await chrome.permissions.request(HISTORY_PERMISSION);
    } catch (error) {
      historyGranted = false;
    }
    input.focus();
    refresh();
  }

  async function activate(row, { newTab = false } = {}) {
    if (!row) return;
    if (row.kind === 'ai' || (row.kind === 'ai-status' && ai?.status === 'error')) {
      runAi();
      return;
    }
    if (row.kind === 'ai-status') return;
    if (row.kind === 'permission') {
      requestHistory();
      return;
    }
    if (row.kind === 'web' && row.search) {
      onWebSearch(row.search, { newTab });
      return;
    }
    if (row.kind === 'tab' && !newTab) {
      // 切到已打开的标签页，并关掉当前这个空白新标签页。
      await chrome.tabs.update(row.tabId, { active: true });
      await chrome.windows.update(row.windowId, { focused: true });
      if (currentTabId !== null) chrome.tabs.remove(currentTabId);
      return;
    }
    if (newTab) {
      chrome.tabs.create({ url: row.url, active: false });
    } else {
      window.location.href = row.url;
    }
  }

  function move(delta) {
    if (!rows.length) return;
    selected = (selected + delta + rows.length) % rows.length;
    panel.querySelectorAll('.suggest-row').forEach((node) => node.classList.toggle('selected', Number(node.dataset.index) === selected));
    panel.querySelector('.suggest-row.selected')?.scrollIntoView({ block: 'nearest' });
  }

  let debounce = null;
  input.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(refresh, 90);
  });

  input.addEventListener('focus', () => {
    if (input.value.trim()) refresh();
  });

  input.addEventListener('keydown', (event) => {
    if (event.isComposing) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (!input.value.trim()) return;
      if (event.shiftKey && aiReady(getState().settings.ai)) {
        query = input.value.trim();
        runAi();
        return;
      }
      if (!rows.length) {
        onWebSearch(input.value.trim(), { newTab: event.metaKey || event.ctrlKey });
        return;
      }
      activate(rows[selected], { newTab: event.metaKey || event.ctrlKey });
    } else if (event.key === 'Escape' && !panel.hidden) {
      event.stopPropagation();
      setOpen(false);
    }
  });

  panel.addEventListener('mousedown', (event) => event.preventDefault());
  panel.addEventListener('click', (event) => {
    const node = event.target.closest('.suggest-row');
    if (node) activate(rows[Number(node.dataset.index)], { newTab: event.metaKey || event.ctrlKey });
  });
  panel.addEventListener('mousemove', (event) => {
    const node = event.target.closest('.suggest-row');
    if (node && Number(node.dataset.index) !== selected) {
      selected = Number(node.dataset.index);
      panel.querySelectorAll('.suggest-row').forEach((item) => item.classList.toggle('selected', item === node));
    }
  });
  // 网站图标加载失败时换成文字图标
  panel.addEventListener('error', (event) => {
    const img = event.target;
    if (img.tagName === 'IMG' && img.dataset.fallback && img.src !== img.dataset.fallback) img.src = img.dataset.fallback;
  }, true);

  input.addEventListener('blur', () => setTimeout(() => {
    if (document.activeElement !== input) setOpen(false);
  }, 120));

  return {
    close: () => setOpen(false),
    isOpen: () => !panel.hidden,
  };
}
