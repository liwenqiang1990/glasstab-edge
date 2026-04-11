import { AI_PROVIDERS } from './shared/constants.js';
import { getState } from './shared/storage.js';

const elements = {
  aiEnabled: document.getElementById('ai-enabled'),
  aiProvider: document.getElementById('ai-provider'),
  aiEndpoint: document.getElementById('ai-endpoint'),
  aiModel: document.getElementById('ai-model'),
  aiKey: document.getElementById('ai-key'),
  aiLength: document.getElementById('ai-length'),
  aiTemperature: document.getElementById('ai-temperature'),
  aiPrompt: document.getElementById('ai-prompt'),
  aiHint: document.getElementById('ai-hint'),
  davServer: document.getElementById('dav-server'),
  davPath: document.getElementById('dav-path'),
  davFile: document.getElementById('dav-file'),
  davUser: document.getElementById('dav-user'),
  davPassword: document.getElementById('dav-password'),
  davAuto: document.getElementById('dav-auto'),
  saveButton: document.getElementById('save-btn'),
  backupButton: document.getElementById('backup-btn'),
  restoreButton: document.getElementById('restore-btn'),
  status: document.getElementById('status'),
  backupMeta: document.getElementById('backup-meta'),
};

let currentState = null;
const returnTo = new URLSearchParams(window.location.search).get('returnTo') || '';

function setStatus(message) {
  elements.status.textContent = message || '';
}

function setBackupMeta() {
  const lastBackupAt = currentState?.settings?.webdav?.lastBackupAt;
  elements.backupMeta.textContent = lastBackupAt ? `最近备份时间: ${new Date(lastBackupAt).toLocaleString()}` : '还没有成功备份记录。';
}

function populateProviders() {
  elements.aiProvider.innerHTML = Object.entries(AI_PROVIDERS)
    .map(([key, provider]) => `<option value="${key}">${provider.label}</option>`)
    .join('');
}

function applyProviderHint(providerKey) {
  const provider = AI_PROVIDERS[providerKey] || AI_PROVIDERS.qwen;
  elements.aiHint.textContent = `默认 endpoint: ${provider.endpoint}；${provider.modelHint}`;
}

function fillFormFromState() {
  const { ai, webdav } = currentState.settings;

  elements.aiEnabled.checked = Boolean(ai.enabled);
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
  elements.davAuto.checked = Boolean(webdav.autoBackup);

  applyProviderHint(elements.aiProvider.value);
  setBackupMeta();
}

async function reloadState() {
  currentState = await getState();
  fillFormFromState();
}

function goBackAfterSave() {
  if (returnTo === 'tab') {
    window.location.href = chrome.runtime.getURL('tab.html');
    return;
  }
}

async function saveSettings() {
  const provider = elements.aiProvider.value;

  const response = await chrome.runtime.sendMessage({
    type: 'save-settings',
    payload: {
      ai: {
        enabled: elements.aiEnabled.checked,
        provider,
        endpoint: elements.aiEndpoint.value.trim(),
        model: elements.aiModel.value.trim(),
        apiKey: elements.aiKey.value.trim(),
        summaryLength: Number(elements.aiLength.value) || 48,
        temperature: Number(elements.aiTemperature.value) || 0.2,
        systemPrompt: elements.aiPrompt.value.trim(),
      },
      webdav: {
        serverUrl: elements.davServer.value.trim(),
        remotePath: elements.davPath.value.trim(),
        fileName: elements.davFile.value.trim(),
        username: elements.davUser.value.trim(),
        password: elements.davPassword.value,
        autoBackup: elements.davAuto.checked,
      },
    },
  });

  if (!response?.ok) {
    throw new Error(response?.error || '保存设置失败');
  }

  await reloadState();
}

async function withAction(action) {
  try {
    [elements.saveButton, elements.backupButton, elements.restoreButton].forEach((button) => {
      button.disabled = true;
    });
    await action();
  } catch (error) {
    setStatus(error.message);
  } finally {
    [elements.saveButton, elements.backupButton, elements.restoreButton].forEach((button) => {
      button.disabled = false;
    });
  }
}

elements.aiProvider.addEventListener('change', () => {
  const provider = AI_PROVIDERS[elements.aiProvider.value] || AI_PROVIDERS.qwen;
  elements.aiEndpoint.value = provider.endpoint;
  if (!elements.aiModel.value || elements.aiModel.value === (AI_PROVIDERS.qwen.defaultModel || '')) {
    elements.aiModel.value = provider.defaultModel || '';
  }
  applyProviderHint(elements.aiProvider.value);
});

elements.saveButton.addEventListener('click', () => {
  withAction(async () => {
    setStatus('正在保存设置...');
    await saveSettings();
    setStatus('设置已保存，正在返回主页...');
    goBackAfterSave();
  });
});

elements.backupButton.addEventListener('click', () => {
  withAction(async () => {
    setStatus('正在备份到 WebDAV...');
    await saveSettings();
    const response = await chrome.runtime.sendMessage({ type: 'backup-now' });
    if (!response?.ok) {
      throw new Error(response?.error || 'WebDAV 备份失败');
    }
    await reloadState();
    setStatus(`备份完成: ${response.url}`);
  });
});

elements.restoreButton.addEventListener('click', () => {
  withAction(async () => {
    const confirmed = window.confirm('恢复会用 WebDAV 备份覆盖当前本地数据，确定继续吗？');
    if (!confirmed) {
      return;
    }
    setStatus('正在从 WebDAV 恢复...');
    await saveSettings();
    const response = await chrome.runtime.sendMessage({ type: 'restore-now' });
    if (!response?.ok) {
      throw new Error(response?.error || 'WebDAV 恢复失败');
    }
    await reloadState();
    setStatus('恢复完成，本地数据已覆盖。');
  });
});

populateProviders();
reloadState().catch((error) => setStatus(error.message));
