# Multi-agent visible system - build plan (from user voice note 2026-10-24)

User vision: a literal serious product. Desktop dashboard UI (NVIDIA-style control room,
dense panels, dark, no emojis; mobile no longer a constraint). A VISIBLE multi-agent system:
an orchestrator delegates research tasks to sub-agents that pull REAL web data
(LinkedIn, Instagram, Reddit, forums, reviews), summarize trends / market need / demand /
reviews, all activity shown live to the user, then real analysis + the agent consumer
simulation on top. "Everything should be visible to me as the user."

## Current live state (v2, verified 2026-10-24)
- 48-agent LLM consumer simulation, browser-orchestrated via Worker /api/agent-step,
  calibrated with per-round base-rate priors (verified 17% adoption curve, WTP $12).
- Strategy rebuilt with sim evidence (pill: GEMINI + AGENT SIM).
- HF Space backend shelved in /space (HF paywalled Docker Spaces; free-tier rule).
- Apify API token: in vault (login "Apify API token", apify.com), vault fill authorized.
  Plan: pull server-side into Worker secret (never expose to browser).

## Next build (v3)
1. Dashboard layout: left agent-status rail, center live activity stream, right results
   panels (quant engine + deep sim embedded).
2. Orchestrator in-browser: decomposes product input -> spawns named sub-agents, streams
   status/log/findings visibly.
3. Sub-agents (real data -> Gemini summary via Worker):
   - social-listening: Reddit public JSON + HN Algolia (free, no auth) primary;
     LinkedIn/Instagram via Apify actors (server-side token, on demand - credits burn).
   - reviews: G2/Capterra/Amazon via Apify.
   - trends: Google Trends via Apify actor.
4. Market signals feed the sim: personas grounded in real pain points found in the data.
5. Synthesis: orchestrator aggregates into market-read report (demand, sentiment,
   competitor gaps) feeding sim + strategy. Every number tagged with its source.

Defaults assumed (reported, awaiting correction): Reddit/HN/G2 primary, LinkedIn on demand;
keep orange/black brand in the NVIDIA-style layout.
