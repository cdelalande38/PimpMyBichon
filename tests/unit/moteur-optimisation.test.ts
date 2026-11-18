// Optimisation des pièces du moteur (src/data/optimisation.ts, vague U) : les données (niveaux, prix,
// gains, une dizaine à une quinzaine de pour cent tout cumulé), la lecture du build avec repli sur
// l'origine, le cumul avec Mécanique · Préparation (computePrep, performanceDe), les articles de la
// boutique, et le niveau `element` du dock (Moteur, Carrosserie en deux étapes).

import { describe, expect, it } from 'vitest';
import { A_VENDRE, articleParId } from '../../src/data/boutique.ts';
import { computePrep, gainPieces } from '../../src/data/enginePrep.ts';
import { familleById, familleOf, GENRES_OPTIMISATION, MOTEURS_CATALOGUE, pieceById, validateMoteursCatalogue, type MoteurFamille, type MoteurPiece } from '../../src/data/moteurs.ts';
import {
  articleNiveau,
  cleNiveau,
  clesOptimisation,
  coefficientPieces,
  niveauxDe,
  OPTIMISATIONS,
  optimisationMoteur,
  optimisationTouchee,
  resolveNiveau,
} from '../../src/data/optimisation.ts';
import type { Build, VehicleManifest } from '../../src/data/vehicleTypes.ts';
import { vehicleById, VEHICLES } from '../../src/data/vehicles.ts';
import { performanceDe } from '../../src/drive/pilote.ts';
import { sanitizeLevels } from '../../src/state/dock.ts';

const vehicule = (id: string) => vehicleById(id) as VehicleManifest;
const famille = (id: string) => familleById(id) as MoteurFamille;
const piece = (f: string, id: string) => pieceById(famille(f), id) as MoteurPiece;
const parts = (entries: Record<string, string>): Build => ({ paints: {}, parts: entries });

/** Le build qui pose le niveau le plus poussé sur chaque pièce de la famille. */
function tout(f: MoteurFamille): Record<string, string> {
  return Object.fromEntries(f.pieces.filter((p) => niveauxDe(p).length > 0).map((p) => [cleNiveau(p.id), niveauxDe(p).at(-1)!.id]));
}

describe('données de l’optimisation', () => {
  it('chaque genre a un ou deux niveaux, nommés, qui disent ce qu’ils font, de 60 à 400 $, et qui montent', () => {
    for (const genre of GENRES_OPTIMISATION) {
      const spec = OPTIMISATIONS[genre];
      expect(spec.id).toBe(genre);
      expect(spec.niveaux.length, genre).toBeGreaterThanOrEqual(1);
      expect(spec.niveaux.length, genre).toBeLessThanOrEqual(2);
      let avant = { prix: 0, puissance: 0 };
      for (const niveau of spec.niveaux) {
        expect(niveau.label.trim().length).toBeGreaterThan(0);
        expect(niveau.effet.trim().length).toBeGreaterThan(10);
        expect(niveau.prix).toBeGreaterThanOrEqual(60);
        expect(niveau.prix).toBeLessThanOrEqual(400);
        expect(niveau.puissance).toBeGreaterThan(0);
        expect(niveau.puissance).toBeLessThanOrEqual(5);
        expect(niveau.prix).toBeGreaterThan(avant.prix);
        expect(niveau.puissance).toBeGreaterThan(avant.puissance);
        avant = niveau;
      }
    }
  });

  it('chaque famille du catalogue a des pièces à optimiser : une dizaine à une quinzaine de pour cent tout cumulé', () => {
    for (const f of MOTEURS_CATALOGUE.familles) {
      const { max } = optimisationMoteur(f, undefined);
      expect(max, f.id).toBeGreaterThanOrEqual(10);
      expect(max, f.id).toBeLessThanOrEqual(15);
      expect(optimisationMoteur(f, parts(tout(f))).pourcent, f.id).toBe(max);
    }
  });

  it('le catalogue refuse un genre inconnu', () => {
    const raw = structuredClone(MOTEURS_CATALOGUE) as unknown as { familles: Array<{ pieces: Array<Record<string, unknown>> }> };
    raw.familles[0]!.pieces[0]!.optimisation = 'turbo';
    expect(() => validateMoteursCatalogue(raw)).toThrow(/optimisation doit nommer un genre connu/);
  });

  it('chaque niveau est un article à vendre, au prix des données ; l’origine n’en est pas un', () => {
    for (const genre of GENRES_OPTIMISATION) {
      for (const niveau of OPTIMISATIONS[genre].niveaux) {
        const article = articleParId(articleNiveau(genre, niveau.id));
        expect(article, `${genre} ${niveau.id}`).toBeDefined();
        expect(article?.prix).toBe(niveau.prix);
        expect(article?.famille).toBe('piece');
        expect(A_VENDRE).toContain(article);
      }
    }
    expect(articleParId(`piece-moteur-optimisation-culasses-origine`)).toBeUndefined();
  });
});

describe('niveau d’une pièce dans le build', () => {
  const culasses = piece('quatre-a-plat', 'culasses');
  const filtres = piece('quatre-a-plat', 'filtres');
  const carters = piece('quatre-a-plat', 'carters');

  it('rien d’écrit : l’origine ; un niveau connu : lui ; inconnu, ou que le genre n’a pas : l’origine', () => {
    expect(resolveNiveau(culasses, undefined)).toBeNull();
    expect(resolveNiveau(culasses, parts({}))).toBeNull();
    expect(resolveNiveau(culasses, parts({ moteur_culasses_niveau: 'course' }))?.puissance).toBe(4);
    expect(resolveNiveau(culasses, parts({ moteur_culasses_niveau: 'stage9' }))).toBeNull();
    // Le filtre n'a qu'un niveau au-dessus de l'origine.
    expect(resolveNiveau(filtres, parts({ moteur_filtres_niveau: 'course' }))).toBeNull();
    // Une pièce qui ne s'optimise pas ignore ce qu'on écrit pour elle.
    expect(niveauxDe(carters)).toEqual([]);
    expect(resolveNiveau(carters, parts({ moteur_carters_niveau: 'sport' }))).toBeNull();
  });

  it('la clé ne se mêle pas de l’échange : moteur_<pièce>_niveau à côté de moteur_<pièce>', () => {
    expect(cleNiveau('filtres')).toBe('moteur_filtres_niveau');
    const b = parts({ moteur_filtres: 'coniques', moteur_filtres_niveau: 'sport' });
    expect(resolveNiveau(filtres, b)?.id).toBe('sport');
  });

  it('« D’origine » efface les niveaux des pièces qui s’optimisent, et le dit touché', () => {
    const f = famille('quatre-a-plat');
    expect(clesOptimisation(f).sort()).toEqual(['moteur_carburateur_niveau', 'moteur_collecteur_niveau', 'moteur_culasses_niveau', 'moteur_distributeur_niveau', 'moteur_filtres_niveau']);
    expect(optimisationTouchee(f, undefined)).toBe(false);
    expect(optimisationTouchee(f, parts({ aileron: 'haut' }))).toBe(false);
    expect(optimisationTouchee(f, parts({ moteur_culasses_niveau: 'inconnu' }))).toBe(true);
  });
});

describe('cumul avec la préparation', () => {
  const cox = vehicule('cox');
  const concept = vehicule('concept');

  it('un moteur sans modèle (le van) ne gagne rien ; sans niveau posé, rien ne change', () => {
    const van = vehicule('van');
    expect(familleOf(van)).toBeUndefined();
    expect(coefficientPieces(van.engine, parts({ moteur_culasses_niveau: 'course' }))).toBe(1);
    for (const v of VEHICLES) {
      if (!v.engine) continue;
      expect(computePrep(v, parts({}))?.prepared, v.id).toBe(Math.round(v.engine.power));
      expect(gainPieces(v, undefined)?.pourcent, v.id).toBe(0);
    }
  });

  it('les pourcents des pièces s’additionnent et multiplient la puissance préparée', () => {
    // Cox : 50 ch, gros carbu (× 1,12), culasses de course (+ 4 %) et réglage fin (+ 2 %).
    const b = parts({ carbu: 'gros-carbu', moteur_culasses_niveau: 'course', moteur_carburateur_niveau: 'sport' });
    expect(coefficientPieces(cox.engine, b)).toBeCloseTo(1.06, 10);
    expect(computePrep(cox, b)).toEqual({ origin: 50, gain: 9, prepared: 59, nitro: 0, withNitro: 59 });
    expect(gainPieces(cox, b)).toMatchObject({ pourcent: 6, chevaux: 3 });
    expect(gainPieces(cox, b)?.base).toBeCloseTo(56, 6);
    // Concept : 480 ch, stage 3 atmo (× 1,12), tout le moteur au plus poussé (+ 14 %).
    const max = parts({ reprog: 'stage3', ...tout(famille('v8')) });
    expect(computePrep(concept, max)?.prepared).toBe(Math.round(480 * 1.12 * 1.14));
    expect(gainPieces(concept, max)?.pourcent).toBe(14);
  });

  it('la conduite lit le total : performanceDe prend la puissance cumulée ; l’origine (temps de référence) ne bouge pas', () => {
    const b = parts({ reprog: 'stage3', ...tout(famille('v8')) });
    expect(performanceDe(concept, b).power).toBe(computePrep(concept, b)?.prepared);
    expect(performanceDe(concept).power).toBe(480);
    expect(performanceDe(cox).power).toBe(50);
    // Rien d'impossible à conduire : au plus 15 % de plus que la préparation seule.
    const prep = performanceDe(concept, parts({ reprog: 'stage3' })).power;
    expect(performanceDe(concept, b).power / prep).toBeLessThanOrEqual(1.15);
    expect(Number.isFinite(performanceDe(concept, b).nosBoost)).toBe(true);
  });
});

describe('niveau « élément » du dock (Moteur, Carrosserie)', () => {
  const element = { kind: 'element', element: 'culasses', libelle: 'Culasses' } as const;

  it('Moteur et Carrosserie acceptent un seul niveau, l’élément choisi ; les autres entrées non', () => {
    expect(sanitizeLevels('moteur', [element])).toEqual([element]);
    expect(sanitizeLevels('carrosserie', [{ kind: 'element', element: 'jupes', libelle: 'Jupes' }, element])).toEqual([{ kind: 'element', element: 'jupes', libelle: 'Jupes' }]);
    expect(sanitizeLevels('peinture', [element])).toEqual([]);
    expect(sanitizeLevels('ailerons', [element])).toEqual([]);
    expect(sanitizeLevels('moteur', [{ kind: 'zone', zone: 'caisse', step: 'couleur' }])).toEqual([]);
  });

  it('une valeur abîmée ne passe pas', () => {
    expect(sanitizeLevels('moteur', [{ kind: 'element', element: '<b>', libelle: 'x' }])).toEqual([]);
    expect(sanitizeLevels('moteur', [{ kind: 'element', element: 'culasses', libelle: 'x'.repeat(121) }])).toEqual([]);
    expect(sanitizeLevels('moteur', [{ kind: 'element', element: 'culasses' }])).toEqual([]);
    expect(sanitizeLevels('moteur', 'culasses')).toEqual([]);
    expect(sanitizeLevels('moteur', [null])).toEqual([]);
  });
});
