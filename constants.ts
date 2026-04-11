import { Shortcut } from './types';

export const DEFAULT_SHORTCUTS: Shortcut[] = [
  { id: '1', name: 'Google', url: 'https://www.google.com' },
  { id: '2', name: 'YouTube', url: 'https://www.youtube.com' },
  { id: '3', name: 'GitHub', url: 'https://github.com' },
  { id: '4', name: 'Twitter', url: 'https://twitter.com' },
  { id: '5', name: 'Reddit', url: 'https://www.reddit.com' },
  { id: '6', name: 'Gmail', url: 'https://mail.google.com' },
  { id: '7', name: 'Netflix', url: 'https://www.netflix.com' },
  { id: '8', name: 'Amazon', url: 'https://www.amazon.com' },
];

// High quality nature wallpaper
export const BACKGROUND_IMAGE_URL = 'https://picsum.photos/seed/wetab_nature_v1/1920/1080';

export const GLASS_CLASSES = "bg-white/10 backdrop-blur-md border border-white/20 shadow-xl";
export const GLASS_INPUT_CLASSES = "bg-black/20 backdrop-blur-md border border-white/10 text-white placeholder-white/60 focus:bg-black/30 focus:border-white/30 transition-all duration-300";
