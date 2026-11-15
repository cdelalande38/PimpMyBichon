// Coupe caméra, côté nuanceurs : chaque sommet du décor porte l'identifiant de son élément
// (attribut `pmbCut`, 0 : jamais masqué) ; un tableau d'uniformes donne la valeur de fondu de
// chaque élément, décidée côté processeur (src/scene/garage/cut.ts). Un maillage fusionné garde
// son unique appel de dessin : ses éléments s'effacent chacun de leur côté.
// - Masqué (0) : les sommets quittent le volume de vue, aucun fragment n'est produit.
// - En fondu : trame de points stable à l'écran (rejet de fragments) pour les matériaux opaques,
//   atténuation pour les additifs (cônes de lumière) et pour les voiles transparents (ombres de
//   contact : c'est leur opacité qui baisse).
// - La trame vit sous `#ifdef PMB_CUT_DITHER` : un `discard` présent dans un programme, même jamais
//   pris, peut priver une carte de téléphone de son test de profondeur précoce (LRZ sur Adreno) sur
//   tout ce que le programme dessine (soupçon après la chute de cadence sur le téléphone de
//   référence ; une carte de bureau n'en montre rien). Un matériau opaque ne porte ce define que
//   pendant qu'un de ses éléments est en fondu (règle pure : `ditherNeeds`, src/scene/garage/cut.ts ;
//   bascule et préchauffage : src/render/cutDither.ts).
// Les valeurs sont celles de la passe en cours : le reflet du sol voit la même coupe ; la sonde
// de réflexion, elle, voit tout (le crochet `onProbe` du garage remet tout à 1 le temps d'une capture).
// GLSL ES 3.00 sans extension : indexation dynamique d'un tableau d'uniformes et d'un vec4 dans
// le nuanceur de sommets ; le fragment ne reçoit qu'une valeur interpolée (identique sur tout
// l'élément).

export const CUT_ATTRIBUTE = 'pmbCut';
/** Define de la variante « trame » des matériaux opaques (seule à contenir le rejet de fragments). */
export const CUT_DITHER_DEFINE = 'PMB_CUT_DITHER';
/** Nombre d'identifiants (0 compris) : taille du tableau d'uniformes, quatre par vec4. */
export const CUT_CAPACITY = 128;
const CUT_SLOTS = CUT_CAPACITY / 4;

export interface CutUniforms {
  /** Fondu de chaque identifiant (1 : visible, 0 : masqué) ; l'indice 0 reste à 1. */
  pmbCutFade: { value: Float32Array };
}

export function createCutUniforms(): CutUniforms {
  return { pmbCutFade: { value: new Float32Array(CUT_CAPACITY).fill(1) } };
}

const VERTEX_HEAD = /* glsl */ `
attribute float pmbCut;
uniform vec4 pmbCutFade[ ${CUT_SLOTS} ];
varying float vPmbFade;`;

const VERTEX_BODY = /* glsl */ `
{
  int pmbSlot = clamp( int( pmbCut + 0.5 ), 0, ${CUT_CAPACITY - 1} );
  vPmbFade = pmbCutFade[ pmbSlot / 4 ][ pmbSlot % 4 ];
  // Masqué : tous les sommets de l'élément sortent du volume de vue, ses triangles disparaissent.
  if ( vPmbFade <= 0.0 ) gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );
}`;

const FRAGMENT_HEAD = /* glsl */ `
varying float vPmbFade;`;

const FRAGMENT_DITHER_HEAD = /* glsl */ `
#ifdef ${CUT_DITHER_DEFINE}
// Seuil de Bayer 4 × 4 au pixel : la trame reste fixe à l'écran pendant le fondu.
float pmbBayer( vec2 fragCoord ) {
  ivec2 q = ivec2( mod( fragCoord, 4.0 ) );
  int s = q.x ^ q.y;
  int b = ( ( s & 1 ) << 3 ) | ( ( q.y & 1 ) << 2 ) | ( ( ( s >> 1 ) & 1 ) << 1 ) | ( ( q.y >> 1 ) & 1 );
  return ( float( b ) + 0.5 ) / 16.0;
}
#endif`;

const FRAGMENT_DITHER = /* glsl */ `
#ifdef ${CUT_DITHER_DEFINE}
if ( vPmbFade < 1.0 && vPmbFade <= pmbBayer( gl_FragCoord.xy ) ) discard;
#endif`;

const FRAGMENT_ATTENUATE = /* glsl */ `
gl_FragColor.rgb *= vPmbFade;`;

const FRAGMENT_ATTENUATE_ALPHA = /* glsl */ `
gl_FragColor.a *= vPmbFade;`;

function inject(source: string, anchor: string, code: string): string {
  if (!source.includes(anchor)) throw new Error(`Coupe : repère ${anchor} introuvable`);
  return source.replace(anchor, `${anchor}\n${code}`);
}

/**
 * Ajoute la coupe aux sources d'un matériau de three (standard ou basique). `additive` : le
 * matériau s'ajoute à l'image (fondu par atténuation, après le brouillard) ; `alpha` : voile
 * transparent mélangé par son opacité (fondu par l'opacité) ; sinon, trame de points, compilée
 * seulement avec le define PMB_CUT_DITHER (sans lui, un élément est visible ou masqué, sans rejet).
 */
export function patchCutShader(shader: { vertexShader: string; fragmentShader: string }, additive: boolean, alpha = false): void {
  shader.vertexShader = inject(shader.vertexShader, '#include <common>', VERTEX_HEAD);
  shader.vertexShader = inject(shader.vertexShader, '#include <project_vertex>', VERTEX_BODY);
  shader.fragmentShader = inject(shader.fragmentShader, '#include <common>', FRAGMENT_HEAD);
  if (additive) shader.fragmentShader = inject(shader.fragmentShader, '#include <fog_fragment>', FRAGMENT_ATTENUATE);
  else if (alpha) shader.fragmentShader = inject(shader.fragmentShader, '#include <fog_fragment>', FRAGMENT_ATTENUATE_ALPHA);
  else {
    shader.fragmentShader = inject(shader.fragmentShader, '#include <common>', FRAGMENT_DITHER_HEAD);
    shader.fragmentShader = inject(shader.fragmentShader, '#include <clipping_planes_fragment>', FRAGMENT_DITHER);
  }
}
