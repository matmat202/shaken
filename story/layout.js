/* Where every mark sits on each step of the story. Pure: no DOM, so test/story.test.mjs
 * runs every layout at several plot sizes.
 *
 * Map steps: the world, longitude across, latitude up (equirectangular, 58S to 80N): one
 * dot per M6+ quake, and the million-plus towns, red when a quake struck within R km.
 * Chart steps: one dot per slide of the whole quake map east by k degrees (k = 0 is the
 * real map), at the share it gives; which share depends on the step.
 */
export const COL = { quake: '#d4561f', ink: '#1d1a18', near: '#a8321a', far: '#8a857e', faint: '#cfcac3', real: '#a8321a' };
export const LAT = [-58, 80];

/* slide k (0..355) as a signed offset, -175..180, so the real map sits mid-chart */
export const signed = (k) => (k > 180 ? k - 360 : k);
export const isFar = (D, k) => k >= D.near && k <= 360 - D.near;
/* rot row columns */
export const SERIES = { land: 1, p: 2, pCN: 3, pJP: 4 };

/* step -> [kind, what it shows] */
export const STEPS = {
  quakes: ['map', 'quakes'],
  people: ['map', 'towns'],
  land: ['chart', 'land'],
  slide: ['chart', 'p'],
  nochina: ['chart', 'pCN'],
};

export const YMAX = 0.25;

/* -> {kind, X, Y, quakes: [{x,y,r,op}], towns: [{x,y,r,fill,op}], rots: [{x,y,r,fill,op}]} in px of w x h */
export function layout(name, D, w, h) {
  const [kind, what] = STEPS[name] || (() => { throw new Error(`unknown step ${name}`); })();
  const pad = 8;
  if (kind === 'map') {
    const s = Math.min((w - 2 * pad) / 360, (h - 2 * pad) / (LAT[1] - LAT[0]));
    const ox = (w - 360 * s) / 2, oy = (h - (LAT[1] - LAT[0]) * s) / 2;
    const X = (lon) => ox + (lon + 180) * s, Y = (lat) => oy + (LAT[1] - Math.max(LAT[0], Math.min(LAT[1], lat))) * s;
    const qr = Math.max(0.7, s * 0.28);
    const quakes = D.quakes.map(([lat, lon, m]) => ({ x: X(lon), y: Y(lat), r: qr * (m >= 7 ? 1.6 : 1), op: what === 'quakes' ? 0.55 : 0.16 }));
    const top = D.towns[0][4];
    const towns = D.towns.map(([, , lat, lon, pop, near]) => ({
      x: X(lon), y: Y(lat), r: Math.max(1.2, Math.sqrt(pop / top) * s * 2.2),
      fill: near ? COL.near : COL.far, op: what === 'towns' ? 0.9 : 0,
    }));
    return { kind, X, Y, s, quakes, towns, rots: D.rot.map(() => ({ x: w / 2, y: h - pad, r: 0, fill: COL.faint, op: 0 })) };
  }
  const col = SERIES[what];
  const Xs = (o) => pad + ((o + 180) / 360) * (w - 2 * pad); // o: signed offset, -180..180
  const X = (k) => Xs(signed(k));
  const Y = (v) => h - pad - (v / YMAX) * (h - 2 * pad);
  const r = Math.max(2.5, Math.min(6, w / 150));
  const rots = D.rot.map((row) => ({
    x: X(row[0]), y: Y(row[col]), r: row[0] === 0 ? r * 1.5 : r,
    fill: row[0] === 0 ? COL.real : isFar(D, row[0]) ? COL.ink : COL.faint, op: 1,
  }));
  const none = () => ({ x: w / 2, y: h / 2, r: 0, op: 0, fill: COL.faint });
  return { kind, X, Xs, Y, col, quakes: D.quakes.map(none), towns: D.towns.map(none), rots };
}
