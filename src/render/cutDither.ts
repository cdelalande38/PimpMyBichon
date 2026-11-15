// Variante « trame » de la coupe caméra (src/render/cut.ts) : bascule et préchauffage.
// Le rejet de fragments de la trame n'existe que sous le define PMB_CUT_DITHER. Un matériau opaque
// du décor ne le porte que pendant qu'un de ses éléments est en fondu (règle pure : `ditherNeeds`,
// src/scene/garage/cut.ts) : au repos, et pendant toute la rotation lente sans fondu, aucun
// programme du décor ne contient le `discard` de la trame (une carte de téléphone garde ainsi son
// test de profondeur précoce ; gain non mesurable sur une carte de bureau, voir tools/README.md,
// Cadence). Seules exceptions : les œuvres découpées (cible, plaques), dont l'`alphaTest` garde un
// rejet de fragments permanent (src/scene/garage/artwork.ts).
// three garde par matériau la table de ses programmes (une variante par clé, define compris) :
// basculer le define ne recompile qu'à la première fois. Cette première fois, on la fait à
// l'avance, sans rien dessiner : création (`warmCutDither`), compilation en tâche de fond, puis
// premier usage (`primeCutDither`) ; tant que les variantes ne sont pas prêtes, la coupe bascule
// sans fondu plutôt que de figer l'image pendant une compilation.

import { Mesh, type Camera, type Material, type Object3D, type Scene, type WebGLRenderer, type WebGLRenderTarget } from 'three';
import { CUT_DITHER_DEFINE } from './cut.ts';

/**
 * Programme de three vu d'ici : sa disponibilité (KHR_parallel_shader_compile), et son premier
 * usage (`getUniforms` : journal de liaison, emplacements des uniformes et des attributs).
 */
export interface CutDitherProgram {
  isReady: () => boolean;
  getUniforms: () => unknown;
}

export function hasCutDither(material: Material): boolean {
  return material.defines?.[CUT_DITHER_DEFINE] !== undefined;
}

/**
 * Pose ou retire la trame d'un matériau ; rend vrai si l'état a changé. Le programme change à la
 * prochaine image (sans recompiler si la variante existe déjà).
 */
export function setCutDither(material: Material, on: boolean): boolean {
  if (hasCutDither(material) === on) return false;
  const defines = (material.defines ??= {});
  if (on) defines[CUT_DITHER_DEFINE] = '';
  else delete defines[CUT_DITHER_DEFINE];
  material.needsUpdate = true;
  return true;
}

/** Programmes de three d'un matériau (table de ses variantes), par clé. */
function programsOf(gl: WebGLRenderer, material: Material): Map<string, CutDitherProgram> | undefined {
  return (gl.properties.get(material) as { programs?: Map<string, CutDitherProgram> } | undefined)?.programs;
}

/**
 * Maillages de `root` qui portent un de ces matériaux : ceux dont la variante « trame » est à
 * préparer. Groupés par matériau, dans l'ordre de `carriers` : une tranche de préchauffage ne
 * bascule que les matériaux de ses maillages, chacun une fois.
 */
export function cutDitherMeshes(root: Object3D, carriers: readonly Material[]): Mesh[] {
  const rank = new Map(carriers.map((material, i) => [material, i]));
  const groups: Mesh[][] = carriers.map(() => []);
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const i = rank.get(object.material as Material);
    if (i !== undefined) groups[i]?.push(object);
  });
  return groups.flat();
}

/**
 * Crée sans rien dessiner la variante « trame » des matériaux `carriers` pour les maillages
 * `meshes` à partir du rang `from`, dans l'état des passes du décor : cible de rendu non nulle
 * (reflet du sol et scène du composeur rendent tous deux dans une cible : espace de travail
 * linéaire, sans tone mapping), lumières, brume et environnement de `scene` tels qu'ils sont à
 * l'appel. La sonde de réflexion, elle, ne voit jamais la trame (src/scene/garage/build.ts,
 * crochet `onProbe`). Maillage par maillage (`compile` sur tout le décor créerait aussi les
 * programmes d'objets qui ne se dessinent pas dans cet état), et par tranches : on s'arrête dès
 * que `budgetMs` est dépassé, pour ne pas bloquer le fil principal pendant la rotation lente.
 * Seuls les matériaux des maillages de la tranche prennent la trame, le temps de leur compilation
 * (un changement de define coûte à three, à l'image suivante, le calcul de la clé de programme).
 * Rend le rang du prochain maillage à préparer (`meshes.length` : fini). Les variantes se compilent
 * ensuite en tâche de fond (KHR_parallel_shader_compile) : attendre `programsReady`, puis
 * `primeCutDither`.
 */
export function warmCutDither(
  gl: WebGLRenderer,
  meshes: readonly Mesh[],
  from: number,
  scene: Scene,
  camera: Camera,
  carriers: readonly Material[],
  target: WebGLRenderTarget,
  budgetMs = Number.POSITIVE_INFINITY,
): number {
  const start = performance.now();
  const wanted = new Set(carriers);
  const toggled: Material[] = [];
  const previous = gl.getRenderTarget();
  gl.setRenderTarget(target);
  let next = from;
  try {
    while (next < meshes.length) {
      const mesh = meshes[next];
      next += 1;
      if (!mesh) continue;
      const material = mesh.material as Material;
      if (wanted.has(material) && setCutDither(material, true)) toggled.push(material);
      gl.compile(mesh, camera, scene);
      if (performance.now() - start > budgetMs) break;
    }
  } finally {
    gl.setRenderTarget(previous);
    for (const material of toggled) setCutDither(material, false);
  }
  return next;
}

/** Variantes « trame » créées pour ces matériaux (à attendre avec `programsReady`). */
export function cutDitherPrograms(gl: WebGLRenderer, carriers: readonly Material[]): CutDitherProgram[] {
  const programs: CutDitherProgram[] = [];
  for (const material of carriers) {
    programsOf(gl, material)?.forEach((program, key) => {
      if (key.includes(CUT_DITHER_DEFINE)) programs.push(program);
    });
  }
  return programs;
}

/**
 * Premier usage de ces programmes, à partir du rang `from`, sans rien dessiner : les requêtes GL
 * synchrones que three fait au premier dessin d'un programme (journal de liaison, emplacements des
 * uniformes et des attributs) sortent ainsi des images du premier fondu. Sans
 * KHR_parallel_shader_compile, `isReady` est vrai d'emblée et c'est ici qu'on attend la liaison.
 * Par tranches, comme `warmCutDither` : rend le rang du prochain programme (`programs.length` : fini).
 */
export function primeCutDither(programs: readonly CutDitherProgram[], from: number, budgetMs = Number.POSITIVE_INFINITY): number {
  const start = performance.now();
  let next = from;
  while (next < programs.length) {
    programs[next]?.getUniforms();
    next += 1;
    if (performance.now() - start > budgetMs) break;
  }
  return next;
}

/**
 * Vrai quand le pilote dit ces programmes compilés et liés (KHR_parallel_shader_compile). Sans
 * l'extension, toujours vrai : la liaison s'attend alors au premier usage (`primeCutDither`).
 */
export function programsReady(programs: Iterable<unknown> | null | undefined): boolean {
  if (!programs) return true;
  // Liste (renderer.info.programs, lue à chaque image par la mesure comparée) : sans itérateur.
  if (Array.isArray(programs)) {
    for (let i = 0; i < programs.length; i += 1) if (!isReady(programs[i])) return false;
    return true;
  }
  for (const program of programs) if (!isReady(program)) return false;
  return true;
}

function isReady(program: unknown): boolean {
  const ready = (program as Partial<CutDitherProgram> | null | undefined)?.isReady;
  return typeof ready !== 'function' || ready.call(program);
}
