// Matières du sol et du bâti de la sortie : textures fabriquées par tools/maps/matieres.mjs
// (dans un dossier de public/assets/maps/ qui porte matieres.json, produites par « npm run maps:build », jamais téléchargées
// ailleurs), lues par les nuanceurs de materiaux.ts en coordonnées du monde, de la route ou de la
// façade. Aucune UV dans les tronçons : rien ne s'ajoute au poids des cartes.
//
// Chaque texture RGBA porte : relief (normale x, y dans R, G), détail de l'albédo (B : × 0,4 + 1,2 B)
// et rugosité (A : × 0,6 + 0,8 A ; pour le terrain, détail de la terre et de la roche). Elle est
// lue à deux échelles, tournées l'une par rapport à l'autre et mêlées par un bruit lent, contre la
// répétition ; le relief s'efface quand il devient plus fin qu'un pixel.
//
// Sans les fichiers (carte non fabriquée, hors ligne), une texture neutre d'un pixel les remplace :
// les matières gardent leur teinte, sans détail ni relief.

import { DataTexture, RepeatWrapping, TextureLoader, Vector4, type Texture } from 'three';
import { MAPS_DIR } from '../../data/maps.ts';
import type { MapMaterialRole } from '../../data/mapTypes.ts';

export type SolId = 'enrobe' | 'dalles' | 'terrain' | 'enduit';
const SOL_IDS: readonly SolId[] = ['enrobe', 'dalles', 'terrain', 'enduit'];

/** Ce que tools/maps/matieres.mjs écrit dans matieres.json. */
export interface SolManifest {
  format: 'pmb-matieres';
  version: 1;
  matieres: Array<{ id: string; fichier: string; taille: number; tuile: number; repere: string }>;
}

// Le dossier des matières est le seul de public/assets/maps/ à porter matieres.json (aucun nom de
// dossier écrit ici : il vient du chemin trouvé).
const FOUND = import.meta.glob<unknown>('../../../public/assets/maps/*/matieres.json', { eager: true, import: 'default' });
const FOUND_KEY = Object.keys(FOUND)[0] ?? '';
/** Dossier des matières sous public/assets/maps/ (fabriqué par tools/maps/matieres.mjs). */
export const SOL_DIR = /\/maps\/([^/]+)\/matieres\.json$/.exec(FOUND_KEY)?.[1] ?? '';

/** Manifeste des matières s'il est bien formé, sinon `null` (textures neutres). */
export function readSolManifest(raw: unknown): SolManifest | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Partial<SolManifest>;
  if (m.format !== 'pmb-matieres' || m.version !== 1 || !Array.isArray(m.matieres)) return null;
  const ok = m.matieres.every((x) => x && typeof x.id === 'string' && typeof x.fichier === 'string' && /^[a-z0-9_-]+\.(webp|png)$/.test(x.fichier) && x.tuile > 0);
  return ok ? (m as SolManifest) : null;
}

const MANIFEST = SOL_DIR ? readSolManifest(FOUND[FOUND_KEY]) : null;

/** Usage d'une texture par une matière (définition PMB_SOL_<usage> du nuanceur). */
export type SolUse = 'route' | 'marquage' | 'bord' | 'terrain' | 'facade' | 'toit';

/** Rôles des tronçons qui lisent les textures, et comment ; les autres gardent leur teinte unie. */
export const SOL_ROLES: Readonly<Partial<Record<MapMaterialRole, SolUse>>> = {
  chaussee: 'route',
  voie: 'route',
  marquage: 'marquage',
  accotement: 'bord',
  terrain: 'terrain',
  mur: 'facade',
  toit: 'toit',
};

export interface SolUniforms {
  pmbSolEnrobe: { value: Texture };
  pmbSolDalles: { value: Texture };
  pmbSolTerrain: { value: Texture };
  pmbSolEnduit: { value: Texture };
  /** Tuiles (m) : enrobé, dalles, terrain, enduit. */
  pmbSolTuiles: { value: Vector4 };
}

function neutral(): DataTexture {
  const t = new DataTexture(new Uint8Array([128, 128, 128, 128]), 1, 1);
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

/** Uniformes partagés par toutes les matières de la sortie (une seule copie des textures). */
export const SOL_UNIFORMS: SolUniforms = {
  pmbSolEnrobe: { value: neutral() },
  pmbSolDalles: { value: neutral() },
  pmbSolTerrain: { value: neutral() },
  pmbSolEnduit: { value: neutral() },
  pmbSolTuiles: { value: new Vector4(1.5, 1, 4, 2) },
};

const KEYS: Record<SolId, keyof Omit<SolUniforms, 'pmbSolTuiles'>> = {
  enrobe: 'pmbSolEnrobe',
  dalles: 'pmbSolDalles',
  terrain: 'pmbSolTerrain',
  enduit: 'pmbSolEnduit',
};

let requested = false;
const loaded: Texture[] = [];

/**
 * Charge les textures une fois (au premier passage dans la sortie) ; tant qu'elles manquent, la
 * texture neutre les remplace. Rien ne se passe hors d'un navigateur (tests) ni sans manifeste.
 */
export function loadSolTextures(base: string = import.meta.env.BASE_URL): void {
  if (requested || !MANIFEST || typeof document === 'undefined') return;
  requested = true;
  const loader = new TextureLoader();
  for (const m of MANIFEST.matieres) {
    if (!(SOL_IDS as readonly string[]).includes(m.id)) continue;
    const id = m.id as SolId;
    SOL_UNIFORMS.pmbSolTuiles.value.setComponent(SOL_IDS.indexOf(id), m.tuile);
    loader.load(
      `${base}${MAPS_DIR}${SOL_DIR}/${m.fichier}`,
      (t) => {
        t.wrapS = RepeatWrapping;
        t.wrapT = RepeatWrapping;
        t.anisotropy = 4;
        t.needsUpdate = true;
        SOL_UNIFORMS[KEYS[id]].value = t;
        loaded.push(t);
      },
      undefined,
      () => {
        // Fichier absent ou illisible : la texture neutre reste, la sortie roule sans détail.
      },
    );
  }
}

/**
 * Libère la mémoire des textures sur le processeur graphique (fin de la sortie). Les images restent :
 * three les renvoie à la prochaine sortie, sans nouveau téléchargement.
 */
export function releaseSolTextures(): void {
  for (const t of loaded) t.dispose();
}

/**
 * Définitions du nuanceur pour un usage. Sans manifeste (matières non fabriquées), aucune : les
 * matières gardent exactement leur dessin d'avant les textures, sans lecture inutile.
 */
export function solDefines(use: SolUse, manifest: SolManifest | null = MANIFEST): Record<string, string> {
  return manifest ? { PMB_SOL: '', [`PMB_SOL_${use.toUpperCase()}`]: '' } : {};
}

/** En-tête du nuanceur de fragment (après celui de materiaux.ts : pmbNoise, pmbHash, pmbBox). */
export const SOL_HEAD = /* glsl */ `
// Relief ajouté à la normale (repère du monde), grain de l'enrobé (reflets cassés), creux (flaques) :
// neutres pour les matières sans texture.
vec3 pmbSolN = vec3( 0.0 );
float pmbSolGrain = 0.5;
float pmbSolLow = 0.5;
#ifdef PMB_SOL
uniform sampler2D pmbSolEnrobe;
uniform sampler2D pmbSolDalles;
uniform sampler2D pmbSolTerrain;
uniform sampler2D pmbSolEnduit;
uniform vec4 pmbSolTuiles;
// Deux lectures (tuile, puis tuile × 2,6 tournée de 37°), mêlées par un bruit lent : pas de motif
// répété visible au loin. Le relief de la seconde est ramené dans le repère de la première.
vec4 pmbSolTex( sampler2D t, vec2 p, float tile ) {
  vec4 a = texture( t, p / tile );
  vec2 r = mat2( 0.8, 0.6, -0.6, 0.8 ) * p;
  vec4 b = texture( t, r / ( tile * 2.6 ) + 0.37 );
  vec2 bn = mat2( 0.8, -0.6, 0.6, 0.8 ) * ( b.xy - 0.5 ) + 0.5;
  b.xy = bn;
  float m = 0.25 + 0.5 * pmbNoise( p * ( 0.21 / tile ) + 5.3 );
  return mix( a, b, m );
}
#endif
// Plein jour : une herbe n'est jamais d'une seule teinte (pré fauché, herbe sèche, coins plus verts),
// à plusieurs échelles (80, 22 et 5 m) ; facteur autour de 1, pesé par pmbJour à l'usage.
vec3 pmbDayGrass( vec2 q ) {
  float m1 = pmbNoise( q * 0.012 + 7.7 );
  float m2 = pmbNoise( q * 0.045 + 2.9 );
  float m3 = pmbNoise( q * 0.19 + 11.3 );
  vec3 tint = mix( vec3( 0.84, 1.0, 0.92 ), vec3( 1.22, 1.08, 0.7 ), smoothstep( 0.3, 0.78, m1 * 0.6 + m2 * 0.4 ) );
  float m4 = pmbNoise( q * 0.7 + 3.3 );
  return tint * ( 0.78 + 0.3 * m2 + 0.18 * m3 + 0.12 * m4 );
}
`;

/**
 * Surface : posée dans materiaux.ts juste avant la pluie (qui assombrit et lisse ce qu'elle trouve).
 * Variables de materiaux.ts disponibles : diffuseColor, roughnessFactor, pmbUrban, pmbMoonKeep,
 * vPmbWorld, vPmbNormal, vPmbRoad (rôles de la route).
 */
export const SOL_SURFACE = /* glsl */ `
#ifdef PMB_SOL
{
  vec2 q = vPmbWorld.xz;
  float px = length( fwidth( q ) );
  // Relief effacé quand la texture devient plus fine qu'un pixel (sinon il scintille au loin).
  float reliefNear = 1.0 - smoothstep( 0.008, 0.035, px );
  #if defined( PMB_SOL_ROUTE ) || defined( PMB_SOL_MARQUAGE )
  {
    // Enrobé : granulats, liant, fissures fines ; en repère du monde pour que le marquage, posé
    // dessus, en suive exactement le grain.
    vec4 t = pmbSolTex( pmbSolEnrobe, q, pmbSolTuiles.x );
    // De jour, le grain se lit au soleil : moins de contraste (granulats moins noirs, moins blancs).
    float mul = mix( 0.4 + 1.2 * t.b, 0.7 + 0.6 * t.b, pmbJour );
    pmbSolGrain = t.b;
    pmbSolLow = clamp( 0.5 - ( t.b - 0.5 ) * 2.0, 0.0, 1.0 );
    vec2 n = ( t.xy - 0.5 ) * 2.0;
    #ifdef PMB_SOL_ROUTE
    diffuseColor.rgb *= mul;
    roughnessFactor = clamp( roughnessFactor * ( 0.6 + 0.8 * t.a ), 0.04, 1.0 );
    pmbSolN = vec3( n.x, 0.0, n.y ) * 0.3 * reliefNear;
    #ifdef PMB_ROAD
    {
      // Rapiéçages : un rectangle d'enrobé plus récent (plus sombre, plus lisse) sur une voie, tous
      // les 30 m environ au hasard, bordé d'un joint de bitume brillant ; fissure pontée qui serpente
      // près de l'axe (bitume noir et lisse), par endroits.
      float s = vPmbRoad.x;
      float lat = vPmbRoad.y;
      float hw = max( abs( vPmbRoad.w ), 1.5 );
      float w = max( px, 0.01 );
      float cell = floor( s / 31.0 );
      float h = pmbHash( vec2( cell, 17.0 ) );
      if ( h > 0.55 ) {
        float s0 = ( cell + 0.1 + 0.45 * fract( h * 7.3 ) ) * 31.0;
        float len = 2.0 + 9.0 * fract( h * 13.1 );
        float a = fract( h * 3.7 ) > 0.5 ? 0.25 + 0.6 * fract( h * 5.1 ) : -hw + 0.3 + 0.4 * fract( h * 5.1 );
        float b = a + 1.0 + ( hw * 0.55 ) * fract( h * 9.7 );
        float inP = pmbBox( s, s0, s0 + len, w ) * pmbBox( lat, a, b, w );
        float ring = clamp( pmbBox( s, s0 - 0.06, s0 + len + 0.06, w ) * pmbBox( lat, a - 0.06, b + 0.06, w ) - inP, 0.0, 1.0 );
        float age = fract( h * 21.7 );
        diffuseColor.rgb *= mix( 1.0, age > 0.5 ? 0.68 : 1.18, inP );
        roughnessFactor = mix( roughnessFactor, roughnessFactor * ( age > 0.5 ? 0.82 : 1.05 ), inP );
        diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * 0.35, ring );
        roughnessFactor = mix( roughnessFactor, 0.3, ring );
      }
      float path = 0.45 * sin( s * 0.043 + 1.7 ) + 0.25 * sin( s * 0.117 ) + 0.4;
      float run = smoothstep( 0.6, 0.66, pmbNoise( vec2( s * 0.025, 3.1 ) ) );
      float sealed = pmbBox( lat, path - 0.012, path + 0.012, w ) * min( 1.0, 0.012 / w ) * run * step( 2.6, hw );
      diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * 0.5, sealed );
      roughnessFactor = mix( roughnessFactor, 0.3, sealed );
    }
    #endif
    #else
    {
      // Marquage : la peinture part d'abord sur la tête des granulats (le gris de l'enrobé
      // reparaît), par plaques ; elle en suit le relief.
      float worn = smoothstep( 0.35, 0.75, pmbNoise( q * 0.8 + 4.0 ) ) * smoothstep( 0.52, 0.7, t.b );
      diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.085, 0.085, 0.09 ) * mul, worn * 0.85 );
      roughnessFactor = mix( roughnessFactor, 0.85, worn );
      pmbSolN = vec3( n.x, 0.0, n.y ) * 0.2 * reliefNear;
    }
    #endif
  }
  #endif
  #if defined( PMB_SOL_BORD ) && defined( PMB_ROAD )
  {
    // Bas-côté : en agglomération, bordure de béton puis dalles du trottoir (repère de la route : les
    // joints suivent la rue) ; ailleurs, gravillons au bord de l'enrobé puis herbe sur terre.
    float lat = abs( vPmbRoad.y );
    float hw = max( abs( vPmbRoad.w ), 1.5 );
    float d = lat - hw;
    float w = max( px, 0.01 );
    vec3 base = diffuseColor.rgb;
    float lum = dot( base, vec3( 0.3, 0.59, 0.11 ) );
    if ( pmbUrban > 0.5 ) {
      vec2 rp = vec2( vPmbRoad.x, lat );
      vec4 t = texture( pmbSolDalles, rp / pmbSolTuiles.y );
      float curb = pmbBox( d, -0.2, 0.22, w );
      // Teinte propre à chaque dalle (la texture n'en porte que quatre) et salissures à grande échelle.
      float slab = pmbHash( floor( rp / ( pmbSolTuiles.y * 0.5 ) ) + 7.0 );
      vec3 concrete = vec3( lum ) * vec3( 2.3, 2.3, 2.35 ) * ( 0.88 + 0.24 * slab ) * ( 0.85 + 0.3 * pmbNoise( q * 0.3 ) );
      diffuseColor.rgb = mix( concrete * ( 0.4 + 1.2 * t.b ), concrete * 1.25, curb );
      roughnessFactor = clamp( roughnessFactor * mix( 0.6 + 0.8 * t.a, 0.85, curb ), 0.04, 1.0 );
      vec2 n = ( t.xy - 0.5 ) * 2.0 * ( 1.0 - curb );
      // Repère de la route : l'abscisse avance à peu près le long de x ou z selon le cap ; le relief
      // des dalles est léger, on le pose dans le plan sans tourner (aucune direction privilégiée).
      pmbSolN = vec3( n.x, 0.0, n.y ) * 0.35 * reliefNear;
      pmbSolLow = 1.0 - t.b;
    } else {
      vec4 t = pmbSolTex( pmbSolTerrain, q, pmbSolTuiles.z );
      vec4 g = texture( pmbSolEnrobe, q / pmbSolTuiles.x );
      float gravel = 1.0 - smoothstep( 0.25, 0.9, d + 0.35 * ( pmbNoise( q * 1.7 ) - 0.5 ) );
      vec3 gravelC = vec3( lum ) * vec3( 1.9, 1.8, 1.65 ) * ( 0.4 + 1.2 * g.b );
      vec3 grassC = base * ( 0.4 + 1.2 * t.b );
      if ( pmbJour > 0.0 ) grassC = mix( grassC, grassC * pmbDayGrass( q ), pmbJour );
      diffuseColor.rgb = mix( grassC, gravelC, gravel );
      vec2 n = ( mix( t.xy, g.xy, gravel ) - 0.5 ) * 2.0;
      pmbSolN = vec3( n.x, 0.0, n.y ) * 0.4 * reliefNear;
    }
  }
  #endif
  #ifdef PMB_SOL_TERRAIN
  {
    // Terrain : herbe, terre par plaques et sur les pentes moyennes, roche sur les fortes pentes
    // (projection par l'axe dominant de la normale, sans étirer la roche sur les talus).
    vec3 nW = normalize( vPmbNormal );
    float up = nW.y;
    vec2 pr = abs( nW.x ) > abs( nW.z ) ? vPmbWorld.zy : vPmbWorld.xy;
    vec4 tf = pmbSolTex( pmbSolTerrain, q, pmbSolTuiles.z );
    vec4 ts = up < 0.86 ? texture( pmbSolTerrain, pr / pmbSolTuiles.z ) : tf;
    float steep = smoothstep( 0.86, 0.7, up );
    vec4 t = mix( tf, ts, steep );
    float macro = pmbNoise( q * 0.035 + 1.3 ) * 0.65 + pmbNoise( q * 0.11 ) * 0.35;
    float rockM = smoothstep( 0.8, 0.62, up + 0.12 * ( macro - 0.5 ) );
    float dirtM = max( smoothstep( 0.68, 0.85, macro ) * 0.55, smoothstep( 0.88, 0.78, up ) ) * ( 1.0 - rockM );
    vec3 base = diffuseColor.rgb;
    float lum = dot( base, vec3( 0.3, 0.59, 0.11 ) );
    vec3 grass = base * mix( vec3( 1.12, 1.0, 0.8 ), vec3( 0.9, 1.04, 1.15 ), macro ) * ( 0.4 + 1.2 * t.b );
    if ( pmbJour > 0.0 ) grass = mix( grass, grass * pmbDayGrass( q ), pmbJour );
    vec3 dirt = vec3( lum ) * vec3( 1.45, 1.1, 0.78 ) * ( 0.4 + 1.2 * t.a );
    vec3 rock = vec3( lum ) * vec3( 1.5, 1.48, 1.45 ) * ( 0.4 + 1.2 * t.a );
    diffuseColor.rgb = mix( mix( grass, dirt, dirtM ), rock, rockM );
    roughnessFactor = mix( roughnessFactor, 0.82, rockM );
    vec2 n = ( t.xy - 0.5 ) * 2.0 * mix( 0.35, 1.0, rockM );
    pmbSolN = mix( vec3( n.x, 0.0, n.y ), abs( nW.x ) > abs( nW.z ) ? vec3( 0.0, n.y, n.x ) : vec3( n.x, n.y, 0.0 ), steep ) * 0.6 * reliefNear;
  }
  #endif
}
#endif
`;

/**
 * Façades : posé dans le dessin des façades de materiaux.ts, après la teinte du bâtiment
 * (variables : nW, base, hgt, seed, y). Enduit lu dans le plan du mur ; d'un bâtiment à l'autre,
 * grain plus ou moins gros, teinte décalée, soubassement plus sombre et salissures sous l'égout.
 */
export const SOL_FACADE = /* glsl */ `
#ifdef PMB_SOL_FACADE
if ( abs( nW.y ) < 0.6 ) {
  vec2 tdS = normalize( vec2( -nW.z, nW.x ) + vec2( 1e-4 ) );
  vec2 p = vec2( dot( vPmbWorld.xz, tdS ), vPmbWorld.y );
  float k = fract( seed * 11.7 );
  float tile = pmbSolTuiles.w * ( 0.6 + 0.9 * k );
  vec4 t = texture( pmbSolEnduit, p / tile + seed * 3.1 );
  float px = max( length( fwidth( p ) ), 1e-4 );
  float reliefNear = 1.0 - smoothstep( 0.01, 0.04, px );
  vec3 jitter = 1.0 + 0.1 * vec3( fract( seed * 3.7 ) - 0.5, fract( seed * 5.3 ) - 0.5, fract( seed * 9.1 ) - 0.5 );
  // De jour, l'enduit au soleil : grain moins contrasté (sinon la façade paraît tachée).
  diffuseColor.rgb *= jitter * mix( 2.0 * t.b, 0.78 + 0.44 * t.b, pmbJour );
  // Soubassement (60 cm, éclaboussures) et coulures sous la corniche.
  float plinth = 1.0 - smoothstep( 0.45, 0.7, y + 0.15 * t.b );
  float streak = smoothstep( hgt - 2.2, hgt - 0.6, y ) * smoothstep( 0.45, 0.8, pmbNoise( vec2( p.x * 1.3, 0.0 ) + seed * 7.0 ) );
  diffuseColor.rgb *= ( 1.0 - 0.3 * plinth ) * ( 1.0 - 0.3 * streak );
  if ( pmbJour > 0.0 ) {
    // Plein jour : soubassement de pierre ou d'enduit plus sombre (90 cm), propre à chaque bâtiment.
    float socle = ( 1.0 - smoothstep( 0.85, 0.92, y + 0.04 * t.b ) ) * step( 0.35, fract( seed * 2.9 ) );
    vec3 stone = mix( vec3( 0.62, 0.6, 0.57 ), vec3( 0.5, 0.47, 0.44 ), fract( seed * 6.1 ) );
    diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * stone * ( 0.85 + 0.3 * t.b ), socle * pmbJour );
  }
  roughnessFactor = clamp( roughnessFactor * ( 0.6 + 0.8 * t.a ), 0.04, 1.0 );
  vec2 n = ( t.xy - 0.5 ) * 2.0 * ( 0.4 + 0.6 * k );
  pmbSolN = ( vec3( tdS.x, 0.0, tdS.y ) * n.x + vec3( 0.0, 1.0, 0.0 ) * n.y ) * 0.5 * reliefNear;
}
#endif
`;

/**
 * Toits : posé à la fin du dessin des toits de materiaux.ts (variables : nW, q, fine, hb). Tuiles
 * plus ou moins cuites une à une, salissures (enduit lu à grande échelle) et mousse par plaques.
 */
export const SOL_TOIT = /* glsl */ `
#ifdef PMB_SOL_TOIT
{
  vec4 t = texture( pmbSolEnduit, q / ( pmbSolTuiles.w * 2.5 ) + hb );
  float slope = step( nW.y, 0.96 );
  vec2 hdS = normalize( vec2( -nW.z, nW.x ) + vec2( 1e-4 ) );
  float rowS = floor( vPmbWorld.y * 3.2 );
  float tid = pmbHash( vec2( floor( dot( q, hdS ) * 2.4 + rowS * 0.5 ), rowS ) );
  diffuseColor.rgb *= mix( 1.0, 0.84 + 0.32 * tid, fine * slope );
  diffuseColor.rgb *= 0.55 + 0.9 * t.b;
  float moss = smoothstep( 0.58, 0.8, pmbNoise( q * 0.35 + hb * 9.0 ) ) * slope;
  diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.7, 0.88, 0.55 ), moss * 0.6 );
  roughnessFactor = clamp( roughnessFactor * ( 0.6 + 0.8 * t.a ), 0.04, 1.0 );
}
#endif
`;

/**
 * Relief : ajouté à la normale de three (repère de la vue) juste après ses cartes de normales ; le
 * même relief sert aux reflets calculés de materiaux.ts (phares, lampadaires).
 */
export const SOL_NORMAL = /* glsl */ `
#ifdef PMB_SOL
normal = normalize( normal + ( viewMatrix * vec4( pmbSolN, 0.0 ) ).xyz );
#endif
`;
