// @ts-check
// Contrôle des cartes de sortie (npm run maps:check) : pour chaque dossier public/assets/maps/<id>/,
// le manifeste (MapManifest), la route produite (MapRoute, src/data/mapTypes.ts) et ses tronçons
// (un maillage fusion_<rôle> par rôle, matériau du même nom, triangles annoncés), les budgets du § 8
// (150 000 triangles pour cinq tronçons consécutifs, 25 000 par tronçon, 12 Mo par carte,
// donnees.json de 3 Mo au plus), la présence des crédits (manifeste et CREDITS.md), et l'absence de
// tout nom de commerce, de marque ou d'exploitant dans les fichiers de la carte (nomsInterdits).
//
//   node tools/maps/check.mjs [id…]

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { countGeometry, parseGlb } from '../lib/glb.mjs';
import { chausseeCouverte, resumerCouverture } from './couverture.mjs';
import { empreinteNom, MAP_SHOP_KINDS, normaliserNom } from './enrichissement.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const ROLES = ['chaussee', 'marquage', 'accotement', 'terrain', 'eau', 'mur', 'toit', 'fenetre', 'ouvrage', 'glissiere', 'voie'];
export const INSTANCES = ['arbre', 'lampadaire', 'balise', 'feu', 'palmier'];
export const BUDGETS = Object.freeze({
  trianglesVisibles: 150_000,
  tronconsVisibles: 5,
  trianglesParTroncon: 25_000,
  octetsCarte: 12_000_000,
  octetsDonnees: 3_000_000,
});

/** @param {unknown} v */
const nombre = (v) => typeof v === 'number' && Number.isFinite(v);
/** @param {unknown} v */
const triplet = (v) => Array.isArray(v) && v.length === 3 && v.every(nombre);

/**
 * Conformité d'un manifeste au type MapManifest.
 * @param {any} m @param {string} id
 */
export function validerManifeste(m, id) {
  /** @type {string[]} */
  const e = [];
  if (!m || typeof m !== 'object') return ['map.json : objet attendu'];
  if (m.id !== id) e.push(`map.json : id « ${m.id} » au lieu de « ${id} »`);
  if (typeof m.name !== 'string' || !m.name) e.push('map.json : name manquant');
  if (m.hint !== undefined && typeof m.hint !== 'string') e.push('map.json : hint doit être un texte');
  if (!['route', 'ville', 'circuit'].includes(m.kind)) e.push(`map.json : kind « ${m.kind} » inconnu`);
  if (!nombre(m.order)) e.push('map.json : order doit être un nombre');
  if (typeof m.route !== 'string' || !m.route) e.push('map.json : route manquant');
  if (!Array.isArray(m.credits) || m.credits.length === 0) e.push('map.json : credits vide (source et licence des données obligatoires)');
  else
    for (const c of m.credits)
      if (typeof c?.source !== 'string' || !c.source || typeof c?.licence !== 'string' || !c.licence || !/^\d{4}-\d{2}$/.test(c?.date ?? ''))
        e.push(`map.json : crédit incomplet (${JSON.stringify(c)})`);
  return e;
}

/**
 * Conformité d'une route au type MapRoute (sans les fichiers).
 * @param {any} r @param {string} id
 */
export function validerRoute(r, id) {
  /** @type {string[]} */
  const e = [];
  if (!r || typeof r !== 'object') return ['route : objet attendu'];
  if (r.format !== 'pmb-carte') e.push('route : format « pmb-carte » attendu');
  if (r.version !== 1) e.push('route : version 1 attendue');
  if (r.id !== id) e.push(`route : id « ${r.id} » au lieu de « ${id} »`);
  if (typeof r.loop !== 'boolean') e.push('route : loop booléen attendu');
  if (!nombre(r.step) || r.step <= 0) e.push('route : step positif attendu');
  if (!Array.isArray(r.rail) || r.rail.length % 3 !== 0 || r.rail.length < 6 || !r.rail.every(nombre)) e.push('route : rail, trois nombres par point');
  else if (Math.abs(r.length - (r.rail.length / 3 - 1) * r.step) > 1e-6) e.push(`route : length ${r.length} ≠ (points − 1) × step`);
  else {
    // Pas constant : chaque point à step mètres (3D) du précédent, à 1 % près (arrondi au centimètre).
    let pire = 0;
    for (let i = 3; i < r.rail.length; i += 3) {
      const d = Math.hypot(r.rail[i] - r.rail[i - 3], r.rail[i + 1] - r.rail[i - 2], r.rail[i + 2] - r.rail[i - 1]);
      pire = Math.max(pire, Math.abs(d - r.step));
    }
    if (pire > r.step * 0.01 + 0.02) e.push(`route : pas irrégulier (écart de ${pire.toFixed(3)} m)`);
  }
  if (!Array.isArray(r.sections) || r.sections.length === 0) e.push('route : sections vides');
  else {
    let s = 0;
    for (const x of r.sections) {
      if (Math.abs(x.from - s) > 1e-6) e.push(`route : section non jointive en ${x.from}`);
      if (!(x.to > x.from)) e.push(`route : section vide en ${x.from}`);
      if (!['sol', 'pont', 'tunnel'].includes(x.ground)) e.push(`route : ground « ${x.ground} »`);
      if (typeof x.urban !== 'boolean') e.push('route : urban booléen attendu');
      if (!Number.isInteger(x.lanes) || x.lanes < 1) e.push('route : lanes entier positif attendu');
      if (!nombre(x.width) || x.width <= 0) e.push('route : width positif attendu');
      if (x.speed !== undefined && (!Number.isInteger(x.speed) || x.speed < 5 || x.speed > 150)) e.push(`route : speed « ${x.speed} » (km/h, de 5 à 150)`);
      s = x.to;
    }
    if (Math.abs(s - r.length) > 1e-6) e.push(`route : sections jusqu'à ${s} au lieu de ${r.length}`);
  }
  if (!Array.isArray(r.chunks) || r.chunks.length === 0) e.push('route : aucun tronçon');
  else {
    let prev = 0;
    for (const c of r.chunks) {
      if (typeof c.file !== 'string') e.push('route : tronçon sans fichier');
      if (!(c.to > c.from) || c.from < prev - 1e-6) e.push(`route : tronçon ${c.file} hors d'ordre`);
      prev = c.from;
      if (!triplet(c.origin)) e.push(`route : ${c.file} origin`);
      if (!Array.isArray(c.box) || c.box.length !== 6 || !c.box.every(nombre) || c.box[0] > c.box[3] || c.box[1] > c.box[4] || c.box[2] > c.box[5]) e.push(`route : ${c.file} box`);
      if (!Number.isInteger(c.triangles)) e.push(`route : ${c.file} triangles`);
      for (const [k, v] of Object.entries(c.instances ?? {})) {
        if (!INSTANCES.includes(k)) e.push(`route : ${c.file} instance « ${k} » inconnue`);
        if (!Array.isArray(v) || v.length % 5 !== 0 || !v.every(nombre)) e.push(`route : ${c.file} instances ${k}, cinq nombres chacune`);
      }
      if (c.shops !== undefined) {
        const v = c.shops;
        if (!Array.isArray(v) || v.length % 5 !== 0 || !v.every(nombre)) e.push(`route : ${c.file} shops, cinq nombres chacun`);
        else for (let k = 4; k < v.length; k += 5) if (!Number.isInteger(v[k]) || v[k] < 0 || v[k] >= MAP_SHOP_KINDS.length) e.push(`route : ${c.file} genre de commerce ${v[k]} inconnu`);
      }
    }
    const fin = r.chunks[r.chunks.length - 1];
    if (r.chunks[0].from !== 0 || Math.abs(fin.to - r.length) > 1e-6) e.push('route : les tronçons ne couvrent pas le parcours');
  }
  if (!Array.isArray(r.starts) || r.starts.length === 0) e.push('route : aucun départ');
  else for (const s of r.starts) if (typeof s.id !== 'string' || typeof s.label !== 'string' || !nombre(s.at) || s.at < 0 || s.at > r.length) e.push(`route : départ ${JSON.stringify(s)}`);
  if (r.far !== null && (typeof r.far?.file !== 'string' || !Number.isInteger(r.far?.triangles))) e.push('route : far');
  return e;
}

/**
 * Maillages d'un GLB de tronçon : noms fusion_<rôle>, matériau du même nom, triangles.
 * @param {Uint8Array} bytes
 */
export function lireTroncon(bytes) {
  const p = parseGlb(bytes);
  if (!p.ok) return { erreurs: [p.message], triangles: 0 };
  const json = p.container.json;
  /** @type {string[]} */
  const erreurs = [];
  for (const m of json.meshes ?? []) {
    const role = String(m.name ?? '').replace(/^fusion_/, '');
    if (!String(m.name).startsWith('fusion_') || !ROLES.includes(role)) erreurs.push(`maillage « ${m.name} » : fusion_<rôle> attendu`);
    for (const prim of m.primitives ?? []) {
      const mat = json.materials?.[prim.material]?.name;
      if (mat !== role) erreurs.push(`maillage « ${m.name} » : matériau « ${mat} » au lieu de « ${role} »`);
    }
  }
  const noms = (json.meshes ?? []).map((/** @type {any} */ m) => m.name);
  if (new Set(noms).size !== noms.length) erreurs.push('un rôle porté par plusieurs maillages');
  return { erreurs, triangles: countGeometry(json).triangles };
}

/**
 * Maillages d'un GLB de tronçon dans le repère de la carte (positions + origine), pour la couverture.
 * @param {Uint8Array} bytes @param {number[]} origine
 * @returns {Array<{ role: string, positions: Float32Array, index: Uint32Array | Uint16Array | null }>}
 */
export function maillagesTroncon(bytes, origine) {
  const p = parseGlb(bytes);
  if (!p.ok) return [];
  const { json, bin } = p.container;
  const lire = (/** @type {number} */ a) => {
    const acc = json.accessors[a];
    const bv = json.bufferViews[acc.bufferView];
    const debut = bin.byteOffset + (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const n = acc.count * (acc.type === 'VEC3' ? 3 : 1);
    const octets = bin.buffer.slice(debut, debut + n * (acc.componentType === 5123 ? 2 : 4));
    if (acc.componentType === 5126) return new Float32Array(octets);
    return acc.componentType === 5123 ? new Uint16Array(octets) : new Uint32Array(octets);
  };
  return (json.meshes ?? []).flatMap((/** @type {any} */ m) =>
    (m.primitives ?? []).map((/** @type {any} */ prim) => {
      const positions = /** @type {Float32Array} */ (lire(prim.attributes.POSITION));
      for (let i = 0; i < positions.length; i += 3) for (let k = 0; k < 3; k += 1) positions[i + k] = (positions[i + k] ?? 0) + (origine[k] ?? 0);
      return { role: String(m.name).replace(/^fusion_/, ''), positions, index: prim.indices === undefined ? null : /** @type {Uint32Array | Uint16Array} */ (lire(prim.indices)) };
    }),
  );
}

/** Poids d'un dossier, récursif. @param {string} dir */
function poids(dir) {
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) n += e.isDirectory() ? poids(join(dir, e.name)) : statSync(join(dir, e.name)).size;
  return n;
}

/**
 * Chemins de donnees.json où un texte est permis : tout le reste (et toute la clé « osm ») ne porte
 * que des nombres. Les seuls textes libres sont les noms des rues et des plans d'eau (toponymes).
 */
const TEXTES_PERMIS = [/^(format|id|fournisseur|date)$/, /^sources\.\d+\.(source|licence|date)$/, /^repere\.note$/, /^axe\.troncons\.\d+\.(sol|nature|nom)$/, /^lacs\.\d+\.(nom|nature)$/, /^batiments\.\d+\.(n|u)$/];
/**
 * Aucun nom de commerce, de marque ou d'exploitant dans les fichiers versionnés ou produits d'une carte :
 * 1. structure : donnees.json ne porte de texte qu'aux chemins permis (TEXTES_PERMIS), la clé « osm »
 *    aucun ; route.json n'a de texte qu'aux formats, fichiers, sols, identifiants et noms de départ ;
 * 2. contenu : les empreintes des noms, marques et exploitants des commerces, hôtels, bureaux et
 *    artisans vus dans les réponses d'OpenStreetMap (brut/noms-commerces.json, notées par
 *    maps:fetch, qui n'écrit jamais les noms eux-mêmes) sont comparées à celles de toutes les suites
 *    de un à huit mots de carte.json, donnees.json, map.json et route.json ; une suite qui est aussi
 *    un toponyme (nom de rue, de plan d'eau, fiche écrite à la main) est permise.
 * @param {string} id @param {string} root
 * @returns {{ erreurs: string[], noms: number }}
 */
export function nomsInterdits(id, root) {
  /** @type {string[]} */
  const erreurs = [];
  const src = join(root, 'assets-src', 'maps', id);
  const pub = join(root, 'public', 'assets', 'maps', id);
  /** Textes des fichiers de la carte (valeurs des JSON : les nombres ne nomment personne). @type {string[]} */
  const textes = [];
  /** @param {unknown} v @param {string} chemin @param {(c: string) => boolean} permis @param {string} fichier */
  const parcourir = (v, chemin, permis, fichier) => {
    if (typeof v === 'string') {
      textes.push(v);
      if (!permis(chemin)) erreurs.push(`${fichier} : texte inattendu en ${chemin}`);
    } else if (Array.isArray(v)) v.forEach((x, i) => parcourir(x, chemin ? `${chemin}.${i}` : String(i), permis, fichier));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) parcourir(x, chemin ? `${chemin}.${k}` : k, permis, fichier);
  };
  /** Toponymes : noms de rues et de plans d'eau, fiche écrite à la main (un commerce peut porter le nom de sa rue). @type {string[]} */
  const toponymes = [];
  const fd = join(src, 'donnees.json');
  if (existsSync(fd)) {
    const d = JSON.parse(readFileSync(fd, 'utf8'));
    parcourir(d, '', (c) => TEXTES_PERMIS.some((r) => r.test(c)), 'donnees.json');
    for (const x of [...(d.axe?.troncons ?? []), ...(d.lacs ?? [])]) if (typeof x?.nom === 'string') toponymes.push(x.nom);
  }
  const fr = join(pub, 'route.json');
  if (existsSync(fr)) {
    parcourir(JSON.parse(readFileSync(fr, 'utf8')), '', (c) => /^(format|id)$|^chunks\.\d+\.file$|^far\.file$|^sections\.\d+\.ground$|^starts\.\d+\.(id|label)$/.test(c), 'route.json');
  }
  for (const f of [join(src, 'carte.json'), join(pub, 'map.json')]) if (existsSync(f)) parcourir(JSON.parse(readFileSync(f, 'utf8')), '', () => true, f);
  if (existsSync(join(src, 'carte.json'))) toponymes.push(readFileSync(join(src, 'carte.json'), 'utf8'));
  // Empreintes des noms de commerces notées au téléchargement (absentes sans réponses d'OpenStreetMap).
  const fe = join(src, 'brut', 'noms-commerces.json');
  /** @type {Set<string>} */
  const noms = new Set(existsSync(fe) ? JSON.parse(readFileSync(fe, 'utf8')) : []);
  if (noms.size) {
    /** Empreintes de toutes les suites de 1 à 8 mots d'un texte. @param {string} t */
    const suites = (t) => {
      /** @type {Map<string, string>} */
      const m = new Map();
      const mots = normaliserNom(t).split(' ').filter(Boolean);
      for (let i = 0; i < mots.length; i += 1)
        for (let n = 1; n <= 8 && i + n <= mots.length; n += 1) {
          const k = mots.slice(i, i + n).join(' ');
          if (k.length >= 4) m.set(empreinteNom(k), k);
        }
      return m;
    };
    const topo = suites(toponymes.join('\n'));
    for (const [e, k] of suites(textes.join('\n'))) if (noms.has(e) && !topo.has(e)) erreurs.push(`nom de commerce, de marque ou d'exploitant présent dans les fichiers de la carte : « ${k} »`);
  }
  return { erreurs, noms: noms.size };
}

/**
 * Contrôle complet d'une carte.
 * @param {string} id @param {{ root?: string }} [o]
 */
export function verifierCarte(id, o = {}) {
  const root = o.root ?? ROOT;
  const dir = join(root, 'public', 'assets', 'maps', id);
  /** @type {string[]} */
  const erreurs = [];
  /** @type {string[]} */
  const notes = [];
  const manifeste = JSON.parse(readFileSync(join(dir, 'map.json'), 'utf8'));
  erreurs.push(...validerManifeste(manifeste, id));
  const routeFile = join(dir, String(manifeste.route ?? 'route.json'));
  if (!existsSync(routeFile)) {
    erreurs.push(`${manifeste.route} absent : npm run maps:build`);
    return { erreurs, notes };
  }
  const r = JSON.parse(readFileSync(routeFile, 'utf8'));
  erreurs.push(...validerRoute(r, id));
  const tri = [];
  /** @type {ReturnType<typeof maillagesTroncon>} */
  const maillages = [];
  for (const c of r.chunks ?? []) {
    const f = join(dir, c.file);
    if (!existsSync(f)) {
      erreurs.push(`${c.file} absent`);
      tri.push(0);
      continue;
    }
    const octets = new Uint8Array(readFileSync(f));
    const t = lireTroncon(octets);
    maillages.push(...maillagesTroncon(octets, c.origin ?? [0, 0, 0]));
    erreurs.push(...t.erreurs.map((x) => `${c.file} : ${x}`));
    if (t.triangles !== c.triangles) erreurs.push(`${c.file} : ${t.triangles} triangles, ${c.triangles} annoncés`);
    if (t.triangles > BUDGETS.trianglesParTroncon) erreurs.push(`${c.file} : ${t.triangles} triangles, budget ${BUDGETS.trianglesParTroncon}`);
    tri.push(t.triangles);
  }
  let pire = 0;
  for (let i = 0; i < tri.length; i += 1) pire = Math.max(pire, tri.slice(i, i + BUDGETS.tronconsVisibles).reduce((s, v) => s + v, 0));
  if (pire > BUDGETS.trianglesVisibles) erreurs.push(`${BUDGETS.tronconsVisibles} tronçons consécutifs : ${pire} triangles, budget ${BUDGETS.trianglesVisibles}`);
  /** @type {ReturnType<typeof maillagesTroncon>} */
  let lointain = [];
  if (r.far) {
    const f = join(dir, r.far.file);
    if (!existsSync(f)) erreurs.push(`${r.far.file} absent`);
    else {
      const octets = new Uint8Array(readFileSync(f));
      const p = parseGlb(octets);
      if (!p.ok) erreurs.push(`${r.far.file} : ${p.message}`);
      else if (countGeometry(p.container.json).triangles !== r.far.triangles) erreurs.push(`${r.far.file} : triangles annoncés faux`);
      else lointain = maillagesTroncon(octets, [0, 0, 0]);
    }
  }
  // Chaussée couverte (hors tunnel déclaré) : terrain, bâtiment, ouvrage, autre portion de la route
  // ou relief lointain au-dessus de la chaussée. Aucun point toléré.
  if (Array.isArray(r.rail) && Array.isArray(r.sections)) {
    const cv = chausseeCouverte(r, maillages, lointain);
    if (cv.couverts.length) {
      const z = resumerCouverture(cv.couverts);
      erreurs.push(
        `chaussée couverte en ${cv.couverts.length} points sur ${cv.points} (${Object.entries(z.parRole).map(([k, v]) => `${k} ${v}`).join(', ')} ; jusqu'à ${z.dyMax.toFixed(2)} m ; vers ${z.zones.slice(0, 12).join(', ')} m)`,
      );
    }
  }
  const total = poids(dir);
  if (total > BUDGETS.octetsCarte) erreurs.push(`dossier de ${(total / 1e6).toFixed(2)} Mo, budget ${BUDGETS.octetsCarte / 1e6} Mo`);
  const donnees = join(root, 'assets-src', 'maps', id, 'donnees.json');
  if (existsSync(donnees) && statSync(donnees).size > BUDGETS.octetsDonnees) erreurs.push(`donnees.json de ${(statSync(donnees).size / 1e6).toFixed(2)} Mo, budget 3 Mo`);
  // Crédits : CREDITS.md doit couvrir les fichiers de la carte et citer la source de chaque crédit.
  const credits = existsSync(join(root, 'CREDITS.md')) ? readFileSync(join(root, 'CREDITS.md'), 'utf8') : '';
  if (!credits.includes('public/assets/maps/')) erreurs.push('CREDITS.md ne couvre pas public/assets/maps/');
  for (const c of manifeste.credits ?? []) {
    const cle = String(c.source ?? '').split(/[,(]/)[0]?.trim() ?? '';
    if (cle && !credits.includes(cle)) erreurs.push(`CREDITS.md ne cite pas « ${cle} »`);
  }
  const ni = nomsInterdits(id, root);
  erreurs.push(...ni.erreurs);
  if (ni.noms) notes.push(`${id} : ${ni.noms} empreintes de noms de commerces, marques ou exploitants d'OSM cherchées, aucune dans les fichiers de la carte`);
  notes.push(
    `${id} : ${(r.length / 1000).toFixed(2)} km, ${tri.length} tronçons, ${Math.max(...tri)} triangles au plus par tronçon, ${pire} pour ${BUDGETS.tronconsVisibles} consécutifs, ` +
      `lointain ${r.far?.triangles ?? 0}, ${(total / 1e6).toFixed(2)} Mo`,
  );
  return { erreurs, notes };
}

function main() {
  const base = join(ROOT, 'public', 'assets', 'maps');
  const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const ids = args.length ? args : existsSync(base) ? readdirSync(base).filter((d) => existsSync(join(base, d, 'map.json'))).sort() : [];
  if (ids.length === 0) {
    console.log('maps:check : aucune carte');
    return;
  }
  let n = 0;
  for (const id of ids) {
    const { erreurs, notes } = verifierCarte(id);
    for (const x of notes) console.log(`  ${x}`);
    for (const x of erreurs) console.error(`  ✗ ${id} : ${x}`);
    n += erreurs.length;
  }
  console.log(n ? `maps:check : ${n} erreur(s)` : `maps:check : ${ids.length} carte(s) conforme(s)`);
  if (n) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
