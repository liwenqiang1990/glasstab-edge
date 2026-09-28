import { getWallpaperRecord, pruneWallpaperRecords, putWallpaperRecord } from './assets.js';
import { WALLPAPER_META_KEY, WALLPAPER_PRESETS } from './constants.js';
import { UnsplashError, resolveUnsplash } from './unsplash.js';

const BING_HOSTS = ['https://cn.bing.com', 'https://www.bing.com'];
const COLOR_CACHE_KEY = 'glasstab:wallpaper-color';
const CUSTOM_ID = 'custom';
const MAX_CUSTOM_EDGE = 3840;

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

async function readMeta() {
  const result = await chrome.storage.local.get(WALLPAPER_META_KEY);
  return { images: [], index: 0, fetchedOn: '', ...(result[WALLPAPER_META_KEY] || {}) };
}

async function writeMeta(meta) {
  await chrome.storage.local.set({ [WALLPAPER_META_KEY]: meta });
}

function resolutionSuffix() {
  return window.screen.width * window.devicePixelRatio > 2200 ? 'UHD' : '1920x1080';
}

function findPreset(presetId) {
  return WALLPAPER_PRESETS.find((preset) => preset.id === presetId) || WALLPAPER_PRESETS[0];
}

export function readCachedColor() {
  try {
    return localStorage.getItem(COLOR_CACHE_KEY) || '';
  } catch (error) {
    return '';
  }
}

function writeCachedColor(color) {
  try {
    localStorage.setItem(COLOR_CACHE_KEY, color);
  } catch (error) {
    // 忽略
  }
}

// 取图片的平均色并压暗，用作图片加载前的底色。
async function averageColor(source) {
  const bitmap = await createImageBitmap(source, { resizeWidth: 8, resizeHeight: 8, resizeQuality: 'low' });
  const canvas = new OffscreenCanvas(8, 8);
  const context = canvas.getContext('2d');
  context.drawImage(bitmap, 0, 0, 8, 8);
  const { data } = context.getImageData(0, 0, 8, 8);
  let red = 0;
  let green = 0;
  let blue = 0;
  for (let index = 0; index < data.length; index += 4) {
    red += data[index];
    green += data[index + 1];
    blue += data[index + 2];
  }
  const count = data.length / 4;
  const shade = (value) => Math.round((value / count) * 0.72);
  return `rgb(${shade(red)}, ${shade(green)}, ${shade(blue)})`;
}

async function fetchBingList() {
  for (const host of BING_HOSTS) {
    try {
      const response = await fetch(`${host}/HPImageArchive.aspx?format=js&idx=0&n=8&mkt=zh-CN`, { cache: 'no-store' });
      if (!response.ok) {
        continue;
      }
      const data = await response.json();
      const images = (data?.images || [])
        .filter((image) => image?.urlbase)
        .map((image) => ({
          id: `bing-${image.hsh || image.startdate}`,
          urlbase: `${host}${image.urlbase}`,
          title: image.title || '',
          copyright: image.copyright || '',
          link: image.copyrightlink || '',
        }));
      if (images.length) {
        return images;
      }
    } catch (error) {
      // 换下一个域名
    }
  }
  throw new Error('无法获取 Bing 每日壁纸');
}

// 每天第一次打开新标签页时刷新一次 Bing 列表。返回 true 表示今天的图变了。
export async function refreshBingIfStale() {
  const meta = await readMeta();
  if (meta.fetchedOn === todayKey() && meta.images.length) {
    return false;
  }
  const images = await fetchBingList();
  const changed = images[0]?.id !== meta.images[0]?.id;
  await writeMeta({ images, index: changed ? 0 : meta.index, fetchedOn: todayKey() });
  const keep = images.flatMap((image) => [`${image.id}:UHD`, `${image.id}:1920x1080`]);
  pruneWallpaperRecords([...keep, CUSTOM_ID]).catch(() => {});
  return changed;
}

async function loadBingImage(image) {
  const suffix = resolutionSuffix();
  const key = `${image.id}:${suffix}`;
  const cached = await getWallpaperRecord(key);
  if (cached?.blob) {
    return cached;
  }
  const response = await fetch(`${image.urlbase}_${suffix}.jpg`);
  if (!response.ok) {
    throw new Error(`壁纸下载失败 (${response.status})`);
  }
  const blob = await response.blob();
  const record = { id: key, blob, color: await averageColor(blob) };
  await putWallpaperRecord(record);
  return record;
}

function presetResult(presetId) {
  const preset = findPreset(presetId);
  return { kind: 'css', css: preset.css, color: preset.color, credit: null };
}

// 解析当前应显示的壁纸。Bing 只用缓存（首次除外）；Unsplash 的 advance 见 unsplash.js。
export async function resolveWallpaper(settings = {}, { advance = false } = {}) {
  let result;
  try {
    if (settings.mode === 'unsplash') {
      result = await resolveUnsplash(settings, advance);
    } else if (settings.mode === 'custom') {
      const record = await getWallpaperRecord(CUSTOM_ID);
      result = record?.blob
        ? { kind: 'image', url: URL.createObjectURL(record.blob), color: record.color, credit: null }
        : presetResult(settings.presetId);
    } else if (settings.mode === 'bing') {
      let meta = await readMeta();
      if (!meta.images.length) {
        await refreshBingIfStale();
        meta = await readMeta();
      }
      const image = meta.images[meta.index % meta.images.length];
      const record = await loadBingImage(image);
      result = {
        kind: 'image',
        url: URL.createObjectURL(record.blob),
        color: record.color,
        credit: { title: image.title, copyright: image.copyright, link: image.link },
        position: `${(meta.index % meta.images.length) + 1} / ${meta.images.length}`,
      };
    } else {
      result = presetResult(settings.presetId);
    }
  } catch (error) {
    console.warn('GlassTab wallpaper fallback:', error);
    result = presetResult(settings.presetId);
    if (error instanceof UnsplashError) {
      result.error = error.message;
    }
  }

  if (result.color) {
    writeCachedColor(result.color);
  }
  return result;
}

export async function stepBingWallpaper(delta = 1) {
  const meta = await readMeta();
  if (!meta.images.length) {
    return;
  }
  const length = meta.images.length;
  await writeMeta({ ...meta, index: (((meta.index + delta) % length) + length) % length });
}

export async function saveCustomWallpaper(file) {
  if (!file?.type?.startsWith('image/')) {
    throw new Error('请选择图片文件。');
  }
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_CUSTOM_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
  await putWallpaperRecord({ id: CUSTOM_ID, blob, color: await averageColor(blob) });
}
