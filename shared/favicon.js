import { blobToDataUrl, fileToDataUrl, getHostname, normalizeUrl } from './utils.js';

const LINK_TAG_PATTERN = /<link\b[^>]*>/gi;
const ATTRIBUTE_PATTERN = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
const ICON_REL_PATTERN = /(icon|shortcut icon|apple-touch-icon|mask-icon)/i;

function parseAttributes(tag) {
  const attributes = {};
  let match;

  while ((match = ATTRIBUTE_PATTERN.exec(tag))) {
    const name = match[1]?.toLowerCase();
    const value = match[2] || match[3] || match[4] || '';
    if (name) {
      attributes[name] = value;
    }
  }

  return attributes;
}

function scoreLink(attributes) {
  let score = 0;
  const rel = String(attributes.rel || '').toLowerCase();
  const sizes = String(attributes.sizes || '');

  if (rel.includes('apple-touch-icon')) {
    score += 48;
  }
  if (rel.includes('shortcut')) {
    score += 16;
  }
  if (rel.includes('icon')) {
    score += 12;
  }

  if (sizes) {
    const sizeValues = sizes
      .split(/\s+/)
      .map((value) => value.split('x').map((part) => Number(part)))
      .flat()
      .filter((value) => Number.isFinite(value));
    if (sizeValues.length) {
      score += Math.min(Math.max(...sizeValues), 256);
    }
  }

  return score;
}

function extractIconCandidates(html, baseUrl) {
  const candidates = [];
  const tags = html.match(LINK_TAG_PATTERN) || [];

  tags.forEach((tag) => {
    const attributes = parseAttributes(tag);
    if (!ICON_REL_PATTERN.test(attributes.rel || '') || !attributes.href) {
      return;
    }

    try {
      candidates.push({
        url: new URL(attributes.href, baseUrl).href,
        score: scoreLink(attributes),
      });
    } catch (error) {
      // Ignore invalid icon links.
    }
  });

  return candidates.sort((left, right) => right.score - left.score);
}

async function fetchImageAsDataUrl(imageUrl) {
  const response = await fetch(imageUrl, { cache: 'no-store', redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`图标请求失败: ${response.status}`);
  }

  const blob = await response.blob();
  if (!blob.type.startsWith('image/')) {
    throw new Error('目标资源不是图片');
  }

  return {
    dataUrl: await blobToDataUrl(blob),
    mimeType: blob.type || 'image/png',
    sourceUrl: response.url || imageUrl,
  };
}

export function createFallbackIconDataUrl(label = '') {
  const firstChar = (String(label || '').trim()[0] || '?').toUpperCase();
  const safeLabel = firstChar.replace(/[<>&]/g, '');
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#f97316" />
          <stop offset="100%" stop-color="#fb7185" />
        </linearGradient>
      </defs>
      <rect width="128" height="128" rx="28" fill="url(#g)" />
      <text x="50%" y="56%" text-anchor="middle" font-size="64" font-family="Segoe UI, Arial, sans-serif" font-weight="700" fill="white">${safeLabel}</text>
    </svg>
  `;

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

export async function discoverIcon(url, label = '') {
  const normalizedUrl = normalizeUrl(url);
  if (!normalizedUrl) {
    return {
      dataUrl: createFallbackIconDataUrl(label || 'G'),
      mimeType: 'image/svg+xml',
      sourceUrl: 'fallback',
    };
  }
  const hostLabel = label || getHostname(normalizedUrl);
  const origin = new URL(normalizedUrl).origin;
  const candidates = [];

  try {
    const response = await fetch(normalizedUrl, { cache: 'no-store', redirect: 'follow' });
    const contentType = response.headers.get('content-type') || '';

    if (response.ok && contentType.includes('text/html')) {
      const html = await response.text();
      candidates.push(...extractIconCandidates(html.slice(0, 200000), response.url || normalizedUrl));
    }
  } catch (error) {
    // Ignore page fetch failures and fallback to common icon paths.
  }

  candidates.push(
    { url: `${origin}/favicon.ico`, score: 4 },
    { url: `${origin}/favicon.png`, score: 3 },
    { url: `${origin}/apple-touch-icon.png`, score: 2 }
  );

  const visited = new Set();

  for (const candidate of candidates) {
    if (!candidate?.url || visited.has(candidate.url)) {
      continue;
    }
    visited.add(candidate.url);

    try {
      return await fetchImageAsDataUrl(candidate.url);
    } catch (error) {
      // Try next candidate.
    }
  }

  return {
    dataUrl: createFallbackIconDataUrl(hostLabel),
    mimeType: 'image/svg+xml',
    sourceUrl: 'fallback',
  };
}

export async function readUploadedIcon(file) {
  return {
    dataUrl: await fileToDataUrl(file),
    mimeType: file.type || 'image/png',
    sourceUrl: 'upload',
  };
}
