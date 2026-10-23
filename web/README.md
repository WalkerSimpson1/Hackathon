# VentureLens web app

The public front end for VentureLens: the $100,000 portfolio, why each startup scores the way it does, its listed comparable and its news sentiment, plus the full ranking.

Live site: https://walkersimpson1.github.io/Hackathon/

## How it connects to the pipeline

The page reads one file, `web/data/site.json`. `web/build_data.py` builds it from the pipeline outputs (paths come from `paths.py`):

| Pipeline output | Used for |
|---|---|
| `venturelens_portfolio_output_sentiment.csv` | positions, weights, score breakdown, sentiment |
| `venturelens_scored_companies.csv` | the ranking of every scored startup |
| `venturelens_matches.csv` | the three LLM-matched comparables |
| `venturelens_comparable_data.json` | Finnhub metrics and revenue history |

After re-running the pipeline, rebuild the data (standard library only, no keys):

```
py web/build_data.py
```

## Run locally

```
py -m http.server 8000 --directory web
```

Then open http://localhost:8000.

## Deploy

`.github/workflows/pages.yml` publishes `web/` to GitHub Pages on every push to `main` that changes `outputs/` or `web/`, rebuilding `site.json` first. It needs a one-time switch by a repo admin: **Settings → Pages → Source: GitHub Actions**.

## Files

- `index.html`, `styles.css`, `app.js`: the page (no framework, no build step)
- `build_data.py`: turns `outputs/` into `data/site.json`
- `data/site.json`: generated; committed so the site also runs without Python
