export const APP_SCHEMA_VERSION = 3;
export const STORAGE_KEY = 'glasstab_state_v3';
export const ASSET_DB_NAME = 'glasstab_assets';
export const ASSET_STORE_NAME = 'assets';
export const BACKUP_FILE_NAME = 'glasstab-backup.json';

export const SEARCH_ENGINES = {
  baidu: { name: 'Baidu', label: 'Baidu', url: 'https://www.baidu.com/s?wd=' },
  bing: { name: 'Bing', label: 'Bing', url: 'https://www.bing.com/search?q=' },
  github: { name: 'GitHub', label: 'GitHub', url: 'https://github.com/search?q=' },
  bilibili: { name: 'Bilibili', label: 'Bilibili', url: 'https://search.bilibili.com/all?keyword=' },
  google: { name: 'Google', label: 'Google', url: 'https://www.google.com/search?q=' },
};

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
