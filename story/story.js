/* The scrolling story: each <section class="step"> names a layout in data-step; as the
 * reader scrolls into a step, the marks move to their place in that layout. Numbers in
 * the prose are not typed in: a <b data-fact="..."> is computed here from story.json's
 * rows, and test/story.test.mjs checks each against the `check` block build_story.py
 * computed in python. Modelled on stanford-outlines/site/story. */
import { layout, isFar, signed, STEPS, SERIES, YMAX, COL } from './layout.js';

const fmt = (n) => n.toLocaleString('en-US');
const pct = (v) => `${(v * 100).toFixed(1)}%`;
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

export function numbers(D) {
  const far = D.rot.filter((r) => isFar(D, r[0]));
  const real = D.rot.find((r) => r[0] === 0);
  const col = (r, s) => r[SERIES[s]];
  const beat = (s) => far.filter((r) => col(r, s) >= col(real, s));
  const C = Object.values(D.countries);
  return {
    n_quakes: D.quakes.length, n_far: far.length,
    n_big: D.towns.length, n_big_near: D.towns.filter((t) => t[5]).length,
    p: C.reduce((t, c) => t + c[1], 0) / C.reduce((t, c) => t + c[0], 0),
    p_rot: real[2],
    land: real[1], land_med: median(far.map((r) => r[1])), beaten_land: beat('land').length,
    p_med: median(far.map((r) => r[2])), p_max: Math.max(...far.map((r) => r[2])),
    beaten: beat('p').length, beaten_by: beat('p').map((r) => Math.abs(signed(r[0]))),
    pCN: real[3], pCN_max: Math.max(...far.map((r) => r[3])), beatenCN: beat('pCN').length,
    pJP: real[4], pJP_med: median(far.map((r) => r[4])), beatenJP: beat('pJP').length,
  };
}

/* "p" -> "19.0%". Unknown names throw: a typo must not render as blank */
export function fact(D, spec) {
  const N = numbers(D);
  switch (spec) {
    case 'n_quakes': return fmt(N.n_quakes);
    case 'years': return `${D.years[0]} to ${D.years[1]}`;
    case 'R': return `${D.R} km`;
    case 'p': return pct(N.p);
    case 'land': return pct(N.land);
    case 'land_med': return pct(N.land_med);
    case 'beaten_land': return fmt(N.beaten_land);
    case 'n_far': return fmt(N.n_far);
    case 'near': return `${D.near}°`;
    case 'slide': return `${D.slide}°`;
    case 'p_med': return pct(N.p_med);
    case 'beaten': return fmt(N.beaten);
    case 'beaten_by': return [...new Set(N.beaten_by)].sort((a, b) => a - b).map((v) => `${v}°`).join(' or ');
    case 'pCN': return pct(N.pCN);
    case 'pCN_max': return pct(N.pCN_max);
    case 'pJP': return pct(N.pJP);
    case 'pJP_med': return pct(N.pJP_med);
    case 'beatenJP': return fmt(N.beatenJP);
    case 'n_big': return fmt(N.n_big);
    case 'n_big_near': return fmt(N.n_big_near);
    case 'big': return fmt(D.big);
    default: throw new Error(`unknown fact ${spec}`);
  }
}

const town = (D, n) => D.towns.findIndex((t) => t[0] === n);
/* labelled towns per map step: (D) -> [[index into D.towns, text]] */
export const LABELS = {
  quakes: () => [],
  people: (D) => [[town(D, 'Tokyo'), 'Tokyo'], [town(D, 'Istanbul'), 'Istanbul'], [town(D, 'Lima'), 'Lima'], [town(D, 'Shanghai'), 'Shanghai']],
};

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };

async function main() {
  const [D, world] = await Promise.all([fetch('story.json'), fetch('../data/world.json')].map((p) => p.then((r) => r.json())));
  for (const e of document.querySelectorAll('[data-fact]')) e.textContent = fact(D, e.dataset.fact);
  for (const name of Object.keys(LABELS)) for (const [i] of LABELS[name](D)) if (i < 0) throw new Error(`label town missing on ${name}`);

  const steps = [...document.querySelectorAll('.step')];
  for (const s of steps) if (!STEPS[s.dataset.step]) throw new Error(`unknown step ${s.dataset.step}`);
  const plot = document.getElementById('plot');
  const svg = el('svg', { id: 'chart' });
  const land = el('path', { d: world.land, class: 'land' });
  const gLand = el('g', { class: 'basemap' }), gAxis = el('g', { class: 'axis' }), gQ = el('g', { class: 'quakes' }), gT = el('g'), gR = el('g'), gLab = el('g', { class: 'labels' });
  // Antarctica runs below the map's 58S edge: clip the land to the plot
  const clip = el('clipPath', { id: 'box' }), clipR = el('rect', { x: 0, y: 0, width: 0, height: 0 });
  clip.append(clipR);
  const defs = el('defs'); defs.append(clip);
  gLand.setAttribute('clip-path', 'url(#box)');
  gLand.append(land);
  svg.append(defs, gLand, gAxis, gQ, gT, gR, gLab);
  plot.append(svg);
  const qDots = D.quakes.map(() => gQ.appendChild(el('circle')));
  const tDots = D.towns.map((t) => {
    const c = gT.appendChild(el('circle', { r: 0 }));
    c.append(el('title'));
    c.firstChild.textContent = `${t[0]}, ${t[1]}: ${fmt(t[4])} people, ${t[5] ? 'an M6+ within' : 'no M6+ within'} ${D.R} km since ${D.years[0]}`;
    return c;
  });
  const rDots = D.rot.map((r) => {
    const c = gR.appendChild(el('circle', { r: 0 }));
    c.append(el('title'));
    c.firstChild.textContent = r[0] === 0 ? 'the real map' : `every quake slid ${Math.abs(signed(r[0]))}° ${signed(r[0]) > 0 ? 'east' : 'west'}`;
    return c;
  });
  const tick = (x, y, text, cls = 'tick') => { const t = el('text', { x, y, class: cls }); t.textContent = text; gAxis.append(t); };

  let shown = -1, mapDrawn = '';
  const draw = (i) => {
    const name = steps[i].dataset.step;
    const box = plot.getBoundingClientRect(), W = box.width, H = box.height;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const L = layout(name, D, W, H);
    const isMap = L.kind === 'map';
    // the quakes never move, so place them once per plot size and only fade them after
    if (isMap && mapDrawn !== `${W}x${H}`) {
      L.quakes.forEach((d, k) => { const c = qDots[k]; c.setAttribute('cx', d.x); c.setAttribute('cy', d.y); c.setAttribute('r', d.r); });
      clipR.setAttribute('width', W); clipR.setAttribute('height', L.Y(-58) + 1);
      land.setAttribute('transform', `translate(${L.X(0)} ${L.Y(0)}) scale(${L.s})`);
      mapDrawn = `${W}x${H}`;
    }
    gQ.style.opacity = isMap ? L.quakes[0].op : 0;
    gLand.style.opacity = isMap ? 1 : 0;
    for (const [dots, lay] of [[tDots, L.towns], [rDots, L.rots]]) lay.forEach((d, k) => {
      const c = dots[k];
      c.style.transform = `translate(${d.x}px, ${d.y}px)`;
      c.setAttribute('r', d.r);
      c.style.fill = d.fill;
      c.style.opacity = d.op;
    });
    gAxis.replaceChildren();
    if (isMap) {
      for (const lon of [-120, -60, 0, 60, 120]) tick(L.X(lon), Math.min(H + 14, L.Y(-58) + 14), lon === 0 ? '0°' : `${Math.abs(lon)}°${lon < 0 ? 'W' : 'E'}`, 'tick mid');
    } else {
      for (let v = 0; v <= YMAX + 1e-9; v += 0.05) {
        gAxis.append(el('line', { x1: 0, x2: W, y1: L.Y(v), y2: L.Y(v), class: 'grid' }));
        tick(-6, L.Y(v) + 4, `${Math.round(v * 100)}%`, 'tick end');
      }
      for (const o of [-180, -90, 0, 90, 180]) tick(L.Xs(o), H + 16, o === 0 ? 'real map' : `${Math.abs(o)}° ${o < 0 ? 'W' : 'E'}`, 'tick mid');
      tick(W / 2, H + 32, 'every quake slid west or east by', 'tick mid');
      gAxis.append(el('rect', { x: L.Xs(-D.near), width: L.Xs(D.near) - L.Xs(-D.near), y: 0, height: H, class: 'band' }));
    }
    gLab.replaceChildren();
    const labs = isMap ? (LABELS[name] || (() => []))(D).map(([k, text]) => [L.towns[k], text])
      : [[L.rots[0], 'the real map']];
    for (const [d, text] of labs) {
      gLab.append(el('circle', { cx: d.x, cy: d.y, r: d.r + 2.5, class: 'ring' }));
      const right = d.x < W * 0.6;
      const tx = el('text', { x: d.x + (right ? 1 : -1) * (d.r + 5), y: d.y - d.r - 3, class: `lab${right ? '' : ' end'}` });
      tx.textContent = text;
      gLab.append(tx);
    }
    document.body.dataset.step = i;
    window.__story = { step: i, name, shown: (isMap ? L.towns : L.rots).filter((d) => d.op > 0).length + (isMap ? L.quakes.length : 0) };
  };

  const pick = () => {
    const line = innerHeight * 0.5;
    let i = 0;
    for (let k = 0; k < steps.length; k++) if (steps[k].getBoundingClientRect().top < line) i = k;
    if (i !== shown) { shown = i; draw(i); }
  };
  addEventListener('scroll', pick, { passive: true });
  addEventListener('resize', () => { shown = -1; pick(); });
  pick();
}

export { COL };

if (typeof document !== 'undefined') main().catch((e) => {
  document.body.classList.add('failed');
  document.getElementById('err').textContent = String(e.message || e);
  console.error(e);
});
