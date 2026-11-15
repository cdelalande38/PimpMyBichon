// Aperçu d'un véhicule généré : page de développement servie par le serveur de développement
// seulement (jamais importée par l'app, absente du build). Elle charge le GLB et le manifeste
// d'un véhicule de public/assets/vehicles/<id>/, pose la peinture de l'app sur chaque zone
// (createPaintMaterial et applyPaint de src/render/paint.ts) et un matériau par rôle sur le reste
// (chrome, alu, black, rubber, glass, leather, lamp, tail, signal), sous un éclairage de studio
// sans fichier externe (environnement RoomEnvironment, deux barres néon, sol sombre brillant).
//
// Paramètres d'URL :
//   id=<véhicule>   dossier sous public/assets/vehicles/ (« van » par défaut)
//   vue=<nom>       av34 (défaut), profil, ar34, face, arriere, dessus, roue
//   orbite          caméra libre à la souris
//   vue=interieur   point de vue intérieur du manifeste (interiorView) ; fov=<degrés> (60 par défaut)
// Prête : attribut data-vehicule-pret sur body (et data-vehicule-info : triangles, appels…) ;
// en cas d'erreur, data-vehicule-erreur. window.pmbVue(nom) change de vue et redessine.
// Capture des six vues : node tools/captures/vehicule.mjs <id>.

import {
  ACESFilmicToneMapping,
  Box3,
  BoxGeometry,
  Color,
  DirectionalLight,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { finish, type FinishId } from '../../data/finishes.ts';
import type { VehicleManifest } from '../../data/vehicleTypes.ts';
import { applyPaint, createPaintMaterial } from '../../render/paint.ts';

const params = new URLSearchParams(location.search);
const id = (params.get('id') ?? 'van').replace(/[^a-z0-9_-]/g, '');
const base = `${import.meta.env.BASE_URL}assets/vehicles/${id}/`;
const info = document.getElementById('info')!;

const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
renderer.outputColorSpace = SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new Scene();
scene.background = new Color('#101016');

// Environnement : la pièce de studio de three, plus deux barres néon (magenta à gauche, cyan à
// droite) pour lire les reflets dans la carrosserie.
const envScene = new RoomEnvironment();
for (const [color, z] of [
  ['#ff2a9a', -4],
  ['#22d8ff', 4],
] as const) {
  const bar = new Mesh(new BoxGeometry(6, 0.25, 0.25), new MeshBasicMaterial({ color: new Color(color).multiplyScalar(14) }));
  bar.position.set(0, 3.2, z);
  envScene.add(bar);
}
const pmrem = new PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(envScene, 0.02).texture;
scene.environmentIntensity = 0.9;

const key = new DirectionalLight('#ffffff', 2.2);
key.position.set(4, 7, 5);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = key.shadow.camera.bottom = -4;
key.shadow.camera.right = key.shadow.camera.top = 4;
key.shadow.bias = -0.0004;
scene.add(key);

const floor = new Mesh(new PlaneGeometry(40, 40), new MeshStandardMaterial({ color: '#17171c', roughness: 0.35, metalness: 0 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const camera = new PerspectiveCamera(30, innerWidth / innerHeight, 0.05, 100);
const controls = params.has('orbite') ? new OrbitControls(camera, renderer.domElement) : null;
controls?.addEventListener('change', () => render());

/** Matériau par rôle (§ 8), réglé comme dans l'app sans en être une copie conforme. */
function roleMaterial(name: string): Material {
  switch (name) {
    case 'chrome':
      return new MeshPhysicalMaterial({ name, color: '#ffffff', metalness: 1, roughness: 0.04 });
    case 'alu':
      return new MeshPhysicalMaterial({ name, color: '#d4d6da', metalness: 1, roughness: 0.3 });
    case 'black':
      return new MeshPhysicalMaterial({ name, color: '#0a0a0c', metalness: 0, roughness: 0.5, clearcoat: 0.3 });
    case 'rubber':
      return new MeshStandardMaterial({ name, color: '#141414', metalness: 0, roughness: 0.92 });
    case 'glass':
      return new MeshPhysicalMaterial({ name, color: '#0c0f14', metalness: 0, roughness: 0.03, transparent: true, opacity: 0.62, clearcoat: 1, envMapIntensity: 1.4 });
    case 'leather':
      return new MeshStandardMaterial({ name, color: '#1a1412', metalness: 0, roughness: 0.62 });
    case 'lamp':
      return new MeshPhysicalMaterial({ name, color: '#f5f5f0', emissive: '#fff4e0', emissiveIntensity: 1.6, roughness: 0.1, clearcoat: 1 });
    case 'tail':
      return new MeshPhysicalMaterial({ name, color: '#5a0505', emissive: '#ff1408', emissiveIntensity: 1.2, roughness: 0.15, clearcoat: 1 });
    case 'signal':
      return new MeshPhysicalMaterial({ name, color: '#ff8a1a', emissive: '#ff7000', emissiveIntensity: 1.2, roughness: 0.15, clearcoat: 1 });
    default:
      return new MeshStandardMaterial({ name, color: '#ff00ff' }); // rôle inconnu : saute aux yeux
  }
}

const VIEWS: Record<string, { dir: [number, number, number]; fov: number; fit: number; target?: 'roue' }> = {
  av34: { dir: [1, 0.32, 0.85], fov: 30, fit: 1.05 },
  profil: { dir: [0, 0.08, 1], fov: 26, fit: 1.0 },
  ar34: { dir: [-1, 0.32, 0.85], fov: 30, fit: 1.05 },
  face: { dir: [1, 0.08, 0], fov: 26, fit: 1.0 },
  arriere: { dir: [-1, 0.08, 0], fov: 26, fit: 1.0 },
  dessus: { dir: [0.0001, 1, 0.0001], fov: 30, fit: 1.0 },
  roue: { dir: [0.35, 0.2, 1], fov: 24, fit: 1, target: 'roue' },
};

let vehicleBox = new Box3();
let interior: VehicleManifest['interiorView'];
let wheelCenter = new Vector3();
let wheelRadius = 0.35;

function setView(name: string): void {
  if (name === 'interieur' && interior) {
    camera.fov = Number(params.get('fov') ?? 60);
    camera.aspect = innerWidth / innerHeight;
    camera.near = 0.02;
    camera.up.set(0, 1, 0);
    camera.position.set(...interior.eye);
    camera.lookAt(new Vector3(...interior.target));
    camera.updateProjectionMatrix();
    controls?.target.set(...interior.target);
    render();
    return;
  }
  camera.near = 0.05;
  const view = VIEWS[name] ?? VIEWS.av34!;
  camera.fov = view.fov;
  camera.aspect = innerWidth / innerHeight;
  camera.up.set(0, 1, 0);
  const dir = new Vector3(...view.dir).normalize();
  let target: Vector3;
  let radius: number;
  if (view.target === 'roue') {
    target = wheelCenter.clone();
    radius = wheelRadius * 1.25;
  } else {
    target = vehicleBox.getCenter(new Vector3());
    const size = vehicleBox.getSize(new Vector3());
    // Rayon apparent : demi-diagonale de la boîte projetée perpendiculairement à la vue.
    const proj = new Vector3(size.x * Math.sqrt(1 - dir.x * dir.x), size.y * Math.sqrt(1 - dir.y * dir.y), size.z * Math.sqrt(1 - dir.z * dir.z));
    radius = Math.max(proj.x, proj.y, proj.z) / 2;
  }
  if (name === 'dessus') camera.up.set(0, 0, -1);
  const halfFov = (camera.fov * Math.PI) / 360;
  const fovMin = Math.min(halfFov, Math.atan(Math.tan(halfFov) * camera.aspect));
  const dist = (radius * view.fit) / Math.tan(fovMin) + radius * 0.5;
  camera.position.copy(target).addScaledVector(dir, dist);
  camera.lookAt(target);
  camera.updateProjectionMatrix();
  controls?.target.copy(target);
  render();
}

function render(): void {
  renderer.render(scene, camera);
}

async function main(): Promise<void> {
  const manifest = (await (await fetch(`${base}vehicle.json`)).json()) as VehicleManifest;
  interior = manifest.interiorView;
  const gltf = await new GLTFLoader().loadAsync(`${base}${manifest.glb}`);
  const root = gltf.scene;
  const zoneOf = new Map<string, VehicleManifest['zones'][number]>();
  for (const zone of manifest.zones) for (const m of zone.materials) zoneOf.set(m, zone);
  const cache = new Map<string, Material>();
  let triangles = 0;
  let calls = 0;
  const unknown = new Set<string>();
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    object.castShadow = true;
    object.receiveShadow = true;
    const source = object.material as Material;
    let material = cache.get(source.name);
    if (!material) {
      const zone = zoneOf.get(source.name);
      if (zone) {
        const paint = createPaintMaterial(source);
        applyPaint(paint, zone.paint.color, finish(zone.paint.finish as FinishId), {
          flake: zone.paint.flake,
          color2: zone.paint.color2,
        });
        material = paint;
      } else {
        if (source.name.startsWith('paint_')) unknown.add(source.name);
        material = roleMaterial(source.name);
      }
      cache.set(source.name, material);
    }
    object.material = material;
    calls += 1;
    triangles += (object.geometry.index?.count ?? object.geometry.attributes.position!.count) / 3;
  });
  scene.add(root);
  root.updateMatrixWorld(true);
  vehicleBox = new Box3().setFromObject(root);
  const wheel = root.getObjectByName('roue_avant_droite') ?? root.getObjectByName('roue_avant');
  if (wheel) {
    const box = new Box3().setFromObject(wheel);
    wheelCenter = box.getCenter(new Vector3());
    wheelRadius = box.getSize(new Vector3()).y / 2;
  }
  const size = vehicleBox.getSize(new Vector3());
  const text =
    `${manifest.name} (${id}) · ${Math.round(triangles).toLocaleString('fr-FR')} triangles · ${calls} appels · ` +
    `${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)} m` +
    (unknown.size ? `\nzones absentes du manifeste : ${[...unknown].join(', ')}` : '');
  info.textContent = text;
  document.body.dataset.vehiculeInfo = text;
  setView(params.get('vue') ?? 'av34');
  (window as unknown as { pmbVue: (name: string) => void }).pmbVue = setView;
  addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight);
    setView(params.get('vue') ?? 'av34');
  });
  document.body.dataset.vehiculePret = '';
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const box = document.createElement('div');
  box.id = 'erreur';
  box.textContent = message;
  document.body.appendChild(box);
  document.body.dataset.vehiculeErreur = message;
});
