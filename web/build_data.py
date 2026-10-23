"""Build web/data/site.json, the one file the VentureLens web app reads.

Run from anywhere after the pipeline (no API keys, standard library only):
    py web/build_data.py

Reads the pipeline outputs listed in paths.py and keeps only the fields the site shows:

    venturelens_portfolio_output_sentiment.csv  ->  portfolio, weights, scores, sentiment
    venturelens_scored_companies.csv            ->  every scored startup (the ranking)
    venturelens_matches.csv                     ->  the 3 LLM-matched public comparables
    venturelens_comparable_data.json            ->  Finnhub metrics and revenue history

The full comparable JSON is ~2 MB; site.json is a small fraction of that, so the page
loads fast. Re-run this script whenever outputs/ changes; the GitHub Pages workflow
also runs it on every push to main.
"""
from __future__ import annotations

import csv
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # repo root, for paths.py
import paths  # noqa: E402

OUT_JSON = Path(__file__).resolve().parent / "data" / "site.json"

# Mirrors the constants in pipeline/score_startups.py so the page explains the real model.
SCORE_WEIGHTS = {
    "Valuation_Score": 0.35,
    "Survival_Score": 0.25,
    "Backing_Score": 0.20,
    "Tech_Score": 0.10,
    "Stage_Score": 0.10,
}


def read_csv(path: Path) -> list[dict]:
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def num(v, digits: int = 4):
    """'0.123456' -> 0.1235; blank, NaN or non-numeric -> None."""
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(x) or math.isinf(x) else round(x, digits)


def text(v) -> str | None:
    v = (v or "").strip()
    return v or None


def year(v):
    x = num(v, 0)
    return int(x) if x is not None else None


def startup_fields(r: dict) -> dict:
    return {
        "name": r["Company_ID"],
        "description": text(r.get("Description")),
        "domain": text(r.get("Domain")),
        "stage": text(r.get("Funding_Stage")),
        "status": text(r.get("Status")),
        "city": text(r.get("Headquarters (City)")),
        "country": text(r.get("Headquarters (Country)")),
        "founded": year(r.get("Year Founded")),
        "ycYear": year(r.get("Y Combinator Year")),
        "ycSession": text(r.get("Y Combinator Session")),
        "founders": text(r.get("Founders")),
        "website": text(r.get("Website")),
        "raisedM": num(r.get("Total_Raised_USD_Millions")),
        "investors": year(r.get("Investor_Count")),
        "tier1": year(r.get("Tier1_Investor_Count")),
        "fairValueM": num(r.get("Fair_Value_USD_Millions")),
        "upside": num(r.get("Upside_to_Fair_Value")),
        "score": num(r.get("Risk_Adjusted_Score")),
        "parts": {k.replace("_Score", "").lower(): num(r.get(k)) for k in SCORE_WEIGHTS},
    }


def sentiment_fields(r: dict) -> dict | None:
    if not text(r.get("sentiment_label")):
        return None
    return {
        "label": text(r.get("sentiment_label")),
        "overall": num(r.get("overall_sentiment_score"), 2),
        "company": num(r.get("company_sentiment_score"), 2),
        "founder": num(r.get("founder_sentiment_score"), 2),
        "founderLabel": text(r.get("founder_reputation_label")),
        "companySummary": text(r.get("company_summary_reasoning")),
        "founderSummary": text(r.get("founder_summary_reasoning")),
        "risks": text(r.get("key_company_risks")),
        "founderRisks": text(r.get("key_founder_risks")),
        "catalysts": text(r.get("growth_catalysts")),
        "headline": text(r.get("top_company_headline")),
        "coverage": year(r.get("total_coverage_count")),
        "engine": text(r.get("analysis_engine")),
    }


def comparable_fields(rec: dict | None, matches: list[dict]) -> dict:
    """The chosen Finnhub comparable plus all three LLM candidates."""
    candidates = [{
        "rank": year(m["rank"]),
        "ticker": m["ticker"],
        "name": m["company_name"],
        "exchange": text(m.get("exchange")),
        "confidence": num(m.get("confidence"), 2),
        "rationale": text(m.get("similarity_rationale")),
        "similarities": text(m.get("key_similarities")),
        "differences": text(m.get("key_differences")),
    } for m in sorted(matches, key=lambda m: int(m["rank"]))]

    if not rec or rec.get("status") != "ok":
        return {"chosen": None, "candidates": candidates}

    met = rec.get("metrics") or {}
    prof = rec.get("profile") or {}
    revenue = [
        {"year": f["year"], "revenue": f["revenue"], "netIncome": f.get("net_income")}
        for f in sorted(rec.get("financials_annual") or [], key=lambda f: f["year"])
        if f.get("revenue")
    ][-6:]
    return {
        "chosen": {
            "ticker": rec["ticker"],
            "rank": rec.get("chosen_rank"),
            "name": rec.get("display_name") or prof.get("name"),
            "industry": prof.get("finnhubIndustry"),
            "country": prof.get("country"),
            "url": prof.get("weburl"),
            "marketCapM": num(met.get("marketCapitalization") or prof.get("marketCapitalization"), 1),
            "revenueGrowth": num(met.get("revenueGrowthTTMYoy"), 2),
            "grossMargin": num(met.get("grossMarginTTM"), 2),
            "netMargin": num(met.get("netProfitMarginTTM"), 2),
            "ps": num(met.get("psTTM"), 2),
            "beta": num(met.get("beta"), 2),
            "return52w": num(met.get("52WeekPriceReturnDaily"), 2),
            "revenue": revenue,
        },
        "candidates": candidates,
    }


def main() -> None:
    portfolio = read_csv(paths.PORTFOLIO_SENTIMENT_CSV)
    scored = read_csv(paths.SCORED_CSV)
    matches = read_csv(paths.MATCHES_CSV)
    with open(paths.COMPARABLE_DATA_JSON, encoding="utf-8") as f:
        comparables = {r["Company_ID"]: r for r in json.load(f)}

    picks, cash = [], None
    for r in portfolio:
        if r["Company_ID"] == "CASH":
            cash = {"weight": num(r["Weight"]), "usd": year(r["Allocation_USD"])}
            continue
        picks.append({
            **startup_fields(r),
            "weight": num(r["Weight"], 12),  # full precision so rescaled dollars match the pipeline
            "usd": year(r["Allocation_USD"]),
            "sentiment": sentiment_fields(r),
            "comparable": comparable_fields(
                comparables.get(r["Company_ID"]),
                [m for m in matches if m["Company_ID"] == r["Company_ID"]],
            ),
        })

    in_portfolio = {p["name"] for p in picks}
    ranking = sorted(
        ({
            "name": r["Company_ID"],
            "domain": text(r.get("Domain")),
            "stage": text(r.get("Funding_Stage")),
            "status": text(r.get("Status")),
            "ycYear": year(r.get("Y Combinator Year")),
            "score": num(r.get("Risk_Adjusted_Score")),
            "picked": r["Company_ID"] in in_portfolio,
        } for r in scored),
        key=lambda r: -(r["score"] or 0),
    )

    capital = sum(p["usd"] for p in picks) + (cash["usd"] if cash else 0)
    fetched = [c.get("fetched_at") for c in comparables.values() if c.get("fetched_at")]
    site = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "marketDataAsOf": max(fetched)[:10] if fetched else None,
        "capital": capital,
        "cash": cash,
        "scoreWeights": {k.replace("_Score", "").lower(): v for k, v in SCORE_WEIGHTS.items()},
        "portfolio": sorted(picks, key=lambda p: -p["weight"]),
        "ranking": ranking,
        "counts": {
            "scored": len(scored),
            "operating": sum(r["status"] == "Operating" for r in ranking),
        },
    }
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(site, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {OUT_JSON.relative_to(paths.ROOT)} "
          f"({OUT_JSON.stat().st_size / 1024:.0f} KB, {len(picks)} positions, {len(ranking)} ranked)")


if __name__ == "__main__":
    main()
