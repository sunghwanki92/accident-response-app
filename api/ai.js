// api/ai.js — Vercel Serverless Function (Gemini 버전)
// IP당 하루 5회 무료 + 본인 Gemini API 키 사용 가능

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const FREE_QUOTA = 5;

const ipQuota = {};

function getQuotaKey(ip) {
  const today = new Date().toISOString().slice(0, 10);
  return `${ip}_${today}`;
}
function getUsedCount(ip) { return ipQuota[getQuotaKey(ip)] || 0; }
function incrementQuota(ip) {
  const key = getQuotaKey(ip);
  ipQuota[key] = (ipQuota[key] || 0) + 1;
}

// Anthropic messages 형식 → Gemini contents 형식 변환
function toGeminiContents(messages, system) {
  const contents = [];
  let systemPrefix = system ? `[시스템 지침]\n${system}\n\n` : '';
  for (const msg of messages) {
    const role = msg.role === 'assistant' ? 'model' : 'user';
    let text = typeof msg.content === 'string' ? msg.content
      : Array.isArray(msg.content) ? msg.content.filter(b=>b.type==='text').map(b=>b.text).join('\n') : '';
    if (role === 'user' && systemPrefix) { text = systemPrefix + text; systemPrefix = ''; }
    contents.push({ role, parts: [{ text }] });
  }
  return contents;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
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

  if (!apiKey) return res.status(500).json({ error: 'Gemini API 키가 설정되지 않았습니다.' });

  if (!usingUserKey) {
    const used = getUsedCount(ip);
    if (used >= FREE_QUOTA) {
      return res.status(429).json({
        error: `오늘 무료 AI 분석(${FREE_QUOTA}회)을 모두 사용했습니다. 내일 다시 사용하거나 설정에서 본인 Gemini API 키를 입력해 주세요.`,
        remaining: 0, quota: FREE_QUOTA
      });
    }
  }

  try {
    const { messages, system, max_tokens } = body;
    const contents = toGeminiContents(messages || [], system || '');
    const geminiBody = {
      contents,
      generationConfig: { maxOutputTokens: max_tokens || 1500, temperature: 0.7 }
    };
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const response = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiBody)
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.error?.message || 'Gemini API 오류' });

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!usingUserKey) incrementQuota(ip);
    const used = usingUserKey ? 0 : getUsedCount(ip);
    const remaining = usingUserKey ? 999 : Math.max(0, FREE_QUOTA - used);

    return res.status(200).json({
      content: [{ type: 'text', text }],
      _remaining: remaining,
      _usingUserKey: usingUserKey
    });
  } catch (e) {
    return res.status(500).json({ error: 'AI 서버 연결 오류: ' + e.message });
  }
}
// force redeploy Mon Mar  2 08:31:31 UTC 2026
