// Shaken: the page. Logic lives in quake-logic.js; this file only reads and draws.
import {
  PERIODS, RADII, DEFAULT_KM, parseFeed, inPeriod, sortEvents, nearEvents, nearest, summary,
  band, dotR, fmtMag, ago, kmLabel, latLonLabel, matchPlaces, placeLabel, placeByLabel, P,
  encodeState, decodeState, HISTORY, HIST_LIMIT, HIST_MAGS, historyURLs, feltHere, FELT_WORDS,
} from './quake-logic.js';

const FEED = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_month.geojson';
const NS = 'http://www.w3.org/2000/svg';
const PAGE = 25;
const VIEW = [-180, -85, 360, 160]; // lat 85°N to 75°S: nothing shakes the poles' edges
const WORDS = { day: 'today', week: 'this week', month: 'this month', ever: 'since 1900' };
const DAMAGE = { yellow: 'some damage likely', orange: 'significant damage likely', red: 'extensive damage likely' };
const SPAN = { day: 'the past day', week: 'the past week', month: 'the past month', ever: 'the USGS catalogue since 1900' };
const $ = (id) => document.getElementById(id);
const fmt = (n) => n.toLocaleString('en-US');

const state = { period: 'week', near: null, at: null, r: DEFAULT_KM, sort: 'big', shown: PAGE };
let FEEDDOC = null, ALL = [], WORLD = null, PLACES = null, placesP = null;
// Since 1900 is asked of the catalogue per place, radius and sort: {key, status, events, counts}.
let HIST = { key: null, status: 'idle', events: [], counts: [] };

function el(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.append(e);
  return e;
}

const now = () => (FEEDDOC && FEEDDOC.generated) || Date.now();
const ever = () => state.period === HISTORY;
const events = () => (ever() ? HIST.events : inPeriod(ALL, now(), state.period));
// The point the list is about, or null for the whole world.
const here = () => state.at;
const hereLabel = () => state.near || (state.at && state.at.label) || '';

function sync() {
  const at = state.near ? null : state.at;
  history.replaceState(null, '', location.pathname + encodeState({ ...state, at }));
}

// ---- map --------------------------------------------------------------------------

// A true circle of `r` km around a point, as lon/lat steps (destination-point formula),
// unwrapped so it never jumps across the map at the antimeridian.
function circle(lat, lon, r) {
  const d = r / 6371.0088, p1 = (lat * Math.PI) / 180, l1 = (lon * Math.PI) / 180;
  const pts = [];
  let prev = null;
  for (let i = 0; i <= 96; i++) {
    const b = (i / 96) * 2 * Math.PI;
    const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
    let l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    let x = (l2 * 180) / Math.PI;
    if (prev != null) while (x - prev > 180) x -= 360;
    if (prev != null) while (prev - x > 180) x += 360;
    prev = x;
    pts.push(`${x.toFixed(2)},${(-(p2 * 180) / Math.PI).toFixed(2)}`);
  }
  return 'M' + pts.join('L') + 'Z';
}

function drawMap() {
  const svg = el('svg', { viewBox: VIEW.join(' '), role: 'img' });
  el('rect', { class: 'sea', x: VIEW[0], y: VIEW[1], width: VIEW[2], height: VIEW[3] }, svg);
  if (WORLD) el('path', { class: 'land', d: WORLD.land }, svg);
  const list = events(), at = here();
  const inside = at ? new Set(nearEvents(list, at, state.r).map((e) => e.id)) : null;
  const g = el('g', { id: 'qs' }, svg);
  for (const e of list.slice().sort((a, b) => a.mag - b.mag)) {
    const c = el('circle', { class: `q b${band(e.mag)}${inside && !inside.has(e.id) ? ' out' : ''}`,
      cx: e.lon.toFixed(2), cy: (-e.lat).toFixed(2), r: dotR(e.mag).toFixed(2), 'data-id': e.id }, g);
    el('title', {}, c).textContent = `M${fmtMag(e.mag)} · ${e.place} · ${ago(e.time, Date.now())}`;
  }
  if (at) {
    const d = circle(at.lat, at.lon, state.r);
    for (const dx of [-360, 0, 360]) el('path', { class: 'ring', d, transform: `translate(${dx} 0)` }, svg);
    el('circle', { class: 'here', cx: at.lon.toFixed(2), cy: (-at.lat).toFixed(2), r: 1.6 }, svg);
  }
  svg.setAttribute('aria-label', `World map of ${fmt(list.length)} earthquakes in ${SPAN[state.period]}` +
    (at ? `, with a ${state.r} km circle around ${hereLabel()}` : ''));
  svg.addEventListener('click', (ev) => {
    const pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
    const m = svg.getScreenCTM(); if (!m) return;
    const p = pt.matrixTransform(m.inverse());
    const lat = Math.max(-89.9, Math.min(89.9, -p.y)), lon = ((p.x + 540) % 360) - 180;
    setPoint({ lat, lon, label: latLonLabel(lat, lon) });
  });
  $('mapSvg').replaceChildren(svg);
}

// ---- stats and list -----------------------------------------------------------------

function drawStats() {
  for (const b of document.querySelectorAll('#periods button')) b.setAttribute('aria-pressed', String(b.dataset.p === state.period));
  if (ever()) return drawHistStats();
  $('sNl').textContent = 'earthquakes M2.5+'; $('s5l').textContent = 'M5 or more'; $('s6l').textContent = 'M6 or more';
  const list = events(), s = summary(list);
  $('sN').textContent = fmt(s.n); $('s5').textContent = fmt(s.m5); $('s6').textContent = fmt(s.m6);
  if (s.max) {
    $('sMax').textContent = `M${fmtMag(s.max.mag)} · ${s.max.place}`;
    $('sMaxSub').textContent = `the biggest ${WORDS[state.period]}, ${ago(s.max.time, Date.now())}`;
  } else { $('sMax').textContent = 'None'; $('sMaxSub').textContent = `in ${SPAN[state.period]}`; }
}

function drawHistStats() {
  const mags = HIST_MAGS[here() ? 'near' : 'world'];
  const ids = ['sN', 's5', 's6'];
  ids.forEach((id, i) => {
    $(id + 'l').textContent = i ? `M${mags[i]} or more` : `earthquakes M${mags[i]}+`;
    const c = HIST.counts[i];
    $(id).textContent = HIST.status === 'error' ? '–' : c == null ? '…' : fmt(c);
  });
  const big = HIST.status === 'ok' ? summary(HIST.events).max : null;
  if (HIST.status === 'loading') { $('sMax').textContent = 'Asking the USGS catalogue…'; $('sMaxSub').textContent = 'every quake since 1900'; }
  else if (HIST.status === 'error') { $('sMax').textContent = 'Could not reach the USGS catalogue.'; $('sMaxSub').textContent = 'Try again in a minute, or pick a shorter period.'; }
  else if (big && state.sort !== 'new') {
    $('sMax').textContent = `M${fmtMag(big.mag)} · ${big.place}`;
    $('sMaxSub').textContent = `the biggest since 1900, in ${new Date(big.time).getUTCFullYear()}`;
  } else if (big) {
    $('sMax').textContent = `M${fmtMag(big.mag)} · ${big.place}`;
    $('sMaxSub').textContent = `the biggest of the latest ${fmt(HIST.events.length)}, in ${new Date(big.time).getUTCFullYear()}`;
  } else { $('sMax').textContent = 'None'; $('sMaxSub').textContent = 'in the USGS catalogue since 1900'; }
}

// One list call and three counts, in parallel; the counts can take seconds (Palo Alto's
// 67,347 M2.5+ took 8 s), so the list draws first and each count fills in as it lands.
function loadHistory() {
  const at = here(), u = historyURLs({ at, r: state.r, sort: state.sort });
  if (HIST.key === u.list && HIST.status !== 'error') return;
  const mine = HIST = { key: u.list, status: 'loading', events: [], counts: [] };
  const get = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
  get(u.list).then((doc) => {
    if (HIST !== mine) return;
    mine.events = parseFeed(doc).events; mine.status = 'ok';
    if (ever()) { drawStats(); drawMap(); drawList(); }
  }).catch(() => { if (HIST === mine) { mine.status = 'error'; if (ever()) { drawStats(); drawList(); } } });
  u.counts.forEach((c, i) => get(c.url).then((j) => {
    if (HIST !== mine || typeof j.count !== 'number') return;
    mine.counts[i] = j.count;
    if (ever()) { drawStats(); if (i === 0 && mine.status === 'ok') drawList(); } // the list's note quotes the total
  }).catch(() => {}));
}

const whenFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const OLD = 300 * 86400e3;

function row(e) {
  const li = document.createElement('li');
  const m = document.createElement('div'); m.className = `mag b${band(e.mag)}`; m.textContent = fmtMag(e.mag);
  const t = document.createElement('div'); t.className = 't';
  const a = document.createElement('a'); a.href = e.url; a.textContent = e.place; a.rel = 'noopener';
  t.append(a);
  // USGS PAGER: green means no damage expected, which is nearly every row; only the
  // levels that predict damage or deaths are worth a tag.
  if (DAMAGE[e.alert]) { const g = document.createElement('span'); g.className = `tag ${e.alert}`; g.textContent = DAMAGE[e.alert]; t.append(g); }
  const meta = document.createElement('div'); meta.className = 'm';
  const bits = [ago(e.time, Date.now()), (Date.now() - e.time > OLD ? dateFmt : whenFmt).format(new Date(e.time))];
  if (e.depth != null) bits.push(`${Math.round(e.depth)} km deep`);
  if (e.felt) bits.push(`${fmt(e.felt)} felt report${e.felt === 1 ? '' : 's'}`);
  meta.textContent = bits.join(' · ');
  if (e.d != null) { const b = document.createElement('b'); b.textContent = ` · ${kmLabel(e.d)} away`; meta.append(b); }
  if (e.d != null) {
    const f = feltHere(e, e.d), s = document.createElement('span');
    s.className = `felt ${f}`; s.textContent = ` · ${FELT_WORDS[f]}`; meta.append(s);
  }
  t.append(meta);
  li.append(m, t);
  return li;
}

function drawList() {
  const list = events(), at = here();
  const ol = $('list'), note = $('note');
  note.hidden = true;
  let rows;
  if (ever() && HIST.status !== 'ok') {
    rows = [];
    note.hidden = false;
    note.textContent = HIST.status === 'error' ? 'The USGS catalogue did not answer. Try again in a minute.' : 'Asking the USGS catalogue for every quake since 1900…';
    $('listTitle').textContent = at ? `Biggest within ${fmt(state.r)} km of ${hereLabel()} since 1900` : 'Biggest in the world since 1900';
  } else if (ever()) {
    rows = sortEvents(at ? nearEvents(list, at, state.r + 1) : list, state.sort);
    const what = `${state.sort === 'new' ? 'Latest' : 'Biggest'} ${fmt(Math.min(rows.length, HIST_LIMIT))}`;
    $('listTitle').textContent = at ? `${what} within ${fmt(state.r)} km of ${hereLabel()} since 1900` : `${what} in the world since 1900`;
    if (!rows.length) {
      note.hidden = false;
      note.textContent = `Nothing of magnitude 2.5 or more within ${fmt(state.r)} km in the USGS catalogue since 1900. Try a wider circle.`;
    } else if (at && rows.length >= HIST_LIMIT) {
      note.hidden = false;
      note.textContent = `The ${state.sort === 'new' ? 'latest' : 'biggest'} ${fmt(HIST_LIMIT)} of ${HIST.counts[0] != null ? fmt(HIST.counts[0]) : 'all'} in the catalogue. Older and smaller quakes are under-recorded, more so outside the US.`;
    }
  } else if (at) {
    rows = sortEvents(nearEvents(list, at, state.r), state.sort);
    $('listTitle').textContent = `${state.sort === 'new' ? 'Latest' : 'Biggest'} within ${fmt(state.r)} km of ${hereLabel()}`;
    if (!rows.length) {
      const n = nearest(list, at);
      note.hidden = false;
      note.textContent = `Nothing of magnitude 2.5 or more within ${fmt(state.r)} km in ${SPAN[state.period]}.` +
        (n ? ` The nearest was ${kmLabel(n.d)} away:` : '');
      if (n) rows = [n];
    }
  } else {
    rows = sortEvents(list, state.sort);
    $('listTitle').textContent = `${state.sort === 'new' ? 'Latest' : 'Biggest'} in the world ${WORDS[state.period]}`;
  }
  ol.replaceChildren(...rows.slice(0, state.shown).map(row));
  $('more').hidden = rows.length <= state.shown;
  $('more').textContent = `Show more (${fmt(rows.length - state.shown)} left)`;
  $('sort').value = state.sort;
  $('km').value = String(state.r);
}

function drawAll() { if (ever()) loadHistory(); drawStats(); drawMap(); drawList(); sync(); }

// ---- choosing a place -----------------------------------------------------------------

function setPoint(at, name = null) {
  state.at = at; state.near = name; state.shown = PAGE;
  $('near').value = name || (at ? at.label : '');
  closeOpts();
  drawAll();
}

async function loadPlaces() {
  placesP ||= fetch('data/places.json').then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
  try { PLACES = (await placesP).places; return PLACES; }
  catch (e) { placesP = null; throw e; }
}

let opts = [], active = -1;
function closeOpts() {
  opts = []; active = -1;
  $('nearList').hidden = true;
  $('near').setAttribute('aria-expanded', 'false');
  $('near').removeAttribute('aria-activedescendant');
}
function drawOpts() {
  const ul = $('nearList');
  ul.replaceChildren();
  opts.forEach((p, i) => {
    const li = document.createElement('li');
    li.id = `opt${i}`; li.setAttribute('role', 'option'); li.dataset.i = i;
    li.setAttribute('aria-selected', String(i === active));
    li.textContent = placeLabel(p);
    ul.append(li);
  });
  if (!opts.length) {
    const li = document.createElement('li'); li.className = 'none';
    li.textContent = 'No town by that name. Try a bigger place nearby, or tap the map.';
    ul.append(li);
  }
  ul.hidden = false;
  $('near').setAttribute('aria-expanded', 'true');
  if (active >= 0) { $('near').setAttribute('aria-activedescendant', `opt${active}`); $(`opt${active}`).scrollIntoView({ block: 'nearest' }); }
  else $('near').removeAttribute('aria-activedescendant');
}
const pick = (p) => setPoint({ lat: p[P.LAT], lon: p[P.LON] }, placeLabel(p));

async function onNearInput() {
  const v = $('near').value;
  if (!v.trim()) { closeOpts(); if (state.at) setPoint(null); return; }
  try { await loadPlaces(); }
  catch { opts = []; $('nearList').hidden = false; $('nearList').textContent = 'Could not load the list of towns. Try reloading.'; return; }
  if ($('near').value !== v) return; // typed on while loading
  opts = matchPlaces(PLACES, v); active = opts.length ? 0 : -1;
  drawOpts();
}

function wire() {
  const box = $('near');
  box.addEventListener('focus', () => { loadPlaces().catch(() => {}); });
  box.addEventListener('input', onNearInput);
  box.addEventListener('keydown', (e) => {
    if ($('nearList').hidden) { if (e.key === 'ArrowDown' && box.value.trim()) { onNearInput(); e.preventDefault(); } return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!opts.length) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : opts.length - 1)) % opts.length;
      drawOpts(); e.preventDefault();
    } else if (e.key === 'Enter') {
      if (active >= 0 && opts[active]) pick(opts[active]);
      e.preventDefault();
    } else if (e.key === 'Escape') {
      closeOpts(); box.value = hereLabel(); e.preventDefault();
    }
  });
  box.addEventListener('blur', () => setTimeout(() => {
    if (document.activeElement === box) return;
    closeOpts();
    if (state.at && box.value.trim()) box.value = hereLabel(); // a half-typed edit does not stick
  }, 150));
  $('nearList').addEventListener('mousedown', (e) => e.preventDefault());
  $('nearList').addEventListener('click', (e) => {
    const i = e.target.closest('li[data-i]')?.dataset.i;
    if (i != null && opts[i]) pick(opts[i]);
  });
  $('locate').addEventListener('click', () => {
    if (!navigator.geolocation) { $('hint').textContent = 'This browser cannot share its location. Type a town or tap the map.'; return; }
    $('locate').textContent = 'Locating…';
    navigator.geolocation.getCurrentPosition((pos) => {
      $('locate').textContent = 'Use my location';
      const lat = pos.coords.latitude, lon = pos.coords.longitude;
      setPoint({ lat, lon, label: 'your location' });
    }, () => {
      $('locate').textContent = 'Use my location';
      $('hint').textContent = 'Location was not shared. Type a town or tap the map instead.';
    }, { maximumAge: 600e3, timeout: 15e3 });
  });
  for (const r of RADII) { const o = document.createElement('option'); o.value = r; o.textContent = `${fmt(r)} km`; $('km').append(o); }
  $('km').addEventListener('change', () => { state.r = Number($('km').value) || DEFAULT_KM; state.shown = PAGE; drawAll(); });
  $('sort').addEventListener('change', () => { state.sort = $('sort').value; state.shown = PAGE; if (ever()) drawAll(); else { drawList(); sync(); } });
  $('periods').addEventListener('click', (e) => {
    const p = e.target.closest('button[data-p]')?.dataset.p;
    if (p && (PERIODS[p] || p === HISTORY) && p !== state.period) { state.period = p; state.shown = PAGE; drawAll(); }
  });
  $('more').addEventListener('click', () => { state.shown += PAGE * 4; drawList(); });
}

// ---- start ----------------------------------------------------------------------------

async function main() {
  const want = decodeState(location.search);
  Object.assign(state, { period: want.period, r: want.r, sort: want.sort });
  if (want.at) state.at = { ...want.at, label: latLonLabel(want.at.lat, want.at.lon) };
  wire();
  const worldP = fetch('data/world.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  let doc;
  try {
    const r = await fetch(FEED, { cache: 'no-cache' });
    if (!r.ok) throw new Error(r.status);
    doc = await r.json();
  } catch {
    $('sMax').textContent = 'Could not reach the USGS feed.';
    $('sMaxSub').textContent = 'Try reloading in a minute.';
    WORLD = await worldP; drawMap();
    return;
  }
  FEEDDOC = parseFeed(doc); ALL = FEEDDOC.events;
  WORLD = await worldP;
  if (FEEDDOC.generated) $('gen').textContent = `; this copy was generated ${ago(FEEDDOC.generated, Date.now())}`;
  if (want.near) {
    $('near').value = want.near;
    try {
      await loadPlaces();
      const p = placeByLabel(PLACES, want.near);
      if (p) { pick(p); return; }
      drawAll(); onNearInput(); // an unknown town opens its suggestions instead
      return;
    } catch { /* the box says why when it is next used */ }
  }
  if (state.at) $('near').value = state.at.label;
  drawAll();
}
main();
