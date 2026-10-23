// VentureLens web app. Reads data/site.json (built by web/build_data.py) and renders it.
// No framework and no build step: everything below is plain DOM rendering.

const $ = (sel) => document.querySelector(sel);
const RANKING_PREVIEW = 20;
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
let capital = 100000;
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

// Same rounding as pipeline/score_startups.py: whole dollars, any remainder to the top score.
function amounts() {
  const invest = Math.round(capital * (1 - data.cash.weight));
  const out = new Map(data.portfolio.map((p) => [p.name, Math.round(p.weight * capital)]));
  const top = data.portfolio.reduce((a, b) => (b.score > a.score ? b : a));
  const sum = [...out.values()].reduce((a, b) => a + b, 0);
  out.set(top.name, out.get(top.name) + invest - sum);
  out.set('CASH', Math.round(capital * data.cash.weight));
  return out;
}

function renderAllocation(dollars) {
  const segs = data.portfolio.map((p, i) => (
    `<span style="flex:${p.weight};--o:${1 - i * 0.07}" title="${esc(p.name)}: ${pct(p.weight)}"></span>`
  ));
  segs.push(`<span class="cash" style="flex:${data.cash.weight}" title="Cash: ${pct(data.cash.weight, 0)}"></span>`);
  $('#alloc').innerHTML = segs.join('');
  $('#portfolio-sub').textContent =
    `${data.portfolio.length} startups · ${pct(data.cash.weight, 0)} cash · ${usd(capital)}`;
  for (const [name, v] of dollars) {
    const el = document.querySelector(`[data-amount="${CSS.escape(name)}"]`);
    if (el) el.textContent = usd(v);
  }
}

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

function comparableBlock(c) {
  if (!c?.chosen) return '<p class="muted small">No listed comparable was found.</p>';
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
  if (!s) return '<p class="muted small">No sentiment analysis yet.</p>';
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

function positionRow(p, i) {
  const c = p.comparable?.chosen;
  const facts = [
    p.ycYear && `<span>YC <b>${p.ycSession ? p.ycSession[0] : ''}${String(p.ycYear).slice(2)}</b></span>`,
    p.city && `<span>${esc(p.city)}</span>`,
    p.raisedM != null && `<span>Raised <b>${money(p.raisedM)}</b></span>`,
    p.investors != null && `<span><b>${p.investors}</b> backers${p.tier1 ? ` (${p.tier1} tier-1)` : ''}</span>`,
    p.upside != null && `<span>Upside to fair value <b>${pct(p.upside, 0)}</b></span>`,
    p.website && `<a href="${esc(p.website)}" target="_blank" rel="noopener">Website</a>`,
  ].filter(Boolean).join('');
  return `<details class="pos">
    <summary>
      <div><div class="name">${i + 1}. ${esc(p.name)}</div>
        <div class="sub">${esc(p.domain)} · ${esc(p.stage)}${c ? ` · comparable ${esc(c.ticker)}` : ''}</div></div>
      <div class="right num hide-sm">${score(p.score)}</div>
      <div class="right hide-sm">${sentimentTag(p.sentiment)}</div>
      <div class="right num hide-sm">${pct(p.weight)}</div>
      <div class="right num"><b data-amount="${esc(p.name)}"></b></div>
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
  $('#positions').innerHTML = `
    <div class="cols-head" aria-hidden="true">
      <span>Startup</span><span class="right">Score</span><span class="right">Sentiment</span>
      <span class="right">Weight</span><span class="right">Amount</span><span></span>
    </div>
    ${data.portfolio.map(positionRow).join('')}
    <details class="pos cash"><summary>
      <div><div class="name">Cash reserve</div><div class="sub">Held back for follow-ons and drawdowns</div></div>
      <div class="hide-sm"></div><div class="hide-sm"></div>
      <div class="right num hide-sm">${pct(data.cash.weight)}</div>
      <div class="right num"><b data-amount="CASH"></b></div><span></span>
    </summary></details>`;
  document.querySelector('.pos.cash summary').addEventListener('click', (e) => e.preventDefault());
}

function renderRanking() {
  const q = $('#search').value.trim().toLowerCase();
  const rows = data.ranking
    .map((r, i) => ({ ...r, rank: i + 1 }))
    .filter((r) => !q || `${r.name} ${r.domain} ${r.stage} ${r.status}`.toLowerCase().includes(q));
  const shown = q || showAllRanking ? rows : rows.slice(0, RANKING_PREVIEW);
  $('#ranking-list').innerHTML = shown.map((r) => `
    <li class="${r.picked ? 'picked' : ''}">
      <span class="rk">${r.rank}</span>
      <span class="nm">${esc(r.name)}${r.status !== 'Operating' ? ` <span class="off small">${esc(r.status)}</span>` : ''}</span>
      <span class="muted small hide-sm">${esc(r.domain)}</span>
      <span class="muted small hide-sm">${esc(r.stage)}</span>
      <span class="sc"><div class="track"><div class="fill" style="width:${(r.score ?? 0) * 100}%"></div></div><span>${score(r.score)}</span></span>
    </li>`).join('') || '<li class="muted">No matches.</li>';
  const more = $('#more');
  more.hidden = !!q || rows.length <= RANKING_PREVIEW;
  more.textContent = showAllRanking ? 'Show top 20' : `Show all ${rows.length}`;
}

function renderStatic() {
  $('#ranking-sub').textContent =
    `${data.counts.scored} startups scored · ${data.counts.operating} still operating and eligible`;
  $('#weights').innerHTML = Object.entries(FACTORS).map(([k, label]) => (
    `<li><b>${pct(data.scoreWeights[k], 0)}</b><div>${label} <span>· ${FACTOR_NOTES[k]}</span></div></li>`
  )).join('');
  $('#asof').textContent = `Market data as of ${data.marketDataAsOf ?? 'n/a'}; page data built ${data.generatedAt.slice(0, 10)}`;
}

function setCapital(raw) {
  const v = Number(String(raw).replace(/[^\d.]/g, ''));
  capital = Number.isFinite(v) && v >= 1000 ? Math.min(v, 1e10) : capital;
  renderAllocation(amounts());
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
  capital = data.capital;
  $('#capital').value = capital.toLocaleString('en-US');
  renderPortfolio();
  renderStatic();
  renderRanking();
  renderAllocation(amounts());

  const input = $('#capital');
  input.addEventListener('input', () => setCapital(input.value));
  input.addEventListener('change', () => { input.value = capital.toLocaleString('en-US'); });
  $('#search').addEventListener('input', renderRanking);
  $('#more').addEventListener('click', () => { showAllRanking = !showAllRanking; renderRanking(); });
}

main();
