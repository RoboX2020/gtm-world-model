// GTM World Model API - Cloudflare Worker.
// Holds the Gemini key server-side; the browser sends product inputs + the
// deterministic model's computed numbers, and gets back a JSON strategy that
// is constrained to those numbers.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400'
};
const MAX_BODY = 64 * 1024;
const RATE_LIMIT = 20;          // requests per IP per hour (best effort, per isolate)
const buckets = new Map();

function rateOk(ip) {
  const now = Date.now();
  const b = buckets.get(ip) || { n: 0, t: now };
  if (now - b.t > 3600e3) { b.n = 0; b.t = now; }
  b.n += 1; buckets.set(ip, b);
  if (buckets.size > 5000) buckets.clear();
  return b.n <= RATE_LIMIT;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
}

const SYSTEM = `You are a go-to-market strategist inside a quantitative GTM engine.
You receive: (1) a product description, (2) market sizing, unit economics and a Monte Carlo
simulation computed deterministically from cited public benchmarks.
Rules:
- Use ONLY the numbers provided. Never invent statistics, market sizes or conversion rates.
- When you reference a number, it must appear in the payload.
- Be concrete and opinionated. Short sentences. No hype, no emojis.
- The product may be early and the founder is technical; write like a sharp GTM co-founder.
Respond with STRICT JSON only, this exact shape:
{
 "positioning": string,           // one sharp positioning paragraph, <=60 words
 "verdict": string,               // honest read on whether the economics work, <=40 words
 "channels": [ {"name": string, "why": string, "steps": [string, string, string]} ],  // exactly 3, ranked
 "pricing": string,               // pricing recommendation grounded in LTV/CAC/payback, <=50 words
 "plan90": [string, string, string],   // days 1-30, 31-60, 61-90, each <=25 words
 "risks": [string, string, string],    // top 3 quantified risks, each <=25 words
 "contrarian": string             // one non-obvious move, <=35 words
}`;

async function callGemini(env, payload) {
  const attempts = [
    { model: 'gemini-2.5-flash', waitMs: 0 },
    { model: 'gemini-2.5-flash', waitMs: 4000 },       // one retry: free-tier RPM windows are short
    { model: 'gemini-2.5-flash-lite', waitMs: 1500 }   // separate, larger free quota
  ];
  let lastErr = null;
  for (const { model, waitMs } of attempts) {
    if (waitMs) await new Promise(r => setTimeout(r, waitMs));
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: SYSTEM }] },
            contents: [{ role: 'user', parts: [{ text: JSON.stringify(payload) }] }],
            generationConfig: { responseMimeType: 'application/json', temperature: 0.7, maxOutputTokens: 4096, thinkingConfig: { thinkingBudget: 0 } }
          })
        }
      );
      if (!res.ok) { lastErr = new Error(model + ' http ' + res.status); continue; }
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const parsed = JSON.parse(text);
      if (!parsed.positioning || !Array.isArray(parsed.channels)) throw new Error('schema');
      return { strategy: parsed, model };
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('all models failed');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === '/api/health') return json({ ok: true, service: 'gtm-world-model', time: new Date().toISOString() });
    if (url.pathname !== '/api/strategy' || request.method !== 'POST') {
      return json({ error: 'not found' }, 404);
    }
    const ip = request.headers.get('CF-Connecting-IP') || 'anon';
    if (!rateOk(ip)) return json({ error: 'rate limited - try again in an hour' }, 429);
    let payload;
    try {
      const len = +(request.headers.get('Content-Length') || 0);
      if (len > MAX_BODY) return json({ error: 'body too large' }, 413);
      payload = await request.json();
    } catch { return json({ error: 'invalid json' }, 400); }
    if (!payload?.input?.productType || !payload?.computed) {
      return json({ error: 'missing input/computed' }, 400);
    }
    try {
      const out = await callGemini(env, payload);
      return json(out);
    } catch (e) {
      return json({ error: 'strategy generation failed: ' + (e.message || 'unknown') }, 502);
    }
  }
};
