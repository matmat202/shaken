// Shaken: pure logic, no DOM. The page and the suite both import this file.
//
// The feed is USGS's "M2.5+ earthquakes, past month" GeoJSON, fetched live. Shape (probed
// 2026-10-26): {metadata: {generated, count, ...}, features: [{id, properties: {mag,
// place, time, url, felt, tsunami, alert, type, ...}, geometry: {coordinates: [lon, lat,
// depth_km]}}]}. `type` is not always "earthquake" (a landslide was in the first probe)
// and `mag` can be null.

export const PERIODS = { day: 1, week: 7, month: 30 };
export const DEFAULT_PERIOD = 'week';
export const RADII = [100, 250, 500, 1000, 2500];
export const DEFAULT_KM = 500;
export const SORTS = ['big', 'new'];
const DAY = 86400e3;

// ---- since 1900 ------------------------------------------------------------------------
// The month feed leaves "near me" empty for most people: on the live feed of 2026-10-27,
// 57% of the world's population had nothing M2.5+ within the default 500 km, 93% within
// 100 km. The USGS catalogue's query service (fdsnws/event/1, CORS *) answers from 1900
// on. Its query returns the same GeoJSON as the feed; count returns {count}. A list is the
// 200 biggest (or latest) in range; the counts are separate calls because the catalogue
// refuses a list of more than 20,000 and Palo Alto alone has 67,347 M2.5+ within 500 km.
export const HISTORY = 'ever';
export const SINCE = '1900-01-01';
export const HIST_LIMIT = 200;
export const FDSN = 'https://earthquake.usgs.gov/fdsnws/event/1/';
// Near a place: everything M2.5+. The whole world since 1900 is ~14,000 M6+ quakes, so the
// world view starts its list and counts higher.
export const HIST_MAGS = { near: [2.5, 5, 6], world: [6, 7, 8] };

export function historyURLs({ at, r, sort }) {
  const base = new URLSearchParams({ format: 'geojson', eventtype: 'earthquake', starttime: SINCE });
  if (at) {
    base.set('latitude', at.lat.toFixed(2)); base.set('longitude', at.lon.toFixed(2));
    base.set('maxradiuskm', String(r));
  }
  const mags = HIST_MAGS[at ? 'near' : 'world'];
  const list = new URLSearchParams(base);
  list.set('minmagnitude', String(at ? mags[0] : mags[1]));
  list.set('orderby', sort === 'new' ? 'time' : 'magnitude');
  list.set('limit', String(HIST_LIMIT));
  const counts = mags.map((m) => {
    const q = new URLSearchParams(base); q.set('minmagnitude', String(m));
    return { min: m, url: `${FDSN}count?${q}` };
  });
  return { list: `${FDSN}query?${list}`, counts };
}

export function parseFeed(doc) {
  const events = [];
  for (const f of (doc && doc.features) || []) {
    const p = f.properties || {}, c = (f.geometry && f.geometry.coordinates) || [];
    if (p.type !== 'earthquake' || typeof p.mag !== 'number') continue;
    const [lon, lat, depth] = c;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(p.time)) continue;
    events.push({
      id: f.id, mag: p.mag, place: p.place || 'Unnamed location', time: p.time,
      lat, lon, depth: Number.isFinite(depth) ? depth : null,
      url: p.url || '', felt: p.felt || 0, tsunami: !!p.tsunami, alert: p.alert || null,
      // USGS issues an aftershock forecast (product 'oaf') for US M4+ and the world's big ones.
      oaf: typeof p.types === 'string' && p.types.includes(',oaf,'),
    });
  }
  events.sort((a, b) => b.time - a.time || b.mag - a.mag);
  return { generated: (doc && doc.metadata && doc.metadata.generated) || null, events };
}

export function inPeriod(events, now, period) {
  const from = now - (PERIODS[period] || PERIODS[DEFAULT_PERIOD]) * DAY;
  return events.filter((e) => e.time >= from && e.time <= now);
}

// Great-circle distance in km (mean Earth radius).
export function km(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Biggest first; among equals, the most recent.
export function sortEvents(list, sort) {
  const out = list.slice();
  if (sort === 'new') out.sort((a, b) => b.time - a.time || b.mag - a.mag);
  else out.sort((a, b) => b.mag - a.mag || b.time - a.time);
  return out;
}

// Every event within `radius` km of `at` ({lat, lon}), each with its distance `d`.
export function nearEvents(events, at, radius) {
  const out = [];
  for (const e of events) {
    const d = km(at.lat, at.lon, e.lat, e.lon);
    if (d <= radius) out.push({ ...e, d });
  }
  return out;
}

// The closest event of all, for "nothing within 500 km; the nearest was 1,240 km away".
export function nearest(events, at) {
  let best = null;
  for (const e of events) {
    const d = km(at.lat, at.lon, e.lat, e.lon);
    if (!best || d < best.d) best = { ...e, d };
  }
  return best;
}

// ---- felt here? -------------------------------------------------------------------------
// "Near me" lists everything within the circle, and most of it nobody there could feel: an
// M2.6 at 400 km is a line on the list and nothing at all on the ground. The intensity a
// quake reaches at a distance comes from AWW2014 (Atkinson, Worden & Wald), the equation
// USGS "Did You Feel It?" plots against its reports. The coefficients were recovered by
// least squares from those plotted curves for 90 events of the 2026-10-28 month feed
// (epicentral distance with the depth folded in; West to 0.06 intensity units at the 95th
// percentile, East to 0.22). West predicts weaker shaking than reports show and East
// stronger, so each claim is made with the model that errs against it, and the gap between
// them is "maybe". Against 1,777 DYFI 10 km cells: "too far" (East < 1.5) was said of 0.4%
// of cells where 2+ people felt it; "likely" (West >= 3) of 0.7% of cells reporting not felt.
export const IPE = {
  west: [11.4772, 1.85571, -0.00254, -1.62698, -0.00219, 1.75741, -0.38088],
  east: [12.23709, 1.95484, 0.01544, -1.46683, -0.00137, 2.2475, -0.41455],
};
export const FELT_LIKELY = 3, FELT_NONE = 1.5;
export function intensity(c, mag, depth, d) {
  const h = Math.max(0, depth || 0);
  const R = Math.sqrt(d * d + h * h + 196), lR = Math.log10(R), B = Math.max(0, Math.log10(R / 50));
  return c[0] + c[1] * (mag - 6) + c[2] * (mag - 6) ** 2 + c[3] * lR + c[4] * R + c[5] * B + c[6] * mag * lR;
}
// 'likely' | 'maybe' | 'no', for a quake `d` km from the visitor.
export function feltHere(e, d) {
  if (intensity(IPE.east, e.mag, e.depth, d) < FELT_NONE) return 'no';
  if (intensity(IPE.west, e.mag, e.depth, d) >= FELT_LIKELY) return 'likely';
  return 'maybe';
}
export const FELT_WORDS = { likely: 'likely felt here', maybe: 'maybe felt by a few here', no: 'too far to feel here' };

export function summary(events) {
  let max = null, m5 = 0, m6 = 0, m7 = 0, tsunami = 0;
  for (const e of events) {
    if (!max || e.mag > max.mag || (e.mag === max.mag && e.time > max.time)) max = e;
    if (e.mag >= 5) m5++;
    if (e.mag >= 6) m6++;
    if (e.mag >= 7) m7++;
    if (e.tsunami) tsunami++;
  }
  return { n: events.length, max, m5, m6, m7, tsunami };
}

// Five bands for the legend and the dot colour: under 4, 4s, 5s, 6s, 7 and over.
export function band(mag) {
  return mag >= 7 ? 4 : mag >= 6 ? 3 : mag >= 5 ? 2 : mag >= 4 ? 1 : 0;
}

// Dot radius in map degrees. Each magnitude step is ~32x the energy; the dot grows by a
// fixed step instead, or an M7 would cover a continent and an M3 would vanish.
export function dotR(mag) {
  return 0.6 + Math.max(0, mag - 2.5) * 0.55;
}

export function fmtMag(m) { return m.toFixed(1); }

export function ago(t, now) {
  const s = Math.max(0, (now - t) / 1000);
  if (s < 90) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 60) return `${d} day${d === 1 ? '' : 's'} ago`;
  const mo = Math.round(d / 30.44);
  if (mo < 24) return `${mo} months ago`;
  const y = Math.floor(d / 365.25);
  return `${y.toLocaleString('en-US')} years ago`;
}

export function kmLabel(d) {
  return d < 10 ? `${d.toFixed(1)} km` : `${Math.round(d).toLocaleString('en-US')} km`;
}

export function latLonLabel(lat, lon) {
  return `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`;
}

// ---- places: [name, admin1, country, lat, lon, pop], most populous first ----------

export const P = { NAME: 0, A1: 1, CC: 2, LAT: 3, LON: 4, POP: 5 };

// Letters NFD does not take apart: "tromso" has to find the slashed o of Tromso, "lodz" the barred l of Lodz.
const LETTERS = { '\u00f8': 'o', '\u00e6': 'ae', '\u0153': 'oe', '\u00df': 'ss', '\u0142': 'l', '\u0111': 'd', '\u00f0': 'd', '\u00fe': 'th', '\u0131': 'i', '\u0127': 'h' };
export function fold(s) {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[\u00f8\u00e6\u0153\u00df\u0142\u0111\u00f0\u00fe\u0131\u0127]/g, (c) => LETTERS[c]).replace(/[^a-z0-9]+/g, ' ').trim();
}

export function placeLabel(p) {
  const parts = [p[P.NAME]];
  if (p[P.A1] && p[P.A1] !== p[P.NAME]) parts.push(p[P.A1]);
  parts.push(p[P.CC]);
  return parts.join(', ');
}

// "palo alto" or "springfield, illinois" or "paris, fr…". The part before the first
// comma has to start the place's name; each later part has to start its region's or its
// country's name. A whole-name match ranks above a prefix; then the list's own order,
// which is biggest first.
export function matchPlaces(places, q, limit = 8) {
  const [head, ...rest] = String(q).split(',').map(fold);
  if (!head) return [];
  const exact = [], prefix = [];
  for (const p of places) {
    const n = fold(p[P.NAME]);
    if (!n.startsWith(head)) continue;
    if (rest.some((r) => r && !(fold(p[P.A1]).startsWith(r) || fold(p[P.CC]).startsWith(r)))) continue;
    (n === head ? exact : prefix).push(p);
    if (exact.length >= limit) break;
  }
  return exact.concat(prefix).slice(0, limit);
}

export function placeByLabel(places, label) {
  const f = fold(label);
  return places.find((p) => fold(placeLabel(p)) === f) || null;
}

// ---- URL state ------------------------------------------------------------------
// ?p=month&near=Palo Alto, California, United States&r=250&sort=new  (p=ever: since 1900)
// ?at=37.44,-122.14 for a point picked on the map or from the browser's location.
// Unknown values fall back to the defaults rather than throw.

export function encodeState({ period, near, at, r, sort }) {
  const q = new URLSearchParams();
  if (period && period !== DEFAULT_PERIOD) q.set('p', period);
  if (near) q.set('near', near);
  else if (at) q.set('at', `${at.lat.toFixed(2)},${at.lon.toFixed(2)}`);
  if ((near || at) && r && r !== DEFAULT_KM) q.set('r', String(r));
  if (sort && sort !== 'big') q.set('sort', sort);
  const s = q.toString();
  return s ? `?${s}` : '';
}

export function decodeState(search) {
  const q = new URLSearchParams(search || '');
  const period = Object.hasOwn(PERIODS, q.get('p')) || q.get('p') === HISTORY ? q.get('p') : DEFAULT_PERIOD;
  const near = (q.get('near') || '').slice(0, 120).trim() || null;
  let at = null;
  const m = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(q.get('at') || '');
  if (!near && m) {
    const lat = +m[1], lon = +m[2];
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) at = { lat, lon };
  }
  const r = RADII.includes(+q.get('r')) ? +q.get('r') : DEFAULT_KM;
  const sort = SORTS.includes(q.get('sort')) ? q.get('sort') : 'big';
  return { period, near, at, r, sort };
}

// ---- aftershock forecast: USGS's 'oaf' product -------------------------------------------

export const DETAIL = (id) => `https://earthquake.usgs.gov/earthquakes/feed/v1.0/detail/${encodeURIComponent(id)}.geojson`;
export const AFTER_MAGS = [5, 6, 7];

// The forecast.json of the event's preferred oaf product, or null if it has none.
export function forecastURL(detail) {
  const o = detail && detail.properties && detail.properties.products && detail.properties.products.oaf;
  const c = o && o[0] && o[0].contents && o[0].contents['forecast.json'];
  return (c && c.url) || null;
}

// What the forecast says about the shortest window that has not yet ended: chances of an
// aftershock of M5+, M6+, M7+ (only those below the mainshock: one at or above it is the
// 'bigger' line), the usual count of M3+, and the chance of one bigger than the mainshock.
// Every window starts when the forecast was issued, so a 1-week window may be half spent.
export function aftershockOutlook(fc, now) {
  if (!fc || !Array.isArray(fc.forecast) || (fc.expireTime && fc.expireTime <= now)) return null;
  const ws = fc.forecast.filter((w) => w && w.timeEnd > now && Array.isArray(w.bins)).sort((a, b) => a.timeEnd - b.timeEnd);
  const w = ws[0];
  if (!w) return null;
  const main = fc.model && fc.model.parameters && fc.model.parameters.magMain;
  const bin = (m) => w.bins.find((b) => b.magnitude === m);
  const rows = AFTER_MAGS.filter((m) => !(main <= m) && bin(m)).map((m) => ({ mag: m, p: bin(m).probability }));
  const m3 = bin(3);
  const bigger = w.aboveMainshockMag && Number.isFinite(w.aboveMainshockMag.probability) ? w.aboveMainshockMag.probability : null;
  return {
    label: String(w.label || '').toLowerCase(), from: w.timeStart, to: w.timeEnd, issued: fc.creationTime || w.timeStart,
    rows, count: m3 ? { median: m3.median, lo: m3.p95minimum, hi: m3.p95maximum } : null,
    main: Number.isFinite(main) ? main : null, bigger,
  };
}

// A probability as people read one: never '0%' for something possible, nor '100%'.
export function pct(p) {
  if (!(p > 0)) return '0%';
  if (p < 0.01) return '<1%';
  if (p > 0.99) return '>99%';
  return `${Math.round(p * 100)}%`;
}
