// api/ai.js — Vercel Serverless Function (Gemini 버전)
// IP당 하루 10회 무료 + 본인 Gemini API 키 사용 가능

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const FREE_QUOTA = 10;

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

// Anthropic messages → Gemini contents 변환
function toGeminiContents(messages) {
  const contents = [];
  for (const msg of messages) {
    const role = msg.role === 'assistant' ? 'model' : 'user';
    let text = typeof msg.content === 'string' ? msg.content
      : Array.isArray(msg.content) ? msg.content.filter(b => b.type === 'text').map(b => b.text).join('\n') : '';
    contents.push({ role, parts: [{ text }] });
  }
  return contents;
}

// 서버에서 JSON 추출 시도
function extractJSON(text) {
  if (!text) return null;
  // 직접 파싱
  try { const r = JSON.parse(text.trim()); if (r && typeof r === 'object') return r; } catch(e){}
  // 코드블록 제거
  try { const r = JSON.parse(text.replace(/```json|```/gi, '').trim()); if (r && typeof r === 'object') return r; } catch(e){}
  // 중첩 괄호 추출
  try {
    const start = text.indexOf('{');
    let depth = 0, end = -1;
    for (let i = start; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (start !== -1 && end !== -1) {
      const r = JSON.parse(text.slice(start, end + 1));
      if (r && typeof r === 'object') return r;
    }
  } catch(e){}
  return null;
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

  if (!apiKey) return res.status(500).json({ error: 'API 키가 설정되지 않았습니다. 관리자에게 문의하세요.' });

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
      generationConfig: {
        maxOutputTokens: max_tokens || 1500,
        temperature: 0.2
      }
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
      lastError = data.error?.message || 'AI 서비스 오류';
    }

    if (!rawText && lastError) {
      return res.status(400).json({ error: 'AI 분석에 실패했습니다. 잠시 후 다시 시도해주세요.' });
    }

    // 서버에서 JSON 파싱 시도 — 성공하면 파싱된 객체를, 실패하면 rawText를 그대로 전달
    const parsed = extractJSON(rawText);

    if (!usingUserKey) incrementQuota(ip);
    const used = usingUserKey ? 0 : getUsedCount(ip);
    const remaining = usingUserKey ? 999 : Math.max(0, FREE_QUOTA - used);

    if (parsed) {
      // JSON 파싱 성공 — 구조화된 데이터로 전달
      return res.status(200).json({
        content: [{ type: 'text', text: JSON.stringify(parsed) }],
        _remaining: remaining,
        _usingUserKey: usingUserKey,
        _parsed: true
      });
    } else {
      // 파싱 실패 — raw 텍스트 그대로 전달 (클라이언트에서 재시도)
      return res.status(200).json({
        content: [{ type: 'text', text: rawText }],
        _remaining: remaining,
        _usingUserKey: usingUserKey,
        _parsed: false
      });
    }

  } catch (e) {
    return res.status(500).json({ error: 'AI 서버 연결에 실패했습니다. 네트워크를 확인해주세요.' });
  }
}
