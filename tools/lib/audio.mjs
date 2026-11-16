// @ts-check
// Contrôle audio (§ 9 et § 15 du cahier des charges) :
//   - aucune synthèse dans la chaîne moteur ni dans la radio ;
//   - tout manifeste engine.json est un JSON valide ;
//   - aucun fichier audio sous public/ sans licence admise déclarée dans CREDITS.md ;
//   - stations de base (musique d'accueil, public/assets/audio/radio/<dossier>/) : un station.json
//     valide par dossier, qui liste exactement les morceaux du dossier.

import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
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

/** Dossier des stations de base (musique d'accueil), servies par l'app (§ 9). */
export const BUILTIN_RADIO_DIR = 'public/assets/audio/radio/';

/** Manifeste d'une station de base, lu par src/audio/radio/accueil.ts. */
export const STATION_MANIFEST = 'station.json';

/** Nom de dossier accepté par l'app (identifiant de la station). */
const STATION_FOLDER = /^[a-z0-9][a-z0-9-]*$/;

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
 * Erreurs d'un station.json déjà lu : format, nom, morceaux (nom de fichier simple, fichier présent
 * dans le dossier, pas de doublon, titre), et morceaux du dossier absents du manifeste.
 * @param {unknown} data
 * @param {Set<string>} present  noms des fichiers audio du dossier
 * @returns {{ problems: string[], tracks: number }}
 */
export function stationProblems(data, present) {
  /** @type {string[]} */
  const problems = [];
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return { problems: ['le manifeste doit être un objet JSON'], tracks: 0 };
  const manifest = /** @type {Record<string, unknown>} */ (data);
  if (manifest.format !== 'pmb-station' || manifest.version !== 1) problems.push('« format » doit valoir « pmb-station » et « version » 1');
  if (typeof manifest.nom !== 'string' || manifest.nom.trim() === '') problems.push('« nom » manque : c’est le nom de la station dans la radio');
  const items = Array.isArray(manifest.morceaux) ? manifest.morceaux : [];
  if (items.length === 0) problems.push('« morceaux » doit lister au moins un morceau');
  /** @type {Set<string>} */
  const listed = new Set();
  items.forEach((item, index) => {
    const where = `morceau n° ${index + 1}`;
    if (typeof item !== 'object' || item === null) {
      problems.push(`${where} : un objet est attendu`);
      return;
    }
    const track = /** @type {Record<string, unknown>} */ (item);
    const file = track.fichier;
    if (typeof file !== 'string' || file === '' || /[\\/]/.test(file) || !AUDIO_EXTENSIONS.includes(extname(file).toLowerCase())) {
      problems.push(`${where} : « fichier » doit être le nom d’un fichier audio du dossier (${AUDIO_EXTENSIONS.join(', ')})`);
      return;
    }
    if (listed.has(file)) problems.push(`${where} : « ${file} » est déjà listé`);
    listed.add(file);
    if (!present.has(file)) problems.push(`${where} : « ${file} » n’est pas dans le dossier`);
    if (typeof track.titre !== 'string' || track.titre.trim() === '') problems.push(`${where} : « titre » manque`);
    if (track.duree !== undefined && !(typeof track.duree === 'number' && Number.isFinite(track.duree) && track.duree > 0)) {
      problems.push(`${where} : « duree » doit être un nombre de secondes positif`);
    }
  });
  for (const file of [...present].sort()) {
    if (!listed.has(file)) problems.push(`« ${file} » est dans le dossier mais pas dans « morceaux » : poids mort, la radio ne le lit pas`);
  }
  return { problems, tracks: listed.size };
}

/**
 * d. Stations de base : un station.json par dossier, qui liste exactement les morceaux présents.
 * @param {Report} report
 * @param {import('./fs-walk.mjs').TreeFile[]} files  fichiers de public/
 */
function checkBuiltinStations(report, files) {
  /** @type {Map<string, { manifest: import('./fs-walk.mjs').TreeFile | null, audio: Set<string> }>} */
  const folders = new Map();
  for (const file of files) {
    if (!file.rel.startsWith(BUILTIN_RADIO_DIR)) continue;
    const parts = file.rel.slice(BUILTIN_RADIO_DIR.length).split('/');
    const isAudio = AUDIO_EXTENSIONS.includes(extname(file.rel).toLowerCase());
    if (parts.length !== 2) {
      if (isAudio || basename(file.rel) === STATION_MANIFEST) {
        report.errors.push(finding(file.rel, 0, 'station-de-base', `rangé hors d’un dossier de station : la radio ne lit que ${BUILTIN_RADIO_DIR}<dossier>/`));
      }
      continue;
    }
    const [folder = '', name = ''] = parts;
    const entry = folders.get(folder) ?? { manifest: null, audio: new Set() };
    if (name === STATION_MANIFEST) entry.manifest = file;
    else if (isAudio) entry.audio.add(name);
    else continue;
    folders.set(folder, entry);
  }

  let tracks = 0;
  for (const [folder, entry] of [...folders].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const dir = `${BUILTIN_RADIO_DIR}${folder}`;
    if (!STATION_FOLDER.test(folder)) {
      report.errors.push(finding(dir, 0, 'station-de-base', 'nom de dossier refusé par l’app : minuscules, chiffres et tirets seulement'));
      continue;
    }
    if (!entry.manifest) {
      report.errors.push(finding(dir, 0, 'station-de-base', `morceaux sans ${STATION_MANIFEST} : la radio ne les lit pas (npm run radio:accueil l’écrit)`));
      continue;
    }
    const parsed = parseJson(readFileSync(entry.manifest.abs, 'utf8'));
    if (!parsed.ok) {
      report.errors.push(finding(entry.manifest.rel, parsed.line, 'station-de-base', `JSON invalide : ${parsed.message}`));
      continue;
    }
    const result = stationProblems(parsed.value, entry.audio);
    for (const problem of result.problems) report.errors.push(finding(entry.manifest.rel, 0, 'station-de-base', problem));
    tracks += result.tracks;
  }
  report.notes.push(
    finding(
      '',
      0,
      'station-de-base',
      `${countLabel(folders.size, 'station de base contrôlée', 'stations de base contrôlées')} sous ${BUILTIN_RADIO_DIR}` +
        (folders.size > 0 ? ` (${countLabel(tracks, 'morceau', 'morceaux')})` : ''),
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
      `${countLabel(audioFiles.length, 'fichier audio', 'fichiers audio')} sous public/` +
        (audioFiles.length > 0 ? ` : licence vérifiée dans ${CREDITS_FILE}` : ''),
    ),
  );

  checkBuiltinStations(report, publicTree.files);

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
