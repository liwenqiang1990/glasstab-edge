// GlassTab 恢复：左键恢复最近关闭的页面，右键列出最近关闭的几个。

const MENU_PREFIX = 'restore:';
const MENU_LIMIT = 6; // 浏览器限制：工具栏图标右键菜单最多 6 个顶级项
let rebuildQueue = Promise.resolve();

function truncate(text, max = 36) {
  const value = String(text || '').trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function describe(session) {
  if (session.window) {
    const count = session.window.tabs?.length || 0;
    const first = session.window.tabs?.[0]?.title || '';
    return `窗口 · ${count} 个标签页${first ? `（${truncate(first, 18)}）` : ''}`;
  }
  const tab = session.tab || {};
  return truncate(tab.title || tab.url || '未命名页面');
}

function sessionId(session) {
  return session.tab?.sessionId || session.window?.sessionId;
}

async function recent() {
  const sessions = await chrome.sessions.getRecentlyClosed({ maxResults: MENU_LIMIT });
  // 过滤掉新标签页之类没有意义的记录
  return sessions.filter((session) => session.window || !isBlankTab(session.tab?.url));
}

function isBlankTab(url = '') {
  return !url || /^(edge|chrome):\/\/(newtab|new-tab-page)/.test(url) || /^chrome-extension:\/\/[^/]+\/tab\.html/.test(url);
}

async function rebuild() {
  const sessions = await recent();
  await chrome.action.setTitle({
    title: sessions.length ? `恢复：${describe(sessions[0])}\n右键查看更多` : '没有可恢复的页面',
  });
  await new Promise((resolve) => chrome.contextMenus.removeAll(resolve));
  if (!sessions.length) {
    chrome.contextMenus.create({ id: 'empty', title: '没有最近关闭的页面', contexts: ['action'], enabled: false });
    return;
  }
  sessions.slice(0, MENU_LIMIT).forEach((session) => {
    chrome.contextMenus.create({ id: `${MENU_PREFIX}${sessionId(session)}`, title: describe(session), contexts: ['action'] });
  });
}

function scheduleRebuild() {
  rebuildQueue = rebuildQueue.then(rebuild).catch((error) => console.warn('GlassTab 恢复：菜单更新失败', error));
}

async function flash(text) {
  await chrome.action.setBadgeBackgroundColor({ color: '#8e8e93' });
  await chrome.action.setBadgeText({ text });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 1500);
}

async function restoreLatest() {
  const sessions = await recent();
  if (!sessions.length) {
    await flash('空');
    return;
  }
  await chrome.sessions.restore(sessionId(sessions[0]));
}

chrome.action.onClicked.addListener(() => {
  restoreLatest().catch((error) => console.warn(error));
});

chrome.commands.onCommand.addListener((command) => {
  if (command === 'restore-last') restoreLatest().catch((error) => console.warn(error));
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (String(info.menuItemId).startsWith(MENU_PREFIX)) {
    chrome.sessions.restore(String(info.menuItemId).slice(MENU_PREFIX.length)).catch((error) => console.warn(error));
  }
});

chrome.sessions.onChanged.addListener(scheduleRebuild);
chrome.runtime.onInstalled.addListener(scheduleRebuild);
chrome.runtime.onStartup.addListener(scheduleRebuild);
