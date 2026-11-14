// Budgets des modèles 3D : lecture du conteneur GLB, comptage des triangles et des primitives,
// dimensions des textures, et règles de assets-check (véhicules : erreurs ; banc d'essai : avertissements).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { countGeometry, imageSize, measureGlb, parseGlb } from '../../../tools/lib/glb.mjs';
import { runAssetsCheck } from '../../../tools/lib/assets.mjs';
import { MODEL_LIMITS } from '../../../tools/lib/models.mjs';
import { jpeg, ktx2, makeGlb, manyPrimitives, png, TINY_GLB, webp } from './glb-fixture.ts';
import { creditsFile, located, messagesOf, useTempTrees } from './helpers.ts';
import type { GlbSpec } from './glb-fixture.ts';
import type { TreeSpec } from './helpers.ts';

const CREDITED: TreeSpec = { 'CREDITS.md': creditsFile(['public/assets/**', 'création projet']) };
const VEHICLE = 'public/assets/vehicles/demo';

/** Un véhicule complet dont le body.glb vient de la fabrique. */
function vehicleWith(body: Uint8Array): TreeSpec {
  return {
    ...CREDITED,
    [`${VEHICLE}/vehicle.json`]: JSON.stringify({ id: 'demo' }),
    [`${VEHICLE}/body.glb`]: body,
    [`${VEHICLE}/thumb.webp`]: webp(8),
  };
}

/** Parse un GLB fabriqué et en mesure le contenu. */
function measure(spec: GlbSpec) {
  const parsed = parseGlb(makeGlb(spec));
  if (!parsed.ok) throw new Error(parsed.message);
  return measureGlb(parsed.container);
}

describe('GLB — lecture du conteneur', () => {
  it('lit le JSON et le binaire', () => {
    const parsed = parseGlb(makeGlb({ meshes: [[{ indices: 6 }]], images: [png(4)] }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.container.json.asset).toEqual({ version: '2.0' });
    expect(parsed.container.bin.length).toBeGreaterThanOrEqual(33);
  });

  it('lit un GLB sans bloc binaire', () => {
    const parsed = parseGlb(TINY_GLB);
    expect(parsed.ok && parsed.container.bin.length).toBe(0);
  });

  const broken: Array<[string, Uint8Array, string]> = [
    ['vide', new Uint8Array(0), 'trop court'],
    ['sans en-tête', new Uint8Array(40).fill(7), 'ne commence pas par « glTF »'],
    ['en version 1', makeGlb({ version: 1 }), 'version 1'],
    ['tronqué', TINY_GLB.subarray(0, TINY_GLB.length - 4), 'fichier tronqué'],
    ['au JSON invalide', makeGlb({ rawJson: '{ "asset": ' }), 'bloc JSON invalide'],
    ['dont le JSON est un tableau', makeGlb({ rawJson: '[]' }), "ce n'est pas un objet"],
  ];
  it.each(broken)('refuse un GLB %s', (_label, bytes, expected) => {
    const parsed = parseGlb(bytes);
    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.message).toContain(expected);
  });

  it('refuse un GLB dont un bloc dépasse le fichier', () => {
    const bytes = TINY_GLB.slice();
    new DataView(bytes.buffer).setUint32(12, 1_000_000, true);
    const parsed = parseGlb(bytes);
    expect(!parsed.ok && parsed.message).toContain('bloc tronqué');
  });

  it('refuse un GLB sans bloc JSON', () => {
    const bytes = new Uint8Array(12);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 0x46546c67, true);
    view.setUint32(4, 2, true);
    view.setUint32(8, 12, true);
    const parsed = parseGlb(bytes);
    expect(!parsed.ok && parsed.message).toBe('bloc JSON absent');
  });
});

describe('GLB — triangles et primitives', () => {
  it('compte indices / 3, ou sommets / 3 sans indices', () => {
    const stats = measure({ meshes: [[{ indices: 30 }, { vertices: 12 }], [{ indices: 6 }]] });
    expect(stats).toMatchObject({ triangles: 10 + 4 + 2, primitives: 3, meshes: 2 });
  });

  it('compte une bande ou un éventail en n - 2, et ignore les lignes et les points', () => {
    const stats = measure({
      meshes: [[{ indices: 10, mode: 5 }, { indices: 6, mode: 6 }, { indices: 8, mode: 1 }, { vertices: 9, mode: 0 }]],
    });
    expect(stats).toMatchObject({ triangles: 8 + 4, primitives: 4 });
  });

  it('ne plante pas sur un JSON sans maillage ou aux accesseurs absents', () => {
    expect(countGeometry({})).toEqual({ triangles: 0, primitives: 0, meshes: 0 });
    expect(countGeometry({ meshes: [{ primitives: [{ indices: 9 }, 'x', {}] }, 'y'] })).toEqual({
      triangles: 0,
      primitives: 2,
      meshes: 2,
    });
  });
});

describe('GLB — dimensions des images', () => {
  it.each([
    ['KTX2', ktx2(2048, 1024), 2048, 1024],
    ['PNG', png(512, 256), 512, 256],
    ['JPEG', jpeg(1024, 768), 1024, 768],
    ['WebP', webp(640, 480, 'VP8L'), 640, 480],
    ['WebP', webp(4096, 2048, 'VP8X'), 4096, 2048],
    ['WebP', webp(300, 200, 'VP8 '), 300, 200],
  ])('lit les dimensions d’un %s', (format, bytes, width, height) => {
    expect(imageSize(bytes)).toEqual({ format, width, height });
  });

  it('rend null pour des octets inconnus ou coupés', () => {
    expect(imageSize(new Uint8Array(0))).toBeNull();
    expect(imageSize(new Uint8Array(64).fill(1))).toBeNull();
    expect(imageSize(png(4).subarray(0, 12))).toBeNull();
    expect(imageSize(jpeg(8).subarray(0, 12))).toBeNull();
  });

  it('mesure les images embarquées dans le GLB, dans l’ordre', () => {
    const stats = measure({ images: [ktx2(2048), png(64, 32), new Uint8Array(40)] });
    expect(stats.images).toEqual([
      { index: 0, format: 'KTX2', width: 2048, height: 2048 },
      { index: 1, format: 'PNG', width: 64, height: 32 },
      { index: 2, format: 'inconnu', width: null, height: null },
    ]);
  });
});

describe('assets-check — budgets des véhicules', () => {
  const tree = useTempTrees();

  it('accepte un véhicule au maximum de chaque budget, et le chiffre', () => {
    const body = makeGlb({
      meshes: [[{ indices: 3 * MODEL_LIMITS.triangles }], ...manyPrimitives(MODEL_LIMITS.primitives - 1, 0)],
      images: [ktx2(2048), ktx2(1024)],
    });
    const report = runAssetsCheck({ root: tree(vehicleWith(body)) });
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    const note = report.notes.find((item) => item.file === `${VEHICLE}/body.glb`);
    expect(note?.rule).toBe('modele');
    expect(note?.message).toContain('400 000 triangles, 80 primitives dans 80 maillages');
    expect(note?.message).toContain('2 textures (la plus grande : 2048 × 2048, 2 sur 2 en KTX2)');
    expect(messagesOf(report.notes)).toContain('1 modèle GLB mesuré sous public/assets/');
  });

  it('refuse un véhicule d’un triangle de trop', () => {
    const body = makeGlb({ meshes: [[{ indices: 3 * MODEL_LIMITS.triangles + 3 }]] });
    const report = runAssetsCheck({ root: tree(vehicleWith(body)) });
    expect(located(report.errors)).toEqual([`${VEHICLE}/body.glb:0 modele-triangles`]);
    expect(report.errors[0]?.message).toContain('400 001 triangles');
    expect(report.errors[0]?.message).toContain('dépassement de 1');
  });

  it('refuse un véhicule d’une primitive de trop', () => {
    const body = makeGlb({ meshes: manyPrimitives(MODEL_LIMITS.primitives + 1) });
    const report = runAssetsCheck({ root: tree(vehicleWith(body)) });
    expect(located(report.errors)).toEqual([`${VEHICLE}/body.glb:0 modele-appels`]);
    expect(report.errors[0]?.message).toContain('81 primitives');
  });

  it('compte les primitives de tous les maillages, pas seulement celles du premier', () => {
    const body = makeGlb({ meshes: [manyPrimitives(40).flat(), manyPrimitives(41).flat()] });
    expect(located(runAssetsCheck({ root: tree(vehicleWith(body)) }).errors)).toEqual([`${VEHICLE}/body.glb:0 modele-appels`]);
  });

  it('refuse une texture de plus de 2048 px, de quelque côté que ce soit', () => {
    const body = makeGlb({ meshes: [[{ indices: 3 }]], images: [ktx2(2048), ktx2(1024, 4096), png(2049, 16)] });
    const report = runAssetsCheck({ root: tree(vehicleWith(body)) });
    expect(located(report.errors)).toEqual([`${VEHICLE}/body.glb:0 modele-texture`]);
    expect(report.errors[0]?.message).toContain('2 textures dépassent 2048 px');
    expect(report.errors[0]?.message).toContain('1024 × 4096 (image 1)');
  });

  it('avertit des textures qui ne sont pas en KTX2, sans échouer', () => {
    const body = makeGlb({ meshes: [[{ indices: 3 }]], images: [ktx2(1024), png(512), jpeg(256), webp(128)] });
    const report = runAssetsCheck({ root: tree(vehicleWith(body)) });
    expect(report.errors).toEqual([]);
    expect(located(report.warnings)).toEqual([`${VEHICLE}/body.glb:0 modele-format`]);
    expect(report.warnings[0]?.message).toContain('3 textures sur 4 hors KTX2');
    expect(report.warnings[0]?.message).toContain("l'image 1, PNG");
  });

  it('avertit d’une texture aux dimensions illisibles', () => {
    const body = makeGlb({ meshes: [[{ indices: 3 }]], images: [new Uint8Array(40).fill(1)] });
    const report = runAssetsCheck({ root: tree(vehicleWith(body)) });
    expect(report.errors).toEqual([]);
    expect(report.warnings.map((item) => item.rule)).toEqual(['modele-format', 'modele-texture']);
  });

  it.each([
    ['sans en-tête', new Uint8Array(64).fill(9), 'ne commence pas par « glTF »'],
    ['tronqué', TINY_GLB.subarray(0, TINY_GLB.length - 8), 'fichier tronqué'],
    ['au JSON invalide', makeGlb({ rawJson: '{' }), 'bloc JSON invalide'],
  ])('refuse un body.glb %s', (_label, body, expected) => {
    const report = runAssetsCheck({ root: tree(vehicleWith(body)) });
    expect(located(report.errors)).toEqual([`${VEHICLE}/body.glb:0 modele`]);
    expect(report.errors[0]?.message).toContain('GLB illisible');
    expect(report.errors[0]?.message).toContain(expected);
  });

  it('ne double pas l’erreur d’un body.glb vide, déjà refusé par la règle du véhicule', () => {
    const report = runAssetsCheck({ root: tree({ ...vehicleWith(TINY_GLB), [`${VEHICLE}/body.glb`]: '' }) });
    expect(located(report.errors)).toEqual([`${VEHICLE}/body.glb:0 vehicule`]);
  });

  it('lit aussi les variantes du véhicule et les majuscules de l’extension', () => {
    const heavy = makeGlb({ meshes: manyPrimitives(81) });
    const root = tree({ ...vehicleWith(TINY_GLB), [`${VEHICLE}/variants/Jante.GLB`]: heavy });
    expect(located(runAssetsCheck({ root }).errors)).toEqual([`${VEHICLE}/variants/Jante.GLB:0 modele-appels`]);
  });
});

describe('assets-check — banc d’essai et autres dossiers', () => {
  const tree = useTempTrees();
  const bench = 'public/assets/bench/essai/modele.glb';

  it('ne donne que des avertissements pour le banc d’essai, avec les mêmes seuils', () => {
    const body = makeGlb({
      meshes: [[{ indices: 3 * (MODEL_LIMITS.triangles + 1) }], ...manyPrimitives(MODEL_LIMITS.primitives)],
      images: [png(4096)],
    });
    const report = runAssetsCheck({ root: tree({ ...CREDITED, [bench]: body }) });
    expect(report.errors).toEqual([]);
    expect(located(report.warnings)).toEqual([
      `${bench}:0 modele-appels`,
      `${bench}:0 modele-format`,
      `${bench}:0 modele-texture`,
      `${bench}:0 modele-triangles`,
    ]);
    expect(report.warnings[0]?.message).toContain('banc d\'essai, substitut déclaré');
  });

  it('laisse passer le banc d’essai sous les seuils, sans avertissement', () => {
    const report = runAssetsCheck({ root: tree({ ...CREDITED, [bench]: makeGlb({ meshes: [[{ indices: 30 }]], images: [ktx2(2048)] }) }) });
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.notes.find((item) => item.file === bench)?.message).toContain('10 triangles, 1 primitive dans 1 maillage');
  });

  it('refuse un GLB illisible du banc d’essai : ce n’est pas un dépassement de budget', () => {
    const report = runAssetsCheck({ root: tree({ ...CREDITED, [bench]: new Uint8Array(64).fill(3) }) });
    expect(located(report.errors)).toEqual([`${bench}:0 modele`]);
  });

  it('mesure les autres GLB sans leur appliquer de seuil, et refuse ceux qui sont illisibles', () => {
    const heavy = makeGlb({ meshes: manyPrimitives(200), images: [png(4096)] });
    const root = tree({
      ...CREDITED,
      'public/assets/garage/sol.glb': heavy,
      'public/assets/city/route.glb': new Uint8Array(64).fill(3),
      'docs/hors-assets.glb': new Uint8Array(64).fill(3),
    });
    const report = runAssetsCheck({ root });
    expect(located(report.errors)).toEqual(['public/assets/city/route.glb:0 modele']);
    expect(report.warnings).toEqual([]);
    expect(messagesOf(report.notes)).toContain('200 primitives dans 200 maillages, 1 texture (la plus grande : 4096 × 4096, 0 sur 1 en KTX2)');
  });

  it('lit une texture voisine du GLB quand l’image a une URI relative, et signale celle qui manque', () => {
    const json = JSON.stringify({
      asset: { version: '2.0' },
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      accessors: [{ count: 3 }],
      images: [{ uri: 'textures/caisse.png' }, { uri: 'textures/absente.png' }, { uri: '../../secret.png' }],
    });
    const root = tree({ ...CREDITED, [bench]: makeGlb({ rawJson: json }) });
    mkdirSync(join(root, 'public/assets/bench/essai/textures'), { recursive: true });
    writeFileSync(join(root, 'public/assets/bench/essai/textures/caisse.png'), png(512));
    const report = runAssetsCheck({ root });
    expect(report.errors).toEqual([]);
    const message = report.notes.find((item) => item.file === bench)?.message ?? '';
    expect(message).toContain('3 textures (la plus grande : 512 × 512, 0 sur 3 en KTX2)');
    expect(report.warnings.map((item) => item.message).join('\n')).toContain('2 textures aux dimensions illisibles');
  });

  it('note qu’il n’y a aucun modèle à mesurer', () => {
    const report = runAssetsCheck({ root: tree() });
    expect(messagesOf(report.notes)).toContain('0 modèle GLB mesuré sous public/assets/');
  });
});
