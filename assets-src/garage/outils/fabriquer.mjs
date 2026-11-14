#!/usr/bin/env node
// Fabrique les SVG du garage à partir des modules de `oeuvres/`, puis les contrôle.
//
//   node assets-src/garage/outils/fabriquer.mjs                      écrit les SVG à côté de `outils/`
//   node assets-src/garage/outils/fabriquer.mjs --planche <dossier>  rend aussi la planche de contrôle
//   node assets-src/garage/outils/fabriquer.mjs --essais <dossier>   rend chaque fichier en grand
//
// L'écriture des SVG n'a aucune dépendance ; la planche et les essais passent par sharp.
// Contrôles faits à chaque passage : 40 ko au plus, viewBox présent, aucun texte ni police, aucune
// image, aucun lien autre qu'interne, aucun identifiant en double. Code de sortie 1 au premier échec.

import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ICI = dirname(fileURLToPath(import.meta.url));
const SORTIE = resolve(ICI, '..');
const POIDS_MAX = 40 * 1024;
const FOND = '#14121d';
const CARTE = '#1d1a2a';

function option(nom) {
  const i = process.argv.indexOf(nom);
  return i > 0 ? process.argv[i + 1] : undefined;
}

function controler(texte) {
  const soucis = [];
  const poids = Buffer.byteLength(texte);
  if (poids > POIDS_MAX) soucis.push(`poids ${(poids / 1024).toFixed(1)} ko au-dessus de 40 ko`);
  if (!/<svg[^>]*\sviewBox="0 0 [\d.]+ [\d.]+"/.test(texte)) soucis.push('viewBox absent');
  if (/<text[\s>]|<tspan|font-family|@font-face/.test(texte)) soucis.push('texte ou police');
  if (/<image[\s>]|<foreignObject|<script/.test(texte)) soucis.push('image, objet étranger ou script');
  const liens = [...texte.matchAll(/(?:href|src)="([^"]*)"/g)].map((m) => m[1]).filter((v) => !v.startsWith('#'));
  if (liens.length) soucis.push(`lien externe : ${liens[0]}`);
  if (/url\((?!#)/.test(texte)) soucis.push('url() externe');
  const ids = [...texte.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const double = ids.find((v, i) => ids.indexOf(v) !== i);
  if (double) soucis.push(`identifiant en double : ${double}`);
  if (/NaN|undefined|Infinity/.test(texte)) soucis.push('valeur non numérique dans le fichier');
  return { poids, soucis };
}

// --- Fabrication --------------------------------------------------------------------------------

const oeuvres = [];
for (const nom of readdirSync(join(ICI, 'oeuvres')).filter((n) => n.endsWith('.mjs')).sort()) {
  const module = await import(pathToFileURL(join(ICI, 'oeuvres', nom)).href);
  oeuvres.push(...module.default);
}
oeuvres.sort((a, b) => a.ordre - b.ordre);

let echec = false;
const faits = [];
for (const o of oeuvres) {
  try {
    const texte = o.dessin();
    const { poids, soucis } = controler(texte);
    writeFileSync(join(SORTIE, o.fichier), texte);
    const vb = texte.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
    faits.push({ ...o, texte, poids, vb: vb ? `${vb[1]} × ${vb[2]}` : '?' });
    console.log(`${soucis.length ? 'ÉCHEC' : 'ok   '} ${o.fichier.padEnd(28)} ${(poids / 1024).toFixed(1).padStart(5)} ko  ${soucis.join(' ; ')}`);
    if (soucis.length) echec = true;
  } catch (erreur) {
    echec = true;
    console.log(`ÉCHEC ${o.fichier} : ${erreur.stack}`);
  }
}

// --- Rendus de contrôle -----------------------------------------------------------------------

/** Aperçu d'une enseigne avec une lueur simulée : il n'entre pas dans le fichier. */
async function avecLueur(sharp, texte, largeur) {
  const net = await sharp(Buffer.from(texte)).resize({ width: largeur }).png().toBuffer();
  const { width, height } = await sharp(net).metadata();
  const blanc = texte.replace(/stroke="#[0-9a-f]{6}"/g, 'stroke="#ffffff"').replace(/stroke-width="\d+"/, 'stroke-width="5"');
  const coeur = await sharp(Buffer.from(blanc)).resize({ width: largeur }).png().toBuffer();
  const proche = await sharp(net).blur(3.5).png().toBuffer();
  const loin = await sharp(net).blur(11).png().toBuffer();
  return sharp({ create: { width, height, channels: 4, background: '#0a0911' } })
    .composite([
      { input: loin, blend: 'screen' },
      { input: loin, blend: 'screen' },
      { input: proche, blend: 'screen' },
      { input: net },
      { input: coeur, blend: 'screen' },
    ])
    .png()
    .toBuffer();
}

async function planche(dossier, largeur, colonnes) {
  const sharp = (await import('sharp')).default;
  const marge = 28;
  const legende = 46;
  const entete = 70;
  const tuiles = [];
  for (const o of faits) {
    const png = await sharp(Buffer.from(o.texte)).resize({ width: largeur }).png().toBuffer();
    const { height } = await sharp(png).metadata();
    tuiles.push({ png, h: height, l1: o.fichier, l2: `viewBox ${o.vb} · ${(o.poids / 1024).toFixed(1)} ko` });
    if (o.lueur) {
      const apercu = await avecLueur(sharp, o.texte, largeur);
      tuiles.push({ png: apercu, h: height, l1: `${o.fichier} + lueur`, l2: "aperçu : la lueur vient de l'app, pas du fichier" });
    }
  }
  const hauteurs = Array.from({ length: colonnes }, () => entete);
  const poses = tuiles.map((t) => {
    const c = hauteurs.indexOf(Math.min(...hauteurs));
    const pose = { ...t, x: marge + c * (largeur + marge), y: hauteurs[c] };
    hauteurs[c] += t.h + legende + marge;
    return pose;
  });
  const W = colonnes * largeur + (colonnes + 1) * marge;
  const H = Math.max(...hauteurs);
  const police = 'font-family="DejaVu Sans, Liberation Sans, Arial, sans-serif"';
  const habillage = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`,
    `<text x="${marge}" y="32" ${police} font-size="19" font-weight="bold" fill="#ece9f4">PimpMyBichon · œuvres du garage · planche de contrôle</text>`,
    `<text x="${marge}" y="54" ${police} font-size="13" fill="#9d98b5">Chaque fichier rendu à ${largeur} px de large, la taille à laquelle on le verra dans la scène.</text>`,
    ...poses.map(
      (p) =>
        `<rect x="${p.x}" y="${p.y}" width="${largeur}" height="${p.h}" fill="${CARTE}"/>` +
        `<text x="${p.x}" y="${p.y + p.h + 18}" ${police} font-size="13" font-weight="bold" fill="#ece9f4">${p.l1}</text>` +
        `<text x="${p.x}" y="${p.y + p.h + 35}" ${police} font-size="11" fill="#9d98b5">${p.l2}</text>`,
    ),
    '</svg>',
  ].join('');
  mkdirSync(dossier, { recursive: true });
  const cible = join(dossier, 'planche.png');
  await sharp({ create: { width: W, height: H, channels: 4, background: FOND } })
    .composite([{ input: Buffer.from(habillage) }, ...poses.map((p) => ({ input: p.png, left: p.x, top: p.y }))])
    .png({ compressionLevel: 9 })
    .toFile(cible);
  console.log(`planche : ${cible} (${W} × ${H})`);
}

async function essais(dossier, largeur) {
  const sharp = (await import('sharp')).default;
  mkdirSync(dossier, { recursive: true });
  for (const o of faits) {
    await sharp(Buffer.from(o.texte))
      .resize({ width: largeur })
      .flatten({ background: CARTE })
      .png()
      .toFile(join(dossier, o.fichier.replace(/\.svg$/, '.png')));
  }
  console.log(`essais : ${faits.length} rendus de ${largeur} px dans ${dossier}`);
}

const dossierPlanche = option('--planche');
if (dossierPlanche) await planche(resolve(dossierPlanche), Number(option('--largeur') ?? 256), Number(option('--colonnes') ?? 5));
const dossierEssais = option('--essais');
if (dossierEssais) await essais(resolve(dossierEssais), Number(option('--grand') ?? 768));

process.exit(echec ? 1 : 0);
