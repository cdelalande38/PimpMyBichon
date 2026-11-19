// L'adversaire du duel (src/drive/adversaire/, src/data/adversaires.ts) : données, allure, pilotage mesuré
// hors navigateur sur les cartes construites (il boucle sans toucher un bord, aux trois niveaux et par
// météo ; ses temps face aux médailles ; déterministe), contact (jamais de recouvrement), écart et vainqueur.

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ADVERSAIRES, lireAdversaires, NIVEAUX, PILOTAGE_ADVERSAIRE, PROBLEMES_ADVERSAIRES } from '../../src/data/adversaires.ts';
import { seuilsMedailles, tempsReference } from '../../src/data/courses.ts';
import type { MapRoute } from '../../src/data/mapTypes.ts';
import { MAPS, validateRoute } from '../../src/data/maps.ts';
import { vehicleById, VEHICLES } from '../../src/data/vehicles.ts';
import type { DriveInput, Weather } from '../../src/drive/contrat.ts';
import { armerDepart, createDepart, pasDepart } from '../../src/drive/depart.ts';
import { createPilot, performanceDe } from '../../src/drive/pilote.ts';
import { createRail } from '../../src/drive/rail.ts';
import { piloteDeSimulation, simulerCourse } from '../../src/drive/simulationCourse.ts';
import { createContact, devant, pasContact, recouvrement, type CorpsRoute } from '../../src/drive/adversaire/contact.ts';
import { allureDuel, DuelEnCourse } from '../../src/drive/adversaire/course.ts';
import { armerDuel, chronoA, createDuel, pasDuel, PAS_RELEVES } from '../../src/drive/adversaire/duel.ts';
import { allureDe, bruitSection, createPiloteAdversaire, graineDe, variationAllure } from '../../src/drive/adversaire/pilotage.ts';
import { simulerAdversaire } from '../../src/drive/adversaire/simulation.ts';

const built = MAPS.filter((map) => existsSync(`public/assets/maps/${map.id}/${map.route}`));
const routes = new Map<string, MapRoute>();
const route = (id: string): MapRoute => {
  const known = routes.get(id);
  if (known) return known;
  const map = MAPS.find((m) => m.id === id)!;
  const r = validateRoute(JSON.parse(readFileSync(`public/assets/maps/${id}/${map.route}`, 'utf8')), map);
  routes.set(id, r);
  return r;
};

describe('données des adversaires', () => {
  it('le fichier est accepté : trois niveaux, des véhicules du catalogue, aucun problème', () => {
    expect(PROBLEMES_ADVERSAIRES).toEqual([]);
    expect(ADVERSAIRES.map((a) => a.niveau)).toEqual(['bronze', 'argent', 'or']);
    for (const a of ADVERSAIRES) expect(vehicleById(a.vehicule), a.id).toBeDefined();
  });

  it('refuse un fichier mal formé en entier', () => {
    const ok = JSON.parse(readFileSync('public/assets/adversaires/adversaires.json', 'utf8')) as Record<string, unknown>;
    expect(lireAdversaires(ok, VEHICLES).problemes).toEqual([]);
    const faux = { ...ok, adversaires: [{ id: 'x', nom: 'X', phrase: 'p', niveau: 'platine', vehicule: 'inconnu', couleur: 'rouge' }] };
    const lu = lireAdversaires(faux, VEHICLES);
    expect(lu.adversaires).toEqual([]);
    expect(lu.problemes.length).toBeGreaterThanOrEqual(3);
    expect(lireAdversaires(null, VEHICLES).adversaires).toEqual([]);
  });
});

describe('allure', () => {
  it('temps de la conduite appliquée sur le temps visé, plafonnée à 1 ; repli sans référence', () => {
    expect(allureDe(90, 100, 0.5)).toBeCloseTo(0.9, 9);
    expect(allureDe(120, 100, 0.5)).toBe(1);
    expect(allureDe(null, 100, 0.55)).toBe(0.55);
    expect(allureDe(90, Number.NaN, 0.8)).toBe(0.8);
  });

  it('irrégularité déterministe, bornée, lissée, différente d’un adversaire à l’autre', () => {
    expect(bruitSection(7, 3)).toBe(bruitSection(7, 3));
    let somme = 0;
    for (let k = 0; k < 2000; k += 1) {
      const b = bruitSection(k, graineDe('dede'));
      expect(Math.abs(b)).toBeLessThanOrEqual(1);
      somme += b;
    }
    // En moyenne nulle : l'allure moyenne reste celle du niveau.
    expect(Math.abs(somme / 2000)).toBeLessThan(0.06);
    expect(variationAllure(140, 140, 1)).toBeCloseTo(bruitSection(1, 1), 9);
    expect(Math.abs(variationAllure(139.99, 140, 1) - variationAllure(140.01, 140, 1))).toBeLessThan(1e-3);
    expect(bruitSection(5, graineDe('dede'))).not.toBe(bruitSection(5, graineDe('comete')));
  });
});

/** Le premier départ de chaque carte construite, et le plus court (moins de calcul). */
function departs(id: string, tous: boolean) {
  const r = route(id);
  const liste = [...r.starts];
  if (tous) return liste;
  const ref = (s: (typeof liste)[number]) => tempsReference(id, s.id, 'tour1')?.main ?? Infinity;
  return [liste.sort((a, b) => ref(a) - ref(b))[0]!];
}

function adversaireSimule(mapId: string, niveau: (typeof NIVEAUX)[number], joueur: string, depart: string) {
  const a = ADVERSAIRES.find((x) => x.niveau === niveau)!;
  const vehicule = vehicleById(a.vehicule)!;
  const pilot = createPilot(createRail(route(mapId)), performanceDe(vehicule));
  const allure = allureDuel(a, mapId, depart, 'tour1', joueur);
  return { a, p: createPiloteAdversaire(pilot, allure, PILOTAGE_ADVERSAIRE, graineDe(a.id)), allure };
}

/** Frôlements de la limite par la conduite appliquée de référence (src/drive/simulationCourse.ts), au sec. */
function contactsReference(mapId: string, at: number, vehicule: string): number {
  return simulerCourse(piloteDeSimulation(route(mapId), performanceDe(vehicleById(vehicule)!)), { at, tours: 1, meteo: 'sec', conduite: 'main' }).contacts;
}

describe('pilotage mesuré hors navigateur', () => {
  // Niveau or (le plus vif) sur chaque départ de chaque carte, au sec : il boucle sans toucher un bord, près du temps visé.
  it.skipIf(built.length === 0)('chaque départ de chaque carte, niveau or, au sec : fini, sans toucher un bord, au temps visé', { timeout: 300_000 }, () => {
    for (const map of built) {
      for (const start of departs(map.id, true)) {
        const { p, a } = adversaireSimule(map.id, 'or', 'concept', start.id);
        const sim = simulerAdversaire(p, start.at, 1, 'sec');
        const ref = tempsReference(map.id, start.id, 'tour1', 'concept')!;
        const vise = seuilsMedailles(ref)[a.niveau];
        const ici = `${map.id}/${start.id}`;
        expect(sim.temps, ici).toBeLessThan(Infinity);
        expect(sim.dehors, ici).toBe(0);
        // Il frôle la limite de sa trajectoire (0,4 m du bord) comme la conduite appliquée de référence, pas plus.
        expect(sim.contacts, ici).toBeLessThanOrEqual(contactsReference(map.id, start.at, a.vehicule) * 1.6 + 10);
        // Irrégularité de ±4 % par section : le temps reste à 5 % du seuil (plafonné : jamais plus vite que sa conduite).
        expect(sim.temps / vise, ici).toBeGreaterThan(0.95);
        expect(sim.temps / vise, ici).toBeLessThan(1.05);
      }
    }
  });

  it.skipIf(built.length === 0)('trois niveaux, trois météos (départ le plus court de chaque carte) : fini, sans toucher un bord, dans l’ordre', { timeout: 300_000 }, () => {
    for (const map of built) {
      const start = departs(map.id, false)[0]!;
      const temps: Record<string, number> = {};
      for (const niveau of NIVEAUX) {
        for (const meteo of ['sec', 'pluie', 'neige'] as Weather[]) {
          if (meteo !== 'sec' && niveau !== 'or') continue;
          const { p } = adversaireSimule(map.id, niveau, 'cox', start.id);
          const sim = simulerAdversaire(p, start.at, 1, meteo);
          const ici = `${map.id}/${start.id}/${niveau}/${meteo}`;
          expect(sim.temps, ici).toBeLessThan(Infinity);
          expect(sim.dehors, ici).toBe(0);
          temps[`${niveau}/${meteo}`] = sim.temps;
        }
      }
      // L'or devant l'argent devant le bronze ; la pluie et la neige ralentissent.
      expect(temps['or/sec']!).toBeLessThan(temps['argent/sec']!);
      expect(temps['argent/sec']!).toBeLessThan(temps['bronze/sec']!);
      expect(temps['or/pluie']!).toBeGreaterThan(temps['or/sec']!);
      expect(temps['or/neige']!).toBeGreaterThan(temps['or/pluie']!);
    }
  });

  it.skipIf(built.length === 0)('déterministe : même course, même temps', { timeout: 60_000 }, () => {
    const map = built[0]!;
    const start = departs(map.id, false)[0]!;
    const un = simulerAdversaire(adversaireSimule(map.id, 'argent', 'concept', start.id).p, start.at, 1, 'sec');
    const deux = simulerAdversaire(adversaireSimule(map.id, 'argent', 'concept', start.id).p, start.at, 1, 'sec');
    expect(deux.temps).toBe(un.temps);
  });
});

describe('contact', () => {
  const reglage = { garde: 0.3, approche: 6, relache: 12, ecartParSeconde: 3 };

  it('devant, replié sur une boucle', () => {
    expect(devant(10, 30, 1000, false)).toBe(20);
    expect(devant(990, 10, 1000, true)).toBe(20);
    expect(devant(10, 990, 1000, true)).toBe(-20);
  });

  it('côte à côte : l’adversaire s’écarte ; trop étroit : celui de derrière est retenu', () => {
    const c = createContact();
    const j: CorpsRoute = { s: 100, offset: 0, demiLargeur: 0.95, demiLongueur: 2.2 };
    const a: CorpsRoute = { s: 101, offset: 0.5, demiLargeur: 0.95, demiLongueur: 2.2 };
    // Large : il prend sa gauche et s'écarte peu à peu, sans sortir de [lo, hi].
    for (let i = 0; i < 30; i += 1) pasContact(c, j, a, -3, 3, reglage, 0.1, 1000, false);
    expect(c.cote).toBe(1);
    expect(a.offset + c.ecart).toBeGreaterThanOrEqual(j.demiLargeur + a.demiLargeur + reglage.garde - 1e-9);
    expect(a.offset + c.ecart).toBeLessThanOrEqual(3);
    // Étroit : impossible de passer à deux. À sa hauteur (1 m), l'adversaire cède ; nettement derrière (3 m), le joueur est retenu.
    const d = createContact();
    expect(pasContact(d, j, { ...a }, -0.6, 0.6, reglage, 0.1, 1000, false)).toBe('adversaire');
    expect(pasContact(createContact(), j, { ...a, s: 103 }, -0.6, 0.6, reglage, 0.1, 1000, false)).toBe('joueur');
    // Loin : rien.
    const e = createContact();
    expect(pasContact(e, j, { ...a, s: 200 }, -0.6, 0.6, reglage, 0.1, 1000, false)).toBeNull();
    expect(e.cote).toBe(0);
  });

  // Le joueur (pilote automatique, plus rapide) rattrape l'adversaire (bronze) et le double : jamais de recouvrement.
  it.skipIf(built.length === 0)('pas de recouvrement des deux véhicules sur une course', { timeout: 120_000 }, () => {
    const map = built.find((m) => route(m.id).loop) ?? built[0]!;
    const r = route(map.id);
    const rail = createRail(r);
    const start = r.starts[0]!;
    const a = ADVERSAIRES.find((x) => x.niveau === 'bronze')!;
    const duel = new DuelEnCourse(a, vehicleById(a.vehicule)!, rail);
    const joueur = createPilot(rail, performanceDe(vehicleById('concept')!));
    joueur.reset(start.at);
    const depart = armerDepart(createDepart(), joueur.motion.s, rail.loop, false, 1);
    duel.depart(0.45, joueur.motion.s, joueur.motion.offset, 0.95, 2.2, 1, true);
    const input: DriveInput = { auto: false, throttle: 1, brake: 0, lane: 0, assist: true };
    let recouvre = 0;
    let retenues = 0;
    let doubles = false;
    const arrive = () => depart.phase === 'arrive';
    for (let t = 0; t < 600 && !arrive(); t += 0.1) {
      // Gaz à fond, freine où le pilote de référence freinerait (direction assistée, comme un joueur appliqué).
      input.throttle = joueur.motion.speed < 25 ? 1 : 0.4;
      joueur.setHold(depart.phase === 'attente' || depart.phase === 'feux');
      const m = joueur.step(0.1, input, 'car');
      pasDepart(depart, 0.1, true, m.s, rail, m.finished);
      duel.pas(0.1, joueur, depart, 0.95, 2.2);
      if (duel.retenue) retenues += 1;
      if (duel.duel.position === 1 && depart.parcouru > 50) doubles = true;
      const cj: CorpsRoute = { s: joueur.motion.s, offset: joueur.motion.offset, demiLargeur: 0.95, demiLongueur: 2.2 };
      const ca: CorpsRoute = { s: duel.pilote.pilot.motion.s, offset: duel.offset, demiLargeur: 0.95, demiLongueur: 2.2 };
      if (recouvrement(cj, ca, rail.length, rail.loop)) recouvre += 1;
    }
    expect(recouvre).toBe(0);
    expect(doubles).toBe(true);
    expect(retenues).toBeLessThan(100);
  });
});

describe('écart et vainqueur', () => {
  const parcours = { length: 1000, loop: false };

  it('position, écart en secondes, verdict gagné ou perdu', () => {
    const duel = createDuel(1000);
    armerDuel(duel, 0, false, 1);
    const joueur = armerDepart(createDepart(), 0, false, false, 1);
    // Feux : rien ne part.
    joueur.phase = 'feux';
    pasDuel(duel, joueur, 0.1, 0, parcours, false);
    expect(duel.lance).toBe(false);
    joueur.phase = 'parti';
    joueur.vert = true;
    pasDuel(duel, joueur, 0, 0, parcours, false);
    expect(duel.lance).toBe(true);
    // Le joueur à 20 m/s, l'adversaire à 10 m/s : le joueur mène, l'écart grandit.
    let sJ = 0;
    let sA = 0;
    const fini = () => joueur.phase === 'arrive';
    for (let i = 0; i < 700; i += 1) {
      sJ = Math.min(1000, sJ + 2);
      sA = Math.min(1000, sA + 1);
      pasDepart(joueur, 0.1, true, sJ, parcours, sJ >= 1000);
      pasDuel(duel, joueur, 0.1, sA, parcours, sA >= 1000);
      if (fini()) break;
    }
    expect(duel.verdict?.gagne).toBe(true);
    // À l'arrivée du joueur (50 s), l'adversaire est à 500 m, où le joueur était passé à 25 s : 25 s d'avance.
    expect(duel.verdict?.ecart).toBeCloseTo(25, 0);
    expect(duel.position).toBe(1);
    expect(chronoA(duel.tJ, duel.nJ, 500)).toBeCloseTo(25_000, -2);
    expect(PAS_RELEVES).toBeGreaterThan(0);
  });

  it('l’adversaire passe la ligne le premier : perdu, de la différence des temps', () => {
    const duel = createDuel(100);
    armerDuel(duel, 0, false, 1);
    const p = { length: 100, loop: false };
    const joueur = armerDepart(createDepart(), 0, false, false, 1);
    joueur.phase = 'parti';
    joueur.vert = true;
    pasDuel(duel, joueur, 0, 0, p, false);
    let sJ = 0;
    let sA = 0;
    const fini = () => joueur.phase === 'arrive';
    for (let i = 0; i < 300 && !fini(); i += 1) {
      sJ = Math.min(100, sJ + 1);
      sA = Math.min(100, sA + 2);
      pasDepart(joueur, 0.1, true, sJ, p, sJ >= 100);
      pasDuel(duel, joueur, 0.1, sA, p, sA >= 100);
      if (i === 20) expect(duel.position).toBe(2);
    }
    expect(duel.verdict?.gagne).toBe(false);
    expect(duel.verdict?.ecart).toBeCloseTo(5, 0);
    expect(duel.verdict?.tempsAdversaire).toBeCloseTo(5, 0);
  });
});
