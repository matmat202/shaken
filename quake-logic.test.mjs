// node site/quake-logic.test.mjs — the page's pure logic, on made-up quakes and on a frozen
// copy of the real USGS feed (test/fixture.json, fetched 2026-10-26) whose facts were
// counted separately in Python, not by this module. Exit 1 on any failure.
//   test/plant.sh   # mutates a copy of the logic; each mutant must FAIL this suite
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
const L = await import(process.env.LOGIC ? pathToFileURL(process.env.LOGIC).href : './quake-logic.js');
const here = (p) => fileURLToPath(new URL(p, import.meta.url));

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log(`FAIL ${name} ${extra}`); } };
const eq = (name, a, b) => ok(name, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
const near = (name, a, b, tol) => ok(name, Math.abs(a - b) <= tol, `got ${a} want ${b} ±${tol}`);

// --- distance ------------------------------------------------------------------------
near('San Francisco to Los Angeles', L.km(37.7749, -122.4194, 34.0522, -118.2437), 559, 2);
near('London to Paris', L.km(51.5074, -0.1278, 48.8566, 2.3522), 344, 1);
near('across the antimeridian is short', L.km(0, 179.5, 0, -179.5), 111.2, 0.2);
near('pole to pole', L.km(90, 0, -90, 0), 20015, 2);
eq('same point', L.km(10, 20, 10, 20), 0);

// --- a made-up feed --------------------------------------------------------------------
const now = Date.UTC(2026, 9, 26, 12);
const H = 3600e3, D = 24 * H;
const F = (id, mag, hoursAgo, lat, lon, extra = {}) => ({
  type: 'Feature', id, properties: { mag, place: `${id} place`, time: now - hoursAgo * H, url: `u/${id}`, felt: null, tsunami: 0, alert: null, type: 'earthquake', ...extra },
  geometry: { type: 'Point', coordinates: [lon, lat, 10] },
});
const fake = { metadata: { generated: now }, features: [
  F('a', 4.1, 2, 37.5, -122.0),
  F('b', 6.2, 30, 35.0, 139.0, { tsunami: 1 }),
  F('c', 3.0, 5 * 24, 37.9, -122.3),
  F('d', 6.2, 3, -20.0, -175.0),
  F('e', 7.1, 20 * 24, 0, 0),
  F('slide', 3.3, 1, 37.5, -122.0, { type: 'landslide' }),
  F('nomag', null, 1, 37.5, -122.0),
  { type: 'Feature', id: 'nogeo', properties: { mag: 5, time: now, type: 'earthquake' }, geometry: null },
] };
const pf = L.parseFeed(fake);
eq('only earthquakes with a magnitude and a point', pf.events.map((e) => e.id), ['a', 'd', 'b', 'c', 'e']);
eq('newest first', pf.events.map((e) => e.time).every((t, i, a) => !i || a[i - 1] >= t), true);
eq('generated carried', pf.generated, now);
eq('fields', (({ id, mag, lat, lon, depth, tsunami, felt }) => ({ id, mag, lat, lon, depth, tsunami, felt }))(pf.events[2]),
  { id: 'b', mag: 6.2, lat: 35, lon: 139, depth: 10, tsunami: true, felt: 0 });
eq('an empty or broken feed is no quakes, not a throw', [L.parseFeed(null).events, L.parseFeed({}).events], [[], []]);

eq('past day', L.inPeriod(pf.events, now, 'day').map((e) => e.id), ['a', 'd']);
eq('past week', L.inPeriod(pf.events, now, 'week').map((e) => e.id), ['a', 'd', 'b', 'c']);
eq('past month', L.inPeriod(pf.events, now, 'month').length, 5);
eq('an unknown period is the default', L.inPeriod(pf.events, now, 'year').length, 4);
eq('the edge of a day is in it', L.inPeriod([{ time: now - D }], now, 'day').length, 1);
eq('a time after now is not in it', L.inPeriod([{ time: now + 1 }], now, 'day').length, 0);

eq('biggest first, the more recent of a tie first', L.sortEvents(pf.events, 'big').map((e) => e.id), ['e', 'd', 'b', 'a', 'c']);
eq('a tie sorts by time even from the wrong order', L.sortEvents(pf.events.slice().reverse(), 'big').map((e) => e.id), ['e', 'd', 'b', 'a', 'c']);
eq('newest first', L.sortEvents(pf.events, 'new').map((e) => e.id), ['a', 'd', 'b', 'c', 'e']);
eq('sorting copies', pf.events.map((e) => e.id), ['a', 'd', 'b', 'c', 'e']);

const pa = { lat: 37.44, lon: -122.14 };
eq('within 100 km of Palo Alto', L.nearEvents(pf.events, pa, 100).map((e) => e.id).sort(), ['a', 'c']);
eq('distances are kept', L.nearEvents(pf.events, pa, 100).every((e) => e.d > 0 && e.d < 100), true);
eq('nothing within 10 km', L.nearEvents(pf.events, pa, 10), []);
eq('the nearest of all', L.nearest(pf.events, pa).id, 'a');
eq('the nearest of nothing', L.nearest([], pa), null);

const s = L.summary(pf.events);
eq('summary', { n: s.n, max: s.max.id, m5: s.m5, m6: s.m6, m7: s.m7, tsunami: s.tsunami }, { n: 5, max: 'e', m5: 3, m6: 3, m7: 1, tsunami: 1 });
eq('summary of a tie picks the more recent', L.summary(L.inPeriod(pf.events, now, 'week')).max.id, 'd');
eq('summary of nothing', L.summary([]), { n: 0, max: null, m5: 0, m6: 0, m7: 0, tsunami: 0 });

eq('bands', [2.5, 3.99, 4, 5.0, 5.99, 6, 7, 9.1].map(L.band), [0, 0, 1, 2, 2, 3, 4, 4]);
ok('dots grow with magnitude', L.dotR(2.5) < L.dotR(5) && L.dotR(5) < L.dotR(7) && L.dotR(2.5) > 0);
eq('ago', [30e3, 10 * 60e3, 3 * H, 30 * H, 40 * H, 3 * D].map((t) => L.ago(now - t, now)), ['just now', '10 min ago', '3 h ago', '30 h ago', '2 days ago', '3 days ago']);
eq('one day', L.ago(now - 36 * H, now), '2 days ago');
eq('km labels', [L.kmLabel(3.24), L.kmLabel(60.7), L.kmLabel(1240.4)], ['3.2 km', '61 km', '1,240 km']);
eq('lat/lon label', [L.latLonLabel(37.44, -122.14), L.latLonLabel(-33.87, 151.21)], ['37.44°N, 122.14°W', '33.87°S, 151.21°E']);

// --- places ----------------------------------------------------------------------------
const pl = [
  ['Springfield', 'Missouri', 'United States', 37.2, -93.3, 170000],
  ['Springfield', 'Illinois', 'United States', 39.8, -89.6, 114000],
  ['Springs', 'Gauteng', 'South Africa', -26.2, 28.4, 100000],
  ['São Paulo', 'São Paulo', 'Brazil', -23.5, -46.6, 10000000],
  ['Spring', 'Texas', 'United States', 30.1, -95.4, 60000],
];
eq('label skips a region named like the town', [L.placeLabel(pl[0]), L.placeLabel(pl[3])], ['Springfield, Missouri, United States', 'São Paulo, Brazil']);
eq('whole name above prefix, then list order', L.matchPlaces(pl, 'spring').map(L.placeLabel),
  ['Spring, Texas, United States', 'Springfield, Missouri, United States', 'Springfield, Illinois, United States', 'Springs, Gauteng, South Africa']);
eq('narrowed by region', L.matchPlaces(pl, 'springfield, ill').map(L.placeLabel), ['Springfield, Illinois, United States']);
eq('narrowed by country', L.matchPlaces(pl, 'spri, south').map(L.placeLabel), ['Springs, Gauteng, South Africa']);
eq('accents and case fold', L.matchPlaces(pl, 'SAO PAU').map((p) => p[0]), ['São Paulo']);
eq('letters NFD keeps whole', ['Tromsø', 'Łódź', 'Straße'].map(L.fold), ['tromso', 'lodz', 'strasse']);
eq('nothing typed', L.matchPlaces(pl, '  '), []);
eq('limit', L.matchPlaces(pl, 's', 2).length, 2);
eq('by label', L.placeByLabel(pl, 'springfield, illinois, united states'), pl[1]);
eq('unknown label', L.placeByLabel(pl, 'Atlantis'), null);

// --- URL state -------------------------------------------------------------------------
eq('defaults encode to nothing', L.encodeState({ period: 'week', r: 500, sort: 'big' }), '');
const st = { period: 'month', near: 'Palo Alto, California, United States', r: 250, sort: 'new' };
eq('round trip by name', L.decodeState(L.encodeState(st)), { period: 'month', near: st.near, at: null, r: 250, sort: 'new' });
const st2 = { period: 'day', near: null, at: { lat: 37.44, lon: -122.14 }, r: 500, sort: 'big' };
eq('round trip by point', L.decodeState(L.encodeState(st2)), st2);
eq('a radius without a place is dropped', L.encodeState({ period: 'week', r: 250 }), '');
eq('junk falls back', L.decodeState('?p=year&r=7&sort=x&at=999,0'), { period: 'week', near: null, at: null, r: 500, sort: 'big' });
eq('a name beats a point', L.decodeState('?near=Lagos&at=1,2').at, null);

// --- the real feed, frozen -------------------------------------------------------------
// Counted in Python straight from the GeoJSON (2026-10-26): 1,952 features, 1,951
// earthquakes (one landslide); haversine with R = 6371.0088.
// ../test/ in the working tree, ./test/ in the published copy (which is flat).
const fxFile = [here('../test/fixture.json'), here('./test/fixture.json')].find(existsSync);
const fx = JSON.parse(readFileSync(fxFile, 'utf8'));
const real = L.parseFeed(fx);
const gen = fx.metadata.generated;
eq('real: 1,951 of 1,952 features are earthquakes', [fx.features.length, real.events.length], [1952, 1951]);
const pick = (xs) => { const t = L.summary(xs); return [t.n, t.max.id, t.max.mag, t.m5, t.m6, t.m7, t.tsunami]; };
eq('real: past day', pick(L.inPeriod(real.events, gen, 'day')), [31, 'us6000u4yr', 5.5, 5, 0, 0, 0]);
eq('real: past week', pick(L.inPeriod(real.events, gen, 'week')), [373, 'us6000u43g', 7, 66, 6, 1, 4]);
eq('real: past month', pick(L.inPeriod(real.events, gen, 'month')), [1951, 'us6000u18k', 7.7, 193, 17, 2, 8]);
eq('real: the month\'s biggest is Panama', L.summary(real.events).max.place, '12 km WSW of Pitaloza Arriba, Panama');
const around = (lat, lon) => {
  const w = L.sortEvents(L.nearEvents(real.events, { lat, lon }, 500), 'big');
  const n = L.nearest(real.events, { lat, lon });
  return [w.length, w[0] ? w[0].id : null, w[0] ? Math.round(w[0].d * 10) / 10 : null, n.id, Math.round(n.d * 10) / 10];
};
eq('real: Palo Alto', around(37.44, -122.14), [53, 'nc75444322', 436.3, 'nc75443112', 60.7]);
eq('real: Tokyo', around(35.69, 139.69), [17, 'us6000tytg', 77.7, 'us6000u3rn', 26.8]);
eq('real: London has none within 500 km', around(51.51, -0.13), [0, null, null, 'us6000u13t', 954.6]);

// --- the shipped places ------------------------------------------------------------------
const placesFile = here('./data/places.json');
if (existsSync(placesFile)) {
  const P = JSON.parse(readFileSync(placesFile, 'utf8')).places;
  ok('shipped: 31,000+ places', P.length > 31000, P.length);
  eq('shipped: biggest first', P.every((p, i) => !i || P[i - 1][5] >= p[5]), true);
  eq('shipped: palo alto', L.matchPlaces(P, 'palo alto').map(L.placeLabel)[0], 'Palo Alto, California, United States');
  eq('shipped: the biggest Springfield first', L.placeLabel(L.matchPlaces(P, 'springfield')[0]), 'Springfield, Missouri, United States');
  eq('shipped: tokyo', L.placeLabel(L.matchPlaces(P, 'tokyo')[0]), 'Tokyo, Japan');
  const lbl = 'Palo Alto, California, United States';
  eq('shipped: label round trip', L.placeLabel(L.placeByLabel(P, lbl)), lbl);
  // The layout app.js reads by name (P.LAT, P.LON): a changed index would put the dot elsewhere.
  const pa = L.placeByLabel(P, 'Palo Alto, California, United States');
  eq('shipped: P names the columns', [pa[L.P.NAME], pa[L.P.A1], pa[L.P.CC], pa[L.P.LAT], pa[L.P.LON], pa[L.P.POP]], ['Palo Alto', 'California', 'United States', 37.44, -122.14, 66853]);
  eq('shipped: "victoria" is eight Victorias (nine have the whole name, so no prefix gets in)', L.matchPlaces(P, 'victoria').map((p) => p[0]), Array(8).fill('Victoria'));
} else ok('shipped: data/places.json exists (run build.py)', false);

// --- since 1900 -------------------------------------------------------------------------
const Y = 365.25 * D;
eq('ago in months and years', [59 * D, 61 * D, 400 * D, 23 * 30.44 * D, 25 * 30.44 * D, 120.4 * Y].map((t) => L.ago(now - t, now)),
  ['59 days ago', '2 months ago', '13 months ago', '23 months ago', '2 years ago', '120 years ago']);
eq('a 1906 quake is 120 years ago', L.ago(Date.UTC(1906, 3, 18, 13, 12), now), '120 years ago');
eq('p=ever decodes', L.decodeState('?p=ever&near=Lagos').period, 'ever');
eq('p=ever round trips', L.decodeState(L.encodeState({ period: 'ever', near: null, at: { lat: 37.44, lon: -122.14 }, r: 100, sort: 'big' })),
  { period: 'ever', near: null, at: { lat: 37.44, lon: -122.14 }, r: 100, sort: 'big' });
const qs = (u) => Object.fromEntries(new URL(u).searchParams);
const hn = L.historyURLs({ at: { lat: 37.4419, lon: -122.143 }, r: 250, sort: 'big' });
ok('near: a query, not a count', new URL(hn.list).pathname === '/fdsnws/event/1/query' && hn.list.startsWith(L.FDSN), hn.list);
eq('near: list params', qs(hn.list), { format: 'geojson', eventtype: 'earthquake', starttime: '1900-01-01',
  latitude: '37.44', longitude: '-122.14', maxradiuskm: '250', minmagnitude: '2.5', orderby: 'magnitude', limit: '200' });
eq('near: counts at 2.5, 5, 6', hn.counts.map((c) => [c.min, new URL(c.url).pathname, qs(c.url).minmagnitude, qs(c.url).maxradiuskm, qs(c.url).orderby]),
  [[2.5, '/fdsnws/event/1/count', '2.5', '250', undefined], [5, '/fdsnws/event/1/count', '5', '250', undefined], [6, '/fdsnws/event/1/count', '6', '250', undefined]]);
eq('latest first asks by time', qs(L.historyURLs({ at: { lat: 1, lon: 2 }, r: 100, sort: 'new' }).list).orderby, 'time');
const hw = L.historyURLs({ at: null, r: 500, sort: 'big' });
eq('world: no point, starts at M7', [qs(hw.list).latitude, qs(hw.list).maxradiuskm, qs(hw.list).minmagnitude, qs(hw.list).starttime], [undefined, undefined, '7', '1900-01-01']);
eq('world: counts at 6, 7, 8', hw.counts.map((c) => qs(c.url).minmagnitude), ['6', '7', '8']);
// The catalogue's query answer is the feed's own GeoJSON: parseFeed reads it unchanged.
const fdsnFix = [here('../test/hist-fixture.json'), here('./test/hist-fixture.json')].find(existsSync);
if (fdsnFix) {
  const h = L.parseFeed(JSON.parse(readFileSync(fdsnFix, 'utf8')));
  const big = L.sortEvents(h.events, 'big')[0];
  eq('catalogue fixture: 200 parsed', h.events.length, 200);
  ok('catalogue fixture: biggest near Palo Alto since 1900 is the 1906 M7.9', big.mag === 7.9 && new Date(big.time).getUTCFullYear() === 1906, JSON.stringify(big));
} else ok('test/hist-fixture.json exists', false);

// --- exact edges ---------------------------------------------------------------------------
const Q = (id, mag, time, extra = {}) => ({ id, mag, time, lat: 0, lon: 0, tsunami: false, ...extra });
// Three, in the wrong order: a smaller later quake must not take "biggest", nor an equal one at the same time.
eq('summary: biggest, then latest, over three', [L.summary([Q('a', 5, 1), Q('b', 6, 2), Q('c', 4, 3)]).max.id, L.summary([Q('a', 6, 5), Q('b', 6, 5), Q('c', 6, 4)]).max.id], ['b', 'a']);
eq('feed order: newest, then biggest among equal times', L.parseFeed({ features: [5, 7, 6].map((m, k) => ({ id: `q${k}`, properties: { type: 'earthquake', mag: m, time: 100 }, geometry: { coordinates: [0, 0, 1] } })) }).events.map((e) => e.mag), [7, 6, 5]);
eq('sort new: newest, then biggest among equal times', L.sortEvents([Q('a', 5, 100), Q('b', 7, 100), Q('c', 6, 200)], 'new').map((e) => e.id), ['c', 'b', 'a']);
const feature = (props, coords) => ({ id: 'x', properties: { type: 'earthquake', mag: 5, time: 1, ...props }, geometry: { coordinates: coords } });
eq('parseFeed drops a quake missing any one of lat, lon or time', [[{}, [NaN, 1, 1]], [{}, [1, NaN, 1]], [{ time: NaN }, [1, 1, 1]]].map(([p, c]) => L.parseFeed({ features: [feature(p, c)] }).events.length), [0, 0, 0]);
eq('parseFeed keeps the alert and defaults a missing url to ""', (({ url, alert }) => [url, alert])(L.parseFeed({ features: [feature({ alert: 'green' }, [1, 1, 1])] }).events[0]), ['', 'green']);
eq('inPeriod: exactly now is in, a month is 30 days', [L.inPeriod([Q('a', 5, now)], now, 'week').length, L.inPeriod([Q('a', 5, now - 30.5 * D)], now, 'month').length], [1, 0]);
eq('nearEvents: exactly the radius is in', L.nearEvents([Q('a', 5, 1)], { lat: 0, lon: 0 }, 0).length, 1);
eq('nearest: a tie goes to the first', L.nearest([Q('a', 5, 1), Q('b', 6, 2)], { lat: 1, lon: 1 }).id, 'a');
eq('decodeState: the poles and the date line are in, past them is not', ['?at=90,180', '?at=-90,-180', '?at=90.5,0', '?at=0,180.5'].map((q) => L.decodeState(q).at),
  [{ lat: 90, lon: 180 }, { lat: -90, lon: -180 }, null, null]);
eq('decodeState: every radius on offer', L.RADII.map((r) => L.decodeState(`?r=${r}`).r), [100, 250, 500, 1000, 2500]);
eq('the radii, as offered', L.RADII, [100, 250, 500, 1000, 2500]);
eq('a long name is clipped to 120', L.decodeState(`?near=${'x'.repeat(300)}`).near.length, 120);
eq('ago at each boundary', [89.9e3, 90e3, 90.5e3, 59.4 * 60e3, 59.5 * 60e3, 60 * D, 59.4 * D, 731 * D, 700 * D].map((t) => L.ago(now - t, now)),
  ['just now', '2 min ago', '2 min ago', '59 min ago', '1 h ago', '2 months ago', '59 days ago', '2 years ago', '23 months ago']);
eq('km labels at 10', [L.kmLabel(9.96), L.kmLabel(10), L.kmLabel(10.5)], ['10.0 km', '10 km', '11 km']);
eq('dot radii', [2, 2.5, 3, 5].map(L.dotR), [0.6, 0.6, 0.875, 1.975]);
eq('magnitudes to one place', [L.fmtMag(6.04), L.fmtMag(7)], ['6.0', '7.0']);
eq('eight places by default', L.matchPlaces(Array.from({ length: 12 }, (_, i) => [`Town${i}`, '', 'X', 0, 0, 1]), 'town').length, 8);

console.log(`${fail ? 'FAILED' : 'ok'}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
