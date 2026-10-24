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
const RATE_LIMIT = 40;          // requests per IP per hour (best effort, per isolate)
const buckets = new Map();
const researchCache = new Map();

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
If computed.agentSim is present, it holds results from a live LLM-agent consumer simulation:
48 consumer agents with personas, budgets and memory, 6 monthly decision rounds, every
purchase/churn/recommend decision a real model inference. Treat it as directional behavioral
evidence (LLM panels skew optimistic) and reference its adoption, churn and willingness-to-pay
numbers where relevant.
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

async function callGemini(env, system, userText, maxTokens = 4096) {
  const attempts = [
    { model: 'gemini-2.5-flash', waitMs: 0 },
    { model: 'gemini-2.5-flash', waitMs: 4000 },       // one retry: free-tier RPM windows are short
    { model: 'gemini-3.1-flash-lite', waitMs: 1500 }   // separate, larger free quota
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
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: 'user', parts: [{ text: userText }] }],
            generationConfig: { responseMimeType: 'application/json', temperature: 0.7, maxOutputTokens: maxTokens, thinkingConfig: { thinkingBudget: 0 } }
          })
        }
      );
      if (!res.ok) { lastErr = new Error(model + ' http ' + res.status); continue; }
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const parsed = JSON.parse(text);
      return { result: parsed, model };
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('all models failed');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === '/api/health') return json({ ok: true, service: 'gtm-world-model', time: new Date().toISOString() });
    /* Bright Data Web Scraper API proxy - key server-side only (env.BRIGHTDATA_API_KEY).
       Modes: {mode:'scrape', dataset_id, input[]}  -> sync POST /datasets/v3/scrape
              {mode:'trigger', dataset_id, input[]} -> async POST /datasets/v3/trigger -> snapshot_id
              {mode:'snapshot', snapshot_id}        -> GET /datasets/v3/snapshot/{id}?format=json */
    if (url.pathname === '/api/brightdata' && request.method === 'POST') {
      const ipB = request.headers.get('CF-Connecting-IP') || 'anon';
      if (!rateOk(ipB)) return json({ error: 'rate limited - try again in an hour' }, 429);
      if (!env.BRIGHTDATA_API_KEY) return json({ error: 'bright data key not configured yet - integration pending activation' }, 501);
      let bb;
      try {
        const len = +(request.headers.get('Content-Length') || 0);
        if (len > MAX_BODY) return json({ error: 'body too large' }, 413);
        bb = await request.json();
      } catch { return json({ error: 'invalid json' }, 400); }
      const mode = bb && bb.mode;
      const H = { 'Authorization': 'Bearer ' + env.BRIGHTDATA_API_KEY, 'Content-Type': 'application/json' };
      try {
        if (mode === 'scrape' || mode === 'trigger') {
          const ds = String(bb.dataset_id || '');
          if (!/^gd_[a-z0-9]+$/i.test(ds)) return json({ error: 'bad dataset_id' }, 400);
          const input = Array.isArray(bb.input) ? bb.input.slice(0, 10) : null;
          if (!input || !input.length) return json({ error: 'need input[] (max 10)' }, 400);
          const path = mode === 'scrape' ? 'scrape?notify=false&include_errors=true' : 'trigger?include_errors=true';
          const res = await fetch('https://api.brightdata.com/datasets/v3/' + path + '&dataset_id=' + ds,
            { method: 'POST', headers: H, body: JSON.stringify(mode === 'scrape' ? { input: input } : input) });
          const text = await res.text();
          if (!res.ok) return json({ error: 'brightdata http ' + res.status + ': ' + text.slice(0, 300) }, 502);
          try { return json({ result: JSON.parse(text) }); } catch { return json({ result: text.slice(0, 20000) }); }
        }
        if (mode === 'snapshot') {
          const snap = String(bb.snapshot_id || '');
          if (!/^[a-z0-9_]+$/i.test(snap)) return json({ error: 'bad snapshot_id' }, 400);
          const res = await fetch('https://api.brightdata.com/datasets/v3/snapshot/' + snap + '?format=json', { headers: H });
          if (res.status === 202) return json({ pending: true });
          const text = await res.text();
          if (!res.ok) return json({ error: 'brightdata http ' + res.status + ': ' + text.slice(0, 300) }, 502);
          try { return json({ result: JSON.parse(text) }); } catch { return json({ result: text.slice(0, 20000) }); }
        }
        return json({ error: 'mode must be scrape|trigger|snapshot' }, 400);
      } catch (e) {
        return json({ error: 'brightdata pull failed: ' + (e.message || 'unknown') }, 502);
      }
    }
    if (url.pathname === '/api/research' && request.method === 'POST') {
      const ipR = request.headers.get('CF-Connecting-IP') || 'anon';
      if (!rateOk(ipR)) return json({ error: 'rate limited - try again in an hour' }, 429);
      let rb;
      try { rb = await request.json(); } catch { return json({ error: 'invalid json' }, 400); }
      const q = (rb && typeof rb.query === 'string' ? rb.query : '').slice(0, 200).trim();
      const src = rb && rb.source;
      const limit = Math.min(Math.max(+(rb && rb.limit) || 15, 5), 25);
      if (!q || (src !== 'reddit' && src !== 'hn')) return json({ error: 'need {source: reddit|hn, query}' }, 400);
      const ck = src + '|' + q.toLowerCase() + '|' + limit;
      const hit = researchCache.get(ck);
      if (hit && Date.now() - hit.t < 600e3) return json(hit.v);
      try {
        let out;
        if (src === 'reddit') {
          const res = await fetch('https://www.reddit.com/search.json?q=' + encodeURIComponent(q) +
            '&limit=' + limit + '&sort=relevance&t=year', { headers: { 'User-Agent': 'gtm-world-model-research/1.0' } });
          if (!res.ok) throw new Error('reddit http ' + res.status);
          const data = await res.json();
          out = {
            source: 'reddit', query: q,
            results: (data.data.children || []).map(function (c) {
              const d = c.data || {};
              return { title: d.title, subreddit: 'r/' + d.subreddit, score: d.score, comments: d.num_comments,
                       url: 'https://www.reddit.com' + (d.permalink || ''), text: (d.selftext || '').slice(0, 300) };
            })
          };
        } else {
          const res = await fetch('https://hn.algolia.com/api/v1/search?query=' + encodeURIComponent(q) +
            '&tags=story&hitsPerPage=' + limit);
          if (!res.ok) throw new Error('hn http ' + res.status);
          const data = await res.json();
          out = {
            source: 'hn', query: q,
            results: (data.hits || []).map(function (h) {
              return { title: h.title, score: h.points, comments: h.num_comments,
                       url: h.url || ('https://news.ycombinator.com/item?id=' + h.objectID),
                       thread: 'https://news.ycombinator.com/item?id=' + h.objectID };
            })
          };
        }
        researchCache.set(ck, { t: Date.now(), v: out });
        if (researchCache.size > 300) researchCache.clear();
        return json(out);
      } catch (e) {
        return json({ error: 'research pull failed: ' + (e.message || 'unknown') }, 502);
      }
    }
    if (url.pathname === '/api/agent-step' && request.method === 'POST') {
      const ip0 = request.headers.get('CF-Connecting-IP') || 'anon';
      if (!rateOk(ip0)) return json({ error: 'rate limited - try again in an hour' }, 429);
      let body;
      try {
        const len = +(request.headers.get('Content-Length') || 0);
        if (len > MAX_BODY) return json({ error: 'body too large' }, 413);
        body = await request.json();
      } catch { return json({ error: 'invalid json' }, 400); }
      if (typeof body?.system !== 'string' || typeof body?.user !== 'string' ||
          body.system.length > 8000 || body.user.length > 32000) {
        return json({ error: 'need {system<=8k, user<=32k}' }, 400);
      }
      const maxTokens = Math.min(Math.max(+(body.maxOutputTokens || 8192), 512), 16384);
      try {
        const out = await callGemini(env, body.system, body.user, maxTokens);
        return json(out);
      } catch (e) {
        return json({ error: 'agent step failed: ' + (e.message || 'unknown') }, 502);
      }
    }
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
      const out = await callGemini(env, SYSTEM, JSON.stringify(payload));
      if (!out.result?.positioning || !Array.isArray(out.result?.channels)) throw new Error('schema');
      return json({ strategy: out.result, model: out.model });
    } catch (e) {
      return json({ error: 'strategy generation failed: ' + (e.message || 'unknown') }, 502);
    }
  }
};
