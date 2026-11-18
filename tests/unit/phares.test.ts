// Phares (Custom › Phares, vague T) : options et sauvegarde (src/data/phares.ts), articles de la boutique
// (src/data/articles/phares.ts), section `lights` des manifestes, réglages posés sur les optiques
// (src/scene/vehicle/phares.ts) au garage comme en sortie, sur des maillages d'essai et sur les cinq
// modèles du catalogue.
import { readdirSync, readFileSync } from 'node:fs';
import { BoxGeometry, Color, CustomBlending, Group, Mesh, MeshStandardMaterial, ShaderMaterial, type Material } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { articleParId, PIECES } from '../../src/data/boutique.ts';
import { ARTICLES_PHARES } from '../../src/data/articles/phares.ts';
import {
  ARTICLE_TEINTE,
  articleCouleur,
  articleFeux,
  beamTint,
  checkLights,
  COULEURS_PHARES,
  DEFAULT_LIGHTS,
  lightNamed,
  lightsOf,
  linearOf,
  OPTIONS_FEUX,
  pharesTouches,
  resolvePhares,
  ROUTE_LIGHT,
  routeLight,
  TEINTE_OPTIQUES,
} from '../../src/data/phares.ts';
import { validateManifest } from '../../src/data/vehicles.ts';
import type { VehicleManifest } from '../../src/data/vehicleTypes.ts';
import { HEADLIGHT } from '../../src/drive/scene/materiaux.ts';
import { applyLights, createLightsRig, disposeLightsRig, tintAdditive } from '../../src/scene/vehicle/phares.ts';

// Les modules .tsx échappent au typage des tests (pas de jsx dans tsconfig.node.json) : import
// dynamique, et la part utile de leur interface écrite ici (comme tests/unit/roues-place.test.ts).
interface VehicleModelModule {
  prepare: (source: Group, vehicle: VehicleManifest) => { root: Group };
}
interface DriveModule {
  prepareForDrive: (source: Group, vehicle: VehicleManifest) => { prepared: { root: Group }; tails: MeshStandardMaterial[] };
}
const { prepare } = (await import(/* @vite-ignore */ '../../src/scene/vehicle/VehicleModel.tsx')) as VehicleModelModule;
const { prepareForDrive } = (await import(/* @vite-ignore */ '../../src/drive/scene/vehicule.tsx')) as DriveModule;

const luminance = ([r, g, b]: [number, number, number]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

describe('options des phares', () => {
  it('l’origine d’abord, blanc chaud, la teinte halogène de la route éclairée ; identifiants uniques', () => {
    expect(COULEURS_PHARES[0]).toMatchObject({ id: 'chaud', origine: true, color: HEADLIGHT.color });
    expect(OPTIONS_FEUX[0]).toMatchObject({ id: 'rouges', origine: true, lueur: 1 });
    expect(COULEURS_PHARES.filter((item) => item.origine)).toHaveLength(1);
    expect(OPTIONS_FEUX.filter((item) => item.origine)).toHaveLength(1);
    expect(new Set(COULEURS_PHARES.map((item) => item.id)).size).toBe(COULEURS_PHARES.length);
    // Blanc froid, jaune, bleu glacier et au moins deux teintes franches.
    expect(COULEURS_PHARES.map((item) => item.id)).toEqual(expect.arrayContaining(['froid', 'jaune', 'glacier']));
    expect(COULEURS_PHARES.length).toBeGreaterThanOrEqual(6);
    for (const item of [...COULEURS_PHARES, ...OPTIONS_FEUX]) {
      expect(item.label.length).toBeGreaterThan(2);
      expect(item.hint.length).toBeGreaterThan(2);
    }
    // Lueur gardée dans l'optique : entière pour les blancs, adoucie pour les teintes (sinon blanc à l'image).
    for (const item of COULEURS_PHARES) {
      expect(item.lueur, item.id).toBeGreaterThan(0);
      expect(item.lueur, item.id).toBeLessThanOrEqual(1);
    }
    expect(COULEURS_PHARES[0]?.lueur).toBe(1);
  });

  it('lit la sauvegarde : rien d’écrit ou inconnu, l’origine ; la teinte bornée de 0 à 1', () => {
    expect(resolvePhares(undefined)).toMatchObject({ couleur: { id: 'chaud' }, teinte: 0, feux: { id: 'rouges' } });
    expect(resolvePhares({ parts: { phares: 'violet', feux: 'fumes' }, tune: { phares_teinte: 0.4 } })).toMatchObject({ couleur: { id: 'violet' }, teinte: 0.4, feux: { id: 'fumes' } });
    expect(resolvePhares({ parts: { phares: 'disparu', feux: 'chrome' }, tune: { phares_teinte: 7 } })).toMatchObject({ couleur: { id: 'chaud' }, teinte: 1, feux: { id: 'rouges' } });
    expect(resolvePhares({ tune: { phares_teinte: Number.NaN } }).teinte).toBe(0);
    expect(resolvePhares({ tune: { phares_teinte: -2 } }).teinte).toBe(0);
    expect(pharesTouches(undefined)).toBe(false);
    expect(pharesTouches({ parts: { phares: 'inconnu' } })).toBe(false);
    expect(pharesTouches({ tune: { phares_teinte: 0.1 } })).toBe(true);
    expect(pharesTouches({ parts: { feux: 'fumes' } })).toBe(true);
  });
});

describe('boutique des phares', () => {
  it('chaque option autre que l’origine a son article (famille pièce, 60 à 400 $) ; l’origine n’en a pas', () => {
    const attendus = [
      ...COULEURS_PHARES.filter((item) => !item.origine).map((item) => articleCouleur(item.id)),
      ARTICLE_TEINTE,
      ...OPTIONS_FEUX.filter((item) => !item.origine).map((item) => articleFeux(item.id)),
    ];
    expect(ARTICLES_PHARES.map((article) => article.id).sort()).toEqual([...attendus].sort());
    for (const article of ARTICLES_PHARES) {
      expect(article.id).toMatch(/^piece-(phares|feux)-[a-z]+$/);
      expect(article.famille).toBe('piece');
      expect(article.prix).toBeGreaterThanOrEqual(60);
      expect(article.prix).toBeLessThanOrEqual(400);
      expect(article.description).toMatch(/\.$/);
      expect(PIECES).toContain(article);
      expect(articleParId(article.id)).toBe(article);
    }
    expect(articleParId(articleCouleur('chaud'))).toBeUndefined();
    expect(articleParId(articleFeux('rouges'))).toBeUndefined();
    // L'article de la teinte ne se confond avec aucune couleur.
    expect(COULEURS_PHARES.map((item) => articleCouleur(item.id))).not.toContain(ARTICLE_TEINTE);
  });
});

describe('section lights des manifestes', () => {
  it('valide front et rear, refuse le reste', () => {
    const ok: string[] = [];
    checkLights(undefined, ok);
    checkLights({ front: ['lamp'], rear: ['tail'] }, ok);
    checkLights({ front: ['Headlight'], rear: [] }, ok);
    expect(ok).toEqual([]);
    const bad: string[] = [];
    checkLights('lamp', bad);
    checkLights({ front: [], rear: ['tail'] }, bad);
    checkLights({ front: ['lamp'], rear: 'tail' }, bad);
    checkLights({ front: ['lamp', ''], rear: [] }, bad);
    checkLights({ front: ['lamp'], rear: [], rings: ['x'] }, bad);
    expect(bad).toHaveLength(5);
    expect(() => validateManifest({ ...JSON.parse(readFileSync(new URL('../../public/assets/vehicles/cox/vehicle.json', import.meta.url), 'utf8')), lights: { front: [] } }, 'cox')).toThrow(/lights\.front/);
  });

  it('reconnaît un matériau par son nom, suffixe d’exporteur et casse à part', () => {
    expect(lightNamed('lamp', ['lamp'])).toBe(true);
    expect(lightNamed('lamp.001', ['lamp'])).toBe(true);
    expect(lightNamed('lamp_2', ['lamp'])).toBe(true);
    expect(lightNamed('Headlight', ['headlight'])).toBe(true);
    expect(lightNamed('lampe', ['lamp'])).toBe(false);
    expect(lightNamed('tail', ['lamp'])).toBe(false);
    expect(lightsOf({})).toBe(DEFAULT_LIGHTS);
  });
});

describe('couleur de la lumière', () => {
  it('route : l’origine telle quelle ; une teinte franche relevée, sans éteindre la route ni dépasser le gain', () => {
    expect(routeLight(HEADLIGHT.color)).toEqual(linearOf(HEADLIGHT.color));
    const origine = luminance(linearOf(HEADLIGHT.color));
    for (const item of COULEURS_PHARES) {
      const rgb = routeLight(item.color);
      expect(luminance(rgb), item.id).toBeGreaterThanOrEqual(ROUTE_LIGHT.share * origine - 1e-9);
      const raw = linearOf(item.color);
      expect(rgb[2] / raw[2], item.id).toBeLessThanOrEqual(ROUTE_LIGHT.gain + 1e-9);
      // La teinte reste la sienne : mêmes rapports entre composantes.
      expect(rgb[0] * raw[2], item.id).toBeCloseTo(rgb[2] * raw[0], 9);
    }
  });

  it('faisceau : un facteur de 0 à 1 par composante, le plus fort à 1, la teinte gardée', () => {
    for (const item of COULEURS_PHARES) {
      const k = beamTint(item.color);
      expect(Math.max(...k)).toBeCloseTo(1, 9);
      for (const v of k) expect(v).toBeGreaterThanOrEqual(0);
    }
    const violet = beamTint('#a35cff');
    expect(violet[2]).toBe(1);
    expect(violet[1]).toBeLessThan(0.2);
  });
});

/** Un modèle d'essai : deux optiques qui partagent leur matériau, un feu arrière, une carrosserie. */
function essai() {
  const lamp = new MeshStandardMaterial({ name: 'lamp', color: '#ffffff', emissive: '#fff3e0', emissiveIntensity: 12 });
  const tail = new MeshStandardMaterial({ name: 'tail.001', color: '#3a0402', emissive: '#ff1206', emissiveIntensity: 10 });
  const body = new MeshStandardMaterial({ name: 'paint_carrosserie' });
  const box = new BoxGeometry(0.1, 0.1, 0.1);
  const root = new Group();
  const left = new Mesh(box, lamp);
  const right = new Mesh(box, lamp);
  const back = new Mesh(box, tail);
  const caisse = new Mesh(box, [body, tail]);
  root.add(left, right, back, caisse);
  return { root, lamp, tail, body, left, right, back, caisse };
}

const hex = (material: Material, key: 'color' | 'emissive') => `#${(material as MeshStandardMaterial)[key].getHexString()}`;

describe('réglages posés sur les optiques', () => {
  it('garage : des copies à nous (le cache reste intact), une par matériau, posées partout où il servait', () => {
    const m = essai();
    const rig = createLightsRig(m.root, DEFAULT_LIGHTS, { front: true, rear: true });
    expect(rig.front).toHaveLength(1);
    expect(rig.rear).toHaveLength(1);
    expect(rig.owned).toHaveLength(2);
    expect(m.left.material).not.toBe(m.lamp);
    expect(m.left.material).toBe(m.right.material);
    expect((m.caisse.material as Material[])[1]).toBe(m.back.material);
    expect((m.caisse.material as Material[])[0]).toBe(m.body);

    applyLights(rig, resolvePhares({ parts: { phares: 'violet', feux: 'fumes' }, tune: { phares_teinte: 1 } }));
    const front = m.left.material as MeshStandardMaterial;
    const back = m.back.material as MeshStandardMaterial;
    expect(hex(front, 'emissive')).toBe('#a35cff');
    expect(front.emissiveIntensity).toBeCloseTo(12 * 0.22 * TEINTE_OPTIQUES.emission, 9);
    expect(front.color.getHexString()).not.toBe('ffffff');
    expect(hex(back, 'color')).toBe('#120304');
    expect(hex(back, 'emissive')).toBe('#ff1206');
    expect(back.emissiveIntensity).toBeCloseTo(4.5, 9);
    // Le matériau du cache n'a pas bougé.
    expect(hex(m.lamp, 'emissive')).toBe('#fff3e0');
    expect(m.lamp.emissiveIntensity).toBe(12);
    expect(hex(m.tail, 'color')).toBe('#3a0402');

    // Retour à l'origine : exactement le réglage du modèle.
    applyLights(rig, resolvePhares(undefined));
    expect(hex(front, 'emissive')).toBe('#fff3e0');
    expect(hex(front, 'color')).toBe('#ffffff');
    expect(front.emissiveIntensity).toBe(12);
    expect(hex(back, 'color')).toBe('#3a0402');
    expect(back.emissiveIntensity).toBe(10);
    disposeLightsRig(rig);
  });

  it('un second passage (double montage) reprend les copies et repart de leur réglage d’origine', () => {
    const m = essai();
    const first = createLightsRig(m.root, DEFAULT_LIGHTS, { front: true, rear: true });
    applyLights(first, resolvePhares({ parts: { phares: 'vert' }, tune: { phares_teinte: 0.5 } }));
    const copy = m.left.material;
    const second = createLightsRig(m.root, DEFAULT_LIGHTS, { front: true, rear: true });
    expect(m.left.material).toBe(copy);
    expect(second.owned).toContain(copy);
    applyLights(second, resolvePhares(undefined));
    expect(hex(copy, 'emissive')).toBe('#fff3e0');
    expect((copy as MeshStandardMaterial).emissiveIntensity).toBe(12);
  });

  it('sortie : les feux déjà copiés sont réglés sur place ; seuls les noms du manifeste comptent', () => {
    const m = essai();
    const rig = createLightsRig(m.root, { front: ['lamp'], rear: [] }, { front: true, rear: false });
    expect(rig.rear).toHaveLength(0);
    expect(m.back.material).toBe(m.tail);
    const inPlace = createLightsRig(essai().root, DEFAULT_LIGHTS, { front: false, rear: false });
    expect(inPlace.owned).toHaveLength(0);
    expect(inPlace.front[0]?.material.name).toBe('lamp');
  });

  it('faisceau et éblouissement : mélange additif par facteur constant, blanc pour l’origine', () => {
    const beam = new ShaderMaterial();
    tintAdditive(beam, COULEURS_PHARES[0]!);
    expect(beam.blending).toBe(CustomBlending);
    expect(beam.blendColor.equals(new Color(1, 1, 1))).toBe(true);
    tintAdditive(beam, COULEURS_PHARES.find((item) => item.id === 'violet')!);
    expect(beam.blendColor.b).toBe(1);
    expect(beam.blendColor.g).toBeLessThan(0.2);
  });
});

// ---------------------------------------------------------------------------------------------
// Les cinq modèles du catalogue : ce que chacun permet réellement.

/** Un GLB du dépôt, sans ses textures (KTX2, illisibles hors navigateur). */
function glbSansTextures(path: URL): ArrayBuffer {
  const bytes = readFileSync(path);
  const length = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + length).toString('utf8')) as Record<string, unknown>;
  delete json.textures;
  delete json.images;
  delete json.samplers;
  json.extensionsRequired = ((json.extensionsRequired as string[] | undefined) ?? []).filter((e) => e !== 'KHR_texture_basisu');
  const strip = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    for (const key of Object.keys(value)) {
      if (key.endsWith('Texture')) delete (value as Record<string, unknown>)[key];
      else strip((value as Record<string, unknown>)[key]);
    }
  };
  strip(json.materials);
  let chunk = Buffer.from(JSON.stringify(json), 'utf8');
  chunk = Buffer.concat([chunk, Buffer.alloc((4 - (chunk.length % 4)) % 4, 0x20)]);
  const rest = bytes.subarray(20 + length);
  const out = Buffer.alloc(20 + chunk.length + rest.length);
  bytes.copy(out, 0, 0, 12);
  out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(chunk.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  chunk.copy(out, 20);
  rest.copy(out, 20 + chunk.length);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.length);
}

const VEHICLES_DIR = new URL('../../public/assets/vehicles/', import.meta.url);
const CATALOGUE = readdirSync(VEHICLES_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => validateManifest(JSON.parse(readFileSync(new URL(`${entry.name}/vehicle.json`, VEHICLES_DIR), 'utf8')), entry.name));

describe('les optiques des modèles du catalogue', () => {
  it('chaque manifeste déclare ses optiques', () => {
    expect(CATALOGUE.length).toBeGreaterThanOrEqual(5);
    for (const vehicle of CATALOGUE) expect(vehicle.lights, vehicle.id).toBeDefined();
  });

  for (const vehicle of CATALOGUE) {
    it(`${vehicle.id} : optiques avant et feux arrière trouvés, au garage et en sortie`, async () => {
      const source = (await new GLTFLoader().parseAsync(glbSansTextures(new URL(`${vehicle.id}/${vehicle.glb}`, VEHICLES_DIR)), '')).scene;
      const garage = prepare(source, vehicle);
      const rig = createLightsRig(garage.root, lightsOf(vehicle), { front: true, rear: true });
      expect(rig.front.length, 'optiques avant').toBeGreaterThan(0);
      expect(rig.rear.length, 'feux arrière').toBeGreaterThan(0);
      // Allumées au garage (comme avant) : la couleur choisie se voit dans leur lueur.
      for (const slot of rig.front) expect(slot.intensity).toBeGreaterThan(1);
      applyLights(rig, resolvePhares({ parts: { phares: 'glacier' } }));
      expect(hex(rig.front[0]!.material, 'emissive')).toBe('#8ccbff');
      disposeLightsRig(rig);

      // Sortie : les feux arrière sont ceux que le moteur allume au freinage (mêmes matériaux).
      const drive = prepareForDrive(source, vehicle);
      const driveRig = createLightsRig(drive.prepared.root, lightsOf(vehicle), { front: true, rear: false });
      expect(driveRig.rear.length).toBeGreaterThan(0);
      for (const slot of driveRig.rear) expect(drive.tails).toContain(slot.material);
      applyLights(driveRig, resolvePhares({ parts: { feux: 'fumes' } }));
      for (const slot of driveRig.rear) expect(slot.material.emissiveIntensity).toBeCloseTo(slot.intensity * 0.45, 9);
      disposeLightsRig(driveRig);
    }, 60_000);
  }
});
