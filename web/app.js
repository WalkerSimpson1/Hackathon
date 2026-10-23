// VentureLens web app. Reads data/site.json (built by web/build_data.py) and renders it.
// No framework and no build step: everything below is plain DOM rendering.
//
// The client panel re-runs the allocation from pipeline/score_startups.py in the browser,
// so a mandate (capital, cash, limits, sectors, stages) can be changed live. With the
// default mandate the result is the pipeline's own portfolio, to the dollar.

const $ = (sel) => document.querySelector(sel);
const RANKING_PREVIEW = 20;
const SECTOR_ORDER = ['AI & Data', 'Enterprise SaaS', 'FinTech', 'Health & Education',
  'Hardware', 'Commerce', 'Consumer & Social', 'Other'];
const STAGE_ORDER = ['Seed', 'Series A', 'Series B', 'Series C+', 'Pre-IPO'];
const FACTORS = {
  valuation: 'Valuation',
  survival: 'Survival',
  backing: 'Backing',
  tech: 'Sector',
  stage: 'Stage',
};
const FACTOR_NOTES = {
  valuation: 'upside to peer-implied fair value ($ raised per backer)',
  survival: 'years operating since the YC batch',
  backing: 'tier-1 investors and founding-team size',
  tech: 'growth profile of the sector',
  stage: 'earlier stage scores higher',
};

let data;
let sectors = [];
let stages = [];
let mandate;
let result;
let showAllRanking = false;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const usd = (v) => '$' + Math.round(v).toLocaleString('en-US');
const pct = (v, d = 1) => (v == null ? '—' : `${(v * 100).toFixed(d)}%`);
const rawPct = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`);
const signCls = (v) => (v == null ? '' : v >= 0 ? 'pos-val' : 'neg-val');
const score = (v) => (v == null ? '—' : (v * 100).toFixed(0));

function money(m) {
  // Millions of USD -> "$12.3B" / "$450M".
  if (m == null) return '—';
  return m >= 1000 ? `$${(m / 1000).toFixed(1)}B` : `$${m.toFixed(m < 10 ? 1 : 0)}M`;
}

function sentimentTag(s) {
  if (!s) return '<span class="muted small">—</span>';
  const cls = /bear|negative/i.test(s.label) ? 'bad' : /bull|positive/i.test(s.label) ? '' : 'neutral';
  return `<span class="tag ${cls}">${esc(s.label)}</span>`;
}

// ---------------------------------------------------------------------------
// Mandate and allocation (mirrors allocate() and cap_and_floor() in score_startups.py)
// ---------------------------------------------------------------------------

function defaultMandate() {
  const m = data.model;
  return {
    capital: m.capital,
    cash: m.cashWeight,
    positions: m.positions,
    maxPosition: m.maxPosition,
    sectors: new Set(sectors),
    stages: new Set(stages),
  };
}

function isDefault(m) {
  const d = defaultMandate();
  return m.cash === d.cash && m.positions === d.positions && m.maxPosition === d.maxPosition
    && m.sectors.size === d.sectors.size && m.stages.size === d.stages.size;
}

function capAndFloor(weights, total, lo, hi) {
  const sum = weights.reduce((a, b) => a + b, 0);
  let w = weights.map((x) => (x / sum) * total);
  for (let i = 0; i < w.length; i++) {
    w = w.map((x) => Math.min(hi, Math.max(lo, x)));
    const free = w.map((x) => x > lo + 1e-12 && x < hi - 1e-12);
    const gap = total - w.reduce((a, b) => a + b, 0);
    const freeSum = w.reduce((a, x, j) => a + (free[j] ? x : 0), 0);
    if (Math.abs(gap) < 1e-12 || freeSum === 0) break;
    w = w.map((x, j) => (free[j] ? x + (gap * x) / freeSum : x));
  }
  return w;
}

function allocate(m) {
  const eligible = data.companies.filter((c) => c.status === 'Operating'
    && m.sectors.has(c.domain || 'Other') && m.stages.has(c.stage));
  const picks = eligible.slice(0, m.positions); // companies are pre-sorted by score
  const capital = Math.round(m.capital);
  if (!picks.length) return { picks: [], cashUsd: capital, eligible: 0, extraCash: 0 };

  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const logF = picks.map((c) => Math.log1p(c.raisedM * 1000));
  const logS = picks.map((c) => Math.log1p(c.investors));
  const mf = mean(logF);
  const ms = mean(logS);
  const scores = picks.map((c, i) => Math.max(c.score, 0.01) * Math.sqrt((logF[i] / mf) * (logS[i] / ms)));

  const total = 1 - m.cash;
  const lo = Math.min(data.model.minPosition, total / picks.length); // keep the floor feasible
  const w = capAndFloor(scores, total, lo, m.maxPosition);
  const investedWeight = w.reduce((a, b) => a + b, 0);

  // Whole dollars; any rounding remainder goes to the top-ranked position.
  const dollars = w.map((x) => Math.round(x * capital));
  const invest = Math.round(investedWeight * capital);
  dollars[0] += invest - dollars.reduce((a, b) => a + b, 0);

  return {
    picks: picks.map((c, i) => ({ c, weight: w[i], usd: dollars[i] }))
      .sort((a, b) => b.weight - a.weight),
    cashUsd: capital - invest,
    cashWeight: 1 - investedWeight,
    extraCash: Math.max(0, total - investedWeight),
    eligible: eligible.length,
  };
}

// URL keeps only what differs from the default, so a mandate can be shared as a link.
function readUrl(m) {
  const q = new URLSearchParams(location.search);
  const n = (k) => (q.has(k) && Number.isFinite(+q.get(k)) ? +q.get(k) : null);
  if (n('capital') >= 1000) m.capital = Math.min(n('capital'), 1e10);
  if (n('cash') != null) m.cash = Math.min(0.5, Math.max(0, n('cash') / 100));
  if (n('positions') != null) m.positions = Math.min(20, Math.max(1, Math.round(n('positions'))));
  if (n('max') != null) m.maxPosition = Math.min(1, Math.max(0.05, n('max') / 100));
  const set = (k, all) => {
    const picked = (q.get(k) || '').split(',').filter((x) => all.includes(x));
    return picked.length ? new Set(picked) : null;
  };
  m.sectors = set('sectors', sectors) || m.sectors;
  m.stages = set('stages', stages) || m.stages;
}

function writeUrl() {
  const d = defaultMandate();
  const q = new URLSearchParams();
  if (mandate.capital !== d.capital) q.set('capital', Math.round(mandate.capital));
  if (mandate.cash !== d.cash) q.set('cash', Math.round(mandate.cash * 100));
  if (mandate.positions !== d.positions) q.set('positions', mandate.positions);
  if (mandate.maxPosition !== d.maxPosition) q.set('max', Math.round(mandate.maxPosition * 100));
  if (mandate.sectors.size !== sectors.length) q.set('sectors', [...mandate.sectors].join(','));
  if (mandate.stages.size !== stages.length) q.set('stages', [...mandate.stages].join(','));
  const s = q.toString().replace(/%2C/g, ',');
  history.replaceState(null, '', s ? `?${s}${location.hash}` : location.pathname + location.hash);
}

// ---------------------------------------------------------------------------
// Client panel
// ---------------------------------------------------------------------------

function chip(group, value, on) {
  return `<button type="button" class="chip" data-group="${group}" data-value="${esc(value)}" aria-pressed="${on}">${esc(value)}</button>`;
}

function renderClient() {
  $('#capital').value = Math.round(mandate.capital).toLocaleString('en-US');
  $('#cash').value = Math.round(mandate.cash * 100);
  $('#positions-n').value = mandate.positions;
  $('#max').value = Math.round(mandate.maxPosition * 100);
  $('#cash-out').textContent = pct(mandate.cash, 0);
  $('#positions-out').textContent = mandate.positions;
  $('#max-out').textContent = pct(mandate.maxPosition, 0);
  $('#sectors').innerHTML = sectors.map((s) => chip('sectors', s, mandate.sectors.has(s))).join('');
  $('#stages').innerHTML = stages.map((s) => chip('stages', s, mandate.stages.has(s))).join('');
}

function update() {
  result = allocate(mandate);
  renderClient();
  renderPortfolio();
  renderRanking();
  writeUrl();
}

function bindClient() {
  const capital = $('#capital');
  capital.addEventListener('input', () => {
    const v = Number(capital.value.replace(/[^\d.]/g, ''));
    if (Number.isFinite(v) && v >= 1000) {
      mandate.capital = Math.min(v, 1e10);
      result = allocate(mandate);
      renderPortfolio();
      writeUrl();
    }
  });
  capital.addEventListener('change', () => { capital.value = Math.round(mandate.capital).toLocaleString('en-US'); });
  $('#cash').addEventListener('input', (e) => { mandate.cash = +e.target.value / 100; update(); });
  $('#positions-n').addEventListener('input', (e) => { mandate.positions = +e.target.value; update(); });
  $('#max').addEventListener('input', (e) => { mandate.maxPosition = +e.target.value / 100; update(); });
  $('#client').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    const set = mandate[b.dataset.group];
    const v = b.dataset.value;
    if (set.has(v) && set.size === 1) return; // keep at least one selected
    if (set.has(v)) set.delete(v); else set.add(v);
    update();
  });
  $('#reset').addEventListener('click', () => { mandate = defaultMandate(); update(); });
}

// ---------------------------------------------------------------------------
// Portfolio
// ---------------------------------------------------------------------------

function scoreBars(p) {
  return Object.entries(FACTORS).map(([k, label]) => {
    const v = p.parts[k] ?? 0;
    return `<div class="bar-row" title="${esc(FACTOR_NOTES[k])}">
      <span>${label} <span class="w">${pct(data.scoreWeights[k], 0)}</span></span>
      <div class="track"><div class="fill" style="width:${v * 100}%"></div></div>
      <span class="num">${score(v)}</span>
    </div>`;
  }).join('');
}

function revenueBars(rev) {
  if (!rev?.length) return '';
  const max = Math.max(...rev.map((r) => r.revenue));
  const last = rev[rev.length - 1];
  return `<div class="rev" aria-label="Annual revenue">${rev.map((r) => `
      <div title="${r.year}: ${money(r.revenue / 1e6)}">
        <i style="height:${Math.max(2, Math.round((r.revenue / max) * 48))}px"></i><span>’${String(r.year).slice(2)}</span>
      </div>`).join('')}
    </div>
    <p class="muted small">Revenue, ${last.year}: ${money(last.revenue / 1e6)}</p>`;
}

const NOT_ANALYSED = '<p class="muted small">Not analysed yet. The pipeline only runs this step for its own portfolio; re-run it with this company to add it.</p>';

function comparableBlock(c) {
  if (!c) return NOT_ANALYSED;
  if (!c.chosen) return '<p class="muted small">No listed comparable was found.</p>';
  const x = c.chosen;
  const match = c.candidates.find((m) => m.ticker === x.ticker) || c.candidates[0];
  return `
    <p><b>${esc(x.name)}</b> <span class="muted">${esc(x.ticker)}${x.industry ? ` · ${esc(x.industry)}` : ''}</span></p>
    <div class="kv">
      <div>Market cap<b>${money(x.marketCapM)}</b></div>
      <div>Revenue growth<b class="${signCls(x.revenueGrowth)}">${rawPct(x.revenueGrowth)}</b></div>
      <div>Gross margin<b>${x.grossMargin == null ? '—' : x.grossMargin.toFixed(1) + '%'}</b></div>
      <div>52-week return<b class="${signCls(x.return52w)}">${rawPct(x.return52w)}</b></div>
    </div>
    ${revenueBars(x.revenue)}
    ${match?.rationale ? `<p class="small" style="margin-top:10px">${esc(match.rationale)}</p>` : ''}
    <ul class="cands">${c.candidates.map((m) => `
      <li class="${m.ticker === x.ticker ? 'chosen' : ''}">
        <span>${esc(m.ticker)} · ${esc(m.name)}</span><span class="muted num">${pct(m.confidence, 0)} match</span>
      </li>`).join('')}
    </ul>`;
}

function sentimentBlock(s) {
  if (!s) return NOT_ANALYSED;
  const dl = (pairs) => {
    const rows = pairs.filter(([, v]) => v);
    return rows.length ? `<dl class="notes">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : '';
  };
  const more = dl([['Catalysts', s.catalysts], ['Founders', s.founderSummary]]);
  return `
    <p>${sentimentTag(s)} <span class="muted small num">score ${s.overall?.toFixed(2) ?? '—'} · ${s.coverage ?? 0} sources</span></p>
    ${s.headline ? `<p class="small" style="margin-top:8px">“${esc(s.headline)}”</p>` : ''}
    ${dl([['Summary', s.companySummary], ['Risks', s.risks]])}
    ${more ? `<details class="more"><summary>Catalysts and founders</summary>${more}</details>` : ''}`;
}

function positionRow({ c: p, weight, usd: dollars }, i) {
  const cmp = p.comparable?.chosen;
  const facts = [
    p.ycYear && `<span>YC <b>${p.ycSession ? p.ycSession[0] : ''}${String(p.ycYear).slice(2)}</b></span>`,
    p.city && `<span>${esc(p.city)}</span>`,
    p.raisedM != null && `<span>Raised <b>${money(p.raisedM)}</b></span>`,
    p.investors != null && `<span><b>${p.investors}</b> backers${p.tier1 ? ` (${p.tier1} tier-1)` : ''}</span>`,
    p.upside != null && `<span>Upside to fair value <b>${pct(p.upside, 0)}</b></span>`,
    p.website && `<a href="${esc(p.website)}" target="_blank" rel="noopener">Website</a>`,
  ].filter(Boolean).join('');
  return `<details class="pos" data-name="${esc(p.name)}">
    <summary>
      <div><div class="name">${i + 1}. ${esc(p.name)}</div>
        <div class="sub">${esc(p.domain)} · ${esc(p.stage)}${cmp ? ` · comparable ${esc(cmp.ticker)}` : ''}</div></div>
      <div class="right num hide-sm">${score(p.score)}</div>
      <div class="right hide-sm">${sentimentTag(p.sentiment)}</div>
      <div class="right num hide-sm">${pct(weight)}</div>
      <div class="right num"><b>${usd(dollars)}</b></div>
      <span class="chev" aria-hidden="true">▶</span>
    </summary>
    <div class="detail">
      <div>
        ${p.description ? `<p>${esc(p.description)}</p>` : ''}
        <div class="facts" style="margin-top:8px">${facts}</div>
      </div>
      <div class="detail-grid">
        <div><h3>Why it scores ${score(p.score)}</h3><div class="bars">${scoreBars(p)}</div></div>
        <div><h3>Public comparable</h3>${comparableBlock(p.comparable)}</div>
        <div><h3>Sentiment</h3>${sentimentBlock(p.sentiment)}</div>
      </div>
    </div>
  </details>`;
}

function renderPortfolio() {
  const r = result;
  const open = new Set([...document.querySelectorAll('.pos[open]')].map((d) => d.dataset.name));
  const capital = Math.round(mandate.capital);

  const segs = r.picks.map((p, i) => (
    `<span style="flex:${p.weight};--o:${Math.max(0.35, 1 - i * 0.06)}" title="${esc(p.c.name)}: ${pct(p.weight)}"></span>`
  ));
  if (r.cashUsd > 0) segs.push(`<span class="cash" style="flex:${r.cashUsd / capital}" title="Cash: ${pct(r.cashUsd / capital)}"></span>`);
  $('#alloc').innerHTML = segs.join('');

  const matches = r.picks.length && r.picks.every((p) => data.pipeline.dollars[p.c.name] != null)
    && r.picks.length === Object.keys(data.pipeline.dollars).length - 1;
  $('#portfolio-sub').textContent = `${r.picks.length} startups · ${pct(r.cashUsd / capital, 0)} cash · ${usd(capital)}`;
  $('#mandate-status').innerHTML = isDefault(mandate)
    ? 'Default mandate: this is the portfolio the pipeline produced.'
    : `Custom mandate: ${r.eligible} eligible startups${matches ? ', same picks as the pipeline' : ''}. Share it by copying the page link.`;

  const notes = [];
  if (r.picks.length < mandate.positions) notes.push(`Only ${r.picks.length} operating startups match these sectors and stages.`);
  if (r.extraCash > 1e-9) notes.push(`The ${pct(mandate.maxPosition, 0)} position cap leaves ${pct(r.extraCash)} extra in cash. Add positions or raise the cap to invest it.`);

  $('#positions').innerHTML = !r.picks.length
    ? '<p class="muted" style="padding:18px">No operating startups match this mandate. Select more sectors or stages.</p>'
    : `${notes.length ? `<p class="note">${notes.join(' ')}</p>` : ''}
    <div class="cols-head" aria-hidden="true">
      <span>Startup</span><span class="right">Score</span><span class="right">Sentiment</span>
      <span class="right">Weight</span><span class="right">Amount</span><span></span>
    </div>
    ${r.picks.map(positionRow).join('')}
    <div class="pos cash"><div class="cash-row">
      <div><div class="name">Cash reserve</div><div class="sub">Held back for follow-ons and drawdowns</div></div>
      <div class="hide-sm"></div><div class="hide-sm"></div>
      <div class="right num hide-sm">${pct(r.cashUsd / capital)}</div>
      <div class="right num"><b>${usd(r.cashUsd)}</b></div><span></span>
    </div></div>`;
  for (const name of open) document.querySelector(`.pos[data-name="${CSS.escape(name)}"]`)?.setAttribute('open', '');
}

// ---------------------------------------------------------------------------
// Ranking and method
// ---------------------------------------------------------------------------

function renderRanking() {
  const q = $('#search').value.trim().toLowerCase();
  const picked = new Set(result.picks.map((p) => p.c.name));
  const inMandate = (c) => c.status === 'Operating' && mandate.sectors.has(c.domain || 'Other') && mandate.stages.has(c.stage);
  const rows = data.companies
    .map((c, i) => ({ c, rank: i + 1 }))
    .filter(({ c }) => !q || `${c.name} ${c.domain} ${c.stage} ${c.status}`.toLowerCase().includes(q));
  const shown = q || showAllRanking ? rows : rows.slice(0, RANKING_PREVIEW);
  $('#ranking-list').innerHTML = shown.map(({ c, rank }) => `
    <li class="${picked.has(c.name) ? 'picked' : ''} ${inMandate(c) ? '' : 'out'}">
      <span class="rk">${rank}</span>
      <span class="nm">${esc(c.name)}${c.status !== 'Operating' ? ` <span class="off small">${esc(c.status)}</span>` : ''}</span>
      <span class="muted small hide-sm">${esc(c.domain)}</span>
      <span class="muted small hide-sm">${esc(c.stage)}</span>
      <span class="sc"><div class="track"><div class="fill" style="width:${(c.score ?? 0) * 100}%"></div></div><span>${score(c.score)}</span></span>
    </li>`).join('') || '<li class="muted">No matches.</li>';
  const more = $('#more');
  more.hidden = !!q || rows.length <= RANKING_PREVIEW;
  more.textContent = showAllRanking ? 'Show top 20' : `Show all ${rows.length}`;
}

function renderStatic() {
  const operating = data.companies.filter((c) => c.status === 'Operating').length;
  $('#ranking-sub').textContent = `${data.companies.length} startups scored · ${operating} still operating and eligible`;
  $('#weights').innerHTML = Object.entries(FACTORS).map(([k, label]) => (
    `<li><b>${pct(data.scoreWeights[k], 0)}</b><div>${label} <span>· ${FACTOR_NOTES[k]}</span></div></li>`
  )).join('');
  const m = data.model;
  $('#alloc-rules').innerHTML = `
    <li>Only operating companies are eligible; the ${m.positions} highest scores are picked.</li>
    <li>${pct(m.cashWeight, 0)} of capital is held in cash.</li>
    <li>Weights tilt toward better-funded, more widely backed companies (log-scaled), then are capped between ${pct(m.minPosition, 0)} and ${pct(m.maxPosition, 0)}.</li>
    <li>These are the defaults; the client panel changes them, and the same maths re-runs in your browser.</li>
    <li>Code does the maths; the LLM only explains and matches comparables.</li>`;
  $('#asof').textContent = `Market data as of ${data.marketDataAsOf ?? 'n/a'}; page data built ${data.generatedAt.slice(0, 10)}`;
}

async function main() {
  try {
    const res = await fetch('data/site.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.statusText);
    data = await res.json();
  } catch {
    $('#positions').innerHTML =
      '<p class="muted" style="padding:18px">Could not load data/site.json. Run <code>py web/build_data.py</code> and reload.</p>';
    return;
  }
  const present = (order, key) => {
    const vals = new Set(data.companies.filter((c) => c.status === 'Operating').map((c) => c[key] || 'Other'));
    return [...order.filter((v) => vals.has(v)), ...[...vals].filter((v) => !order.includes(v)).sort()];
  };
  sectors = present(SECTOR_ORDER, 'domain');
  stages = present(STAGE_ORDER, 'stage');
  mandate = defaultMandate();
  readUrl(mandate);

  renderStatic();
  bindClient();
  update();
  $('#search').addEventListener('input', renderRanking);
  $('#more').addEventListener('click', () => { showAllRanking = !showAllRanking; renderRanking(); });
}

main();
