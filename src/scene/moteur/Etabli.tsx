// L'établi moteur dans la scène du garage (src/scene/GarageCanvas.tsx) : le moteur de la famille du
// véhicule (src/data/moteurs.ts), sorti et posé sur son support tournant, à la place du véhicule (une
// coupe franche : la scène cache le véhicule et cadre l'établi). Chaque pièce reçoit son traitement
// (brut, peinture, chrome, poli, brossé, anodisé, noir satiné) dans des matériaux à elle ; la pièce
// choisie dans le panneau est surlignée d'une lueur ambrée légère ; la vue éclatée écarte chaque nœud
// le long de son vecteur (catalogue) ; un échange (filtres à air) montre l'option posée. Ombre de
// contact au pied du support, comme sous le véhicule. Le fichier ne se charge qu'à l'ouverture de
// l'entrée. Aucun identifiant de véhicule ni de famille ici.

import { useFrame, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Color, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, type Group, type Material, type Object3D } from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MATERIAL_ROLES, type MaterialRole } from '../../data/materialRoles.ts';
import {
  ENGINES_DIR,
  fichierMoteur,
  matiereById,
  noeudsFamille,
  PART_PREFIX,
  resolveEchange,
  resolveTraitement,
  signatureEtabli,
  SUPPORT_NODE,
  type MoteurFamille,
  type MoteurMatiere,
  type TraitementResolu,
} from '../../data/moteurs.ts';
import { resolveVehicle } from '../../data/vehicles.ts';
import type { Build } from '../../data/vehicleTypes.ts';
import { useRenderStats } from '../../render/renderStats.ts';
import { shadowSize, VehicleShadowRig } from '../../render/vehicleShadow.ts';
import { useBuilds } from '../../state/builds.ts';
import { useEtabli } from './etabli.ts';

const BASE = import.meta.env.BASE_URL;
const loader = new GLTFLoader();
const sources = new Map<string, Promise<GLTF>>();

/** Rang de dessin des pièces opaques, comme celles du véhicule (VehicleModel.tsx). */
const RENDER_ORDER = -2;
/** Lueur de la pièce choisie : l'ambre de l'interface, à peine posée (sous le seuil du halo). */
const HIGHLIGHT = new Color('#ffb224');
const HIGHLIGHT_INTENSITY = 0.12;
const NO_GLOW = new Color(0, 0, 0);
/** Attente après le dernier changement (curseur, échange) avant de refaire l'ombre de contact. */
const SHADOW_DELAY_MS = 150;

/** Charge (une fois par séance) le moteur d'une famille. Un échec s'oublie : le prochain appel réessaie. */
export function loadEngine(famille: string): Promise<GLTF> {
  const url = `${BASE}${ENGINES_DIR}${fichierMoteur(famille)}`;
  let promise = sources.get(url);
  if (!promise) {
    promise = loader.loadAsync(url);
    promise.catch(() => sources.delete(url));
    sources.set(url, promise);
  }
  return promise;
}

/** Pose ou retire un attribut `data-*` de la scène sans toucher au DOM si rien ne change. */
function putData(element: HTMLElement | null, key: string, value: string | null): void {
  if (!element) return;
  if (value === null) {
    if (element.dataset[key] !== undefined) delete element.dataset[key];
  } else if (element.dataset[key] !== value) element.dataset[key] = value;
}

/** Nom d'origine du nœud du GLB qui porte cet objet (GLTFLoader le garde dans userData.name). */
function nodeOf(object: Object3D): string | null {
  for (let node: Object3D | null = object; node; node = node.parent) {
    const name = node.userData.name as unknown;
    if (typeof name === 'string' && (name.startsWith(PART_PREFIX) || name === SUPPORT_NODE)) return name;
  }
  return null;
}

/** Un morceau du moteur : le nœud qui le porte (sans part_ ; `null` : le support), sa matière ou son rôle, son matériau à lui. */
interface Morceau {
  node: string | null;
  matiere: MoteurMatiere | null;
  role: MaterialRole | null;
  material: MeshStandardMaterial;
}

interface Prepared {
  root: Group;
  /** Nœuds de pièce (sans le préfixe part_), pour l'éclatement et l'option posée. */
  nodes: Map<string, Object3D>;
  morceaux: Morceau[];
}

/** Copie de la scène chargée, un matériau par maillage (la géométrie reste partagée avec le cache). */
function prepare(gltf: GLTF): Prepared {
  const root = gltf.scene.clone(true) as Group;
  root.userData.hideInProbe = true;
  const nodes = new Map<string, Object3D>();
  const morceaux: Morceau[] = [];
  root.traverse((object) => {
    const name = object.userData.name as unknown;
    if (typeof name === 'string' && name.startsWith(PART_PREFIX)) nodes.set(name.slice(PART_PREFIX.length), object);
    if (!(object instanceof Mesh)) return;
    const node = nodeOf(object);
    const materialName = (object.material as Material).name;
    const matiere = materialName.startsWith('paint_') ? (matiereById(materialName) ?? null) : null;
    const role = matiere ? null : (MATERIAL_ROLES.find((item) => item.id === materialName) ?? MATERIAL_ROLES.find((item) => item.id === 'black') ?? null);
    const material = matiere?.traitable ? new MeshPhysicalMaterial() : new MeshStandardMaterial();
    material.name = materialName;
    object.material = material;
    object.renderOrder = RENDER_ORDER;
    morceaux.push({ node: node && node !== SUPPORT_NODE ? node.slice(PART_PREFIX.length) : null, matiere, role, material });
  });
  return { root, nodes, morceaux };
}

/** Le GLB de la famille, chargé hors de Suspense ; `null` tant qu'il n'est pas arrivé. */
function useEngineGltf(famille: MoteurFamille): GLTF | null {
  const [loaded, setLoaded] = useState<{ id: string; gltf: GLTF } | null>(null);
  useEffect(() => {
    let live = true;
    loadEngine(famille.id).then(
      (gltf) => {
        if (live) setLoaded({ id: famille.id, gltf });
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [famille.id]);
  return loaded?.id === famille.id ? loaded.gltf : null;
}

/** Règle un matériau : couleur, métal, rugosité, vernis (matériau physique seulement), reflet. */
function setLook(material: MeshStandardMaterial, look: { color: string; metalness: number; roughness: number; clearcoat?: number; clearcoatRoughness?: number; envMapIntensity: number }, bodyEnv: number): void {
  material.color.set(look.color);
  material.metalness = look.metalness;
  material.roughness = look.roughness;
  // Les métaux prennent la part de reflet de l'ambiance, comme la carrosserie (src/data/materialRoles.ts).
  material.envMapIntensity = look.envMapIntensity * (look.metalness >= 0.5 ? bodyEnv : 1);
  if (material instanceof MeshPhysicalMaterial) {
    material.clearcoat = look.clearcoat ?? 0;
    material.clearcoatRoughness = look.clearcoatRoughness ?? 0;
  }
}

type Noeuds = ReturnType<typeof noeudsFamille>;

/** Repeint chaque morceau : le traitement de sa pièce (ou sa matière, son rôle), la lueur de la pièce choisie. */
function paint(prepared: Prepared, famille: MoteurFamille, known: Noeuds, build: Build | undefined, selected: string | null, bodyEnv: number): void {
  const looks = new Map<string, TraitementResolu>(famille.pieces.map((piece) => [piece.id, resolveTraitement(piece, build)]));
  for (const { node, matiere, role, material } of prepared.morceaux) {
    const piece = node ? (known.get(node)?.piece ?? null) : null;
    const resolved = piece ? looks.get(piece) : undefined;
    const rendu = matiere?.traitable ? resolved?.traitement.rendu : null;
    if (rendu) setLook(material, { ...rendu, color: resolved?.couleur ?? rendu.color }, bodyEnv);
    else if (matiere) setLook(material, { color: matiere.color, metalness: matiere.metalness, roughness: matiere.roughness, envMapIntensity: 1 }, bodyEnv);
    else if (role) setLook(material, role, bodyEnv);
    const glow = piece !== null && piece === selected;
    material.emissive.copy(glow ? HIGHLIGHT : NO_GLOW);
    material.emissiveIntensity = glow ? HIGHLIGHT_INTENSITY : 0;
  }
}

/** Pose chaque nœud à son écart de vue éclatée ; seule l'option posée de chaque échange se montre. */
function pose(prepared: Prepared, famille: MoteurFamille, known: Noeuds, build: Build | undefined, eclate: number): void {
  const shown = new Map(famille.pieces.filter((piece) => piece.echange).map((piece) => [piece.id, resolveEchange(piece, build)?.id ?? null]));
  for (const [node, object] of prepared.nodes) {
    const info = known.get(node);
    if (!info) continue;
    object.position.set(info.eclate[0] * eclate, info.eclate[1] * eclate, info.eclate[2] * eclate);
    object.visible = info.option === null || shown.get(info.piece) === info.option;
  }
  prepared.root.updateMatrixWorld(true);
}

/**
 * Ombre de contact au pied du support (src/render/vehicleShadow.ts, comme sous le véhicule) : rendue
 * une fois à la pose, puis à chaque `stamp` ; remontée à chaque contexte WebGL rendu (clé d'époque).
 */
function EtabliOmbre({ caster, cadre, stamp }: { caster: Object3D; cadre: MoteurFamille['cadre']; stamp: number }) {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const invalidate = useThree((state) => state.invalidate);
  const rig = useMemo(() => new VehicleShadowRig(shadowSize(cadre)), [cadre]);
  useEffect(() => () => rig.dispose(), [rig]);
  const pending = useRef(true);
  useLayoutEffect(() => {
    pending.current = true;
    rig.compile(gl);
    invalidate();
  }, [gl, rig, caster, stamp, invalidate]);
  useFrame(() => {
    if (!pending.current) return;
    pending.current = false;
    rig.render(gl, caster, scene);
  });
  return <primitive object={rig.root} />;
}

export interface EtabliProps {
  famille: MoteurFamille;
  /** Part du reflet de l'environnement propre aux métaux, selon l'ambiance. */
  bodyEnv: number;
  /** Élément de la scène : on y pose la famille posée et l'écart de la vue éclatée (parcours, diagnostic). */
  stage: RefObject<HTMLDivElement | null>;
}

export function Etabli({ famille, bodyEnv, stage }: EtabliProps) {
  const invalidate = useThree((state) => state.invalidate);
  const gltf = useEngineGltf(famille);
  const prepared = useMemo(() => (gltf ? prepare(gltf) : null), [gltf]);
  useEffect(
    () => () => {
      for (const morceau of prepared?.morceaux ?? []) morceau.material.dispose();
    },
    [prepared],
  );
  const vehicleId = resolveVehicle(useBuilds((state) => state.current)).id;
  const signature = useBuilds((state) => signatureEtabli(famille, state.builds[vehicleId]));
  const eclate = useEtabli((state) => state.eclate);
  // La pièce touchée dans la liste s'allume ; à l'ouverture, rien n'est encore touché : rien ne s'allume.
  const wanted = useEtabli((state) => state.piece);
  const selected = famille.pieces.some((piece) => piece.id === wanted) ? wanted : null;
  const known = useMemo(() => noeudsFamille(famille), [famille]);

  // Ombre de contact au pied du support : refaite un moment après le dernier changement de silhouette.
  const epoch = useRenderStats((state) => state.gpuEpoch);
  // Ombre de contact refaite un moment après le dernier changement de silhouette (curseur, échange).
  const [stamp, setStamp] = useState(0);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const reshadow = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setStamp((value) => value + 1), SHADOW_DELAY_MS);
  }, []);

  // Traitements et lueur de la pièce choisie : repeints sans reposer le moteur.
  useLayoutEffect(() => {
    if (!prepared) return;
    paint(prepared, famille, known, useBuilds.getState().builds[vehicleId], selected, bodyEnv);
    invalidate();
  }, [prepared, signature, selected, bodyEnv, famille, known, vehicleId, invalidate]);

  // Vue éclatée et option posée de chaque échange.
  useLayoutEffect(() => {
    if (!prepared) return;
    pose(prepared, famille, known, useBuilds.getState().builds[vehicleId], eclate);
    reshadow();
    invalidate();
  }, [prepared, eclate, signature, famille, known, vehicleId, reshadow, invalidate]);

  // Ce que la scène montre, pour les parcours : la famille posée, l'écart, la pièce choisie.
  useEffect(() => {
    const element = stage.current;
    putData(element, 'etabli', prepared ? famille.id : null);
    putData(element, 'eclate', prepared ? String(Math.round(eclate * 100)) : null);
    putData(element, 'etabliPiece', prepared ? selected : null);
    return () => {
      putData(element, 'etabli', null);
      putData(element, 'eclate', null);
      putData(element, 'etabliPiece', null);
    };
  }, [stage, prepared, famille.id, eclate, selected]);

  if (!prepared) return null;
  return (
    <group rotation-y={((famille.orientation ?? 0) * Math.PI) / 180}>
      <primitive object={prepared.root} />
      {/* Hors de la sonde, comme l'ombre du véhicule ; à laisser à y = 0. */}
      <group userData={{ hideInProbe: true }}>
        <EtabliOmbre key={epoch} caster={prepared.root} cadre={famille.cadre} stamp={stamp} />
      </group>
    </group>
  );
}
