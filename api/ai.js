// api/ai.js — Vercel Serverless Function
// IP당 하루 3회 무료 + 본인 API 키 사용 가능

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const FREE_QUOTA = 3; // 하루 무료 횟수

// 간단한 메모리 기반 IP 쿼터 (Vercel 재시작 시 초기화됨 — 프로덕션에서는 KV 사용 권장)
const ipQuota = {};

function getQuotaKey(ip) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `${ip}_${today}`;
}

function getUsedCount(ip) {
  const key = getQuotaKey(ip);
  return ipQuota[key] || 0;
}

function incrementQuota(ip) {
  const key = getQuotaKey(ip);
  ipQuota[key] = (ipQuota[key] || 0) + 1;
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-User-Api-Key');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // 쿼터 조회 (GET)
  if (req.method === 'GET') {
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || 'unknown';
    const used = getUsedCount(ip);
    const remaining = Math.max(0, FREE_QUOTA - used);
    return res.status(200).json({ remaining, used, quota: FREE_QUOTA });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || 'unknown';
  const userApiKey = req.headers['x-user-api-key'];
  const body = req.body;

  // API 키 결정: 사용자 키 > 서버 키
  let apiKey = userApiKey || ANTHROPIC_API_KEY;
  let usingUserKey = !!userApiKey;

  if (!apiKey) {
    return res.status(500).json({ error: '서버 API 키가 설정되지 않았습니다.' });
  }

  // 서버 키 사용 시 쿼터 체크
  if (!usingUserKey) {
    const used = getUsedCount(ip);
    if (used >= FREE_QUOTA) {
      return res.status(429).json({
        error: `오늘 무료 AI 분석(${FREE_QUOTA}회)을 모두 사용했습니다. 내일 다시 사용하거나 설정에서 본인 API 키를 입력해 주세요.`,
        remaining: 0,
        quota: FREE_QUOTA
      });
    }
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || 'AI API 오류' });
    }

    // 쿼터 증가 (서버 키 사용 시만)
    if (!usingUserKey) {
      incrementQuota(ip);
    }

    const used = usingUserKey ? 0 : getUsedCount(ip);
    const remaining = usingUserKey ? 999 : Math.max(0, FREE_QUOTA - used);

    return res.status(200).json({ ...data, _remaining: remaining, _usingUserKey: usingUserKey });

  } catch (e) {
    return res.status(500).json({ error: 'AI 서버 연결 오류: ' + e.message });
  }
}
