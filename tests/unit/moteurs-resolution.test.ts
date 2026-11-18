// Établi moteur (src/data/moteurs.ts) : résolution d'un traitement et d'un échange depuis le build,
// repli sur l'origine pour une valeur inconnue ou non permise, ce qu'on écrit, « D'origine » et la
// signature que la scène suit.

import { describe, expect, it } from 'vitest';
import {
  cleMoteur,
  clesMoteur,
  echangeLibre,
  ecritTraitement,
  familleById,
  noeudsDe,
  noeudsFamille,
  moteurTouche,
  pieceById,
  resolveEchange,
  resolveTraitement,
  signatureEtabli,
  traitementById,
  traitementsDe,
  type MoteurFamille,
  type MoteurPiece,
  type Traitement,
} from '../../src/data/moteurs.ts';
import type { Build } from '../../src/data/vehicleTypes.ts';

const famille = familleById('quatre-a-plat') as MoteurFamille;
const piece = (id: string) => pieceById(famille, id) as MoteurPiece;
const traitement = (id: string) => traitementById(id) as Traitement;
const build = (partPaints: Build['partPaints'] = {}, parts: Build['parts'] = {}): Build => ({ paints: {}, partPaints, parts });

describe('traitement d’une pièce', () => {
  it('sans rien d’écrit : brut de fonderie, sans couleur', () => {
    expect(resolveTraitement(piece('cache_culbuteurs'), undefined)).toEqual({ traitement: traitement('brut'), couleur: null });
    expect(resolveTraitement(piece('cache_culbuteurs'), build())).toEqual({ traitement: traitement('brut'), couleur: null });
  });

  it('la finition écrite désigne son traitement ; la couleur suit les traitements à couleur libre', () => {
    const b = build({
      [cleMoteur('cache_culbuteurs')]: { finish: 'chrome' },
      [cleMoteur('toles')]: { finish: 'brillant', color: '#00ff88' },
      [cleMoteur('poulies')]: { finish: 'chrome-colore' },
      [cleMoteur('carters')]: { finish: 'chrome', color: '#123456' },
    });
    expect(resolveTraitement(piece('cache_culbuteurs'), b)).toEqual({ traitement: traitement('chrome'), couleur: null });
    expect(resolveTraitement(piece('toles'), b)).toEqual({ traitement: traitement('peinture'), couleur: '#00ff88' });
    // Anodisé sans couleur écrite : sa teinte de départ.
    expect(resolveTraitement(piece('poulies'), b).couleur).toBe(traitement('anodise').teinte);
    // Une couleur gardée d'un traitement précédent ne compte pas pour le chrome.
    expect(resolveTraitement(piece('carters'), b).couleur).toBeNull();
  });

  it('une valeur inconnue, ou un traitement que la pièce n’admet pas, retombe sur l’origine', () => {
    const b = build({ [cleMoteur('carters')]: { finish: 'candy' }, [cleMoteur('fils')]: { finish: 'chrome' }, [cleMoteur('culasses')]: { color: '#ff0000' } });
    expect(resolveTraitement(piece('carters'), b).traitement.id).toBe('brut');
    expect(traitementsDe(piece('fils')).map((item) => item.id)).toEqual(['brut', 'peinture']);
    expect(resolveTraitement(piece('fils'), b).traitement.id).toBe('brut');
    expect(resolveTraitement(piece('culasses'), b).traitement.id).toBe('brut');
  });

  it('ce qu’on écrit : rien pour l’origine, la finition qui porte le traitement, la couleur s’il en a une', () => {
    expect(ecritTraitement(traitement('brut'))).toBeNull();
    expect(ecritTraitement(traitement('chrome'))).toEqual({ finish: 'chrome' });
    expect(ecritTraitement(traitement('peinture'), '#abcdef')).toEqual({ finish: 'brillant', color: '#abcdef' });
    expect(ecritTraitement(traitement('anodise'))).toEqual({ finish: 'chrome-colore', color: traitement('anodise').teinte });
    // Aller-retour : ce qui est écrit se relit tel quel.
    for (const item of traitementsDe(piece('carters'))) {
      const written = ecritTraitement(item, '#445566');
      const relu = resolveTraitement(piece('carters'), build(written ? { [cleMoteur('carters')]: written } : {}));
      expect(relu.traitement.id, item.id).toBe(item.id);
    }
  });
});

describe('échange d’une pièce', () => {
  it('l’origine par défaut, l’option écrite, le repli sur l’origine pour une option inconnue', () => {
    const filtres = piece('filtres');
    expect(resolveEchange(filtres, undefined)?.id).toBe('boitier');
    expect(resolveEchange(filtres, build({}, { [cleMoteur('filtres')]: 'cornets' }))?.id).toBe('cornets');
    expect(resolveEchange(filtres, build({}, { [cleMoteur('filtres')]: 'turbo' }))?.id).toBe('boitier');
    expect(resolveEchange(piece('carters'), undefined)).toBeNull();
    expect(echangeLibre(filtres, 'boitier')).toBe(true);
    expect(echangeLibre(filtres, 'coniques')).toBe(false);
  });

  it('les nœuds montrés sont ceux de l’option posée ; chaque nœud connaît sa pièce et son éclatement', () => {
    const filtres = piece('filtres');
    expect(Object.keys(noeudsDe(filtres, build({}, { [cleMoteur('filtres')]: 'coniques' })))).toEqual(['filtre_conique']);
    const nodes = noeudsFamille(famille);
    expect(nodes.get('filtre_cornet')).toEqual({ piece: 'filtres', eclate: [0.12, 0.5, 0], option: 'cornets' });
    expect(nodes.get('cylindres_g')?.piece).toBe('cylindres');
    // Deux moitiés symétriques s'écartent dans des sens opposés.
    expect(nodes.get('culasses_g')?.eclate[2]).toBe(-(nodes.get('culasses_d')?.eclate[2] ?? 0));
  });
});

describe('« D’origine » et signature', () => {
  it('« D’origine » efface tous les échanges et traitements du moteur, et seulement eux', () => {
    const keys = clesMoteur(famille);
    expect(keys.parts).toEqual([cleMoteur('filtres')]);
    expect(keys.partPaints).toHaveLength(famille.pieces.length);
    expect(moteurTouche(famille, build())).toBe(false);
    expect(moteurTouche(famille, build({ [cleMoteur('carters')]: { finish: 'chrome' } }))).toBe(true);
    expect(moteurTouche(famille, build({}, { [cleMoteur('filtres')]: 'cornets' }))).toBe(true);
    // Une couleur de pneu ou un aileron n'ont rien à voir avec le moteur.
    expect(moteurTouche(famille, build({ marque: { color: '#ffffff' } }, { aileron: 'haut' }))).toBe(false);
  });

  it('la signature de la scène change avec un traitement, une couleur ou une option, pas avec le reste', () => {
    const base = signatureEtabli(famille, build());
    expect(signatureEtabli(famille, build({ marque: { color: '#ffffff' } }))).toBe(base);
    const chrome = signatureEtabli(famille, build({ [cleMoteur('carters')]: { finish: 'chrome' } }));
    expect(chrome).not.toBe(base);
    expect(signatureEtabli(famille, build({ [cleMoteur('toles')]: { finish: 'brillant', color: '#111111' } }))).not.toBe(signatureEtabli(famille, build({ [cleMoteur('toles')]: { finish: 'brillant', color: '#222222' } })));
    expect(signatureEtabli(famille, build({}, { [cleMoteur('filtres')]: 'cornets' }))).not.toBe(base);
  });
});
