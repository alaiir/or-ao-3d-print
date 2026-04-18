// ═══════════════════════════════════════
//  Orça 3D Print — Counter API
//  Proxy simples para CounterAPI
// ═══════════════════════════════════════

const HIST_TOTAL = 738;
const HIST_CALC  = 800;
const NS = 'orca3dprint-2025';

const ALLOWED_ORIGINS = [
  'https://or-ca-3d-print.vercel.app',
  'https://orca3d.vercel.app',
];

function getOrigin(req) {
  return req.headers['origin'] || req.headers['referer'] || '';
}

function isAllowedOrigin(req) {
  const origin = getOrigin(req);
  if (origin.includes('localhost') || origin.includes('127.0.0.1')) return true;
  if (!origin) return true;
  return ALLOWED_ORIGINS.some(o => origin.startsWith(o));
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
  const today  = new Date().toISOString().slice(0,10).replace(/-/g,'');

  try {
    const base = 'https://api.counterapi.dev/v1/' + NS;

    if (action === 'hit') {
      const [rTotal, rDay, rCalc] = await Promise.all([
        fetch(`${base}/visitas/up`).then(r=>r.json()),
        fetch(`${base}/dia-${today}/up`).then(r=>r.json()),
        fetch(`${base}/calculos/get`).then(r=>r.json()),
      ]);
      return res.json({
        total:    HIST_TOTAL + (rTotal.count || 0),
        today:    rDay.count  || 0,
        calculos: HIST_CALC  + (rCalc.count  || 0),
      });
    }

    if (action === 'calc') {
      const r = await fetch(`${base}/calculos/up`).then(r=>r.json());
      return res.json({ calculos: HIST_CALC + (r.count || 0) });
    }

    if (action === 'get') {
      const [rTotal, rDay, rCalc] = await Promise.all([
        fetch(`${base}/visitas/get`).then(r=>r.json()),
        fetch(`${base}/dia-${today}/get`).then(r=>r.json()),
        fetch(`${base}/calculos/get`).then(r=>r.json()),
      ]);
      return res.json({
        total:    HIST_TOTAL + (rTotal.count || 0),
        today:    rDay.count  || 0,
        calculos: HIST_CALC  + (rCalc.count  || 0),
      });
    }

    return res.status(400).json({ error: 'action inválida' });

  } catch(err) {
    console.error('Counter error:', err);
    return res.status(200).json({
      total: HIST_TOTAL, today: 0, calculos: HIST_CALC, fallback: true,
    });
  }
};