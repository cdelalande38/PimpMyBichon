// Pièces montées (src/data/pieces.ts) : catalogue, résolution d'une option et repli sur l'origine,
// peinture, validation de la section `pieces` d'un manifeste, articles de la boutique, géométrie de pose.

import { describe, expect, it } from 'vitest';
import { A_VENDRE, articleParId } from '../../src/data/boutique.ts';
import { ARTICLES_AILERONS, PRIX_AILERONS } from '../../src/data/articles/ailerons.ts';
import {
  articleIdOf,
  bendDrop,
  checkPieces,
  crownDrop,
  fitPositions,
  isFree,
  optionsFor,
  originOf,
  PIECES_CATALOGUE,
  piecePaint,
  pieceTouched,
  posteById,
  postesOf,
  resolvePiece,
  spanMap,
  upTo,
  validatePiecesCatalogue,
} from '../../src/data/pieces.ts';
import { validateManifest, VEHICLES, vehicleById } from '../../src/data/vehicles.ts';
import type { PieceMount, PieceSurfaceMount, VehicleManifest } from '../../src/data/vehicleTypes.ts';
import { readCatalogue } from '../../tools/vehicles/pieces.mjs';

const aileron = posteById('aileron');
const vehicle = (id: string): VehicleManifest => {
  const found = vehicleById(id);
  if (!found) throw new Error(`${id} absent du catalogue`);
  return found;
};

const MOUNT: PieceSurfaceMount = {
  anchor: [-2, 1, 0],
  normal: [0, 1, 0],
  width: 1,
  supports: { anchor: [-1.8, 1, 0], normal: [0, 1, 0], spacing: 0.6, span: 1.4 },
};

describe('catalogue des pièces montées', () => {
  it('le poste « aileron » : l’absence de pièce et cinq options nettement différentes, surface et supports', () => {
    expect(aileron).toBeDefined();
    if (!aileron) return;
    expect(aileron.none.id).toBe('aucun');
    expect(aileron.options.map((option) => option.id)).toEqual(['becquet', 'queue_de_canard', 'bas', 'haut', 'demesure']);
    expect(new Set(aileron.options.map((option) => option.style)).size).toBe(5);
    expect(aileron.options.filter((option) => option.mount === 'surface').length).toBe(2);
    expect(aileron.options.filter((option) => option.mount === 'supports').length).toBe(3);
  });

  it('est celui que lit l’outil de fabrication', () => {
    expect(readCatalogue()).toEqual(PIECES_CATALOGUE);
  });

  it('refuse un catalogue faux, avec un message clair', () => {
    expect(() => validatePiecesCatalogue({ postes: [] })).toThrow(/postes/);
    expect(() => validatePiecesCatalogue({ postes: [{ ...aileron, options: [{ id: 'x', style: 's', mount: 'dessous', label: 'X', phrase: 'le x', picto: 'M0 0' }] }] })).toThrow(/mount/);
    expect(() => validatePiecesCatalogue({ postes: [{ ...aileron, reference: { width: 1.2, feet: 0.58 } }] })).toThrow(/reference/);
  });
});

describe('poste par véhicule', () => {
  it('les trois voitures ont un aileron (et le kit carrosserie), les motos n’en ont pas', () => {
    for (const vehicle of VEHICLES) {
      // La Cox a en plus son capot moteur (vague U, « capot » : tests/unit/capot.test.ts).
      const capot = vehicle.id === 'cox' ? ['capot'] : [];
      expect(postesOf(vehicle).map((poste) => poste.id), vehicle.id).toEqual(vehicle.kind === 'car' ? ['aileron', 'lame', 'jupes', 'diffuseur', ...capot] : []);
      if (vehicle.kind === 'bike') expect(resolvePiece(vehicle, undefined, 'aileron')).toBeNull();
    }
  });

  it('options permises : celles du manifeste, et pas d’aileron sur supports sans pieds déclarés', () => {
    expect(optionsFor(vehicle('cox'), 'aileron').map((option) => option.id)).toEqual(['becquet', 'queue_de_canard', 'bas', 'haut', 'demesure']);
    expect(optionsFor(vehicle('concept'), 'aileron').map((option) => option.id)).toEqual(['becquet', 'bas', 'haut', 'demesure']);
    const sansPieds = { pieces: { aileron: { ...MOUNT, supports: undefined } } };
    expect(optionsFor(sansPieds, 'aileron').map((option) => option.mount)).toEqual(['surface', 'surface']);
  });

  it('l’origine : aucune pièce, sauf une option d’origine déclarée ; l’origine et l’absence sont libres', () => {
    const cox = vehicle('cox');
    expect(originOf(cox, 'aileron')).toBe('aucun');
    expect(isFree(cox, 'aileron', 'aucun')).toBe(true);
    expect(isFree(cox, 'aileron', 'haut')).toBe(false);
    const usine = { pieces: { aileron: { ...MOUNT, default: 'becquet' } } };
    expect(originOf(usine, 'aileron')).toBe('becquet');
    expect(isFree(usine, 'aileron', 'becquet')).toBe(true);
    expect(isFree(usine, 'aileron', 'aucun')).toBe(true);
    expect(resolvePiece(usine, undefined, 'aileron')?.option?.id).toBe('becquet');
  });

  it('résout l’option du build ; une option inconnue ou non permise retombe sur l’origine', () => {
    const cox = vehicle('cox');
    const concept = vehicle('concept');
    expect(resolvePiece(cox, undefined, 'aileron')).toMatchObject({ id: 'aucun', option: null, own: null });
    expect(resolvePiece(cox, { paints: {}, parts: { aileron: 'haut' } }, 'aileron')?.option?.id).toBe('haut');
    expect(resolvePiece(cox, { paints: {}, parts: { aileron: 'fusee' } }, 'aileron')).toMatchObject({ id: 'aucun', option: null });
    expect(resolvePiece(concept, { paints: {}, parts: { aileron: 'queue_de_canard' } }, 'aileron')).toMatchObject({ id: 'aucun', option: null });
    const usine = { pieces: { aileron: { ...MOUNT, default: 'bas' } } };
    expect(resolvePiece(usine, { paints: {}, parts: { aileron: 'fusee' } }, 'aileron')?.id).toBe('bas');
    expect(resolvePiece(usine, { paints: {}, parts: { aileron: 'aucun' } }, 'aileron')).toMatchObject({ id: 'aucun', option: null });
  });

  it('couleur : celle de la caisse, ou la couleur propre ; une autre finition oublie la paillette de la caisse', () => {
    const body = { color: '#0a3a46', finish: 'paillete', flake: 1.2 } as const;
    expect(piecePaint(body, null)).toEqual(body);
    expect(piecePaint(body, { color: '#ff6a00' })).toEqual({ ...body, color: '#ff6a00' });
    expect(piecePaint(body, { color: '#ff6a00', finish: 'mat' })).toEqual({ color: '#ff6a00', finish: 'mat' });
    expect(piecePaint(body, { finish: 'inconnue' as 'mat' })).toEqual(body);
    const cox = vehicle('cox');
    const build = { paints: {}, partPaints: { aileron: { color: '#ff6a00' } } };
    expect(resolvePiece(cox, build, 'aileron')?.own).toEqual({ color: '#ff6a00' });
    expect(pieceTouched(build, 'aileron')).toBe(true);
    expect(pieceTouched({ paints: {} }, 'aileron')).toBe(false);
  });
});

describe('validation de la section pieces', () => {
  const base = (pieces: unknown) => {
    const problems: string[] = [];
    checkPieces({ pieces }, problems);
    return problems;
  };

  it('les manifestes du dépôt sont valides', () => {
    for (const vehicle of VEHICLES) expect(base(vehicle.pieces), vehicle.id).toEqual([]);
  });

  it('refuse poste inconnu, largeur, normale, options et envergure fausses', () => {
    expect(base({ fusee: MOUNT }).join()).toMatch(/poste inconnu/);
    expect(base({ aileron: { ...MOUNT, width: 0 } }).join()).toMatch(/width/);
    expect(base({ aileron: { ...MOUNT, normal: [0, 0, 0] } }).join()).toMatch(/normal/);
    expect(base({ aileron: { ...MOUNT, options: ['fusee'] } }).join()).toMatch(/options/);
    expect(base({ aileron: { ...MOUNT, default: 'fusee' } }).join()).toMatch(/default/);
    expect(base({ aileron: { ...MOUNT, supports: { ...MOUNT.supports, span: 0.7 } } }).join()).toMatch(/supports/);
    expect(base({ aileron: { ...MOUNT, crown: [[0.2, 0.01], [0.1, 0.02]] } }).join()).toMatch(/crown/);
    expect(base({ aileron: { ...MOUNT, bend: [[0, 0.01]] } }).join()).toMatch(/bend/);
  });

  it('un manifeste faux est refusé au chargement, chemin compris', () => {
    const cox = JSON.parse(JSON.stringify(vehicle('cox'))) as Record<string, unknown>;
    cox.pieces = { aileron: { ...MOUNT, width: 9 } };
    expect(() => validateManifest(cox, 'cox')).toThrow(/public\/assets\/vehicles\/cox\/vehicle\.json.*pieces\.aileron\.width/);
  });
});

describe('boutique : les articles des ailerons', () => {
  it('un article par option, piece-aileron-<option>, famille piece, 60 à 400 $, jamais pour l’absence de pièce', () => {
    expect(ARTICLES_AILERONS.map((article) => article.id)).toEqual(aileron?.options.map((option) => articleIdOf('aileron', option.id)));
    for (const article of ARTICLES_AILERONS) {
      expect(article.famille).toBe('piece');
      expect(article.prix).toBeGreaterThanOrEqual(60);
      expect(article.prix).toBeLessThanOrEqual(400);
      expect(article.description.length).toBeGreaterThan(10);
      expect(articleParId(article.id)).toBe(article);
      expect(A_VENDRE).toContain(article);
    }
    expect(articleParId(articleIdOf('aileron', 'aucun'))).toBeUndefined();
    expect(Object.keys(PRIX_AILERONS).sort()).toEqual([...(aileron?.options.map((option) => option.id) ?? [])].sort());
    // Plus l'aileron est gros, plus il coûte.
    const prix = ARTICLES_AILERONS.map((article) => article.prix ?? 0);
    expect([...prix].sort((a, b) => a - b)).toEqual(prix);
  });
});

describe('géométrie de pose', () => {
  it('profils : bombé symétrique, profil en long signé, prolongés par leur dernière pente', () => {
    const crown = [
      [0.1, 0.002],
      [0.2, 0.01],
    ] as const;
    expect(crownDrop(undefined, 0.3)).toBe(0);
    expect(crownDrop(crown, 0)).toBe(0);
    expect(crownDrop(crown, -0.1)).toBeCloseTo(0.002);
    expect(crownDrop(crown, 0.15)).toBeCloseTo(0.006);
    expect(crownDrop(crown, 0.3)).toBeCloseTo(0.018);
    const bend = [
      [-0.05, 0.004],
      [0.1, 0.002],
    ] as const;
    expect(bendDrop(bend, 0)).toBe(0);
    expect(bendDrop(bend, -0.025)).toBeCloseTo(0.002);
    expect(bendDrop(bend, 0.05)).toBeCloseTo(0.001);
    expect(bendDrop(bend, 0.2)).toBeCloseTo(0.004);
    expect(bendDrop(bend, -0.1)).toBeCloseTo(0.008);
  });

  it('envergure : pieds rigides à l’entraxe, bouts de lame à la demi-envergure, rien ne se croise', () => {
    if (!aileron) return;
    const ref = aileron.reference;
    const feet = ref.feet ?? 0;
    expect(feet).toBeGreaterThan(0);
    expect(spanMap(feet, ref, 0.4, 0.8)).toBeCloseTo(0.2);
    expect(spanMap(feet + 0.01, ref, 0.4, 0.8) - spanMap(feet - 0.01, ref, 0.4, 0.8)).toBeCloseTo(0.02);
    expect(spanMap(ref.width / 2, ref, 0.4, 0.8)).toBeCloseTo(0.8);
    expect(spanMap(-ref.width / 2 - 0.01, ref, 0.4, 0.8)).toBeCloseTo(-0.81);
    let last = -Infinity;
    for (let z = -0.7; z <= 0.7; z += 0.005) {
      const next = spanMap(z, ref, 0.3, 0.62);
      expect(next).toBeGreaterThan(last);
      last = next;
    }
  });

  it('rotation : +Y amené sur la normale, l’avant le long de la pente', () => {
    const n = [-0.6, 0.8, 0] as const;
    const r = upTo(n);
    const apply = (v: readonly [number, number, number]) => r.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
    expect(apply([0, 1, 0]).map((v) => Number(v.toFixed(6)))).toEqual([-0.6, 0.8, 0]);
    expect(apply([1, 0, 0]).map((v) => Number(v.toFixed(6)))).toEqual([0.8, 0.6, 0]);
    expect(apply([0, 0, 1]).map((v) => Number(v.toFixed(6)))).toEqual([0, 0, 1]);
    expect(upTo([0, 1, 0])).toEqual([
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]);
  });

  it('une pièce de surface se pose au bord de fuite, mise à la largeur utile ; les pieds descendent sur la surface', () => {
    if (!aileron) return;
    const mount: PieceMount = { ...MOUNT, crown: [[0.5, 0.02]], supports: { ...MOUNT.supports!, normal: [-0.6, 0.8, 0], crown: [[0.3, 0.01]] } };
    const surface = fitPositions([0, 0, 0, 0, 0, 0.6, 0.1, 0.05, 0], 'surface', mount, aileron, {});
    expect([...surface].map((v) => Number(v.toFixed(4)))).toEqual([-2, 1, 0, -2, 0.98, 0.5, -1.9, 1.05, 0]);
    // Pied à x = 0,1 sur une pente de 0,75 : il monte de 7,5 cm, et descend du bombé à l'entraxe ; la lame ne bouge pas.
    const level = fitPositions([0.1, -0.004, aileron.reference.feet ?? 0, 0.1, 0.3, 0], 'niveau', mount, aileron, {});
    expect(level[0]).toBeCloseTo(-1.7);
    expect(level[1]).toBeCloseTo(1 - 0.004 + 0.075 - 0.01);
    expect(level[2]).toBeCloseTo(0.3);
    expect(level[4]).toBeCloseTo(1.3);
  });
});
