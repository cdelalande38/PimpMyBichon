// Environnement de réflexion du garage de substitut, fabriqué sur place : aucune image HDR
// téléchargée (zéro requête vers un tiers). Des panneaux lumineux aux couleurs de l'ambiance
// (bleu à gauche et rouge à droite pour « Bichon »), que la carrosserie renvoie.
// Au jalon 1, il laisse la place à la sonde de réflexion rendue depuis la position du véhicule (§ 8).

import type { Ambiance } from '../data/ambiances.ts';
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

type Lights = Pick<Ambiance, 'left' | 'right' | 'key'>;

// Bandeaux gauche et droit, plafonnier, appoint blanc, sol sombre.
function panels({ left, right, key }: Lights): Panel[] {
  return [
    [left, 5, 9, 1.1, -7, 3.2, 1],
    [right, 5, 9, 1.1, 7, 3.2, -1],
    [key, 3.2, 5, 2.4, 0, 8, 1],
    ['#ffffff', 1.6, 4, 0.5, 1, 2.6, 8],
    ['#3a3644', 0.6, 30, 30, 0, -3, 0],
  ];
}

const DEFAULT_LIGHTS: Lights = { left: '#3a4dff', right: '#ff1f2e', key: '#fff1dc' };

/** Rend l'environnement une fois et renvoie sa texture préfiltrée, prête pour `scene.environment`. */
export function createGarageEnvironment(renderer: WebGLRenderer, lights: Lights = DEFAULT_LIGHTS): Texture {
  const scene = new Scene();
  scene.background = new Color('#040308');

  const disposables: Array<{ dispose: () => void }> = [];
  for (const [hex, gain, w, h, x, y, z] of panels(lights)) {
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
