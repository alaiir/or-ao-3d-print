// ═══════════════════════════════════════
//  Orça 3D Print — Counter API
//  Vercel Serverless Function + KV Store
//  Endpoint: /api/counter?action=hit|get
// ═══════════════════════════════════════
import { kv } from '@vercel/kv';

// Base histórica (GA4: 20/02 → 19/03/2026)
const HIST_TOTAL = 738;
const HIST_CALC  = 800;

export default async function handler(req, res) {
  // CORS — permite chamadas do próprio site
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query.action || 'hit';
  const today  = new Date().toISOString().slice(0, 10); // ex: 2026-03-21

  try {
    if (action === 'hit') {
      // Incrementa visitas totais e do dia em paralelo
      const [total, todayCount] = await Promise.all([
        kv.incr('visitas:total'),
        kv.incr(`visitas:dia:${today}`),
      ]);

      // Expira o contador diário em 48h automaticamente
      await kv.expire(`visitas:dia:${today}`, 60 * 60 * 48);

      const calculos = await kv.get('calculos:total') || 0;

      return res.json({
        total:    HIST_TOTAL + total,
        today:    todayCount,
        calculos: HIST_CALC + Number(calculos),
      });
    }

    if (action === 'calc') {
      // Incrementa contador de cálculos (chamado pelo orca3d-v3.3.html)
      const calculos = await kv.incr('calculos:total');
      return res.json({ calculos: HIST_CALC + calculos });
    }

    if (action === 'get') {
      // Só lê sem incrementar (para debug)
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

    return res.status(400).json({ error: 'action inválida. Use: hit, calc ou get' });

  } catch (err) {
    console.error('Counter error:', err);
    // Fallback — retorna valores históricos se o KV falhar
    return res.status(200).json({
      total:    HIST_TOTAL,
      today:    0,
      calculos: HIST_CALC,
      fallback: true,
    });
  }
}