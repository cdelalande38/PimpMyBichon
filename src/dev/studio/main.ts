// Studio des formes : page de développement servie par le serveur de développement seulement
// (jamais importée par l'app, absente du build). Elle pose une planche de pièces sur un sol sombre
// légèrement brillant, sous un éclairage de studio neutre ou sous un éclairage « garage » (bleu-violet
// à gauche, rouge à droite, environnement sombre), caméra de trois quarts. Rendu à la demande.
//
// Paramètres d'URL :
//   planche=<nom>             planche du registre (src/dev/studio/planches/*.ts), « formes » par défaut
//   eclairage=studio|garage   « studio » par défaut
//   azimut=<degrés>           position de la caméra autour de la planche, 0 = de face ; 20 par défaut
//   damier                    damier de 10 cm sur toutes les pièces (coordonnées de texture en mètres)
//   cadre=<i>-<j>             cadre les pièces de rang i à j (à partir de 0), pour les voir de près
// Prête : attribut data-studio-pret sur body ; en cas d'erreur, data-studio-erreur.
// Planches du vrai mobilier (une par famille, une par objet) : planches/mobilier.ts. Une pièce qui
// porte un matériau du garage le prend tel quel (couleur, rugosité, métal, émission, carte) ; une
// œuvre posée est un plan à la texture de l'œuvre (teinte d'attente, puis le dessin).
// Capture : node tools/captures/studio.mjs <planche> [éclairage].

import {
  ACESFilmicToneMapping,
  BackSide,
  Box3,
  BoxGeometry,
  type BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  Euler,
  Mesh,
  MeshBasicMaterial,
  type Material,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  PointLight,
  RepeatWrapping,
  Scene,
  Sphere,
  SpotLight,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GARAGE_MATERIALS, type GarageMaterial, type GarageMaterialId } from '../../data/garageBase.ts';
import { garageArt } from '../../data/garageArt.ts';
import { acquireArtwork } from '../../scene/garage/artwork.ts';
import { shapeGeometry, triangleCount } from '../../scene/garage/shapes.ts';
import { garageTexture } from '../../scene/garage/textures.ts';
import type { ModulePlanches, PieceStudio, Planche } from './registre.ts';

const modules = import.meta.glob<ModulePlanches>('./planches/*.ts', { eager: true });
const PLANCHES: Record<string, Planche> = {};
for (const module of Object.values(modules)) Object.assign(PLANCHES, module.planches);

const params = new URLSearchParams(location.search);
const nomPlanche = params.get('planche') ?? 'formes';
const eclairage = params.get('eclairage') === 'garage' ? 'garage' : 'studio';
const azimut = (Number(params.get('azimut') ?? 20) * Math.PI) / 180;
const damier = params.has('damier');
/** Pièces à cadrer (« 3-8 », rangs dans la planche, à partir de 0) ; toute la planche par défaut. */
const cadre = /^(\d+)-(\d+)$/.exec(params.get('cadre') ?? '');

/** Damier de 10 cm (dix cases par mètre), une ligne rouge à chaque mètre. */
function textureDamier(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  const cell = 512 / 10;
  for (let i = 0; i < 10; i += 1) {
    for (let j = 0; j < 10; j += 1) {
      ctx.fillStyle = (i + j) % 2 === 0 ? '#e8e8e8' : '#4a4a4a';
      ctx.fillRect(i * cell, j * cell, cell, cell);
    }
  }
  ctx.strokeStyle = '#e02020';
  ctx.lineWidth = 6;
  ctx.strokeRect(0, 0, 512, 512);
  const texture = new CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** Environnement sombre du garage : une bande bleu-violet à gauche, une rouge à droite, un filet blanc au plafond. */
function environnementGarage(): Scene {
  const scene = new Scene();
  const salle = new Mesh(new BoxGeometry(14, 6, 14), new MeshBasicMaterial({ color: new Color('#07060b'), side: BackSide }));
  salle.position.y = 2.5;
  scene.add(salle);
  const bande = (couleur: string, intensite: number, x: number, y: number, taille: [number, number, number]) => {
    const mesh = new Mesh(new BoxGeometry(...taille), new MeshBasicMaterial({ color: new Color(couleur).multiplyScalar(intensite) }));
    mesh.position.set(x, y, 0);
    scene.add(mesh);
  };
  bande('#5b4bff', 8, -6.8, 1.6, [0.2, 1.4, 7]);
  bande('#ff1a2e', 8, 6.8, 1.6, [0.2, 1.4, 7]);
  bande('#ffffff', 2.5, 0, 5.4, [5, 0.1, 0.3]);
  return scene;
}

/** Matière d'un matériau du garage, aux valeurs de GARAGE_MATERIALS (comme build.ts). */
function matiereGarage(id: GarageMaterialId, carte: CanvasTexture | null): MeshStandardMaterial {
  const spec: GarageMaterial = GARAGE_MATERIALS[id];
  const material = new MeshStandardMaterial({
    color: spec.color,
    roughness: spec.roughness,
    metalness: spec.metalness,
    envMapIntensity: spec.env ?? 0.2,
  });
  if (carte) material.map = carte;
  else if (spec.map) material.map = garageTexture(spec.map, spec.repeat);
  if (spec.roughnessMap && !carte) material.roughnessMap = garageTexture(spec.roughnessMap, spec.repeat);
  if (spec.emissive) {
    material.emissive = new Color(spec.emissive);
    material.emissiveIntensity = spec.emissiveIntensity ?? 1;
  }
  return material;
}

/** Œuvres en cours de chargement : la page n'est prête qu'une fois leurs dessins posés. */
const chargements: Array<Promise<boolean>> = [];
let redemander = () => {};

/**
 * Géométrie et matière d'une pièce ; une œuvre posée est un plan à la texture de l'œuvre, émissive
 * ou éclairée selon le registre.
 */
function construire(piece: PieceStudio, carte: CanvasTexture | null): { geometry: BufferGeometry; material: Material } {
  if (!piece.oeuvre) {
    const material = piece.materiau
      ? matiereGarage(piece.materiau, carte)
      : new MeshStandardMaterial({ color: piece.couleur, roughness: piece.rugosite ?? 0.5, metalness: piece.metal ?? 0, map: carte });
    return { geometry: shapeGeometry(piece.forme), material };
  }
  const { art, region, largeur, hauteur } = piece.oeuvre;
  const item = garageArt(art);
  const artwork = acquireArtwork(art, { ...(region ? { region } : {}), onReady: () => redemander() });
  chargements.push(artwork.ready);
  const transparence = item.transparent ? { transparent: true, alphaTest: 0.02 } : {};
  const material =
    item.lighting === 'emissive'
      ? new MeshBasicMaterial({ map: artwork.texture, color: new Color(1, 1, 1).multiplyScalar(item.glow ?? 1), ...transparence })
      : new MeshStandardMaterial({ map: artwork.texture, roughness: 0.6, metalness: 0, ...transparence });
  return { geometry: new PlaneGeometry(largeur, hauteur), material };
}

function afficherErreur(error: unknown): void {
  const message = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
  const div = document.createElement('div');
  div.id = 'erreur';
  div.textContent = `Studio : ${message}`;
  document.body.append(div);
  document.body.dataset.studioErreur = message.split('\n')[0];
}

function demarrer(): void {
  const planche = PLANCHES[nomPlanche];
  if (!planche) throw new Error(`planche « ${nomPlanche} » inconnue (planches : ${Object.keys(PLANCHES).sort().join(', ')})`);

  const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = eclairage === 'garage' ? 1.1 : 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  document.body.prepend(renderer.domElement);

  const scene = new Scene();
  const pmrem = new PMREMGenerator(renderer);
  if (eclairage === 'garage') {
    scene.environment = pmrem.fromScene(environnementGarage(), 0.02).texture;
    scene.environmentIntensity = 1.2;
    scene.background = new Color('#060509');
  } else {
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.9;
    scene.background = new Color('#2a2b30');
  }
  pmrem.dispose();

  // Pièces.
  const carte = damier ? textureDamier() : null;
  const boite = new Box3();
  const boiteCadre = new Box3();
  let triangles = 0;
  const etiquettes: Array<{ texte: string; ancre: Vector3 }> = [];
  /** Objets du garage : triangles (œuvres exclues) et boîte, pour une étiquette par objet. */
  const objets = new Map<string, { triangles: number; boite: Box3 }>();
  for (const element of planche) {
    const { geometry, material } = construire(element, carte);
    const n = element.oeuvre ? 0 : triangleCount(geometry);
    triangles += n;
    const mesh = new Mesh(geometry, material);
    mesh.position.set(...(element.position ?? [0, 0, 0]));
    mesh.rotation.copy(new Euler(...(element.rotation ?? [0, 0, 0])));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    mesh.updateMatrixWorld();
    const pieceBoite = new Box3().setFromObject(mesh);
    boite.union(pieceBoite);
    const rang = planche.indexOf(element);
    if (!cadre || (rang >= Number(cadre[1]) && rang <= Number(cadre[2]))) boiteCadre.union(pieceBoite);
    if (element.etiquette) {
      etiquettes.push({ texte: `${element.etiquette} · ${n}`, ancre: new Vector3((pieceBoite.min.x + pieceBoite.max.x) / 2, 0, pieceBoite.max.z + 0.04) });
    }
    if (element.objet) {
      const entree = objets.get(element.objet) ?? { triangles: 0, boite: new Box3() };
      entree.triangles += n;
      entree.boite.union(pieceBoite);
      objets.set(element.objet, entree);
    }
  }
  for (const [nom, { triangles: n, boite: b }] of objets) {
    etiquettes.push({ texte: `${nom.replace(/^placeholder_/, '')} · ${n}`, ancre: new Vector3((b.min.x + b.max.x) / 2, 0, b.max.z + 0.04) });
  }

  // Sol sombre légèrement brillant.
  const sol = new Mesh(new PlaneGeometry(60, 60), new MeshStandardMaterial({ color: '#141418', roughness: 0.32, metalness: 0 }));
  sol.rotation.x = -Math.PI / 2;
  sol.receiveShadow = true;
  scene.add(sol);

  // Lumières, placées d'après l'emprise de la planche.
  const centre = boite.getCenter(new Vector3());
  const taille = boite.getSize(new Vector3());
  const ombre = (light: DirectionalLight | SpotLight) => {
    light.castShadow = true;
    light.shadow.mapSize.set(2048, 2048);
    light.shadow.bias = -0.0004;
    light.shadow.normalBias = 0.02;
  };
  if (eclairage === 'garage') {
    const portee = Math.max(taille.x, taille.z) / 2 + 1.5;
    const gauche = new PointLight('#6a5cff', 9 * portee * portee, 0, 2);
    gauche.position.set(centre.x - portee, 2, centre.z + 0.6);
    const droite = new PointLight('#ff2a3a', 7 * portee * portee, 0, 2);
    droite.position.set(centre.x + portee, 2, centre.z + 0.6);
    const plafond = new SpotLight('#fff4e8', 40, 0, Math.PI / 3, 0.6, 2);
    plafond.position.set(centre.x, 4, centre.z + 1);
    plafond.target.position.copy(centre);
    ombre(plafond);
    scene.add(gauche, droite, plafond, plafond.target);
  } else {
    const soleil = new DirectionalLight('#ffffff', 2.2);
    soleil.position.set(centre.x - 3, 6, centre.z + 4);
    soleil.target.position.copy(centre);
    ombre(soleil);
    const etendue = Math.max(taille.x, taille.z) / 2 + 1;
    Object.assign(soleil.shadow.camera, { left: -etendue, right: etendue, top: etendue, bottom: -etendue, near: 0.5, far: 20 });
    scene.add(soleil, soleil.target);
  }

  // Caméra de trois quarts : la distance est ajustée pour que les coins de la boîte cadrée
  // remplissent l'image (marge de 8 %, place laissée aux étiquettes en bas).
  const camera = new PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.05, 100);
  if (boiteCadre.isEmpty()) boiteCadre.copy(boite);
  const vise = boiteCadre.getCenter(new Vector3());
  const elevation = (28 * Math.PI) / 180;
  const direction = new Vector3(Math.cos(elevation) * Math.sin(azimut), Math.sin(elevation), Math.cos(elevation) * Math.cos(azimut));
  const coins = [0, 1, 2, 3, 4, 5, 6, 7].map(
    (i) => new Vector3(i & 1 ? boiteCadre.max.x : boiteCadre.min.x, i & 2 ? boiteCadre.max.y : boiteCadre.min.y, i & 4 ? boiteCadre.max.z : boiteCadre.min.z),
  );
  let distance = boiteCadre.getBoundingSphere(new Sphere()).radius * 3;
  for (let essai = 0; essai < 12; essai += 1) {
    camera.position.copy(vise).addScaledVector(direction, distance);
    camera.lookAt(vise);
    camera.updateMatrixWorld();
    const etendue = Math.max(...coins.map((c) => c.clone().project(camera)).map((p) => Math.max(Math.abs(p.x), Math.abs(p.y) * 1.08)));
    distance *= 1 + (etendue - 0.92) * 0.8;
  }
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(vise);
  controls.update();

  const info = document.getElementById('info')!;
  info.textContent = `planche ${nomPlanche} · éclairage ${eclairage}${damier ? ' · damier 10 cm' : ''}\n${objets.size > 0 ? `${objets.size} objets · ` : ''}${planche.length} pièces · ${triangles} triangles`;

  const calque = document.getElementById('etiquettes')!;
  const divs = etiquettes.map(({ texte }) => {
    const div = document.createElement('div');
    div.className = 'etiquette';
    div.textContent = texte;
    calque.append(div);
    return div;
  });

  const rendre = () => {
    renderer.render(scene, camera);
    etiquettes.forEach(({ ancre }, i) => {
      const p = ancre.clone().project(camera);
      const div = divs[i]!;
      div.style.left = `${((p.x + 1) / 2) * window.innerWidth}px`;
      div.style.top = `${((1 - p.y) / 2) * window.innerHeight}px`;
      div.style.display = p.z < 1 ? '' : 'none';
    });
  };
  controls.addEventListener('change', rendre);
  redemander = () => requestAnimationFrame(rendre);
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    rendre();
  });
  rendre();
  // Prête quand les dessins des œuvres sont posés (ou au bout de 10 s : la teinte d'attente reste).
  const attente = new Promise((resolve) => setTimeout(resolve, 10_000));
  void Promise.race([Promise.all(chargements), attente]).then(() => {
    rendre();
    requestAnimationFrame(() => {
      document.body.dataset.studioPret = 'oui';
    });
  });
}

try {
  demarrer();
} catch (error) {
  afficherErreur(error);
}
