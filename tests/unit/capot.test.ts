// Capot moteur (vague U, « capot ») : le poste du catalogue et ses articles, la section `pieces.capot`
// et le champ `engine.pose` d'un manifeste (validation), ce que le build pose sur le capot ; le modèle
// de la Cox (capot à part sur son pivot, variante vitrée, compartiment) et le moteur posé dedans sans
// traverser la caisse ; le compte du § 8 au pire cas ; les plages de dessin du capot dans les maillages
// fondus (même coût capot fermé) ; le moteur fondu en un seul maillage, traitements portés par les sommets.

import { beforeAll, describe, expect, it } from 'vitest';
import { BufferAttribute, BufferGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { articleParId } from '../../src/data/boutique.ts';
import { checkEnginePose, familleById, moteurPose, type MoteurFamille } from '../../src/data/moteurs.ts';
import { capotDuBuild, checkPieces, hasPieceFile, isFree, optionsFor, posteById, posteCapot, postesDuGroupe, zoneDuPoste } from '../../src/data/pieces.ts';
import { VEHICLES, vehicleById } from '../../src/data/vehicles.ts';
import type { Build, VehicleManifest } from '../../src/data/vehicleTypes.ts';
import { finirCapot, noterFusion, poserCapot, preparerCapot } from '../../src/scene/vehicle/capotRig.ts';
import { fondreMoteur } from '../../src/scene/vehicle/moteurFondu.ts';
import { buildVehicle, engineFit } from '../../tools/vehicles/build.mjs';
import * as compartiment from '../../tools/vehicles/compartiment.mjs';
import * as moteurs from '../../tools/vehicles/moteurs.mjs';

function car(id: string): VehicleManifest {
  const found = vehicleById(id);
  if (!found) throw new Error(`${id} absent du catalogue`);
  return found;
}

const problems = (pieces: unknown): string[] => {
  const out: string[] = [];
  checkPieces({ pieces }, out);
  return out;
};

const LID = { lid: 'capot_moteur', glazed: 'capot_moteur_vitre', bay: 'compartiment_moteur', axis: [0, 0, 1], angle: -90, pin: { at: [-1.6, 0.9, 0], normal: [-0.77, 0.64, 0] }, frame: { face: '+y', center: [-1.6, 0.6, 0], size: [0.6, 0.5, 0.8] } };

describe('capot : catalogue, boutique, manifestes', () => {
  it('le poste « Capot moteur » est dans le kit carrosserie : d’origine libre, vitré et sans capot sans fichier partagé ni couleur propre', () => {
    const poste = posteById('capot');
    expect(poste?.groupe).toBe('carrosserie');
    expect(postesDuGroupe('carrosserie').map((item) => item.id)).toContain('capot');
    expect(poste?.peinture).toBe(false);
    expect(poste?.none.id).toBe('origine');
    expect(poste?.options.map((option) => [option.id, option.style, option.mount, hasPieceFile(option)])).toEqual([
      ['vitre', 'vitre', 'capot', false],
      ['sans', 'depose', 'capot', false],
    ]);
  });

  it('vitré et sans capot sont des articles de 60 à 400 $ ; le capot d’origine est libre', () => {
    expect(articleParId('piece-capot-vitre')?.prix).toBe(240);
    expect(articleParId('piece-capot-sans')?.prix).toBe(140);
    for (const id of ['piece-capot-vitre', 'piece-capot-sans']) expect(articleParId(id)?.famille).toBe('piece');
    const cox = car('cox');
    expect(isFree(cox, 'capot', 'origine')).toBe(true);
    expect(isFree(cox, 'capot', 'vitre')).toBe(false);
    expect(optionsFor(cox, 'capot').map((option) => option.id)).toEqual(['vitre', 'sans']);
  });

  it('seule la Cox déclare un capot ; le van, le concept et les motos n’ont ni poste ni moteur posé', () => {
    const declared = VEHICLES.filter((vehicle) => posteCapot(vehicle) !== null).map((vehicle) => vehicle.id);
    expect(declared).toEqual(['cox']);
    expect(posteCapot(car('cox'))?.mount.lid).toBe('capot_moteur');
    expect(posteCapot(car('cox'))?.mount.carries).toEqual(['aileron']);
    for (const id of ['van', 'concept', 'bobber', 'sportive']) expect(moteurPose(car(id))).toBeNull();
    const posed = moteurPose(car('cox'));
    expect(posed?.famille.id).toBe('quatre-a-plat');
    expect(posed?.pose).toEqual({ position: [-1.6, -0.21, 0], yaw: 0, scale: 0.84 });
  });

  it('ce que le build pose sur le capot : l’origine, le vitré, la dépose ; une option inconnue retombe sur l’origine', () => {
    const cox = car('cox');
    const build = (capot?: string): Build => ({ paints: {}, parts: capot ? { capot } : {} });
    expect(capotDuBuild(cox, undefined)).toBeNull();
    expect(capotDuBuild(cox, build())).toBeNull();
    expect(capotDuBuild(cox, build('vitre'))).toBe('vitre');
    expect(capotDuBuild(cox, build('sans'))).toBe('depose');
    expect(capotDuBuild(cox, build('pas-un-capot'))).toBeNull();
    expect(capotDuBuild(car('van'), build('vitre'))).toBeNull();
  });

  it('valide la section pieces.capot : nœuds, axe, angle, pastille, cadre, postes portés', () => {
    expect(problems({ capot: LID })).toEqual([]);
    expect(problems({ capot: { ...LID, lid: 'Capot Moteur' } }).join()).toContain('pieces.capot.lid');
    expect(problems({ capot: { ...LID, glazed: 'capot_moteur' } }).join()).toContain('pieces.capot.glazed');
    expect(problems({ capot: { ...LID, axis: [0, 0, 3] } }).join()).toContain('pieces.capot.axis');
    expect(problems({ capot: { ...LID, angle: 170 } }).join()).toContain('pieces.capot.angle');
    expect(problems({ capot: { ...LID, pin: [-1.6, 0.9, 0] } }).join()).toContain('pieces.capot.pin');
    expect(problems({ capot: { ...LID, frame: { ...LID.frame, face: 'dessus' } } }).join()).toContain('pieces.capot.frame');
    expect(problems({ capot: { ...LID, carries: ['capot'] } }).join()).toContain('pieces.capot.carries');
    expect(problems({ capot: { ...LID, rail: [] } }).join()).toContain('pieces.capot.rail');
    // Le cadre du poste est celui du manifeste (la caméra du garage cadre le compartiment).
    expect(zoneDuPoste(car('cox').pieces!.capot!, posteById('capot')!)?.face).toBe('+y');
  });

  it('valide engine.pose : un modèle à poser, trois nombres, un demi-tour en degrés, une échelle bornée', () => {
    const check = (pose: unknown, model: string | null = 'quatre-a-plat') => {
      const out: string[] = [];
      checkEnginePose(pose, model ?? undefined, out);
      return out;
    };
    expect(check(undefined)).toEqual([]);
    expect(check({ position: [-1.6, -0.2, 0], yaw: 180, scale: 0.8 })).toEqual([]);
    expect(check({ position: [-1.6, -0.2, 0] }, null).join()).toContain('engine.model');
    expect(check({ position: [-1.6, -0.2] }).join()).toContain('engine.pose.position');
    expect(check({ position: [-1.6, -0.2, 0], scale: 2 }).join()).toContain('engine.pose.scale');
    expect(check({ position: [-1.6, -0.2, 0], roll: 3 }).join()).toContain('engine.pose.roll');
  });
});

describe('capot : le modèle de la Cox et le moteur posé', () => {
  let bytes: Uint8Array;
  let engine: Uint8Array;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON glTF lu tel quel
  let nodes: any[];

  beforeAll(async () => {
    bytes = (await buildVehicle('cox')).bytes;
    const famille = moteurs.readCatalogue().familles.find((item) => item.id === 'quatre-a-plat');
    if (!famille) throw new Error('famille quatre-a-plat absente');
    engine = moteurs.engineModel(famille).toGlb().bytes;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    nodes = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + view.getUint32(12, true)))).nodes;
  }, 60_000);

  it('le capot est un nœud à part, pivot sur sa charnière ; sa variante vitrée a le même pivot ; le compartiment est à part', () => {
    const lid = nodes.find((node) => node.name === 'capot_moteur');
    const glazed = nodes.find((node) => node.name === 'capot_moteur_vitre');
    expect(lid?.mesh).toBeDefined();
    expect(lid.translation[0]).toBeCloseTo(-1.57, 2);
    expect(lid.translation[1]).toBeGreaterThan(0.95);
    expect(glazed.translation).toEqual(lid.translation);
    expect(nodes.some((node) => node.name === 'compartiment_moteur' && node.mesh !== undefined)).toBe(true);
    const costs = compartiment.nodeCosts(bytes);
    // Le capot d'origine : tôle, fentes et plaque (noir), plaque (alu), éclaireur (chrome).
    expect(costs.get('capot_moteur')?.primitives).toBe(4);
    expect(costs.get('capot_moteur_vitre')?.primitives).toBe(5);
  });

  it('le moteur posé tient dans la caisse, capot fermé : aucun sommet ne la traverse, garde au sol tenue', () => {
    const manifest = car('cox');
    const shell = compartiment.nodeTriangles(bytes, (name) => name === 'carrosserie' || name === 'capot_moteur');
    const fit = compartiment.checkEngineFit(shell, compartiment.engineVertices(engine), manifest.engine!.pose!, compartiment.poseOffset(bytes));
    expect(fit.tested).toBeGreaterThan(5000);
    expect(fit.worst).toBeLessThanOrEqual(0.006);
    expect(fit.above).toBeGreaterThan(0.01);
    expect(fit.ground).toBeGreaterThan(0.1);
    // Le même contrôle que l'outil (npm run vehicles:build), sur le fichier du moteur construit.
    expect(engineFit(manifest, bytes)?.ok ?? true).toBe(true);
  }, 60_000);

  it('au pire cas, le capot vitré : sa variante, le compartiment et le moteur (un appel de dessin) à la place du capot', () => {
    const worst = compartiment.capotWorst(car('cox'), bytes, compartiment.engineInVehicle(engine));
    expect(worst?.state).toBe('vitré');
    const costs = compartiment.nodeCosts(bytes);
    // Écart sur la caisse comptée entière (variante et compartiment compris) : −capot + moteur.
    expect(worst?.drawCalls).toBe(-(costs.get('capot_moteur')?.primitives ?? 0) + 1);
    expect(compartiment.capotWorst(car('van'), bytes, null)).toBeNull();
  });
});

describe('capot : plages de dessin dans les maillages fondus', () => {
  /** Une scène : la caisse (noir), le capot (tôle, fentes noires) sur son pivot, sa variante, le compartiment (noir). */
  function scene() {
    const black = new MeshStandardMaterial({ name: 'black' });
    const paint = new MeshStandardMaterial({ name: 'paint_capot_moteur' });
    const tri = () => {
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(new Float32Array(9), 3));
      g.setIndex([0, 1, 2]);
      return g;
    };
    const root = new Group();
    const body = new Mesh(tri(), black);
    const lid = new Group();
    lid.name = 'capot_moteur';
    lid.position.set(-1.57, 1, 0);
    const skin = new Mesh(tri(), paint);
    const vents = new Mesh(tri(), black);
    lid.add(skin, vents);
    const glazed = new Group();
    glazed.name = 'capot_moteur_vitre';
    glazed.add(new Mesh(tri(), paint));
    const bay = new Mesh(tri(), black);
    bay.name = 'compartiment_moteur';
    root.add(body, lid, glazed, bay);
    root.updateMatrixWorld(true);
    return { root, body, lid, skin, vents, glazed, bay, black };
  }

  it('capot fermé : le compartiment hors plage, le capot fondu dessiné ; ouvert : l’inverse, sa copie tourne ; vitré, déposé', () => {
    const s = scene();
    const meshes = [s.body, s.skin, s.vents, s.bay, ...s.glazed.children] as Mesh[];
    const apart = new Set<Mesh>();
    const rig = preparerCapot(s.root, car('cox'), meshes, apart, []);
    expect(rig).not.toBeNull();
    if (!rig) return;
    // Compartiment en tête, capot en queue ; la variante vitrée reste à part, cachée.
    expect(meshes.slice(0, 2)).toEqual([s.bay, s.body]);
    expect(meshes.indexOf(s.vents)).toBeGreaterThan(meshes.indexOf(s.body));
    expect(apart.has(s.glazed.children[0] as Mesh)).toBe(true);
    expect(s.glazed.visible).toBe(false);
    // Fusion du noir : compartiment, caisse, fentes (trois indices chacun).
    const fused = new Mesh(new BufferGeometry(), s.black);
    fused.geometry.setIndex(new Array(9).fill(0));
    noterFusion(rig, fused, [s.bay, s.body, s.vents], [3, 3, 3]);
    s.bay.removeFromParent();
    s.body.removeFromParent();
    s.vents.removeFromParent();
    finirCapot(rig);
    expect(rig.paint?.name).toBe('paint_capot_moteur');
    expect(fused.geometry.drawRange).toEqual({ start: 3, count: 6 });
    expect(rig.clones).toHaveLength(1);
    expect(rig.clones[0]?.visible).toBe(false);
    // Ouvert : le compartiment entre, le capot fondu sort, sa copie se montre et tourne avec son nœud.
    poserCapot(rig, { style: null, angle: -Math.PI / 2, ouvert: true });
    expect(fused.geometry.drawRange).toEqual({ start: 0, count: 6 });
    expect(rig.clones[0]?.visible).toBe(true);
    expect(s.lid.quaternion.z).toBeCloseTo(-Math.SQRT1_2, 5);
    expect(rig.paint?.side).toBe(2);
    // Vitré : le capot caché, sa variante montrée ; déposé : ni l'un ni l'autre.
    poserCapot(rig, { style: 'vitre', angle: 0, ouvert: false });
    expect([s.lid.visible, s.glazed.visible]).toEqual([false, true]);
    poserCapot(rig, { style: 'depose', angle: 0, ouvert: false });
    expect([s.lid.visible, s.glazed.visible]).toEqual([false, false]);
    expect(fused.geometry.drawRange).toEqual({ start: 0, count: 6 });
    // Retour à l'origine fermée : mêmes plages qu'au départ, tôle à une face.
    poserCapot(rig, { style: null, angle: 0, ouvert: false });
    expect(fused.geometry.drawRange).toEqual({ start: 3, count: 6 });
    expect(rig.paint?.side).toBe(0);
  });
});

describe('capot : le moteur fondu', () => {
  let gltf: GLTF;
  let famille: MoteurFamille;

  beforeAll(async () => {
    const found = familleById('quatre-a-plat');
    if (!found) throw new Error('famille absente');
    famille = found;
    const raw = moteurs.readCatalogue().familles.find((item) => item.id === 'quatre-a-plat');
    if (!raw) throw new Error('famille absente de l’outil');
    const { bytes } = moteurs.engineModel(raw).toGlb();
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    gltf = await new GLTFLoader().parseAsync(buffer, '');
  }, 60_000);

  it('un seul maillage, sans le support ni les filtres non posés ; le chrome se lit sur les sommets des cache-culbuteurs', () => {
    const plain = fondreMoteur(gltf, famille, undefined, 1);
    const chrome = fondreMoteur(gltf, famille, { paints: {}, partPaints: { moteur_cache_culbuteurs: { finish: 'chrome' } } }, 1);
    for (const name of ['position', 'normal', 'color', 'pmbMat', 'pmbEnv']) expect(plain.getAttribute(name), name).toBeDefined();
    expect(chrome.getAttribute('position').count).toBe(plain.getAttribute('position').count);
    // Le support est écarté : la boîte du moteur fondu commence au-dessus de lui.
    plain.computeBoundingBox();
    expect(plain.boundingBox!.min.y).toBeGreaterThan(0.4);
    const metals = (g: BufferGeometry) => {
      const m = g.getAttribute('pmbMat');
      let full = 0;
      for (let i = 0; i < m.count; i += 1) if (m.getX(i) === 1) full += 1;
      return full;
    };
    expect(metals(chrome)).toBeGreaterThan(metals(plain));
    // Un autre filtre posé : d'autres sommets.
    const cornets = fondreMoteur(gltf, famille, { paints: {}, parts: { moteur_filtres: 'cornets' } }, 1);
    expect(cornets.getAttribute('position').count).not.toBe(plain.getAttribute('position').count);
  });
});
