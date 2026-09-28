import { chatCompletion } from './ai.js';
import { getHostname, toTime, truncate } from './utils.js';

// 自然语言找网页，分两步：
// 1. 让 AI 把描述解析成关键词和时间范围（只发送这句描述）；
// 2. 本地按条件取候选（书签，允许时加上历史记录），再让 AI 从候选里挑最符合的并给出理由。
// AI 始终只看到少量候选，不会拿到全部书签或历史。

const MAX_BOOKMARK_CANDIDATES = 30;
const MAX_HISTORY_CANDIDATES = 30;

function localDate(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// 模型有时会包在 ```json 里或带前后文字，取出第一段 JSON。
function parseJson(text, fallback) {
  const cleaned = String(text || '').replace(/```(?:json)?/gi, '');
  const start = cleaned.search(/[[{]/);
  if (start < 0) return fallback;
  const open = cleaned[start];
  const end = cleaned.lastIndexOf(open === '[' ? ']' : '}');
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch (error) {
    return fallback;
  }
}

async function parseQuery(query, settings) {
  const today = new Date();
  const weekday = '日一二三四五六'[today.getDay()];
  const raw = await chatCompletion([
    {
      role: 'system',
      content: `你是浏览器书签与历史记录的检索助手。把用户的描述解析成检索条件，只输出 JSON，不要任何解释：
{"keywords": ["最多 8 个关键词，包含中英文同义词、可能出现在网页标题或网址里的词"], "from": "YYYY-MM-DD 或 null", "to": "YYYY-MM-DD 或 null"}
今天是 ${localDate(today)}，星期${weekday}。描述里没有提到时间时 from 和 to 都为 null。`,
    },
    { role: 'user', content: query },
  ], settings, { maxTokens: 200, temperature: 0 });
  const parsed = parseJson(raw, {});
  const keywords = (Array.isArray(parsed.keywords) ? parsed.keywords : [])
    .map((word) => String(word || '').trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 8);
  const from = toTime(parsed.from) ? new Date(`${parsed.from}T00:00:00`).getTime() : 0;
  const to = toTime(parsed.to) ? new Date(`${parsed.to}T23:59:59`).getTime() : 0;
  return { keywords: keywords.length ? keywords : [query.toLowerCase()], from, to };
}

function inRange(time, { from, to }) {
  return (!from || time >= from) && (!to || time <= to);
}

function bookmarkCandidates(bookmarks, conditions) {
  const scored = bookmarks
    .filter((bookmark) => inRange(toTime(bookmark.createdAt), conditions))
    .map((bookmark) => {
      const haystack = [bookmark.title, bookmark.url, bookmark.summary, bookmark.notes, ...(bookmark.tags || [])].join(' ').toLowerCase();
      const hits = conditions.keywords.filter((word) => haystack.includes(word)).length;
      return { bookmark, hits };
    });
  const matched = scored.filter((item) => item.hits > 0).sort((left, right) => right.hits - left.hits);
  // 关键词一个都没命中但给了时间范围：按时间取最近的，交给 AI 判断。
  const pool = matched.length || !(conditions.from || conditions.to)
    ? matched
    : scored.sort((left, right) => toTime(right.bookmark.createdAt) - toTime(left.bookmark.createdAt));
  return pool.slice(0, MAX_BOOKMARK_CANDIDATES).map((item) => item.bookmark);
}

async function historyCandidates(conditions, excludeUrls) {
  if (!chrome.history) return [];
  const startTime = conditions.from || 0;
  const endTime = conditions.to || Date.now();
  const lists = await Promise.all(conditions.keywords.slice(0, 5).map((text) => chrome.history.search({ text, startTime, endTime, maxResults: 20 })));
  let items = lists.flat();
  if (!items.length && (conditions.from || conditions.to)) {
    items = await chrome.history.search({ text: '', startTime, endTime, maxResults: 40 });
  }
  const seen = new Set(excludeUrls);
  return items
    .filter((item) => item.url && item.title && !seen.has(item.url) && seen.add(item.url))
    .sort((left, right) => (right.visitCount || 0) - (left.visitCount || 0))
    .slice(0, MAX_HISTORY_CANDIDATES);
}

function formatDate(time) {
  return time ? localDate(new Date(time)) : '';
}

async function rank(query, candidates, settings) {
  const lines = candidates.map((candidate) => {
    if (candidate.kind === 'bookmark') {
      const bookmark = candidate.item;
      return [candidate.id, bookmark.title, getHostname(bookmark.url), `收藏于 ${formatDate(toTime(bookmark.createdAt))}`,
        truncate(bookmark.summary || bookmark.notes || '', 60), (bookmark.tags || []).map((tag) => `#${tag}`).join(' ')].filter(Boolean).join(' | ');
    }
    const item = candidate.item;
    return [candidate.id, item.title, getHostname(item.url), `最后访问 ${formatDate(item.lastVisitTime)}`].join(' | ');
  });
  const raw = await chatCompletion([
    {
      role: 'system',
      content: `从候选网页里挑出最符合用户描述的最多 6 条，按相关度从高到低排序。只输出 JSON 数组，不要解释：
[{"id": "候选编号", "reason": "不超过 20 字的中文理由"}]
没有合适的就输出 []。`,
    },
    { role: 'user', content: `描述：${query}\n\n候选：\n${lines.join('\n')}` },
  ], settings, { maxTokens: 500, temperature: 0 });
  const parsed = parseJson(raw, []);
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  return (Array.isArray(parsed) ? parsed : [])
    .map((entry) => ({ candidate: byId.get(String(entry?.id || '').trim()), reason: String(entry?.reason || '').trim() }))
    .filter((entry) => entry.candidate)
    .slice(0, 6);
}

// 返回 [{ kind: 'bookmark' | 'history', item, reason }]
export async function aiFindPages(query, { bookmarks, includeHistory }, settings) {
  const conditions = await parseQuery(query, settings);
  const bookmarkList = bookmarkCandidates(bookmarks, conditions);
  const historyList = includeHistory ? await historyCandidates(conditions, bookmarkList.map((bookmark) => bookmark.url)) : [];
  const candidates = [
    ...bookmarkList.map((item, index) => ({ id: `b${index + 1}`, kind: 'bookmark', item })),
    ...historyList.map((item, index) => ({ id: `h${index + 1}`, kind: 'history', item })),
  ];
  if (!candidates.length) {
    return { results: [], conditions };
  }
  const ranked = await rank(query, candidates, settings);
  return {
    results: ranked.map(({ candidate, reason }) => ({ kind: candidate.kind, item: candidate.item, reason })),
    conditions,
  };
}
