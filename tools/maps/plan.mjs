// @ts-check
// Plan vu de dessus et profil en long d'une carte fabriquée, pour juger le tracé sans la scène de
// l'app : captures/cartes/<id>/plan.png et profil.png (dossier ignoré par git).
//
//   node tools/maps/plan.mjs <id>        (après npm run maps:build)

import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { pentes, rayons } from './trace.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** @param {string} id */
export async function dessiner(id) {
  const d = JSON.parse(readFileSync(join(ROOT, 'assets-src', 'maps', id, 'donnees.json'), 'utf8'));
  const r = JSON.parse(readFileSync(join(ROOT, 'public', 'assets', 'maps', id, 'route.json'), 'utf8'));
  const out = join(ROOT, 'captures', 'cartes', id);
  mkdirSync(out, { recursive: true });
  const rail = [];
  for (let i = 0; i < r.rail.length; i += 3) rail.push([r.rail[i], r.rail[i + 1], r.rail[i + 2]]);
  const xs = rail.map((p) => p[0]);
  const zs = rail.map((p) => p[2]);
  const m = 400;
  const x0 = Math.min(...xs) - m;
  const x1 = Math.max(...xs) + m;
  const z0 = Math.min(...zs) - m;
  const z1 = Math.max(...zs) + m;
  const H = 1600;
  const k = H / (z1 - z0);
  const W = Math.round((x1 - x0) * k);
  /** @param {number} x @param {number} z */
  const P = (x, z) => `${((x - x0) * k).toFixed(1)},${((z - z0) * k).toFixed(1)}`;
  const parts = [`<rect width="${W}" height="${H}" fill="#14161a"/>`];
  for (const l of d.lacs)
    for (const a of l.anneaux) {
      const pts = [];
      for (let i = 0; i < a.length; i += 2) pts.push(P(a[i], a[i + 1]));
      parts.push(`<polygon points="${pts.join(' ')}" fill="#1f4f6e" stroke="#3a7fa8" stroke-width="1"/>`);
    }
  for (const v of d.voisines) {
    const pts = [];
    for (let i = 0; i < v.points.length; i += 3) pts.push(P(v.points[i], v.points[i + 2]));
    parts.push(`<polyline points="${pts.join(' ')}" fill="none" stroke="#5a5d63" stroke-width="1"/>`);
  }
  for (const b of d.batiments) {
    const pts = [];
    for (let i = 0; i < b.a.length; i += 2) pts.push(P(b.a[i], b.a[i + 1]));
    parts.push(`<polygon points="${pts.join(' ')}" fill="#9a8f80"/>`);
  }
  for (const s of r.sections) {
    const pts = [];
    for (let i = Math.round(s.from / r.step); i <= Math.round(s.to / r.step); i += 2) pts.push(P(rail[i]?.[0] ?? 0, rail[i]?.[2] ?? 0));
    const c = s.ground === 'pont' ? '#ff4d4d' : s.urban ? '#ffb347' : '#f2f2f2';
    parts.push(`<polyline points="${pts.join(' ')}" fill="none" stroke="${c}" stroke-width="${s.ground === 'pont' ? 5 : 2.5}"/>`);
  }
  for (const c of r.chunks) {
    const p = rail[Math.round(c.from / r.step)] ?? [0, 0, 0];
    parts.push(`<circle cx="${P(p[0], p[2]).split(',')[0]}" cy="${P(p[0], p[2]).split(',')[1]}" r="3" fill="#7fd1ff"/>`);
  }
  for (const s of r.starts) {
    const p = rail[Math.round(s.at / r.step)] ?? [0, 0, 0];
    const [cx, cy] = P(p[0], p[2]).split(',');
    parts.push(`<circle cx="${cx}" cy="${cy}" r="7" fill="#ff3fa4"/><text x="${Number(cx) + 10}" y="${Number(cy) + 5}" fill="#ff8fcb" font-size="18" font-family="sans-serif">${s.label} (${(s.at / 1000).toFixed(1)} km)</text>`);
  }
  // Échelle : 1 km.
  parts.push(`<line x1="20" y1="${H - 30}" x2="${20 + 1000 * k}" y2="${H - 30}" stroke="#fff" stroke-width="3"/><text x="20" y="${H - 40}" fill="#fff" font-size="16" font-family="sans-serif">1 km — nord en haut</text>`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${parts.join('')}</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(join(out, 'plan.png'));

  // Profil en long : altitude du rail, terrain nu au droit de l'axe, pente et rayons serrés.
  const PW = 1600;
  const PH = 600;
  const ys = rail.map((p) => p[1]);
  const y0 = Math.min(...ys) - 10;
  const y1 = Math.max(...ys) + 10;
  /** @param {number} s @param {number} y */
  const Q = (s, y) => `${((s / r.length) * (PW - 80) + 60).toFixed(1)},${(PH - 60 - ((y - y0) / (y1 - y0)) * (PH - 120)).toFixed(1)}`;
  const pp = [`<rect width="${PW}" height="${PH}" fill="#14161a"/>`];
  for (const s of r.sections) if (s.urban) pp.push(`<rect x="${Q(s.from, 0).split(',')[0]}" y="40" width="${((s.to - s.from) / r.length) * (PW - 80)}" height="${PH - 100}" fill="#3a2f1c"/>`);
  for (const l of d.lacs) if (l.y > y0 && l.y < y1) pp.push(`<line x1="60" x2="${PW - 20}" y1="${Q(0, l.y).split(',')[1]}" y2="${Q(0, l.y).split(',')[1]}" stroke="#2f6f96" stroke-dasharray="6 6"/><text x="${PW - 300}" y="${Number(Q(0, l.y).split(',')[1]) - 4}" fill="#5fa8d3" font-size="13" font-family="sans-serif">${l.nom}</text>`);
  pp.push(`<polyline points="${rail.map((p, i) => Q(i * r.step, p[1] ?? 0)).join(' ')}" fill="none" stroke="#f2f2f2" stroke-width="2"/>`);
  const pe = pentes(rail, Math.round(10 / r.step));
  const ra = rayons(rail, Math.round(10 / r.step));
  rail.forEach((_, i) => {
    if (Math.abs(pe[i] ?? 0) > 0.08 && i % 5 === 0) pp.push(`<circle cx="${Q(i * r.step, 0).split(',')[0]}" cy="${PH - 45}" r="2" fill="#ff4d4d"/>`);
    if ((ra[i] ?? Infinity) < 60 && i % 3 === 0) pp.push(`<circle cx="${Q(i * r.step, 0).split(',')[0]}" cy="${PH - 30}" r="2" fill="#ffd34d"/>`);
  });
  const alt0 = d.repere.altitude;
  for (let y = Math.ceil((y0 + alt0) / 50) * 50; y < y1 + alt0; y += 50) pp.push(`<text x="4" y="${Number(Q(0, y - alt0).split(',')[1]) + 4}" fill="#aaa" font-size="12" font-family="sans-serif">${y} m</text>`);
  for (let s = 0; s <= r.length; s += 1000) pp.push(`<text x="${Number(Q(s, 0).split(',')[0]) - 8}" y="${PH - 8}" fill="#aaa" font-size="12" font-family="sans-serif">${s / 1000}</text>`);
  pp.push(`<text x="60" y="26" fill="#ddd" font-size="16" font-family="sans-serif">Profil en long (km, altitude) — fond ocre : agglomération ; points rouges : pente &gt; 8 % ; points jaunes : rayon &lt; 60 m</text>`);
  await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${PW}" height="${PH}">${pp.join('')}</svg>`)).png().toFile(join(out, 'profil.png'));
  return [join(out, 'plan.png'), join(out, 'profil.png')];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const id = process.argv[2];
  if (!id) {
    console.error('usage : node tools/maps/plan.mjs <id>');
    process.exitCode = 2;
  } else for (const f of await dessiner(id)) console.log(`→ ${relative(ROOT, f)}`);
}
