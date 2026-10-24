const B = require('/home/sandbox/gtm/app/benchmarks.js');
const E = require('/home/sandbox/gtm/app/engine.js');
let fails = 0;
const types = Object.keys(B.econ);
const allChannels = Object.keys(B.channels);
for (const t of types) {
  const input = { productType: t, geography: 'us', anchorCount: 1000000, price: t === 'hardware' ? 40 : 15, monthlyBudget: 1500, channels: allChannels, existingCustomers: 10, startingCash: 5000 };
  const R = E.runAll(input, B, { n: 800, months: 12, seed: 99 });
  const nums = [R.sizing.tamCustomers, R.sizing.samCustomers, R.sim.customersEnd.p10, R.sim.customersEnd.p50, R.sim.customersEnd.p90, R.sim.mrrEnd.p50];
  for (const n of nums) if (!isFinite(n) || n < 0) { console.log('FAIL', t, 'bad number', n); fails++; }
  if (!(R.sim.customersEnd.p10 <= R.sim.customersEnd.p50 && R.sim.customersEnd.p50 <= R.sim.customersEnd.p90)) { console.log('FAIL', t, 'percentile order'); fails++; }
  if (!(R.sizing.samCustomers <= R.sizing.tamCustomers)) { console.log('FAIL', t, 'SAM>TAM'); fails++; }
  for (const f of R.sim.fan) if (!(f.p10 <= f.p50 && f.p50 <= f.p90)) { console.log('FAIL', t, 'fan order m' + f.month); fails++; }
  console.log(t.padEnd(18), 'CAC', R.cac ? '$' + Math.round(R.cac) : '-', 'LTV/CAC', R.econ.ltvCac ? R.econ.ltvCac.toFixed(1) : '-', 'yr1 p50', Math.round(R.sim.customersEnd.p50), 'MRR p50 $' + Math.round(R.sim.mrrEnd.p50));
}
// edge cases
const edge = E.runAll({ productType: 'b2b_saas', geography: 'global', anchorCount: 100, price: 1, monthlyBudget: 0, channels: ['viral_referral'], existingCustomers: 5, startingCash: 0 }, B, { n: 300, months: 12, seed: 1 });
console.log('edge viral-only p50:', Math.round(edge.sim.customersEnd.p50), '(start 5)');
if (!isFinite(edge.sim.customersEnd.p50)) { console.log('FAIL edge'); fails++; }
const edge2 = E.runAll({ productType: 'ecommerce', geography: 'europe', anchorCount: 5000, price: 8, monthlyBudget: 500, channels: ['paid_social'], existingCustomers: 0, startingCash: 1000 }, B, { n: 300, months: 12, seed: 2 });
if (!isFinite(edge2.sim.customersEnd.p50)) { console.log('FAIL edge2'); fails++; }
console.log(fails === 0 ? 'ALL TESTS PASS' : fails + ' FAILURES');
