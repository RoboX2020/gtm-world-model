// ============================================================================
// engine.js - the math brain of GTM World Model (no UI code at all).
//
// What it does, in plain terms: you describe a product (price, budget, market,
// channels) and this file answers three questions with numbers:
//   1. MARKET SIZING - how many customers could exist (TAM/SAM/SOM)
//   2. CHANNEL ECONOMICS - what each marketing channel buys you per dollar
//   3. MONTE CARLO SIMULATION - instead of ONE predicted future, it plays out
//      3,000 slightly different "first years" (each with different luck) and
//      reports the median, the pessimistic (P10) and optimistic (P90) outcomes.
// Everything is a pure function (same input -> same output, no web page needed),
// so the browser app and the node test suite share this exact code.
// All benchmark values come from benchmarks.js (BENCH), each with a public source.
// ============================================================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.Engine = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {

  // ---------- helpers ----------
  // Keep x inside [lo, hi] - used so percentages and indices can't escape range.
  function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }

  // Draw one random sample from a LOG-NORMAL distribution. Why log-normal: things
  // like churn rate or channel performance can't go below zero but can sometimes
  // be much higher than typical - a lopsided bell curve, which log-normal models
  // and a plain bell curve (normal) cannot.
  function lognormSample(rng, median, sigma) {
    // median of the lognormal is exp(mu); sample = median * exp(sigma * Z)
    // Box-Muller transform: turn two uniform random numbers into one standard
    // normal (bell curve) value Z. (max with 1e-12 avoids log(0) = -Infinity.)
    var u1 = Math.max(rng(), 1e-12), u2 = rng();
    var z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return median * Math.exp(sigma * z);
  }

  // mulberry32: a tiny seeded random number generator. "Seeded" means the same
  // seed always produces the same sequence - so every visitor running the same
  // inputs sees the SAME 3,000 simulated futures, and tests can reproduce bugs.
  // (The >>> and Math.imul calls force 32-bit integer math, which JS lacks natively.)
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Find the p-th percentile of an already-sorted list (e.g. p=50 is the median).
  // When p lands between two entries, blend them proportionally (linear
  // interpolation) instead of just picking one - standard percentile practice.
  function percentile(sorted, p) {
    if (!sorted.length) return 0;
    var i = clamp((p / 100) * (sorted.length - 1), 0, sorted.length - 1);
    var lo = Math.floor(i), hi = Math.ceil(i);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
  }

  // ---------- market sizing ----------
  // The classic TAM -> SAM -> SOM funnel investors ask about:
  //   TAM (Total Addressable Market): everyone who could EVER buy this.
  //   SAM (Serviceable Available Market): the slice your product type and region
  //         realistically serve.
  //   SOM (Serviceable Obtainable Market): the slice you can actually win soon
  //         (computed later in runAll from the simulation).
  // anchorCount: number of potential customer entities in geography (businesses or people)
  // price: monthly-equivalent revenue per customer in USD (one-time sales: annual spend / 12)
  function marketSizing(input, B) {
    var geo = B.geo[input.geography] || B.geo.us;
    // TAM: the anchor population, scaled by what share of it this geography holds.
    var tamCustomers = Math.round(input.anchorCount * geo.anchorShare);
    var tamRevenueYr = tamCustomers * input.price * 12;
    // SAM: TAM x the share wanting this product type x the region's relative
    // spending power.
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
  // The "is one customer worth what it costs to win them?" math.
  function unitEconomics(input, B, blendedCac) {
    var typ = B.econ[input.productType] || B.econ.b2b_saas;
    var margin = typ.grossMargin;
    var churnMo = typ.churnMonthly;
    // Expected customer lifetime: if 5% leave each month, the average customer
    // stays 1/0.05 = 20 months. (Geometric-series shortcut.) No churn -> assume 36.
    var lifetimeMo = churnMo > 0 ? 1 / churnMo : 36;
    var ltv;
    if (typ.purchaseModel === 'subscription') {
      // LTV = monthly price x profit margin x how many months they stay.
      ltv = input.price * margin * lifetimeMo;
    } else {
      // one-time / transactional: annual orders * price * margin * lifespan years
      ltv = input.price * 12 * margin * typ.repeatFactor;
    }
    // LTV:CAC ratio - the single most-watched health number: above ~3 is healthy.
    var ltvCac = blendedCac > 0 ? ltv / blendedCac : null;
    // Payback: how many months of profit until the acquisition cost is earned back.
    var paybackMo = (blendedCac > 0 && input.price * margin > 0) ? blendedCac / (input.price * margin) : null;
    return {
      grossMargin: margin, churnMonthly: churnMo, lifetimeMonths: Math.round(lifetimeMo),
      ltv: Math.round(ltv), ltvCac: ltvCac, paybackMonths: paybackMo
    };
  }

  // ---------- Monte Carlo world model ----------
  // Simulates N futures over `months` months. Each future samples parameter uncertainty.
  // WHY simulate 3,000 times instead of computing one answer: the inputs (churn,
  // channel performance, viral spread) are uncertain, so one "expected" answer
  // hides the risk. Running thousands of futures, each with its own luck, gives a
  // DISTRIBUTION: the median outcome, the bad-luck P10, the good-luck P90, and
  // the fraction of futures that hit milestones like 1,000 customers.
  function simulate(input, B, opts) {
    var N = (opts && opts.n) || 3000;
    var months = (opts && opts.months) || 12;
    var seed = (opts && opts.seed) || 1337;
    var rng = mulberry32(seed);
    var econ = B.econ[input.productType] || B.econ.b2b_saas;
    var channels = channelModel(input, B).filter(function (c) { return c.kind !== 'viral'; });
    // Viral channels are pulled out separately: their growth COMPOUNDS month to
    // month inside the loop, so they can't be a flat monthly rate like ads.
    var viral = null;
    input.channels.forEach(function (chId) {
      if (B.channels[chId] && B.channels[chId].kind === 'viral') viral = B.channels[chId];
    });
    var endings = [], mrrEndings = [], minCash = [];
    var hitCust = {}, hitMRR = {};
    var milestonesC = [100, 1000, 10000], milestonesM = [1000, 10000];
    var p50path = [];
    var allPaths = [];
    // === One simulated future per iteration of this loop ===
    for (var s = 0; s < N; s++) {
      var customers = input.existingCustomers || 0;
      // Roll this future's dice: its own churn rate and channel performance,
      // each sampled around the benchmark median with uncertainty (sigma).
      var churn = lognormSample(rng, econ.churnMonthly, 0.35);
      var channelRates = channels.map(function (c) {
        var rate = c.customersPerMonth * lognormSample(rng, 1, 0.45);
        return { rate: Math.max(rate, 0), ramp: Math.max(c.rampMonths, 1) };
      });
      var k = viral ? viral.kFactor * lognormSample(rng, 1, 0.5) : 0;
      var cash = input.startingCash || 0;
      // minC tracks the lowest cash point this future ever hits (runway worst case).
      var minC = cash;
      var path = [];
      var hitC = {}, hitM = {};
      // === One simulated month per iteration of this loop ===
      for (var m = 1; m <= months; m++) {
        var newC = 0;
        channelRates.forEach(function (cr) {
          // Channels ramp up: in month m of a cr.ramp-month ramp, only m/ramp of
          // the steady rate arrives (ads take time to optimize, content to rank).
          var rampFactor = Math.min(1, m / cr.ramp);
          newC += cr.rate * rampFactor;
        });
        // viral loop: each customer brings k new customers per cycle (~monthly cycle).
        // The 0.25 factor scales the benchmark's cycle rate into this monthly step.
        newC += customers * k * 0.25;
        var churned = customers * churn;
        customers = Math.max(0, customers + newC - churned);
        var rev = customers * input.price;
        var spend = input.monthlyBudget + customers * input.price * (1 - econ.grossMargin);
        // Cash this month: gross profit in, marketing budget out.
        cash += rev * econ.grossMargin - input.monthlyBudget;
        if (cash < minC) minC = cash;
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
      allPaths.push(path);
      for (var k2 in hitC) { hitCust[k2] = (hitCust[k2] || 0) + 1; }
      for (var k3 in hitM) { hitMRR[k3] = (hitMRR[k3] || 0) + 1; }
    }
    endings.sort(function (a, b) { return a - b; });
    mrrEndings.sort(function (a, b) { return a - b; });
    minCash.sort(function (a, b) { return a - b; });
    // fan chart: per month percentiles across paths. For each month, gather that
    // month from all 3,000 futures, sort, and take P10/P50/P90 - the three curves
    // the UI draws as the widening "fan" of possible futures.
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
    // NOTE (pre-existing quirk, kept as-is): the next line's min/max nesting
    // always evaluates to somModel, and the line after overwrites with somModel
    // anyway - so the capture cap is only REPORTED (somCaptureCeiling below),
    // never actually applied. Flagging so a reader doesn't "fix" it by accident.
    sizing.somCustomersYr1 = Math.min(somModel, Math.max(somModel, Math.min(somCap, somModel))); // model-driven, cap documented
    sizing.somCustomersYr1 = somModel;
    sizing.somRevenueYr1 = Math.round(somModel * input.price * 12);
    sizing.somCaptureCeiling = somCap;
    return { sizing: sizing, channels: channels, cac: cac, econ: econ, sim: sim };
  }

  return {
    marketSizing: marketSizing, channelModel: channelModel,
    unitEconomics: unitEconomics, simulate: simulate, blendedCac: blendedCac, runAll: runAll,
    _helpers: { lognormSample: lognormSample, mulberry32: mulberry32, percentile: percentile }
  };
});
