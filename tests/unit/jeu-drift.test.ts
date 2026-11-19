// Le format « Drift » (vague V) : le score des drifts (src/jeu/drift.ts, règles de src/data/drift.ts), les
// combos, les drifts perdus ; les paliers de médaille (drift.json) ; les gains, les hauts faits à stickers ;
// la mesure de la course (src/drive/course.ts) et l'écran de fin.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { articleParId } from '../../src/data/boutique.ts';
import { formatSpec } from '../../src/data/courses.ts';
import { lireFichierDrift, medailleDrift, paliersDrift, POINTS_DRIFT, REFERENCES_DRIFT, scoreReference } from '../../src/data/drift.ts';
import { HAUTS_FAITS } from '../../src/data/hautsFaits.ts';
import { MAPS } from '../../src/data/maps.ts';
import { stickerById } from '../../src/data/stickers.ts';
import { courseFinie, createMesures } from '../../src/drive/course.ts';
import { armerDepart, createDepart } from '../../src/drive/depart.ts';
import { cloturer } from '../../src/jeu/cloture.ts';
import type { Bilan, ResultatCourse } from '../../src/jeu/contrat.ts';
import { bilanDrift, createEtatDrift, pasDrift, pointsParSeconde, type EtatDrift } from '../../src/jeu/drift.ts';
import { etatVide } from '../../src/jeu/etat.ts';
import { calculerGains } from '../../src/jeu/gains.ts';
import { resultatDe } from '../../src/state/drive.ts';
import { FinCourseVue } from '../../src/ui/drive/FinCourseVue.tsx';

const DT = 1 / 30;

/** `seconds` s à cet angle (rad) et cette vitesse (m/s), sans toucher le bord. */
function rouler(e: EtatDrift, seconds: number, angle: number, vitesse = 15, contact = 0): void {
  for (let t = 0; t < seconds - 1e-9; t += DT) pasDrift(e, DT, angle, vitesse, contact);
}

describe('score des drifts', () => {
  it('l’angle, la vitesse et la durée comptent ; le drift compte une fois la caisse droite', () => {
    expect(pointsParSeconde(POINTS_DRIFT.angleRef, POINTS_DRIFT.vitesseRef)).toBeCloseTo(POINTS_DRIFT.parSeconde, 6);
    expect(pointsParSeconde(1, 15)).toBeGreaterThan(pointsParSeconde(0.5, 15));
    expect(pointsParSeconde(0.5, 30)).toBeGreaterThan(pointsParSeconde(0.5, 15));
    // Au-delà de l'angle compté, rien de plus.
    expect(pointsParSeconde(1.3, 15)).toBe(pointsParSeconde(POINTS_DRIFT.angleMax, 15));
    const e = createEtatDrift();
    rouler(e, 2, 0.5);
    expect(e.cote).toBe(1);
    expect(e.total).toBe(0);
    rouler(e, 1, 0);
    expect(e.cote).toBe(0);
    expect(e.nombre).toBe(1);
    expect(e.total).toBeGreaterThan(190);
    expect(e.total).toBeLessThan(210);
    expect(e.plusLong).toBeCloseTo(2, 1);
    expect(e.dernier).toBe(e.total);
  });

  it('sous l’angle ou trop lent : rien ; un drift trop court ne compte pas', () => {
    const e = createEtatDrift();
    rouler(e, 3, POINTS_DRIFT.angleMin * 0.9);
    rouler(e, 3, 0.6, POINTS_DRIFT.vitesseMin * 0.8);
    rouler(e, POINTS_DRIFT.dureeMin * 0.5, -0.6);
    rouler(e, 1, 0);
    expect(e.total).toBe(0);
    expect(e.nombre).toBe(0);
    expect(e.mult).toBe(1);
  });

  it('enchaîner sans se remettre droit multiplie ; attendre trop casse la chaîne', () => {
    const e = createEtatDrift();
    rouler(e, 1.5, 0.5);
    rouler(e, 0.6, 0);
    const premier = e.dernier;
    expect(e.mult).toBe(2);
    rouler(e, 1.5, -0.5);
    rouler(e, 0.6, 0);
    // Même drift, multiplicateur 2.
    expect(e.dernier).toBeGreaterThan(premier * 1.9);
    // Changement de côté sans se remettre droit : compté, le suivant monte d'un cran aussitôt.
    rouler(e, 1.5, 0.5);
    rouler(e, 1.5, -0.5);
    expect(e.nombre).toBe(3);
    expect(e.cote).toBe(-1);
    expect(e.mult).toBe(4);
    rouler(e, 0.6, 0);
    expect(e.nombre).toBe(4);
    // Trop long droit : la chaîne casse.
    rouler(e, POINTS_DRIFT.enchainement + 0.5, 0);
    rouler(e, 1, 0.5);
    expect(e.mult).toBe(1);
    expect(e.multMax).toBe(4);
  });

  it('toucher le bord ou partir en tête-à-queue perd le drift en cours et la chaîne', () => {
    const e = createEtatDrift();
    rouler(e, 1.5, 0.5);
    rouler(e, 0.6, 0);
    const avant = e.total;
    rouler(e, 1, 0.5);
    rouler(e, DT, 0.5, 15, -1);
    expect(e.total).toBe(avant);
    expect(e.dernier).toBeLessThan(0);
    expect(e.mult).toBe(1);
    rouler(e, 1, 0.6);
    rouler(e, DT, POINTS_DRIFT.toupie + 0.1);
    expect(e.total).toBe(avant);
    expect(e.cote).toBe(0);
  });

  it('à l’arrivée, le drift en cours compte', () => {
    const e = createEtatDrift();
    rouler(e, 2, 0.5);
    const b = bilanDrift(e);
    expect(b.score).toBeGreaterThan(190);
    expect(b.nombre).toBe(1);
    expect(b.meilleur).toBe(b.score);
  });
});

describe('médailles du drift', () => {
  it('paliers en parts du score de référence ; au-dessus du bronze, une médaille', () => {
    const p = paliersDrift(1000);
    expect(p.or).toBeGreaterThan(p.argent);
    expect(p.argent).toBeGreaterThan(p.bronze);
    expect(medailleDrift(p.or, 1000)).toBe('or');
    expect(medailleDrift(p.argent, 1000)).toBe('argent');
    expect(medailleDrift(p.bronze, 1000)).toBe('bronze');
    expect(medailleDrift(p.bronze - 10, 1000)).toBeNull();
    expect(medailleDrift(5000, null)).toBeNull();
  });

  it('lecture tolérante de drift.json ; chaque départ de chaque carte a sa référence', () => {
    expect(lireFichierDrift({ format: 'autre' })).toBeNull();
    expect(lireFichierDrift({ format: 'pmb-drift', version: 1, departs: { a: { score: -3 }, b: { score: 900, vehicules: { x: 800, y: 'non' } } } })).toEqual({ format: 'pmb-drift', version: 1, departs: { b: { score: 900, vehicules: { x: 800 } } } });
    for (const map of MAPS) {
      const fichier = REFERENCES_DRIFT[map.id];
      expect(fichier, map.id).toBeDefined();
      for (const [depart, ref] of Object.entries(fichier!.departs)) {
        expect(ref.score, `${map.id} ${depart}`).toBeGreaterThan(0);
        expect(scoreReference(map.id, depart, 'inconnu')).toBe(ref.score);
      }
    }
  });
});

const RESULTAT: ResultatCourse = {
  carte: 'monaco-circuit',
  depart: 'port',
  vehicule: 'concept',
  format: 'drift',
  meteo: 'sec',
  moment: 'nuit',
  temps: 143.2,
  tours: [143.2],
  ancienRecord: null,
  medaille: 'or',
  stats: { distance: 3300, vitesseMax: 160, glisse: 400, chocs: 2, nos: 0 },
  drift: { score: 12450, meilleur: 2310, plusLong: 4.4, nombre: 21, multMax: 5 },
};

describe('le format « Drift » en course', () => {
  it('un tour, la mesure rend le score ; la médaille se prend sur le score, sans record de temps', () => {
    expect(formatSpec('drift').label).toBe('Drift');
    const etat = armerDepart(createDepart(), 0, true, false, 1);
    etat.phase = 'arrive';
    etat.arrivee = 90_000;
    etat.tempsTours[0] = 90_000;
    etat.tours = 1;
    const score = createEtatDrift();
    rouler(score, 3, 0.6, 20);
    const finie = courseFinie(etat, createMesures(), { carte: 'monaco-circuit', depart: 'port', vehicule: 'concept', format: 'drift', meteo: 'sec', moment: 'nuit' }, score);
    expect(finie?.drift?.score).toBeGreaterThan(0);
    const ref = scoreReference('monaco-circuit', 'port', 'concept')!;
    const r = resultatDe({ ...finie!, drift: { ...finie!.drift!, score: paliersDrift(ref).or } }, { 'course|monaco-circuit|port|drift': 1 });
    expect(r.medaille).toBe('or');
    expect(r.ancienRecord).toBeNull();
    // Les autres formats ne portent pas de score.
    expect(courseFinie(etat, createMesures(), { carte: 'monaco-circuit', depart: 'port', vehicule: 'concept', format: 'tour1', meteo: 'sec', moment: 'nuit' }, score)?.drift).toBeUndefined();
  });

  it('gains à l’échelle de la course d’un tour ; hauts faits du drift : des stickers, aucun dollar', () => {
    const g = calculerGains(RESULTAT);
    expect(g.detail.map((l) => l.motif)).toEqual(['Parcours de drift fini', 'Médaille d’or']);
    expect(g.dollars).toBe(100);
    const { bilan } = cloturer(etatVide(), RESULTAT);
    const ids = bilan.hautsFaits.map((h) => h.id);
    expect(ids).toEqual(expect.arrayContaining(['premier-drift', 'drift-argent', 'drift-or']));
    for (const id of ['premier-drift', 'drift-argent', 'drift-or']) {
      const def = HAUTS_FAITS.find((h) => h.id === id)!;
      expect(def.recompense.dollars ?? 0).toBe(0);
      for (const article of def.recompense.articles ?? []) {
        expect(articleParId(article)?.famille).toBe('sticker');
        expect(stickerById(article.replace(/^sticker-/, ''))).toBeDefined();
      }
    }
    expect(bilan.deblocages.map((a) => a.id)).toEqual(expect.arrayContaining(['sticker-graffiti-fleche', 'sticker-graffiti-gaz', 'sticker-etoile-laurier']));
  });

  it('écran de fin : le score à la place du temps, le meilleur drift, le plus long, la médaille', () => {
    const bilan: Bilan = { resultat: RESULTAT, gains: calculerGains(RESULTAT), solde: 500, hautsFaits: [], deblocages: [] };
    const html = renderToStaticMarkup(createElement(FinCourseVue, { bilan, onRejouer: () => undefined, onGarage: () => undefined }));
    const t = html.replace(/<[^>]+>/g, ' ').replace(/[ \n\t]+/g, ' ');
    expect(t).toContain('Drift');
    expect(t).toContain(`${(12450).toLocaleString('fr-FR')} points`);
    expect(t).toContain(`Meilleur drift ${(2310).toLocaleString('fr-FR')} points, le plus long 4,4 s, ×5 au plus.`);
    expect(t).toContain('Médaille d’or');
    expect(t).toContain('2:23.2 · ');
    expect(t).not.toContain('record');
  });
});
