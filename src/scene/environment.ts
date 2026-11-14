// Environnement de réflexion du garage de substitut, fabriqué sur place : aucune image HDR
// téléchargée (zéro requête vers un tiers). Des panneaux lumineux rouge et bleu, comme la
// signature du vrai garage, que la carrosserie renvoie.
// Au jalon 1, il laisse la place à la sonde de réflexion rendue depuis la position du véhicule (§ 8).

import {
  Color,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  type Texture,
  type WebGLRenderer,
} from 'three';

type Panel = [hex: string, gain: number, w: number, h: number, x: number, y: number, z: number];

// Bandeaux rouge (gauche) et bleu (droite), plafonnier chaud, appoint blanc, sol sombre.
const PANELS: Panel[] = [
  ['#ff1c2c', 5, 9, 1.1, -7, 3.2, 1],
  ['#2458ff', 5, 9, 1.1, 7, 3.2, -1],
  ['#fff1dc', 3.2, 5, 2.4, 0, 8, 1],
  ['#ffffff', 1.6, 4, 0.5, 1, 2.6, 8],
  ['#3a3644', 0.6, 30, 30, 0, -3, 0],
];

/** Rend l'environnement une fois et renvoie sa texture préfiltrée, prête pour `scene.environment`. */
export function createGarageEnvironment(renderer: WebGLRenderer): Texture {
  const scene = new Scene();
  scene.background = new Color('#040308');

  const disposables: Array<{ dispose: () => void }> = [];
  for (const [hex, gain, w, h, x, y, z] of PANELS) {
    const geometry = new PlaneGeometry(w, h);
    const material = new MeshBasicMaterial({
      color: new Color(hex).multiplyScalar(gain),
      side: DoubleSide,
    });
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.lookAt(0, 0.5, 0);
    scene.add(mesh);
    disposables.push(geometry, material);
  }

  const pmrem = new PMREMGenerator(renderer);
  const texture = pmrem.fromScene(scene, 0.035).texture;
  pmrem.dispose();
  for (const item of disposables) item.dispose();
  return texture;
}
