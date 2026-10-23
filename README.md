# VentureLens

VentureLens is an AI investment analyst for a growth investor with $100,000. It scores
Y Combinator startups with a transparent, rule-based model and builds a 10-company
portfolio (plus a cash reserve). Startups can't be bought directly, so an LLM matches each
pick to publicly listed comparables. Finnhub supplies those companies' real financials,
and a news and community sentiment check covers each startup and its founders. Every
number is traceable to a CSV in `outputs/`. This is an educational screening tool, not
financial advice.

## Pipeline

```
data/raw/Startups.csv + data/raw/Founders.csv
        │
        ▼
1. pipeline/score_startups.py ──► outputs/venturelens_portfolio_output.csv
        │                         outputs/venturelens_scored_companies.csv
        │                         outputs/selected_companies.csv
        ├──────────────────────────────────────────────┐
        ▼                                              ▼
2. pipeline/match_comparables.py (LLM)          4. pipeline/analyze_sentiment.py (news + LLM)
        │  ──► outputs/venturelens_matches.csv          ──► outputs/venturelens_portfolio_output_sentiment.csv
        ▼
3. pipeline/fetch_finnhub.py (Finnhub API)
        │  ──► outputs/venturelens_comparable_data.json
        │      outputs/venturelens_comparables_summary.csv
        ▼
charts.py (Plotly charts) ──► dashboard
```

Step 4 only needs step 1, so it can run in parallel with steps 2 and 3.

## Folder structure

```
README.md            this file
requirements.txt     Python dependencies
.env.example         API variable names; copy to .env (git-ignored)
paths.py             every file and folder path, defined in one place
charts.py            Plotly chart functions for the dashboard
charts_preview.py    Streamlit page that previews every chart
pipeline/            the four pipeline steps above
data/raw/            source datasets the pipeline uses (Startups.csv, Founders.csv)
data/archive/        old Kaggle data, no longer used; kept for reference
outputs/             every generated file (test_runs/ holds small trial runs)
docs/                hackathon plan and Finnhub API notes
tests/fixtures/      sample inputs for quick runs
web/                 the public web app, built from outputs/ (see web/README.md)
cache/               API response caches (git-ignored; created on first run)
```

All paths live in `paths.py`, so scripts work from any folder. To use a file in new code:
`import paths` and then, for example, `pd.read_csv(paths.PORTFOLIO_CSV)`.

## Setup

Requires Python 3.10+.

```
pip install -r requirements.txt
cp .env.example .env        # Windows: copy .env.example .env
```

Then fill in your keys in `.env`. Scoring needs no keys. Matching needs the `LLM_*`
variables, Finnhub needs `FINNHUB_KEY`, and the sentiment script reads its own names
(listed at the bottom of `.env.example`).

## Run each step

Run from the repo root. On macOS/Linux use `python` instead of `py`.

```
py pipeline/score_startups.py                 # 1. score and build the portfolio (no API)
py pipeline/match_comparables.py              # 2. LLM matching (cached in cache/llm_matching/)
py pipeline/fetch_finnhub.py                  # 3. Finnhub data (cached in cache/finnhub/)
py pipeline/analyze_sentiment.py              # 4. sentiment (calls news sites and the LLM)
```

Useful options (see `--help` on each script):

| Script | Options |
|---|---|
| `score_startups.py` | optional `Startups.csv Founders.csv` positional paths |
| `match_comparables.py` | `--input`, `--output`, `--model`, `--limit N`, `--refresh`, `--company NAME` (only call the LLM for that startup; others come from the cache) |
| `fetch_finnhub.py` | `--input`, `--limit N`, `--offline` (cache only), `--refresh`, `--portfolio`, `--output-json`, `--output-csv` |
| `analyze_sentiment.py` | `--input`, `--output`, `--founders-file`, `--limit N`, `--model`, `--max-news`, `--max-social`, `--delay` |

Quick trial without the full portfolio:
`py pipeline/fetch_finnhub.py --input tests/fixtures/sample_matches.csv --limit 2`

Once the caches are filled, steps 2 and 3 re-run without calling any API (use
`--offline` for Finnhub).

## Web app

Live: https://walkersimpson1.github.io/Hackathon/

`web/` is the public site: the portfolio, each pick's score breakdown, listed comparable and
sentiment, and the full ranking. It is rebuilt from `outputs/` and redeployed automatically on
every push to `main` (see `web/README.md`). To refresh it locally after re-running the pipeline:

```
py web/build_data.py
py -m http.server 8000 --directory web
```

## Dashboard

Preview every chart for each startup:

```
streamlit run charts_preview.py
```

## Data sources

- Startups and founders: Y Combinator dataset (`data/raw/`)
- Public comparables: Finnhub API and SEC filings
- Sentiment: Google News RSS, Hacker News, and an LLM
