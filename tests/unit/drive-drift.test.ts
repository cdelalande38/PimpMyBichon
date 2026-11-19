// Drift au frein (src/data/adherence.ts, `DRIFT` ; src/drive/pilote.ts ; demande du 18 novembre 2026) : un coup
// de frein bref, à bonne vitesse et le manche braqué, fait décrocher l'arrière ; le freinage droit ou tenu
// freine comme avant ; la glisse se tient au gaz dans le virage, s'éteint en ligne droite, se rattrape en
// relâchant ou en contre-braquant, part en tête-à-queue si l'on insiste ; la direction assistée tient l'angle ;
// une propulsion tient plus d'angle qu'une traction ; une moto glisse peu ; le pilote automatique ne drifte pas.
// Le manche des essais suit l'axe de la route (`mancheVersAxe`, la conduite des paliers de médaille).

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DRIFT, SURVIRAGE } from '../../src/data/adherence.ts';
import type { MapRoute } from '../../src/data/mapTypes.ts';
import { vehicleById } from '../../src/data/vehicles.ts';
import type { DriveInput, Weather } from '../../src/drive/contrat.ts';
import { createPilot, performanceDe, type PilotWithProfile } from '../../src/drive/pilote.ts';
import { createPose, createRail } from '../../src/drive/rail.ts';
import { mancheVersAxe } from '../../src/drive/simulationDrift.ts';
import { trouverVirages } from '../../src/drive/virages.ts';

const DT = 1 / 60;
const deg = (rad: number) => ((rad * 180) / Math.PI).toFixed(0);

function relever(text: string): void {
  console.log(text);
  const file = process.env.PMB_RELEVES;
  if (file) appendFileSync(file, `${text}\n`);
}

type Segment = { line: number } | { arc: number; turn: number };

/** Route d'essai (chaussée large : on glisse sans toucher le bord). */
function route(segments: Segment[], width = 24): MapRoute {
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
  return { format: 'pmb-carte', version: 1, id: 'essai', loop: false, length, step, rail, sections: [{ from: 0, to: length, ground: 'sol', urban: false, lanes: 2, width }], chunks: [], starts: [], far: null };
}

/** 300 m droits, une longue courbe à gauche de 60 m de rayon (un demi-tour et demi), 600 m droits. */
const EPINGLE = route([{ line: 300 }, { arc: 60, turn: 1.5 * Math.PI }, { line: 600 }]);
const ENTREE = 300;
const SORTIE = 300 + 1.5 * Math.PI * 60;

function pilotOf(id: string, weather: Weather = 'sec', r: MapRoute = EPINGLE): { pilot: PilotWithProfile; kind: 'car' | 'bike' } {
  const vehicle = vehicleById(id);
  if (!vehicle) throw new Error(id);
  const pilot = createPilot(createRail(r), performanceDe(vehicle));
  pilot.setWeather(weather);
  return { pilot, kind: vehicle.kind };
}

const pose = createPose();
const input: DriveInput = { auto: false, throttle: 0, brake: 0, lane: 0, steer: 0 };

/** Un pas : le manche suit l'axe, plus `plus` (négatif : vers la gauche) ; gaz, frein, aide. */
function pas(pilot: PilotWithProfile, kind: 'car' | 'bike', throttle: number, brake = 0, plus = 0, assist = false): number {
  input.throttle = throttle;
  input.brake = brake;
  input.assist = assist;
  input.steer = Math.max(-1, Math.min(1, mancheVersAxe(pilot, pilot.rail.poseAt(pilot.motion.s, pose).curvature) + plus));
  return pilot.step(DT, input, kind).drift ?? 0;
}

/** Lancé sur l'axe jusqu'à `kmh`, tenu jusqu'à l'abscisse `s`. */
function amener(pilot: PilotWithProfile, kind: 'car' | 'bike', kmh: number, s: number, assist = false): void {
  for (let i = 0; i < 60 * 120 && pilot.motion.s < s; i += 1) pas(pilot, kind, Math.min(1, Math.max(0, (kmh / 3.6 - pilot.motion.speed) * 0.8 + 0.2)), 0, 0, assist);
}

/** Coup de frein de `seconds` s, manche poussé de `plus` au-delà de l'axe, puis relâché (la glisse part au relâché). */
function coup(pilot: PilotWithProfile, kind: 'car' | 'bike', seconds = 0.15, plus = -0.5, assist = false): void {
  for (let t = 0; t < seconds - 1e-9; t += DT) pas(pilot, kind, 0, 1, plus, assist);
  pas(pilot, kind, 0, 0, plus, assist);
}

/** Pendant `seconds` s : rend la dérive la plus faible et la plus forte (valeur absolue). */
function tenir(pilot: PilotWithProfile, kind: 'car' | 'bike', seconds: number, throttle = 1, plus = 0, assist = false): { min: number; max: number } {
  let min = Infinity;
  let max = 0;
  for (let t = 0; t < seconds - 1e-9; t += DT) {
    const d = Math.abs(pas(pilot, kind, throttle, 0, plus, assist));
    min = Math.min(min, d);
    max = Math.max(max, d);
  }
  return { min, max };
}

describe('drift au frein', () => {
  it('coup de frein bref en appui : l’arrière décroche ; tenu, ou en ligne droite sans braquer : un freinage comme avant', () => {
    const essai = (seconds: number, ligneDroite: boolean) => {
      const { pilot, kind } = pilotOf('concept');
      amener(pilot, kind, 60, ligneDroite ? 150 : ENTREE + 15);
      coup(pilot, kind, seconds, ligneDroite ? 0 : -0.5);
      const glisse = pilot.glisse;
      return { glisse, max: tenir(pilot, kind, 1).max, pilot };
    };
    const bref = essai(0.15, false);
    const tenu = essai(0.8, false);
    const droit = essai(0.15, true);
    relever(`concept, sec, 60 km/h en appui : coup de frein bref → ${deg(bref.max)}° ; freinage tenu → ${deg(tenu.max)}° ; en ligne droite sans braquer → ${deg(droit.max)}°`);
    // Virage à gauche, manche à gauche : la caisse part à gauche (dérive positive).
    expect(bref.glisse).toBe(1);
    expect(bref.max).toBeGreaterThan(0.35);
    expect(tenu.glisse).toBe(0);
    expect(tenu.max).toBeLessThan(0.15);
    expect(droit.glisse).toBe(0);
    expect(droit.max).toBeLessThan(0.02);
  });

  it('trop lent : le coup de frein ne lance rien', () => {
    const { pilot, kind } = pilotOf('concept');
    amener(pilot, kind, DRIFT.vitesseMin * 3.6 * 0.7, ENTREE + 15);
    coup(pilot, kind);
    expect(pilot.glisse).toBe(0);
    expect(tenir(pilot, kind, 1, 0.3).max).toBeLessThan(0.15);
  });

  it('la glisse se tient au gaz dans le virage ; gaz relâché, la caisse se remet droite', () => {
    const { pilot, kind } = pilotOf('concept');
    amener(pilot, kind, 60, ENTREE + 15);
    coup(pilot, kind);
    tenir(pilot, kind, 0.8);
    const tenue = tenir(pilot, kind, 2.5);
    relever(`concept, sec, courbe de 60 m : glisse tenue plein gaz de ${deg(tenue.min)}° à ${deg(tenue.max)}°, ${(pilot.motion.speed * 3.6).toFixed(0)} km/h`);
    expect(pilot.motion.s).toBeLessThan(SORTIE);
    expect(tenue.min).toBeGreaterThan(0.25);
    expect(tenue.max).toBeLessThan(DRIFT.lache);
    expect(pilot.glisse).toBe(1);
    let droite = -1;
    for (let t = 0; t < 3; t += DT) {
      pas(pilot, kind, 0);
      if (droite < 0 && Math.abs(pilot.motion.drift ?? 0) < 0.05) droite = t;
    }
    relever(`  gaz relâché : droite en ${droite.toFixed(2)} s`);
    expect(droite).toBeGreaterThan(0);
    expect(droite).toBeLessThan(1.5);
    expect(pilot.glisse).toBe(0);
  });

  it('en ligne droite, plein gaz, la glisse s’éteint d’elle-même (pas de glisse sans fin)', () => {
    const { pilot, kind } = pilotOf('concept');
    amener(pilot, kind, 70, 120);
    coup(pilot, kind, 0.15, -0.6);
    expect(pilot.glisse).toBe(1);
    let finie = -1;
    for (let t = 0; t < 4; t += DT) {
      pas(pilot, kind, 1);
      if (finie < 0 && pilot.glisse === 0) finie = t;
    }
    relever(`concept, sec, ligne droite plein gaz après un coup de frein braqué : glisse finie en ${finie.toFixed(2)} s`);
    expect(finie).toBeGreaterThan(0);
    expect(finie).toBeLessThan(2);
    expect(Math.abs(pilot.motion.drift ?? 0)).toBeLessThan(0.05);
  });

  it('contre-braquer rattrape la glisse', () => {
    const { pilot, kind } = pilotOf('concept');
    amener(pilot, kind, 60, ENTREE + 15);
    coup(pilot, kind);
    tenir(pilot, kind, 0.8);
    let droite = -1;
    for (let t = 0; t < 3; t += DT) {
      pas(pilot, kind, 0.6, 0, 0.6);
      if (droite < 0 && Math.abs(pilot.motion.drift ?? 0) < 0.05) droite = t;
    }
    relever(`concept, sec : contre-braqué (gaz 0,6) → droite en ${droite.toFixed(2)} s`);
    expect(droite).toBeGreaterThan(0);
    expect(droite).toBeLessThan(1.5);
  });

  it('braqué à fond dans le virage, plein gaz : trop d’angle, tête-à-queue', () => {
    const { pilot, kind } = pilotOf('concept');
    amener(pilot, kind, 60, ENTREE + 15);
    coup(pilot, kind);
    const toupie = tenir(pilot, kind, 4, 1, -2).max;
    relever(`concept, sec : braqué à fond plein gaz → ${deg(toupie)}°`);
    expect(toupie).toBeGreaterThan(SURVIRAGE.teteAQueue);
    expect(pilot.glisse).toBe(0);
  });

  it('direction assistée : l’aide tient l’angle, sous le tête-à-queue', () => {
    const { pilot, kind } = pilotOf('concept');
    amener(pilot, kind, 60, ENTREE + 15, true);
    coup(pilot, kind, 0.15, -0.9, true);
    expect(pilot.glisse).toBe(1);
    tenir(pilot, kind, 0.8, 1, 0, true);
    const tenue = tenir(pilot, kind, 2, 1, 0, true);
    relever(`concept, sec, direction assistée : glisse tenue de ${deg(tenue.min)}° à ${deg(tenue.max)}°`);
    expect(tenue.min).toBeGreaterThan(0.2);
    expect(tenue.max).toBeLessThanOrEqual(DRIFT.assiste * 1.15);
  });

  it('une propulsion tient plus d’angle qu’une traction ; une moto glisse peu, sans tête-à-queue', () => {
    const angle = (id: string) => {
      const { pilot, kind } = pilotOf(id);
      amener(pilot, kind, 50, ENTREE + 15);
      coup(pilot, kind);
      tenir(pilot, kind, 0.8);
      return { ...tenir(pilot, kind, 1.5), kind };
    };
    const cox = angle('cox');
    const van = angle('van');
    const moto = angle('sportive');
    relever(`courbe de 60 m, 50 km/h, glisse tenue plein gaz : cox (propulsion) ${deg(cox.min)}–${deg(cox.max)}°, van (traction) ${deg(van.min)}–${deg(van.max)}°, sportive (moto) ${deg(moto.min)}–${deg(moto.max)}°`);
    expect(cox.max).toBeGreaterThan(van.max);
    expect(moto.max).toBeLessThanOrEqual(SURVIRAGE.moto.max + 1e-9);
  });

  it('le pilote automatique ne drifte pas, même frein pulsé', () => {
    const { pilot, kind } = pilotOf('concept');
    for (let i = 0; i < 60 * 40; i += 1) {
      const m = pilot.step(DT, { auto: true, throttle: 0, brake: i % 20 < 5 ? 1 : 0, lane: 0, steer: -1 }, kind);
      expect(Math.abs(m.drift ?? 0)).toBe(0);
    }
    expect(pilot.glisse).toBe(0);
  });
});

// Tableau mesuré (hors navigateur) : sur un lacet de Monaco (ville) et une courbe rapide du plateau Matheysin, un
// coup de frein type (0,15 s, manche poussé de 0,5 vers l'intérieur) à l'entrée du virage, puis plein gaz en
// suivant l'axe de la route : l'angle le plus fort, la durée de glisse (dérive d'au moins 10°), le bord, le
// tête-à-queue ; pour une propulsion (la Cox), une traction (le van) et une moto (la sportive), par météo.
// Écrit dans la sortie du test et dans le fichier que nomme PMB_RELEVES.
const CARTES = { lacet: 'monaco-ville', courbe: 'plateau-matheysin' } as const;
const fichierCarte = (id: string) => new URL(`../../public/assets/maps/${id}/route.json`, import.meta.url);

describe.skipIf(!existsSync(fichierCarte(CARTES.lacet)) || !existsSync(fichierCarte(CARTES.courbe)))('drift au frein : tableau mesuré sur les cartes', () => {
  it('lacet de Monaco et courbe rapide : angle et durée de glisse, par véhicule et par météo', () => {
    const lignes: string[] = [];
    for (const [nom, carte, rayonVise, kmh] of [
      ['lacet', CARTES.lacet, 30, 45],
      ['courbe rapide', CARTES.courbe, 200, 90],
    ] as const) {
      const r = JSON.parse(readFileSync(fichierCarte(carte), 'utf8')) as MapRoute;
      const rail = createRail(r);
      const v = trouverVirages(rail).liste.filter((x) => x.angle > (nom === 'lacet' ? 1.5 : 0.5) && x.debut > 200);
      const virage = v.reduce((a, b) => (Math.abs(b.rayon - rayonVise) < Math.abs(a.rayon - rayonVise) ? b : a));
      lignes.push(`${nom} (${carte}, à ${Math.round(virage.debut)} m) : rayon ${Math.round(virage.rayon)} m, ${deg(virage.angle)}° tournés, entrée à ${kmh} km/h`);
      for (const id of ['cox', 'van', 'sportive']) {
        const cells: string[] = [];
        for (const meteo of ['sec', 'pluie', 'neige'] as const) {
          const { pilot, kind } = pilotOf(id, meteo, r);
          pilot.reset(virage.debut - 150);
          amener(pilot, kind, kmh * (meteo === 'neige' ? 0.75 : 1), virage.debut + 3);
          const vitesse = pilot.motion.speed * 3.6;
          coup(pilot, kind, 0.15, -virage.sens * 0.5);
          const lancee = pilot.glisse !== 0;
          let max = 0;
          let glisse = 0;
          let bord = false;
          let toupie = false;
          for (let t = 0; t < 8 && pilot.motion.s < virage.fin + 20; t += DT) {
            const d = Math.abs(pas(pilot, kind, 1));
            max = Math.max(max, d);
            if (d >= 0.17) glisse += DT;
            if (pilot.contact !== 0) bord = true;
            if (d > SURVIRAGE.teteAQueue) toupie = true;
          }
          cells.push(`${meteo} ${lancee ? '' : '(pas lancée) '}${deg(max)}° ${glisse.toFixed(1)} s${bord ? ' bord' : ''}${toupie ? ' toupie' : ''} [${vitesse.toFixed(0)} km/h]`);
        }
        lignes.push(`  ${id.padEnd(9)} ${cells.join(' · ')}`);
      }
    }
    relever(lignes.join('\n'));
    expect(lignes.length).toBe(8);
  });
});
