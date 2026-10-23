# VentureLens web app

The public front end for VentureLens. A client sets their mandate (capital, cash reserve, number of positions, position cap, sectors, stages) and the page picks and sizes the startups that fit, showing why each one scores the way it does, its listed comparable and its news sentiment. There is also the full ranking and a methodology page.

Live site: https://walkersimpson1.github.io/Hackathon/

## How it connects to the pipeline

The page reads one file, `web/data/site.json`. `web/build_data.py` builds it from the pipeline outputs (paths come from `paths.py`):

| Pipeline output | Used for |
|---|---|
| `venturelens_portfolio_output_sentiment.csv` | positions, weights, score breakdown, sentiment |
| `venturelens_scored_companies.csv` | the ranking of every scored startup |
| `venturelens_matches.csv` | the three LLM-matched comparables |
| `venturelens_comparable_data.json` | Finnhub metrics and revenue history |
| `pipeline/score_startups.py` | allocation limits (cash, min/max position, capital) |

The page re-runs `allocate()` from `score_startups.py` in the browser, so the client filters work live. With the default mandate it reproduces the pipeline's portfolio to the dollar. Comparables and sentiment exist only for the pipeline's own picks; other picks show "not analysed yet".

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

- `index.html`, `styles.css`, `app.js`: the main page (no framework, no build step)
- `methodology.html`: how the scores, allocation, comparables and sentiment work
- `build_data.py`: turns `outputs/` into `data/site.json`
- `data/site.json`: generated; committed so the site also runs without Python
