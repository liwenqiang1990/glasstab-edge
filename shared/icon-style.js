// 决定图标怎么画：
// - full：自带底色的满版图标（apple-touch-icon 等）→ 直接铺满圆角方块，像 macOS App 图标
// - glyph：透明底的小 logo → 放在按 logo 主色生成的浅色/深色渐变底上，而不是统一的白框
// 资产 id 对应的内容不会变，所以结果按 id 永久缓存。

const CACHE_KEY = 'glasstab:icon-style-v2';
const FALLBACK_PREFIX = 'data:image/svg+xml;charset=UTF-8,';

let cache = {};
try {
  cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') || {};
} catch (error) {
  cache = {};
}

let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch (error) {
      // 忽略
    }
  }, 300);
}

function rgbToHsl(red, green, blue) {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  if (max === min) return [0, 0, lightness];
  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue;
  if (max === r) hue = (g - b) / delta + (g < b ? 6 : 0);
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  return [Math.round(hue * 60), saturation, lightness];
}

async function analyze(src) {
  const image = new Image();
  image.src = src;
  await image.decode();
  const size = 48;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0, size, size);
  const { data } = context.getImageData(0, 0, size, size);
  const alphaAt = (x, y) => data[(y * size + x) * 4 + 3];

  const probes = [[24, 1], [24, 46], [1, 24], [46, 24], [6, 6], [41, 6], [6, 41], [41, 41]];
  const opaqueEdges = probes.every(([x, y]) => alphaAt(x, y) > 200);
  const isVector = /^data:image\/svg/i.test(src);
  const bigEnough = isVector || Math.min(image.naturalWidth, image.naturalHeight) >= 64;
  if (opaqueEdges && bigEnough) {
    return { mode: 'full' };
  }

  // 统计不透明像素的颜色，按饱和度加权，找出 logo 主色。
  let weight = 0;
  let red = 0;
  let green = 0;
  let blue = 0;
  let lumaSum = 0;
  let count = 0;
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] < 128) continue;
    const [, saturation, lightness] = rgbToHsl(data[index], data[index + 1], data[index + 2]);
    const w = 0.15 + saturation;
    red += data[index] * w;
    green += data[index + 1] * w;
    blue += data[index + 2] * w;
    weight += w;
    lumaSum += lightness;
    count += 1;
  }
  if (!count) {
    return { mode: 'glyph', tone: 'light', hue: 0, sat: 0 };
  }
  const [hue, saturation] = rgbToHsl(red / weight, green / weight, blue / weight);
  const luma = lumaSum / count;
  // 很亮的 logo（白色图形）配深底，其他配浅底。
  const tone = luma > 0.82 && saturation < 0.25 ? 'dark' : 'light';
  return { mode: 'glyph', tone, hue, sat: Math.round(saturation * 100) };
}

function glyphBackground({ tone, hue, sat }) {
  if (tone === 'dark') {
    return `linear-gradient(180deg, hsl(${hue} ${Math.min(sat, 30)}% 30%), hsl(${hue} ${Math.min(sat, 30)}% 18%))`;
  }
  if (sat < 12) {
    return 'linear-gradient(180deg, #fdfdfd, #e9e9ee)';
  }
  const s = Math.min(sat, 70);
  return `linear-gradient(180deg, hsl(${hue} ${s}% 97%), hsl(${hue} ${Math.round(s * 0.8)}% 89%))`;
}

function applyStyle(holder, style) {
  holder.classList.remove('is-pending', 'is-full', 'is-glyph');
  if (style.mode === 'full') {
    holder.classList.add('is-full');
    holder.style.removeProperty('--icon-bg');
  } else {
    holder.classList.add('is-glyph');
    holder.style.setProperty('--icon-bg', glyphBackground(style));
  }
}

// 给容器里所有 [data-icon-key] 的图标套上样式。
export function styleIcons(root) {
  root.querySelectorAll('[data-icon-key]').forEach((holder) => {
    const key = holder.dataset.iconKey;
    const img = holder.querySelector('img');
    if (!img) return;
    if (img.src.startsWith(FALLBACK_PREFIX)) {
      applyStyle(holder, { mode: 'full' });
      return;
    }
    if (cache[key]) {
      applyStyle(holder, cache[key]);
      return;
    }
    holder.classList.add('is-pending');
    analyze(img.src)
      .then((style) => {
        if (!key.startsWith('tmp:')) {
          cache[key] = style;
          persist();
        }
        applyStyle(holder, style);
      })
      .catch(() => applyStyle(holder, { mode: 'glyph', tone: 'light', hue: 0, sat: 0 }));
  });
}
