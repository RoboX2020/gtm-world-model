# GTM World Model

An AI go-to-market strategy engine with real-world constraints. Give it a product type,
target market, customers, price and budget - it computes market sizing, unit economics
and a Monte Carlo simulation of the next 12 months from cited public benchmarks, then
an AI strategist writes the plan on top of those numbers.

Live app: https://gtm-world-model.pages.dev

The public site is Mission Control in `v3/` (agent rail, live activity stream, results panels).
`app/` is the single-page baseline plus the optional 48-agent simulation, published at `/classic`.

## What is real vs directional

- **Real math, deterministic:** TAM/SAM/SOM, per-channel funnels, CAC/LTV/payback, and a
  3,000-run Monte Carlo over parameter uncertainty (lognormal sampling, seeded).
- **Real benchmarks:** every channel/economics value carries a public source in
  `benchmarks.js` (WordStream/LocaliQ 2024-2025, FirstPageSage, Belkins 2025,
  ChartMogul, SaaS Capital, AppsFlyer via GTM Sauce, SBA, NCES, Census, ITU, BLS).
  Entries marked `assumption` are modeling defaults, labeled as such in the UI.
- **AI narrative:** Gemini (free tier) called server-side via a Cloudflare Worker,
  constrained to the computed numbers only - it cannot invent statistics.
  If the AI is unreachable, a fully local strategy engine produces the plan from the
  same numbers (labeled "LOCAL STRATEGY - AI OFFLINE").
- **Not a promise:** outputs are directional planning ranges, not forecasts of record.

## Architecture

- `v3/` - Mission Control frontend (vanilla JS, no build step).
- `app/` - single-page baseline and deep consumer simulation.
- `worker/` - Cloudflare Worker (`gtm-world-model-api`) holding the Gemini and Bright Data keys server-side.
  The browser never sees those keys. Vercel hosts the static site and keeps calling this worker.

Not wired, on purpose, until a target URL or SERP zone exists: LinkedIn, Instagram, G2 reviews, and Google Trends.
Hacker News is live. Reddit runs through Bright Data when that key is active.

## Method credits

Built on open-source methods: bottoms-up market sizing
(github.com/stephenvelasquez/market-sizing-engine, MIT) and open GTM strategy frameworks
(github.com/AIDevGTM/gtm-cofounder). No training from scratch anywhere in the stack.
