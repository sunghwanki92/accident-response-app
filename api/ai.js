// api/ai.js — Vercel Serverless Function (Gemini)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const FREE_QUOTA = 10;
const ipQuota = {};
let lastCleanup = '';

function getQuotaKey(ip) {
  return `${ip}_${new Date().toISOString().slice(0,10)}`;
}
function cleanupOldQuota() {
  const today = new Date().toISOString().slice(0,10);
  if (lastCleanup === today) return;
  for (const key of Object.keys(ipQuota)) {
    if (!key.endsWith(today)) delete ipQuota[key];
  }
  lastCleanup = today;
}
function getUsedCount(ip) { cleanupOldQuota(); return ipQuota[getQuotaKey(ip)] || 0; }
function incrementQuota(ip) {
  const key = getQuotaKey(ip);
  ipQuota[key] = (ipQuota[key] || 0) + 1;
}

function toGeminiContents(messages) {
  return messages.map(msg => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: typeof msg.content === 'string' ? msg.content
      : Array.isArray(msg.content) ? msg.content.filter(b=>b.type==='text').map(b=>b.text).join('\n') : '' }]
  }));
}

export default async function handler(req, res) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-User-Api-Key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
    const used = getUsedCount(ip);
    return res.status(200).json({ remaining: Math.max(0, FREE_QUOTA - used), used, quota: FREE_QUOTA });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
  const userApiKey = req.headers['x-user-api-key'];
  const body = req.body;
  const apiKey = userApiKey || GEMINI_API_KEY;
  const usingUserKey = !!userApiKey;

  if (!apiKey) return res.status(500).json({ error: 'API 키가 설정되지 않았습니다.' });

  if (!usingUserKey) {
    const used = getUsedCount(ip);
    if (used >= FREE_QUOTA) {
      return res.status(429).json({
        error: `오늘 무료 AI 분석 ${FREE_QUOTA}회를 모두 사용했습니다.\n내일 자정에 초기화되거나, 설정에서 본인 Gemini API 키를 입력하면 무제한 사용 가능합니다.`,
        remaining: 0, quota: FREE_QUOTA
      });
    }
  }

  try {
    const { messages, system, max_tokens } = body;
    const contents = toGeminiContents(messages || []);
    const geminiBody = {
      contents,
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      generationConfig: { maxOutputTokens: max_tokens || 2500, temperature: 0.1 }
    };

    const models = ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-2.5-flash'];
    let rawText = '';
    let lastError = '';

    for (const model of models) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geminiBody)
      });
      const data = await response.json();
      if (response.ok) {
        rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        break;
      }
      lastError = data.error?.message || 'AI 오류';
    }

    if (!rawText && lastError) return res.status(400).json({ error: 'AI 분석에 실패했습니다. 잠시 후 다시 시도해주세요.' });

    if (!usingUserKey) incrementQuota(ip);
    const remaining = usingUserKey ? 999 : Math.max(0, FREE_QUOTA - getUsedCount(ip));

    // 서버는 raw 텍스트만 전달 — 파싱은 클라이언트에서
    return res.status(200).json({
      content: [{ type: 'text', text: rawText }],
      _remaining: remaining,
      _usingUserKey: usingUserKey
    });

  } catch (e) {
    return res.status(500).json({ error: 'AI 서버 연결에 실패했습니다. 네트워크를 확인해주세요.' });
  }
}
