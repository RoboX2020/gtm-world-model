/* Benchmark dataset v1 (2026-10-24).
   Every entry is either a cited public source (src+url) or an explicit modeling
   assumption (src:"assumption") that the UI labels as such. Directional, not advice. */
const BENCH = {
  version: "2026-10-24",
  sources: {
    wordstream_search: { name: "WordStream/LocaliQ Search Ads Benchmarks 2024 (17k campaigns, Apr 2023-Mar 2024)", url: "https://www.wordstream.com/blog/2024-google-ads-benchmarks" },
    mesha_meta: { name: "Mesha Facebook CPM Benchmarks 2025", url: "https://trymesha.com/benchmark/facebook/" },
    wordstream_fb: { name: "WordStream Facebook Ads Benchmarks 2025", url: "https://www.wordstream.com/wp-content/uploads/2025/09/ws-guide-2025-fb-benchmarks.pdf" },
    firstpagesage_cac: { name: "FirstPageSage CAC by Industry (B2B), 2025-2026", url: "https://firstpagesage.com/reports/average-customer-acquisition-cost-cac-by-industry-b2b-edition-fc" },
    belkins: { name: "Belkins & friends B2B Cold Outreach Benchmarks 2025 (16.5M emails)", url: "https://belkins.io/resources/b2b-cold-outreach-benchmarks" },
    backlinko: { name: "Backlinko/Pitchbox 12M outreach email study", url: "https://backlinko.com/email-outreach-study" },
    chartmogul: { name: "ChartMogul SaaS Retention Report 2023", url: "https://chartmogul.com/reports/saas-retention-report/" },
    saascapital: { name: "SaaS Capital B2B SaaS Retention Benchmarks 2025", url: "https://www.saas-capital.com/wp-content/uploads/2025/09/RB32WS1-2025-B2B-SaaS-Retention-Benchmarks.pdf" },
    gtmsauce_appsflyer: { name: "AppsFlyer iOS D30 retention average via GTM Sauce", url: "https://gtmsauce.com/benchmarks/app-retention-churn" },
    sba: { name: "U.S. SBA Office of Advocacy, FAQ July 2024", url: "https://advocacy.sba.gov/wp-content/uploads/2024/12/Frequently-Asked-Questions-About-Small-Business_2024-508.pdf" },
    nces: { name: "U.S. NCES, undergraduate enrollment (fall 2023)", url: "https://nces.ed.gov/programs/coe/indicator/cha" },
    census: { name: "U.S. Census Bureau, households 2023", url: "https://www.census.gov/quickfacts/fact/table/US/HSD310223" },
    itu: { name: "ITU Facts and Figures 2024 (5.5B people online)", url: "https://www.itu.int/itu-d/reports/statistics/facts-figures-2024/" },
    bls: { name: "U.S. BLS Occupational Outlook, software developers", url: "https://www.bls.gov/ooh/computer-and-information-technology/software-developers.htm" }
  },

  // Geography adjustment on a US-based anchor count. anchorShare scales reachable
  // entities, spendShare scales realistic revenue capture. Modeling assumptions.
  geo: {
    us:            { label: "United States",   anchorShare: 1.0,  spendShare: 1.0,  src: "assumption" },
    north_america: { label: "North America",   anchorShare: 1.12, spendShare: 1.0,  src: "assumption" },
    europe:        { label: "Europe",          anchorShare: 1.35, spendShare: 0.8,  src: "assumption" },
    global:        { label: "Global",          anchorShare: 4.5,  spendShare: 0.55, src: "assumption" }
  },

  // Curated market anchors (counts of potential customer entities). User can override.
  anchors: {
    us_small_businesses:   { label: "US small businesses",        count: 34752434, src: "sba" },
    us_employer_businesses:{ label: "US employer businesses",     count: 6274916,  src: "sba" },
    us_college_students:   { label: "US college students",        count: 18900000, src: "nces" },
    us_households:         { label: "US households",              count: 131400000, src: "census" },
    global_internet_users: { label: "Global internet users",      count: 5500000000, src: "itu" },
    us_software_developers:{ label: "US software developers",     count: 1660000,  src: "bls" },
    custom:                { label: "Custom count",               count: 100000,   src: "assumption" }
  },

  // Share of TAM realistically serviceable (segment/geography/channel fit). Assumptions.
  segmentShare: {
    b2b_saas:         { sam: 0.15, src: "assumption" },
    b2c_subscription: { sam: 0.10, src: "assumption" },
    consumer_app:     { sam: 0.20, src: "assumption" },
    marketplace:      { sam: 0.08, src: "assumption" },
    ecommerce:        { sam: 0.12, src: "assumption" },
    hardware:         { sam: 0.06, src: "assumption" },
    devtools:         { sam: 0.18, src: "assumption" }
  },

  // Year-1 capture ceiling vs SAM. Assumptions, used as a documented ceiling only.
  captureCap: {
    b2b_saas: 0.005, b2c_subscription: 0.01, consumer_app: 0.03, marketplace: 0.004,
    ecommerce: 0.004, hardware: 0.003, devtools: 0.008
  },

  // Unit economics per product type.
  // churn sources: ChartMogul 2023 (customer retention 72-80% annual, <$1M ARR) ->
  // ~2-4%/mo SMB SaaS; AppsFlyer D30 ~4% informs consumer-app churn.
  econ: {
    b2b_saas:         { label: "B2B SaaS",           purchaseModel: "subscription", grossMargin: 0.77, churnMonthly: 0.030, repeatFactor: 1, src: "saascapital" },
    b2c_subscription: { label: "B2C subscription",   purchaseModel: "subscription", grossMargin: 0.75, churnMonthly: 0.060, repeatFactor: 1, src: "chartmogul" },
    consumer_app:     { label: "Consumer app",       purchaseModel: "subscription", grossMargin: 0.80, churnMonthly: 0.080, repeatFactor: 1, src: "gtmsauce_appsflyer" },
    marketplace:      { label: "Marketplace",        purchaseModel: "transactional", grossMargin: 0.70, churnMonthly: 0.050, repeatFactor: 0.6, src: "assumption" },
    ecommerce:        { label: "E-commerce / D2C",   purchaseModel: "transactional", grossMargin: 0.45, churnMonthly: 0.050, repeatFactor: 0.35, src: "firstpagesage_cac" },
    hardware:         { label: "Hardware / deep tech", purchaseModel: "transactional", grossMargin: 0.40, churnMonthly: 0.020, repeatFactor: 0.15, src: "assumption" },
    devtools:         { label: "Developer tools",    purchaseModel: "subscription", grossMargin: 0.80, churnMonthly: 0.035, repeatFactor: 1, src: "saascapital" }
  },

  // Acquisition channels. paid_impression: spend -> CPM impressions -> CTR clicks
  // -> CVR signups -> closeRate customers. Effective CPC = CPM x CTR / 1000.
  channels: {
    paid_search: {
      name: "Paid search (Google Ads)", kind: "paid_impression",
      cpm: 72.6, ctr: 0.0642, cvr: 0.0696, closeRate: 0.25,
      weight: 1.0, rampMonths: 1, src: "wordstream_search",
      fit: { b2b_saas: 0.8, b2c_subscription: 1.0, consumer_app: 0.7, marketplace: 0.9, ecommerce: 1.2, hardware: 0.9, devtools: 0.9 }
    },
    paid_social: {
      name: "Paid social (Meta)", kind: "paid_impression",
      cpm: 9.94, ctr: 0.010, cvr: 0.030, closeRate: 0.30,
      weight: 1.0, rampMonths: 1, src: "mesha_meta",
      fit: { b2b_saas: 0.6, b2c_subscription: 1.1, consumer_app: 1.3, marketplace: 1.0, ecommerce: 1.3, hardware: 0.9, devtools: 0.5 }
    },
    app_store_ads: {
      name: "App store ads", kind: "paid_impression",
      cpm: 65.0, ctr: 0.07, cvr: 0.55, closeRate: 0.05,
      weight: 0.8, rampMonths: 1, src: "assumption",
      fit: { b2b_saas: 0.2, b2c_subscription: 0.8, consumer_app: 1.5, marketplace: 0.5, ecommerce: 0.3, hardware: 0.2, devtools: 0.2 }
    },
    seo_content: {
      name: "SEO / content", kind: "organic_content",
      costPerPiece: 400, trafficPerPiece: 150, cvr: 0.020,
      weight: 1.0, rampMonths: 6, src: "firstpagesage_cac",
      fit: { b2b_saas: 1.3, b2c_subscription: 0.9, consumer_app: 0.5, marketplace: 1.0, ecommerce: 0.9, hardware: 0.8, devtools: 1.3 }
    },
    outbound: {
      name: "Outbound (cold email/LinkedIn)", kind: "outbound",
      costPer1kTouches: 150, replyRate: 0.05, meetingRate: 0.25, closeRate: 0.20,
      weight: 1.0, rampMonths: 2, src: "belkins",
      fit: { b2b_saas: 1.2, b2c_subscription: 0.3, consumer_app: 0.2, marketplace: 0.9, ecommerce: 0.4, hardware: 1.1, devtools: 0.8 }
    },
    communities_events: {
      name: "Communities & events", kind: "organic_content",
      costPerPiece: 300, trafficPerPiece: 80, cvr: 0.040,
      weight: 0.8, rampMonths: 3, src: "assumption",
      fit: { b2b_saas: 1.1, b2c_subscription: 0.8, consumer_app: 0.7, marketplace: 1.0, ecommerce: 0.6, hardware: 1.2, devtools: 1.4 }
    },
    viral_referral: {
      name: "Referral / viral loop", kind: "viral", kFactor: 0.15,
      weight: 0.5, rampMonths: 1, src: "assumption",
      fit: { b2b_saas: 0.8, b2c_subscription: 1.0, consumer_app: 1.5, marketplace: 1.2, ecommerce: 0.7, hardware: 0.5, devtools: 1.2 }
    }
  }
};
if (typeof module === 'object' && module.exports) { module.exports = BENCH; }
