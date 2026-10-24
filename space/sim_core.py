"""GTM World Model - LLM-agent market simulation core (stdlib only).
Architecture follows published generative-agent market-simulation research:
Park et al. 2023 (Generative Agents), EconAgent (ACL 2024), MarketFish (2026, MIT).
Every consumer decision is a real LLM inference over a persistent persona with
memory; adoption, churn and referral emerge from individual decisions."""
import json, time, urllib.request, urllib.error

class Gemini:
    def __init__(self, key, model="gemini-2.5-flash"):
        self.key = key; self.model = model
    def chat_json(self, system, user, retries=3):
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent"
        body = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": user}]}],
            "generationConfig": {"responseMimeType": "application/json", "temperature": 0.9,
                                  "maxOutputTokens": 8192, "thinkingConfig": {"thinkingBudget": 0}}
        }
        for attempt in range(retries):
            try:
                req = urllib.request.Request(url, data=json.dumps(body).encode(),
                    headers={"Content-Type": "application/json", "x-goog-api-key": self.key})
                with urllib.request.urlopen(req, timeout=120) as r:
                    data = json.loads(r.read())
                text = data["candidates"][0]["content"]["parts"][0]["text"]
                return json.loads(text)
            except urllib.error.HTTPError as e:
                if e.code == 429 and attempt < retries - 1:
                    time.sleep(8 * (attempt + 1)); continue
                raise
            except (json.JSONDecodeError, KeyError):
                if attempt < retries - 1: continue
                raise

PERSONA_SYS = """You generate synthetic consumer personas for market simulation, in the style of published generative-agent research.
Return STRICT JSON: {"personas":[{"id":int,"name":str,"age":int,"occupation":str,"monthly_budget_usd":number,"pain_points":[str],"skepticism":0-1,"social_influence":0-1,"price_sensitivity":0-1,"bio":str}]}
Make personas genuinely heterogeneous: different budgets, skepticism, influence, needs. Ground them in the target segment. bio <= 20 words."""

DECISION_SYS = """You simulate a panel of consumers in a market. Each has an identity, budget, pain points, memory of past rounds, and hears what peers are doing.
For EACH agent, decide ONE action this round based ONLY on their persona and state:
- "ignore": not interested or unaware
- "evaluate": interested, not bought yet
- "purchase": buys the product (only if price fits budget and need is real to them)
- "recommend": an existing customer actively tells peers (raises others' awareness)
- "churn": an existing customer quits (disappointment, budget, lost interest)
Real base rates for new products: of people newly exposed, typically under 5% buy in the first month; the large majority ignore or wait; skeptical personas need repeated exposure; churn is common early. Keep the panel-level purchase fraction in that spirit unless the product is an exceptional fit for the segment AND the price is trivially affordable to them. A purchase requires the price to fit comfortably within the persona's monthly budget as discretionary spend; otherwise they evaluate at most. Be realistic and varied - most people ignore new products; tight budgets reject high prices; genuinely delighted existing customers recommend.
Return STRICT JSON: {"decisions":[{"id":int,"action":"ignore|evaluate|purchase|recommend|churn","confidence":0-1,"willingness_to_pay_usd":number,"reasoning":"<=15 words"}]}"""

def gen_personas(llm, segment_desc, n, batch=24):
    personas = []
    for start in range(0, n, batch):
        k = min(batch, n - start)
        out = llm.chat_json(PERSONA_SYS, f"Generate {k} personas, ids {start+1}..{start+k}, for this target segment: {segment_desc}")
        personas.extend(out["personas"])
    return personas

def simulate(llm, product, personas, rounds, awareness0, monthly_price, seed_reach):
    """seed_reach: fraction of panel newly exposed each round from marketing (computed from spend by the caller)."""
    state = {p["id"]: {"aware": False, "status": "none", "memory": [], "exposures": 0} for p in personas}
    # initial seeding: a fraction starts aware
    n = len(personas)
    for i, p in enumerate(personas):
        if i < int(awareness0 * n):
            state[p["id"]]["aware"] = True
    series, events = [], []
    for rnd in range(1, rounds + 1):
        adopted_share = sum(1 for s in state.values() if s["status"] == "customer") / n
        recommenders = sum(1 for s in state.values() if s["status"] == "customer")
        for s in state.values():
            if not s["aware"]:
                # marketing reach + word of mouth
                s["exposures"] += seed_reach * 3 + recommenders * 0.15
                if s["exposures"] >= 1: s["aware"] = True
            else:
                s["exposures"] += seed_reach * 2
        batch = []
        for p in personas:
            st = state[p["id"]]
            if not st["aware"] and st["exposures"] < 0.5:
                continue
            batch.append({"id": p["id"], "persona": {k: p[k] for k in ("occupation","monthly_budget_usd","skepticism","social_influence","price_sensitivity","pain_points")},
                          "state": {"status": st["status"], "exposures": round(st["exposures"],1), "memory": st["memory"][-3:]}})
        decisions = []
        if batch:
            user = (f"Product: {json.dumps(product)}\nMonthly price USD: {monthly_price}\n"
                    f"Round {rnd}/{rounds}. Market adoption so far: {adopted_share:.0%} of the panel.\n"
                    f"Agents:\n{json.dumps(batch, ensure_ascii=False)}")
            out = llm.chat_json(DECISION_SYS, user)
            decisions = out.get("decisions", [])
        bought = churned = recommended = evaluating = 0
        quotes = []
        for d in decisions:
            st = state.get(d["id"])
            if st is None: continue
            act = d.get("action"); st["aware"] = True
            st["memory"].append(f"r{rnd}:{act}")
            if act == "purchase" and st["status"] != "customer":
                st["status"] = "customer"; bought += 1
            elif act == "churn" and st["status"] == "customer":
                st["status"] = "churned"; churned += 1
            elif act == "recommend" and st["status"] == "customer":
                recommended += 1
            elif act == "evaluate" and st["status"] == "none":
                st["status"] = "evaluating"; evaluating += 1
            if d.get("reasoning"): quotes.append({"id": d["id"], "action": act, "why": d["reasoning"]})
        customers = sum(1 for s in state.values() if s["status"] == "customer")
        series.append({"round": rnd, "customers": customers, "new": bought, "churned": churned,
                       "recommended": recommended, "evaluating": evaluating,
                       "aware": sum(1 for s in state.values() if s["aware"])})
        events.extend(quotes)
    customers_final = series[-1]["customers"] if series else 0
    wtp = [d for d in decisions]
    return {"series": series, "customers_final": customers_final, "panel": n,
            "adoption_rate": customers_final / n, "quotes": quotes[-8:]}
