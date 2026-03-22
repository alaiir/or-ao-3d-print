// ═══════════════════════════════════════
//  Orça 3D Print — Counter API
//  Vercel Serverless Function + KV Store
//  Endpoint: /api/counter?action=hit|calc|get
//
//  Segurança:
//  • Rate limit: 60 hits/IP/hora (via KV)
//  • Origem restrita ao próprio domínio
//  • action=get não incrementa (só leitura)
//  • CORS restrito ao domínio do site
// ═══════════════════════════════════════
import { kv } from '@vercel/kv';

// Base histórica (GA4: 20/02 → 19/03/2026)
const HIST_TOTAL = 738;
const HIST_CALC  = 800;

// Domínios permitidos
const ALLOWED_ORIGINS = [
  'https://orca3d.vercel.app',
  'https://www.orca3d.vercel.app',
];

// Rate limit por IP por hora
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

async function checkRateLimit(ip, action) {
  if (action === 'get') return { allowed: true };
  const key     = `ratelimit:${ip}:${new Date().toISOString().slice(0, 13)}`;
  const current = await kv.incr(key);
  if (current === 1) await kv.expire(key, RATE_WINDOW);
  return current > RATE_LIMIT
    ? { allowed: false, current, limit: RATE_LIMIT }
    : { allowed: true,  current, limit: RATE_LIMIT };
}

function getIP(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0].trim() ||
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

export default async function handler(req, res) {
  // ── CORS ──
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

  // ── Rate limit ──
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

  // ── Lógica principal ──
  const today = new Date().toISOString().slice(0, 10);
  try {
    if (action === 'hit') {
      const [total, todayCount] = await Promise.all([
        kv.incr('visitas:total'),
        kv.incr(`visitas:dia:${today}`),
      ]);
      await kv.expire(`visitas:dia:${today}`, 60 * 60 * 48);
      const calculos = await kv.get('calculos:total') || 0;
      return res.json({
        total:    HIST_TOTAL + total,
        today:    todayCount,
        calculos: HIST_CALC + Number(calculos),
      });
    }

    if (action === 'calc') {
      const calculos = await kv.incr('calculos:total');
      return res.json({ calculos: HIST_CALC + calculos });
    }

    if (action === 'get') {
      const [total, todayCount, calculos] = await Promise.all([
        kv.get('visitas:total'),
        kv.get(`visitas:dia:${today}`),
        kv.get('calculos:total'),
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
}