/* GTM World Model v3 - mission control dashboard glue. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var fmt = function (n) {
    if (n === null || n === undefined || isNaN(n)) return '-';
    if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(1) + 'B';
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e4) return (n / 1e3).toFixed(1) + 'k';
    return Math.round(n).toLocaleString('en-US');
  };
  var money = function (n) { return n == null || isNaN(n) ? '-' : '$' + fmt(n); };
  var esc = function (t) { return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };

  var AGENT_DEFS = [
    ['orchestrator', 'Orchestrator', 'delegates and synthesizes'],
    ['social-listening', 'Social listening', 'live community data'],
    ['reddit-agent', 'Reddit agent', 'Bright Data - wiring next'],
    ['linkedin-agent', 'LinkedIn/Instagram', 'Bright Data - wiring next'],
    ['g2-agent', 'Reviews (G2)', 'Bright Data - wiring next'],
    ['trends-agent', 'Google Trends', 'Bright Data - wiring next'],
    ['quant-analyst', 'Quant analyst', 'benchmark baseline'],
    ['consumer-panel', 'Consumer panel', '48 LLM agents'],
    ['strategist', 'Strategist', 'final synthesis']
  ];

  var orch = null, lastInput = null, lastR = null, simSeries = [];

  // ---- populate selects/chips (same data as v2) ----
  var ptype = $('ptype'), geo = $('geo'), anchor = $('anchor'), chips = $('channel-chips');
  Object.keys(BENCH.econ).forEach(function (k) { var o = document.createElement('option'); o.value = k; o.textContent = BENCH.econ[k].label; ptype.appendChild(o); });
  Object.keys(BENCH.geo).forEach(function (k) { var o = document.createElement('option'); o.value = k; o.textContent = BENCH.geo[k].label; geo.appendChild(o); });
  Object.keys(BENCH.anchors).forEach(function (k) {
    var o = document.createElement('option'); o.value = k;
    o.textContent = BENCH.anchors[k].label + (k === 'custom' ? '' : ' (' + fmt(BENCH.anchors[k].count) + ')');
    anchor.appendChild(o);
  });
  var selectedChannels = ['paid_search', 'seo_content'];
  Object.keys(BENCH.channels).forEach(function (k) {
    var c = document.createElement('span'); c.className = 'chip' + (selectedChannels.indexOf(k) >= 0 ? ' on' : '');
    c.textContent = BENCH.channels[k].name; c.dataset.id = k;
    c.onclick = function () {
      var i = selectedChannels.indexOf(k);
      if (i >= 0) { selectedChannels.splice(i, 1); c.classList.remove('on'); }
      else { selectedChannels.push(k); c.classList.add('on'); }
    };
    chips.appendChild(c);
  });
  anchor.onchange = function () { $('anchor-count-wrap').style.display = anchor.value === 'custom' ? 'block' : 'none'; };
  $('inputs-btn').onclick = function () { $('drawer').classList.toggle('open'); };

  // ---- rail ----
  function renderRail() {
    $('agents').innerHTML = AGENT_DEFS.map(function (d) {
      var a = orch ? orch.agents[d[0]] : null;
      var st = a ? a.status : (d[2].indexOf('awaiting') >= 0 ? 'pending' : 'idle');
      var note = a && a.status !== 'idle' ? a.status : d[2];
      return '<div class="agent ' + st + '"><div class="nm"><span class="dot"></span>' + esc(d[1]) + '</div>' +
        '<div class="st">' + esc(note) + '</div></div>';
    }).join('');
  }
  renderRail();

  // ---- stream ----
  var streamCleared = false;
  function addLine(evt) {
    if (!streamCleared) { $('stream').innerHTML = ''; streamCleared = true; }
    var t = new Date();
    var ts = ('0' + t.getHours()).slice(-2) + ':' + ('0' + t.getMinutes()).slice(-2) + ':' + ('0' + t.getSeconds()).slice(-2);
    var name = orch && orch.agents[evt.agent] ? orch.agents[evt.agent].name : evt.agent;
    var div = document.createElement('div');
    div.className = 'sline' + (evt.status === 'error' ? ' err' : '');
    div.dataset.agent = evt.agent;
    div.innerHTML = '<span class="ts">' + ts + '</span><span class="ag">' + esc(name.toUpperCase()) + '</span><span class="tx">' + esc(evt.text) + '</span>';
    $('stream').appendChild(div);
    $('stream').scrollTop = $('stream').scrollHeight;
  }

  // ---- tabs ----
  document.querySelectorAll('.tab').forEach(function (t) {
    t.onclick = function () {
      document.querySelectorAll('.tab').forEach(function (x) { x.classList.remove('on'); });
      document.querySelectorAll('.panel').forEach(function (x) { x.classList.remove('on'); });
      t.classList.add('on');
      $('p-' + t.dataset.p).classList.add('on');
    };
  });
  function switchTab(p) {
    document.querySelectorAll('.tab').forEach(function (x) { x.classList.toggle('on', x.dataset.p === p); });
    document.querySelectorAll('.panel').forEach(function (x) { x.classList.toggle('on', x.id === 'p-' + p); });
  }

  // ---- charts ----
  function drawFan(canvas, fan) {
    var ctx = canvas.getContext('2d');
    var W = canvas.width = 700, H = canvas.height = 280, padL = 46, padB = 26, padT = 12, padR = 10;
    var maxY = Math.max.apply(null, fan.map(function (f) { return f.p90; }).concat([10]));
    ctx.clearRect(0, 0, W, H);
    ctx.font = '11px ui-monospace, monospace';
    ctx.strokeStyle = '#262626'; ctx.fillStyle = '#8F8F8F'; ctx.lineWidth = 1;
    for (var g = 0; g <= 4; g++) {
      var yv = maxY * g / 4, y = padT + (H - padB - padT) * (1 - g / 4);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
      ctx.fillText(fmt(yv), 6, y + 4);
    }
    function X(i) { return padL + (W - padL - padR) * (i / (fan.length - 1)); }
    function Y(v) { return padT + (H - padB - padT) * (1 - v / maxY); }
    ctx.beginPath();
    fan.forEach(function (f, i) { i ? ctx.lineTo(X(i), Y(f.p90)) : ctx.moveTo(X(i), Y(f.p90)); });
    for (var i = fan.length - 1; i >= 0; i--) ctx.lineTo(X(i), Y(fan[i].p10));
    ctx.closePath(); ctx.fillStyle = 'rgba(255,107,26,0.16)'; ctx.fill();
    ctx.beginPath();
    fan.forEach(function (f, i) { i ? ctx.lineTo(X(i), Y(f.p50)) : ctx.moveTo(X(i), Y(f.p50)); });
    ctx.strokeStyle = '#FF6B1A'; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.fillStyle = '#8F8F8F';
    ctx.fillText('month 1', padL, H - 8); ctx.fillText('month ' + fan.length + '  (band: P10-P90, line: median)', padL + 70, H - 8);
  }

  function drawSimChart(canvas, series, panel) {
    var ctx = canvas.getContext('2d');
    var W = canvas.width = 700, H = canvas.height = 260, padL = 40, padB = 24, padT = 12, padR = 10;
    var maxY = Math.max(panel, 10);
    ctx.clearRect(0, 0, W, H);
    ctx.font = '11px ui-monospace, monospace';
    ctx.strokeStyle = '#262626'; ctx.fillStyle = '#8F8F8F'; ctx.lineWidth = 1;
    for (var g = 0; g <= 4; g++) {
      var yv = maxY * g / 4, y = padT + (H - padB - padT) * (1 - g / 4);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
      ctx.fillText(Math.round(yv), 6, y + 4);
    }
    function X(i) { return padL + (W - padL - padR) * (i / Math.max(series.length - 1, 1)); }
    function Y(v) { return padT + (H - padB - padT) * (1 - v / maxY); }
    function line(key, color, width) {
      ctx.beginPath();
      series.forEach(function (r, i) { i ? ctx.lineTo(X(i), Y(r[key])) : ctx.moveTo(X(i), Y(r[key])); });
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
    }
    if (series.length) {
      line('aware', '#8F8F8F', 1.5);
      line('customers', '#FF6B1A', 2.5);
      series.forEach(function (r, i) {
        ctx.beginPath(); ctx.arc(X(i), Y(r.customers), 3, 0, 7); ctx.fillStyle = '#FF6B1A'; ctx.fill();
      });
    }
    ctx.fillStyle = '#8F8F8F';
    ctx.fillText('month 1', padL, H - 6);
    ctx.fillText('customers (orange) / aware (grey) of ' + panel + ' agents', padL + 70, H - 6);
  }

  // ---- panel renderers ----
  function renderSignals(sig) {
    var h = '<div class="card"><span class="pill">LIVE DATA - ' + esc((sig.sourcesUsed || []).join(', ').toUpperCase()) + '</span>' +
      '<h3>Demand read: ' + esc(sig.readiness || '-') + '</h3><p style="font-size:12.5px;color:#DDD">' + esc(sig.summary || '') + '</p>' +
      (sig.evidence_note ? '<p class="note">Data quality: ' + esc(sig.evidence_note) + '</p>' : '') + '</div>';
    if (sig.pain_points && sig.pain_points.length) {
      h += '<div class="card"><h3>Pain points found in the wild</h3>' +
        sig.pain_points.map(function (p) { return '<div class="sig-item">' + esc(p) + '</div>'; }).join('') + '</div>';
    }
    if (sig.demand_signals && sig.demand_signals.length) {
      h += '<div class="card"><h3>Demand signals</h3>' +
        sig.demand_signals.map(function (p) { return '<div class="sig-item">' + esc(p) + '</div>'; }).join('') + '</div>';
    }
    if (sig.threads && sig.threads.length) {
      h += '<div class="card"><h3>Source threads (click through - real data)</h3>' +
        sig.threads.map(function (t) {
          return '<a class="thread" href="' + esc(t.url) + '" target="_blank" rel="noopener">' + esc(t.title) +
            '<span class="meta"> - ' + esc(t.source) + ' - ' + (t.score || 0) + ' pts, ' + (t.comments || 0) + ' comments</span></a>';
        }).join('') + '</div>';
    }
    $('p-signals').innerHTML = h;
    switchTab('signals');
  }

  function renderPanelMetrics(res) {
    var last = res.series[res.series.length - 1];
    var h = '<div class="card"><span class="pill">REAL AI AGENTS - GEMINI</span>' +
      '<div class="metric-grid">' +
      '<div class="metric"><div class="v">' + Math.round(res.adoptionRate * 100) + '%</div><div class="k">reached consumers who buy (' + res.customersFinal + '/' + res.panel + ')</div></div>' +
      '<div class="metric"><div class="v">' + (res.wtpMedian ? money(res.wtpMedian) : '-') + '</div><div class="k">median willingness to pay/mo</div></div>' +
      '<div class="metric"><div class="v">' + last.recommended + '</div><div class="k">agents recommending (final month)</div></div>' +
      '<div class="metric"><div class="v">' + last.aware + '</div><div class="k">agents reached (final month)</div></div>' +
      '</div>' +
      '<p class="note">Method: LLM-agent market simulation (Generative Agents 2023; EconAgent ACL 2024; MarketFish MIT 2026), decisions constrained by per-round base-rate priors from cited conversion benchmarks. Directional behavioral evidence, not a forecast - LLM panels skew optimistic even calibrated.</p></div>' +
      '<div class="card"><canvas id="sim-chart-final" width="700" height="260"></canvas></div>';
    if (res.quotes && res.quotes.length) {
      h += '<div class="card"><h3>What the agents said</h3>' + res.quotes.map(function (q) {
        return '<div class="quote"><span class="qtag ' + esc(q.action) + '">' + esc(q.action.toUpperCase()) + '</span><b>#' + q.id + '</b> "' + esc(q.why) + '"</div>';
      }).join('') + '</div>';
    }
    $('p-panel').innerHTML = h;
    drawSimChart($('sim-chart-final'), res.series, res.panel);
  }

  function renderStrategy(s, grounded) {
    var h = '<div class="card"><span class="pill">AI STRATEGY - GEMINI' + (grounded ? ' + AGENT SIM + SIGNALS' : '') + '</span>';
    h += '<div class="ai-sec"><h3>Positioning</h3><p>' + esc(s.positioning) + '</p></div>';
    h += '<div class="ai-sec"><h3>Verdict</h3><p>' + esc(s.verdict) + '</p></div>';
    h += '<div class="ai-sec"><h3>Channel plays</h3>' + (s.channels || []).map(function (c, i) {
      return '<p><b>' + (i + 1) + '. ' + esc(c.name) + '</b> - ' + esc(c.why) + '</p><ul>' + (c.steps || []).map(function (st) { return '<li>' + esc(st) + '</li>'; }).join('') + '</ul>';
    }).join('') + '</div>';
    h += '<div class="ai-sec"><h3>Pricing</h3><p>' + esc(s.pricing) + '</p></div>';
    h += '<div class="ai-sec"><h3>90-day plan</h3><ul>' + (s.plan90 || []).map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul></div>';
    h += '<div class="ai-sec"><h3>Risks</h3><ul>' + (s.risks || []).map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul></div>';
    h += '<div class="ai-sec"><h3>Contrarian move</h3><p>' + esc(s.contrarian) + '</p></div></div>';
    $('p-strategy').innerHTML = h;
  }

  function renderBaseline(R) {
    var h = '<div class="card"><span class="pill">DETERMINISTIC - CITED BENCHMARKS, NO AI</span>' +
      '<div class="metric-grid">' +
      '<div class="metric"><div class="v">' + fmt(R.sim.customersEnd.p50) + '</div><div class="k">customers, month 12 (median)</div></div>' +
      '<div class="metric"><div class="v">' + money(R.sim.mrrEnd.p50) + '</div><div class="k">MRR, month 12 (median)</div></div>' +
      '<div class="metric"><div class="v">' + (R.cac ? money(R.cac) : '-') + '</div><div class="k">blended CAC</div></div>' +
      '<div class="metric"><div class="v">' + (R.econ.ltvCac ? R.econ.ltvCac.toFixed(1) : '-') + '</div><div class="k">LTV / CAC</div></div>' +
      '</div>' +
      '<p class="note">TAM ' + fmt(R.sizing.tamCustomers) + ' customers (' + money(R.sizing.tamRevenueYr) + '/yr) - SAM ' + fmt(R.sizing.samCustomers) + ' - SOM yr-1 median ' + fmt(R.sizing.somCustomersYr1) + '. 3,000 simulated futures, parameters sampled around cited public benchmarks (see v1 app for full source list).</p></div>' +
      '<div class="card"><canvas id="fan-final" width="700" height="280"></canvas></div>';
    $('p-baseline').innerHTML = h;
    drawFan($('fan-final'), R.sim.fan);
  }

  // ---- inputs ----
  function readInputs() {
    var anchorKey = anchor.value;
    return {
      productName: $('h-name').value.trim() || 'Untitled product',
      description: $('pdesc').value.trim(),
      productType: ptype.value,
      productTypeLabel: BENCH.econ[ptype.value].label,
      geography: geo.value,
      geoLabel: BENCH.geo[geo.value].label,
      anchorKey: anchorKey,
      anchorLabel: BENCH.anchors[anchorKey].label,
      anchorCount: anchorKey === 'custom' ? Math.max(100, +$('anchorCount').value || 100000) : BENCH.anchors[anchorKey].count,
      price: Math.max(0.5, +$('h-price').value || 20),
      monthlyBudget: Math.max(0, +$('budget').value || 0),
      existingCustomers: Math.max(0, +$('existing').value || 0),
      startingCash: Math.max(0, +$('cash').value || 0),
      channels: selectedChannels.slice()
    };
  }

  function monthlyExposures(input) {
    var tw = 0, total = 0;
    input.channels.forEach(function (k) { var c = BENCH.channels[k]; if (c) tw += c.weight; });
    if (!tw) tw = 1;
    input.channels.forEach(function (k) {
      var c = BENCH.channels[k]; if (!c) return;
      var spend = input.monthlyBudget * (c.weight / tw);
      if (c.kind === 'paid_impression') total += spend / c.cpm * 1000;
      else if (c.kind === 'outbound') total += spend / c.costPer1kTouches * 1000;
      else if (c.kind === 'organic_content') total += spend / c.costPerPiece * c.trafficPerPiece;
    });
    return total;
  }

  // ---- run ----
  var running = false;
  $('run-btn').onclick = function () {
    if (running) return;
    var input = readInputs();
    if (!input.channels.length) { alert('Pick at least one channel in Inputs.'); return; }
    running = true;
    $('run-btn').disabled = true; $('run-btn').textContent = 'Agents deployed - working...';
    $('drawer').classList.remove('open');
    input.monthlyExposures = monthlyExposures(input);
    lastInput = input; simSeries = [];

    orch = new Orchestrator(function (evt) { addLine(evt); renderRail(); });
    AGENT_DEFS.forEach(function (d) { orch.register(d[0], d[1], d[2]); });
    ['reddit-agent', 'linkedin-agent', 'g2-agent', 'trends-agent'].forEach(function (id) {
      orch.pending(id, orch.agents[id].name + ': Bright Data queued (key vault delivery + one-time activation pending)');
    });
    renderRail();

    Agents.plan(orch, input).then(function (plan) {
      var R = Agents.quantAnalyst(orch, input);
      if (R) { lastR = R; renderBaseline(R); }
      return Agents.socialListening(orch, input, plan.queries).then(function (signals) {
        if (signals) renderSignals(signals);
        return Agents.consumerPanel(orch, input, signals, function (row) {
          simSeries.push(row);
        }).then(function (sim) {
          if (sim) { renderPanelMetrics(sim); switchTab('panel'); }
          return Agents.strategist(orch, input, R, sim, signals).then(function (s) {
            if (s) { renderStrategy(s, !!(sim || signals)); switchTab('strategy'); }
            else { $('p-strategy').innerHTML = '<div class="card"><h3>Strategy</h3><p class="note">Strategy generation failed this run (see stream - usually the free-tier rate limit after the 14-call simulation). Re-run in a few minutes; all other agent findings above still stand.</p></div>'; }
            orch.log('orchestrator', 'Run complete. All agent findings are in the panels on the right.');
            running = false;
            $('run-btn').disabled = false; $('run-btn').textContent = 'Deploy agents';
          });
        });
      });
    }).catch(function (e) {
      addLine({ agent: 'orchestrator', status: 'error', text: 'Run aborted: ' + (e.message || 'unknown') });
      running = false;
      $('run-btn').disabled = false; $('run-btn').textContent = 'Deploy agents';
    });
  };
})();
