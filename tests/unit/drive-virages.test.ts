// Les virages d'un parcours (src/drive/virages.ts) : ligne droite sans virage, S à deux virages de sens
// opposés, sévérité selon le rayon, prochain virage depuis une abscisse (parcours ouvert et en boucle,
// virage qui enjambe la couture), annonce selon la vitesse. Aucune route réelle : des arcs et des droites.
import { describe, expect, it } from 'vitest';
import type { MapRoute } from '../../src/data/mapTypes.ts';
import { REGLAGES_VIRAGES } from '../../src/data/virages.ts';
import { createRail } from '../../src/drive/rail.ts';
import { annonceActive, cranDe, situationNeuve, situer, trouverVirages } from '../../src/drive/virages.ts';

type Segment = { line: number } | { arc: number; turn: number };

/** Route de synthèse au pas de 2 m : droites et arcs (rayon, angle en radians, positif à gauche). */
function makeRoute(segments: Segment[], loop = false): MapRoute {
  const step = 2;
  const rail: number[] = [0, 0, 0];
  let x = 0;
  let z = 0;
  let heading = 0;
  let travelled = 0;
  let next = step;
  const fine = 0.05;
  for (const segment of segments) {
    const length = 'line' in segment ? segment.line : Math.abs(segment.turn) * segment.arc;
    const rate = 'line' in segment ? 0 : segment.turn / length;
    for (let d = 0; d < length - 1e-9; d += fine) {
      heading += rate * fine;
      x += Math.cos(heading) * fine;
      z -= Math.sin(heading) * fine;
      travelled += fine;
      if (travelled >= next - 1e-9) {
        rail.push(x, 0, z);
        next += step;
      }
    }
  }
  const length = (rail.length / 3 - 1) * step;
  return { format: 'pmb-carte', version: 1, id: 'essai', loop, length, step, rail, sections: [{ from: 0, to: length, ground: 'sol', urban: false, lanes: 2, width: 7 }], chunks: [], starts: [{ id: 'depart', label: 'Départ', at: 0 }], far: null };
}

const DEG = Math.PI / 180;

describe('virages du parcours', () => {
  it('une ligne droite n’a aucun virage', () => {
    const v = trouverVirages(createRail(makeRoute([{ line: 1000 }])));
    expect(v.liste).toHaveLength(0);
    const out = situer(v, 500, situationNeuve());
    expect(out).toEqual({ courant: -1, prochain: -1, distance: 0 });
  });

  it('un S fait deux virages de sens opposés, avec leur rayon et leur angle', () => {
    const v = trouverVirages(createRail(makeRoute([{ line: 300 }, { arc: 100, turn: 90 * DEG }, { arc: 100, turn: -90 * DEG }, { line: 300 }])));
    expect(v.liste).toHaveLength(2);
    const [gauche, droite] = v.liste;
    expect(gauche!.sens).toBe(1);
    expect(droite!.sens).toBe(-1);
    for (const x of v.liste) {
      expect(x.rayon).toBeGreaterThan(85);
      expect(x.rayon).toBeLessThan(120);
      expect(x.angle / DEG).toBeGreaterThan(80);
      expect(x.angle / DEG).toBeLessThan(100);
      expect(x.debut).toBeLessThan(x.corde);
      expect(x.corde).toBeLessThan(x.fin);
    }
    expect(gauche!.debut).toBeGreaterThan(280);
    expect(gauche!.debut).toBeLessThan(320);
    expect(droite!.debut).toBeGreaterThan(gauche!.fin - 40);
  });

  it('la sévérité suit le rayon, et une courbe brève perd un cran', () => {
    const cran = (rayon: number, angle = 90) => {
      const v = trouverVirages(createRail(makeRoute([{ line: 300 }, { arc: rayon, turn: angle * DEG }, { line: 300 }])));
      expect(v.liste).toHaveLength(1);
      return v.liste[0]!.cran;
    };
    expect(cran(25)).toBe(4);
    expect(cran(60)).toBe(3);
    expect(cran(140)).toBe(2);
    expect(cran(300)).toBe(1);
    // Même rayon, angle faible : un cran de moins.
    expect(cran(60, 20)).toBe(2);
    expect(cranDe(10, 3)).toBe(4);
    expect(cranDe(500, 3)).toBe(1);
    // Les crans sont ordonnés par rayon décroissant dans les données.
    const rayons = REGLAGES_VIRAGES.crans.map((c) => c.rayonMax);
    expect([...rayons].sort((a, b) => a - b)).toEqual(rayons);
  });

  it('une courbe trop douce ou trop brève ne compte pas', () => {
    expect(trouverVirages(createRail(makeRoute([{ line: 300 }, { arc: 1500, turn: 30 * DEG }, { line: 300 }]))).liste).toHaveLength(0);
    expect(trouverVirages(createRail(makeRoute([{ line: 300 }, { arc: 80, turn: 6 * DEG }, { line: 300 }]))).liste).toHaveLength(0);
  });

  it('le prochain virage depuis une abscisse (parcours ouvert)', () => {
    const route = makeRoute([{ line: 400 }, { arc: 80, turn: 90 * DEG }, { line: 400 }, { arc: 80, turn: -90 * DEG }, { line: 400 }]);
    const v = trouverVirages(createRail(route));
    expect(v.liste).toHaveLength(2);
    const [a, b] = v.liste as [(typeof v.liste)[number], (typeof v.liste)[number]];
    const out = situationNeuve();
    situer(v, 0, out);
    expect(out.prochain).toBe(0);
    expect(out.courant).toBe(-1);
    expect(out.distance).toBeCloseTo(a.debut, 3);
    // Dedans : le courant est celui-là, le prochain le suivant.
    situer(v, a.corde, out);
    expect(out.courant).toBe(0);
    expect(out.prochain).toBe(1);
    expect(out.distance).toBeCloseTo(b.debut - a.corde, 3);
    // Entre les deux : en ligne.
    situer(v, (a.fin + b.debut) / 2, out);
    expect(out.courant).toBe(-1);
    expect(out.prochain).toBe(1);
    // Après le dernier : plus rien devant, sur un parcours ouvert.
    situer(v, b.fin + 5, out);
    expect(out.prochain).toBe(-1);
    expect(out.courant).toBe(-1);
  });

  it('en boucle : le prochain est toujours devant, et un virage peut enjamber la couture', () => {
    // Un carré arrondi (quatre virages à gauche de 90°), parti au milieu du dernier et du premier.
    const R = 80 / Math.PI; // arc de 90° = 40 m
    const route = makeRoute(
      [{ arc: R, turn: 45 * DEG }, { line: 200 }, { arc: R, turn: 90 * DEG }, { line: 200 }, { arc: R, turn: 90 * DEG }, { line: 200 }, { arc: R, turn: 90 * DEG }, { line: 200 }, { arc: R, turn: 45 * DEG }],
      true,
    );
    const rail = createRail(route);
    expect(rail.loop).toBe(true);
    const v = trouverVirages(rail);
    expect(v.liste).toHaveLength(4);
    for (const x of v.liste) expect(x.sens).toBe(1);
    // Celui qui enjambe la couture : début près de la fin, fin au-delà de la longueur.
    const couture = v.liste.find((x) => x.fin > v.longueur);
    expect(couture).toBeDefined();
    const out = situationNeuve();
    situer(v, 3, out);
    expect(v.liste[out.courant]).toBe(couture);
    situer(v, v.longueur - 3, out);
    expect(v.liste[out.courant]).toBe(couture);
    // En ligne droite entre deux virages : le prochain est devant, la distance reste positive et sous un tour.
    for (let s = 0; s < v.longueur; s += 7) {
      situer(v, s, out);
      expect(out.prochain).toBeGreaterThanOrEqual(0);
      expect(out.distance).toBeGreaterThanOrEqual(0);
      expect(out.distance).toBeLessThan(v.longueur);
    }
    // Après le dernier début de la liste, le prochain repasse par le premier.
    const dernier = v.liste[v.liste.length - 1]!;
    situer(v, dernier.fin + 5 > v.longueur ? 40 : dernier.fin + 5, out);
    expect(out.prochain).toBeGreaterThanOrEqual(0);
  });

  it('l’annonce s’ouvre plus tôt quand on va vite, avec un plancher et un plafond', () => {
    expect(annonceActive(100, 5)).toBe(false);
    expect(annonceActive(80, 5)).toBe(true); // plancher
    expect(annonceActive(400, 80)).toBe(true);
    expect(annonceActive(700, 83)).toBe(false); // plafond
    expect(annonceActive(300, 20)).toBe(false);
    expect(annonceActive(300, 60)).toBe(true);
  });
});
