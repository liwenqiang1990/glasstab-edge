import { listAssets, replaceAllAssets } from './shared/assets.js';
import { AI_PROVIDERS, APP_SCHEMA_VERSION, SYNC_STATUS_KEY } from './shared/constants.js';
import { getState, normalizeState, patchSettings, saveState } from './shared/storage.js';
import { testUnsplashKey } from './shared/unsplash.js';
import { toTime } from './shared/utils.js';

const $ = (id) => document.getElementById(id);
const elements = {
  aiEnabled: $('ai-enabled'),
  aiSearchHistory: $('ai-search-history'),
  aiProvider: $('ai-provider'),
  aiEndpoint: $('ai-endpoint'),
  aiModel: $('ai-model'),
  aiKey: $('ai-key'),
  aiLength: $('ai-length'),
  aiTemperature: $('ai-temperature'),
  aiPrompt: $('ai-prompt'),
  aiHint: $('ai-hint'),
  davServer: $('dav-server'),
  davPath: $('dav-path'),
  davFile: $('dav-file'),
  davUser: $('dav-user'),
  davPassword: $('dav-password'),
  davAuto: $('dav-auto'),
  unsplashKey: $('unsplash-key'),
  unsplashTest: $('unsplash-test'),
  unsplashMeta: $('unsplash-meta'),
  syncButton: $('sync-btn'),
  restoreButton: $('restore-btn'),
  overwriteButton: $('overwrite-btn'),
  syncState: $('sync-state'),
  syncMeta: $('sync-meta'),
  syncError: $('sync-error'),
  syncErrorRow: $('sync-error-row'),
  savedHint: $('saved-hint'),
  status: $('status'),
};

const AI_FIELDS = ['aiEnabled', 'aiSearchHistory', 'aiProvider', 'aiEndpoint', 'aiModel', 'aiKey', 'aiLength', 'aiTemperature', 'aiPrompt'];
const DAV_FIELDS = ['davServer', 'davPath', 'davFile', 'davUser', 'davPassword', 'davAuto'];
const pendingSections = new Set();
let saveTimer = null;

function setStatus(message, isError = false) {
  elements.status.textContent = message || '';
  elements.status.classList.toggle('error', isError);
}

function formatTime(iso) {
  if (!toTime(iso)) return '';
  return new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function renderSyncStatus(status = {}) {
  const { syncState, syncMeta, syncError } = elements;
  syncState.className = 'sync-state';
  if (status.running) {
    syncState.classList.add('running');
    syncState.textContent = '同步中…';
  } else if (status.lastError) {
    syncState.classList.add('error');
    syncState.textContent = '同步失败';
  } else if (status.lastSyncAt) {
    syncState.classList.add('ok');
    syncState.textContent = '已同步';
  } else {
    syncState.textContent = '未同步';
  }
  syncMeta.textContent = status.lastSyncAt ? `上次成功：${formatTime(status.lastSyncAt)}` : '拉取远端 → 合并 → 写回，不会用旧数据覆盖新数据';
  elements.syncErrorRow.hidden = !status.lastError;
  syncError.textContent = status.lastError ? `${formatTime(status.lastErrorAt)} · ${status.lastError}` : '';
}

function populateProviders() {
  elements.aiProvider.innerHTML = Object.entries(AI_PROVIDERS)
    .map(([key, provider]) => `<option value="${key}">${provider.label}</option>`)
    .join('');
}

function applyProviderHint(providerKey) {
  const provider = AI_PROVIDERS[providerKey] || AI_PROVIDERS.qwen;
  elements.aiHint.textContent = `默认：${provider.endpoint}；${provider.modelHint}`;
}

function fillForm(state) {
  const { ai, webdav } = state.settings;

  elements.aiEnabled.checked = Boolean(ai.enabled);
  elements.aiSearchHistory.checked = Boolean(ai.searchHistory);
  elements.aiProvider.value = ai.provider || 'qwen';
  elements.aiEndpoint.value = ai.endpoint || '';
  elements.aiModel.value = ai.model || '';
  elements.aiKey.value = ai.apiKey || '';
  elements.aiLength.value = ai.summaryLength || 48;
  elements.aiTemperature.value = ai.temperature ?? 0.2;
  elements.aiPrompt.value = ai.systemPrompt || '';

  elements.davServer.value = webdav.serverUrl || '';
  elements.davPath.value = webdav.remotePath || '/glasstab';
  elements.davFile.value = webdav.fileName || 'glasstab-backup.json';
  elements.davUser.value = webdav.username || '';
  elements.davPassword.value = webdav.password || '';
  elements.davAuto.checked = Boolean(webdav.autoSync);
  elements.unsplashKey.value = state.settings.wallpaper.unsplashKey || '';

  applyProviderHint(elements.aiProvider.value);
}

function readSection(section) {
  if (section === 'wallpaper') {
    return { wallpaper: { unsplashKey: elements.unsplashKey.value.trim() } };
  }
  if (section === 'ai') {
    const temperature = Number(elements.aiTemperature.value);
    return {
      ai: {
        enabled: elements.aiEnabled.checked,
        searchHistory: elements.aiSearchHistory.checked,
        provider: elements.aiProvider.value,
        endpoint: elements.aiEndpoint.value.trim(),
        model: elements.aiModel.value.trim(),
        apiKey: elements.aiKey.value.trim(),
        summaryLength: Number(elements.aiLength.value) || 48,
        temperature: Number.isFinite(temperature) ? temperature : 0.2,
        systemPrompt: elements.aiPrompt.value.trim(),
      },
    };
  }
  return {
    webdav: {
      serverUrl: elements.davServer.value.trim(),
      remotePath: elements.davPath.value.trim(),
      fileName: elements.davFile.value.trim(),
      username: elements.davUser.value.trim(),
      password: elements.davPassword.value,
      autoSync: elements.davAuto.checked,
    },
  };
}

async function flushSave() {
  clearTimeout(saveTimer);
  if (!pendingSections.size) return;
  const sections = Array.from(pendingSections);
  pendingSections.clear();
  // 只提交改动过的分区，避免仅改 WebDAV 也刷新 AI 设置的同步时间戳。
  for (const section of sections) {
    await patchSettings(readSection(section));
  }
  elements.savedHint.textContent = '已保存';
  setTimeout(() => {
    elements.savedHint.textContent = '修改后自动保存';
  }, 1600);
}

function scheduleSave(section, immediate = false) {
  pendingSections.add(section);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => flushSave().catch((error) => setStatus(error.message, true)), immediate ? 0 : 600);
}

async function withAction(button, action) {
  const buttons = [elements.syncButton, elements.restoreButton, elements.overwriteButton];
  try {
    buttons.forEach((item) => { item.disabled = true; });
    await flushSave();
    await action();
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    buttons.forEach((item) => { item.disabled = false; });
  }
}

async function callBackground(type) {
  const response = await chrome.runtime.sendMessage({ type });
  if (!response?.ok) {
    throw new Error(response?.error || '操作失败');
  }
  return response;
}

AI_FIELDS.forEach((key) => {
  const element = elements[key];
  const immediate = element.type === 'checkbox' || element.tagName === 'SELECT';
  element.addEventListener(immediate ? 'change' : 'input', () => scheduleSave('ai', immediate));
});

DAV_FIELDS.forEach((key) => {
  const element = elements[key];
  const immediate = element.type === 'checkbox';
  element.addEventListener(immediate ? 'change' : 'input', () => scheduleSave('webdav', immediate));
});

elements.unsplashKey.addEventListener('input', () => scheduleSave('wallpaper'));

elements.unsplashTest.addEventListener('click', async () => {
  const button = elements.unsplashTest;
  button.disabled = true;
  elements.unsplashMeta.textContent = '正在连接 Unsplash…';
  try {
    await flushSave();
    const { remaining } = await testUnsplashKey(elements.unsplashKey.value.trim());
    elements.unsplashMeta.textContent = `连接成功${remaining ? `，本小时还剩 ${remaining} 次请求` : ''}`;
  } catch (error) {
    elements.unsplashMeta.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

elements.aiProvider.addEventListener('change', () => {
  const provider = AI_PROVIDERS[elements.aiProvider.value] || AI_PROVIDERS.qwen;
  elements.aiEndpoint.value = provider.endpoint;
  const knownDefaults = Object.values(AI_PROVIDERS).map((item) => item.defaultModel);
  if (!elements.aiModel.value || knownDefaults.includes(elements.aiModel.value)) {
    elements.aiModel.value = provider.defaultModel || '';
  }
  applyProviderHint(elements.aiProvider.value);
});

elements.syncButton.addEventListener('click', () => {
  withAction(elements.syncButton, async () => {
    setStatus('');
    await callBackground('sync-now');
    setStatus('同步完成。');
  });
});

elements.restoreButton.addEventListener('click', () => {
  withAction(elements.restoreButton, async () => {
    if (!window.confirm('用远端文件完全覆盖本机数据？本机尚未同步的修改会丢失。')) return;
    await callBackground('restore-now');
    fillForm(await getState());
    setStatus('已用远端数据覆盖本机。');
  });
});

elements.overwriteButton.addEventListener('click', () => {
  withAction(elements.overwriteButton, async () => {
    if (!window.confirm('用本机数据完全覆盖远端文件？其他设备尚未同步的修改会丢失。')) return;
    await callBackground('overwrite-remote');
    setStatus('已用本机数据覆盖远端。');
  });
});

// ---------- 本机备份：导出 / 导入（完整数据，含本机专属设置） ----------

$('export-btn').addEventListener('click', async () => {
  try {
    await flushSave();
    const payload = {
      app: 'glasstab',
      kind: 'full-export',
      schemaVersion: APP_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      state: await getState(),
      assets: await listAssets(),
    };
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const link = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    link.href = URL.createObjectURL(blob);
    link.download = `glasstab-config-${stamp}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 2000);
    setStatus('已导出配置文件。');
  } catch (error) {
    setStatus(`导出失败：${error.message}`, true);
  }
});

$('import-file').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    if (!payload?.state) {
      throw new Error('不是 GlassTab 导出的配置文件。');
    }
    if (!window.confirm('用这个文件完整替换本机数据和设置？')) return;
    const imported = normalizeState(payload.state);
    imported.meta.pristine = false;
    await replaceAllAssets(Array.isArray(payload.assets) ? payload.assets : []);
    await saveState(imported);
    fillForm(await getState());
    setStatus('导入完成。');
  } catch (error) {
    setStatus(`导入失败：${error.message}`, true);
  }
});

window.addEventListener('beforeunload', () => {
  flushSave();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes[SYNC_STATUS_KEY]) {
    renderSyncStatus(changes[SYNC_STATUS_KEY].newValue || {});
  }
});

if (new URLSearchParams(window.location.search).get('returnTo') !== 'tab') {
  $('back-link').hidden = true;
}

populateProviders();
getState()
  .then(fillForm)
  .catch((error) => setStatus(error.message, true));
chrome.storage.local.get(SYNC_STATUS_KEY).then((result) => renderSyncStatus(result[SYNC_STATUS_KEY] || {}));
