// Départ arrêté, chrono, tours et arrivée (src/drive/depart.ts), tenue du pilote sur la ligne
// (src/drive/pilote.ts, setHold), bips des feux (src/audio/sfx/regles.ts), meilleurs temps gardés
// (src/state/drive.ts) et lignes en damier (src/drive/scene/lignes.ts).

import { describe, expect, it } from 'vitest';
import { declenche } from '../../src/audio/sfx/regles.ts';
import { instantRepos } from '../../src/audio/sfx/route.ts';
import { PONCTUELS_ROUTE } from '../../src/data/bruitages.ts';
import type { MapRoute } from '../../src/data/mapTypes.ts';
import type { DriveInput } from '../../src/drive/contrat.ts';
import { armerDepart, chronoDuTour, cleTemps, createDepart, DEPART, feuxVisibles, formatChrono, lancerDepart, pasDepart, tenuSurLaLigne } from '../../src/drive/depart.ts';
import { createPilot } from '../../src/drive/pilote.ts';
import { createRail } from '../../src/drive/rail.ts';
import { LIGNES, LignesDepart } from '../../src/drive/scene/lignes.ts';
import { createNightUniforms } from '../../src/drive/scene/materiaux.ts';
import { sanitizeMeilleurs, useDrive } from '../../src/state/drive.ts';

const OUVERT = { length: 1000, loop: false };
const BOUCLE = { length: 1000, loop: true };

/** Avance le départ par pas de `dt` pendant `t` secondes, le véhicule à l'abscisse que donne `s(t)`. */
function rouler(etat: ReturnType<typeof createDepart>, t: number, dt: number, s: (temps: number) => number, parcours = OUVERT, pret = true): void {
  let temps = 0;
  while (temps < t - 1e-9) {
    temps += dt;
    pasDepart(etat, dt, pret, s(temps), parcours, false);
  }
}

describe('départ arrêté : les feux', () => {
  it('attend que la route soit prête, puis rouge, rouge, vert, un feu par seconde', () => {
    const etat = armerDepart(createDepart(), 120);
    pasDepart(etat, 0.1, false, 120, OUVERT, false);
    expect(etat.phase).toBe('attente');
    expect(tenuSurLaLigne(etat)).toBe(true);
    const vus: string[] = [];
    let temps = 0;
    while (etat.phase !== 'parti' && temps < 10) {
      pasDepart(etat, 0.1, true, 120, OUVERT, false);
      temps += 0.1;
      const vu = etat.vert ? 'vert' : `rouge${etat.rouges}`;
      if (vus[vus.length - 1] !== vu) vus.push(vu);
    }
    expect(vus).toEqual(['rouge0', 'rouge1', 'rouge2', 'vert']);
    // Lampes éteintes, puis un rouge par seconde, puis le vert : avant + rouges × feu.
    expect(temps).toBeCloseTo(DEPART.avant + DEPART.rouges * DEPART.feu, 0);
    expect(tenuSurLaLigne(etat)).toBe(false);
    expect(feuxVisibles(etat)).toBe(true);
    // Les lampes s'effacent une seconde après le vert.
    rouler(etat, DEPART.effacement + 0.05, 0.05, () => 120);
    expect(feuxVisibles(etat)).toBe(false);
  });

  it('la pause gèle les feux (temps de sortie nul), dans l’ordre, sans saut', () => {
    const etat = armerDepart(createDepart(), 0);
    rouler(etat, DEPART.avant + 0.5, 0.1, () => 0);
    expect(etat.rouges).toBe(1);
    for (let i = 0; i < 100; i += 1) pasDepart(etat, 0, true, 0, OUVERT, false);
    expect(etat.rouges).toBe(1);
    expect(etat.phase).toBe('feux');
    expect(etat.dansFeux).toBeCloseTo(DEPART.avant + 0.5, 6);
  });

  it('le chrono part au vert, en temps de sortie : il compte même à une image par seconde', () => {
    const etat = armerDepart(createDepart(), 0);
    rouler(etat, DEPART.avant + DEPART.rouges * DEPART.feu, 0.1, () => 0);
    expect(etat.phase).toBe('parti');
    const avant = etat.chrono;
    expect(avant).toBeLessThan(100);
    // Grands pas (le pilote reçoit au plus 0,1 s par image ; ici 0,1 s × 50).
    rouler(etat, 5, 0.1, (t) => t * 10);
    expect(etat.chrono - avant).toBeCloseTo(5000, 3);
    expect(formatChrono(etat.chrono)).toMatch(/^0:05\.\d$/);
  });

  it('un départ lancé (diagnostic) part sans les feux', () => {
    const etat = lancerDepart(createDepart(), 300);
    expect(etat.phase).toBe('parti');
    expect(tenuSurLaLigne(etat)).toBe(false);
    expect(feuxVisibles(etat)).toBe(false);
  });
});

describe('aperçu : départ lancé', () => {
  it('tenu tant que la route n’est pas prête, puis parti sans feux ni vert, chrono qui tourne', () => {
    const etat = armerDepart(createDepart(), 120, false, true);
    expect(etat.lance).toBe(true);
    pasDepart(etat, 0.1, false, 120, OUVERT, false);
    expect(etat.phase).toBe('attente');
    expect(tenuSurLaLigne(etat)).toBe(true);
    pasDepart(etat, 0.1, true, 120, OUVERT, false);
    expect(etat).toMatchObject({ phase: 'parti', vert: false, rouges: 0 });
    expect(tenuSurLaLigne(etat)).toBe(false);
    expect(feuxVisibles(etat)).toBe(false);
    pasDepart(etat, 0.5, true, 130, OUVERT, false);
    expect(etat.chrono).toBeCloseTo(500, 6);
    expect(etat.parcouru).toBeCloseTo(10, 6);
  });

  it('un nouveau départ arrêté efface le lancé : les feux reviennent', () => {
    const etat = armerDepart(createDepart(), 0, false, true);
    pasDepart(etat, 0.1, true, 0, OUVERT, false);
    armerDepart(etat, 0, false);
    expect(etat.lance).toBe(false);
    pasDepart(etat, 0.1, true, 0, OUVERT, false);
    expect(etat.phase).toBe('feux');
  });
});

describe('arrivée et tours', () => {
  it('parcours ouvert : le chrono s’arrête à la ligne d’arrivée, à l’instant interpolé', () => {
    const etat = lancerDepart(createDepart(), 900);
    // 20 m/s : 100 m en 5 s.
    let temps = 0;
    while (etat.phase === 'parti' && temps < 20) {
      temps += 0.1;
      // Abscisse non bornée : la ligne est passée au milieu d'un pas (le pilote, lui, s'arrête au bout).
      const s = 900 + temps * 20 + 0.7;
      pasDepart(etat, 0.1, true, s, OUVERT, s >= 1000);
    }
    expect(etat.phase).toBe('arrive');
    expect(etat.arrivee).toBeCloseTo(4965, 0);
    const fige = etat.chrono;
    pasDepart(etat, 0.1, true, 1000, OUVERT, true);
    expect(etat.chrono).toBe(fige);
    expect(etat.arrivee).toBe(fige);
  });

  it('boucle : un tour à chaque passage de la ligne, dernier et meilleur tour, le chrono continue', () => {
    const etat = lancerDepart(createDepart(), 800, true);
    // Premier tour à 50 m/s (20 s), second à 40 m/s (25 s), troisième à 50 m/s.
    let s = 800;
    const vitesse = (tour: number) => (tour === 1 ? 40 : 50);
    let temps = 0;
    while (etat.tours < 3 && temps < 200) {
      temps += 0.1;
      s = (s + vitesse(etat.tours) * 0.1) % 1000;
      pasDepart(etat, 0.1, true, s, BOUCLE, false);
    }
    expect(etat.phase).toBe('parti');
    expect(etat.tours).toBe(3);
    expect(etat.meilleurTour).toBeCloseTo(20_000, -2);
    expect(etat.dernierTour).toBeCloseTo(20_000, -2);
    expect(etat.chrono).toBeCloseTo(65_000, -2);
    expect(chronoDuTour(etat)).toBeLessThan(200);
    expect(etat.arrivee).toBe(-1);
  });

  it('armer remet tout à zéro (Repartir, autre départ)', () => {
    const etat = lancerDepart(createDepart(), 0, true);
    rouler(etat, 30, 0.1, (t) => (t * 50) % 1000, BOUCLE);
    expect(etat.tours).toBeGreaterThan(0);
    armerDepart(etat, 40);
    expect(etat).toMatchObject({ phase: 'attente', rouges: 0, vert: false, chrono: 0, tours: 0, meilleurTour: -1, arrivee: -1, ligne: 40 });
  });

  it('formats et clés', () => {
    expect(formatChrono(0)).toBe('0:00.0');
    expect(formatChrono(61_999)).toBe('1:01.9');
    expect(formatChrono(Number.NaN)).toBe('0:00.0');
    expect(cleTemps('carte', 'depart', 'vehicule')).toBe('carte|depart|vehicule');
  });
});

function ligneDroite(length = 600): MapRoute {
  const rail: number[] = [];
  for (let x = 0; x <= length; x += 2) rail.push(x, 0, 0);
  return { format: 'pmb-carte', version: 1, id: 'essai', loop: false, length, step: 2, rail, sections: [{ from: 0, to: length, ground: 'sol', urban: false, lanes: 2, width: 7 }], chunks: [], starts: [], far: null } as MapRoute;
}

describe('pilote tenu sur la ligne', () => {
  it('à la main, accélérateur à fond : il n’avance pas, le régime monte à vide ; lâché, il part', () => {
    const pilot = createPilot(createRail(ligneDroite()));
    pilot.reset(100);
    pilot.setHold(true);
    const gaz: DriveInput = { auto: false, throttle: 1, brake: 0, lane: 0, nos: 0 };
    const ralenti = pilot.train.rpm;
    for (let i = 0; i < 30; i += 1) pilot.step(0.1, { ...gaz, nos: i }, 'car');
    expect(pilot.motion.s).toBe(100);
    expect(pilot.motion.speed).toBe(0);
    expect(pilot.train.rpm).toBeGreaterThan(ralenti + 100);
    expect(pilot.train.nos).toBe(false);
    pilot.setHold(false);
    for (let i = 0; i < 20; i += 1) pilot.step(0.1, { ...gaz, nos: 29 }, 'car');
    expect(pilot.motion.s).toBeGreaterThan(100.5);
    expect(pilot.motion.speed).toBeGreaterThan(1);
  });

  it('en pilote automatique aussi', () => {
    const pilot = createPilot(createRail(ligneDroite()));
    pilot.reset(50);
    pilot.setHold(true);
    for (let i = 0; i < 30; i += 1) pilot.step(0.1, { auto: true, throttle: 0, brake: 0, lane: 0 }, 'car');
    expect(pilot.motion.s).toBe(50);
    expect(pilot.motion.speed).toBe(0);
    pilot.setHold(false);
    for (let i = 0; i < 20; i += 1) pilot.step(0.1, { auto: true, throttle: 0, brake: 0, lane: 0 }, 'car');
    expect(pilot.motion.s).toBeGreaterThan(50.5);
  });
});

describe('bips du départ', () => {
  it('deux emplacements de la route, déclenchés par les feux : un bip par rouge, un au vert', () => {
    const feu = PONCTUELS_ROUTE.find((p) => p.emplacement === 'depart-feu');
    const vert = PONCTUELS_ROUTE.find((p) => p.emplacement === 'depart-vert');
    expect(feu?.famille).toBe('route');
    expect(vert?.famille).toBe('route');
    const avant = instantRepos();
    const maintenant = instantRepos();
    const etapes: Array<[number, boolean]> = [
      [0, false],
      [1, false],
      [1, false],
      [2, false],
      [2, true],
      [2, true],
    ];
    const joues: string[] = [];
    for (const [rouges, v] of etapes) {
      maintenant.feuxRouges = rouges;
      maintenant.vert = v;
      if (feu && declenche(feu.declencheur, avant, maintenant, 0)) joues.push('feu');
      if (vert && declenche(vert.declencheur, avant, maintenant, 0)) joues.push('vert');
      avant.feuxRouges = rouges;
      avant.vert = v;
    }
    expect(joues).toEqual(['feu', 'feu', 'vert']);
  });
});

describe('meilleurs temps gardés', () => {
  it('lecture tolérante : seulement des temps plausibles', () => {
    expect(sanitizeMeilleurs(null)).toEqual({});
    expect(sanitizeMeilleurs([1, 2])).toEqual({});
    expect(sanitizeMeilleurs({ a: 61_000, b: -1, c: 'x', d: Number.NaN, e: 1e12, '': 5 })).toEqual({ a: 61_000 });
  });

  it('l’arrivée garde le meilleur temps par parcours, départ et véhicule', () => {
    const drive = useDrive.getState();
    const cle = cleTemps('carte', 'depart', 'vehicule');
    drive.noterArrivee(cle, 90_000);
    expect(useDrive.getState().arrivee).toEqual({ temps: 90_000, meilleur: 90_000, precedent: -1 });
    drive.noterArrivee(cle, 95_000);
    expect(useDrive.getState().arrivee).toEqual({ temps: 95_000, meilleur: 90_000, precedent: 90_000 });
    drive.noterArrivee(cle, 80_000);
    expect(useDrive.getState().arrivee).toEqual({ temps: 80_000, meilleur: 80_000, precedent: 90_000 });
    expect(useDrive.getState().meilleurs[cle]).toBe(80_000);
    drive.effacerArrivee();
    expect(useDrive.getState().arrivee).toBeNull();
  });
});

describe('lignes en damier', () => {
  it('départ et arrivée sur un parcours ouvert, toute la largeur, cases alternées, posées sur la chaussée', () => {
    const rail = createRail(ligneDroite());
    const lignes = new LignesDepart(createNightUniforms());
    lignes.poser(rail, 100, 2);
    expect(lignes.count).toBe(2);
    const mesh = lignes.group.children[0] as unknown as { geometry: { getAttribute(n: string): { array: Float32Array }; index: { count: number } } };
    const pos = mesh.geometry.getAttribute('position').array;
    const col = mesh.geometry.getAttribute('color').array;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let minX = Infinity;
    for (let i = 0; i < pos.length; i += 3) {
      minX = Math.min(minX, pos[i] as number);
      minZ = Math.min(minZ, pos[i + 2] as number);
      maxZ = Math.max(maxZ, pos[i + 2] as number);
      expect(pos[i + 1]).toBeCloseTo(LIGNES.hausseSansRelief, 6);
    }
    // Toute la largeur (7 m), devant le véhicule (centre à 100 m, demi-longueur 2 m).
    expect(maxZ - minZ).toBeCloseTo(7, 3);
    expect(minX).toBeCloseTo(100 + 2 + LIGNES.devant, 3);
    // Deux cases voisines ont deux teintes.
    expect(col[0]).not.toBe(col[12]);
    // Le relief qui penche vers la gauche donne un dévers, borné.
    lignes.update({ size: 1, ground: (_x, z) => -z * 0.05 }, 100);
    const penche = mesh.geometry.getAttribute('position').array;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < penche.length; i += 3) {
      lo = Math.min(lo, penche[i + 1] as number);
      hi = Math.max(hi, penche[i + 1] as number);
    }
    expect(hi - lo).toBeCloseTo(7 * 0.05, 2);
    lignes.dispose();
    expect(lignes.count).toBe(0);
  });

  it('boucle : une seule ligne', () => {
    const route = { ...ligneDroite(), loop: true };
    const lignes = new LignesDepart(createNightUniforms());
    lignes.poser(createRail(route), 10, 2);
    expect(lignes.count).toBe(1);
    lignes.dispose();
  });
});
