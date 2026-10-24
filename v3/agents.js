/* GTM World Model v3 - sub-agent implementations.
   Each agent pulls REAL data (server-side via the Worker) or runs real inference,
   and reports structured findings. Sources are always attached. */
(function (root) {
  'use strict';
  var API = 'https://gtm-world-model-api.prajval-2029.workers.dev';

  function post(path, body, timeoutMs) {
    var ctrl = new AbortController();
    var to = setTimeout(function () { ctrl.abort(); }, timeoutMs || 120000);
    return fetch(API + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: ctrl.signal
    }).then(function (r) {
      clearTimeout(to);
      return r.json().then(function (j) {
        if (!r.ok) throw new Error(j.error || ('api ' + r.status));
        return j;
      });
    });
  }

  /* ---- ORCHESTRATOR PLAN: a real LLM call decomposes the product into research tasks ---- */
  function plan(orch, input) {
    orch.start('orchestrator', 'Orchestrator analyzing the product and delegating research tasks');
    var sys = 'You are the orchestrator of a go-to-market research system. You delegate to sub-agents that search real web data.\n' +
      'Return STRICT JSON: {"queries":[3 search queries for forums/communities, each 2-4 WORDS ONLY (keyword phrases, never sentences - forum search fails on long queries)],"segment":"one-line target segment description","competitors":[2-3 likely competitor product names]}';
    var usr = 'Product: ' + input.productName + ' - ' + (input.description || ('a ' + input.productTypeLabel + ' product')) +
      '\nPrice: $' + input.price + '/mo\nTarget: ' + input.anchorLabel + ' in ' + input.geoLabel;
    return post('/api/agent-step', { system: sys, user: usr, maxOutputTokens: 1024 }).then(function (j) {
      var p = j.result;
      p.queries = (p.queries || []).slice(0, 3);
      if (!p.queries.length) p.queries = [input.productName, input.productTypeLabel + ' ' + input.anchorLabel, (input.description || input.productName).slice(0, 60)];
      orch.log('orchestrator', 'Plan: 3 research queries for the social-listening agent:');
      p.queries.forEach(function (q) { orch.log('orchestrator', '  -> "' + q + '"'); });
      if (p.segment) orch.log('orchestrator', 'Segment read: ' + p.segment);
      orch.done('orchestrator', 'Orchestrator delegated ' + p.queries.length + ' research tasks', p);
      return p;
    });
  }

  /* ---- SOCIAL LISTENING AGENT: real pulls (HN live; Reddit via Apify when token lands) ---- */
  function socialListening(orch, input, queries) {
    orch.start('social-listening', 'Social-listening agent pulling real community data');
    var all = [];
    var chain = Promise.resolve();
    queries.forEach(function (q) {
      chain = chain.then(function () {
        orch.log('social-listening', 'Searching Hacker News for "' + q + '"...');
        return post('/api/research', { source: 'hn', query: q, limit: 15 }).then(function (r) {
          var n = (r.results || []).length;
          orch.log('social-listening', 'HN: ' + n + ' threads for "' + q + '"');
          all = all.concat((r.results || []).map(function (x) { x.source = 'Hacker News'; x.query = q; return x; }));
        }).catch(function (e) { orch.log('social-listening', 'HN pull failed for "' + q + '": ' + e.message); });
      });
    });
    // fallback: if the specific queries found little, broaden to category-level terms
    chain = chain.then(function () {
      if (all.length >= 10) return;
      var broad = [input.productTypeLabel, input.productName].filter(function (q, i, a) { return q && a.indexOf(q) === i; });
      var bc = Promise.resolve();
      broad.forEach(function (q) {
        bc = bc.then(function () {
          orch.log('social-listening', 'Thin results - broadening search to "' + q + '"...');
          return post('/api/research', { source: 'hn', query: q, limit: 15 }).then(function (r) {
            var n = (r.results || []).length;
            orch.log('social-listening', 'HN: ' + n + ' threads for "' + q + '"');
            all = all.concat((r.results || []).map(function (x) { x.source = 'Hacker News'; x.query = q; return x; }));
          }).catch(function () {});
        });
      });
      return bc;
    });
    return chain.then(function () {
      // de-duplicate by url
      var seen = {};
      all = all.filter(function (t) { var u = t.thread || t.url; if (seen[u]) return false; seen[u] = 1; return true; });
      if (all.length < 5) {
        var thin = {
          readiness: 'unreadable from this source',
          summary: 'Only ' + all.length + ' relevant community threads found on Hacker News for this product space. That is too little real data for a demand read - no verdict given rather than a guess. Reddit/G2/LinkedIn coverage arrives with the Bright Data integration.',
          pain_points: [], demand_signals: [], sentiment: { positive: 0, neutral: 0, negative: 0 },
          evidence_note: 'Insufficient coverage: ' + all.length + ' threads. Sources: Hacker News (Algolia API, live).',
          threads: all.slice(0, 8).map(function (t) { return { title: t.title, score: t.score, comments: t.comments, url: t.thread || t.url, source: t.source }; }),
          sourcesUsed: ['Hacker News (Algolia API, live)']
        };
        orch.done('social-listening', 'Social-listening: only ' + all.length + ' threads - honestly reporting insufficient data instead of a fake verdict', thin);
        return thin;
      }
      all.sort(function (a, b) { return (b.score || 0) - (a.score || 0); });
      var top = all.slice(0, 18);
      orch.log('social-listening', 'Summarizing ' + top.length + ' real threads with Gemini...');
      var sys = 'You analyze real community threads for go-to-market demand signals. Be concrete; cite what is actually in the data; never invent statistics.\n' +
        'Return STRICT JSON: {"summary":"<=60 words on what the community data shows about demand for this kind of product","pain_points":["<=8 short pain points people actually express"],"demand_signals":["<=6 concrete demand or lack-of-demand signals"],"sentiment":{"positive":int,"neutral":int,"negative":int},"readiness":"one of: strong demand|moderate demand|weak demand|mostly indifferent","evidence_note":"<=20 words on data quality/coverage"}';
      var usr = 'Product: ' + input.productName + ' - ' + (input.description || '') + '\nPrice: $' + input.price + '/mo\n' +
        'Real threads pulled live from Hacker News:\n' + JSON.stringify(top.map(function (t) {
          return { title: t.title, score: t.score, comments: t.comments, url: t.thread || t.url };
        }));
      return post('/api/agent-step', { system: sys, user: usr, maxOutputTokens: 2048 }).then(function (j) {
        var sig = j.result;
        sig.threads = top.slice(0, 8).map(function (t) {
          return { title: t.title, score: t.score, comments: t.comments, url: t.thread || t.url, source: t.source };
        });
        sig.sourcesUsed = ['Hacker News (Algolia API, live)'];
        orch.done('social-listening', 'Social-listening done: ' + (sig.readiness || 'signals analyzed') + ' from ' + all.length + ' real threads', sig);
        return sig;
      });
    }).catch(function (e) {
      orch.fail('social-listening', 'Social-listening failed: ' + e.message);
      return null;
    });
  }

  /* ---- QUANT ANALYST AGENT: deterministic baseline from cited benchmarks ---- */
  function quantAnalyst(orch, input) {
    orch.start('quant-analyst', 'Quant analyst computing benchmark baseline (3,000 Monte Carlo futures)');
    try {
      var R = Engine.runAll(input, BENCH, { n: 3000, months: 12, seed: (Date.now() % 100000) });
      orch.done('quant-analyst', 'Baseline: median ' + Math.round(R.sim.customersEnd.p50).toLocaleString('en-US') +
        ' customers, ' + Math.round(R.sim.mrrEnd.p50).toLocaleString('en-US') + ' MRR at month 12', R);
      return R;
    } catch (e) {
      orch.fail('quant-analyst', 'Quant baseline failed: ' + e.message);
      return null;
    }
  }

  /* ---- CONSUMER PANEL AGENT: 48-agent LLM market sim, personas grounded in real signals ---- */
  function consumerPanel(orch, input, signals, onProgress) {
    var grounded = !!(signals && signals.pain_points && signals.pain_points.length);
    orch.start('consumer-panel', 'Consumer panel: generating 48 AI consumers' + (grounded ? ' (personas grounded in real pain points found)' : ' (no usable pain-point data - generic segment personas)'));
    var segmentDesc = input.anchorLabel + ' in ' + input.geoLabel + ', target customers for a ' +
      input.productTypeLabel + ' product' + (input.description ? ': ' + input.description : '');
    if (grounded) {
      segmentDesc += '. Real pain points found in live community data: ' + signals.pain_points.slice(0, 6).join('; ');
      orch.log('consumer-panel', 'Grounding personas in ' + Math.min(6, signals.pain_points.length) + ' real pain points from community data');
    }
    return AgentSim.run({
      product: { name: input.productName, description: input.description, category: input.productTypeLabel },
      segmentDesc: segmentDesc,
      price: input.price,
      monthlyExposures: input.monthlyExposures,
      anchorCount: input.anchorCount,
      existingCustomers: input.existingCustomers,
      agents: 48, rounds: 6
    }, function (evt) {
      if (evt.type === 'log') orch.log('consumer-panel', evt.message);
      if (evt.type === 'round' && onProgress) onProgress(evt.row);
    }).then(function (res) {
      orch.done('consumer-panel', 'Consumer panel done: ' + res.customersFinal + '/' + res.panel +
        ' adopt (' + Math.round(res.adoptionRate * 100) + '%), median WTP ' + (res.wtpMedian ? '$' + res.wtpMedian : 'n/a'), res);
      return res;
    }).catch(function (e) {
      orch.fail('consumer-panel', 'Consumer panel failed: ' + e.message);
      return null;
    });
  }

  /* ---- STRATEGIST AGENT: final synthesis over everything ---- */
  function strategist(orch, input, R, sim, signals) {
    orch.start('strategist', 'Strategist synthesizing baseline + consumer panel + market signals');
    var payload = {
      input: {
        productName: input.productName, description: input.description,
        productType: input.productTypeLabel, geography: input.geoLabel,
        marketAnchor: input.anchorLabel, anchorCount: input.anchorCount, price: input.price,
        monthlyBudget: input.monthlyBudget, existingCustomers: input.existingCustomers,
        channels: input.channels.map(function (k) { return BENCH.channels[k].name; })
      },
      computed: {}
    };
    if (R) {
      payload.computed = {
        tamCustomers: R.sizing.tamCustomers, tamRevenueYr: Math.round(R.sizing.tamRevenueYr),
        samCustomers: R.sizing.samCustomers, samRevenueYr: Math.round(R.sizing.samRevenueYr),
        somCustomersYr1: R.sizing.somCustomersYr1,
        blendedCac: R.cac ? Math.round(R.cac) : null,
        ltv: R.econ.ltv, ltvCac: R.econ.ltvCac ? +R.econ.ltvCac.toFixed(2) : null,
        paybackMonths: R.econ.paybackMonths ? +R.econ.paybackMonths.toFixed(1) : null,
        churnMonthly: R.econ.churnMonthly, grossMargin: R.econ.grossMargin,
        sim: { customersEnd: R.sim.customersEnd, mrrEnd: R.sim.mrrEnd, probCustomers: R.sim.probCustomers, probMRR: R.sim.probMRR },
        channels: R.channels.map(function (c) {
          return { name: c.name, spend: c.spend, customersPerMonth: +c.customersPerMonth.toFixed(2), cac: c.cac ? Math.round(c.cac) : null, rampMonths: c.rampMonths };
        })
      };
    }
    if (sim) {
      payload.computed.agentSim = {
        method: '48 LLM consumer agents with personas/budgets/memory, 6 monthly decision rounds, every decision a live model inference',
        agents: sim.panel, rounds: sim.rounds, adoptionRateFinal: +sim.adoptionRate.toFixed(3),
        customersFinal: sim.customersFinal, medianWillingnessToPay: sim.wtpMedian,
        monthlySeries: sim.series, sampleAgentQuotes: sim.quotes.slice(0, 5).map(function (q) { return q.action + ': ' + q.why; })
      };
    }
    if (signals) {
      payload.computed.marketSignals = {
        method: 'live community data (Hacker News) summarized by LLM',
        readiness: signals.readiness, summary: signals.summary,
        painPoints: signals.pain_points, demandSignals: signals.demand_signals
      };
    }
    return post('/api/strategy', payload).then(function (j) {
      if (!j || !j.strategy) throw new Error('bad payload');
      orch.done('strategist', 'Strategy synthesized from all agent findings', j.strategy);
      return j.strategy;
    }).catch(function (e) {
      orch.fail('strategist', 'Strategist failed: ' + e.message);
      return null;
    });
  }

  root.Agents = { plan: plan, socialListening: socialListening, quantAnalyst: quantAnalyst, consumerPanel: consumerPanel, strategist: strategist };
})(typeof self !== 'undefined' ? self : this);
