import { AI_PROVIDERS } from './constants.js';
import { truncate } from './utils.js';

function normalizeAiSettings(settings = {}) {
  const provider = settings.provider || 'qwen';
  const defaults = AI_PROVIDERS[provider] || AI_PROVIDERS.qwen;
  return {
    enabled: Boolean(settings.enabled),
    provider,
    endpoint: settings.endpoint || defaults.endpoint,
    model: settings.model || defaults.defaultModel,
    apiKey: settings.apiKey || '',
    systemPrompt: settings.systemPrompt || '请用一句简体中文总结网页的主要内容和功能。',
    summaryLength: Number(settings.summaryLength) || 48,
    temperature: Number.isFinite(Number(settings.temperature)) ? Number(settings.temperature) : 0.2,
  };
}

function buildPagePayload(page) {
  return [
    `标题: ${page.title || ''}`,
    `网址: ${page.url || ''}`,
    `描述: ${page.description || ''}`,
    `标题层级: ${(page.headings || []).join(' / ')}`,
    `正文摘录: ${truncate(page.text || '', 3800)}`,
  ].join('\n');
}

function extractTextContent(content) {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') {
          return item;
        }
        return item?.text || '';
      })
      .join(' ')
      .trim();
  }

  return '';
}

export async function summarizePage(page, settings) {
  const aiSettings = normalizeAiSettings(settings);

  if (!aiSettings.enabled) {
    throw new Error('AI 摘要未启用，请先到设置页开启。');
  }
  if (!aiSettings.apiKey) {
    throw new Error('AI API Key 为空，请先到设置页填写。');
  }
  if (!aiSettings.model) {
    throw new Error('AI 模型名称为空，请先到设置页填写。');
  }

  const response = await fetch(aiSettings.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${aiSettings.apiKey}`,
    },
    body: JSON.stringify({
      model: aiSettings.model,
      temperature: aiSettings.temperature,
      max_tokens: 96,
      messages: [
        {
          role: 'system',
          content: `${aiSettings.systemPrompt}输出要求：只返回一句中文，不要带序号、标题、引号，尽量控制在${aiSettings.summaryLength}字以内。`,
        },
        {
          role: 'user',
          content: buildPagePayload(page),
        },
      ],
    }),
  });

  if (!response.ok) {
    const rawText = await response.text();
    throw new Error(`AI 请求失败 (${response.status}): ${truncate(rawText, 180)}`);
  }

  const data = await response.json();
  const text = extractTextContent(data?.choices?.[0]?.message?.content).replace(/\s+/g, ' ').trim();

  if (!text) {
    throw new Error('AI 未返回可用摘要。');
  }

  return truncate(text, aiSettings.summaryLength + 8);
}
