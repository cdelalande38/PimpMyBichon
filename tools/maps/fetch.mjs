// @ts-check
// Téléchargement des données d'une carte : lit assets-src/maps/<id>/carte.json, interroge le
// fournisseur qu'elle déclare (fournisseurs/<nom>.mjs), garde chaque réponse brute dans
// assets-src/maps/<id>/brut/ (jamais versionné, jamais redemandé) et écrit
// assets-src/maps/<id>/donnees.json : axe du parcours, tronçons d'origine, routes voisines, lacs,
// bâtiments, arbres candidats, relief du couloir et relief lointain, dans le repère de la carte
// (contrat : src/data/mapTypes.ts), avec les sources, leurs licences et la date.
//
//   node tools/maps/fetch.mjs <id>        npm run maps:fetch -- <id>
//
// Réseau : une requête à la fois, 300 ms entre deux, nom de client générique, aucun identifiant.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { repereCarte } from './geo.mjs';
import { boite, dansPolygone, hasard, indexPolyligne, simplifier } from './geom2d.mjs';
import { chainer } from './trace.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SRC = join(ROOT, 'assets-src', 'maps');
const CLIENT = 'pmb-cartes/1';
const PAUSE = 300;

/** Fournisseurs connus : le nom vient de carte.json. */
const FOURNISSEURS = {
  ign: () => import('./fournisseurs/ign.mjs'),
};

/** @param {string} id */
export function lireCarte(id) {
  const file = join(SRC, id, 'carte.json');
  if (!existsSync(file)) throw new Error(`${relative(ROOT, file)} introuvable`);
  const carte = JSON.parse(readFileSync(file, 'utf8'));
  if (carte.id !== id) throw new Error(`${relative(ROOT, file)} : id « ${carte.id} » au lieu de « ${id} »`);
  return carte;
}

/** Lecteur avec cache disque : une réponse par adresse, jamais redemandée. @param {string} brut */
function lecteur(brut) {
  mkdirSync(brut, { recursive: true });
  let dernier = 0;
  const stats = { reseau: 0, cache: 0 };
  return {
    stats,
    /** @param {string} url */
    async lire(url) {
      const file = join(brut, `${createHash('sha1').update(url).digest('hex').slice(0, 20)}.json`);
      if (existsSync(file)) {
        stats.cache += 1;
        return JSON.parse(readFileSync(file, 'utf8'));
      }
      const attente = dernier + PAUSE - Date.now();
      if (attente > 0) await new Promise((r) => setTimeout(r, attente));
      for (let essai = 1; ; essai += 1) {
        try {
          const res = await fetch(url, { headers: { 'User-Agent': CLIENT, Accept: 'application/json' } });
          const texte = await res.text();
          dernier = Date.now();
          if (!res.ok) throw new Error(`HTTP ${res.status} : ${texte.slice(0, 200)}`);
          const json = JSON.parse(texte);
          writeFileSync(file, texte);
          stats.reseau += 1;
          if (stats.reseau % 25 === 0) process.stdout.write(`  … ${stats.reseau} requêtes\n`);
          return json;
        } catch (error) {
          dernier = Date.now();
          if (essai >= 3) throw error;
          await new Promise((r) => setTimeout(r, 2000 * essai));
        }
      }
    },
  };
}

/** @param {number} v @param {number} [n] */
const arr = (v, n = 2) => Math.round(v * 10 ** n) / 10 ** n;

/**
 * @param {string} id
 */
export async function fetchMap(id) {
  const carte = lireCarte(id);
  const charge = FOURNISSEURS[/** @type {keyof typeof FOURNISSEURS} */ (carte.fournisseur)];
  if (!charge) throw new Error(`fournisseur « ${carte.fournisseur} » inconnu (connus : ${Object.keys(FOURNISSEURS).join(', ')})`);
  const fournisseur = (await charge()).default;
  const proj = fournisseur.projection;
  const ctx = lecteur(join(SRC, id, 'brut'));
  // Altitudes déjà connues, point par point (brut/altitudes.json) : un parcours retouché ne
  // redemande que les points nouveaux, même si les lots de requêtes ne tombent plus pareil.
  const fichierPoints = join(SRC, id, 'brut', 'altitudes.json');
  /** @type {Record<string, number>} */
  const connus = existsSync(fichierPoints) ? JSON.parse(readFileSync(fichierPoints, 'utf8')) : {};
  /** @param {Array<[number, number]>} pts */
  const altitudes = async (pts) => {
    const cle = (/** @type {[number, number]} */ p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
    const vus = new Set();
    const manquants = pts.filter((p) => {
      const k = cle(p);
      if (k in connus || vus.has(k)) return false;
      vus.add(k);
      return true;
    });
    if (manquants.length) {
      const z = await fournisseur.altitudes(ctx, manquants);
      manquants.forEach((p, i) => (connus[cle(p)] = z[i] ?? 0));
      writeFileSync(fichierPoints, JSON.stringify(connus));
    }
    return pts.map((p) => connus[cle(p)] ?? 0);
  };
  const e = carte.emprise;
  /** @type {[number, number, number, number]} */
  const emprise = [e.lonMin, e.latMin, e.lonMax, e.latMax];

  // 1. Contrôle de la projection locale contre le service.
  const verif = await fournisseur.verifierProjection(ctx, emprise, carte.route);
  console.log(`projection : écart ${verif.ecart.toFixed(3)} m sur ${verif.points} points`);
  if (verif.ecart > 0.5) throw new Error(`projection : écart de ${verif.ecart.toFixed(2)} m, conversion fausse`);

  // 2. La route numérotée, chaînée du départ à l'arrivée.
  const aretes = await fournisseur.routeNumerotee(ctx, emprise, carte.route);
  const dep = proj.forward(carte.depart.lon, carte.depart.lat);
  const arr2 = proj.forward(carte.arrivee.lon, carte.arrivee.lat);
  const ch = chainer(aretes, dep, arr2);
  const p0 = /** @type {number[]} */ (ch.points[0]);
  const rep = repereCarte(proj, [p0[0] ?? 0, p0[1] ?? 0, p0[2] ?? 0]);
  const axe = ch.points.map((p) => rep.versCarte(p[0] ?? 0, p[1] ?? 0, p[2] ?? 0));
  console.log(`${carte.route} : ${aretes.length} tronçons dans l'emprise, parcours de ${(ch.longueur / 1000).toFixed(2)} km en ${ch.troncons.length} tronçons`);
  const index = indexPolyligne(axe, { ix: 0, iz: 2, cellule: 100 });
  const dl = carte.couloir.demiLargeur;
  const pas = carte.couloir.pasRelief;

  // 3. Emprises de requête le long du couloir (une tous les 1,5 km), en longitude et latitude.
  /** @type {Array<[number, number, number, number]>} */
  const tuiles = [];
  for (let i0 = 0; i0 < axe.length - 1; ) {
    let L = 0;
    let i1 = i0;
    while (i1 < axe.length - 1 && L < 1500) {
      const a = /** @type {number[]} */ (axe[i1]);
      const b = /** @type {number[]} */ (axe[i1 + 1]);
      L += Math.hypot((b[0] ?? 0) - (a[0] ?? 0), (b[2] ?? 0) - (a[2] ?? 0));
      i1 += 1;
    }
    const seg = axe.slice(i0, i1 + 1);
    const m = dl + 40;
    const xs = seg.map((p) => p[0] ?? 0);
    const zs = seg.map((p) => p[2] ?? 0);
    const coins = [
      [Math.min(...xs) - m, Math.min(...zs) - m],
      [Math.max(...xs) + m, Math.max(...zs) + m],
      [Math.min(...xs) - m, Math.max(...zs) + m],
      [Math.max(...xs) + m, Math.min(...zs) - m],
    ].map(([X, Z]) => proj.inverse(...rep.versProjete(X ?? 0, Z ?? 0)));
    tuiles.push([Math.min(...coins.map((c) => c[0])), Math.min(...coins.map((c) => c[1])), Math.max(...coins.map((c) => c[0])), Math.max(...coins.map((c) => c[1]))]);
    i0 = i1;
  }
  console.log(`couloir : ${tuiles.length} emprises de requête`);

  /** @template T @param {T[]} liste @param {(t: T) => string} cleDe */
  const uniques = (liste, cleDe) => {
    const vus = new Set();
    return liste.filter((t) => {
      const k = cleDe(t);
      if (vus.has(k)) return false;
      vus.add(k);
      return true;
    });
  };
  /** @param {number[]} p projeté → [X, Z] */
  const plan = (p) => {
    const c = rep.versCarte(p[0] ?? 0, p[1] ?? 0, 0);
    return [arr(c[0], 1), arr(c[2], 1)];
  };

  const routesBrutes = [];
  const batBruts = [];
  const zonesBrutes = [];
  const haiesBrutes = [];
  for (const t of tuiles) {
    routesBrutes.push(...(await fournisseur.routes(ctx, t)));
    batBruts.push(...(await fournisseur.batiments(ctx, t)));
    const v = await fournisseur.vegetation(ctx, t);
    zonesBrutes.push(...v.zones);
    haiesBrutes.push(...v.haies);
  }
  const eauxBrutes = await fournisseur.eaux(ctx, emprise);

  // 4. Routes voisines : hors parcours, parties à moins de dl + 20 m de l'axe.
  const surParcours = new Set(ch.troncons.map((t) => t.id));
  /** @type {Array<{ largeur: number, importance: number, points: number[] }>} */
  const voisines = [];
  for (const r of uniques(routesBrutes, (r) => `${r.id}|${r.points.length}|${r.points[0]}`)) {
    if (surParcours.has(r.id) || r.sol === 'tunnel') continue;
    /** @type {number[][]} */
    let run = [];
    const flush = () => {
      if (run.length >= 2) voisines.push({ largeur: r.largeur ?? (r.importance <= 3 ? 6 : r.importance === 4 ? 5 : 4), importance: r.importance, points: run.flat() });
      run = [];
    };
    for (const p of r.points) {
      const c = rep.versCarte(p[0] ?? 0, p[1] ?? 0, p[2] ?? 0);
      if (index.proche(c[0], c[2], dl + 20).d <= dl + 20) run.push([arr(c[0], 1), arr(c[1], 2), arr(c[2], 1)]);
      else flush();
    }
    flush();
  }

  // 5. Bâtiments du couloir.
  const batiments = [];
  for (const b of uniques(batBruts, (b) => `${b.id}|${b.anneau.length}`)) {
    let anneau = b.anneau.map(plan);
    if (!anneau.some((p) => index.proche(p[0] ?? 0, p[1] ?? 0, dl + 10).d <= dl + 10)) continue;
    const f = /** @type {number[]} */ (anneau[0]);
    const l = /** @type {number[]} */ (anneau[anneau.length - 1]);
    if (f[0] === l[0] && f[1] === l[1]) anneau = anneau.slice(0, -1);
    anneau = simplifier([...anneau, /** @type {number[]} */ (anneau[0])], 0.3).slice(0, -1);
    if (anneau.length < 3) continue;
    batiments.push({
      h: b.hauteur !== null ? arr(b.hauteur, 1) : null,
      e: b.etages,
      z: b.zSol !== null ? arr(b.zSol - (p0[2] ?? 0), 2) : null,
      n: b.nature,
      u: b.usage,
      a: anneau.flat(),
    });
  }

  // 6. Lacs et plans d'eau à moins de 3 km du parcours (et non des bassins de quelques mètres) ;
  //    leur altitude vient du relief (le terrain nu est plat sur l'eau), plus bas.
  const lacs = [];
  for (const l of uniques(eauxBrutes, (l) => `${l.id}|${l.anneaux[0]?.length}`)) {
    const anneaux = l.anneaux.map((a) => simplifier(a.map(plan), 1)).filter((a) => a.length >= 4);
    if (anneaux.length === 0) continue;
    const bx = boite(anneaux);
    if ((bx[2] - bx[0]) * (bx[3] - bx[1]) < 400) continue;
    if (!anneaux[0]?.some((p) => index.proche(p[0] ?? 0, p[1] ?? 0, 3000).d <= 3000)) continue;
    lacs.push({ nom: l.nom, nature: l.nature, y: l.altitude === null ? NaN : arr(l.altitude - (p0[2] ?? 0), 2), anneaux, b: bx });
  }

  // 7. Arbres candidats : grille de 7 m tirée au hasard (déterministe) dans la végétation du couloir,
  //    et un arbre tous les 6 m le long des haies. Code : 0 feuillus, 1 conifères, 2 mixte et autres.
  const zones = uniques(zonesBrutes, (z) => `${z.id}|${z.anneaux[0]?.length}`)
    .filter((z) => !/vigne/i.test(z.nature))
    .map((z) => {
      const anneaux = z.anneaux.map((a) => a.map(plan));
      return { anneaux, b: boite(anneaux), t: /conif/i.test(z.nature) ? 1 : /feuill|peupl|verger/i.test(z.nature) ? 0 : 2 };
    });
  const arbres = [];
  const bx = boite([axe.map((p) => [p[0] ?? 0, p[2] ?? 0])]);
  const G = 7;
  for (let gz = Math.floor((bx[1] - dl) / G); gz <= Math.ceil((bx[3] + dl) / G); gz += 1)
    for (let gx = Math.floor((bx[0] - dl) / G); gx <= Math.ceil((bx[2] + dl) / G); gx += 1) {
      const x = (gx + hasard(gx, gz)) * G;
      const z = (gz + hasard(gz + 7919, gx)) * G;
      if (index.proche(x, z, dl).d > dl) continue;
      const zone = zones.find((zn) => x >= zn.b[0] && x <= zn.b[2] && z >= zn.b[1] && z <= zn.b[3] && dansPolygone(x, z, zn.anneaux));
      if (zone) arbres.push(arr(x, 1), arr(z, 1), zone.t);
    }
  for (const h of uniques(haiesBrutes, (h) => `${h.id}|${h.points.length}`)) {
    const pts = h.points.map(plan);
    let reste = 0;
    for (let i = 1; i < pts.length; i += 1) {
      const a = /** @type {number[]} */ (pts[i - 1]);
      const b = /** @type {number[]} */ (pts[i]);
      const L = Math.hypot((b[0] ?? 0) - (a[0] ?? 0), (b[1] ?? 0) - (a[1] ?? 0));
      for (let t = reste; t < L; t += 6) {
        const x = (a[0] ?? 0) + (((b[0] ?? 0) - (a[0] ?? 0)) * t) / L;
        const z = (a[1] ?? 0) + (((b[1] ?? 0) - (a[1] ?? 0)) * t) / L;
        if (index.proche(x, z, dl).d <= dl) arbres.push(arr(x, 1), arr(z, 1), 0);
        reste = t + 6 - L;
      }
    }
  }

  // 8. Relief du couloir : grille de `pas` mètres dans le repère de la carte, limitée aux nœuds à
  //    moins de dl + 2 pas de l'axe, rangée par lignes en suites continues.
  const gx0 = Math.floor((bx[0] - dl - 2 * pas) / pas);
  const gx1 = Math.ceil((bx[2] + dl + 2 * pas) / pas);
  const gz0 = Math.floor((bx[1] - dl - 2 * pas) / pas);
  const gz1 = Math.ceil((bx[3] + dl + 2 * pas) / pas);
  /** @type {Array<[number, number, number]>} ligne, colonne de début, longueur */
  const suites = [];
  /** @type {Array<[number, number]>} */
  const ptsCouloir = [];
  for (let j = gz0; j <= gz1; j += 1) {
    /** @type {number | null} */
    let debut = null;
    for (let i = gx0; i <= gx1 + 1; i += 1) {
      const dedans = i <= gx1 && index.proche(i * pas, j * pas, dl + 2 * pas).d <= dl + 2 * pas;
      if (dedans) {
        if (debut === null) debut = i;
        ptsCouloir.push(proj.inverse(...rep.versProjete(i * pas, j * pas)));
      } else if (debut !== null) {
        suites.push([j, debut, i - debut]);
        debut = null;
      }
    }
  }
  console.log(`relief du couloir : ${ptsCouloir.length} points`);
  const zCouloir = await altitudes(ptsCouloir);

  // 9. Relief lointain : deux grilles régulières (proche, fine ; loin, large) autour du parcours.
  /** @param {{ pas: number, marge: number }} g */
  const grille = async (g) => {
    const i0 = Math.floor((bx[0] - g.marge) / g.pas);
    const i1 = Math.ceil((bx[2] + g.marge) / g.pas);
    const j0 = Math.floor((bx[1] - g.marge) / g.pas);
    const j1 = Math.ceil((bx[3] + g.marge) / g.pas);
    /** @type {Array<[number, number]>} */
    const pts = [];
    for (let j = j0; j <= j1; j += 1) for (let i = i0; i <= i1; i += 1) pts.push(proj.inverse(...rep.versProjete(i * g.pas, j * g.pas)));
    const z = await altitudes(pts);
    return { pas: g.pas, i0, j0, nx: i1 - i0 + 1, nz: j1 - j0 + 1, dm: z.map((v) => Math.round((v - (p0[2] ?? 0)) * 10)) };
  };
  const lointainProche = await grille(carte.lointain.proche);
  const lointainLoin = await grille(carte.lointain.loin);

  // Altitude des plans d'eau : médiane des nœuds des grilles de relief tombant dans l'eau ; à défaut,
  // quelques points demandés au centre de l'emprise du plan d'eau.
  for (const l of lacs) {
    if (!Number.isNaN(l.y)) continue;
    /** @type {number[]} */
    const vals = [];
    let k = 0;
    for (const [j, i0, n] of suites)
      for (let t = 0; t < n; t += 1, k += 1) {
        const x = (i0 + t) * pas;
        const z = j * pas;
        if (x >= l.b[0] && x <= l.b[2] && z >= l.b[1] && z <= l.b[3] && dansPolygone(x, z, l.anneaux)) vals.push((zCouloir[k] ?? 0) - (p0[2] ?? 0));
      }
    const g = lointainProche;
    for (let j = 0; j < g.nz; j += 1)
      for (let i = 0; i < g.nx; i += 1) {
        const x = (g.i0 + i) * g.pas;
        const z = (g.j0 + j) * g.pas;
        if (x >= l.b[0] && x <= l.b[2] && z >= l.b[1] && z <= l.b[3] && dansPolygone(x, z, l.anneaux)) vals.push((g.dm[j * g.nx + i] ?? 0) / 10);
      }
    if (vals.length < 3) {
      /** @type {Array<[number, number]>} */
      const pts = [];
      for (let a = 1; a <= 5; a += 1)
        for (let b = 1; b <= 5; b += 1) {
          const x = l.b[0] + ((l.b[2] - l.b[0]) * a) / 6;
          const z = l.b[1] + ((l.b[3] - l.b[1]) * b) / 6;
          if (dansPolygone(x, z, l.anneaux)) pts.push(proj.inverse(...rep.versProjete(x, z)));
        }
      for (const v of await altitudes(pts)) vals.push(v - (p0[2] ?? 0));
    }
    vals.sort((a, b) => a - b);
    l.y = arr(vals[Math.floor(vals.length / 2)] ?? 0, 2);
  }
  const lacsSortie = lacs.map((l) => ({ nom: l.nom, nature: l.nature, y: l.y, anneaux: l.anneaux.map((a) => a.flat()) }));

  const date = new Date().toISOString().slice(0, 7);
  const donnees = {
    format: 'pmb-carte-donnees',
    version: 1,
    id,
    fournisseur: fournisseur.nom,
    date,
    sources: fournisseur.credits(date),
    repere: {
      note: 'mètres ; X vers l’est, Y vers le haut, Z vers le sud ; origine au départ du parcours, à son altitude',
      origineProjetee: [arr(p0[0] ?? 0, 2), arr(p0[1] ?? 0, 2)],
      altitude: arr(p0[2] ?? 0, 2),
      echelle: arr(rep.k, 8),
      verificationProjection: arr(verif.ecart, 3),
    },
    axe: {
      points: axe.flatMap((p) => [arr(p[0], 2), arr(p[1], 2), arr(p[2], 2)]),
      rang: ch.rang,
      troncons: ch.troncons.map((t) => ({ largeur: t.largeur, voies: t.voies, sol: t.sol, urbain: t.urbain, nature: t.nature, importance: t.importance })),
    },
    voisines,
    lacs: lacsSortie,
    batiments,
    arbres,
    couloir: { pas, suites, dm: zCouloir.map((v) => Math.round((v - (p0[2] ?? 0)) * 10)) },
    lointain: { proche: lointainProche, loin: lointainLoin },
  };
  const out = join(SRC, id, 'donnees.json');
  const texte = `${JSON.stringify(donnees)}\n`;
  writeFileSync(out, texte);
  console.log(
    `${id} : ${batiments.length} bâtiments, ${lacs.length} plans d'eau (${lacs.map((l) => `${l.nom || '?'} ${(l.y + (p0[2] ?? 0)).toFixed(1)} m`).join(', ')}), ${voisines.length} routes voisines, ` +
      `${arbres.length / 3} arbres candidats · ${(texte.length / 1e6).toFixed(2)} Mo · réseau ${ctx.stats.reseau} requêtes, cache ${ctx.stats.cache}`,
  );
  console.log(`  → ${relative(ROOT, out)}`);
}

async function main() {
  const id = process.argv.slice(2).find((a) => !a.startsWith('-'));
  if (!id || !/^[a-z0-9-]+$/.test(id)) {
    console.error('usage : npm run maps:fetch -- <id>   (dossier assets-src/maps/<id>/ avec carte.json)');
    process.exitCode = 2;
    return;
  }
  await fetchMap(id);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
