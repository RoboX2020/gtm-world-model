/* GTM World Model - LLM-agent consumer simulation (browser orchestrator).
   Faithful port of sim_core.py. Every persona and every purchase/churn/recommend
   decision is a live Gemini inference via the Cloudflare Worker (key server-side).
   Method follows published generative-agent market-simulation research:
   Park et al. 2023 (Generative Agents), EconAgent (ACL 2024), MarketFish (2026, MIT). */
(function (root) {
  'use strict';
  var STEP_URL = 'https://gtm-world-model-api.prajval-2029.workers.dev/api/agent-step';

  function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }

  function step(system, user, maxTokens) {
    var ctrl = new AbortController();
    var to = setTimeout(function () { ctrl.abort(); }, 120000);
    return fetch(STEP_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system: system, user: user, maxOutputTokens: maxTokens || 8192 }),
      signal: ctrl.signal
    }).then(function (r) {
      if (!r.ok) return r.json().catch(function(){return {};}).then(function (j) {
        throw new Error(j.error || ('api ' + r.status));
      });
      return r.json();
    }).then(function (j) {
      clearTimeout(to);
      if (!j || j.result === undefined) throw new Error('bad payload');
      return j.result;
    }, function (err) {
      clearTimeout(to);
      if (err && err.name === 'AbortError') throw new Error('model call timed out after 120s');
      throw err;
    });
  }

  var PERSONA_SYS = 'You generate synthetic consumer personas for market simulation, in the style of published generative-agent research.\n' +
    'Return STRICT JSON: {"personas":[{"id":int,"name":str,"age":int,"occupation":str,"monthly_budget_usd":number,"pain_points":[str],"skepticism":0-1,"social_influence":0-1,"price_sensitivity":0-1,"bio":str}]}\n' +
    'Make personas genuinely heterogeneous: different budgets, skepticism, influence, needs. Ground them in the target segment. bio <= 20 words.';

  var DECISION_SYS = 'You simulate a panel of consumers in a market. Each has an identity, budget, pain points, memory of past rounds, and hears what peers are doing.\n' +
    'For EACH agent, decide ONE action this round based ONLY on their persona and state:\n' +
    '- "ignore": not interested or unaware\n' +
    '- "evaluate": interested, not bought yet\n' +
    '- "purchase": buys the product (only if price fits budget and need is real to them)\n' +
    '- "recommend": an existing customer actively tells peers (raises others\' awareness)\n' +
    '- "churn": an existing customer quits (disappointment, budget, lost interest)\n' +
    'Hard base rates for new consumer products among people who actually see the marketing: only about 3-7% convert to paying in the first month, and even over 6 months cumulative conversion rarely exceeds 10-15% for a subscription. ' +
    'The large majority evaluate and never buy. Churn is common early. Enforce these rates at the panel level: across the whole run, total purchases must stay within that cumulative band unless the product is an exceptional fit AND the price is trivially affordable to them. ' +
    'Keep the panel-level purchase fraction in that spirit. ' +
    'A purchase requires the price to fit comfortably within the persona\'s monthly budget as discretionary spend; otherwise they evaluate at most. ' +
    'Be realistic and varied - most people ignore new products; tight budgets reject high prices; genuinely delighted existing customers recommend.\n' +
    'Return STRICT JSON: {"decisions":[{"id":int,"action":"ignore|evaluate|purchase|recommend|churn","confidence":0-1,"willingness_to_pay_usd":number,"reasoning":"<=15 words"}]}';

  // n personas in batches of 24 (parallel batches)
  function genPersonas(segmentDesc, n, onLog) {
    var batch = 24;
    var jobs = [];
    for (var start = 0; start < n; start += batch) {
      (function (s) {
        var k = Math.min(batch, n - s);
        jobs.push(
          step(PERSONA_SYS, 'Generate ' + k + ' personas, ids ' + (s + 1) + '..' + (s + k) + ', for this target segment: ' + segmentDesc)
            .then(function (out) {
              onLog('Persona batch ' + (Math.floor(s / batch) + 1) + ': ' + (out.personas || []).length + ' consumers created');
              return out.personas || [];
            })
        );
      })(start);
    }
    return Promise.all(jobs).then(function (parts) {
      return parts.reduce(function (a, b) { return a.concat(b); }, []);
    });
  }

  /* input: {product:{name,description,category}, segmentDesc, price, monthlyExposures,
             anchorCount, existingCustomers, agents, rounds}
     onEvent(evt): {type:'log'|'round'|'quote', ...} */
  function run(input, onEvent) {
    var log = function (m) { onEvent({ type: 'log', message: m }); };
    var n = input.agents, rounds = input.rounds, panel;
    log('Generating ' + n + ' consumer personas for segment: ' + input.segmentDesc);
    return genPersonas(input.segmentDesc, n, log).then(function (personas) {
      panel = personas.length;
      if (panel < 8) throw new Error('persona generation returned too few agents');
      // The panel stands in for the consumers the marketing actually reaches over the
      // simulation window. Each monthly wave of newly reached consumers becomes aware;
      // adoption therefore measures conversion and retention among reached consumers.
      var wave = Math.ceil(panel / rounds);
      log('Panel = ' + panel + ' consumers standing in for the ~' +
          Math.round(input.monthlyExposures).toLocaleString('en-US') +
          ' people your channel mix reaches each month; waves of ~' + wave + ' newly reached per month');
      var state = {};
      personas.forEach(function (p) { state[p.id] = { aware: false, status: 'none', memory: [], exposures: 0 }; });
      // seed existing customers
      var existingN = input.existingCustomers > 0
        ? clamp(Math.round(input.existingCustomers / Math.max(input.anchorCount, 1) * panel), 1, Math.floor(panel / 4)) : 0;
      var i;
      for (i = 0; i < existingN; i++) { state[personas[i].id].aware = true; state[personas[i].id].status = 'customer'; }
      var awareN = existingN;
      function exposeWave(recommenders) {
        var target = Math.min(panel, awareN + wave + Math.round(recommenders * 0.3));
        for (; awareN < target; awareN++) state[personas[awareN].id].aware = true;
      }
      exposeWave(0);
      var series = [], quotes = [], wtpAll = [];

      function doRound(rnd) {
        if (rnd > rounds) return Promise.resolve();
        var recommenders = 0;
        Object.keys(state).forEach(function (k) { if (state[k].status === 'customer') recommenders++; });
        var adoptedShare = recommenders / panel;
        exposeWave(recommenders);
        Object.keys(state).forEach(function (k) {
          var s = state[k];
          if (s.aware) s.exposures += 1 + recommenders * 0.05;
        });
        var batch = [];
        personas.forEach(function (p) {
          var st = state[p.id];
          if (!st.aware) return;
          batch.push({
            id: p.id,
            persona: { occupation: p.occupation, monthly_budget_usd: p.monthly_budget_usd, skepticism: p.skepticism,
                       social_influence: p.social_influence, price_sensitivity: p.price_sensitivity, pain_points: p.pain_points },
            state: { status: st.status, exposures: Math.round(st.exposures * 10) / 10, memory: st.memory.slice(-3) }
          });
        });
        if (!batch.length) {
          series.push({ round: rnd, customers: recommenders, new: 0, churned: 0, recommended: 0, evaluating: 0,
                        aware: Object.keys(state).filter(function (k) { return state[k].aware; }).length });
          onEvent({ type: 'round', row: series[series.length - 1] });
          return doRound(rnd + 1);
        }
        log('Month ' + rnd + '/' + rounds + ': ' + batch.length + ' aware consumers deciding...');
        var capHi = Math.ceil(panel * 0.15), capLo = Math.ceil(panel * 0.05);
        var user = 'Product: ' + JSON.stringify(input.product) + '\nMonthly price USD: ' + input.price + '\n' +
          'Round ' + rnd + '/' + rounds + '. Currently ' + recommenders + ' of ' + panel + ' panelists are paying customers (' +
          Math.round(adoptedShare * 100) + '%).\n' +
          'BASE-RATE MARKET REALITY for this round: real-world cumulative conversion of reached consumers for a new product like this ' +
          'lands between ' + capLo + ' and ' + capHi + ' of ' + panel + ' panelists by month ' + rounds + '. If adoption is already near or above ' +
          capHi + ', almost every decision this round must be ignore/evaluate/churn - no further purchases without an overwhelming persona-specific reason. ' +
          'Even below that band, most decisions are ignore/evaluate.\n' +
          'Agents:\n' + JSON.stringify(batch);
        return step(DECISION_SYS, user).then(function (out) {
          var decisions = (out && out.decisions) || [];
          var bought = 0, churned = 0, recommended = 0, evaluating = 0;
          decisions.forEach(function (d) {
            var st = state[d.id];
            if (!st) return;
            var act = d.action;
            st.aware = true;
            st.memory.push('r' + rnd + ':' + act);
            if (act === 'purchase' && st.status !== 'customer') { st.status = 'customer'; bought++; }
            else if (act === 'churn' && st.status === 'customer') { st.status = 'churned'; churned++; }
            else if (act === 'recommend' && st.status === 'customer') { recommended++; }
            else if (act === 'evaluate' && st.status === 'none') { st.status = 'evaluating'; evaluating++; }
            if (d.reasoning) {
              var q = { id: d.id, action: act, why: d.reasoning };
              quotes.push(q);
              if (act === 'purchase' || act === 'churn' || act === 'recommend') onEvent({ type: 'quote', quote: q });
            }
            if (typeof d.willingness_to_pay_usd === 'number' && d.willingness_to_pay_usd > 0 &&
                (act === 'purchase' || act === 'evaluate')) wtpAll.push(d.willingness_to_pay_usd);
          });
          var customers = 0, aware = 0;
          Object.keys(state).forEach(function (k) {
            if (state[k].status === 'customer') customers++;
            if (state[k].aware) aware++;
          });
          var row = { round: rnd, customers: customers, new: bought, churned: churned,
                      recommended: recommended, evaluating: evaluating, aware: aware };
          series.push(row);
          onEvent({ type: 'round', row: row });
          log('Month ' + rnd + ': ' + customers + ' customers (+' + bought + ' new, -' + churned + ' churned), ' +
              recommended + ' recommending, ' + aware + '/' + panel + ' aware');
          return doRound(rnd + 1);
        });
      }
      return doRound(1).then(function () {
        wtpAll.sort(function (a, b) { return a - b; });
        var wtpMedian = wtpAll.length ? wtpAll[Math.floor(wtpAll.length / 2)] : null;
        var final = series.length ? series[series.length - 1].customers : 0;
        return {
          series: series, customersFinal: final, panel: panel, rounds: rounds,
          adoptionRate: final / panel, wtpMedian: wtpMedian,
          quotes: quotes.slice(-10), personas: personas
        };
      });
    });
  }

  root.AgentSim = { run: run };
})(typeof self !== 'undefined' ? self : this);
