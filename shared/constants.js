export const APP_SCHEMA_VERSION = 4;
export const STORAGE_KEY = 'glasstab_state_v3';
export const SYNC_STATUS_KEY = 'glasstab_sync_status_v1';
export const WALLPAPER_META_KEY = 'glasstab_wallpaper_meta_v1';
export const ASSET_DB_NAME = 'glasstab_assets';
export const ASSET_STORE_NAME = 'assets';
export const WALLPAPER_STORE_NAME = 'wallpapers';
export const BACKUP_FILE_NAME = 'glasstab-backup.json';

// 删除记录保留时长。超过这个时间还没同步过的设备，可能会把已删除的条目带回来。
export const TOMBSTONE_TTL_DAYS = 180;

export const SEARCH_ENGINES = {
  bing: { name: 'Bing', label: 'Bing', url: 'https://www.bing.com/search?q=' },
  baidu: { name: '百度', label: '百度', url: 'https://www.baidu.com/s?wd=' },
  google: { name: 'Google', label: 'Google', url: 'https://www.google.com/search?q=' },
  github: { name: 'GitHub', label: 'GitHub', url: 'https://github.com/search?q=' },
  bilibili: { name: 'Bilibili', label: 'Bilibili', url: 'https://search.bilibili.com/all?keyword=' },
};

export const HOME_GROUP_ID = 'home';

// 分组可选图标（名称对应 shared/icons.js）
export const GROUP_ICONS = ['home', 'star', 'sparkles', 'briefcase', 'code', 'book', 'play', 'palette', 'chat', 'cart', 'game', 'folder'];

export const DEFAULT_SHORTCUTS = [
  { id: 'shortcut-baidu', name: 'Baidu', url: 'https://www.baidu.com' },
  { id: 'shortcut-bing', name: 'Bing', url: 'https://www.bing.com' },
  { id: 'shortcut-bilibili', name: 'Bilibili', url: 'https://www.bilibili.com' },
  { id: 'shortcut-github', name: 'GitHub', url: 'https://github.com' },
  { id: 'shortcut-zhihu', name: 'Zhihu', url: 'https://www.zhihu.com' },
  { id: 'shortcut-juejin', name: 'Juejin', url: 'https://juejin.cn' },
];

export const AI_PROVIDERS = {
  qwen: {
    label: '千问 / DashScope',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    defaultModel: 'qwen-plus',
    modelHint: '例如 qwen-plus、qwen-max',
  },
  volcengine: {
    label: '火山 / ARK',
    endpoint: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
    defaultModel: '',
    modelHint: '填写你的 endpoint/model ID',
  },
};

// 离线或未联网时使用的内置壁纸，偏低饱和，保证白字可读。
export const WALLPAPER_PRESETS = [
  {
    id: 'dusk',
    name: '暮色',
    color: '#2b2f45',
    css: 'radial-gradient(90% 70% at 18% 12%, #6d6aa8 0%, transparent 60%), radial-gradient(80% 70% at 88% 90%, #c9877a 0%, transparent 62%), linear-gradient(160deg, #2a2d4a 0%, #3c3553 55%, #5b4659 100%)',
  },
  {
    id: 'fjord',
    name: '峡湾',
    color: '#1f3a44',
    css: 'radial-gradient(90% 80% at 80% 8%, #5f93a0 0%, transparent 58%), radial-gradient(70% 60% at 10% 95%, #2f5d5a 0%, transparent 65%), linear-gradient(180deg, #1d3441 0%, #23404a 50%, #1a2c33 100%)',
  },
  {
    id: 'sand',
    name: '沙丘',
    color: '#6b5646',
    css: 'radial-gradient(100% 80% at 20% 0%, #c7a488 0%, transparent 60%), radial-gradient(80% 70% at 100% 100%, #7e5b4a 0%, transparent 62%), linear-gradient(170deg, #9a7c66 0%, #6f5949 60%, #4b3d35 100%)',
  },
  {
    id: 'moss',
    name: '苔原',
    color: '#2f3b30',
    css: 'radial-gradient(90% 70% at 85% 10%, #8a9a6b 0%, transparent 58%), radial-gradient(80% 70% at 5% 100%, #3f5a48 0%, transparent 62%), linear-gradient(175deg, #34423a 0%, #2d3a31 55%, #222b25 100%)',
  },
  {
    id: 'graphite',
    name: '石墨',
    color: '#232428',
    css: 'radial-gradient(80% 60% at 50% 0%, #4a4d57 0%, transparent 65%), linear-gradient(180deg, #2a2c31 0%, #1c1d21 100%)',
  },
  {
    id: 'blush',
    name: '晨雾',
    color: '#5d5363',
    css: 'radial-gradient(90% 70% at 15% 15%, #b9a3c4 0%, transparent 58%), radial-gradient(80% 70% at 90% 85%, #d8a7a0 0%, transparent 60%), linear-gradient(165deg, #6e6480 0%, #7c6773 55%, #5a4d58 100%)',
  },
];
