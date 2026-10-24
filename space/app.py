"""GTM World Model - simulation service.
Real LLM-agent market simulation: a panel of AI consumers with personas,
budgets and memory; every purchase/churn/recommend decision is a Gemini
inference. Architecture follows generative-agent market-simulation research
(Generative Agents 2023, EconAgent ACL 2024, MarketFish 2026 MIT)."""
import os, time, threading, collections
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sim_core import Gemini, gen_personas, simulate

app = FastAPI(title="GTM World Model - Agent Simulation", version="1.0")
app.add_middleware(CORSMiddleware, allow_origins=[
    "https://gtm-world-model.pages.dev", "http://localhost:8000", "http://127.0.0.1:8000"],
    allow_methods=["*"], allow_headers=["*"])

_lock = threading.Lock()
_hits = collections.defaultdict(list)
RATE = 8  # simulations per IP per hour

def allowed(ip):
    now = time.time()
    with _lock:
        _hits[ip] = [t for t in _hits[ip] if now - t < 3600]
        if len(_hits[ip]) >= RATE: return False
        _hits[ip].append(now)
        return True

class SimRequest(BaseModel):
    productName: str
    description: str = ""
    productType: str = ""
    segment: str                       # human-readable target segment
    price: float = Field(gt=0)
    monthlyImpressions: int = 0        # from the channel model, drives awareness
    agents: int = Field(default=48, ge=16, le=96)
    rounds: int = Field(default=6, ge=2, le=8)

@app.get("/health")
def health():
    return {"ok": True, "engine": "llm-agent-market-sim", "model": "gemini-2.5-flash"}

@app.post("/simulate")
def run(req: SimRequest, request: Request):
    ip = request.client.host if request.client else "anon"
    if not allowed(ip):
        return JSONResponse({"error": "rate limited - a few simulations per hour on the free tier"}, 429)
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        return JSONResponse({"error": "server not configured"}, 500)
    llm = Gemini(key)
    panel = req.agents
    try:
        personas = gen_personas(llm, req.segment + (f" for a {req.productType}" if req.productType else ""), panel)
        panel = len(personas)
        # awareness seeding from marketing reach: fraction of panel newly exposed per round
        seed_reach = max(0.02, min(0.40, (req.monthlyImpressions / max(panel, 1)) * 0.02)) if req.monthlyImpressions else 0.06
        awareness0 = min(0.15, seed_reach)
        res = simulate(llm,
            {"name": req.productName, "description": req.description, "category": req.productType},
            personas, rounds=req.rounds, awareness0=awareness0, monthly_price=req.price, seed_reach=seed_reach)
        customers = res["customers_final"]
        sim_cac = round(req.monthlyImpressions * 0.0005, 2)  # not used; CAC computed client-side from spend
        res["engine"] = {
            "type": "llm-agent-simulation",
            "model": "gemini-2.5-flash",
            "agents": panel,
            "rounds": req.rounds,
            "method": "generative agents with persona, budget, memory, peer influence (Generative Agents 2023 / EconAgent 2024 / MarketFish 2026)",
            "calibration": "base-rate priors from cited conversion benchmarks; LLM panels skew optimistic - treat as directional"
        }
        return res
    except Exception as e:
        return JSONResponse({"error": f"simulation failed: {type(e).__name__}"}, 502)
