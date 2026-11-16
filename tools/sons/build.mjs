#!/usr/bin/env node
// @ts-check
// npm run sons:build : fabrique les sons de l'app d'après assets-src/sons/choix.json et le dossier
// privé .private-assets/sons/ (jamais versionné). Pour chaque famille :
//   moteurs   → public/assets/audio/engines/<famille>/<emplacement>.ogg + engine.json
//   bruitages → public/assets/audio/sfx/<famille>/<emplacement>.ogg + sfx.json
// puis src/audio/engine/familles.json (familles qui ont des sons, crédits à citer) et la section
// « Sons » de CREDITS.md. Les fichiers fabriqués sont versionnés : la CI n'a pas le dossier privé.
// Sans dossier privé (ou sans ffmpeg), la commande ne fait rien et le dit ; le build de l'app n'en
// dépend pas.
//
// Options : --famille <id> (une seule famille), --verifier (contrôle le choix sans rien écrire).

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../lib/cli.mjs';
import { CHOIX, DOSSIER_PRIVE, licence, ligneCredit, lireCatalogue, lireChoix, privePresent, problemesChoix } from './catalogue.mjs';
import { FAMILLES } from './emplacements.mjs';
import { fabriquer } from './fabriquer.mjs';
import { echantillonsDecodes, encoder, ffmpegPresent, TAUX } from './signal.mjs';

const args = process.argv.slice(2);
const seule = args.includes('--famille') ? args[args.indexOf('--famille') + 1] : null;
const verifier = args.includes('--verifier');

const SORTIE_MOTEURS = join(REPO_ROOT, 'public', 'assets', 'audio', 'engines');
const SORTIE_BRUITAGES = join(REPO_ROOT, 'public', 'assets', 'audio', 'sfx');
const INDEX_APP = join(REPO_ROOT, 'src', 'audio', 'engine', 'familles.json');
const CREDITS = join(REPO_ROOT, 'CREDITS.md');
/** Familles de bruitages lues par l'app à chaque sortie (src/audio/sfx/route.ts) : index toujours présent. */
const INDEX_TOUJOURS = new Set(['route']);
const DEBUT_SECTION = '<!-- sons:debut (écrit par npm run sons:build) -->';
const FIN_SECTION = '<!-- sons:fin -->';

if (!privePresent()) {
  console.log(`sons:build : dossier privé absent (${DOSSIER_PRIVE}) : rien à fabriquer. Les sons versionnés restent tels quels.`);
  process.exit(0);
}
if (!ffmpegPresent()) {
  console.log('sons:build : ffmpeg absent : rien à fabriquer. Les sons versionnés restent tels quels.');
  process.exit(0);
}

const choix = lireChoix();
const problemes = problemesChoix(choix);
if (problemes.length > 0) {
  console.error(`sons:build : ${CHOIX} refusé :\n  - ${problemes.join('\n  - ')}`);
  process.exit(1);
}
const { parId } = lireCatalogue(new Set(choix.accordRequis ?? []));
for (const [idFamille, contenu] of Object.entries(choix.familles)) {
  for (const [idEmpl, retenues] of Object.entries(contenu.emplacements)) {
    for (const retenue of retenues) {
      const prise = parId.get(retenue.prise);
      if (!prise) problemes.push(`${idFamille} · ${idEmpl} : prise ${retenue.prise} absente du dossier privé`);
      else if (licence(prise.licence).code === 'inconnue') problemes.push(`${idFamille} · ${idEmpl} : licence illisible pour ${retenue.prise}`);
    }
  }
}
if (problemes.length > 0) {
  console.error(`sons:build : choix impossible à fabriquer :\n  - ${problemes.join('\n  - ')}`);
  process.exit(1);
}
if (verifier) {
  console.log('sons:build --verifier : choix lisible, toutes les prises sont là.');
  process.exit(0);
}

const aujourdhui = new Date().toISOString().slice(0, 10);
const arrondi = (/** @type {number} */ v, n = 3) => Math.round(v * 10 ** n) / 10 ** n;

/** @type {Record<string, { nom: string, genre: string, provisoire: boolean, boucles: number, ponctuels: number }>} */
const index = {};
/** @type {{ famille: string, nom: string, auteur: string, licence: string, source: string, emplacements: string[] }[]} */
const attributions = [];
/** @type {string[]} */
const lignesCredits = [];

for (const fam of FAMILLES) {
  if (seule && fam.id !== seule) continue;
  const contenu = choix.familles[fam.id];
  const dossier = join(fam.genre === 'moteur' ? SORTIE_MOTEURS : SORTIE_BRUITAGES, fam.id);
  if (!contenu || Object.keys(contenu.emplacements).length === 0) {
    if (existsSync(dossier)) rmSync(dossier, { recursive: true });
    // Une famille que l'app lit à chaque sortie garde un index vide : une requête qui aboutit, aucun
    // son, plutôt qu'une 404 à chaque session.
    if (INDEX_TOUJOURS.has(fam.id)) {
      mkdirSync(dossier, { recursive: true });
      writeFileSync(
        join(dossier, 'sfx.json'),
        `${JSON.stringify({ format: 'pmb-sfx-sons', version: 1, famille: fam.id, nom: fam.nom, provisoire: false, boucles: [], ponctuels: [], credits: [] }, null, 2)}\n`,
      );
    }
    continue;
  }
  mkdirSync(dossier, { recursive: true });
  /** @type {Map<string, number>} */
  const creditIndex = new Map();
  /** @type {{ auteur: string, licence: string, source: string, prise: string, citer: boolean, generee: boolean }[]} */
  const credits = [];
  /** @type {Record<string, unknown>[]} */
  const boucles = [];
  /** @type {Record<string, unknown>[]} */
  const ponctuels = [];
  /** @type {Map<string, string[]>} fichiers par prise, pour CREDITS.md */
  const fichiersParPrise = new Map();
  const ecrits = new Set();
  let provisoire = false;

  for (const empl of fam.emplacements) {
    const retenues = contenu.emplacements[empl.id];
    if (!retenues) continue;
    retenues.forEach((retenue, rang) => {
      const prise = /** @type {import('./catalogue.mjs').Prise} */ (parId.get(retenue.prise));
      const lic = licence(prise.licence);
      if (!creditIndex.has(prise.id)) {
        creditIndex.set(prise.id, credits.length);
        // Une prise générée n'a pas d'auteur tiers : le commanditaire l'a fabriquée et en a les droits d'usage.
        credits.push(
          lic.generee
            ? { auteur: 'le commanditaire', licence: lic.code, source: 'son généré par le commanditaire', prise: prise.id, citer: false, generee: true }
            : { auteur: prise.auteur, licence: lic.code, source: prise.source.replace(/^Wikimedia Commons.*/, 'Wikimedia Commons'), prise: prise.id, citer: lic.citer, generee: false },
        );
      }
      const fichier = empl.variantes > 1 ? `${empl.id}-${rang + 1}.ogg` : `${empl.id}.ogg`;
      const fait = fabriquer(retenue, empl, prise);
      encoder(fait.pcm, join(dossier, fichier), fam.genre === 'moteur' ? 96 : 80);
      const decodes = echantillonsDecodes(join(dossier, fichier));
      if (decodes !== fait.pcm.length) console.warn(`  ! ${fam.id}/${fichier} : ${decodes} échantillons décodés pour ${fait.pcm.length} écrits`);
      ecrits.add(fichier);
      provisoire ||= retenue.provisoire === true;
      // Durée exacte (pas d'arrondi) : la boucle va d'un bout à l'autre du fichier, au dernier échantillon près.
      const duree = fait.pcm.length / TAUX;
      const entree = {
        emplacement: empl.id,
        fichier,
        empreinte: createHash('sha256').update(readFileSync(join(dossier, fichier))).digest('hex').slice(0, 10),
        duree,
        gain: 0,
        gainFabrication: fait.gainDb,
        credit: creditIndex.get(prise.id),
      };
      if (empl.genre === 'boucle') {
        boucles.push({ ...entree, regime: retenue.regime ?? null, boucle: [0, duree] });
      } else {
        ponctuels.push({ ...entree, ...(retenue.regime ? { regime: retenue.regime } : {}) });
      }
      const liste = fichiersParPrise.get(prise.id) ?? [];
      liste.push(fichier);
      fichiersParPrise.set(prise.id, liste);
      const taille = Math.round(statSync(join(dossier, fichier)).size / 1024);
      console.log(
        `  ${fam.id}/${fichier} : ${arrondi(duree)} s, ${taille} Ko, niveau ${fait.gainDb >= 0 ? '+' : ''}${fait.gainDb} dB${fait.limite ? ' (limité par la crête)' : ''}` +
          (fait.boucle ? `, raccord ${fait.boucle.correlation}` : '') +
          `, écrêtage ${fait.analyse.ecretage} %`,
      );
    });
  }

  for (const nom of readdirSync(dossier)) {
    if (nom.endsWith('.ogg') && !ecrits.has(nom)) rmSync(join(dossier, nom));
  }

  const idle = boucles.find((item) => item.emplacement === 'idle');
  const manifeste = {
    format: fam.genre === 'moteur' ? 'pmb-engine-sons' : 'pmb-sfx-sons',
    version: 1,
    famille: fam.id,
    nom: fam.nom,
    provisoire,
    ...(fam.genre === 'moteur'
      ? { ralenti: idle?.regime ?? null, gaz: contenu.gaz ?? (boucles.length >= 2 ? 'boucles' : 'prises') }
      : {}),
    boucles,
    ponctuels,
    credits: credits.map((credit) => ({ auteur: credit.auteur, licence: credit.licence, source: credit.source, citer: credit.citer })),
  };
  writeFileSync(join(dossier, fam.genre === 'moteur' ? 'engine.json' : 'sfx.json'), `${JSON.stringify(manifeste, null, 2)}\n`);
  index[fam.id] = { nom: fam.nom, genre: fam.genre, provisoire, boucles: boucles.length, ponctuels: ponctuels.length };

  const base = fam.genre === 'moteur' ? 'public/assets/audio/engines' : 'public/assets/audio/sfx';
  for (const credit of credits) {
    const fichiers = fichiersParPrise.get(credit.prise) ?? [];
    if (credit.citer) attributions.push({ famille: fam.id, nom: fam.nom, auteur: credit.auteur, licence: credit.licence, source: credit.source, emplacements: fichiers.map((f) => f.replace(/\.ogg$/, '')) });
    lignesCredits.push(ligneCredit({ fichiers: fichiers.map((f) => `${base}/${fam.id}/${f}`), credit, moteur: fam.genre === 'moteur', date: aujourdhui, note: `${fam.nom}${provisoire ? ', choix provisoire' : ''}` }));
  }
}

if (!seule) {
  // Le lecteur des moteurs ne voit que les familles de moteur ; les bruitages ont leur propre liste.
  const moteurs = Object.fromEntries(Object.entries(index).filter(([, item]) => item.genre === 'moteur'));
  const bruitages = Object.fromEntries(Object.entries(index).filter(([, item]) => item.genre === 'bruitage'));
  writeFileSync(INDEX_APP, `${JSON.stringify({ format: 'pmb-sons-index', version: 1, familles: moteurs, bruitages, attributions }, null, 2)}\n`);
  const section = [
    DEBUT_SECTION,
    '',
    '| Fichier(s) | Origine | Auteur | Licence | Date | Note |',
    '|---|---|---|---|---|---|',
    '| `public/assets/audio/engines/*/engine.json`, `public/assets/audio/sfx/*/sfx.json`, `src/audio/engine/familles.json` | écrits par `npm run sons:build` | projet PimpMyBichon | création projet | ' + aujourdhui + ' | manifestes des sons (régime, points de bouclage, gains, crédits) |',
    ...lignesCredits,
    '',
    FIN_SECTION,
  ].join('\n');
  const texte = readFileSync(CREDITS, 'utf8');
  const debut = texte.indexOf(DEBUT_SECTION);
  const fin = texte.indexOf(FIN_SECTION);
  const nouveau = debut >= 0 && fin > debut ? texte.slice(0, debut) + section + texte.slice(fin + FIN_SECTION.length) : `${texte.trimEnd()}\n\n### Sons des moteurs et bruitages\n\n${section}\n`;
  writeFileSync(CREDITS, nouveau);
}
console.log(`sons:build : ${Object.keys(index).length} famille(s) fabriquée(s), crédits à citer : ${attributions.length}.`);
