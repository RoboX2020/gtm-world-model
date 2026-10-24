/* UI wiring, charts, worker call, local strategy fallback. */
(function () {
  'use strict';
  var API_URL = 'https://gtm-world-model-api.prajval-2029.workers.dev/api/strategy';
  var $ = function (id) { return document.getElementById(id); };
  var fmt = function (n) {
    if (n === null || n === undefined || isNaN(n)) return '-';
    if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(1) + 'B';
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e4) return (n / 1e3).toFixed(1) + 'k';
    return Math.round(n).toLocaleString('en-US');
  };
  var money = function (n) { return n === null || n === undefined || isNaN(n) ? '-' : '$' + fmt(n); };
  var pct = function (p) { return Math.round(p * 100) + '%'; };

  // ---- populate selects ----
  var ptype = $('ptype'), geo = $('geo'), anchor = $('anchor'), chips = $('channel-chips');
  Object.keys(BENCH.econ).forEach(function (k) {
    var o = document.createElement('option'); o.value = k; o.textContent = BENCH.econ[k].label; ptype.appendChild(o);
  });
  Object.keys(BENCH.geo).forEach(function (k) {
    var o = document.createElement('option'); o.value = k; o.textContent = BENCH.geo[k].label; geo.appendChild(o);
  });
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
  anchor.onchange = function () { $('anchor-count-wrap').classList.toggle('hidden', anchor.value !== 'custom'); };

  function updatePriceLabel() {
    var transactional = BENCH.econ[ptype.value].purchaseModel === 'transactional';
    $('price-label').textContent = transactional
      ? 'Avg revenue per customer ($ / month; one-time sales: annual spend / 12)'
      : 'Price ($ / month)';
  }
  ptype.addEventListener('change', updatePriceLabel);
  updatePriceLabel();

  function readInputs() {
    return {
      productName: $('pname').value.trim() || 'Untitled product',
      description: $('pdesc').value.trim(),
      productType: ptype.value,
      geography: geo.value,
      anchorKey: anchor.value,
      anchorCount: anchor.value === 'custom' ? Math.max(100, +$('anchorCount').value || 100000) : BENCH.anchors[anchor.value].count,
      price: Math.max(0.5, +$('price').value || 20),
      monthlyBudget: Math.max(0, +$('budget').value || 0),
      existingCustomers: Math.max(0, +$('existing').value || 0),
      startingCash: Math.max(0, +$('cash').value || 0),
      channels: selectedChannels.slice()
    };
  }

  // ---- charts ----
  function drawFan(canvas, fan) {
    var ctx = canvas.getContext('2d');
    var W = canvas.width, H = canvas.height, padL = 46, padB = 26, padT = 12, padR = 10;
    var maxY = Math.max.apply(null, fan.map(function (f) { return f.p90; }).concat([10]));
    ctx.clearRect(0, 0, W, H);
    ctx.font = '11px -apple-system, sans-serif';
    // gridlines
    ctx.strokeStyle = '#2A2A2A'; ctx.fillStyle = '#9C9C9C'; ctx.lineWidth = 1;
    for (var g = 0; g <= 4; g++) {
      var yv = maxY * g / 4, y = padT + (H - padB - padT) * (1 - g / 4);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
      ctx.fillText(fmt(yv), 4, y + 4);
    }
    function X(i) { return padL + (W - padL - padR) * (i / (fan.length - 1)); }
    function Y(v) { return padT + (H - padB - padT) * (1 - v / maxY); }
    // band
    ctx.beginPath();
    fan.forEach(function (f, i) { i ? ctx.lineTo(X(i), Y(f.p90)) : ctx.moveTo(X(i), Y(f.p90)); });
    for (var i = fan.length - 1; i >= 0; i--) ctx.lineTo(X(i), Y(fan[i].p10));
    ctx.closePath(); ctx.fillStyle = 'rgba(255,107,26,0.18)'; ctx.fill();
    // median
    ctx.beginPath();
    fan.forEach(function (f, i) { i ? ctx.lineTo(X(i), Y(f.p50)) : ctx.moveTo(X(i), Y(f.p50)); });
    ctx.strokeStyle = '#FF6B1A'; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.fillStyle = '#9C9C9C';
    ctx.fillText('month 1', padL, H - 8); ctx.fillText('month ' + fan.length, W - padR - 52, H - 8);
  }

  function renderFunnel(el, sizing, price) {
    var rows = [
      { lab: 'TAM', cust: sizing.tamCustomers, rev: sizing.tamRevenueYr },
      { lab: 'SAM', cust: sizing.samCustomers, rev: sizing.samRevenueYr },
      { lab: 'SOM', cust: sizing.somCustomersYr1, rev: sizing.somRevenueYr1 }
    ];
    var max = rows[0].cust || 1;
    el.innerHTML = rows.map(function (r) {
      var w = Math.max(2, Math.round(100 * Math.log10(r.cust + 1) / Math.log10(max + 1)));
      return '<div class="funnel-row"><div class="lab">' + r.lab + '</div>' +
        '<div style="flex:1"><div class="funnel-bar" style="width:' + w + '%"></div></div>' +
        '<div class="val">' + fmt(r.cust) + ' cust<br>' + money(r.rev) + '/yr</div></div>';
    }).join('') + '<p class="note">TAM = anchor count x price. SAM = serviceable share for this product type and geography. SOM = year-1 median of the simulation (ceiling ' + fmt(sizing.somCaptureCeiling) + ' customers at benchmark capture). Log scale bars.</p>';
  }

  function renderProbs(el, sim) {
    var items = [];
    Object.keys(sim.probCustomers).forEach(function (k) { items.push({ lab: fmt(+k) + '+ customers', p: sim.probCustomers[k] }); });
    Object.keys(sim.probMRR).forEach(function (k) { items.push({ lab: money(+k) + '+ MRR', p: sim.probMRR[k] }); });
    el.innerHTML = items.map(function (it) {
      return '<div class="prob"><div class="plab"><span>' + it.lab + '</span><b>' + pct(it.p) + '</b></div>' +
        '<div class="track"><div class="fill" style="width:' + Math.round(it.p * 100) + '%"></div></div></div>';
    }).join('');
  }

  function renderChannels(tbody, channels) {
    tbody.innerHTML = channels.map(function (c) {
      return '<tr><td>' + c.name + '</td><td>' + money(c.spend) + '</td>' +
        '<td>' + (c.kind === 'viral' ? 'compounds' : c.customersPerMonth.toFixed(1)) + '</td>' +
        '<td>' + (c.cac ? money(c.cac) : (c.kind === 'viral' ? '~0' : '-')) + '</td>' +
        '<td>' + (c.rampMonths <= 1 ? 'instant' : c.rampMonths + ' mo') + '</td></tr>';
    }).join('');
  }

  function renderSources(el, usedSrcKeys) {
    var html = '';
    usedSrcKeys.forEach(function (k) {
      var s = BENCH.sources[k];
      if (s) html += '<p class="src">- <a href="' + s.url + '" target="_blank" rel="noopener">' + s.name + '</a></p>';
    });
    html += '<p class="note">Entries marked "assumption" in the dataset are modeling defaults, editable in benchmarks.js. Formulas adapted from open-source bottoms-up market-sizing methods (github.com/stephenvelasquez/market-sizing-engine) and open GTM frameworks (github.com/AIDevGTM/gtm-cofounder).</p>';
    el.innerHTML = html;
  }

  // ---- local strategy fallback (used when worker/LLM unavailable) ----
  function localStrategy(input, R) {
    var econ = BENCH.econ[input.productType];
    var best = R.channels.filter(function (c) { return c.cac; }).sort(function (a, b) { return a.cac - b.cac; });
    var verdict = R.econ.ltvCac >= 3 ? 'Unit economics clear the 3.0 LTV/CAC bar that investors treat as healthy.' :
      'Unit economics are below the 3.0 LTV/CAC health bar - raise price, cut churn, or shift spend before scaling.';
    var chan = best.slice(0, 3).map(function (c) {
      return { name: c.name, why: 'Lowest modeled CAC in your mix at ' + money(c.cac) + ' with ' + c.customersPerMonth.toFixed(1) + ' customers/mo on ' + money(c.spend) + '.', steps: ['Start with ' + money(c.spend) + '/mo', 'Hold it to its benchmark conversion rate', 'Cut if CAC exceeds ' + money(c.cac * 1.5) + ' after 4 weeks'] };
    });
    return {
      positioning: input.productName + ' for ' + BENCH.anchors[input.anchorKey].label.toLowerCase() + ': ' + (input.description || 'a ' + econ.label + ' product') + '. Compete on the segment where your ' + money(R.cac || 0) + ' blended CAC and ' + pct(econ.churnMonthly) + '/mo churn still clear payback in ' + (R.econ.paybackMonths ? R.econ.paybackMonths.toFixed(1) : '?') + ' months.',
      verdict: verdict,
      channels: chan,
      pricing: 'At ' + money(input.price) + '/mo, LTV is ' + money(R.econ.ltv) + ' over a modeled ' + R.econ.lifetimeMonths + '-month lifetime. Test a 20-25% higher price before adding spend: the model shows churn, not price, is your binding constraint when LTV/CAC < 3.',
      plan90: [
        'Days 1-30: prove the cheapest channel (' + (best[0] ? best[0].name : 'your pick') + ') at benchmark CAC on a small budget.',
        'Days 31-60: fix activation until monthly churn trends under ' + pct(econ.churnMonthly) + '.',
        'Days 61-90: scale the winning channel 3x and open the second (' + (best[1] ? best[1].name : 'next') + ').'
      ],
      risks: [
        'Churn above the ' + pct(econ.churnMonthly) + ' benchmark erases the LTV advantage - watch cohort retention weekly.',
        'Paid channels drift 30-50% off benchmarks in crowded categories - the uncertainty band on the chart is the honest range.',
        'Referral K=' + (BENCH.channels.viral_referral.kFactor) + ' is assumed, not measured - instrument invites from day 1.'
      ],
      contrarian: 'Do not launch on every channel. The model says ' + (best[0] ? best[0].name : 'one channel') + ' alone produces most year-1 customers at the best CAC; depth beats breadth at this budget.'
    };
  }

  function renderAI(el, s, isLocal) {
    var h = '<span class="pill' + (isLocal ? ' local' : '') + '">' + (isLocal ? 'LOCAL STRATEGY - AI OFFLINE' : 'AI STRATEGY - GEMINI') + '</span>';
    h += '<div class="ai-sec"><h3>Positioning</h3><p>' + s.positioning + '</p></div>';
    h += '<div class="ai-sec"><h3>Verdict</h3><p>' + s.verdict + '</p></div>';
    h += '<div class="ai-sec"><h3>Channel plays</h3>' + s.channels.map(function (c, i) {
      return '<p><b>' + (i + 1) + '. ' + c.name + '</b> - ' + c.why + '</p><ul>' + c.steps.map(function (st) { return '<li>' + st + '</li>'; }).join('') + '</ul>';
    }).join('') + '</div>';
    h += '<div class="ai-sec"><h3>Pricing</h3><p>' + s.pricing + '</p></div>';
    h += '<div class="ai-sec"><h3>90-day plan</h3><ul>' + s.plan90.map(function (p) { return '<li>' + p + '</li>'; }).join('') + '</ul></div>';
    h += '<div class="ai-sec"><h3>Risks</h3><ul>' + s.risks.map(function (r) { return '<li>' + r + '</li>'; }).join('') + '</ul></div>';
    h += '<div class="ai-sec"><h3>Contrarian move</h3><p>' + s.contrarian + '</p></div>';
    el.innerHTML = h;
  }

  // ---- run ----
  var lastInput = null, lastResults = null;

  function computeAndRender(input) {
    var R = Engine.runAll(input, BENCH, { n: 3000, months: 12, seed: (Date.now() % 100000) });
    lastInput = input; lastResults = R;
    $('m-cust').textContent = fmt(R.sim.customersEnd.p50);
    $('m-cust-range').textContent = 'P10 ' + fmt(R.sim.customersEnd.p10) + ' - P90 ' + fmt(R.sim.customersEnd.p90);
    $('m-mrr').textContent = money(R.sim.mrrEnd.p50);
    $('m-mrr-range').textContent = 'P10 ' + money(R.sim.mrrEnd.p10) + ' - P90 ' + money(R.sim.mrrEnd.p90);
    $('m-cac').textContent = R.cac ? money(R.cac) : '-';
    $('m-ltvcac').textContent = R.econ.ltvCac ? 'LTV/CAC ' + R.econ.ltvCac.toFixed(1) : 'no paid channels';
    $('m-payback').textContent = R.econ.paybackMonths ? R.econ.paybackMonths.toFixed(1) + ' mo' : '-';
    $('m-ltv').textContent = 'LTV ' + money(R.econ.ltv) + ' over ' + R.econ.lifetimeMonths + ' mo';
    renderProbs($('probs'), R.sim);
    drawFan($('fan'), R.sim.fan);
    renderFunnel($('funnel'), R.sizing, input.price);
    renderChannels(document.querySelector('#channel-table tbody'), R.channels);
    var used = {};
    R.channels.forEach(function (c) { var s = BENCH.channels[c.id].src; if (s && s !== 'assumption') used[s] = 1; });
    var eSrc = BENCH.econ[input.productType].src; if (eSrc && eSrc !== 'assumption') used[eSrc] = 1;
    var aSrc = BENCH.anchors[input.anchorKey].src; if (aSrc && aSrc !== 'assumption') used[aSrc] = 1;
    renderSources($('sources'), Object.keys(used));
    // sliders
    $('s-price').value = input.price; $('s-price-v').textContent = money(input.price) + '/mo';
    $('s-budget').value = input.monthlyBudget; $('s-budget-v').textContent = money(input.monthlyBudget) + '/mo';
    return R;
  }

  function fetchStrategy(input, R) {
    $('ai-status').classList.remove('hidden');
    $('ai-body').classList.add('hidden');
    var payload = {
      input: {
        productName: input.productName, description: input.description,
        productType: BENCH.econ[input.productType].label,
        geography: BENCH.geo[input.geography].label,
        marketAnchor: BENCH.anchors[input.anchorKey].label,
        anchorCount: input.anchorCount, price: input.price,
        monthlyBudget: input.monthlyBudget, existingCustomers: input.existingCustomers,
        channels: input.channels.map(function (k) { return BENCH.channels[k].name; })
      },
      computed: {
        tamCustomers: R.sizing.tamCustomers, tamRevenueYr: Math.round(R.sizing.tamRevenueYr),
        samCustomers: R.sizing.samCustomers, samRevenueYr: Math.round(R.sizing.samRevenueYr),
        somCustomersYr1: R.sizing.somCustomersYr1,
        blendedCac: R.cac ? Math.round(R.cac) : null,
        ltv: R.econ.ltv, ltvCac: R.econ.ltvCac ? +R.econ.ltvCac.toFixed(2) : null,
        paybackMonths: R.econ.paybackMonths ? +R.econ.paybackMonths.toFixed(1) : null,
        churnMonthly: R.econ.churnMonthly, grossMargin: R.econ.grossMargin,
        sim: {
          customersEnd: R.sim.customersEnd, mrrEnd: R.sim.mrrEnd,
          probCustomers: R.sim.probCustomers, probMRR: R.sim.probMRR
        },
        channels: R.channels.map(function (c) {
          return { name: c.name, spend: c.spend, customersPerMonth: +c.customersPerMonth.toFixed(2), cac: c.cac ? Math.round(c.cac) : null, rampMonths: c.rampMonths };
        })
      }
    };
    var ctrl = new AbortController();
    var to = setTimeout(function () { ctrl.abort(); }, 45000);
    fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: ctrl.signal })
      .then(function (r) { if (!r.ok) throw new Error('api ' + r.status); return r.json(); })
      .then(function (j) {
        clearTimeout(to);
        if (!j || !j.strategy) throw new Error('bad payload');
        $('ai-status').classList.add('hidden');
        $('ai-body').classList.remove('hidden');
        renderAI($('ai-body'), j.strategy, false);
      })
      .catch(function () {
        clearTimeout(to);
        $('ai-status').classList.add('hidden');
        $('ai-body').classList.remove('hidden');
        renderAI($('ai-body'), localStrategy(input, R), true);
      });
  }

  $('run-btn').onclick = function () {
    var input = readInputs();
    if (!input.channels.length) { alert('Pick at least one channel.'); return; }
    $('form-section').classList.add('hidden');
    $('results-section').classList.remove('hidden');
    window.scrollTo(0, 0);
    var R = computeAndRender(input);
    fetchStrategy(input, R);
  };
  $('edit-btn').onclick = function () {
    $('results-section').classList.add('hidden');
    $('form-section').classList.remove('hidden');
    window.scrollTo(0, 0);
  };

  // scenario sliders: recompute quant only (fast)
  function scenarioRecompute() {
    if (!lastInput) return;
    var input = Object.assign({}, lastInput, {
      price: +$('s-price').value,
      monthlyBudget: +$('s-budget').value
    });
    $('s-price-v').textContent = money(input.price) + '/mo';
    $('s-budget-v').textContent = money(input.monthlyBudget) + '/mo';
    var exec = +$('s-exec').value / 100;
    $('s-exec-v').textContent = $('s-exec').value + '%';
    // execution quality scales channel efficiency via a shallow copy of BENCH
    var B = JSON.parse(JSON.stringify(BENCH));
    Object.keys(B.channels).forEach(function (k) {
      var c = B.channels[k];
      if (c.cvr) c.cvr *= exec;
      if (c.replyRate) c.replyRate *= exec;
      if (c.kFactor) c.kFactor *= exec;
    });
    var R = Engine.runAll(input, B, { n: 1500, months: 12, seed: 7 });
    $('m-cust').textContent = fmt(R.sim.customersEnd.p50);
    $('m-cust-range').textContent = 'P10 ' + fmt(R.sim.customersEnd.p10) + ' - P90 ' + fmt(R.sim.customersEnd.p90);
    $('m-mrr').textContent = money(R.sim.mrrEnd.p50);
    $('m-mrr-range').textContent = 'P10 ' + money(R.sim.mrrEnd.p10) + ' - P90 ' + money(R.sim.mrrEnd.p90);
    $('m-cac').textContent = R.cac ? money(R.cac) : '-';
    $('m-ltvcac').textContent = R.econ.ltvCac ? 'LTV/CAC ' + R.econ.ltvCac.toFixed(1) : '';
    $('m-payback').textContent = R.econ.paybackMonths ? R.econ.paybackMonths.toFixed(1) + ' mo' : '-';
    $('m-ltv').textContent = 'LTV ' + money(R.econ.ltv) + ' over ' + R.econ.lifetimeMonths + ' mo';
    renderProbs($('probs'), R.sim);
    drawFan($('fan'), R.sim.fan);
    renderFunnel($('funnel'), R.sizing, input.price);
    renderChannels(document.querySelector('#channel-table tbody'), R.channels);
  }
  ['s-price', 's-budget', 's-exec'].forEach(function (id) {
    $(id).addEventListener('input', scenarioRecompute);
  });
})();
