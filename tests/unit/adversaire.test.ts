// L'adversaire du duel (src/drive/adversaire/, src/data/adversaires.ts) : données, niveaux mesurés hors
// navigateur sur les cartes construites (il court : le plus dur roule la conduite de référence de son véhicule,
// les autres en dessous mais bien au-dessus de la balade ; jamais hors de la chaussée ; déterministe), l'adversaire
// à ta mesure, la sauvegarde relue, les gains, la grille de départ sur chaque départ (sur la chaussée, sans se
// toucher, sans saut aux feux ni au vert), contact (jamais de recouvrement), écart et vainqueur.

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ADVERSAIRES, lireAdversaires, NIVEAUX_DUEL, niveauDuel, PILOTAGE_ADVERSAIRE, PROBLEMES_ADVERSAIRES, relireChoixDuel, type NiveauDuel } from '../../src/data/adversaires.ts';
import { tempsReference } from '../../src/data/courses.ts';
import { ECONOMIE_DUEL } from '../../src/data/economie.ts';
import { HAUTS_FAITS } from '../../src/data/hautsFaits.ts';
import type { MapRoute } from '../../src/data/mapTypes.ts';
import { MAPS, validateRoute } from '../../src/data/maps.ts';
import { vehicleById, VEHICLES } from '../../src/data/vehicles.ts';
import type { DriveInput, Weather } from '../../src/drive/contrat.ts';
import { armerDepart, createDepart, pasDepart } from '../../src/drive/depart.ts';
import { createPilot, laneLimits, performanceDe, PILOT, type PilotWithProfile } from '../../src/drive/pilote.ts';
import { createPose, createRail } from '../../src/drive/rail.ts';
import { piloteDeSimulation, SIMULATION, simulerCourse } from '../../src/drive/simulationCourse.ts';
import { hautFaitDuel } from '../../src/drive/adversaire/cloture.ts';
import { coteLibre, createContact, devant, pasContact, recouvrement, type CorpsRoute } from '../../src/drive/adversaire/contact.ts';
import { adversaireAMesure, DuelEnCourse, grilleDepart, trempe, type CorpsGrille, type Grille } from '../../src/drive/adversaire/course.ts';
import { armerDuel, chronoA, createDuel, pasDuel, PAS_RELEVES } from '../../src/drive/adversaire/duel.ts';
import { bruitSection, createPiloteAdversaire, graineDe, pasAdversaire, remettreAdversaire, variationAllure } from '../../src/drive/adversaire/pilotage.ts';
import { simulerAdversaire } from '../../src/drive/adversaire/simulation.ts';
import { measureSeating } from '../../src/scene/vehicle/conducteur.ts';
import { storedModel } from './places-modeles.ts';

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
const plusDur = (): NiveauDuel => NIVEAUX_DUEL.at(-1)!;

describe('données des adversaires', () => {
  it('le fichier est accepté : un adversaire par véhicule du catalogue, des niveaux du plus facile au plus dur, un palier de gains chacun', () => {
    expect(PROBLEMES_ADVERSAIRES).toEqual([]);
    for (const a of ADVERSAIRES) expect(vehicleById(a.vehicule), a.id).toBeDefined();
    expect(new Set(ADVERSAIRES.map((a) => a.vehicule)).size).toBe(VEHICLES.length);
    expect(NIVEAUX_DUEL.map((n) => n.gains)).toEqual(['bronze', 'argent', 'or']);
    for (let i = 1; i < NIVEAUX_DUEL.length; i += 1) {
      expect(NIVEAUX_DUEL[i]!.allure).toBeGreaterThan(NIVEAUX_DUEL[i - 1]!.allure);
      expect(NIVEAUX_DUEL[i]!.freinage).toBeGreaterThan(NIVEAUX_DUEL[i - 1]!.freinage);
      expect(NIVEAUX_DUEL[i]!.irregularite).toBeLessThanOrEqual(NIVEAUX_DUEL[i - 1]!.irregularite);
      expect(NIVEAUX_DUEL[i]!.audace).toBeGreaterThanOrEqual(NIVEAUX_DUEL[i - 1]!.audace);
    }
    // Le plus dur court la conduite de référence : pleine allure, le freinage de la référence, régulier.
    expect(plusDur()).toMatchObject({ allure: 1, freinage: 0.8, irregularite: 0 });
    expect(niveauDuel('inconnu')?.id).toBe(niveauDuel(null)?.id);
  });

  it('refuse un fichier mal formé en entier', () => {
    const ok = JSON.parse(readFileSync('public/assets/adversaires/adversaires.json', 'utf8')) as Record<string, unknown>;
    expect(lireAdversaires(ok, VEHICLES).problemes).toEqual([]);
    const faux = { ...ok, adversaires: [{ id: 'x', nom: 'X', phrase: 'p', vehicule: 'inconnu', couleur: 'rouge' }] };
    const lu = lireAdversaires(faux, VEHICLES);
    expect(lu.adversaires).toEqual([]);
    expect(lu.problemes.length).toBeGreaterThanOrEqual(2);
    expect(lireAdversaires({ ...ok, niveaux: [{ id: 'a', label: 'A', phrase: 'p', gains: 'or', allure: 2, freinage: 0.5, irregularite: 0 }] }, VEHICLES).niveaux).toEqual([]);
    expect(lireAdversaires({ ...ok, version: 1 }, VEHICLES).problemes.length).toBeGreaterThan(0);
    expect(lireAdversaires(null, VEHICLES).adversaires).toEqual([]);
  });

  it('la sauvegarde du choix se relit : celle d’avant les niveaux repart à ta mesure, au niveau par défaut ; rien d’inconnu ne passe', () => {
    // Avant les niveaux : { actif, adversaire } (l'id y était écrit même sans choix).
    expect(relireChoixDuel({ actif: true, adversaire: ADVERSAIRES[0]!.id })).toEqual({ actif: true, adversaire: null, niveau: null });
    expect(relireChoixDuel({ actif: true, adversaire: ADVERSAIRES[1]!.id, niveau: NIVEAUX_DUEL[0]!.id })).toEqual({ actif: true, adversaire: ADVERSAIRES[1]!.id, niveau: NIVEAUX_DUEL[0]!.id });
    expect(relireChoixDuel({ actif: false, adversaire: 'parti', niveau: 'platine' })).toEqual({ actif: false, adversaire: null, niveau: null });
    expect(relireChoixDuel('n’importe quoi')).toEqual({ actif: false, adversaire: null, niveau: null });
    expect(relireChoixDuel(null)).toEqual({ actif: false, adversaire: null, niveau: null });
  });

  it('gains par palier inchangés (victoire 15, 30, 50 $ ; première victoire 40, 80, 150 $), hauts faits gardés', () => {
    expect(NIVEAUX_DUEL.map((n) => ECONOMIE_DUEL.victoire[n.gains])).toEqual([15, 30, 50]);
    expect(NIVEAUX_DUEL.map((n) => ECONOMIE_DUEL.prime[n.gains])).toEqual([40, 80, 150]);
    for (const n of NIVEAUX_DUEL) expect(HAUTS_FAITS.some((h) => h.id === hautFaitDuel(n.gains)), n.id).toBe(true);
    // Les identifiants des hauts faits d'avant (premières victoires déjà gagnées) n'ont pas changé.
    expect(NIVEAUX_DUEL.map((n) => hautFaitDuel(n.gains))).toEqual(['duel-bronze', 'duel-argent', 'duel-or']);
  });

  it('à ta mesure : l’adversaire au véhicule du joueur, sinon au véhicule de trempe la plus proche', () => {
    for (const v of VEHICLES) expect(adversaireAMesure(v.id)?.vehicule, v.id).toBe(v.id);
    for (const v of VEHICLES) {
      const sans = ADVERSAIRES.filter((a) => a.vehicule !== v.id);
      const choisi = adversaireAMesure(v.id, sans)!;
      const tv = trempe(v.id)!;
      for (const a of sans) expect(Math.abs(trempe(choisi.vehicule)! - tv)).toBeLessThanOrEqual(Math.abs(trempe(a.vehicule)! - tv) + 1e-12);
    }
  });
});

describe('irrégularité', () => {
  it('déterministe, bornée, lissée, différente d’un adversaire à l’autre', () => {
    expect(bruitSection(7, 3)).toBe(bruitSection(7, 3));
    let somme = 0;
    for (let k = 0; k < 2000; k += 1) {
      const b = bruitSection(k, graineDe('dede'));
      expect(Math.abs(b)).toBeLessThanOrEqual(1);
      somme += b;
    }
    expect(Math.abs(somme / 2000)).toBeLessThan(0.06);
    expect(variationAllure(140, 140, 1)).toBeCloseTo(bruitSection(1, 1), 9);
    expect(Math.abs(variationAllure(139.99, 140, 1) - variationAllure(140.01, 140, 1))).toBeLessThan(1e-3);
    expect(bruitSection(5, graineDe('dede'))).not.toBe(bruitSection(5, graineDe('comete')));
  });
});

/** Le départ le plus court de chaque carte construite (moins de calcul). */
function plusCourt(id: string) {
  const r = route(id);
  const ref = (s: (typeof r.starts)[number]) => tempsReference(id, s.id, 'tour1')?.main ?? Infinity;
  return [...r.starts].sort((a, b) => ref(a) - ref(b))[0]!;
}

function adversaireSimule(mapId: string, vehicule: string, niveau: NiveauDuel, id = 'test') {
  const pilot = createPilot(createRail(route(mapId)), performanceDe(vehicleById(vehicule)!));
  return createPiloteAdversaire(pilot, niveau, PILOTAGE_ADVERSAIRE, graineDe(id));
}

describe('il court : niveaux mesurés hors navigateur', () => {
  it.skipIf(built.length === 0)('le plus dur, sans son NOS, jamais plus lent que la conduite de référence de son véhicule, jamais hors de la chaussée', { timeout: 300_000 }, () => {
    for (const map of built) {
      const start = plusCourt(map.id);
      for (const v of VEHICLES) {
        const sim = simulerAdversaire(adversaireSimule(map.id, v.id, { ...plusDur(), nos: 0 }), start.at, 1, 'sec');
        const ref = simulerCourse(piloteDeSimulation(route(map.id), performanceDe(v)), { at: start.at, tours: 1, meteo: 'sec', conduite: 'main' });
        const ici = `${map.id}/${start.id}/${v.id}`;
        // Il ne freine que là où elle freinerait, et seulement si sa trajectoire l'exige ; il frotte le bord à dessein.
        expect(sim.temps, ici).toBeLessThanOrEqual(ref.temps + 0.1);
        expect(sim.dehors, ici).toBe(0);
      }
    }
  });

  it.skipIf(built.length === 0)('chaque niveau fait la course (loin de la balade), dans l’ordre, au sec et sous la météo, sans sortir de la chaussée', { timeout: 300_000 }, () => {
    for (const map of built) {
      const start = plusCourt(map.id);
      for (const vehicule of [VEHICLES[0]!.id, VEHICLES.at(-1)!.id]) {
        const ref = tempsReference(map.id, start.id, 'tour1', vehicule)!;
        const temps = NIVEAUX_DUEL.map((n) => simulerAdversaire(adversaireSimule(map.id, vehicule, n), start.at, 1, 'sec'));
        const ici = `${map.id}/${start.id}/${vehicule}`;
        for (const t of temps) {
          expect(t.dehors, ici).toBe(0);
          // Même le plus facile court : bien plus vite que le pilote automatique de balade.
          expect(t.temps / ref.auto, ici).toBeLessThan(0.75);
        }
        // Le plus facile se bat en conduisant proprement : plus lent que la conduite de référence.
        expect(temps[0]!.temps, ici).toBeGreaterThan(ref.main);
        for (let i = 1; i < temps.length; i += 1) expect(temps[i]!.temps, ici).toBeLessThan(temps[i - 1]!.temps);
        // Le plus facile : au plus un tiers de plus que la référence (de l'ordre de l'argent, 1,25).
        expect(temps[0]!.temps / ref.main, ici).toBeLessThan(1.4);
      }
      // Pluie et neige : il freine pour l'adhérence de la météo, sans sortir.
      const parMeteo = (['sec', 'pluie', 'neige'] as Weather[]).map((m) => simulerAdversaire(adversaireSimule(map.id, VEHICLES[0]!.id, plusDur()), start.at, 1, m));
      for (const t of parMeteo) expect(t.dehors, map.id).toBe(0);
      expect(parMeteo[1]!.temps).toBeGreaterThan(parMeteo[0]!.temps);
      expect(parMeteo[2]!.temps).toBeGreaterThan(parMeteo[1]!.temps);
    }
  });

  it.skipIf(built.length === 0)('NOS : jamais en Facile ; en Normal et Difficile, en sortie de virage, au début des lignes droites, jamais au départ arrêté ; toujours aux mêmes endroits', { timeout: 120_000 }, () => {
    expect(NIVEAUX_DUEL[0]!.nos).toBe(0);
    for (const n of NIVEAUX_DUEL.slice(1)) expect(n.nos).toBeGreaterThan(0);
    for (const map of built) {
      const start = plusCourt(map.id);
      const envois = NIVEAUX_DUEL.map((n) => {
        const p = adversaireSimule(map.id, 'sportive', n);
        // Où il appuie : chaque appui tombe sur un point fixé d'avance, après nosDepart m de chemin.
        const appuis: number[] = [];
        const step = p.pilot.step.bind(p.pilot);
        let vu = 0;
        p.pilot.step = (dt, input, kind) => {
          const m = step(dt, input, kind);
          if ((input.nos ?? 0) !== vu) {
            vu = input.nos ?? 0;
            appuis.push(p.parcouru);
          }
          return m;
        };
        simulerAdversaire(p, start.at, 1, 'sec');
        for (const a of appuis) expect(a, map.id).toBeGreaterThanOrEqual(PILOTAGE_ADVERSAIRE.nosDepart);
        if (n.nos > 0) for (const x of p.nosPoints) expect(Math.abs(p.pilot.line.curvature[Math.round(x / p.pilot.line.step) % p.pilot.line.curvature.length]!)).toBeLessThan(1 / PILOTAGE_ADVERSAIRE.nosRayon);
        return p.nosEnvois;
      });
      expect(envois[0], map.id).toBe(0);
    }
    // Les points sont ceux de la carte, pas du hasard : deux fois les mêmes.
    const a = adversaireSimule(built[0]!.id, 'sportive', plusDur()).nosPoints;
    expect([...adversaireSimule(built[0]!.id, 'sportive', plusDur()).nosPoints]).toEqual([...a]);
    expect(a.length).toBeGreaterThan(0);
  });

  it.skipIf(built.length === 0)('déterministe : même course, même adversaire, même niveau, même temps', { timeout: 60_000 }, () => {
    const map = built[0]!;
    const start = plusCourt(map.id);
    for (const n of [NIVEAUX_DUEL[0]!, plusDur()]) {
      const un = simulerAdversaire(adversaireSimule(map.id, VEHICLES[0]!.id, n, 'dede'), start.at, 1, 'sec');
      const deux = simulerAdversaire(adversaireSimule(map.id, VEHICLES[0]!.id, n, 'dede'), start.at, 1, 'sec');
      expect(deux.temps).toBe(un.temps);
    }
  });
});

// Vague W, 20 novembre 2026 : « au premier virage elle a freiné tellement que je l'ai dépassée sans souci ».
/** Vitesse (m/s), chemin fait (m) et frein, pas à pas, de ce que `pilot` roule pendant `courir`. */
function releve(pilot: PilotWithProfile, courir: () => void): { d: number[]; v: number[]; frein: number[] } {
  const out = { d: [] as number[], v: [] as number[], frein: [] as number[] };
  const step = pilot.step.bind(pilot);
  let fait = 0;
  pilot.step = (dt, input, kind) => {
    const m = step(dt, input, kind);
    fait += m.speed * dt;
    out.d.push(fait);
    out.v.push(m.speed);
    out.frein.push(input.brake);
    return m;
  };
  courir();
  return out;
}

/** Les `n` premiers virages où la conduite de référence ralentit : chemin fait (m) et vitesse de passage (m/s). */
function premiersVirages(r: { d: number[]; v: number[] }, n: number): { d: number; v: number }[] {
  const out: { d: number; v: number }[] = [];
  let haut = 0;
  for (let i = 1; i < r.v.length - 1 && out.length < n; i += 1) {
    haut = Math.max(haut, r.v[i]!);
    if (r.v[i]! <= r.v[i - 1]! && r.v[i]! < r.v[i + 1]! && r.v[i]! < 0.92 * haut) {
      out.push({ d: r.d[i]!, v: r.v[i]! });
      haut = 0;
    }
  }
  return out;
}

/** Le joueur qui ne freine jamais : direction assistée, plein gaz, sans NOS ; temps du vert à l'arrivée (s). */
function pleinGaz(pilot: PilotWithProfile, at: number): number {
  pilot.setWeather('sec');
  pilot.setHold(false);
  pilot.reset(at);
  const etat = armerDepart(createDepart(), pilot.motion.s, pilot.rail.loop, false, 1);
  etat.phase = 'parti';
  etat.vert = true;
  etat.depuisVert = Infinity;
  const input: DriveInput = { auto: false, throttle: 1, brake: 0, lane: 0, assist: true };
  for (let t = 0; t < 3600 && (etat.phase as string) !== 'arrive'; t += SIMULATION.dt) {
    const m = pilot.step(SIMULATION.dt, input, pilot.performance.kind);
    pasDepart(etat, SIMULATION.dt, true, m.s, pilot.rail, m.finished);
  }
  return (etat.phase as string) === 'arrive' ? etat.arrivee / 1000 : Infinity;
}

describe('il freine juste', () => {
  it.skipIf(built.length === 0)('aux deux premiers virages de chaque carte, la moto ne freine jamais sous la vitesse de passage de la conduite de référence ; en Difficile, elle n’y freine pas', { timeout: 300_000 }, () => {
    // Normal et Difficile : à un dixième de seconde de frein à fond près (le pas des décisions, celui de la référence).
    const tolerance = PILOT.manual.brake * SIMULATION.dt;
    for (const map of built) {
      const start = route(map.id).starts[0]!;
      for (const v of VEHICLES.filter((x) => x.kind === 'bike')) {
        const pilot = piloteDeSimulation(route(map.id), performanceDe(v));
        const ref = releve(pilot, () => simulerCourse(pilot, { at: start.at, tours: 1, meteo: 'sec', conduite: 'main', max: 90 }));
        const virages = premiersVirages(ref, 2);
        expect(virages.length, map.id).toBe(2);
        for (const n of NIVEAUX_DUEL) {
          const p = adversaireSimule(map.id, v.id, n);
          const adv = releve(p.pilot, () => simulerAdversaire(p, start.at, 1, 'sec', 0.1, 90));
          virages.forEach((virage, k) => {
            // Son approche : 150 m avant, sans remonter au virage d'avant ; au-delà, il freine pour le suivant.
            const debut = Math.max(virage.d - 150, k > 0 ? virages[k - 1]!.d : -Infinity);
            const ici = `${map.id}/${start.id}/${v.id}/${n.id} à ${virage.d.toFixed(0)} m`;
            // Vitesse la plus basse au virage, et au sortir d'un coup de frein dans son approche.
            let min = Infinity;
            let minFrein = Infinity;
            for (let i = 0; i < adv.d.length; i += 1) {
              const d = adv.d[i]!;
              if (Math.abs(d - virage.d) <= 30) min = Math.min(min, adv.v[i]!);
              if (d > debut && d <= virage.d && adv.frein[i]! > 0) minFrein = Math.min(minFrein, adv.v[i]!);
            }
            if (process.env.PMB_MESURES_VIRAGES) appendFileSync(process.env.PMB_MESURES_VIRAGES, `| ${ici} | réf ${(virage.v * 3.6).toFixed(0)} km/h | ${(min * 3.6).toFixed(0)} km/h | ${Number.isFinite(minFrein) ? `freine jusqu'à ${(minFrein * 3.6).toFixed(0)} km/h` : 'ne freine pas'} |\n`);
            // Plus lent que la référence sans freiner (gaz et pointe de son allure, côte) : ce n'est pas son frein.
            // Le Facile lit la route comme la référence, avec moins de gaz : il arrive moins vite, son frein mord
            // mieux (il monte en une demi-seconde) ; à 10 % près.
            expect(minFrein, ici).toBeGreaterThanOrEqual(n === NIVEAUX_DUEL[0] ? 0.9 * virage.v : virage.v - tolerance);
            if (n === plusDur()) {
              expect(minFrein, ici).toBe(Infinity);
              expect(min, ici).toBeGreaterThanOrEqual(virage.v);
            }
          });
        }
      }
    }
  });

  const OCEAN = { map: 'miami-beach', start: 'ocean-drive' };
  it.skipIf(!built.some((m) => m.id === OCEAN.map))('en Difficile, il bat le joueur qui ne freine jamais sur Ocean Drive, à chaque véhicule ; le Facile reste derrière la conduite de référence', { timeout: 300_000 }, () => {
    const at = route(OCEAN.map).starts.find((s) => s.id === OCEAN.start)!.at;
    for (const v of VEHICLES) {
      const joueur = pleinGaz(piloteDeSimulation(route(OCEAN.map), performanceDe(v)), at);
      const difficile = simulerAdversaire(adversaireSimule(OCEAN.map, v.id, plusDur()), at, 1, 'sec');
      const facile = simulerAdversaire(adversaireSimule(OCEAN.map, v.id, NIVEAUX_DUEL[0]!), at, 1, 'sec');
      const ref = tempsReference(OCEAN.map, OCEAN.start, 'tour1', v.id)!;
      if (process.env.PMB_MESURES_VIRAGES) appendFileSync(process.env.PMB_MESURES_VIRAGES, `| ocean-drive/${v.id} | plein gaz ${joueur.toFixed(1)} s | Difficile ${difficile.temps.toFixed(1)} s | Facile ${facile.temps.toFixed(1)} s | référence ${ref.main.toFixed(1)} s |\n`);
      expect(difficile.temps, v.id).toBeLessThan(joueur);
      expect(difficile.dehors, v.id).toBe(0);
      expect(facile.temps, v.id).toBeGreaterThan(ref.main);
    }
  });
});

describe('son pilote', () => {
  it.skipIf(!VEHICLES.every((v) => existsSync(`public/assets/vehicles/${v.id}/body.glb`)))('s’assoit sur chaque véhicule du catalogue sans habitacle posé (siège et jante par défaut sur les ancres)', async () => {
    for (const v of VEHICLES) {
      const model = await storedModel(v.id);
      const { seating, pending } = measureSeating(model, model, v, true);
      expect(pending, v.id).toBe(false);
      expect(seating?.kind, v.id).toBe(v.kind);
    }
  }, 30_000); // cinq modèles chargés : plus de 5 s sur une machine chargée
});

// Mesures des modèles (boîtes des GLB construits) : le plus large (2,26 × 4,92 m), une voiture moyenne (1,64 ×
// 3,82 m), une moto (0,73 × 1,95 m).
const LARGE: CorpsGrille = { demiLargeur: 1.13, demiLongueur: 2.46, kind: 'car' };
const MOYENNE: CorpsGrille = { demiLargeur: 0.82, demiLongueur: 1.91, kind: 'car' };
const MOTO: CorpsGrille = { demiLargeur: 0.365, demiLongueur: 0.98, kind: 'bike' };
const PAIRES: [string, CorpsGrille, CorpsGrille][] = [
  ['large+large', LARGE, LARGE],
  ['moto+large', MOTO, LARGE],
  ['moyenne+moyenne', MOYENNE, MOYENNE],
  ['moyenne+moto', MOYENNE, MOTO],
];

describe('la grille de départ', () => {
  it.skipIf(built.length === 0)('chaque départ de chaque carte : sur la chaussée, sans se toucher, côte à côte quand la place y est, alignés', { timeout: 120_000 }, () => {
    const pose = createPose();
    const lim: [number, number] = [0, 0];
    for (const map of built) {
      const rail = createRail(route(map.id));
      for (const start of route(map.id).starts) {
        for (const [nom, J, A] of PAIRES) {
          const ici = `${map.id}/${start.id}/${nom}`;
          const pilot = createPilot(rail, performanceDe(VEHICLES.find((v) => v.kind === J.kind)!));
          pilot.setSize(J.demiLargeur, J.demiLongueur);
          pilot.reset(start.at);
          const g: Grille = grilleDepart(rail, pilot.motion.s, pilot.motion.offset, J, A, 0.3, {} as Grille);
          // Chacun dans ses limites (garde au bord comprise), sur toute sa longueur.
          for (const [s, off, C] of [[g.sJoueur, g.offsetJoueur, J], [g.sAdversaire, g.offsetAdversaire, A]] as const) {
            for (const k of [-1, 0, 1]) {
              laneLimits(rail.poseAt(s + k * C.demiLongueur, pose), C.kind, C.demiLargeur, C.demiLongueur, lim);
              expect(off, ici).toBeGreaterThanOrEqual(lim[0] - 0.02);
              expect(off, ici).toBeLessThanOrEqual(lim[1] + 0.02);
            }
          }
          const cj: CorpsRoute = { s: g.sJoueur, offset: g.offsetJoueur, demiLargeur: J.demiLargeur, demiLongueur: J.demiLongueur };
          const ca: CorpsRoute = { s: g.sAdversaire, offset: g.offsetAdversaire, demiLargeur: A.demiLargeur, demiLongueur: A.demiLongueur };
          expect(recouvrement(cj, ca, rail.length, rail.loop), ici).toBe(false);
          const largeur = rail.poseAt(g.sJoueur, pose).width;
          if (g.mode === 'cote') {
            // Flancs à 30 cm au moins, avants alignés (ou l'adversaire à peine devant au tout début d'une route ouverte).
            expect(Math.abs(g.offsetAdversaire - g.offsetJoueur) - J.demiLargeur - A.demiLargeur, ici).toBeGreaterThanOrEqual(0.3 - 1e-9);
            if (rail.loop || g.sJoueur > 5) expect(g.sAdversaire + A.demiLongueur, ici).toBeCloseTo(g.sJoueur + J.demiLongueur, 6);
            // Route large : le joueur au milieu de sa moitié, l'adversaire dans l'autre, au moins aussi loin de l'axe.
            if (largeur / 4 >= Math.max(J.demiLargeur, A.demiLargeur) + 0.45 + 0.1 && rail.poseAt(g.sJoueur, pose).curvature === 0) {
              expect(Math.abs(g.offsetJoueur), ici).toBeCloseTo(largeur / 4, 1);
              expect(Math.sign(g.offsetAdversaire), ici).toBe(-Math.sign(g.offsetJoueur));
              expect(Math.abs(g.offsetAdversaire), ici).toBeGreaterThanOrEqual(largeur / 4 - 0.05);
            }
          } else {
            // Quinconce : seulement quand deux de front ne tiennent pas sur leur longueur ; le joueur n'a pas bougé.
            const etroite = Math.min(...[-1, 0, 1].map((k) => rail.poseAt(g.sJoueur + k * Math.max(J.demiLongueur, A.demiLongueur), pose).width));
            expect(etroite, ici).toBeLessThan(2 * (J.demiLargeur + A.demiLargeur) + 0.3 + 2 * 0.45 + 1.5);
            expect(g.offsetJoueur, ici).toBe(pilot.motion.offset);
          }
        }
      }
    }
  });

  // Direction libre (le réglage par défaut), manche lâché : le joueur part tout droit de sa place, jusqu'à 0,8 s
  // après le vert (au-delà, sans tenir le manche, la route tourne, il traverse et vient serrer l'adversaire contre
  // son bord : l'adversaire recule alors d'un coup derrière lui, src/drive/adversaire/contact.ts, pas corrigé).
  it.skipIf(built.length === 0)('apparition, feux et vert : ni saut, ni recouvrement, ni travers', { timeout: 300_000 }, () => {
    for (const map of built) {
      const r = route(map.id);
      const rail = createRail(r);
      for (const start of r.starts) {
        for (const [nom, J, A] of [PAIRES[0]!, PAIRES[2]!]) {
          const ici = `${map.id}/${start.id}/${nom}`;
          const vehiculeA = VEHICLES.find((v) => v.kind === A.kind)!;
          const duel = new DuelEnCourse(ADVERSAIRES.find((a) => a.vehicule === vehiculeA.id)!, vehiculeA, rail, plusDur());
          duel.mesurer(A.demiLargeur, A.demiLongueur);
          const joueur = createPilot(rail, performanceDe(VEHICLES.find((v) => v.kind === J.kind)!));
          joueur.setSize(J.demiLargeur, J.demiLongueur);
          joueur.reset(start.at);
          const depart = armerDepart(createDepart(), joueur.motion.s, rail.loop, false, 1);
          duel.depart(joueur, J.kind, joueur.motion.s, joueur.motion.offset, J.demiLargeur, J.demiLongueur, 1, true);
          const input: DriveInput = { auto: false, throttle: 1, brake: 0, lane: 0, steer: 0 };
          let oj = joueur.motion.offset;
          let oa = duel.offset;
          let sa = duel.pilote.pilot.motion.s;
          let sautJ = 0;
          let sautA = 0;
          let recul = 0;
          let recouvre = 0;
          let travers = 0;
          for (let t = 0; t < 30 && !(depart.phase === 'parti' && depart.depuisVert > 0.8); t += 0.1) {
            joueur.setHold(depart.phase === 'attente' || depart.phase === 'feux');
            const m = joueur.step(0.1, input, J.kind);
            pasDepart(depart, 0.1, true, m.s, rail, m.finished);
            duel.pas(0.1, joueur, depart, J.demiLargeur, J.demiLongueur);
            // À l'apparition, aux feux et au départ (moins de 5 m/s) : aucun mouvement de côté brusque.
            if (joueur.motion.speed < 5) sautJ = Math.max(sautJ, Math.abs(joueur.motion.offset - oj));
            if (duel.pilote.pilot.motion.speed < 5) sautA = Math.max(sautA, Math.abs(duel.offset - oa));
            recul = Math.max(recul, -devant(sa, duel.pilote.pilot.motion.s, rail.length, rail.loop));
            // Le joueur, manche lâché, garde son cap quand la route tourne : seul l'adversaire est jugé après le vert.
            if (Math.abs(duel.pilote.pilot.motion.yaw ?? 0) > 0.2 || (depart.phase !== 'parti' && Math.abs(joueur.motion.yaw ?? 0) > 0.01)) travers += 1;
            oj = joueur.motion.offset;
            oa = duel.offset;
            sa = duel.pilote.pilot.motion.s;
            const cj: CorpsRoute = { s: joueur.motion.s, offset: joueur.motion.offset, demiLargeur: J.demiLargeur, demiLongueur: J.demiLongueur };
            const ca: CorpsRoute = { s: duel.pilote.pilot.motion.s, offset: duel.offset, demiLargeur: A.demiLargeur, demiLongueur: A.demiLongueur };
            if (recouvrement(cj, ca, rail.length, rail.loop)) recouvre += 1;
          }
          expect(depart.phase, ici).toBe('parti');
          expect(recouvre, ici).toBe(0);
          // Au départ, au plus 30 cm de côté par dixième de seconde (le glissement d'évitement, 3 m/s au plus :
          // contact.ecartParSeconde ; pas un saut), jamais en arrière, jamais de travers.
          expect(sautJ, ici).toBeLessThan(0.301);
          expect(sautA, ici).toBeLessThan(0.301);
          expect(recul, ici).toBeLessThan(0.01);
          expect(travers, ici).toBe(0);
        }
      }
    }
  });
});

describe('contact', () => {
  const reglage = { garde: 0.3, approche: 6, relache: 12, ecartParSeconde: 3, frottement: 2, cedeParSeconde: 6 };

  it('devant, replié sur une boucle', () => {
    expect(devant(10, 30, 1000, false)).toBe(20);
    expect(devant(990, 10, 1000, true)).toBe(20);
    expect(devant(10, 990, 1000, true)).toBe(-20);
  });

  it('côte à côte : l’adversaire s’écarte ; flanc contre flanc : ils se poussent et frottent ; trop étroit : celui de derrière cède peu à peu', () => {
    const c = createContact();
    const j: CorpsRoute = { s: 100, offset: 0, demiLargeur: 0.95, demiLongueur: 2.2 };
    const a: CorpsRoute = { s: 101, offset: 0.5, demiLargeur: 0.95, demiLongueur: 2.2 };
    // Large : il prend sa gauche et s'écarte peu à peu, sans sortir de [lo, hi].
    for (let i = 0; i < 30; i += 1) pasContact(c, j, a, -3, 3, -3, 3, reglage, 0.1, 1000, false);
    expect(c.cote).toBe(1);
    expect(a.offset + c.ecart).toBeGreaterThanOrEqual(j.demiLargeur + a.demiLargeur + reglage.garde - 1e-9);
    expect(a.offset + c.ecart).toBeLessThanOrEqual(3);
    // Flanc contre flanc, l'adversaire au bord : le joueur est repoussé de côté (poussée), aucun des deux retenu.
    const f = createContact();
    expect(pasContact(f, j, { ...a, offset: 1.5 }, 1.5, 1.5, -3, 3, reglage, 0.1, 1000, false)).toBeNull();
    expect(f.frotte).toBe(true);
    expect(f.pousse).toBeCloseTo(-(1.9 - 1.5) - 1e-3, 6);
    // Étroit : impossible de passer à deux. À sa hauteur (1 m), l'adversaire cède, de cedeParSeconde × dt au plus ;
    // nettement derrière (3 m), le joueur cède.
    const d = createContact();
    expect(pasContact(d, j, { ...a }, -0.6, 0.6, -0.6, 0.6, reglage, 0.1, 1000, false)).toBe('adversaire');
    expect(d.recul).toBeCloseTo(0.6, 9);
    expect(pasContact(createContact(), j, { ...a, s: 103 }, -0.6, 0.6, -0.6, 0.6, reglage, 0.1, 1000, false)).toBe('joueur');
    // Nez contre pare-chocs : celui de derrière est arrêté contre celui de devant (de ce qui dépasse, quelques centimètres).
    const n = createContact();
    expect(pasContact(n, j, { ...a, s: 104.3, offset: 0 }, 0, 0, 0, 0, reglage, 0.1, 1000, false)).toBe('joueur');
    expect(n.recul).toBeCloseTo(0.12, 9);
    // Loin : rien.
    const e = createContact();
    expect(pasContact(e, j, { ...a, s: 200 }, -0.6, 0.6, -0.6, 0.6, reglage, 0.1, 1000, false)).toBeNull();
    expect(e.cote).toBe(0);
  });

  it('derrière le joueur, il prend le côté où la chaussée a la place de passer ; devant, il garde le sien', () => {
    // Le joueur à gauche de l'axe (1 m) : à gauche, plus la place ; il double par la droite.
    expect(coteLibre(-8, 1.2, 1, 2.2, -2.5, 2.5)).toBe(-1);
    // Devant ou à sa hauteur : il garde son côté (le joueur double de l'autre).
    expect(coteLibre(2, 1.2, 1, 2.2, -2.5, 2.5)).toBe(1);
    expect(coteLibre(-8, -1, 0, 2.2, -2.5, 2.5)).toBe(-1);
  });

  // Le joueur (plus rapide) rattrape l'adversaire (le plus facile) et le double : jamais de recouvrement.
  it.skipIf(built.length === 0)('pas de recouvrement des deux véhicules sur une course', { timeout: 120_000 }, () => {
    const map = built.find((m) => route(m.id).loop) ?? built[0]!;
    const r = route(map.id);
    const rail = createRail(r);
    const start = r.starts[0]!;
    const a = ADVERSAIRES.find((x) => vehicleById(x.vehicule)?.kind === 'car')!;
    const duel = new DuelEnCourse(a, vehicleById(a.vehicule)!, rail, NIVEAUX_DUEL[0]!);
    const joueur = createPilot(rail, performanceDe(vehicleById('concept')!));
    joueur.reset(start.at);
    const depart = armerDepart(createDepart(), joueur.motion.s, rail.loop, false, 1);
    duel.depart(joueur, 'car', joueur.motion.s, joueur.motion.offset, 0.95, 2.2, 1, true);
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

// Un duel hors navigateur, le joueur simulé par la conduite appliquée de référence (src/drive/simulationCourse.ts,
// via le pilote de l'adversaire, à son niveau) : quand il rattrape l'adversaire, il demande le côté libre ; sinon
// il garde sa trajectoire. Mesure les dépassements, les blocages, les recouvrements et les sauts.
interface MesureDuel {
  depassementsJoueur: number;
  depassementsAdversaire: number;
  /** Épisodes d'au moins 1 s où le plus rapide est retenu derrière l'autre. */
  blocages: number;
  /** Pas où les deux caisses se recouvrent de plus de 2 cm. */
  recouvrements: number;
  /** Pas où l'un des deux recule ou avance plus que sa vitesse ne le permet, ou est déplacé de côté de plus de 0,6 m au-delà de ce que fait son pilote. */
  sauts: number;
  /** NOS envoyés par l'adversaire, et sa vitesse la plus haute (m/s). */
  nos: number;
  temps: number;
}

function duelSimule(o: { map: string; start: string; vJ: string; nJ: NiveauDuel; adversaire: string; nA: NiveauDuel; avanceJoueur: number; avanceAdversaire: number; dims?: CorpsGrille; max?: number; steerJoueur?: (t: number, cote: number) => number | undefined }): MesureDuel {
  const r = route(o.map);
  const rail = createRail(r);
  const start = r.starts.find((x) => x.id === o.start)!;
  const adv = ADVERSAIRES.find((x) => x.id === o.adversaire)!;
  const duel = new DuelEnCourse(adv, vehicleById(adv.vehicule)!, rail, o.nA);
  const dims = o.dims ?? { demiLargeur: 0.95, demiLongueur: 2.2, kind: 'car' };
  duel.mesurer(dims.demiLargeur, dims.demiLongueur);
  const pj = createPiloteAdversaire(createPilot(rail, performanceDe(vehicleById(o.vJ)!)), { ...o.nJ, nos: 0 }, PILOTAGE_ADVERSAIRE, 7);
  const joueur = pj.pilot;
  joueur.setSize(dims.demiLargeur, dims.demiLongueur);
  joueur.reset(start.at);
  remettreAdversaire(pj, start.at, joueur.motion.offset);
  const depart = armerDepart(createDepart(), joueur.motion.s, rail.loop, false, 1);
  duel.depart(joueur, dims.kind, joueur.motion.s, joueur.motion.offset, dims.demiLargeur, dims.demiLongueur, 1, true);
  if (o.avanceJoueur > 0) remettreAdversaire(pj, start.at + o.avanceJoueur, duel.grille.offsetJoueur);
  if (o.avanceAdversaire > 0) remettreAdversaire(duel.pilote, duel.grille.sAdversaire + o.avanceAdversaire, duel.grille.offsetAdversaire);
  depart.phase = 'parti';
  depart.vert = true;
  depart.depuisVert = Infinity;
  const longueurs = 2 * dims.demiLongueur;
  const out: MesureDuel = { depassementsJoueur: 0, depassementsAdversaire: 0, blocages: 0, recouvrements: 0, sauts: 0, nos: 0, temps: 0 };
  const dt = 0.1;
  let etat = Math.sign(devant(joueur.motion.s, duel.pilote.pilot.motion.s, rail.length, rail.loop));
  let retenu = 0;
  let sJ = joueur.motion.s;
  let sA = duel.pilote.pilot.motion.s;
  // Chacun va de côté où son pilote le met (`lJ`, `lA`) : seul ce que le contact ajoute compte.
  let oJ = joueur.motion.offset;
  let lJ = oJ;
  let oA = duel.offset;
  let lA = duel.pilote.pilot.motion.offset;
  let nosAvant = false;
  const plusRapide = o.nJ.allure >= o.nA.allure ? 'joueur' : 'adversaire';
  for (let t = 0; t < (o.max ?? 150) && !joueur.motion.finished && !duel.pilote.pilot.motion.finished; t += dt) {
    const d = devant(joueur.motion.s, duel.pilote.pilot.motion.s, rail.length, rail.loop);
    // Le joueur qui rattrape demande le côté libre (celui où l'adversaire n'est pas) ; sinon sa trajectoire.
    pj.lane = d > 0 && d < longueurs + 20 ? (duel.offset >= joueur.motion.offset ? 1 : -1) : d > -longueurs ? pj.lane : 0;
    pj.input.steer = o.steerJoueur?.(t, duel.offset >= joueur.motion.offset ? 1 : -1);
    pj.input.assist = pj.input.steer === undefined;
    pasAdversaire(pj, dt, false);
    pasDepart(depart, dt, true, joueur.motion.s, rail, joueur.motion.finished);
    duel.pas(dt, joueur, depart, dims.demiLargeur, dims.demiLongueur);
    const nd = devant(joueur.motion.s, duel.pilote.pilot.motion.s, rail.length, rail.loop);
    // Dépassement : de franchement derrière à franchement devant.
    if (nd > longueurs) {
      if (etat < 0) out.depassementsAdversaire += 1;
      etat = 1;
    } else if (nd < -longueurs) {
      if (etat > 0) out.depassementsJoueur += 1;
      etat = -1;
    }
    if (duel.retenue === plusRapide) retenu += dt;
    else {
      if (retenu >= 1) out.blocages += 1;
      retenu = 0;
    }
    const cj: CorpsRoute = { s: joueur.motion.s, offset: joueur.motion.offset, demiLargeur: dims.demiLargeur - 0.01, demiLongueur: dims.demiLongueur - 0.01 };
    const ca: CorpsRoute = { s: duel.pilote.pilot.motion.s, offset: duel.offset, demiLargeur: dims.demiLargeur - 0.01, demiLongueur: dims.demiLongueur - 0.01 };
    if (recouvrement(cj, ca, rail.length, rail.loop)) out.recouvrements += 1;
    const pasJ = devant(sJ, joueur.motion.s, rail.length, rail.loop);
    const pasA = devant(sA, duel.pilote.pilot.motion.s, rail.length, rail.loop);
    if (pasJ < -0.05 || pasJ > 95 * dt || pasA < -0.05 || pasA > 95 * dt || Math.abs(joueur.motion.offset - oJ) - Math.abs(joueur.motion.offset - duel.contact.pousse - lJ) > 0.6 || Math.abs(duel.offset - oA) - Math.abs(duel.pilote.pilot.motion.offset - lA) > 0.6) out.sauts += 1;
    sJ = joueur.motion.s;
    sA = duel.pilote.pilot.motion.s;
    oJ = joueur.motion.offset;
    lJ = joueur.motion.offset - duel.contact.pousse;
    oA = duel.offset;
    lA = duel.pilote.pilot.motion.offset;
    const brule = duel.pilote.pilot.train.nos;
    if (brule && !nosAvant) out.nos += 1;
    nosAvant = brule;
    out.temps = t;
  }
  if (retenu >= 1) out.blocages += 1;
  return out;
}

describe('le contact en course : plus de saut, on double', () => {
  // Le saut d'avant : l'adversaire serré contre son bord par le joueur à sa hauteur reculait d'un coup derrière lui.
  // On le provoque en braquant vers lui juste après le départ (direction libre), sur chaque carte construite.
  it.skipIf(built.length === 0)('serré contre son bord par le joueur à sa hauteur, l’adversaire ne saute plus ; ils frottent, ne se traversent pas', { timeout: 120_000 }, () => {
    for (const map of built) {
      const start = plusCourt(map.id);
      for (const steer of [0.35, 1]) {
        const m = duelSimule({ map: map.id, start: start.id, vJ: 'sportive', nJ: plusDur(), adversaire: 'comete', nA: plusDur(), avanceJoueur: 0, avanceAdversaire: 0, max: 12, steerJoueur: (t, cote) => (t < 6 ? -cote * steer : undefined) });
        const ici = `${map.id}/${start.id}/braque ${steer}`;
        expect(m.sauts, ici).toBe(0);
        expect(m.recouvrements, ici).toBe(0);
      }
    }
  });
});

// Dépassements mesurés (rendu de la vague W) : une route large (miami-beach, deux voitures moyennes) et une route
// étroite (monaco-ville, deux vans), chaque départ, le plus rapide parti 40 m derrière l'autre (le plus rapide
// court la conduite de référence, l'autre le niveau Facile).
const CAS_DEPASSEMENT = [
  { map: 'miami-beach', vehicule: 'cox', adversaire: 'dede', dims: MOYENNE },
  { map: 'monaco-ville', vehicule: 'van', adversaire: 'momo', dims: LARGE },
] as const;

function mesurerDepassements(cas: (typeof CAS_DEPASSEMENT)[number], plusRapide: 'joueur' | 'adversaire') {
  const total = { departs: 0, depassements: 0, blocages: 0, recouvrements: 0, sauts: 0, nos: 0 };
  const lent = NIVEAUX_DUEL[0]!;
  for (const start of route(cas.map).starts) {
    const m = duelSimule({
      map: cas.map,
      start: start.id,
      vJ: cas.vehicule,
      nJ: plusRapide === 'joueur' ? plusDur() : lent,
      adversaire: cas.adversaire,
      nA: plusRapide === 'joueur' ? lent : plusDur(),
      avanceJoueur: plusRapide === 'joueur' ? 0 : 40,
      avanceAdversaire: plusRapide === 'joueur' ? 40 : 0,
      dims: cas.dims,
      max: 150,
    });
    total.departs += 1;
    total.depassements += plusRapide === 'joueur' ? m.depassementsJoueur : m.depassementsAdversaire;
    total.blocages += m.blocages;
    total.recouvrements += m.recouvrements;
    total.sauts += m.sauts;
    total.nos += m.nos;
    // Le tableau du rendu : PMB_MESURES_DUEL=<fichier> (une ligne par départ).
    if (process.env.PMB_MESURES_DUEL) appendFileSync(process.env.PMB_MESURES_DUEL, `| ${cas.map}/${start.id} | ${cas.vehicule} | plus rapide : ${plusRapide} | dépassements ${plusRapide === 'joueur' ? m.depassementsJoueur : m.depassementsAdversaire} (l'autre : ${plusRapide === 'joueur' ? m.depassementsAdversaire : m.depassementsJoueur}) | blocages ${m.blocages} | recouvrements ${m.recouvrements} | sauts ${m.sauts} | NOS ${m.nos} | ${m.temps.toFixed(0)} s |\n`);
  }
  return total;
}

describe('on double', () => {
  it.skipIf(!CAS_DEPASSEMENT.every((c) => built.some((m) => m.id === c.map)))('route large : le plus rapide double, joueur ou adversaire ; route étroite : on attend la place ; jamais de recouvrement ni de saut', { timeout: 300_000 }, () => {
    const [large, etroite] = CAS_DEPASSEMENT;
    for (const plusRapide of ['joueur', 'adversaire'] as const) {
      const l = mesurerDepassements(large, plusRapide);
      const e = mesurerDepassements(etroite, plusRapide);
      const ici = `plus rapide : ${plusRapide}`;
      // Sur la route large, il double à chaque départ.
      expect(l.depassements, ici).toBe(l.departs);
      for (const t of [l, e]) {
        expect(t.recouvrements, ici).toBe(0);
        expect(t.sauts, ici).toBe(0);
      }
      // Sur la route étroite, il est retenu plus souvent qu'il ne passe (pas de passage magique).
      expect(e.blocages, ici).toBeGreaterThan(0);
    }
  });
});

// L'arrivée (demande du 20 novembre 2026 : « si un participant arrive sur la ligne d'arrivée il bloque les autres
// potentiellement. Il faut pas que ça bloque une fois sur la ligne ») : celui de devant passe la ligne au ralenti
// (8 m/s), l'autre arrive lancé (20 m/s) 3 m derrière lui, au même écart, le même véhicule des deux côtés : deux
// vans sur la route étroite (le bout de Monaco-Ville, 6 m), deux voitures sur la boucle. Le joueur en conduite
// appliquée (gaz à fond, direction assistée), en pilote automatique une fois arrivé, comme dans la scène.
// `seul` : celui de devant posé 300 m derrière l'autre, pour le temps que l'autre fait sans lui.
const ARRIVEES = [
  { map: 'monaco-ville', nom: 'route ouverte étroite, deux vans', adversaire: 'momo', dims: LARGE },
  { map: 'monaco-circuit', nom: 'boucle, deux voitures', adversaire: 'comete', dims: MOYENNE },
] as const;

function arriveeSerree(cas: (typeof ARRIVEES)[number], devantQui: 'joueur' | 'adversaire', seul = false) {
  const { demiLargeur: dl, demiLongueur: dL } = cas.dims;
  const r = route(cas.map);
  const rail = createRail(r);
  const L = rail.length;
  const sur = (x: number) => (rail.loop ? ((x % L) + L) % L : x);
  const ligne = r.starts[0]!.at;
  const fin = rail.loop ? ligne : L;
  const adv = ADVERSAIRES.find((a) => a.id === cas.adversaire)!;
  const vehicule = vehicleById(adv.vehicule)!;
  const duel = new DuelEnCourse(adv, vehicule, rail, plusDur());
  duel.mesurer(dl, dL);
  const joueur = createPilot(rail, performanceDe(vehicule));
  joueur.setSize(dl, dL);
  joueur.reset(ligne);
  duel.depart(joueur, 'car', ligne, joueur.motion.offset, dl, dL, 1, true);
  const sDerriere = sur(fin - 0.5 - 2 * dL - 3);
  const sDevant = seul ? sur(sDerriere - 300) : sur(fin - 0.5);
  const [sJ, sA] = devantQui === 'joueur' ? [sDevant, sDerriere] : [sDerriere, sDevant];
  joueur.reset(sur(fin - 0.5));
  const offset = joueur.motion.offset;
  joueur.reset(sJ);
  joueur.motion.offset = offset;
  joueur.motion.speed = devantQui === 'joueur' ? 8 : 20;
  remettreAdversaire(duel.pilote, sA, offset);
  duel.pilote.pilot.motion.speed = devantQui === 'joueur' ? 20 : 8;
  // La course lancée, le dernier tour presque bouclé (sur une route ouverte, l'arrivée est au bout).
  const depart = armerDepart(createDepart(), ligne, rail.loop, false, 1);
  depart.phase = 'parti';
  depart.vert = true;
  depart.depuisVert = Infinity;
  depart.sPrec = sJ;
  depart.parcouru = rail.loop ? L - devant(sJ, fin, L, true) : sJ - ligne;
  const input: DriveInput = { auto: false, throttle: 1, brake: 0, lane: 0, assist: true };
  const adversaire = duel.duel.adv;
  const arrive = (qui: 'joueur' | 'adversaire') => (qui === 'joueur' ? depart.phase === 'arrive' : adversaire.phase === 'arrive');
  const derriere = devantQui === 'joueur' ? 'adversaire' : 'joueur';
  // Pas où le contact a joué (retenue ou frottement) une fois celui de devant arrivé.
  let gene = 0;
  // Le duel part (l'adversaire compte sa course depuis la ligne du joueur).
  duel.pas(0, joueur, depart, dl, dL);
  adversaire.parcouru = depart.parcouru + devant(sJ, sA, L, rail.loop);
  for (let t = 0; t < 12 && !(arrive('joueur') && arrive('adversaire')); t += 0.1) {
    const devantArrive = arrive(devantQui);
    // Arrivé, le joueur passe en pilote automatique (src/state/drive.ts, `terminerCourse`).
    if (arrive('joueur')) Object.assign(input, { auto: true, throttle: 0, brake: 0, lane: 0 });
    joueur.setHold(false);
    const m = joueur.step(0.1, input, 'car');
    pasDepart(depart, 0.1, true, m.s, rail, m.finished);
    duel.pas(0.1, joueur, depart, dl, dL, input.auto);
    if (devantArrive && (duel.retenue !== null || duel.contact.frotte)) gene += 1;
  }
  const temps = (qui: 'joueur' | 'adversaire') => (arrive(qui) ? (qui === 'joueur' ? depart.arrivee : adversaire.arrivee) / 1000 : Infinity);
  return { gene, tempsDerriere: temps(derriere), tempsDevant: temps(devantQui), verdict: duel.duel.verdict };
}

describe('à l’arrivée, plus de blocage', () => {
  for (const cas of ARRIVEES) {
    const { map, nom } = cas;
    for (const devantQui of ['joueur', 'adversaire'] as const) {
      it.skipIf(!built.some((m) => m.id === map))(`${nom} : ${devantQui === 'joueur' ? 'le joueur' : 'l’adversaire'} passe la ligne, l’autre arrive juste derrière, n’est pas retenu, et son temps est celui qu’il ferait seul`, { timeout: 60_000 }, () => {
        const a = arriveeSerree(cas, devantQui);
        const seul = arriveeSerree(cas, devantQui, true);
        expect(a.tempsDevant).toBeLessThan(a.tempsDerriere);
        expect(a.gene).toBe(0);
        expect(Number.isFinite(a.tempsDerriere)).toBe(true);
        expect(Math.abs(a.tempsDerriere - seul.tempsDerriere)).toBeLessThan(0.05);
        // Le verdict : gagné si le joueur passe la ligne le premier.
        expect(a.verdict?.gagne).toBe(devantQui === 'joueur');
      });
    }
  }
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
