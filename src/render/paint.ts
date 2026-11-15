// Peinture de carrosserie multicouche (§ 8) : un seul MeshPhysicalMaterial, complété par
// onBeforeCompile et piloté par les finitions de src/data/finishes.ts.
//  - Base : teinte, métal, paillettes (normales perturbées par cellules, en repère monde).
//    Une paillette plus petite qu'un pixel ne scintille plus : elle se fond en rugosité,
//    comme à l'œil. Leur taille se règle en millimètres.
//  - Vernis (clearcoat) : léger grain de peau d'orange sur sa normale, Fresnel renforcé.
//  - Effets d'angle : candy (vernis teinté, plus profond sur les bords), caméléon (seconde
//    teinte sur les bords), nacré (irisation de three.js).
// Les réglages propres passent par des uniformes ; seuls le vernis et l'irisation de three.js,
// à 0 ou non, changent le programme (au plus 4 variantes, 3 avec les finitions actuelles,
// compilées d'avance dans l'état des passes réelles : programVariants, src/scene/bench/BenchCar.tsx).

import {
  Color,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  type Camera,
  type Material,
  type Object3D,
  type Scene,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from 'three';
import { FINISHES, type Finish } from '../data/finishes.ts';
import type { CutDitherProgram } from './cutDither.ts';

/** Couleur d'un métal nu, vers laquelle tire une finition peu teintée (chrome, fond de candy). */
const BARE_METAL = new Color('#e4e6ea');

interface PaintUniforms {
  pmbFlake: { value: number };
  pmbFlakeSize: { value: number };
  pmbPeel: { value: number };
  pmbFresnel: { value: number };
  pmbCandy: { value: number };
  pmbCandyColor: { value: Color };
  pmbFlip: { value: number };
  pmbFlipColor: { value: Color };
}

function createUniforms(): PaintUniforms {
  return {
    pmbFlake: { value: 0 },
    pmbFlakeSize: { value: 0.0005 },
    pmbPeel: { value: 0 },
    pmbFresnel: { value: 0 },
    pmbCandy: { value: 0 },
    pmbCandyColor: { value: new Color(1, 1, 1) },
    pmbFlip: { value: 0 },
    pmbFlipColor: { value: new Color(1, 1, 1) },
  };
}

const VERTEX_PARS = /* glsl */ `
varying vec3 vPmbWorld;
`;

const VERTEX_MAIN = /* glsl */ `
vPmbWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
`;

const FRAGMENT_PARS = /* glsl */ `
varying vec3 vPmbWorld;
uniform float pmbFlake;
uniform float pmbFlakeSize;
uniform float pmbPeel;
uniform float pmbFresnel;
uniform float pmbCandy;
uniform vec3 pmbCandyColor;
uniform float pmbFlip;
uniform vec3 pmbFlipColor;

vec3 pmbHash3( vec3 p ) {
  p = fract( p * vec3( 0.1031, 0.1030, 0.0973 ) );
  p += dot( p, p.yxz + 33.33 );
  return fract( ( p.xxy + p.yxx ) * p.zyx );
}

// Champ aléatoire lisse (bruit de valeur), composantes de -1 à 1.
vec3 pmbNoise3( vec3 p ) {
  vec3 i = floor( p );
  vec3 f = fract( p );
  vec3 u = f * f * ( 3.0 - 2.0 * f );
  vec3 a = mix( pmbHash3( i ), pmbHash3( i + vec3( 1.0, 0.0, 0.0 ) ), u.x );
  vec3 b = mix( pmbHash3( i + vec3( 0.0, 1.0, 0.0 ) ), pmbHash3( i + vec3( 1.0, 1.0, 0.0 ) ), u.x );
  vec3 c = mix( pmbHash3( i + vec3( 0.0, 0.0, 1.0 ) ), pmbHash3( i + vec3( 1.0, 0.0, 1.0 ) ), u.x );
  vec3 d = mix( pmbHash3( i + vec3( 0.0, 1.0, 1.0 ) ), pmbHash3( i + 1.0 ), u.x );
  return mix( mix( a, b, u.y ), mix( c, d, u.y ), u.z ) * 2.0 - 1.0;
}
`;

// Après les cartes de normales : couleur d'angle, paillettes, peau d'orange.
const FRAGMENT_SURFACE = /* glsl */ `
float pmbFacing = saturate( dot( normal, normalize( vViewPosition ) ) );

// Caméléon : la seconde teinte prend les bords.
diffuseColor.rgb = mix( diffuseColor.rgb, pmbFlipColor, pmbFlip * ( 1.0 - smoothstep( 0.18, 0.85, pmbFacing ) ) );

// Paillettes : une normale inclinée au hasard par cellule. Les cellules plus petites qu'un
// pixel sont regroupées (niveaux de détail fondus) et leur effet décroît comme une moyenne.
vec3 pmbCell = vPmbWorld / max( pmbFlakeSize, 1e-5 );
float pmbFootprint = max( length( dFdx( pmbCell ) ), length( dFdy( pmbCell ) ) );
float pmbLod = max( 0.0, log2( max( pmbFootprint, 1e-4 ) ) + 0.5 );
float pmbLod0 = floor( pmbLod );
vec3 pmbFlakeA = pmbHash3( floor( pmbCell / exp2( pmbLod0 ) ) );
vec3 pmbFlakeB = pmbHash3( floor( pmbCell / exp2( pmbLod0 + 1.0 ) ) + 17.0 );
vec3 pmbFlakeDir = mix( pmbFlakeA, pmbFlakeB, fract( pmbLod ) ) * 2.0 - 1.0;
float pmbResolved = sqrt( clamp( 1.0 / max( pmbFootprint, 1e-4 ), 0.0, 1.0 ) );
normal = normalize( normal + ( viewMatrix * vec4( pmbFlakeDir, 0.0 ) ).xyz * pmbFlake * mix( 0.06, 0.28, pmbResolved ) );
float pmbFlakeBlur = pmbFlake * ( 1.0 - pmbResolved ) * 0.22;
// Une paillette sur huit est un éclat d'alu nu, lisse comme un miroir : il renvoie la couleur
// de la lumière (argent sous le blanc, rouge ou bleu sous les LED) et ne brille que tourné vers
// une source. Trop fines pour être vues une à une, elles éclaircissent le reflet en moyenne.
float pmbSparkCell = step( 0.88, mix( pmbFlakeA.z, pmbFlakeB.z, fract( pmbLod ) ) );
float pmbSpark = pmbFlake * mix( 0.06, pmbSparkCell, pmbResolved );
diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.92 ), pmbSpark * 0.5 );
metalnessFactor = mix( metalnessFactor, 1.0, pmbSpark );
roughnessFactor = mix( roughnessFactor, 0.1, pmbFlake * pmbSparkCell * pmbResolved );

// Peau d'orange : ondulation douce de la normale du vernis, période d'environ 2 cm,
// effacée quand elle devient plus fine qu'un pixel (elle ne ferait que du bruit).
vec3 pmbPeelCell = vPmbWorld * 55.0;
float pmbPeelFootprint = max( length( dFdx( pmbPeelCell ) ), length( dFdy( pmbPeelCell ) ) );
float pmbPeelSeen = 1.0 - smoothstep( 0.35, 1.0, pmbPeelFootprint );
#ifdef USE_CLEARCOAT
  clearcoatNormal = normalize( clearcoatNormal + ( viewMatrix * vec4( pmbNoise3( pmbPeelCell ), 0.0 ) ).xyz * pmbPeel * 0.035 * pmbPeelSeen );
#endif
`;

// Après la mise en place du matériau : ce qui ne se voit plus devient de la rugosité.
const FRAGMENT_MATERIAL = /* glsl */ `
material.roughness = min( 1.0, material.roughness + pmbFlakeBlur );
#ifdef USE_CLEARCOAT
  material.clearcoatRoughness = min( 1.0, material.clearcoatRoughness + pmbPeel * 0.04 * ( 1.0 - pmbPeelSeen ) );
#endif
`;

// Candy : la base est filtrée par la teinte, deux fois (aller et retour), d'autant plus
// que le regard est rasant (chemin plus long dans le vernis).
const FRAGMENT_CANDY = /* glsl */ `
float pmbNV = saturate( dot( geometryNormal, geometryViewDir ) );
vec3 pmbAbsorb = pow( max( pmbCandyColor, vec3( 1e-3 ) ), vec3( 0.8 + 0.6 / max( pmbNV, 0.2 ) ) );
outgoingLight *= mix( vec3( 1.0 ), pmbAbsorb, pmbCandy );
`;

// Fresnel marqué : le vernis renvoie davantage l'environnement au ras de la caisse.
const FRAGMENT_FRESNEL = /* glsl */ `
outgoingLight += clearcoatSpecularIndirect * material.clearcoat * pmbFresnel * pow( 1.0 - dotNVcc, 3.0 );
`;

const ANCHORS = {
  vertexPars: '#include <common>',
  vertexMain: '#include <project_vertex>',
  fragmentPars: '#include <common>',
  surface: '#include <clearcoat_normal_fragment_maps>',
  material: '#include <lights_physical_fragment>',
  candy: 'vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;',
  fresnel:
    'outgoingLight = outgoingLight * ( 1.0 - material.clearcoat * Fcc ) + ( clearcoatSpecularDirect + clearcoatSpecularIndirect ) * material.clearcoat;',
} as const;

function insertAfter(source: string, anchor: string, code: string): string {
  if (!source.includes(anchor)) throw new Error(`Peinture : repère de shader introuvable (${anchor})`);
  return source.replace(anchor, `${anchor}\n${code}`);
}

/** Complète les shaders de MeshPhysicalMaterial. Exporté pour vérifier les repères (tests). */
export function patchPaintShader(shader: Pick<WebGLProgramParametersWithUniforms, 'vertexShader' | 'fragmentShader'>): void {
  let vertex = insertAfter(shader.vertexShader, ANCHORS.vertexPars, VERTEX_PARS);
  vertex = insertAfter(vertex, ANCHORS.vertexMain, VERTEX_MAIN);
  let fragment = insertAfter(shader.fragmentShader, ANCHORS.fragmentPars, FRAGMENT_PARS);
  fragment = insertAfter(fragment, ANCHORS.surface, FRAGMENT_SURFACE);
  fragment = insertAfter(fragment, ANCHORS.material, FRAGMENT_MATERIAL);
  fragment = insertAfter(fragment, ANCHORS.candy, FRAGMENT_CANDY);
  fragment = insertAfter(fragment, ANCHORS.fresnel, FRAGMENT_FRESNEL);
  shader.vertexShader = vertex;
  shader.fragmentShader = fragment;
}

function uniformsOf(material: MeshPhysicalMaterial): PaintUniforms {
  return material.userData.pmbPaint as PaintUniforms;
}

/**
 * Crée le matériau d'une zone peinte à partir de celui du modèle : on garde son nom et sa
 * carte de normales (joints, détails), on oublie sa couleur et ses textures de teinte.
 */
export function createPaintMaterial(source?: Material): MeshPhysicalMaterial {
  const material = new MeshPhysicalMaterial();
  if (source) {
    material.name = source.name;
    const normalMap = (source as Partial<MeshPhysicalMaterial>).normalMap ?? null;
    if (normalMap) {
      material.normalMap = normalMap;
      material.normalScale.copy((source as MeshPhysicalMaterial).normalScale);
    }
  }
  const uniforms = createUniforms();
  material.userData.pmbPaint = uniforms;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    patchPaintShader(shader);
  };
  material.customProgramCacheKey = () => 'pmb-peinture-1';
  return material;
}

/**
 * Une finition par programme de shader distinct : le vernis (clearcoat) et l'irisation, s'ils
 * passent de 0 à plus de 0, changent le programme. Sert à les compiler tous d'avance.
 */
export function programVariants<T extends Pick<Finish, 'clearcoat' | 'iridescence'>>(finishes: readonly T[]): T[] {
  const variants = new Map<string, T>();
  for (const item of finishes) {
    const key = `${item.clearcoat > 0}-${item.iridescence > 0}`;
    if (!variants.has(key)) variants.set(key, item);
  }
  return [...variants.values()];
}

/** Matériaux témoins : chaque variante du programme de peinture, pour chaque zone peinte. */
export interface PaintWitnesses {
  group: Group;
  materials: MeshPhysicalMaterial[];
  dispose: () => void;
}

/**
 * Témoins de chaque variante du programme de peinture (vernis oui/non × irisation oui/non), pour
 * chaque zone peinte de `root`, sur la géométrie d'une de ses pièces : la clé de programme dépend
 * aussi de la carte de normales de la zone et des attributs de la pièce. Ils gardent les programmes
 * en vie jusqu'à `dispose` ; la géométrie, empruntée, n'est pas libérée.
 */
export function paintWitnesses(root: Object3D, paints: readonly MeshPhysicalMaterial[]): PaintWitnesses {
  const group = new Group();
  const materials: MeshPhysicalMaterial[] = [];
  const variants = programVariants(FINISHES);
  for (const paint of paints) {
    let sample: Mesh | null = null;
    root.traverse((object) => {
      if (sample || !(object instanceof Mesh)) return;
      const used: readonly Material[] = Array.isArray(object.material) ? object.material : [object.material];
      if (used.includes(paint)) sample = object;
    });
    if (!sample) continue;
    const { geometry } = sample as Mesh;
    for (const item of variants) {
      const material = createPaintMaterial(paint);
      applyPaint(material, '#808080', item);
      group.add(new Mesh(geometry, material));
      materials.push(material);
    }
  }
  return {
    group,
    materials,
    dispose: () => {
      for (const material of materials) material.dispose();
    },
  };
}

/**
 * Compile sans rien dessiner les variantes de la peinture dans l'état des passes réelles : cible
 * de rendu non nulle liée (reflet du sol et scène du composeur rendent tous deux dans une cible :
 * espace de travail linéaire, sans tone mapping ; avec la cible nulle, la clé serait « sRGB + tone
 * mapping », jamais utilisée, et la variante se compilerait quand même au premier toucher d'une
 * finition, sur le fil principal), lumières, brume et environnement de `scene` tels qu'ils sont à
 * l'appel. Les programmes se compilent ensuite en tâche de fond (KHR_parallel_shader_compile) ;
 * une variante déjà compilée ne coûte rien.
 */
export function warmPaintPrograms(gl: WebGLRenderer, witnesses: PaintWitnesses, scene: Scene, camera: Camera, target: WebGLRenderTarget): void {
  const previous = gl.getRenderTarget();
  gl.setRenderTarget(target);
  try {
    gl.compile(witnesses.group, camera, scene);
  } finally {
    gl.setRenderTarget(previous);
  }
}

/**
 * Programmes des témoins, tels que `warmPaintPrograms` vient de les créer (ou de les retrouver) :
 * ceux qu'une zone peinte prendra au premier choix d'une finition, le programme de three étant
 * partagé par clé. À attendre (`programsReady`), puis à amorcer hors des images (`primeCutDither`).
 */
export function paintWitnessPrograms(gl: WebGLRenderer, witnesses: PaintWitnesses): CutDitherProgram[] {
  const programs = new Set<CutDitherProgram>();
  for (const material of witnesses.materials) {
    const program = (gl.properties.get(material) as { currentProgram?: CutDitherProgram } | undefined)?.currentProgram;
    if (program) programs.add(program);
  }
  return [...programs];
}

/** Couleur de base effective : la teinte choisie, mêlée au métal nu selon la finition. */
export function paintBaseColor(hex: string, finish: Pick<Finish, 'tint'>): Color {
  return BARE_METAL.clone().lerp(new Color(hex), Math.min(1, Math.max(0, finish.tint)));
}

/** Seconde teinte du caméléon : la teinte choisie, tournée sur la roue chromatique. */
export function flipColor(hex: string, finish: Pick<Finish, 'flipHue'>): Color {
  return new Color(hex).offsetHSL(finish.flipHue / 360, 0, 0);
}

/**
 * Réglages propres à une zone, par-dessus ceux de la finition : taille de paillette, en
 * millimètres, et seconde teinte du caméléon. Absents : ceux de la finition.
 */
export interface PaintOptions {
  flake?: number;
  color2?: string;
}

/** Applique une teinte et une finition à un matériau de carrosserie. */
export function applyPaint(
  material: MeshPhysicalMaterial,
  hex: string,
  finish: Finish,
  options?: PaintOptions,
): void {
  material.color.copy(paintBaseColor(hex, finish));
  material.metalness = finish.metalness;
  material.roughness = finish.roughness;
  material.clearcoat = finish.clearcoat;
  material.clearcoatRoughness = finish.clearcoatRoughness;
  material.iridescence = finish.iridescence;
  material.iridescenceIOR = finish.iridescenceIOR;
  // three 0.187 : la plage d'épaisseur passe par ces deux réglages (l'ancien tableau est déprécié).
  material.iridescenceThicknessMinimum = 100;
  material.iridescenceThicknessMaximum = finish.iridescenceThickness;
  material.envMapIntensity = finish.envMapIntensity;

  const uniforms = uniformsOf(material);
  uniforms.pmbFlake.value = finish.flake;
  uniforms.pmbFlakeSize.value = (options?.flake ?? finish.flakeSize) / 1000;
  uniforms.pmbPeel.value = finish.orangePeel;
  uniforms.pmbFresnel.value = finish.fresnel;
  uniforms.pmbCandy.value = finish.candy;
  uniforms.pmbCandyColor.value.set(hex);
  uniforms.pmbFlip.value = finish.flip;
  if (options?.color2 === undefined) uniforms.pmbFlipColor.value.copy(flipColor(hex, finish));
  else uniforms.pmbFlipColor.value.set(options.color2);
  // Passer d'une finition sans vernis ni irisation à l'inverse change le programme du shader.
  material.needsUpdate = true;
}

/** Réglages de peinture lus par le shader, pour les tests. */
export function paintUniforms(material: MeshPhysicalMaterial): Readonly<Record<string, number>> {
  const uniforms = uniformsOf(material);
  return {
    flake: uniforms.pmbFlake.value,
    flakeSize: uniforms.pmbFlakeSize.value,
    orangePeel: uniforms.pmbPeel.value,
    fresnel: uniforms.pmbFresnel.value,
    candy: uniforms.pmbCandy.value,
    flip: uniforms.pmbFlip.value,
  };
}
