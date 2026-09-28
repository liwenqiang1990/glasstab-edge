import { TOMBSTONE_TTL_DAYS } from './constants.js';
import { SYNCED_SETTING_KEYS, normalizeState } from './storage.js';
import { deepClone, toTime } from './utils.js';

// 三方都不依赖的纯函数：把本地和远端两份状态合并成一份。
// 规则：条目按 id 合并，谁的 updatedAt 新用谁；删除靠 tombstones 传播；
// 同步设置按 settingsUpdatedAt 取新；WebDAV 账号和壁纸永远用本机的。

function mergeTombstones(left = {}, right = {}) {
  const cutoff = Date.now() - TOMBSTONE_TTL_DAYS * 86400000;
  const merged = {};
  [left, right].forEach((source) => {
    Object.entries(source).forEach(([id, time]) => {
      if (toTime(time) < cutoff) {
        return;
      }
      if (!merged[id] || toTime(time) > toTime(merged[id])) {
        merged[id] = time;
      }
    });
  });
  return merged;
}

function newerOf(left, right, field) {
  return toTime(left[field]) > toTime(right[field]) ? left : right;
}

// 主体字段看 updatedAt，图标字段看 iconUpdatedAt，分别取新。
function pickNewer(localItem, remoteItem) {
  if (!localItem) return remoteItem;
  if (!remoteItem) return localItem;
  const winner = newerOf(localItem, remoteItem, 'updatedAt');
  if (!('iconAssetId' in winner)) {
    return winner;
  }
  let iconSource = newerOf(localItem, remoteItem, 'iconUpdatedAt');
  if (!iconSource.iconAssetId) {
    iconSource = iconSource === localItem ? remoteItem : localItem;
  }
  return {
    ...winner,
    iconAssetId: iconSource.iconAssetId || null,
    iconMode: iconSource.iconMode || winner.iconMode,
    iconUpdatedAt: iconSource.iconUpdatedAt || winner.iconUpdatedAt || '',
  };
}

// 先按 primary 的顺序排，secondary 独有的条目插到它在 secondary 里的前一个邻居后面。
function mergeOrder(primary, secondary) {
  const order = primary.map((item) => item.id);
  const known = new Set(order);
  secondary.forEach((item, index) => {
    if (known.has(item.id)) {
      return;
    }
    let insertAt = 0;
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const position = order.indexOf(secondary[cursor].id);
      if (position >= 0) {
        insertAt = position + 1;
        break;
      }
    }
    order.splice(insertAt, 0, item.id);
    known.add(item.id);
  });
  return order;
}

function dedupeByUrl(items, tombstones) {
  if (!items.length || !('url' in items[0])) {
    return items;
  }
  const winners = new Map();
  items.forEach((item) => {
    const current = winners.get(item.url);
    if (!current) {
      winners.set(item.url, item);
      return;
    }
    const newer = toTime(item.updatedAt) !== toTime(current.updatedAt)
      ? (toTime(item.updatedAt) > toTime(current.updatedAt) ? item : current)
      : (item.id < current.id ? item : current);
    const loser = newer === item ? current : item;
    tombstones[loser.id] = loser.updatedAt;
    winners.set(item.url, pickNewer(newer, { ...loser, updatedAt: '' }));
  });
  const keep = new Set(Array.from(winners.values()).map((item) => item.id));
  return items.filter((item) => keep.has(item.id)).map((item) => winners.get(item.url));
}

function mergeList(localList, remoteList, tombstones, localOrderWins) {
  const localMap = new Map(localList.map((item) => [item.id, item]));
  const remoteMap = new Map(remoteList.map((item) => [item.id, item]));
  const order = localOrderWins ? mergeOrder(localList, remoteList) : mergeOrder(remoteList, localList);

  const merged = order
    .map((id) => pickNewer(localMap.get(id), remoteMap.get(id)))
    .filter((item) => !(tombstones[item.id] && toTime(tombstones[item.id]) >= toTime(item.updatedAt)));

  return dedupeByUrl(merged, tombstones);
}

function mergeSettings(local, remote) {
  const remoteNewer = toTime(remote.meta.settingsUpdatedAt) > toTime(local.meta.settingsUpdatedAt);
  const source = remoteNewer ? remote : local;
  const settings = deepClone(local.settings);
  SYNCED_SETTING_KEYS.forEach((key) => {
    settings[key] = deepClone(source.settings[key]);
  });
  return { settings, settingsUpdatedAt: source.meta.settingsUpdatedAt };
}

export function mergeStates(localRaw, remoteRaw) {
  const local = normalizeState(localRaw);
  if (!remoteRaw) {
    return local;
  }
  const remote = normalizeState(remoteRaw);
  const next = deepClone(local);

  const { settings, settingsUpdatedAt } = local.meta.pristine
    ? { settings: { ...deepClone(local.settings), ...Object.fromEntries(SYNCED_SETTING_KEYS.map((key) => [key, deepClone(remote.settings[key])])) }, settingsUpdatedAt: remote.meta.settingsUpdatedAt }
    : mergeSettings(local, remote);
  next.settings = settings;
  next.meta.settingsUpdatedAt = settingsUpdatedAt;

  if (local.meta.pristine) {
    next.groups = deepClone(remote.groups);
    next.meta.groupOrderUpdatedAt = remote.meta.groupOrderUpdatedAt;
    next.shortcuts = deepClone(remote.shortcuts);
    next.bookmarks = deepClone(remote.bookmarks);
    next.tombstones = mergeTombstones(remote.tombstones, {});
    next.meta.orderUpdatedAt = remote.meta.orderUpdatedAt;
  } else {
    const tombstones = mergeTombstones(local.tombstones, remote.tombstones);
    const localOrderWins = toTime(local.meta.orderUpdatedAt) > toTime(remote.meta.orderUpdatedAt);
    const localGroupOrderWins = toTime(local.meta.groupOrderUpdatedAt) > toTime(remote.meta.groupOrderUpdatedAt);
    next.groups = mergeList(local.groups, remote.groups, tombstones, localGroupOrderWins);
    next.meta.groupOrderUpdatedAt = localGroupOrderWins ? local.meta.groupOrderUpdatedAt : remote.meta.groupOrderUpdatedAt;
    next.shortcuts = mergeList(local.shortcuts, remote.shortcuts, tombstones, localOrderWins);
    next.bookmarks = mergeList(local.bookmarks, remote.bookmarks, tombstones, true)
      .sort((left, right) => toTime(right.createdAt) - toTime(left.createdAt));
    next.tombstones = tombstones;
    next.meta.orderUpdatedAt = localOrderWins ? local.meta.orderUpdatedAt : remote.meta.orderUpdatedAt;
  }

  next.meta.pristine = false;
  // 经过 normalize 保证主页分组始终存在且排第一。
  return normalizeState(next);
}

function hashString(text) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(16)}${(h1 >>> 0).toString(16)}:${text.length}`;
}

// 参与同步比较的部分的指纹。用于判断“合并后和本地/远端是否有差异”。
export function syncFingerprint(rawState) {
  if (!rawState) {
    return '';
  }
  const state = normalizeState(rawState);
  return hashString(JSON.stringify({
    groups: state.groups,
    groupOrderUpdatedAt: state.meta.groupOrderUpdatedAt,
    shortcuts: state.shortcuts,
    bookmarks: state.bookmarks,
    tombstones: Object.keys(state.tombstones).sort().map((id) => [id, state.tombstones[id]]),
    settings: SYNCED_SETTING_KEYS.map((key) => state.settings[key]),
    settingsUpdatedAt: state.meta.settingsUpdatedAt,
    orderUpdatedAt: state.meta.orderUpdatedAt,
  }));
}

export function referencedAssetIds(state) {
  return new Set(
    [...state.shortcuts, ...state.bookmarks]
      .map((item) => item.iconAssetId)
      .filter(Boolean)
  );
}
