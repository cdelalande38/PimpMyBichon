// Œuvres du garage : registre, fichiers servis par l'app, préparation des SVG avant le canvas.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GARAGE } from '../../src/data/garage.ts';
import {
  ART_DIR,
  ART_MAX_RESOLUTION,
  artPixels,
  artRect,
  artSize,
  GARAGE_ART,
  garageArt,
} from '../../src/data/garageArt.ts';
import { artworkUrl, prepareSvg } from '../../src/scene/garage/artwork.ts';

const PUBLIC_ART = `public/${ART_DIR}`;
const POIDS_MAX = 40 * 1024;

function lire(file: string): string {
  return readFileSync(`public/${file}`, 'utf8');
}

function viewBox(texte: string): [number, number] {
  const match = /<svg\b[^>]*\sviewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(texte);
  if (!match) throw new Error('viewBox absent');
  return [Number(match[1]), Number(match[2])];
}

describe('registre des œuvres du garage', () => {
  it('identifiants uniques, un fichier par œuvre sous le dossier servi', () => {
    const ids = GARAGE_ART.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of GARAGE_ART) {
      expect(item.file).toBe(`${ART_DIR}${item.id}.svg`);
      expect(existsSync(`public/${item.file}`), item.file).toBe(true);
      expect(garageArt(item.id)).toBe(item);
    }
  });

  it('aucun fichier servi hors du registre, aucune enseigne néon copiée', () => {
    const servis = readdirSync(PUBLIC_ART).filter((nom) => nom.endsWith('.svg'));
    expect(servis.sort()).toEqual(GARAGE_ART.map((item) => `${item.id}.svg`).sort());
    expect(servis.some((nom) => nom.startsWith('neon'))).toBe(false);
  });

  it('chaque fichier servi est la copie exacte de sa source dans assets-src/garage/', () => {
    for (const item of GARAGE_ART) {
      expect(lire(item.file), item.id).toBe(readFileSync(`assets-src/garage/${item.id}.svg`, 'utf8'));
    }
  });

  it('le rapport et la taille réelle correspondent au viewBox du fichier', () => {
    for (const item of GARAGE_ART) {
      const [w, h] = viewBox(lire(item.file));
      expect(item.viewBox, item.id).toEqual([w, h]);
      expect(item.ratio, item.id).toBeCloseTo(w / h, 6);
      expect(item.size[0] / item.size[1], item.id).toBeCloseTo(w / h, 6);
    }
  });

  it('résolution conseillée de 1024 px au plus, matière décrite', () => {
    for (const item of GARAGE_ART) {
      expect(item.resolution, item.id).toBeGreaterThanOrEqual(128);
      expect(item.resolution, item.id).toBeLessThanOrEqual(ART_MAX_RESOLUTION);
      if (item.lighting === 'emissive') expect(item.glow, item.id).toBeGreaterThan(0);
      else expect(item.glow, item.id).toBeUndefined();
      if (item.waiting !== null) expect(item.waiting, item.id).toMatch(/^#[0-9a-f]{6}$/i);
      // Une œuvre opaque a toujours une teinte d'attente, posée aussi sous le dessin.
      if (!item.transparent) expect(item.waiting, item.id).not.toBeNull();
    }
  });

  it('les cases tiennent dans le viewBox, une note de place pour toute œuvre sans case', () => {
    for (const item of GARAGE_ART) {
      const regions = item.regions ?? [];
      expect(new Set(regions.map((region) => region.id)).size, item.id).toBe(regions.length);
      if (!item.place) expect(regions.length, item.id).toBeGreaterThan(0);
      for (const region of regions) {
        const [x, y, w, h] = region.rect;
        expect(x >= 0 && y >= 0 && w > 0 && h > 0, region.id).toBe(true);
        expect(x + w, region.id).toBeLessThanOrEqual(item.viewBox[0]);
        expect(y + h, region.id).toBeLessThanOrEqual(item.viewBox[1]);
      }
    }
  });

  it('œuvres posées par les objets : œuvre et case connues, plan dans la pièce, largeur sensée', () => {
    const { width, depth, height } = GARAGE.room;
    const slots = GARAGE.props.flatMap((prop) => (prop.art ?? []).map((slot) => ({ prop, slot })));
    expect(slots.length).toBeGreaterThan(0);
    for (const { prop, slot } of slots) {
      const label = `${prop.name} / ${slot.art}${slot.region ? `#${slot.region}` : ''}`;
      const item = garageArt(slot.art);
      expect(() => artRect(item, slot.region), label).not.toThrow();
      expect(slot.width, label).toBeGreaterThan(0.02);
      expect(slot.width, label).toBeLessThan(2);
      // Centre du plan dans la pièce : repère local, puis `turn` et `at` de l'objet.
      const turn = prop.turn ?? 0;
      const [lx, ly, lz] = slot.at;
      const x = prop.at[0] + lx * Math.cos(turn) + lz * Math.sin(turn);
      const z = prop.at[2] - lx * Math.sin(turn) + lz * Math.cos(turn);
      const y = prop.at[1] + ly;
      expect(Math.abs(x) <= width / 2 && Math.abs(z) <= depth / 2 && y > 0 && y < height, label).toBe(true);
    }
  });

  it('la toile est un portrait 3:4', () => {
    expect(garageArt('toile-pop-art').ratio).toBeCloseTo(3 / 4, 6);
  });

  it('taille et pixels d’une case suivent la densité de l’œuvre entière', () => {
    const plaques = garageArt('plaques-deco');
    const [w, h] = artSize(plaques, 'plaque-1');
    expect(w).toBeCloseTo(0.4, 6);
    expect(h).toBeCloseTo(0.2, 6);
    expect(artPixels(plaques)).toEqual([328, 512]);
    expect(artPixels(plaques, 'plaque-1')).toEqual([307, 154]);
    expect(artPixels(garageArt('casque-motifs'), 'casque-crane')).toEqual([256, 224]);
    // La résolution demandée ne dépasse jamais le plafond.
    expect(Math.max(...artPixels(garageArt('cible'), undefined, 4096))).toBe(ART_MAX_RESOLUTION);
    expect(artRect(plaques)).toEqual([0, 0, 640, 1000]);
    expect(() => artRect(plaques, 'plaque-9')).toThrow();
  });
});

describe('fichiers servis : contenu', () => {
  for (const item of GARAGE_ART) {
    it(`${item.file} : 40 ko au plus, ni texte, ni image, ni lien externe`, () => {
      const chemin = `public/${item.file}`;
      expect(statSync(chemin).size).toBeLessThanOrEqual(POIDS_MAX);
      const texte = lire(item.file);
      expect(texte).not.toMatch(/<text[\s>]|<tspan|font-family|@font-face/);
      expect(texte).not.toMatch(/<image[\s>]|<foreignObject|<script|data:/);
      const liens = [...texte.matchAll(/(?:href|src)="([^"]*)"/g)].map((m) => m[1] ?? '');
      expect(liens.filter((lien) => !lien.startsWith('#'))).toEqual([]);
      expect(texte).not.toMatch(/url\((?!#)/);
      // Le seul « http » admis est l'espace de noms du SVG.
      expect(texte.replaceAll('http://www.w3.org/2000/svg', '')).not.toMatch(/https?:/);
    });
  }
});

describe('préparation d’un SVG pour le canvas', () => {
  const source = '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 1000" width="640" height="1000">\n<g/></svg>';

  it('recadre le viewBox sur la case et fixe la taille en pixels', () => {
    const texte = prepareSvg(source, [20, 335, 600, 300], 307, 154);
    expect(texte).toContain('viewBox="20 335 600 300"');
    expect(texte).toContain('width="307" height="154"');
    expect(texte).toContain('preserveAspectRatio="none"');
    expect(texte.match(/viewBox=/g)).toHaveLength(1);
    expect(texte.startsWith('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox')).toBe(true);
    expect(texte.endsWith('\n<g/></svg>')).toBe(true);
  });

  it('garde les autres attributs de la racine, refuse un texte sans <svg>', () => {
    const texte = prepareSvg(lire(garageArt('toile-pop-art').file), [0, 0, 768, 1024], 576, 768);
    expect(texte).toContain('width="576" height="768"');
    expect(texte).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(() => prepareSvg('<div/>', [0, 0, 1, 1], 1, 1)).toThrow();
  });

  it('l’adresse suit la base de l’app, jamais un autre domaine', () => {
    const toile = garageArt('toile-pop-art');
    expect(artworkUrl(toile, '/PimpMyBichon/')).toBe('/PimpMyBichon/assets/garage/art/toile-pop-art.svg');
    expect(artworkUrl(toile, './')).toBe('./assets/garage/art/toile-pop-art.svg');
    expect(artworkUrl(toile, '/base')).toBe('/base/assets/garage/art/toile-pop-art.svg');
  });
});
