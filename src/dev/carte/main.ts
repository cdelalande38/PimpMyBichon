// Aperçu d'une carte de sortie : page de développement servie par le serveur de développement
// seulement (jamais importée par l'app, absente du build). Elle lit public/assets/maps/<id>/map.json
// et la route qu'il désigne, charge les tronçons autour d'une abscisse et le relief lointain, et pose
// une teinte plate par rôle (fusion_<rôle>) sous un éclairage simple de crépuscule, avec des
// géométries de remplacement pour les instances (arbres, lampadaires, balises). Ce n'est pas le
// rendu de la sortie de nuit : seulement de quoi juger la géométrie.
//
// Paramètres d'URL :
//   id=<carte>        dossier sous public/assets/maps/ (obligatoire)
//   vue=conducteur    à hauteur de conducteur sur la voie de droite (défaut) ; oiseau ; dessus
//   s=<m>             abscisse sur le parcours (0 par défaut)
//   regard=<degrés>   rotation du regard vers la gauche (conducteur) ou cap de la vue d'oiseau
//   hauteur=<m>       hauteur de la vue de dessus (1 400 m par défaut) : plan d'ensemble d'une ville
//   orbite            caméra libre à la souris
//   fenetre=<a>,<b>   ne charger que les tronçons que la sortie charge : a derrière, b devant celui de
//                     l'abscisse (la sortie en qualité standard : 1,2) ; sinon tout à 1,6 km (3 km d'oiseau)
// Prête : attribut data-carte-pret sur body (data-carte-info : tronçons, triangles) ; en cas
// d'erreur, data-carte-erreur. window.pmbVue({ vue, s, regard }) déplace la caméra, charge les
// tronçons utiles et redessine. Captures : node tools/captures/carte.mjs <id>.

import {
  AmbientLight,
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  Quaternion,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type BufferGeometry,
  type Material,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MAP_INSTANCE_STRIDE, MAP_RAIL_STRIDE, type MapChunk, type MapInstanceKind, type MapManifest, type MapMaterialRole, type MapRoute } from '../../data/mapTypes.ts';

const params = new URLSearchParams(location.search);
const id = params.get('id') ?? '';
const info = document.getElementById('info') as HTMLDivElement;
const base = `${import.meta.env.BASE_URL}assets/maps/${id}/`;

const TEINTES: Record<MapMaterialRole, string> = {
  chaussee: '#3a3d44',
  marquage: '#f2efe4',
  accotement: '#6b665c',
  terrain: '#4d6338',
  eau: '#2c5f86',
  mur: '#b3aa9c',
  toit: '#7a4a3a',
  fenetre: '#f0d68a',
  ouvrage: '#9a968e',
  glissiere: '#d5d9de',
  voie: '#45484f',
};
const materiaux = new Map<string, Material>();
function materiau(nom: string): Material {
  let m = materiaux.get(nom);
  if (!m) {
    const role = nom as MapMaterialRole;
    const teinte = TEINTES[role] ?? '#ff00ff';
    m =
      role === 'eau'
        ? new MeshStandardMaterial({ color: teinte, roughness: 0.25, metalness: 0 })
        : role === 'fenetre'
          ? new MeshLambertMaterial({ color: teinte, emissive: new Color('#7a5a20') })
          : new MeshLambertMaterial({ color: teinte });
    materiaux.set(nom, m);
  }
  return m;
}

const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.outputColorSpace = SRGBColorSpace;
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
const scene = new Scene();
const ciel = new Color('#5d6f8c');
scene.background = ciel;
const brume = new Fog(ciel, 300, 2600);
scene.fog = brume;
scene.add(new HemisphereLight('#b8c8e8', '#3a3328', 1.6));
scene.add(new AmbientLight('#ffffff', 0.25));
const lune = new DirectionalLight('#fff1dc', 1.6);
lune.position.set(-0.6, 1, 0.35);
scene.add(lune);
const camera = new PerspectiveCamera(60, innerWidth / innerHeight, 0.3, 30000);
const controls = params.has('orbite') ? new OrbitControls(camera, renderer.domElement) : null;
const loader = new GLTFLoader();

let route: MapRoute | null = null;
const charges = new Map<string, Group>();
const enCours = new Map<string, Promise<void>>();

// Géométries de remplacement des instances, une par nature (l'app posera les siennes).
const GEOS: Record<MapInstanceKind, Array<[BufferGeometry, Material]>> = {
  arbre: [
    [new ConeGeometry(2.2, 7, 7).translate(0, 5, 0), new MeshLambertMaterial({ color: '#2f4a2a' })],
    [new CylinderGeometry(0.2, 0.25, 1.6, 5).translate(0, 0.8, 0), new MeshLambertMaterial({ color: '#4a3a2a' })],
  ],
  lampadaire: [
    [new CylinderGeometry(0.07, 0.1, 8, 6).translate(0, 4, 0), new MeshLambertMaterial({ color: '#777b80' })],
    [new BoxGeometry(1.4, 0.18, 0.35).translate(0, 8, 0.6), new MeshLambertMaterial({ color: '#fff3c4', emissive: new Color('#ffd27a') })],
  ],
  balise: [[new BoxGeometry(0.12, 1.1, 0.12).translate(0, 0.55, 0), new MeshLambertMaterial({ color: '#f4f4f4', emissive: new Color('#552222') })]],
  feu: [
    [new CylinderGeometry(0.07, 0.07, 3.3, 5).translate(0, 1.65, 0), new MeshLambertMaterial({ color: '#2a2c30' })],
    [new BoxGeometry(0.4, 1.1, 0.3).translate(0, 3.05, 0), new MeshLambertMaterial({ color: '#ff3a20', emissive: new Color('#aa1408') })],
  ],
  palmier: [
    [new CylinderGeometry(0.16, 0.24, 7.5, 5).translate(0, 3.75, 0), new MeshLambertMaterial({ color: '#6a5a44' })],
    [new ConeGeometry(2.6, 1.6, 7).translate(0, 7.3, 0), new MeshLambertMaterial({ color: '#3f6a2c' })],
  ],
};

function instances(chunk: MapChunk, groupe: Group) {
  const m = new Matrix4();
  const q = new Quaternion();
  const axe = new Vector3(0, 1, 0);
  for (const kind of Object.keys(GEOS) as MapInstanceKind[]) {
    const data = chunk.instances[kind];
    if (!data || data.length === 0) continue;
    const n = data.length / MAP_INSTANCE_STRIDE;
    for (const [geo, mat] of GEOS[kind]) {
      const im = new InstancedMesh(geo, mat, n);
      for (let i = 0; i < n; i += 1) {
        const o = i * MAP_INSTANCE_STRIDE;
        const e = data[o + 3] ?? 1;
        q.setFromAxisAngle(axe, data[o + 4] ?? 0);
        m.compose(new Vector3(data[o] ?? 0, data[o + 1] ?? 0, data[o + 2] ?? 0), q, new Vector3(e, e, e));
        im.setMatrixAt(i, m);
      }
      groupe.add(im);
    }
  }
}

function habiller(objet: Object3D) {
  objet.traverse((o) => {
    if (o instanceof Mesh) {
      const nom = (o.material as Material).name || o.name.replace(/^fusion_/, '');
      o.material = materiau(nom);
    }
  });
}

async function chargerChunk(chunk: MapChunk) {
  if (charges.has(chunk.file)) return;
  const deja = enCours.get(chunk.file);
  if (deja) return deja;
  const p = loader.loadAsync(base + chunk.file).then((gltf) => {
    const groupe = new Group();
    groupe.position.set(...chunk.origin);
    habiller(gltf.scene);
    groupe.add(gltf.scene);
    instances(chunk, groupe);
    scene.add(groupe);
    charges.set(chunk.file, groupe);
  });
  enCours.set(chunk.file, p);
  await p;
  enCours.delete(chunk.file);
}

/** Point du rail à l'abscisse s (interpolé). */
function railEn(s: number): Vector3 {
  const r = route as MapRoute;
  const n = r.rail.length / MAP_RAIL_STRIDE;
  const f = Math.max(0, Math.min(n - 1.001, s / r.step));
  const i = Math.floor(f);
  const t = f - i;
  const a = (k: number) => r.rail[i * MAP_RAIL_STRIDE + k] ?? 0;
  const b = (k: number) => r.rail[(i + 1) * MAP_RAIL_STRIDE + k] ?? 0;
  return new Vector3(a(0) + (b(0) - a(0)) * t, a(1) + (b(1) - a(1)) * t, a(2) + (b(2) - a(2)) * t);
}

type Vue = { vue?: string; s?: number; regard?: number; fenetre?: string; hauteur?: number };

async function pmbVue(v: Vue) {
  const r = route as MapRoute;
  const s = Math.max(0, Math.min(r.length, v.s ?? 0));
  const vue = v.vue ?? 'conducteur';
  const regard = ((v.regard ?? 0) * Math.PI) / 180;
  // Tronçons à moins de 1,6 km (vue d'oiseau : 3 km), les autres libérés.
  const portee = vue === 'conducteur' ? 1600 : vue === 'dessus' ? Math.max(3000, (v.hauteur ?? 0) * 1.4) : 3000;
  const fenetre = (v.fenetre ?? params.get('fenetre') ?? '').split(',').map(Number);
  const ici = r.chunks.findIndex((c) => s >= c.from && s <= c.to);
  const n = r.chunks.length;
  const dansFenetre = (i: number) => {
    const [derriere = 0, devant = 0] = fenetre;
    for (let k = -derriere; k <= devant; k += 1) if ((r.loop ? (((ici + k) % n) + n) % n : ici + k) === i) return true;
    return false;
  };
  const utiles = r.chunks.filter((c, i) => (fenetre.length === 2 && fenetre.every(Number.isFinite) ? dansFenetre(i) : c.to >= s - portee && c.from <= s + portee));
  for (const [file, g] of charges)
    if (!utiles.some((c) => c.file === file)) {
      scene.remove(g);
      charges.delete(file);
    }
  await Promise.all(utiles.map(chargerChunk));
  // Vue de dessus : pas de brume (le plan d'ensemble se regarde de haut, au-delà de sa portée).
  scene.fog = vue === 'dessus' ? null : brume;
  const p = railEn(s);
  const devant = railEn(s + 30).sub(p).setY(0).normalize();
  const droite = new Vector3(-devant.z, 0, devant.x);
  const section = r.sections.find((x) => s >= x.from && s <= x.to);
  const voie = (section?.width ?? 7) / 4;
  if (vue === 'oiseau' || vue === 'dessus') {
    const cap = devant.clone().applyAxisAngle(new Vector3(0, 1, 0), regard);
    const haut = vue === 'dessus' ? v.hauteur || Number(params.get('hauteur')) || 1400 : 260;
    const recul = vue === 'dessus' ? 1 : 420;
    camera.position.copy(p).addScaledVector(cap, -recul).add(new Vector3(0, haut, 0));
    camera.lookAt(p.clone().addScaledVector(cap, vue === 'dessus' ? 0 : 500));
  } else {
    const oeil = p.clone().addScaledVector(droite, voie).add(new Vector3(0, 1.2, 0));
    const cible = railEn(s + 45).addScaledVector(droite, voie).add(new Vector3(0, 1.0, 0));
    const dir = cible.sub(oeil).applyAxisAngle(new Vector3(0, 1, 0), regard);
    camera.position.copy(oeil);
    camera.lookAt(oeil.clone().add(dir));
  }
  if (controls) {
    controls.target.copy(p);
    controls.update();
  }
  let triangles = 0;
  for (const c of utiles) triangles += c.triangles;
  info.textContent = `${id} · s = ${(s / 1000).toFixed(2)} km · ${vue}\n${utiles.length} tronçons chargés · ${triangles.toLocaleString('fr-FR')} triangles (hors instances et lointain)`;
  document.body.dataset.carteInfo = `${utiles.length} tronçons · ${triangles} triangles`;
  renderer.render(scene, camera);
}

async function demarrer() {
  if (!id) throw new Error('paramètre id manquant (dossier de public/assets/maps/)');
  const manifeste = (await (await fetch(`${base}map.json`)).json()) as MapManifest;
  route = (await (await fetch(base + manifeste.route)).json()) as MapRoute;
  if (route.far) {
    const far = await loader.loadAsync(base + route.far.file);
    habiller(far.scene);
    far.scene.traverse((o) => {
      if (o instanceof Mesh) o.material = new MeshLambertMaterial({ color: '#3e4a3a' });
    });
    scene.add(far.scene);
  }
  (window as unknown as { pmbVue: typeof pmbVue }).pmbVue = pmbVue;
  await pmbVue({ vue: params.get('vue') ?? 'conducteur', s: Number(params.get('s') ?? 0), regard: Number(params.get('regard') ?? 0) });
  document.body.dataset.cartePret = '1';
  const boucle = () => {
    if (controls) {
      controls.update();
      renderer.render(scene, camera);
    }
    requestAnimationFrame(boucle);
  };
  boucle();
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  renderer.render(scene, camera);
});

demarrer().catch((error: unknown) => {
  const msg = error instanceof Error ? error.message : String(error);
  info.textContent = `erreur : ${msg}`;
  document.body.dataset.carteErreur = msg;
});
