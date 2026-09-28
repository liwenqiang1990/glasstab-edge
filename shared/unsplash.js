// Unsplash 壁纸。按官方 API 规范：
// 1. 图片直接用 API 返回的 images.unsplash.com 地址加载（不转存），浏览器 HTTP 缓存负责提速；
// 2. 显示摄影师与 Unsplash 署名，链接带 utm 参数；
// 3. 每张图第一次展示时调用 download_location 计一次下载。

const API = 'https://api.unsplash.com';
const META_KEY = 'glasstab_unsplash_v1';
const UTM = 'utm_source=glasstab&utm_medium=referral';
const BATCH_SIZE = 12;

// 主题（Unsplash 官方 topic slug）
export const UNSPLASH_TOPICS = [
  ['topic:wallpapers', '壁纸'],
  ['topic:nature', '自然'],
  ['topic:architecture-interior', '建筑'],
  ['topic:travel', '旅行'],
  ['topic:textures-patterns', '纹理'],
  ['topic:street-photography', '街景'],
];

export class UnsplashError extends Error {}

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

function withUtm(url) {
  return url ? `${url}${url.includes('?') ? '&' : '?'}${UTM}` : '';
}

async function readMeta() {
  const result = await chrome.storage.local.get(META_KEY);
  return { query: '', photos: [], index: 0, shownOn: '', ...(result[META_KEY] || {}) };
}

async function writeMeta(meta) {
  await chrome.storage.local.set({ [META_KEY]: meta });
}

async function request(path, key, params = {}) {
  if (!key) {
    throw new UnsplashError('还没有填写 Unsplash Access Key。');
  }
  const url = new URL(`${API}${path}`);
  Object.entries(params).forEach(([name, value]) => value !== undefined && url.searchParams.set(name, value));
  let response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Client-ID ${key}`, 'Accept-Version': 'v1' },
      cache: 'no-store',
    });
  } catch (error) {
    throw new UnsplashError('无法连接 Unsplash，请检查网络。');
  }
  if (response.status === 401) throw new UnsplashError('Access Key 无效，请到设置里检查。');
  if (response.status === 403) throw new UnsplashError('本小时请求次数已用完（Demo 应用每小时 50 次），稍后再试。');
  if (response.status === 404) throw new UnsplashError('没有找到这个主题或关键词的图片。');
  if (!response.ok) throw new UnsplashError(`Unsplash 请求失败 (${response.status})`);
  return { data: await response.json(), remaining: response.headers.get('X-Ratelimit-Remaining') };
}

function imageWidth() {
  return Math.min(3840, Math.round(window.screen.width * window.devicePixelRatio / 160) * 160 || 2560);
}

function toPhoto(raw) {
  const width = imageWidth();
  return {
    id: raw.id,
    url: `${raw.urls.raw}&w=${width}&q=82&fm=jpg&fit=max`,
    color: raw.color || '#26282e',
    title: raw.location?.name || raw.description || raw.alt_description || '',
    author: raw.user?.name || 'Unknown',
    authorUrl: withUtm(raw.user?.links?.html),
    photoUrl: withUtm(raw.links?.html),
    downloadLocation: raw.links?.download_location || '',
    tracked: false,
  };
}

function queryParams(query) {
  const base = { count: BATCH_SIZE, orientation: 'landscape', content_filter: 'high' };
  if (query.startsWith('topic:')) {
    return { ...base, topics: query.slice(6) };
  }
  return { ...base, query };
}

async function fetchBatch(key, query) {
  const { data } = await request('/photos/random', key, queryParams(query));
  const photos = (Array.isArray(data) ? data : [data]).filter((item) => item?.urls?.raw).map(toPhoto);
  if (!photos.length) {
    throw new UnsplashError('没有找到这个主题或关键词的图片。');
  }
  return photos;
}

// 设置页「测试」用：验证 Key 并返回本小时剩余次数。
export async function testUnsplashKey(key) {
  const { remaining } = await request('/photos/random', key, { orientation: 'landscape', count: 1 });
  return { remaining };
}

function trackDownload(photo, key) {
  if (!photo.downloadLocation) return;
  fetch(photo.downloadLocation, { headers: { Authorization: `Client-ID ${key}` } }).catch(() => {});
}

function darken(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!match) return '#26282e';
  const value = parseInt(match[1], 16);
  const channel = (shift) => Math.round(((value >> shift) & 255) * 0.72);
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}

// 串行执行：同一时刻多处触发（比如切换主题 + 设置变更监听）只会请求一次 API。
let queue = Promise.resolve();

// advance: 'auto' = 按轮换规则（每天/每次打开）决定是否换下一张；数字 = 手动前后翻；false = 保持当前。
export function resolveUnsplash(settings, advance = false) {
  const task = queue.then(() => resolveUnsplashNow(settings, advance));
  queue = task.catch(() => {});
  return task;
}

async function resolveUnsplashNow(settings, advance) {
  const key = settings.unsplashKey;
  const query = settings.unsplashQuery;
  let meta = await readMeta();

  if (meta.query !== query || !meta.photos.length) {
    meta = { query, photos: await fetchBatch(key, query), index: 0, shownOn: todayKey() };
  } else {
    let step = 0;
    if (typeof advance === 'number') step = advance;
    else if (advance === 'auto') {
      step = settings.unsplashRotate === 'tab' || meta.shownOn !== todayKey() ? 1 : 0;
    }
    let index = Math.max(0, meta.index + step);
    if (index >= meta.photos.length) {
      // 用完了再取一批，保留当前这张作为“上一张”。
      meta.photos = [meta.photos[meta.photos.length - 1], ...(await fetchBatch(key, query))];
      index = 1;
    }
    meta.index = index;
    meta.shownOn = todayKey();
  }

  const photo = meta.photos[meta.index];
  if (!photo.tracked) {
    trackDownload(photo, key);
    photo.tracked = true;
  }
  await writeMeta(meta);

  // 预热下一张，切换时基本秒开。
  const next = meta.photos[meta.index + 1];
  if (next) {
    const preload = new Image();
    preload.src = next.url;
  }

  return {
    kind: 'image',
    url: photo.url,
    remote: true,
    color: darken(photo.color),
    credit: {
      source: 'unsplash',
      title: photo.title,
      author: photo.author,
      authorUrl: photo.authorUrl,
      photoUrl: photo.photoUrl,
      unsplashUrl: `https://unsplash.com/?${UTM}`,
    },
    position: `${meta.index + 1} / ${meta.photos.length}`,
  };
}
