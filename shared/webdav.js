import { BACKUP_FILE_NAME } from './constants.js';
import { joinUrl, toBasicAuth, truncate } from './utils.js';

function normalizeSettings(settings = {}) {
  return {
    serverUrl: String(settings.serverUrl || '').trim().replace(/\/+$/, ''),
    remotePath: String(settings.remotePath || '/glasstab').trim(),
    fileName: String(settings.fileName || BACKUP_FILE_NAME).trim(),
    username: String(settings.username || ''),
    password: String(settings.password || ''),
  };
}

function buildHeaders(settings, extraHeaders = {}) {
  const headers = new Headers(extraHeaders);
  if (settings.username || settings.password) {
    headers.set('Authorization', toBasicAuth(settings.username, settings.password));
  }
  return headers;
}

function getRemoteSegments(remotePath) {
  return remotePath
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);
}

export function buildBackupUrl(rawSettings = {}) {
  const settings = normalizeSettings(rawSettings);
  return joinUrl(joinUrl(settings.serverUrl, settings.remotePath), settings.fileName);
}

export async function ensureRemotePath(rawSettings = {}) {
  const settings = normalizeSettings(rawSettings);

  if (!settings.serverUrl) {
    throw new Error('WebDAV 地址为空。');
  }

  const segments = getRemoteSegments(settings.remotePath);
  let currentUrl = settings.serverUrl;

  for (const segment of segments) {
    currentUrl = joinUrl(currentUrl, encodeURIComponent(segment));
    const response = await fetch(currentUrl, {
      method: 'MKCOL',
      headers: buildHeaders(settings),
    });

    if (response.ok || [301, 302, 405, 409].includes(response.status)) {
      continue;
    }

    const rawText = await response.text();
    throw new Error(`创建 WebDAV 目录失败 (${response.status}): ${truncate(rawText, 120)}`);
  }
}

export async function backupToWebDav(payload, rawSettings = {}) {
  const settings = normalizeSettings(rawSettings);
  if (!settings.serverUrl) {
    throw new Error('请先在设置页填写 WebDAV 地址。');
  }

  await ensureRemotePath(settings);

  const response = await fetch(buildBackupUrl(settings), {
    method: 'PUT',
    headers: buildHeaders(settings, {
      'Content-Type': 'application/json; charset=utf-8',
    }),
    body: JSON.stringify(payload, null, 2),
  });

  if (!response.ok) {
    const rawText = await response.text();
    throw new Error(`WebDAV 备份失败 (${response.status}): ${truncate(rawText, 180)}`);
  }

  return buildBackupUrl(settings);
}

export async function restoreFromWebDav(rawSettings = {}) {
  const settings = normalizeSettings(rawSettings);
  if (!settings.serverUrl) {
    throw new Error('请先在设置页填写 WebDAV 地址。');
  }

  const response = await fetch(buildBackupUrl(settings), {
    method: 'GET',
    headers: buildHeaders(settings),
  });

  if (!response.ok) {
    const rawText = await response.text();
    throw new Error(`WebDAV 恢复失败 (${response.status}): ${truncate(rawText, 180)}`);
  }

  return response.json();
}
