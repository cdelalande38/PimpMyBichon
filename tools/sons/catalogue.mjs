// @ts-check
// Lecture du dossier privé des sons (.private-assets/sons/, jamais versionné) : prises
// (sources.csv), découpes (decoupes.csv) et choix (assets-src/sons/choix.json, versionné).
//
// Rien de ce qui est lu ici n'entre tel quel dans le dépôt : les titres et les noms de fichiers
// des prises citent souvent un modèle ou une marque. Le choix ne retient donc qu'un identifiant
// neutre de prise (« freesound-<numéro> », ou « prise-<empreinte du chemin> » hors de Freesound)
// et des bornes en secondes dans la prise.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { REPO_ROOT } from '../lib/cli.mjs';
import { FAMILLES, suggestion } from './emplacements.mjs';

/** Dossier privé des sons : variable SONS_PRIVE, sinon .private-assets/sons/ du dépôt. */
export const DOSSIER_PRIVE = resolve(process.env.SONS_PRIVE ?? join(REPO_ROOT, '.private-assets', 'sons'));

/** Choix des prises, versionné (une prise par emplacement, ses bornes, son régime, son gain). */
export const CHOIX = resolve(process.env.SONS_CHOIX ?? join(REPO_ROOT, 'assets-src', 'sons', 'choix.json'));

/** Le dossier privé est là, avec ses deux listes. */
export function privePresent() {
  return existsSync(join(DOSSIER_PRIVE, 'sources.csv')) && existsSync(join(DOSSIER_PRIVE, 'decoupes.csv'));
}

/**
 * Tableau « ; » à en-tête (sources.csv, decoupes.csv). Pas de guillemets dans ces fichiers.
 * @param {string} texte
 * @returns {Record<string, string>[]}
 */
export function lireTableau(texte) {
  const lignes = texte.replace(/^\uFEFF/, '').split(/\r?\n/).filter((ligne) => ligne.trim() !== '');
  const entete = (lignes.shift() ?? '').split(';');
  return lignes.map((ligne) => {
    const cellules = ligne.split(';');
    /** @type {Record<string, string>} */
    const ligneLue = {};
    entete.forEach((nom, index) => {
      ligneLue[nom] = (cellules[index] ?? '').trim();
    });
    return ligneLue;
  });
}

/**
 * Identifiant neutre d'une prise : le numéro Freesound, ou une empreinte de son chemin.
 * @param {{ fichier: string, source: string }} ligne
 */
export function idPrise(ligne) {
  const freesound = /freesound\s+(\d+)/i.exec(ligne.source);
  if (freesound) return `freesound-${freesound[1]}`;
  return `prise-${createHash('sha256').update(ligne.fichier).digest('hex').slice(0, 10)}`;
}

/** Licence d'une prise générée par le commanditaire (sources.csv), et sa forme dans CREDITS.md. */
export const LICENCE_GENEREE = 'genere-commanditaire';
export const LICENCE_GENEREE_CREDITS = 'son généré par le commanditaire';

/**
 * Licence d'une prise sous la forme admise par CREDITS.md, et si elle demande de citer l'auteur.
 * « genere-commanditaire » : son fabriqué par le commanditaire avec un outil de génération sonore,
 * dont il a les droits d'usage ; aucun auteur tiers à citer (admise sous public/assets/audio/engines/
 * et public/assets/audio/sfx/ seulement, tools/lib/credits.mjs).
 * @param {string} cellule  « CC0 », « CC BY 3.0 (citer l'auteur) », « CC0 (attribution appréciée) », « genere-commanditaire »…
 */
export function licence(cellule) {
  const texte = cellule.toLowerCase().trim();
  if (/^g[ée]n[ée]r[ée]e?[\s-]+(par[\s-]+le[\s-]+)?commanditaire/.test(texte)) return { code: LICENCE_GENEREE_CREDITS, citer: false, texte: 'son généré', generee: true };
  if (texte.startsWith('cc0')) return { code: 'CC0-1.0', citer: false, texte: 'CC0' };
  const by = /cc[\s-]*by[\s-]*(\d\.\d)/.exec(texte);
  if (by && !/nc|nd|sa/.test(texte.replace(/citer|attribution/g, ''))) return { code: `CC-BY-${by[1]}`, citer: true, texte: `CC BY ${by[1]}` };
  return { code: 'inconnue', citer: true, texte: cellule };
}

/**
 * @typedef {object} Prise
 * @property {string} id
 * @property {string} fichier     chemin dans le dossier privé
 * @property {string} famille
 * @property {string} source      « Freesound 331707 », « Wikimedia Commons »
 * @property {string} auteur
 * @property {string} licence     cellule d'origine
 * @property {string} remarques
 * @property {boolean} accord     ne peut être retenue sans l'accord du commanditaire
 */

/**
 * @typedef {object} Decoupe
 * @property {string} nom         nom du fichier FLAC (emplacement__prise.flac)
 * @property {string} fichier     chemin dans le dossier privé
 * @property {string} prise       identifiant neutre de la prise
 * @property {string} famille
 * @property {number} debut       en secondes dans la prise
 * @property {number} fin
 * @property {string} contenu
 * @property {string | null} emplacement  suggéré par le nom
 * @property {number | null} regime       estimé, en tr/min
 */

/** Famille d'un chemin du dossier privé (engines/<famille>/…, sfx/<famille>/…). */
function familleDe(/** @type {string} */ chemin) {
  const [racine, nom] = chemin.split('/');
  if (racine !== 'engines' && racine !== 'sfx') return null;
  return FAMILLES.some((item) => item.id === nom) ? nom ?? null : null;
}

/** Régime écrit dans une description (« environ 1 350 tr/min »), le premier trouvé. */
export function regimeDecrit(/** @type {string} */ texte) {
  const trouve = /(\d[\d\s\u00a0\u202f]{2,6})\s*tr\/min/.exec(texte);
  if (!trouve?.[1]) return null;
  const valeur = Number(trouve[1].replace(/[\s\u00a0\u202f]/g, ''));
  return Number.isFinite(valeur) && valeur > 200 ? valeur : null;
}

/**
 * Lit les deux listes du dossier privé. `accord` : identifiants des prises qui attendent l'accord
 * du commanditaire (champ « accordRequis » du choix).
 * @param {Set<string>} accord
 */
export function lireCatalogue(accord = new Set()) {
  const sources = lireTableau(readFileSync(join(DOSSIER_PRIVE, 'sources.csv'), 'utf8'));
  /** @type {Map<string, Prise>} */
  const parFichier = new Map();
  for (const ligne of sources) {
    const fichier = ligne.fichier ?? '';
    const famille = familleDe(fichier);
    if (!famille) continue;
    const id = idPrise({ fichier, source: ligne.source ?? '' });
    parFichier.set(fichier, {
      id,
      fichier,
      famille,
      source: ligne.source ?? '',
      auteur: ligne.auteur ?? '',
      licence: ligne.licence ?? '',
      remarques: ligne.remarques ?? '',
      accord: accord.has(id),
    });
  }
  /** @type {Decoupe[]} */
  const decoupes = [];
  for (const ligne of lireTableau(readFileSync(join(DOSSIER_PRIVE, 'decoupes.csv'), 'utf8'))) {
    const prise = parFichier.get(ligne.source ?? '');
    const sortie = ligne.sortie ?? '';
    if (!prise) continue;
    const nom = basename(sortie);
    const prefixe = nom.split('__')[0] ?? '';
    const sugg = suggestion(prefixe);
    decoupes.push({
      nom,
      fichier: sortie,
      prise: prise.id,
      famille: familleDe(sortie) ?? prise.famille,
      debut: Number(ligne.debut),
      fin: Number(ligne.fin),
      contenu: ligne.contenu ?? '',
      emplacement: sugg.emplacement,
      regime: sugg.regime ?? regimeDecrit(ligne.contenu ?? ''),
    });
  }
  const prises = [...parFichier.values()];
  return { prises, decoupes, parId: new Map(prises.map((prise) => [prise.id, prise])) };
}

/** Chemin absolu d'un fichier du dossier privé. */
export function cheminPrive(/** @type {string} */ relatif) {
  const chemin = resolve(DOSSIER_PRIVE, relatif);
  if (!chemin.startsWith(DOSSIER_PRIVE + '/')) throw new Error(`chemin hors du dossier privé : ${relatif}`);
  return chemin;
}

/** Taille d'un fichier, ou 0. */
export function taille(/** @type {string} */ chemin) {
  try {
    return statSync(chemin).size;
  } catch {
    return 0;
  }
}

/**
 * @typedef {object} Retenue
 * @property {string} prise
 * @property {number} debut
 * @property {number} fin
 * @property {{ debut: number, fin: number }} [boucle]  en secondes depuis `debut`
 * @property {number} [fondu]     fondu de bouclage, en secondes
 * @property {number | null} [regime]
 * @property {number} [gain]      en dB, ajouté au niveau visé
 * @property {boolean} [provisoire]
 * @property {string} [pourquoi]
 */

/** @typedef {{ format: string, version: number, note?: string, accordRequis?: string[], familles: Record<string, { gaz?: 'boucles' | 'prises', emplacements: Record<string, Retenue[]> }> }} Choix */

/** Choix vide. */
export function choixVide() {
  /** @type {Choix} */
  const choix = { format: 'pmb-sons-choix', version: 1, accordRequis: [], familles: {} };
  return choix;
}

/** @returns {Choix} */
export function lireChoix() {
  if (!existsSync(CHOIX)) return choixVide();
  const lu = JSON.parse(readFileSync(CHOIX, 'utf8'));
  if (lu?.format !== 'pmb-sons-choix' || lu.version !== 1) throw new Error(`${CHOIX} : format inattendu`);
  return lu;
}

/** @param {Choix} choix */
export function ecrireChoix(choix) {
  writeFileSync(CHOIX, `${JSON.stringify(choix, null, 2)}\n`);
}

/**
 * Problèmes d'un choix : famille ou emplacement inconnus, trop de variantes, bornes absurdes,
 * prise qui attend l'accord du commanditaire.
 * @param {Choix} choix
 */
export function problemesChoix(choix) {
  /** @type {string[]} */
  const problemes = [];
  const accord = new Set(choix.accordRequis ?? []);
  for (const [idFamille, contenu] of Object.entries(choix.familles ?? {})) {
    const fam = FAMILLES.find((item) => item.id === idFamille);
    if (!fam) {
      problemes.push(`famille inconnue : ${idFamille}`);
      continue;
    }
    if (contenu.gaz !== undefined && contenu.gaz !== 'boucles' && contenu.gaz !== 'prises') problemes.push(`${idFamille} : « gaz » vaut « boucles » ou « prises »`);
    for (const [idEmpl, retenues] of Object.entries(contenu.emplacements ?? {})) {
      const empl = fam.emplacements.find((item) => item.id === idEmpl);
      const ou = `${idFamille} · ${idEmpl}`;
      if (!empl) {
        problemes.push(`${ou} : emplacement inconnu`);
        continue;
      }
      if (!Array.isArray(retenues) || retenues.length === 0) problemes.push(`${ou} : une liste d'au moins une prise est attendue`);
      else if (retenues.length > empl.variantes) problemes.push(`${ou} : ${retenues.length} prises pour ${empl.variantes} au plus`);
      for (const retenue of Array.isArray(retenues) ? retenues : []) {
        if (typeof retenue.prise !== 'string' || !/^(freesound|prise)-[0-9a-f]+$/.test(retenue.prise)) problemes.push(`${ou} : identifiant de prise illisible`);
        if (accord.has(retenue.prise)) problemes.push(`${ou} : la prise ${retenue.prise} demande l'accord du commanditaire`);
        if (!(retenue.fin > retenue.debut && retenue.debut >= 0)) problemes.push(`${ou} : bornes illisibles`);
        if (empl.genre === 'boucle' && retenue.boucle) {
          const { debut, fin } = retenue.boucle;
          if (!(fin > debut && debut >= 0 && fin <= retenue.fin - retenue.debut + 1e-6)) problemes.push(`${ou} : points de bouclage hors de l'extrait`);
        }
      }
    }
  }
  return problemes;
}

/**
 * Ligne de CREDITS.md pour une prise (écrite par sons:build). Une prise générée se crédite sans
 * auteur tiers : son généré par le commanditaire avec un outil de génération sonore, qui en a les
 * droits d'usage.
 * @param {{ fichiers: string[], credit: { auteur: string, licence: string, source: string, generee?: boolean }, moteur: boolean, date: string, note: string }} o
 */
export function ligneCredit({ fichiers, credit, moteur, date, note }) {
  const traitement = `découpé, ${moteur ? 'bouclé ou adouci' : 'adouci'} et mis à niveau par \`npm run sons:build\` (Opus)`;
  const origine = credit.generee
    ? `son généré par le commanditaire avec un outil de génération sonore, dont il a les droits d'usage ; ${traitement}`
    : `${credit.source}, ${traitement}`;
  return `| ${fichiers.map((f) => `\`${f}\``).join(', ')} | ${origine} | ${credit.generee ? 'le commanditaire' : credit.auteur} | ${credit.licence} | ${date} | ${note} |`;
}

