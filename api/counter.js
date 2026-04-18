// ═══════════════════════════════════════
//  Orça 3D Print — Counter API
//  Vercel Serverless Function + Upstash Redis
//  Endpoint: /api/counter?action=hit|calc|get
// ═══════════════════════════════════════
const { Redis } = require('@upstash/redis');

// Upstash conectado via Vercel — tenta todas as variáveis possíveis
const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL  || process.env.KV_REST_API_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN,
});

const HIST_TOTAL = 738;
const HIST_CALC  = 800;

const ALLOWED_ORIGINS = [
  'https://or-ca-3d-print.vercel.app',
  'https://orca3d.vercel.app',
  'https://www.orca3d.vercel.app',
];

const RATE_LIMIT  = 60;
const RATE_WINDOW = 3600;

function getOrigin(req) {
  return req.headers['origin'] || req.headers['referer'] || '';
}

function isAllowedOrigin(req) {
  const origin = getOrigin(req);
  if (origin.includes('localhost') || origin.includes('127.0.0.1')) return true;
  if (!origin) return true;
  return ALLOWED_ORIGINS.some(o => origin.startsWith(o));
}

function getIP(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0].trim() ||
    req.headers['x-real-ip'] ||
    'unknown'
  );
}

async function checkRateLimit(ip, action) {
  if (action === 'get') return { allowed: true };
  const key     = `ratelimit:${ip}:${new Date().toISOString().slice(0, 13)}`;
  const current = await redis.incr(key);
  if (current === 1) await redis.expire(key, RATE_WINDOW);
  return current > RATE_LIMIT
    ? { allowed: false, current, limit: RATE_LIMIT }
    : { allowed: true,  current, limit: RATE_LIMIT };
}

module.exports = async function handler(req, res) {
  const origin = getOrigin(req);
  const allowedOrigin = ALLOWED_ORIGINS.find(o => origin.startsWith(o))
    || (origin.includes('localhost') ? origin : null)
    || ALLOWED_ORIGINS[0];

  res.setHeader('Access-Control-Allow-Origin',  allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control',                'no-store');
  res.setHeader('X-Content-Type-Options',       'nosniff');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')     return res.status(405).json({ error: 'Método não permitido' });
  if (!isAllowedOrigin(req))    return res.status(403).json({ error: 'Origem não permitida' });

  const action = req.query.action || 'hit';
  if (!['hit', 'calc', 'get'].includes(action)) {
    return res.status(400).json({ error: 'action inválida' });
  }

  // Rate limit
  const ip = getIP(req);
  try {
    const rate = await checkRateLimit(ip, action);
    res.setHeader('X-RateLimit-Limit',     rate.limit || RATE_LIMIT);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, (rate.limit || RATE_LIMIT) - (rate.current || 0)));
    if (!rate.allowed) {
      res.setHeader('Retry-After', RATE_WINDOW);
      return res.status(429).json({ error: 'Muitas requisições. Tente em 1 hora.' });
    }
  } catch (e) {
    console.warn('Rate limit check failed:', e.message);
  }

  const today = new Date().toISOString().slice(0, 10);
  try {
    if (action === 'hit') {
      const [total, todayCount] = await Promise.all([
        redis.incr('visitas:total'),
        redis.incr(`visitas:dia:${today}`),
      ]);
      await redis.expire(`visitas:dia:${today}`, 60 * 60 * 48);
      const calculos = await redis.get('calculos:total') || 0;
      return res.json({
        total:    HIST_TOTAL + total,
        today:    todayCount,
        calculos: HIST_CALC + Number(calculos),
      });
    }

    if (action === 'calc') {
      const calculos = await redis.incr('calculos:total');
      return res.json({ calculos: HIST_CALC + calculos });
    }

    if (action === 'get') {
      const [total, todayCount, calculos] = await Promise.all([
        redis.get('visitas:total'),
        redis.get(`visitas:dia:${today}`),
        redis.get('calculos:total'),
      ]);
      return res.json({
        total:    HIST_TOTAL + (Number(total)    || 0),
        today:    Number(todayCount) || 0,
        calculos: HIST_CALC + (Number(calculos)  || 0),
      });
    }

  } catch (err) {
    console.error('Counter error:', err);
    return res.status(200).json({
      total: HIST_TOTAL, today: 0, calculos: HIST_CALC, fallback: true,
    });
  }
};