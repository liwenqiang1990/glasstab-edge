export function deepClone(value) {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

export function nowIso() {
  return new Date().toISOString();
}

export function generateId(prefix = 'id') {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

export function safeJsonParse(raw, fallback = null) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    return fallback;
  }
}

export function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function normalizeUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) {
    return '';
  }

  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(value)) {
    return value;
  }

  return `https://${value}`;
}

export function getHostname(rawUrl) {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, '');
  } catch (error) {
    return rawUrl || '';
  }
}

export function joinUrl(base, path = '') {
  const left = String(base || '').replace(/\/+$/, '');
  const right = String(path || '').replace(/^\/+/, '');
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return `${left}/${right}`;
}

export async function blobToDataUrl(blob) {
  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('读取二进制数据失败'));
      reader.readAsDataURL(blob);
    });
  }

  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`;
}

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

export function toBasicAuth(username = '', password = '') {
  const source = `${username}:${password}`;
  const bytes = new TextEncoder().encode(source);
  let binary = '';
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return `Basic ${btoa(binary)}`;
}

export function truncate(value = '', maxLength = 140) {
  const text = String(value || '').trim();
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 1))}\u2026`;
}

export function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

export function toTime(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? time : 0;
}
