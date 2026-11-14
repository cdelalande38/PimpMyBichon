// Enseignes néon en tubes : alphabet filaire en données, géométrie des tubes, composition des deux enseignes.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BoxGeometry, type BufferGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { describe, expect, it } from 'vitest';
import { NEON_ALPHABET, NEON_EM, NEON_SIGNS, NEON_UNKNOWN_WIDTH, type NeonSignLayout, type NeonStroke } from '../../src/data/neonAlphabet.ts';
import { neonSign, neonStrokes, type NeonSignOptions } from '../../src/scene/garage/neon.ts';

type Pt = [number, number];

/** Échantillonnage fin d'un trait de l'alphabet (indépendant de neon.ts). */
function sample(stroke: NeonStroke): Pt[] {
  let [x, y] = stroke.from;
  const out: Pt[] = [[x, y]];
  for (const s of stroke.path) {
    if ('line' in s) {
      const [x1, y1] = s.line;
      for (let i = 1; i <= 20; i += 1) out.push([x + ((x1 - x) * i) / 20, y + ((y1 - y) * i) / 20]);
      [x, y] = [x1, y1];
    } else if ('arc' in s) {
      const [cx, cy, r, a0, a1] = s.arc;
      const n = Math.ceil(Math.abs(a1 - a0) / 2);
      for (let i = 1; i <= n; i += 1) {
        const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
        out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
      }
      [x, y] = out[out.length - 1]!;
    } else {
      const [x1, y1, x2, y2, x3, y3] = s.cubic;
      for (let i = 1; i <= 40; i += 1) {
        const t = i / 40;
        const m = 1 - t;
        out.push([
          m * m * m * x + 3 * m * m * t * x1 + 3 * m * t * t * x2 + t * t * t * x3,
          m * m * m * y + 3 * m * m * t * y1 + 3 * m * t * t * y2 + t * t * t * y3,
        ]);
      }
      [x, y] = [x3, y3];
    }
  }
  if (stroke.closed) out.push([...stroke.from] as Pt);
  return out;
}

const distToSegment = (p: Pt, a: Pt, b: Pt): number => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};
const distToPolylines = (p: Pt, lines: readonly Pt[][]): number => {
  let best = Infinity;
  for (const line of lines) for (let i = 1; i < line.length; i += 1) best = Math.min(best, distToSegment(p, line[i - 1]!, line[i]!));
  return best;
};

/** Échantillonne les segments M/L/C (sortie de `lire` de traces.mjs). */
function sampleTraces(segs: (string | number)[][]): Pt[][] {
  const lines: Pt[][] = [];
  let cur: Pt[] = [];
  let start: Pt = [0, 0];
  for (const seg of segs) {
    const [cmd, ...v] = seg as [string, ...number[]];
    const last = cur[cur.length - 1];
    if (cmd === 'M') {
      if (cur.length > 1) lines.push(cur);
      start = [v[0]!, v[1]!];
      cur = [start];
    } else if (cmd === 'L') cur.push([v[0]!, v[1]!]);
    else if (cmd === 'Z') cur.push(start);
    else if (cmd === 'C' && last) {
      for (let i = 1; i <= 40; i += 1) {
        const t = i / 40;
        const m = 1 - t;
        const b = (k: number) => m * m * m * last[k]! + 3 * m * m * t * v[k]! + 3 * m * t * t * v[k + 2]! + t * t * t * v[k + 4]!;
        cur.push([b(0), b(1)]);
      }
    }
  }
  if (cur.length > 1) lines.push(cur);
  return lines;
}

// traces.mjs est un outil d'assets-src : importé par un chemin calculé, hors du typage du projet.
const traces = (async () => {
  const url = pathToFileURL(resolve('assets-src/garage/outils/traces.mjs')).href;
  return (await import(/* @vite-ignore */ url)) as {
    ALPHABET: Record<string, [number, string]>;
    lire: (d: string) => (string | number)[][];
  };
})();

const optionsOf = (layout: NeonSignLayout): NeonSignOptions => ({
  capHeight: layout.capHeight,
  slant: layout.slant,
  align: layout.align,
  ornaments: layout.ornaments,
});

const SIGNS: readonly [name: string, svg: string][] = [
  ['neon_pimpmybichon', 'neon-pimp-my-bichon.svg'],
  ['neon_good_vibes', 'neon-good-vibes-only.svg'],
];

function vertexCheck(geometry: BufferGeometry, fn: (x: number, y: number, z: number, i: number) => void): void {
  const pos = geometry.getAttribute('position');
  for (let i = 0; i < pos.count; i += 1) fn(pos.getX(i), pos.getY(i), pos.getZ(i), i);
}

describe('alphabet filaire', () => {
  it('chaque caractère a des traits finis dans son cadratin', () => {
    const chars = Object.keys(NEON_ALPHABET);
    expect(chars.length).toBeGreaterThanOrEqual(26 + 10 + 4);
    for (const char of chars) {
      const glyph = NEON_ALPHABET[char]!;
      expect(Number.isFinite(glyph.width) && glyph.width >= 0, char).toBe(true);
      expect(glyph.strokes.length, char).toBeGreaterThan(0);
      for (const stroke of glyph.strokes) {
        for (const [x, y] of sample(stroke)) {
          expect(Number.isFinite(x) && Number.isFinite(y), char).toBe(true);
          expect(x, char).toBeGreaterThanOrEqual(-NEON_EM.side);
          expect(x, char).toBeLessThanOrEqual(glyph.width + NEON_EM.side);
          expect(y, char).toBeGreaterThanOrEqual(NEON_EM.bottom);
          expect(y, char).toBeLessThanOrEqual(NEON_EM.top);
        }
      }
    }
  });

  it('reprend traces.mjs sans le déformer (mêmes caractères, mêmes chasses, mêmes tracés)', async () => {
    const { ALPHABET, lire } = await traces;
    expect(Object.keys(NEON_ALPHABET).sort()).toEqual(Object.keys(ALPHABET).sort());
    for (const [char, [width, d]] of Object.entries(ALPHABET)) {
      const glyph = NEON_ALPHABET[char]!;
      expect(glyph.width, char).toBeCloseTo(width / 100, 6);
      const source = sampleTraces(lire(d)).map((line) => line.map(([x, y]): Pt => [x / 100, (100 - y) / 100]));
      const ours = glyph.strokes.map(sample);
      // Dans les deux sens, à moins de 0,4 % de la hauteur de capitale.
      for (const line of source) for (const p of line) expect(distToPolylines(p, ours), `${char} source`).toBeLessThan(0.004);
      for (const line of ours) for (const p of line) expect(distToPolylines(p, source), `${char} données`).toBeLessThan(0.004);
    }
  });
});

describe('enseignes en tubes', () => {
  for (const [name, svg] of SIGNS) {
    const layout = NEON_SIGNS[name]!;
    const sign = neonSign(layout.lines, optionsOf(layout));
    const strokes = neonStrokes(layout.lines, optionsOf(layout));
    const r = strokes.tubeRadius;

    it(`${name} : tient dans la largeur et la hauteur annoncées, centrée, décollée du mur`, () => {
      expect(sign.width).toBeCloseTo(strokes.width, 9);
      expect(sign.height).toBeCloseTo(strokes.height, 9);
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      vertexCheck(sign.geometry, (x, y, z) => {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        expect(z).toBeGreaterThanOrEqual(0.02 - 1e-6);
        expect(z).toBeLessThanOrEqual(0.02 + 2 * r + 1e-6);
      });
      expect(minX).toBeGreaterThanOrEqual(-sign.width / 2 - 1e-6);
      expect(maxX).toBeLessThanOrEqual(sign.width / 2 + 1e-6);
      expect(minY).toBeGreaterThanOrEqual(-sign.height / 2 - 1e-6);
      expect(maxY).toBeLessThanOrEqual(sign.height / 2 + 1e-6);
      // Centrée : l'encombrement réel est symétrique à une fraction de facette près.
      expect(Math.abs(minX + maxX)).toBeLessThan(r * 0.2);
      expect(Math.abs(minY + maxY)).toBeLessThan(r * 0.2);
    });

    it(`${name} : mêmes proportions que ${svg}`, async () => {
      const { lire } = await traces;
      const file = readFileSync(resolve('assets-src/garage', svg), 'utf8');
      const tube = Number(/data-tube="(\d+)"/.exec(file)?.[1]);
      const points = [...file.matchAll(/<path d="([^"]+)"/g)].flatMap((m) => sampleTraces(lire(m[1]!)).flat());
      const xs = points.map((p) => p[0]);
      const ys = points.map((p) => p[1]);
      // Une unité du fichier vaut un millimètre à la hauteur conseillée.
      const width = (Math.max(...xs) - Math.min(...xs) + tube) / 1000;
      const height = (Math.max(...ys) - Math.min(...ys) + tube) / 1000;
      expect(sign.width / width).toBeGreaterThan(0.98);
      expect(sign.width / width).toBeLessThan(1.02);
      expect(sign.height / height).toBeGreaterThan(0.98);
      expect(sign.height / height).toBeLessThan(1.02);
      expect(sign.tubes.length).toBe(new Set([...layout.lines.map((l) => l.color), ...layout.ornaments.map((o) => o.color)]).size);
    });

    it(`${name} : tubes de rayon constant (distance des sommets à la ligne centrale)`, () => {
      const lines = strokes.strokes.map((s) => {
        const pts = s.points.map(([x, y]): Pt => [x, y]);
        return s.closed ? [...pts, pts[0]!] : pts;
      });
      const zc = 0.02 + r;
      const segments = lines.flatMap((line) => line.slice(1).map((b, i): [Pt, Pt] => [line[i]!, b]));
      let worst = 0;
      vertexCheck(sign.geometry, (x, y, z) => {
        // Chaque sommet est sur la paroi d'un tronçon de ligne centrale (plan z = zc) : distance 3D égale au rayon.
        // Les tubes se touchent (barres en T, coupures, boucle du P sur son fût) : on garde le tronçon qui l'explique le mieux.
        let gap = Infinity;
        for (const [a, b] of segments) gap = Math.min(gap, Math.abs(Math.hypot(distToSegment([x, y], a, b), z - zc) - r));
        worst = Math.max(worst, gap / r);
      });
      expect(worst).toBeLessThan(0.03);
    });

    it(`${name} : faces tournées vers l'extérieur, attributs exacts, groupes complets`, () => {
      const g = sign.geometry;
      expect(Object.keys(g.attributes).sort()).toEqual(['normal', 'position', 'uv']);
      const index = g.getIndex();
      expect(index).not.toBeNull();
      const pos = g.getAttribute('position');
      const nor = g.getAttribute('normal');
      let wrong = 0;
      for (let t = 0; t < index!.count; t += 3) {
        const [a, b, c] = [index!.getX(t), index!.getX(t + 1), index!.getX(t + 2)];
        const ux = pos.getX(b) - pos.getX(a);
        const uy = pos.getY(b) - pos.getY(a);
        const uz = pos.getZ(b) - pos.getZ(a);
        const vx = pos.getX(c) - pos.getX(a);
        const vy = pos.getY(c) - pos.getY(a);
        const vz = pos.getZ(c) - pos.getZ(a);
        const nx = uy * vz - uz * vy;
        const ny = uz * vx - ux * vz;
        const nz = ux * vy - uy * vx;
        const area = Math.hypot(nx, ny, nz);
        if (area < 1e-12) continue;
        const dot = (nx * (nor.getX(a) + nor.getX(b) + nor.getX(c)) + ny * (nor.getY(a) + nor.getY(b) + nor.getY(c)) + nz * (nor.getZ(a) + nor.getZ(b) + nor.getZ(c))) / area;
        if (dot <= 0) wrong += 1;
      }
      expect(wrong).toBe(0);
      for (let i = 0; i < nor.count; i += 1) expect(Math.hypot(nor.getX(i), nor.getY(i), nor.getZ(i))).toBeCloseTo(1, 5);
      const covered = g.groups.reduce((sum, group) => sum + group.count, 0);
      expect(covered).toBe(index!.count);
      expect(g.groups.map((group) => group.materialIndex)).toEqual(sign.tubes.map((tube) => tube.materialIndex));
    });

    it(`${name} : sous le budget de 9 000 triangles`, () => {
      expect(sign.triangles).toBe(sign.geometry.getIndex()!.count / 3);
      expect(sign.triangles).toBeLessThan(9000);
    });

    it(`${name} : fusionnable avec une BoxGeometry de three`, () => {
      const box = new BoxGeometry(0.1, 0.1, 0.1);
      const merged = mergeGeometries([sign.geometry, box]);
      expect(merged).not.toBeNull();
      expect(merged!.getAttribute('position').count).toBe(sign.geometry.getAttribute('position').count + box.getAttribute('position').count);
      expect(merged!.getIndex()!.count).toBe(sign.geometry.getIndex()!.count + box.getIndex()!.count);
    });
  }

  it('réglages par défaut : une ligne de texte simple tient le budget', () => {
    const sign = neonSign(['GOOD VIBES ONLY']);
    expect(sign.triangles).toBeGreaterThan(0);
    expect(sign.triangles).toBeLessThan(9000);
    expect(sign.tubes).toHaveLength(1);
  });

  it('caractère inconnu : ignoré avec sa chasse, sans erreur', () => {
    const options = { capHeight: 0.2, tracking: 0.25 };
    expect(() => neonSign(['A★B'], options)).not.toThrow();
    const known = neonStrokes(['AB'], options);
    const unknown = neonStrokes(['A★B'], options);
    expect(unknown.strokes.length).toBe(known.strokes.length);
    expect(unknown.width - known.width).toBeCloseTo((NEON_UNKNOWN_WIDTH + 0.25) * 0.2, 9);
    // Une ligne faite seulement d'inconnus ne dessine rien et ne casse rien.
    const empty = neonSign(['★★']);
    expect(empty.triangles).toBe(0);
  });

  it('minuscules passées en capitales', () => {
    expect(neonSign(['PimpMyBichon']).triangles).toBe(neonSign(['PIMPMYBICHON']).triangles);
  });

  it('options : interligne, alignement et pente changent la mise en page, pas le tube', () => {
    const base = neonStrokes(['AB', 'C']);
    expect(neonStrokes(['AB', 'C'], { lineGap: 0.6 }).height).toBeCloseTo(base.height + 0.3 * 0.18, 9);
    const left = neonStrokes(['AB', 'C'], { align: 'left' });
    const xmin = (s: typeof left, i: number) => Math.min(...s.strokes[i]!.points.map((p) => p[0]));
    // Aligné à gauche : le « A » et le « C » commencent au même bord.
    expect(xmin(left, 0)).toBeCloseTo(xmin(left, left.strokes.length - 1), 2);
    const slanted = neonSign(['I'], { slant: 9 });
    expect(slanted.width).toBeCloseTo(0.18 * Math.tan((9 * Math.PI) / 180) + 2 * 0.008, 6);
  });
});
