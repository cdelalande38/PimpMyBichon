// Mise à jour appliquée d'office (src/pwa/majAuto.ts) : sans geste, oui ; après un geste, on propose.
import { describe, expect, it } from 'vitest';
import { MAJ_AUTO, peutAppliquerDoffice } from '../../src/pwa/majAuto.ts';

const base = { geste: false, enSortie: false, depuisLancementMs: 20_000, depuisDerniereMs: Number.POSITIVE_INFINITY };

describe('mise à jour appliquée d’office', () => {
  it('au garage, sans geste : la nouvelle version s’applique, même longtemps après le lancement', () => {
    expect(peutAppliquerDoffice(base)).toBe(true);
    expect(peutAppliquerDoffice({ ...base, depuisLancementMs: 3_600_000 })).toBe(true);
  });

  it('après un geste : on propose seulement', () => {
    expect(peutAppliquerDoffice({ ...base, geste: true })).toBe(false);
  });

  it('en sortie de nuit : seulement dans les premières secondes', () => {
    expect(peutAppliquerDoffice({ ...base, enSortie: true, depuisLancementMs: MAJ_AUTO.debutSortieMs - 1 })).toBe(true);
    expect(peutAppliquerDoffice({ ...base, enSortie: true, depuisLancementMs: MAJ_AUTO.debutSortieMs + 1 })).toBe(false);
  });

  it('jamais deux fois coup sur coup', () => {
    expect(peutAppliquerDoffice({ ...base, depuisDerniereMs: MAJ_AUTO.gardeMs - 1 })).toBe(false);
    expect(peutAppliquerDoffice({ ...base, depuisDerniereMs: MAJ_AUTO.gardeMs })).toBe(true);
  });
});
