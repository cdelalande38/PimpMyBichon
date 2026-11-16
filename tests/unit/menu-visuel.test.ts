// Menu visuel : icônes des sections, des entrées et des volets (src/data/dockMenu.ts, src/ui/icons.tsx),
// dessins des choix tirés de leurs paramètres (src/ui/pictos/), miniature du tracé des cartes
// (tools/maps/apercu.mjs). Aucun identifiant de véhicule ni de carte dans les dessins.

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DOCK_MENU } from '../../src/data/dockMenu.ts';
import { FINISHES } from '../../src/data/finishes.ts';
import { INTERIOR_CATALOGUE } from '../../src/data/habitacle.ts';
import { WHEEL_CATALOGUE } from '../../src/data/wheels.ts';
import { lireApercu } from '../../src/ui/pictos/carte.ts';
import { dessinAssiette, dessinEtoiles, dessinJante, dessinPneu, dessinPommeau, dessinSiege, dessinVolant, sphere } from '../../src/ui/pictos/dessins.ts';
import { apercu } from '../../tools/maps/apercu.mjs';

const ROOT = new URL('../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), 'utf8');

describe('icônes du menu', () => {
  it('chaque section et chaque entrée nomme une icône dessinée dans src/ui/icons.tsx', () => {
    const icons = read('src/ui/icons.tsx');
    const drawn = (name: string) => new RegExp(`^\\s+${name}: \\(?`, 'm').test(icons) || name === 'radio';
    for (const section of DOCK_MENU) {
      expect(section.icon, section.label).toBeDefined();
      expect(drawn(section.icon as string), `${section.label} : ${section.icon}`).toBe(true);
      for (const entry of section.entries) {
        expect(entry.icon, entry.label).toBeDefined();
        expect(drawn(entry.icon as string), `${entry.label} : ${entry.icon}`).toBe(true);
      }
    }
  });

  it('les quatre sections ont chacune une icône différente', () => {
    const icons = DOCK_MENU.map((section) => section.icon);
    expect(new Set(icons).size).toBe(icons.length);
  });

  it('les icônes restent masquées aux lecteurs d’écran : le nom des boutons ne change pas', () => {
    expect(read('src/ui/icons.tsx')).toMatch(/aria-hidden="true"/);
    const pictos = read('src/ui/pictos/Pictos.tsx');
    const svgs = pictos.match(/<svg\b[^>]*>/g) ?? [];
    expect(svgs.length).toBeGreaterThan(0);
    for (const svg of svgs) expect(svg, svg).toMatch(/aria-hidden="true"/);
  });
});

describe('dessins des choix, tirés des données', () => {
  it('chaque jante, pneu, volant, pommeau et siège du catalogue a son dessin', () => {
    for (const rim of WHEEL_CATALOGUE.rims) expect(dessinJante(rim), rim.id).not.toBeNull();
    for (const tire of WHEEL_CATALOGUE.tires) expect(dessinPneu(tire), tire.id).not.toBeNull();
    for (const piece of INTERIOR_CATALOGUE.steering) expect(dessinVolant(piece.style), piece.id).not.toBeNull();
    for (const piece of INTERIOR_CATALOGUE.knobs) expect(dessinPommeau(piece.style), piece.id).not.toBeNull();
    for (const piece of INTERIOR_CATALOGUE.seats) expect(dessinSiege(piece.style), piece.id).not.toBeNull();
  });

  it('un style inconnu n’a pas de dessin : la puce garde son mot seul', () => {
    expect(dessinJante({ style: 'inconnu' })).toBeNull();
    expect(dessinPneu({ mark: 'inconnu' })).toBeNull();
    expect(dessinVolant('inconnu')).toBeNull();
    expect(dessinPommeau('inconnu')).toBeNull();
    expect(dessinSiege('inconnu')).toBeNull();
  });

  it('le dessin suit les paramètres : nombre de branches, trous, pavés, flanc blanc', () => {
    const traits = (n: number) => (dessinJante({ style: 'branches_plates', spokes: n }) ?? []).map((t) => t.d).join('');
    expect(traits(8).match(/M/g)?.length).toBeGreaterThan(traits(5).match(/M/g)?.length ?? 0);
    expect(dessinJante({ style: 'tole', holes: 4 })?.length).toBeLessThan(dessinJante({ style: 'tole', holes: 8 })?.length ?? 0);
    expect(dessinPneu({ mark: 'lisere', tread: 'pavés' })?.length).toBe((dessinPneu({ mark: 'lisere' })?.length ?? 0) + 1);
    const flanc = dessinPneu({ mark: 'flanc' })?.at(-1);
    expect(flanc?.w).toBeGreaterThan(2);
  });

  it('assiette : la caisse descend, les roues restent ; ciel : plus dense, plus d’étoiles', () => {
    const bas = (part: number) => Number(/^M2\.4 ([\d.]+)/.exec(dessinAssiette(part)[1]?.d ?? '')?.[1]);
    expect(bas(0)).toBeLessThan(bas(0.5));
    expect(bas(0.5)).toBeLessThan(bas(1));
    expect(dessinAssiette(0)[2]?.d).toBe(dessinAssiette(1)[2]?.d);
    const etoiles = (f: number) => dessinEtoiles(f)[0]?.d.match(/M/g)?.length ?? 0;
    const facteurs = INTERIOR_CATALOGUE.sky.densities.map((item) => etoiles(item.factor));
    expect(facteurs).toEqual([...facteurs].sort((a, b) => a - b));
    expect(new Set(facteurs).size).toBe(facteurs.length);
  });

  it('finitions : mat sans reflet net, brillant vernis, chrome miroir, pailleté, candy, nacré, caméléon', () => {
    const s = (id: string) => sphere(FINISHES.find((item) => item.id === id)!, '#d81f2a');
    expect(s('mat').reflet.net).toBeLessThan(0.3);
    expect(s('mat').vernis).toBe(0);
    expect(s('brillant').vernis).toBeGreaterThan(0.9);
    expect(s('chrome').horizon).toBeGreaterThan(0.8);
    expect(s('mat').horizon).toBe(0);
    expect(s('paillete').paillettes.length).toBe(10);
    expect(s('paillete').paillettes[0]?.[2]).toBeGreaterThan(s('metallise').paillettes[0]?.[2] ?? 0);
    expect(s('candy').profondeur).not.toBeNull();
    expect(s('nacre').irise).toBe(1);
    expect(s('cameleon').bord?.couleur).not.toBe('#d81f2a');
    // La teinte de la zone se lit dans la sphère ; le chrome reste presque nu.
    expect(s('brillant').base).toBe('#d81f2a');
    expect(s('chrome').base).not.toBe('#d81f2a');
    // Paillettes dans la sphère.
    for (const [x, y] of s('paillete').paillettes) expect(Math.hypot(x - 12, y - 12)).toBeLessThan(9);
  });
});

describe('miniature du tracé des cartes', () => {
  const carre = (loop: boolean) => {
    const rail: number[] = [];
    for (let i = 0; i <= 400; i += 1) {
      const t = (i / 400) * 4;
      const [x, z] = t < 1 ? [t, 0] : t < 2 ? [1, t - 1] : t < 3 ? [3 - t, 1] : [0, 4 - t];
      rail.push(x * 1000, 0, z * 500);
    }
    return { rail, loop };
  };

  it('le rail vu de dessus, centré dans le carré, simplifié à quelques points', () => {
    const a = apercu(carre(true));
    expect(a.d.startsWith('M')).toBe(true);
    expect(a.d.endsWith('Z')).toBe(true);
    expect(a.arrivee).toBeNull();
    const nombres = (a.d.match(/[\d.]+/g) ?? []).map(Number);
    expect(Math.min(...nombres)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...nombres)).toBeLessThanOrEqual(24);
    // Un rectangle : quatre coins et le retour au départ, pas quatre cents points.
    expect(a.d.split('L').length).toBeLessThanOrEqual(6);
    const ouvert = apercu(carre(false));
    expect(ouvert.arrivee).not.toBeNull();
    expect(lireApercu(JSON.parse(JSON.stringify(ouvert)))).not.toBeNull();
  });

  it('une miniature mal formée est écartée', () => {
    expect(lireApercu(null)).toBeNull();
    expect(lireApercu({ format: 'pmb-apercu', taille: 24, d: 'M0 0<script>', depart: [0, 0], arrivee: null })).toBeNull();
    expect(lireApercu({ format: 'autre', taille: 24, d: 'M0 0L1 1', depart: [0, 0], arrivee: null })).toBeNull();
  });

  it('les dessins ne citent aucun identifiant de véhicule ni de carte', () => {
    const ids = [
      ...readdirSync(new URL('public/assets/vehicles/', ROOT)),
      ...readdirSync(new URL('public/assets/maps/', ROOT)),
    ];
    const sources = ['src/ui/pictos/Pictos.tsx', 'src/ui/pictos/dessins.ts', 'src/ui/pictos/carte.ts', 'tools/maps/apercu.mjs'].map(read).join('\n');
    for (const id of ids) expect(sources.includes(`'${id}'`), id).toBe(false);
  });
});
