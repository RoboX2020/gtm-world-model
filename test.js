const B = require('./app/benchmarks.js');
const E = require('./app/engine.js');
let fails = 0;
function check(cond, msg) { if (!cond) { console.log('FAIL', msg); fails++; } }
const types = Object.keys(B.econ);
const allChannels = Object.keys(B.channels);
for (const t of types) {
  const input = { productType: t, geography: 'us', anchorCount: 1000000, price: t === 'hardware' ? 40 : 15, monthlyBudget: 1500, channels: allChannels, existingCustomers: 10, startingCash: 5000 };
  const R = E.runAll(input, B, { n: 800, months: 12, seed: 99 });
  const nums = [R.sizing.tamCustomers, R.sizing.samCustomers, R.sim.customersEnd.p10, R.sim.customersEnd.p50, R.sim.customersEnd.p90, R.sim.mrrEnd.p50, R.sim.probCashOut];
  for (const n of nums) if (!isFinite(n) || n < 0) { console.log('FAIL', t, 'bad number', n); fails++; }
  if (!isFinite(R.sim.cashEnd.p50) || !isFinite(R.sim.minCashP10)) { console.log('FAIL', t, 'cash not finite'); fails++; }
  check(R.sim.customersEnd.p10 <= R.sim.customersEnd.p50 && R.sim.customersEnd.p50 <= R.sim.customersEnd.p90, t + ' percentile order');
  check(R.sizing.samCustomers <= R.sizing.tamCustomers, t + ' SAM>TAM');
  check(R.sim.customersEnd.p90 <= R.sim.customerCap + 1e-6, t + ' customers exceed SAM');
  check(R.sizing.somCustomersYr1 <= R.sizing.samCustomers, t + ' SOM exceeds SAM');
  check(R.sim.probCashOut >= 0 && R.sim.probCashOut <= 1, t + ' cash-out probability');
  for (const f of R.sim.fan) if (!(f.p10 <= f.p50 && f.p50 <= f.p90)) { console.log('FAIL', t, 'fan order m' + f.month); fails++; }
  console.log(t.padEnd(18), 'CAC', R.cac ? '$' + Math.round(R.cac) : '-', 'LTV/CAC', R.econ.ltvCac ? R.econ.ltvCac.toFixed(1) : '-', 'yr1 p50', Math.round(R.sim.customersEnd.p50), 'MRR p50 $' + Math.round(R.sim.mrrEnd.p50), 'cashOut', Math.round(R.sim.probCashOut * 100) + '%');
}
const edge = E.runAll({ productType: 'b2b_saas', geography: 'global', anchorCount: 100, price: 1, monthlyBudget: 0, channels: ['viral_referral'], existingCustomers: 5, startingCash: 0 }, B, { n: 300, months: 12, seed: 1 });
console.log('edge viral-only p50:', Math.round(edge.sim.customersEnd.p50), 'cap', edge.sim.customerCap);
check(isFinite(edge.sim.customersEnd.p50), 'edge');
check(edge.sim.customersEnd.p90 <= edge.sim.customerCap + 1e-6, 'edge exceeds cap');
const edge2 = E.runAll({ productType: 'ecommerce', geography: 'europe', anchorCount: 5000, price: 8, monthlyBudget: 500, channels: ['paid_social'], existingCustomers: 0, startingCash: 1000 }, B, { n: 300, months: 12, seed: 2 });
check(isFinite(edge2.sim.customersEnd.p50), 'edge2');
const tiny = E.runAll({ productType: 'consumer_app', geography: 'us', anchorCount: 200, price: 5, monthlyBudget: 100000, channels: allChannels, existingCustomers: 0, startingCash: 1000000 }, B, { n: 400, months: 12, seed: 5 });
console.log('tiny market p90', Math.round(tiny.sim.customersEnd.p90), 'SAM', tiny.sizing.samCustomers);
check(tiny.sim.customersEnd.p90 <= tiny.sizing.samCustomers + 1e-6, 'tiny market exceeds SAM');
check(tiny.sizing.somCustomersYr1 <= tiny.sizing.samCustomers, 'tiny SOM exceeds SAM');
console.log(fails === 0 ? 'ALL TESTS PASS' : fails + ' FAILURES');
process.exit(fails === 0 ? 0 : 1);
