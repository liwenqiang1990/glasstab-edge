import { BACKUP_FILE_NAME } from './constants.js';
import { joinUrl, toBasicAuth, truncate } from './utils.js';

export class WebDavConflictError extends Error {
  constructor() {
    super('远端文件在同步过程中被其他设备修改。');
    this.name = 'WebDavConflictError';
  }
}

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

function requireServer(settings) {
  if (!settings.serverUrl) {
    throw new Error('请先在设置页填写 WebDAV 地址。');
  }
}

export function buildBackupUrl(rawSettings = {}) {
  const settings = normalizeSettings(rawSettings);
  const segments = getRemoteSegments(settings.remotePath).map((segment) => encodeURIComponent(segment));
  return joinUrl(joinUrl(settings.serverUrl, segments.join('/')), encodeURIComponent(settings.fileName));
}

export async function ensureRemotePath(rawSettings = {}) {
  const settings = normalizeSettings(rawSettings);
  requireServer(settings);

  let currentUrl = settings.serverUrl;
  for (const segment of getRemoteSegments(settings.remotePath)) {
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

// 读取远端备份。文件不存在时返回 { payload: null }。
export async function fetchRemote(rawSettings = {}) {
  const settings = normalizeSettings(rawSettings);
  requireServer(settings);

  const response = await fetch(buildBackupUrl(settings), {
    method: 'GET',
    cache: 'no-store',
    headers: buildHeaders(settings),
  });

  if (response.status === 404) {
    return { payload: null, etag: '' };
  }

  if (!response.ok) {
    const rawText = await response.text();
    throw new Error(`读取 WebDAV 失败 (${response.status}): ${truncate(rawText, 180)}`);
  }

  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    throw new Error('远端备份文件不是有效的 JSON，已停止同步以免覆盖。');
  }

  return { payload, etag: response.headers.get('ETag') || '' };
}

// 写入远端。传了 etag 就带 If-Match，远端被别人改过时服务器返回 412，抛出冲突让调用方重来。
export async function pushRemote(payload, rawSettings = {}, { etag = '', conditional = true } = {}) {
  const settings = normalizeSettings(rawSettings);
  requireServer(settings);

  await ensureRemotePath(settings);

  const headers = buildHeaders(settings, { 'Content-Type': 'application/json; charset=utf-8' });
  if (conditional && etag) {
    headers.set('If-Match', etag);
  }

  const response = await fetch(buildBackupUrl(settings), {
    method: 'PUT',
    headers,
    body: JSON.stringify(payload),
  });

  if (response.status === 412) {
    throw new WebDavConflictError();
  }

  if (!response.ok) {
    const rawText = await response.text();
    throw new Error(`写入 WebDAV 失败 (${response.status}): ${truncate(rawText, 180)}`);
  }

  return buildBackupUrl(settings);
}
