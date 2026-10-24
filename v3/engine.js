/* GTM World Model - deterministic quant engine.
   Pure functions, no DOM. Loaded by the browser app and by node tests.
   All benchmark values come from benchmarks.js (BENCH), each with a public source. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.Engine = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {

  // ---------- helpers ----------
  function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }
  function lognormSample(rng, median, sigma) {
    // median of the lognormal is exp(mu); sample = median * exp(sigma * Z)
    var u1 = Math.max(rng(), 1e-12), u2 = rng();
    var z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return median * Math.exp(sigma * z);
  }
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function percentile(sorted, p) {
    if (!sorted.length) return 0;
    var i = clamp((p / 100) * (sorted.length - 1), 0, sorted.length - 1);
    var lo = Math.floor(i), hi = Math.ceil(i);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
  }

  // ---------- market sizing ----------
  // anchorCount: number of potential customer entities in geography (businesses or people)
  // price: monthly-equivalent revenue per customer in USD (one-time sales: annual spend / 12)
  function marketSizing(input, B) {
    var geo = B.geo[input.geography] || B.geo.us;
    var tamCustomers = Math.round(input.anchorCount * geo.anchorShare);
    var tamRevenueYr = tamCustomers * input.price * 12;
    var seg = B.segmentShare[input.productType] || { sam: 0.15 };
    var samCustomers = Math.round(tamCustomers * seg.sam * geo.spendShare);
    var samRevenueYr = samCustomers * input.price * 12;
    // SOM: what the acquisition model says is reachable in yr 1, capped by realistic capture
    var capRate = B.captureCap[input.productType] || 0.01;
    return {
      tamCustomers: tamCustomers, tamRevenueYr: tamRevenueYr,
      samCustomers: samCustomers, samRevenueYr: samRevenueYr,
      captureCapYr1: capRate,
      geo: geo
    };
  }

  // ---------- channel acquisition model ----------
  // Returns per-channel monthly new-customer rate at steady spend, plus blended CAC.
  function channelModel(input, B) {
    var out = [];
    var budget = Math.max(input.monthlyBudget, 0);
    var totalWeighted = 0;
    input.channels.forEach(function (chId) {
      var ch = B.channels[chId];
      if (!ch) return;
      totalWeighted += ch.weight;
    });
    if (totalWeighted === 0) totalWeighted = 1;
    input.channels.forEach(function (chId) {
      var ch = B.channels[chId];
      if (!ch) return;
      var spend = budget * (ch.weight / totalWeighted);
      var customers = 0, cac = null, notes = '';
      var typ = input.productType;
      var mult = (ch.fit[typ] !== undefined ? ch.fit[typ] : 1.0); // channel-product fit multiplier
      if (ch.kind === 'paid_impression') {
        var impressions = spend / ch.cpm * 1000;
        var clicks = impressions * ch.ctr;
        var signups = clicks * ch.cvr * mult;
        customers = signups * ch.closeRate;
        cac = customers > 0 ? spend / customers : null;
      } else if (ch.kind === 'outbound') {
        // spend buys outreach capacity: $ per 1000 touches
        var touches = spend / ch.costPer1kTouches * 1000;
        var replies = touches * ch.replyRate * mult;
        var meetings = replies * ch.meetingRate;
        customers = meetings * ch.closeRate;
        cac = customers > 0 ? spend / customers : null;
      } else if (ch.kind === 'organic_content') {
        // slow burn: budget buys content; customers ramp. Modeled at month 6 steady state.
        var pieces = spend / ch.costPerPiece;
        var monthlyTraffic = pieces * ch.trafficPerPiece * mult;
        customers = monthlyTraffic * ch.cvr;
        cac = customers > 0 ? spend / customers : null;
      } else if (ch.kind === 'viral') {
        // handled inside simulation via K-factor; here only reports the benchmark K
        customers = 0; cac = 0;
        notes = 'Compounds inside the simulation (K=' + ch.kFactor + ')';
      }
      out.push({
        id: chId, name: ch.name, spend: Math.round(spend),
        customersPerMonth: customers, cac: cac, notes: notes,
        rampMonths: ch.rampMonths, kind: ch.kind, fit: mult
      });
    });
    return out;
  }

  // ---------- unit economics ----------
  function unitEconomics(input, B, blendedCac) {
    var typ = B.econ[input.productType] || B.econ.b2b_saas;
    var margin = typ.grossMargin;
    var churnMo = typ.churnMonthly;
    var lifetimeMo = churnMo > 0 ? 1 / churnMo : 36;
    var ltv;
    if (typ.purchaseModel === 'subscription') {
      ltv = input.price * margin * lifetimeMo;
    } else {
      // one-time / transactional: annual orders * price * margin * lifespan years
      ltv = input.price * 12 * margin * typ.repeatFactor;
    }
    var ltvCac = blendedCac > 0 ? ltv / blendedCac : null;
    var paybackMo = (blendedCac > 0 && input.price * margin > 0) ? blendedCac / (input.price * margin) : null;
    return {
      grossMargin: margin, churnMonthly: churnMo, lifetimeMonths: Math.round(lifetimeMo),
      ltv: Math.round(ltv), ltvCac: ltvCac, paybackMonths: paybackMo
    };
  }

  // ---------- Monte Carlo world model ----------
  // Simulates N futures over `months` months. Each future samples parameter uncertainty.
  function simulate(input, B, opts) {
    var N = (opts && opts.n) || 3000;
    var months = (opts && opts.months) || 12;
    var seed = (opts && opts.seed) || 1337;
    var rng = mulberry32(seed);
    var econ = B.econ[input.productType] || B.econ.b2b_saas;
    // Acquisition cannot invent customers beyond the serviceable market. Keep a
    // book of business that is already larger than SAM, but do not grow past it.
    var samCap = marketSizing(input, B).samCustomers;
    var customerCap = Math.max(samCap, input.existingCustomers || 0);
    var channels = channelModel(input, B).filter(function (c) { return c.kind !== 'viral'; });
    var viral = null;
    input.channels.forEach(function (chId) {
      if (B.channels[chId] && B.channels[chId].kind === 'viral') viral = B.channels[chId];
    });
    var endings = [], mrrEndings = [], minCash = [], cashEndings = [];
    var cashOuts = 0;
    var hitCust = {}, hitMRR = {};
    var milestonesC = [100, 1000, 10000], milestonesM = [1000, 10000];
    var p50path = [];
    var allPaths = [];
    for (var s = 0; s < N; s++) {
      var customers = Math.min(input.existingCustomers || 0, customerCap);
      var churn = lognormSample(rng, econ.churnMonthly, 0.35);
      var channelRates = channels.map(function (c) {
        var rate = c.customersPerMonth * lognormSample(rng, 1, 0.45);
        return { rate: Math.max(rate, 0), ramp: Math.max(c.rampMonths, 1) };
      });
      var k = viral ? viral.kFactor * lognormSample(rng, 1, 0.5) : 0;
      var cash = input.startingCash || 0;
      var minC = cash;
      var wentNegative = false;
      var path = [];
      var hitC = {}, hitM = {};
      for (var m = 1; m <= months; m++) {
        var newC = 0;
        channelRates.forEach(function (cr) {
          var rampFactor = Math.min(1, m / cr.ramp);
          newC += cr.rate * rampFactor;
        });
        // viral loop: each customer brings k new customers per cycle (~monthly cycle)
        newC += customers * k * 0.25;
        var room = Math.max(0, customerCap - customers);
        if (newC > room) newC = room;
        var churned = customers * churn;
        customers = Math.max(0, Math.min(customerCap, customers + newC - churned));
        var rev = customers * input.price;
        cash += rev * econ.grossMargin - input.monthlyBudget;
        if (cash < minC) minC = cash;
        if (cash < 0) wentNegative = true;
        path.push(customers);
        for (var ci = 0; ci < milestonesC.length; ci++) {
          if (customers >= milestonesC[ci]) hitC[milestonesC[ci]] = true;
        }
        for (var mi = 0; mi < milestonesM.length; mi++) {
          if (rev >= milestonesM[mi]) hitM[milestonesM[mi]] = true;
        }
      }
      endings.push(customers);
      mrrEndings.push(customers * input.price);
      minCash.push(minC);
      cashEndings.push(cash);
      if (wentNegative) cashOuts += 1;
      allPaths.push(path);
      for (var k2 in hitC) { hitCust[k2] = (hitCust[k2] || 0) + 1; }
      for (var k3 in hitM) { hitMRR[k3] = (hitMRR[k3] || 0) + 1; }
    }
    endings.sort(function (a, b) { return a - b; });
    mrrEndings.sort(function (a, b) { return a - b; });
    minCash.sort(function (a, b) { return a - b; });
    cashEndings.sort(function (a, b) { return a - b; });
    // fan chart: per month percentiles across paths
    var fan = [];
    for (var m2 = 0; m2 < months; m2++) {
      var col = allPaths.map(function (p) { return p[m2]; }).sort(function (a, b) { return a - b; });
      fan.push({ month: m2 + 1, p10: percentile(col, 10), p50: percentile(col, 50), p90: percentile(col, 90) });
    }
    var probC = {}, probM = {};
    milestonesC.forEach(function (mc) { probC[mc] = ((hitCust[mc] || 0) / N); });
    milestonesM.forEach(function (mm) { probM[mm] = ((hitMRR[mm] || 0) / N); });
    return {
      n: N, months: months,
      customersEnd: { p10: percentile(endings, 10), p50: percentile(endings, 50), p90: percentile(endings, 90) },
      mrrEnd: { p10: percentile(mrrEndings, 10), p50: percentile(mrrEndings, 50), p90: percentile(mrrEndings, 90) },
      minCashP10: percentile(minCash, 10),
      minCash: { p10: percentile(minCash, 10), p50: percentile(minCash, 50) },
      cashEnd: { p10: percentile(cashEndings, 10), p50: percentile(cashEndings, 50), p90: percentile(cashEndings, 90) },
      probCashOut: cashOuts / N,
      customerCap: customerCap,
      probCustomers: probC, probMRR: probM, fan: fan
    };
  }

  function blendedCac(channels) {
    var spend = 0, cust = 0;
    channels.forEach(function (c) {
      if (c.kind === 'viral') return;
      spend += c.spend; cust += c.customersPerMonth;
    });
    return cust > 0 ? spend / cust : null;
  }

  function runAll(input, B, opts) {
    var sizing = marketSizing(input, B);
    var channels = channelModel(input, B);
    var cac = blendedCac(channels);
    var econ = unitEconomics(input, B, cac);
    var sim = simulate(input, B, opts);
    // SOM yr1 = min(model-driven p50 customers end of yr1, capture cap)
    var somModel = Math.round(sim.customersEnd.p50);
    var somCap = Math.round(sizing.samCustomers * sizing.captureCapYr1);
    // Year-1 SOM is the simulated median, and it cannot exceed the serviceable market.
    sizing.somCustomersYr1 = Math.min(somModel, sizing.samCustomers);
    sizing.somRevenueYr1 = Math.round(sizing.somCustomersYr1 * input.price * 12);
    sizing.somCaptureCeiling = somCap;
    return { sizing: sizing, channels: channels, cac: cac, econ: econ, sim: sim };
  }

  return {
    marketSizing: marketSizing, channelModel: channelModel,
    unitEconomics: unitEconomics, simulate: simulate, blendedCac: blendedCac, runAll: runAll,
    _helpers: { lognormSample: lognormSample, mulberry32: mulberry32, percentile: percentile }
  };
});
