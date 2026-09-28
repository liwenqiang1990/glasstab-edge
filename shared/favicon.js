import { blobToDataUrl, fileToDataUrl, getHostname, normalizeUrl } from './utils.js';

// 图标资产版本。rev 2 起优先抓高清满版图标，rev 3 加入 Google 图标服务；旧版本的图标会被自动重新抓一次。
export const ICON_REV = 3;

const LINK_TAG_PATTERN = /<link\b[^>]*>/gi;
const ATTRIBUTE_PATTERN = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
const MAX_CANDIDATES = 7;
const FETCH_TIMEOUT_MS = 6000;

function parseAttributes(tag) {
  const attributes = {};
  let match;
  ATTRIBUTE_PATTERN.lastIndex = 0;
  while ((match = ATTRIBUTE_PATTERN.exec(tag))) {
    const name = match[1]?.toLowerCase();
    if (name) {
      attributes[name] = match[2] || match[3] || match[4] || '';
    }
  }
  return attributes;
}

function largestSize(sizes = '') {
  if (/any/i.test(sizes)) {
    return 256;
  }
  const values = String(sizes)
    .split(/\s+/)
    .map((value) => Number(value.split(/x/i)[0]))
    .filter(Number.isFinite);
  return values.length ? Math.max(...values) : 0;
}

// 预估分：越可能是高清满版图标越靠前。
function estimateScore({ rel = '', sizes = '', type = '', href = '', purpose = '' }) {
  const size = largestSize(sizes);
  const isSvg = /svg/i.test(type) || /\.svg(\?|$)/i.test(href);
  let score = Math.min(size, 512);
  if (/apple-touch-icon/i.test(rel)) score += 220;
  if (/maskable/i.test(purpose)) score += 160;
  if (isSvg) score += 90;
  if (!size && !/apple-touch-icon/i.test(rel) && !isSvg) score += 16;
  return score;
}

function safeUrl(href, baseUrl) {
  try {
    return new URL(href, baseUrl).href;
  } catch (error) {
    return '';
  }
}

async function fetchWithTimeout(url, options = {}) {
  return fetch(url, { cache: 'no-store', redirect: 'follow', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), ...options });
}

async function manifestCandidates(manifestUrl) {
  try {
    const response = await fetchWithTimeout(manifestUrl);
    if (!response.ok) return [];
    const manifest = await response.json();
    return (manifest?.icons || [])
      .map((item) => ({
        url: safeUrl(item.src, response.url || manifestUrl),
        score: estimateScore({ sizes: item.sizes, type: item.type, href: item.src, purpose: item.purpose }),
      }))
      .filter((item) => item.url);
  } catch (error) {
    return [];
  }
}

async function pageCandidates(html, baseUrl) {
  const candidates = [];
  const manifests = [];
  (html.match(LINK_TAG_PATTERN) || []).forEach((tag) => {
    const attributes = parseAttributes(tag);
    const rel = String(attributes.rel || '').toLowerCase();
    if (!attributes.href) return;
    if (/(^|\s)manifest(\s|$)/.test(rel)) {
      manifests.push(safeUrl(attributes.href, baseUrl));
      return;
    }
    if (!/(^|\s)(icon|apple-touch-icon|apple-touch-icon-precomposed)(\s|$)/.test(rel)) return;
    const url = safeUrl(attributes.href, baseUrl);
    if (url) {
      candidates.push({ url, score: estimateScore({ ...attributes, rel }) });
    }
  });
  for (const manifestUrl of manifests.filter(Boolean).slice(0, 1)) {
    candidates.push(...(await manifestCandidates(manifestUrl)));
  }
  return candidates;
}

// 量尺寸并判断边缘是否不透明（不透明 = 自带底色的满版图标，可直接铺满圆角方块）。
async function measureBlob(blob) {
  if (/svg/i.test(blob.type) || typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') {
    return { width: 256, opaque: false };
  }
  try {
    const bitmap = await createImageBitmap(blob);
    const size = 32;
    const canvas = new OffscreenCanvas(size, size);
    const context = canvas.getContext('2d');
    context.drawImage(bitmap, 0, 0, size, size);
    const { data } = context.getImageData(0, 0, size, size);
    const alphaAt = (x, y) => data[(y * size + x) * 4 + 3];
    const probes = [[16, 1], [16, 30], [1, 16], [30, 16], [4, 4], [27, 4], [4, 27], [27, 27]];
    const opaque = probes.every(([x, y]) => alphaAt(x, y) > 200);
    return { width: Math.min(bitmap.width, bitmap.height), opaque };
  } catch (error) {
    return { width: 0, opaque: false };
  }
}

export async function fetchImageAsDataUrl(imageUrl) {
  const response = await fetchWithTimeout(imageUrl);
  if (!response.ok) {
    throw new Error(`图标请求失败: ${response.status}`);
  }

  const blob = await response.blob();
  if (!blob.type.startsWith('image/') && !/\.ico(\?|$)/i.test(imageUrl)) {
    throw new Error('目标资源不是图片');
  }
  const measured = await measureBlob(blob);
  if (!measured.width) {
    throw new Error('图片无法解码');
  }

  return {
    dataUrl: await blobToDataUrl(blob),
    mimeType: blob.type || 'image/x-icon',
    sourceUrl: response.url || imageUrl,
    ...measured,
  };
}

const FALLBACK_PALETTE = ['#5b6ee1', '#2f9e8f', '#d9774b', '#b55a8a', '#4f8fc0', '#7a6bd1', '#c0913f', '#4d9a5b'];

export function createFallbackIconDataUrl(label = '') {
  const text = String(label || '').trim();
  const firstChar = (Array.from(text)[0] || '?').toUpperCase();
  const safeLabel = firstChar.replace(/[<>&"']/g, '');
  const hash = Array.from(text).reduce((sum, char) => (sum * 31 + char.codePointAt(0)) >>> 0, 7);
  const color = FALLBACK_PALETTE[hash % FALLBACK_PALETTE.length];
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
      <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
      <rect width="128" height="128" fill="${color}" />
      <rect width="128" height="128" fill="url(#g)" />
      <text x="50%" y="50%" dy="0.35em" text-anchor="middle" font-size="60" font-family="-apple-system, Segoe UI, PingFang SC, Microsoft YaHei, sans-serif" font-weight="600" fill="#ffffff">${safeLabel}</text>
    </svg>
  `;

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function fallbackResult(label) {
  return {
    dataUrl: createFallbackIconDataUrl(label || 'G'),
    mimeType: 'image/svg+xml',
    sourceUrl: 'fallback',
    width: 128,
    opaque: true,
  };
}

// Google 图标服务：有高清图标时返回最大 256px；完全不认识的站点返回 404。
export function googleIconUrl(origin) {
  return `https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(origin)}&size=256`;
}

// 网站自身能找到的所有候选（页面声明的 + 常见路径）。
async function siteCandidates(normalizedUrl) {
  const origin = new URL(normalizedUrl).origin;
  const candidates = [];
  try {
    const response = await fetchWithTimeout(normalizedUrl);
    const contentType = response.headers.get('content-type') || '';
    if (response.ok && contentType.includes('text/html')) {
      const html = (await response.text()).slice(0, 300000);
      candidates.push(...(await pageCandidates(html, response.url || normalizedUrl)));
    }
  } catch (error) {
    // 页面打不开（比如需要登录）就只试常见路径。
  }
  candidates.push(
    { url: `${origin}/apple-touch-icon.png`, score: 300 },
    { url: `${origin}/apple-touch-icon-precomposed.png`, score: 290 },
    { url: `${origin}/favicon.ico`, score: 12 },
    { url: `${origin}/favicon.png`, score: 10 },
  );
  return candidates;
}

// 给「选择图标」面板用：列出所有来源的候选地址，由调用方逐个加载。
export async function listIconCandidates(url) {
  const normalizedUrl = normalizeUrl(url);
  if (!normalizedUrl) return [];
  const { origin, hostname } = new URL(normalizedUrl);
  const site = (await siteCandidates(normalizedUrl)).map((candidate) => ({ ...candidate, source: '网站' }));
  return [
    ...site,
    { url: googleIconUrl(origin), source: 'Google' },
    { url: `https://icon.horse/icon/${hostname}`, source: 'icon.horse' },
    { url: `https://icons.duckduckgo.com/ip3/${hostname}.ico`, source: 'DuckDuckGo' },
  ];
}

// App Store（中国区）按名称搜 App 图标，512px 满版。
export async function searchAppStoreIcons(term, limit = 8) {
  const keyword = String(term || '').trim();
  if (!keyword) return [];
  const response = await fetchWithTimeout(`https://itunes.apple.com/search?term=${encodeURIComponent(keyword)}&entity=software&country=cn&limit=${limit}`);
  if (!response.ok) {
    throw new Error(`App Store 搜索失败 (${response.status})`);
  }
  const data = await response.json();
  return (data?.results || [])
    .filter((item) => item.artworkUrl512)
    .map((item) => ({ url: item.artworkUrl512, label: item.trackName, source: 'App Store' }));
}

// 候选里挑最好的：不透明且足够大的直接用，否则取分数最高的。
export async function discoverIcon(url, label = '', extraCandidates = []) {
  const normalizedUrl = normalizeUrl(url);
  if (!normalizedUrl) {
    return fallbackResult(label);
  }
  const hostLabel = label || getHostname(normalizedUrl);
  const origin = new URL(normalizedUrl).origin;
  const candidates = [...extraCandidates, ...(await siteCandidates(normalizedUrl))];
  candidates.push({ url: googleIconUrl(origin), score: 260 });

  const seen = new Set();
  const ordered = candidates
    .filter((candidate) => candidate.url && !seen.has(candidate.url) && seen.add(candidate.url))
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_CANDIDATES + 2);

  let best = null;
  let tried = 0;
  for (const candidate of ordered) {
    if (tried >= MAX_CANDIDATES) break;
    tried += 1;
    try {
      const result = await fetchImageAsDataUrl(candidate.url);
      const quality = (result.opaque && result.width >= 96 ? 1000 : 0) + Math.min(result.width, 256) + (/svg/i.test(result.mimeType) ? 120 : 0);
      if (!best || quality > best.quality) {
        best = { ...result, quality };
      }
      if (result.opaque && result.width >= 120) break;
    } catch (error) {
      // 试下一个
    }
  }

  if (!best) {
    return fallbackResult(hostLabel);
  }
  const { quality, ...icon } = best;
  return icon;
}

export async function readUploadedIcon(file) {
  return {
    dataUrl: await fileToDataUrl(file),
    mimeType: file.type || 'image/png',
    sourceUrl: 'upload',
  };
}
