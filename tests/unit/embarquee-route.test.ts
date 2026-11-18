// Caméra embarquée : voir la route depuis l'intérieur (vague U, demande du 18 novembre 2026, téléphone en
// paysage : « on voit pas assez la route, il faudrait qu'on puisse prendre un peu plus de hauteur »).
//
// Sans navigateur : le modèle de chaque voiture est posé comme l'app le pose (tests/unit/outils/embarquee.ts),
// l'œil est celui de la place du conducteur, puis l'œil de conduite de l'app (src/drive/cameras.ts,
// cockpitView : relevé, avancée, hauteur du regard, champ et horizon selon le format). Au milieu de l'image,
// on lit l'horizon et le haut de l'habitacle (planche, capot ou volant, le premier rayon qui le touche sous
// l'horizon) ; la part de l'écran prise par l'habitacle est ce qui reste dessous.
//
// Mesure d'origine (regard vers un point de la route à 28 m, champ vertical de 74° partout), habitacle :
// concept 45 à 46 % (le bas du pare-brise à 4 % sous l'horizon : 5 % de l'image pour la route), Cox 33 à
// 34 %, van 34 à 35 %. Horizon à 49 % de la hauteur dans tous les formats. Après : voir les seuils
// ci-dessous ; la mesure du jour s'écrit dans PMB_MESURE_EMBARQUEE=<fichier.json>.

import { writeFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import type { MapRoute } from '../../src/data/mapTypes.ts';
import { REGARDS } from '../../src/data/regard.ts';
import { placeOf, validateManifest } from '../../src/data/vehicles.ts';
import type { DriveMotion, VehicleFrame } from '../../src/drive/contrat.ts';
import { cameraShot, cockpit, COCKPIT, cockpitView, createShot, DEFAULT_ORBIT, followRegard, landscapeShare, regardNow } from '../../src/drive/cameras.ts';
import { createRail } from '../../src/drive/rail.ts';
import { sanitizeRegard } from '../../src/state/drive.ts';
import { chargerHabitacle, lire, vitessePerdue, vueConduite, type Habitacle } from './outils/embarquee.ts';
import { manifesteDe } from './outils/vueConducteur.ts';

const VOITURES = ['concept', 'cox', 'van'];
const PORTRAIT: [number, number] = [390, 844];
const PAYSAGES: Array<[number, number]> = [
  [844, 390],
  [915, 412],
];

/**
 * Haut de l'habitacle (part de la hauteur de l'image, depuis le haut) qu'on exige au moins, cran normal :
 * en paysage, 70 % (30 % de l'écran au plus pour l'habitacle) ; en portrait, l'image est haute et
 * l'habitacle en prend davantage. Le concept (modèle de banc d'essai, `placeholder_banc`) a un capot long
 * et un œil bas (0,93 m) sous un pavillon très bas (1,10 m au-dessus de l'œil de conduite) : même l'œil le
 * plus haut que permet son pavillon voit le capot jusqu'à 62 % de l'image en paysage, et l'avancer
 * davantage ferait sortir son volant et ses instruments du bas de l'image. Dit tel quel dans le rendu de
 * la vague U.
 */
const PLANCHE: Record<string, { paysage: number; portrait: number }> = {
  concept: { paysage: 0.56, portrait: 0.53 },
  cox: { paysage: 0.7, portrait: 0.6 },
  van: { paysage: 0.7, portrait: 0.6 },
};

/** Haut du volant au plus (part de l'image depuis le haut), cran normal : il reste visible en bas. */
const VOLANT = { paysage: 0.9, portrait: 0.8 };

const charges = new Map<string, Habitacle>();
const habitacle = (id: string): Habitacle => {
  let h = charges.get(id);
  if (!h) {
    h = chargerHabitacle(manifesteDe(id));
    charges.set(id, h);
  }
  return h;
};

describe('œil de conduite : le manifeste', () => {
  it('chaque voiture déclare son œil de conduite à la place du conducteur, valide', () => {
    for (const id of VOITURES) {
      const manifeste = manifesteDe(id);
      expect(() => validateManifest(manifeste, id), id).not.toThrow();
      expect(placeOf(manifeste, 'conducteur')?.view.conduite, id).toBeDefined();
    }
  });

  it('des valeurs hors bornes sont refusées', () => {
    const base = manifesteDe('cox');
    const avec = (conduite: unknown) => ({ ...base, interiorView: { ...base.interiorView, conduite } });
    for (const faux of [{ lift: 0.5 }, { ahead: -0.4 }, { regard: [0.1] }, { regard: [0.1, 0.3] }, { horizon: [0.2, 0.4] }, { fov: [74, 20] }, 'haut']) {
      expect(() => validateManifest(avec(faux), 'cox'), JSON.stringify(faux)).toThrow(/conduite/);
    }
  });
});

describe('cadrage selon le format', () => {
  it('portrait, paysage, et un fondu entre les deux', () => {
    expect(landscapeShare(390 / 844)).toBe(0);
    expect(landscapeShare(844 / 390)).toBe(1);
    expect(landscapeShare(912 / 350)).toBe(1);
    const carre = landscapeShare(1);
    expect(carre).toBeGreaterThan(0);
    expect(carre).toBeLessThan(1);
    expect(landscapeShare(Number.NaN)).toBe(0);
  });

  it('l’horizon tombe à sa part de l’image ; le pavillon arrête l’œil le plus haut', () => {
    const out = { eye: [0, 0, 0] as [number, number, number], pitch: 0, fov: 0 };
    for (const aspect of [390 / 844, 844 / 390]) {
      cockpitView([0, 1.2, 0], null, aspect, 0, Number.NaN, out);
      const k = landscapeShare(aspect);
      const horizon = COCKPIT.horizon[0] + (COCKPIT.horizon[1] - COCKPIT.horizon[0]) * k;
      // Point à l'infini à hauteur d'œil : sa place dans l'image (depuis le haut).
      const y = (1 - Math.tan(-out.pitch) / Math.tan((out.fov * Math.PI) / 360)) / 2;
      expect(y).toBeCloseTo(horizon, 9);
    }
    // Cran le plus haut sous un pavillon à 1,30 m : jamais à moins de COCKPIT.ceilingGap.
    cockpitView([0, 1.2, 0], { regard: [0.05, 0.2] }, 1, 1, 1.3, out);
    expect(out.eye[1]).toBeCloseTo(1.3 - COCKPIT.ceilingGap, 9);
    // Un œil de place déjà sous la garde n'est pas descendu.
    cockpitView([0, 1.28, 0], null, 1, 1, 1.3, out);
    expect(out.eye[1]).toBeCloseTo(1.28, 9);
  });
});

describe('la route se voit depuis la place du conducteur', () => {
  const rapport: Record<string, unknown> = {};

  for (const id of VOITURES) {
    it(`${id} : horizon vers 40 à 46 % en paysage, habitacle borné, route visible`, { timeout: 300_000 }, () => {
      const h = habitacle(id);
      const seuil = PLANCHE[id]!;
      const lignes: Record<string, unknown> = {};
      for (const [w, hh] of [PORTRAIT, ...PAYSAGES]) {
        const paysage = w > hh;
        const vue = vueConduite(h, w, hh);
        const r = lire(h, vue);
        const vit = vitessePerdue(h, vue);
        lignes[`${w}×${hh}`] = { horizon: Math.round(r.horizon * 100), habitacle: Math.round(r.habitacle * 100), piece: r.piece, volant: Math.round(r.volant * 100), pavillon: Math.round(r.pavillon * 100), premierSol: Math.round(r.premierSol * 10) / 10, vitessePerdue: vit === null ? null : Math.round(vit * 100) };
        if (paysage) {
          expect(r.horizon, `${id} ${w}×${hh} horizon`).toBeGreaterThanOrEqual(0.4);
          expect(r.horizon, `${id} ${w}×${hh} horizon`).toBeLessThanOrEqual(0.46);
        }
        expect(r.planche, `${id} ${w}×${hh} haut de l'habitacle`).toBeGreaterThanOrEqual(paysage ? seuil.paysage : seuil.portrait);
        expect(r.volant, `${id} ${w}×${hh} haut du volant`).toBeLessThanOrEqual(paysage ? VOLANT.paysage : VOLANT.portrait);
        // Le bord du pavillon ne cache pas l'horizon (on voit le virage qui vient).
        expect(r.pavillon, `${id} ${w}×${hh} pavillon`).toBeLessThan(r.horizon - 0.02);
        // La chaussée se voit à moins de 15 m devant.
        expect(r.premierSol, `${id} ${w}×${hh} premier sol`).toBeLessThan(15);
      }
      rapport[id] = lignes;
    });

    it(`${id} : chaque cran de la hauteur du regard reste jouable, sous le pavillon, la tête cachée`, { timeout: 300_000 }, () => {
      const h = habitacle(id);
      const spec = placeOf(h.manifeste, 'conducteur')!.view.conduite!;
      let avant = -Infinity;
      const lignes: Record<string, unknown> = {};
      for (const regard of REGARDS) {
        for (const [w, hh] of [PORTRAIT, PAYSAGES[0]!]) {
          const vue = vueConduite(h, w, hh, regard.part);
          const r = lire(h, vue);
          lignes[`${regard.id} ${w}×${hh}`] = { oeil: Math.round(vue.oeil[1] * 1000) / 1000, horizon: Math.round(r.horizon * 100), habitacle: Math.round(r.habitacle * 100), pavillon: Math.round(r.pavillon * 100) };
          expect(r.pavillon, `${id} ${regard.id} ${w}×${hh} : le pavillon ne cache pas l'horizon`).toBeLessThan(r.horizon - 0.02);
          expect(r.route, `${id} ${regard.id} ${w}×${hh} : la route se voit`).toBeGreaterThan(0.07);
        }
        const vue = vueConduite(h, 844, 390, regard.part);
        // Sous le pavillon (mesuré au-dessus de l'œil de conduite), d'au moins la garde.
        const toit = h.pavillon(vue.oeil[0], vue.oeil[2], h.oeil[1]);
        if (toit !== null) expect(toit - vue.oeil[1], `${id} ${regard.id} garde au pavillon`).toBeGreaterThanOrEqual(COCKPIT.ceilingGap - 1e-6);
        // Plus haut à chaque cran (ou égal quand le pavillon l'arrête).
        expect(vue.oeil[1], `${id} ${regard.id} monte`).toBeGreaterThanOrEqual(avant - 1e-9);
        avant = vue.oeil[1];
        // La tête du conducteur reste cachée : l'œil de conduite reste près de l'œil de la place (seuil de la scène : 0,5 m).
        expect(Math.hypot(vue.oeil[0] - h.oeil[0], vue.oeil[1] - h.oeil[1]), `${id} ${regard.id} près de la tête`).toBeLessThan(0.42);
      }
      expect(vueConduite(h, 844, 390, 1).oeil[1]).toBeGreaterThan(vueConduite(h, 844, 390, -1).oeil[1] + 0.03);
      // Le relevé et l'avancée du manifeste, puis le débattement, restent dans les bornes validées.
      expect(spec.regard).toBeDefined();
      rapport[`${id} crans`] = lignes;
    });
  }

  it('rapport (PMB_MESURE_EMBARQUEE)', () => {
    if (process.env.PMB_MESURE_EMBARQUEE) writeFileSync(process.env.PMB_MESURE_EMBARQUEE, JSON.stringify(rapport, null, 1));
    expect(Object.keys(rapport).length).toBeGreaterThan(0);
  });
});

/** Route droite et plate de 200 m vers +X. */
const ROUTE: MapRoute = (() => {
  const rail: number[] = [];
  for (let i = 0; i <= 100; i += 1) rail.push(i * 2, 0, 0);
  return { format: 'pmb-carte', version: 1, id: 'essai', loop: false, length: 200, step: 2, rail, sections: [{ from: 0, to: 200, ground: 'sol', urban: false, lanes: 2, width: 7 }], chunks: [], starts: [], far: null };
})();
const voiture: VehicleFrame = { kind: 'car', position: [50, 0, 0], heading: 0, pitch: 0, roll: 0, halfLength: 2, halfWidth: 0.85, height: 1.4 };
const motion = (s: number) => ({ s, offset: 0, speed: 0 }) as unknown as DriveMotion;

describe('caméra embarquée de la sortie', () => {
  afterEach(() => {
    cockpit.eye = null;
    cockpit.conduite = null;
    cockpit.ceiling = Number.NaN;
    cockpit.aspect = 390 / 844;
    cockpit.regard = 0;
    regardNow.time = Number.NaN;
  });

  it('le regard plonge de l’angle du cadrage, sur un point visé au-dessus de la route', () => {
    cockpit.eye = [-0.1, 1.2, -0.3];
    for (const aspect of [390 / 844, 844 / 390]) {
      cockpit.aspect = aspect;
      const shot = cameraShot('embarquee', voiture, motion(50), createRail(ROUTE), 0, DEFAULT_ORBIT, createShot());
      const view = cockpitView(cockpit.eye, null, aspect, 0, Number.NaN, { eye: [0, 0, 0], pitch: 0, fov: 0 });
      const flat = Math.hypot(shot.target[0] - shot.position[0], shot.target[2] - shot.position[2]);
      const dy = shot.target[1] - shot.position[1];
      expect(Math.atan2(dy, flat)).toBeCloseTo(view.pitch, 6);
      expect(shot.fov).toBeCloseTo(view.fov, 6);
      expect(shot.target[1]).toBeGreaterThan(0.6);
    }
  });

  it('la hauteur du regard rejoint le cran choisi sans à-coup, puis s’y tient', () => {
    cockpit.eye = [0, 1.2, -0.3];
    cockpit.conduite = { regard: [0.05, 0.1] };
    const rail = createRail(ROUTE);
    const shot = createShot();
    const hauteurs: number[] = [];
    let t = 0;
    for (let i = 0; i < 30; i += 1, t += 1 / 60) hauteurs.push(cameraShot('embarquee', voiture, motion(50), rail, t, DEFAULT_ORBIT, shot).position[1]);
    cockpit.regard = 1;
    for (let i = 0; i < 120; i += 1, t += 1 / 60) hauteurs.push(cameraShot('embarquee', voiture, motion(50), rail, t, DEFAULT_ORBIT, shot).position[1]);
    expect(hauteurs[29]).toBeCloseTo(1.2, 9);
    expect(hauteurs[hauteurs.length - 1]).toBeCloseTo(1.3, 4);
    // Pas plus d'un dixième du chemin d'une image à l'autre (à 60 images par seconde).
    for (let i = 1; i < hauteurs.length; i += 1) expect(Math.abs(hauteurs[i]! - hauteurs[i - 1]!)).toBeLessThan(0.1 * 0.1);
    // Même temps (pause) : rien ne bouge ; saut de temps : le cran est pris tel quel.
    cockpit.regard = -1;
    const tenu = regardNow.part;
    expect(followRegard(t - 1 / 60)).toBe(tenu);
    expect(followRegard(t + 5)).toBe(-1);
  });

  it('la hauteur du regard relue du stockage : un cran inconnu retombe sur « normal »', () => {
    expect(sanitizeRegard({ regard: 'haut' })).toBe('haut');
    expect(sanitizeRegard({ regard: 'plafond' })).toBe('normal');
    expect(sanitizeRegard(null)).toBe('normal');
  });
});
