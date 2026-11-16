// Outils de fabrication des sons (tools/sons/) : boucle sans couture, niveau, fondus, lecture des
// listes du dossier privé, identifiants neutres, emplacements suggérés. Le signal d'essai est un
// bruit filtré tiré d'une suite pseudo-aléatoire fixe : il ne sort jamais des tests.

import { describe, expect, it } from 'vitest';
import { idPrise, licence, lireTableau, regimeDecrit } from '../../tools/sons/catalogue.mjs';
import { suggestion } from '../../tools/sons/emplacements.mjs';
import { adoucir, boucler, niveauAudible, niveler, PLAFOND, TAUX } from '../../tools/sons/signal.mjs';

/** Bruit filtré (marche aléatoire amortie), reproductible. */
function bruit(seconds: number, seed = 7): Float32Array {
  const out = new Float32Array(Math.round(seconds * TAUX));
  let state = seed;
  let value = 0;
  for (let i = 0; i < out.length; i += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    value = value * 0.995 + ((state / 2 ** 32) - 0.5) * 0.05;
    out[i] = value;
  }
  return out;
}

describe('boucle sans couture', () => {
  const source = bruit(4);
  const fondu = 0.1;
  const fait = boucler(source, 1, 3, fondu);

  it('garde la longueur demandée, au raccord près (± 20 ms)', () => {
    expect(Math.abs(fait.pcm.length / TAUX - 2)).toBeLessThanOrEqual(0.0201);
    expect(fait.debut).toBe(1);
  });

  it('le dernier échantillon enchaîne sur le premier comme dans l’enregistrement', () => {
    const a = Math.round(fait.debut * TAUX);
    // Fin de la boucle : fondue vers ce qui précède le début ; le dernier échantillon est presque
    // celui qui précède le début, et le saut au bouclage ne dépasse pas un pas ordinaire du signal.
    const last = fait.pcm[fait.pcm.length - 1]!;
    expect(Math.abs(last - source[a - 1]!)).toBeLessThan(0.01);
    const jump = Math.abs(fait.pcm[0]! - last);
    let ordinary = 0;
    for (let i = 1; i < source.length; i += 1) ordinary = Math.max(ordinary, Math.abs(source[i]! - source[i - 1]!));
    expect(jump).toBeLessThanOrEqual(ordinary * 1.5);
  });

  it('refuse une boucle plus courte que deux fondus', () => {
    expect(() => boucler(source, 1, 1.15, fondu)).toThrow();
  });
});

describe('niveau et fondus', () => {
  it('règle le niveau audible sur la cible, sans dépasser −1 dBFS en crête', () => {
    const quiet = bruit(2).map((v) => v * 0.1);
    const fait = niveler(quiet, -30);
    expect(niveauAudible(fait.pcm)).toBeCloseTo(-30, 0);
    const loud = niveler(bruit(2), 0);
    expect(loud.limite).toBe(true);
    expect(Math.max(...loud.pcm.map(Math.abs))).toBeLessThanOrEqual(PLAFOND + 1e-6);
  });

  it('début et fin d’un son ponctuel ramenés à zéro', () => {
    const fait = adoucir(bruit(1).map((v) => v + 0.5));
    expect(fait[0]).toBe(0);
    expect(Math.abs(fait[fait.length - 1]!)).toBeLessThan(1e-3);
  });
});

describe('listes du dossier privé', () => {
  it('lit un tableau « ; » à en-tête', () => {
    expect(lireTableau('a;b\n1;2\n\n3;4\n')).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '4' },
    ]);
  });

  it('identifiant neutre : numéro Freesound, sinon empreinte du chemin', () => {
    expect(idPrise({ fichier: 'engines/v8/brut_x.wav', source: 'Freesound 146832' })).toBe('freesound-146832');
    const other = idPrise({ fichier: 'engines/v8/brut_x.ogg', source: 'Wikimedia Commons' });
    expect(other).toMatch(/^prise-[0-9a-f]{10}$/);
    expect(other).not.toContain('brut');
  });

  it('licences : CC0, CC BY 3.0 et 4.0 reconnues, le reste illisible', () => {
    expect(licence('CC0 (attribution appréciée)')).toMatchObject({ code: 'CC0-1.0', citer: false });
    expect(licence('CC BY 3.0 (citer l’auteur)')).toMatchObject({ code: 'CC-BY-3.0', citer: true });
    expect(licence('CC BY 4.0')).toMatchObject({ code: 'CC-BY-4.0', citer: true });
    expect(licence('CC BY-NC 4.0').code).toBe('inconnue');
  });

  it('emplacement suggéré par le nom de la découpe, régime lu dans la description', () => {
    expect(suggestion('rev2')).toEqual({ emplacement: 'rev', regime: null });
    expect(suggestion('tenu-2500')).toEqual({ emplacement: 'low', regime: 2500 });
    expect(suggestion('tenu-4000').emplacement).toBe('mid');
    expect(suggestion('tenu-6100').emplacement).toBe('high');
    expect(suggestion('roulage').emplacement).toBeNull();
    expect(suggestion('cle-a-chocs').emplacement).toBe('cle-a-chocs');
    expect(regimeDecrit('ralenti stable, environ 1 350 tr/min estimés')).toBe(1350);
    expect(regimeDecrit('ralenti stable')).toBeNull();
  });
});
