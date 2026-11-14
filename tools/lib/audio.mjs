// @ts-check
// Contrôle audio (§ 9 et § 15 du cahier des charges) :
//   - aucune synthèse dans la chaîne moteur ni dans la radio ;
//   - tout manifeste engine.json est un JSON valide ;
//   - aucun fichier audio sous public/ sans licence admise déclarée dans CREDITS.md.

import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { checkLicenseCoverage, CREDITS_FILE, loadCredits } from './credits.mjs';
import { walkTree } from './fs-walk.mjs';
import { countLabel, createReport, finding, mergeInto, notChecked, sortReport } from './report.mjs';
import { parseJson, readTextFile, splitLines } from './text.mjs';

/** @typedef {import('./report.mjs').Report} Report */

/**
 * Dossiers où toute synthèse est une erreur : un moteur ou une musique sans fichier réel
 * reste muet et figure dans TODO_ASSETS.md, on ne le comble pas par un oscillateur (§ 9).
 */
export const STRICT_DIRS = Object.freeze(['src/audio/engine/', 'src/audio/radio/']);

/**
 * Points d'entrée de la synthèse dans l'API Web Audio : oscillateurs, formes d'onde
 * périodiques, sources constantes, sous leur forme « méthode de contexte » et « constructeur ».
 */
export const SYNTHESIS_NAMES = Object.freeze([
  'createOscillator',
  'OscillatorNode',
  'createPeriodicWave',
  'PeriodicWave',
  'createConstantSource',
  'ConstantSourceNode',
]);

// Recherche textuelle, sans analyse du code : un accès par crochets avec une chaîne littérale
// (ctx['…']) contient le même nom, et un commentaire qui le cite est signalé lui aussi.
const SYNTHESIS = new RegExp(SYNTHESIS_NAMES.join('|'), 'g');

/** Échappements d'une chaîne JavaScript qui peuvent déguiser un nom : \uXXXX, \u{…}, \xXX. */
const ESCAPE = /\\u\{([0-9a-fA-F]{1,6})\}|\\u([0-9a-fA-F]{4})|\\x([0-9a-fA-F]{2})/g;

/** Fichiers audio livrables. Les masters (.wav, .flac…) relèvent d'assets-check. */
export const AUDIO_EXTENSIONS = Object.freeze(['.mp3', '.ogg', '.opus', '.m4a', '.aac', '.weba']);

/**
 * Noms de l'API de synthèse cités dans une ligne.
 * @param {string} line
 * @returns {string[]}
 */
export function findSynthesis(line) {
  const decoded = line.includes('\\')
    ? line.replace(ESCAPE, (escape, braced, unicode, hex) => {
        const code = Number.parseInt(braced ?? unicode ?? hex, 16);
        return code <= 0x10ffff ? String.fromCodePoint(code) : escape;
      })
    : line;
  return decoded.match(SYNTHESIS) ?? [];
}

/**
 * a. Synthèse dans src/ : erreur dans la chaîne moteur et la radio, avertissement ailleurs.
 * @param {Report} report
 * @param {import('./fs-walk.mjs').TreeFile[]} files  fichiers de src/
 */
function checkSynthesis(report, files) {
  let strictFiles = 0;
  let otherFiles = 0;

  for (const file of files) {
    const text = readTextFile(file.abs);
    if (text === null) continue;
    const strict = STRICT_DIRS.some((dir) => file.rel.startsWith(dir));
    if (strict) strictFiles += 1;
    else otherFiles += 1;

    splitLines(text).forEach((line, index) => {
      for (const name of findSynthesis(line)) {
        if (strict) {
          report.errors.push(
            finding(
              file.rel,
              index + 1,
              'synthese',
              `« ${name} » : aucune synthèse dans la chaîne moteur ni dans la radio (§ 9) ; sans fichier réel, ` +
                "l'emplacement reste muet et figure dans TODO_ASSETS.md",
            ),
          );
        } else {
          report.warnings.push(
            finding(
              file.rel,
              index + 1,
              'synthese',
              `« ${name} » hors de la chaîne moteur et de la radio : vérifie que ce son n'est ni un moteur ` +
                'ni une musique (§ 9)',
            ),
          );
        }
      }
    });
  }

  report.notes.push(
    finding(
      '',
      0,
      'synthese',
      `chaîne moteur et radio (${STRICT_DIRS.join(', ')}) : ` +
        `${countLabel(strictFiles, 'fichier contrôlé', 'fichiers contrôlés')} ; ` +
        `reste de src/ : ${countLabel(otherFiles, 'fichier contrôlé', 'fichiers contrôlés')}`,
    ),
  );
}

/**
 * Lance le contrôle audio sur un arbre de travail.
 * @param {object} options
 * @param {string} options.root
 * @returns {Report}
 */
export function runAudioCheck({ root }) {
  const report = createReport();
  const sourceTree = walkTree(root, { start: 'src' });
  const publicTree = walkTree(root, { start: 'public' });

  checkSynthesis(report, sourceTree.files);

  // b. Manifestes des jeux de sons moteur.
  const manifests = publicTree.files.filter(
    (file) => file.rel.startsWith('public/assets/') && file.rel.endsWith('/engine.json'),
  );
  for (const manifest of manifests) {
    const parsed = parseJson(readFileSync(manifest.abs, 'utf8'));
    if (!parsed.ok) {
      report.errors.push(finding(manifest.rel, parsed.line, 'manifeste-moteur', `JSON invalide : ${parsed.message}`));
    }
  }
  report.notes.push(
    finding(
      '',
      0,
      'manifeste-moteur',
      `${countLabel(manifests.length, 'manifeste engine.json contrôlé', 'manifestes engine.json contrôlés')} sous public/assets/`,
    ),
  );

  // c. La musique et les sons de banque ne vont jamais dans le dépôt public : un fichier audio
  // n'y reste que sous une licence admise, déclarée dans CREDITS.md.
  const audioFiles = publicTree.files
    .filter((file) => AUDIO_EXTENSIONS.includes(extname(file.rel).toLowerCase()))
    .map((file) => file.rel);
  if (audioFiles.length > 0) {
    mergeInto(report, checkLicenseCoverage({ files: audioFiles, credits: loadCredits(root), rule: 'licence' }));
  }
  report.notes.push(
    finding(
      '',
      0,
      'licence',
      `${countLabel(audioFiles.length, 'fichier audio')} sous public/` +
        (audioFiles.length > 0 ? ` : licence vérifiée dans ${CREDITS_FILE}` : ''),
    ),
  );

  for (const link of [...sourceTree.links, ...publicTree.links]) {
    report.warnings.push(
      finding(link.rel, 0, 'lien-symbolique', "lien symbolique non suivi : ce qu'il désigne échappe au contrôle audio"),
    );
  }

  report.notes.push(
    notChecked(
      'niveaux (LUFS, crête vraie), formats et points de bouclage, complétude des jeux de sons moteur (jalon 9)',
    ),
  );
  return sortReport(report);
}
