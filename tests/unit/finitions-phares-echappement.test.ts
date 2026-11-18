// Vague U, lot « finitions » : cadrage des phares au garage (src/data/framings.ts, cadreBout), pluie
// teintée par l'éclairage (rainTint, src/drive/scene/ciel.ts), voyants de l'habitacle hors des réglages
// des phares (section `lights.interior`, separerVoyants), flammes lisibles (forme en données, mélange
// prémultiplié), retour de flammes au garage (crache), règle commune d'une option posée sans être acquise.

import { readdirSync, readFileSync } from 'node:fs';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, OneFactor, OneMinusSrcAlphaFactor, type Material } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { FLAMMES_LIMITES, LIGNES_ECHAPPEMENT, type RetourFlammes } from '../../src/data/echappement.ts';
import { CADRE_BOUT_LIMITS, CADRES_BOUT, cadreBout, zoneFramingFor } from '../../src/data/framings.ts';
import { checkLights, DEFAULT_LIGHTS, interiorLightNodes, lightsOf, linearOf, rainTint, RAIN_TINT, resolvePhares } from '../../src/data/phares.ts';
import { validateManifest } from '../../src/data/vehicles.ts';
import type { VehicleManifest } from '../../src/data/vehicleTypes.ts';
import { createRain } from '../../src/drive/scene/ciel.ts';
import { createNightUniforms, HEADLIGHT } from '../../src/drive/scene/materiaux.ts';
import { creerFlammes } from '../../src/scene/vehicle/flammes.ts';
import { applyLights, createLightsRig, disposeLightsRig, isVoyant, separerVoyants } from '../../src/scene/vehicle/phares.ts';
import { crache } from '../../src/ui/echappement/flammesGarage.ts';

// Modules .tsx : import dynamique, la part utile de leur interface écrite ici (comme tests/unit/phares.test.ts).
interface VehicleModelModule {
  prepare: (source: Group, vehicle: VehicleManifest) => { root: Group };
}
interface DriveModule {
  prepareForDrive: (source: Group, vehicle: VehicleManifest) => { prepared: { root: Group }; tails: MeshStandardMaterial[] };
}
interface NonAcquisModule {
  phraseNonAcquise: (label: string, prix: number | null | undefined) => string;
  nomNonAcquis: (label: string, prix: number | null | undefined) => string;
}
const { prepare } = (await import(/* @vite-ignore */ '../../src/scene/vehicle/VehicleModel.tsx')) as VehicleModelModule;
const { prepareForDrive } = (await import(/* @vite-ignore */ '../../src/drive/scene/vehicule.tsx')) as DriveModule;
const { phraseNonAcquise, nomNonAcquis } = (await import(/* @vite-ignore */ '../../src/ui/nonAcquis.tsx')) as NonAcquisModule;

const luminance = ([r, g, b]: [number, number, number]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const hex = (material: Material, key: 'color' | 'emissive') => `#${(material as MeshStandardMaterial)[key].getHexString()}`;

describe('cadrage des phares au garage', () => {
  const gabarit = { halfLength: 2, halfWidth: 0.9, height: 1.4 };

  it('l’avant pour la lumière et les optiques, l’arrière pour les feux, de face, tout le véhicule en largeur et en hauteur', () => {
    const avant = cadreBout('avant', gabarit);
    expect(avant.face).toBe('+x');
    expect(avant.center[0]).toBeGreaterThan(gabarit.halfLength * 0.5);
    expect(avant.center[0]).toBeLessThanOrEqual(gabarit.halfLength);
    expect(avant.center[1]).toBeCloseTo(gabarit.height / 2, 9);
    expect(avant.center[2]).toBe(0);
    expect(avant.size[0]).toBeCloseTo(2 * gabarit.halfWidth, 9);
    expect(avant.size[1]).toBeCloseTo(gabarit.height, 9);
    const arriere = cadreBout('arriere', gabarit);
    expect(arriere.face).toBe('-x');
    expect(arriere.center[0]).toBeCloseTo(-avant.center[0], 9);
    // Le cadrage de pose d'une face avant ou arrière : de face, un peu en plongée.
    expect(zoneFramingFor(avant.face).id).toBe('face');
    expect(zoneFramingFor(arriere.face).id).toBe('face');
  });

  it('les cadres restent dans leurs bornes', () => {
    for (const cadre of Object.values(CADRES_BOUT)) {
      expect(cadre.recul).toBeGreaterThanOrEqual(CADRE_BOUT_LIMITS.recul.min);
      expect(cadre.recul).toBeLessThanOrEqual(CADRE_BOUT_LIMITS.recul.max);
      for (const part of [cadre.largeur, cadre.hauteur]) {
        expect(part).toBeGreaterThanOrEqual(CADRE_BOUT_LIMITS.part.min);
        expect(part).toBeLessThanOrEqual(CADRE_BOUT_LIMITS.part.max);
      }
    }
  });
});

describe('pluie éclairée par les phares', () => {
  it('l’origine ne change rien ; une teinte franche colore sans éteindre', () => {
    const origine = rainTint(linearOf(HEADLIGHT.color));
    for (const value of origine) expect(value).toBeCloseTo(1, 5);
    const violet = rainTint(linearOf('#a35cff'));
    expect(Math.max(...violet)).toBe(violet[2]);
    expect(violet[1]).toBeLessThan(violet[2] * 0.3);
    // Relevée vers RAIN_TINT.share de la luminance du blanc, jusqu'à RAIN_TINT.gain.
    expect(luminance(violet)).toBeGreaterThan(RAIN_TINT.share * 0.9);
    const jaune = rainTint(linearOf('#ffc43a'));
    expect(jaune[2]).toBeLessThan(jaune[0] * 0.5);
  });

  it('la nuée lit la couleur de la route (même uniforme, rien à recopier par image)', () => {
    const uniforms = createNightUniforms();
    const rain = createRain(8, uniforms);
    expect(rain.material.uniforms.pmbHeadColor).toBe(uniforms.pmbHeadColor);
    expect(rain.material.vertexShader).toContain('pmbHeadColor');
    expect(rain.material.fragmentShader).toContain('vTint');
    rain.geometry.dispose();
    rain.material.dispose();
  });
});

describe('voyants de l’habitacle hors des réglages des phares', () => {
  it('section lights : interior, une liste de nœuds, est acceptée ; le reste refusé', () => {
    const problems: string[] = [];
    checkLights({ front: ['lamp'], rear: ['tail'], interior: ['habitacle'] }, problems);
    expect(problems).toEqual([]);
    checkLights({ front: ['lamp'], rear: ['tail'], interior: 'habitacle' }, problems);
    checkLights({ front: ['lamp'], rear: ['tail'], interior: [''] }, problems);
    expect(problems).toHaveLength(2);
    expect(interiorLightNodes({ lights: undefined })).toEqual([]);
  });

  it('une copie marquée pour les pièces de l’habitacle ; les feux fumés ne la touchent pas', () => {
    const tail = new MeshStandardMaterial({ name: 'tail', color: '#3a0402', emissive: '#ff1206', emissiveIntensity: 10 });
    const box = new BoxGeometry(0.1, 0.1, 0.1);
    const scene = new Group();
    const habitacle = new Group();
    habitacle.name = 'habitacle';
    const voyant = new Mesh(box, tail);
    habitacle.add(voyant);
    const feu = new Mesh(box, tail);
    scene.add(habitacle, feu);
    const owned: Material[] = [];
    expect(separerVoyants(scene, { lights: { ...DEFAULT_LIGHTS, interior: ['habitacle'] } }, owned)).toBe(1);
    expect(owned).toHaveLength(1);
    expect(voyant.material).not.toBe(tail);
    expect(isVoyant(voyant.material as Material)).toBe(true);
    expect((voyant.material as Material).name).toBe('tail');
    expect(feu.material).toBe(tail);
    const rig = createLightsRig(scene, DEFAULT_LIGHTS, { front: true, rear: true });
    expect(rig.rear).toHaveLength(1);
    applyLights(rig, resolvePhares({ parts: { feux: 'fumes' } }));
    expect(hex(feu.material as Material, 'color')).toBe('#120304');
    expect(hex(voyant.material as Material, 'color')).toBe('#3a0402');
    expect((voyant.material as MeshStandardMaterial).emissiveIntensity).toBe(10);
    disposeLightsRig(rig);
  });
});

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

describe('voyants des modèles du catalogue', () => {
  const avecHabitacle = CATALOGUE.filter((vehicle) => interiorLightNodes(vehicle).length > 0);

  it('les modèles dont la planche de bord porte la matière des feux la déclarent (au moins deux)', () => {
    expect(avecHabitacle.length).toBeGreaterThanOrEqual(2);
  });

  for (const vehicle of avecHabitacle) {
    it(`${vehicle.id} : feux fumés au garage et en sortie, la planche de bord garde son rouge`, async () => {
      const source = (await new GLTFLoader().parseAsync(glbSansTextures(new URL(`${vehicle.id}/${vehicle.glb}`, VEHICLES_DIR)), '')).scene;
      const garage = prepare(source, vehicle);
      const voyants = new Set<MeshStandardMaterial>();
      garage.root.traverse((object) => {
        if (object instanceof Mesh && object.material instanceof MeshStandardMaterial && isVoyant(object.material)) voyants.add(object.material);
      });
      expect(voyants.size, 'voyants séparés').toBeGreaterThan(0);
      const rig = createLightsRig(garage.root, lightsOf(vehicle), { front: true, rear: true });
      expect(rig.rear.length, 'feux arrière').toBeGreaterThan(0);
      for (const slot of [...rig.front, ...rig.rear]) expect(isVoyant(slot.material)).toBe(false);
      applyLights(rig, resolvePhares({ parts: { feux: 'fumes', phares: 'violet' } }));
      for (const voyant of voyants) {
        expect(hex(voyant, 'color')).not.toBe('#120304');
        expect(voyant.emissive.r).toBeGreaterThan(0.3);
      }
      disposeLightsRig(rig);

      // Sortie : les voyants ne sont pas des feux (ni freinage, ni lueur de repos des feux).
      const drive = prepareForDrive(source, vehicle);
      expect(drive.tails.length).toBeGreaterThan(0);
      for (const tail of drive.tails) expect(isVoyant(tail)).toBe(false);
    }, 60_000);
  }
});

describe('retour de flammes', () => {
  const avecFlammes = LIGNES_ECHAPPEMENT.filter((ligne) => ligne.flammes);

  it('forme et éclat en données, dans leurs bornes (lisible, sans exagération)', () => {
    expect(avecFlammes.length).toBeGreaterThan(0);
    for (const ligne of avecFlammes) {
      const regle = ligne.flammes as RetourFlammes;
      for (const [cle, borne] of Object.entries(FLAMMES_LIMITES)) {
        const value = regle[cle as keyof typeof FLAMMES_LIMITES];
        expect(value, `${ligne.id}.${cle}`).toBeGreaterThanOrEqual(borne.min);
        expect(value, `${ligne.id}.${cle}`).toBeLessThanOrEqual(borne.max);
      }
      // Vue dans l'axe, la gerbe n'est pas plus large qu'un demi-mètre.
      expect(2 * regle.disque * regle.longueur).toBeLessThanOrEqual(0.5);
    }
  });

  it('mélange prémultiplié : la flamme ajoute sa lumière et voile le fond, réglée par la ligne', () => {
    const rig = creerFlammes([{ position: [-1.9, 0.2, 0.27], direction: [-1, 0, 0], radius: 0.016 }]);
    const material = rig.mesh.material;
    expect(material.blendSrc).toBe(OneFactor);
    expect(material.blendDst).toBe(OneMinusSrcAlphaFactor);
    const regle = avecFlammes[0]!.flammes!;
    rig.regler(regle);
    expect(material.uniforms.uDisque!.value).toBe(regle.disque);
    expect(material.uniforms.uVoile!.value).toBe(regle.voile);
    rig.poser(0, 1);
    expect(rig.mesh.visible).toBe(false);
    rig.poser(0.5, 1);
    expect(rig.mesh.visible).toBe(true);
    rig.dispose();
  });

  it('au garage : un coup de gaz tenu puis lâché fait cracher la ligne qui le permet, pas plus vite que son attente', () => {
    const regle = avecFlammes[0]!.flammes!;
    expect(crache(regle, 2, regle.tenueGarage + 0.1, Infinity)).toBe(true);
    expect(crache(regle, 2, regle.tenueGarage - 0.1, Infinity)).toBe(false);
    expect(crache(regle, 0, 3, Infinity)).toBe(false);
    expect(crache(undefined, 2, 3, Infinity)).toBe(false);
    expect(crache(regle, 2, 3, regle.attente - 0.1)).toBe(false);
    expect(crache(regle, 2, 3, regle.attente)).toBe(true);
  });
});

describe('option posée sans être acquise', () => {
  it('une seule phrase, sans accord, avec le prix pour y revenir', () => {
    const phrase = phraseNonAcquise('Fumés', 100);
    expect(phrase).toContain('« Fumés »');
    expect(phrase).toContain('reste en place sans achat');
    expect(phrase).toMatch(/100\u00a0\$/);
    expect(nomNonAcquis('Violet', 160)).toMatch(/^Violet, en place sans achat, à débloquer pour 160\u00a0\$$/);
  });
});
