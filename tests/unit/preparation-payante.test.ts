// La fiche de préparation est payante (vague W) : chaque option au-dessus de l'origine est un article,
// pour tous les véhicules ; une option déjà montée sans l'article (sauvegarde d'avant) reste montée.
import { describe, expect, it } from 'vitest';
import { ARTICLES_MOTEUR } from '../../src/data/articles/moteur.ts';
import { A_VENDRE, articleParId } from '../../src/data/boutique.ts';
import { articlePrep, computePrep, ENGINE_SLOTS, chosenOption } from '../../src/data/enginePrep.ts';
import type { EngineSpec, VehicleManifest } from '../../src/data/vehicleTypes.ts';
import { possedeDans } from '../../src/jeu/achats.ts';
import { nettoyerEtat } from '../../src/jeu/etat.ts';
import { sanitizeBuilds } from '../../src/state/builds.ts';

const PRIX: Readonly<Record<string, number>> = {
  stage1: 120,
  stage2: 220,
  stage3: 350,
  gicleurs: 80,
  'gros-carbu': 160,
  'double-carbu': 260,
  'nitro-petit': 100,
  'nitro-moyen': 200,
  'nitro-gros': 320,
};

const van: Pick<VehicleManifest, 'engine' | 'kind'> = {
  kind: 'car',
  engine: { label: '4 cylindres turbo diesel', fuel: 'diesel', feed: 'injection', boost: 'turbo', power: 102 } satisfies EngineSpec,
};

describe('articles de la fiche de préparation', () => {
  it('chaque option est un article à vendre au prix validé, rangé avec ceux du moteur ; l’origine n’en est pas un', () => {
    const options = ENGINE_SLOTS.flatMap((slot) => slot.options.map((option) => ({ slot, option })));
    expect(options).toHaveLength(Object.keys(PRIX).length);
    for (const { slot, option } of options) {
      const article = articleParId(articlePrep(slot.id, option.id));
      expect(article, option.id).toBeDefined();
      expect(article?.prix, option.id).toBe(PRIX[option.id]);
      expect(option.prix, option.id).toBe(PRIX[option.id]);
      expect(article?.famille).toBe('piece');
      expect(ARTICLES_MOTEUR).toContain(article);
      expect(A_VENDRE).toContain(article);
    }
    for (const slot of ENGINE_SLOTS) expect(articleParId(articlePrep(slot.id, 'origine'))).toBeUndefined();
  });
});

describe('sauvegarde d’avant : une option montée sans l’article', () => {
  // Une sauvegarde relue comme l'app la relit : builds et jeu passent par leur lecture tolérante.
  const builds = sanitizeBuilds(JSON.parse(JSON.stringify({ current: 'van', builds: { van: { parts: { reprog: 'stage3', nitro: 'nitro-gros' } } } })));
  const jeu = nettoyerEtat(JSON.parse(JSON.stringify({ solde: 0, articles: {} })));

  it('reste montée et agit sur la puissance : 175 ch et 150 ch de nitro, comme avant', () => {
    expect(chosenOption(van.engine, builds.builds.van, 'reprog')?.id).toBe('stage3');
    expect(computePrep(van, builds.builds.van)).toMatchObject({ origin: 102, gain: 73, prepared: 175, nitro: 150 });
  });

  it('n’est pas acquise : l’article manque, et un autre choix non payé demanderait l’achat', () => {
    expect(possedeDans(jeu, articlePrep('reprog', 'stage3'))).toBe(false);
    expect(possedeDans(jeu, articlePrep('reprog', 'stage1'))).toBe(false);
    expect(possedeDans({ articles: { [articlePrep('reprog', 'stage1')]: true } }, articlePrep('reprog', 'stage1'))).toBe(true);
  });
});
