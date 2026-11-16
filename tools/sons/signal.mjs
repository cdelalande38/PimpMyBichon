// @ts-check
// Traitement des prises : décodage par ffmpeg, analyse (durée, crête, écrêtage, stabilité),
// boucle sans clic (raccord cherché par corrélation, fondu de bouclage), niveau, fondus d'entrée et
// de sortie, encodage. Aucune synthèse : on ne fait que couper, fondre et régler le niveau
// d'enregistrements réels. Les fonctions sur Float32Array sont pures (tests/unit/sons-outils.test.ts).

import { spawnSync } from 'node:child_process';

/** Fréquence de travail et de sortie (Opus ne connaît que 48 kHz). */
export const TAUX = 48000;

/** Plafond de crête après réglage du niveau : −1 dBFS. */
export const PLAFOND = 10 ** (-1 / 20);

/** ffmpeg est là. */
export function ffmpegPresent() {
  const essai = spawnSync('ffmpeg', ['-hide_banner', '-version'], { encoding: 'utf8' });
  return essai.status === 0;
}

/**
 * Décode une plage d'un fichier en mono 48 kHz, flottants. Passe-haut à 20 Hz (continu et
 * grondement inaudible), rien d'autre.
 * @param {string} chemin @param {number} debut @param {number} fin
 * @returns {Float32Array}
 */
export function decoder(chemin, debut, fin) {
  const args = ['-v', 'error', '-ss', String(debut), '-to', String(fin), '-i', chemin, '-ac', '1', '-ar', String(TAUX), '-af', 'highpass=f=20', '-f', 'f32le', '-'];
  const sortie = spawnSync('ffmpeg', args, { maxBuffer: 1 << 30 });
  if (sortie.status !== 0) throw new Error(`ffmpeg n'a pas pu lire ${chemin} : ${String(sortie.stderr).slice(0, 300)}`);
  const octets = /** @type {Buffer} */ (sortie.stdout);
  return new Float32Array(octets.buffer.slice(octets.byteOffset, octets.byteOffset + octets.byteLength));
}

/**
 * Encode en Opus (conteneur Ogg), mono, 48 kHz : décodé et bouclé sans trou par Chrome
 * (decodeAudioData retire le pré-roulement et la fin de remplissage). Sortie reproductible
 * (bitexact : numéro de flux Ogg fixe, pas d'étiquette de version), octets identiques d'une
 * fabrication à l'autre.
 * @param {Float32Array} pcm @param {string} chemin @param {number} [debit] en kbit/s
 */
export function encoder(pcm, chemin, debit = 96) {
  const args = ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(TAUX), '-ac', '1', '-i', '-', '-c:a', 'libopus', '-b:a', `${debit}k`, '-vbr', 'on', '-application', 'audio', '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact', chemin];
  const sortie = spawnSync('ffmpeg', args, { input: Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength) });
  if (sortie.status !== 0) throw new Error(`ffmpeg n'a pas pu écrire ${chemin} : ${String(sortie.stderr).slice(0, 300)}`);
}

/** WAV 16 bits mono, pour l'écoute dans la page (aperçu de la boucle telle qu'elle sera fabriquée). */
export function wav(/** @type {Float32Array} */ pcm) {
  const donnees = Buffer.alloc(pcm.length * 2);
  for (let i = 0; i < pcm.length; i += 1) donnees.writeInt16LE(Math.round(Math.max(-1, Math.min(1, pcm[i] ?? 0)) * 32767), i * 2);
  const entete = Buffer.alloc(44);
  entete.write('RIFF', 0);
  entete.writeUInt32LE(36 + donnees.length, 4);
  entete.write('WAVEfmt ', 8);
  entete.writeUInt32LE(16, 16);
  entete.writeUInt16LE(1, 20);
  entete.writeUInt16LE(1, 22);
  entete.writeUInt32LE(TAUX, 24);
  entete.writeUInt32LE(TAUX * 2, 28);
  entete.writeUInt16LE(2, 32);
  entete.writeUInt16LE(16, 34);
  entete.write('data', 36);
  entete.writeUInt32LE(donnees.length, 40);
  return Buffer.concat([entete, donnees]);
}

/** @param {number} valeur */
export function enDb(valeur) {
  return valeur > 0 ? 20 * Math.log10(valeur) : -120;
}

/**
 * Niveaux efficaces par tranche de `pas` secondes.
 * @param {Float32Array} pcm @param {number} [pas]
 */
export function niveaux(pcm, pas = 0.1) {
  const n = Math.max(1, Math.round(pas * TAUX));
  /** @type {number[]} */
  const out = [];
  for (let i = 0; i + n <= pcm.length; i += n) {
    let somme = 0;
    for (let j = i; j < i + n; j += 1) somme += (pcm[j] ?? 0) ** 2;
    out.push(Math.sqrt(somme / n));
  }
  return out;
}

/**
 * Niveau efficace des passages audibles (tranches à moins de 30 dB sous la plus forte), en dBFS.
 * @param {Float32Array} pcm
 */
export function niveauAudible(pcm) {
  const tranches = niveaux(pcm, 0.05);
  if (tranches.length === 0) return -120;
  const max = Math.max(...tranches);
  const gardees = tranches.filter((v) => v >= max * 10 ** (-30 / 20));
  return enDb(Math.sqrt(gardees.reduce((s, v) => s + v * v, 0) / gardees.length));
}

/**
 * Analyse d'une plage : durée, crête, part d'échantillons écrêtés, niveau audible, stabilité
 * (écart type du niveau par tranches de 0,1 s, en dB : sous 1,5 dB, un régime tenu est stable).
 * @param {Float32Array} pcm
 */
export function analyser(pcm) {
  let crete = 0;
  let ecretes = 0;
  for (let i = 0; i < pcm.length; i += 1) {
    const v = Math.abs(pcm[i] ?? 0);
    if (v > crete) crete = v;
    if (v >= 0.995) ecretes += 1;
  }
  const db = niveaux(pcm, 0.1).map(enDb);
  const moyenne = db.reduce((s, v) => s + v, 0) / Math.max(1, db.length);
  const ecart = Math.sqrt(db.reduce((s, v) => s + (v - moyenne) ** 2, 0) / Math.max(1, db.length));
  return {
    duree: pcm.length / TAUX,
    creteDb: Math.round(enDb(crete) * 10) / 10,
    ecretage: Math.round((ecretes / Math.max(1, pcm.length)) * 1e5) / 1e3,
    niveauDb: Math.round(niveauAudible(pcm) * 10) / 10,
    stabiliteDb: Math.round(ecart * 100) / 100,
  };
}

/**
 * Plage la plus stable de `longueur` secondes (niveau le plus régulier), en secondes : sert de
 * boucle par défaut quand le choix ne donne pas de points de bouclage.
 * @param {Float32Array} pcm @param {number} longueur @param {number} [marge] secondes laissées au début (fondu)
 */
export function plageStable(pcm, longueur, marge = 0.25) {
  const pas = 0.1;
  const db = niveaux(pcm, pas).map(enDb);
  const n = Math.round(longueur / pas);
  const premier = Math.ceil(marge / pas);
  let meilleur = { debut: marge, ecart: Infinity };
  for (let i = premier; i + n <= db.length; i += 1) {
    const tranche = db.slice(i, i + n);
    const moy = tranche.reduce((s, v) => s + v, 0) / n;
    const ecart = Math.sqrt(tranche.reduce((s, v) => s + (v - moy) ** 2, 0) / n);
    if (ecart < meilleur.ecart) meilleur = { debut: i * pas, ecart };
  }
  const fin = Math.min(pcm.length / TAUX, meilleur.debut + longueur);
  return { debut: meilleur.debut, fin };
}

/**
 * Corrélation normalisée de deux fenêtres de même longueur.
 * @param {Float32Array} pcm @param {number} a @param {number} b @param {number} n
 */
function correlation(pcm, a, b, n) {
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < n; i += 1) {
    const x = pcm[a + i] ?? 0;
    const y = pcm[b + i] ?? 0;
    ab += x * y;
    aa += x * x;
    bb += y * y;
  }
  return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0;
}

/**
 * Boucle sans clic : extrait [debut, fin[ (en secondes), raccord déplacé de ±20 ms au plus pour que
 * la fin ressemble au mieux à ce qui précède le début, puis les `fondu` dernières secondes fondues
 * avec ce qui précède le début. Jouée en boucle d'un bout à l'autre, la sortie n'a pas de couture :
 * son dernier échantillon enchaîne sur le premier comme dans l'enregistrement.
 * @param {Float32Array} pcm @param {number} debut @param {number} fin @param {number} fondu
 * @returns {{ pcm: Float32Array, debut: number, fin: number, correlation: number }}
 */
export function boucler(pcm, debut, fin, fondu) {
  const f = Math.max(1, Math.round(fondu * TAUX));
  const a = Math.max(f, Math.round(debut * TAUX));
  let b = Math.min(pcm.length, Math.round(fin * TAUX));
  if (b - a < 2 * f) throw new Error('boucle trop courte pour son fondu');
  // Raccord : la fenêtre qui précède b doit ressembler à celle qui précède a.
  const recherche = Math.round(0.02 * TAUX);
  let meilleure = { b, c: correlation(pcm, a - f, b - f, f) };
  for (let d = -recherche; d <= recherche; d += 1) {
    const essai = b + d;
    if (essai > pcm.length || essai - a < 2 * f) continue;
    const c = correlation(pcm, a - f, essai - f, f);
    if (c > meilleure.c) meilleure = { b: essai, c };
  }
  b = meilleure.b;
  const n = b - a;
  const out = new Float32Array(n);
  out.set(pcm.subarray(a, b));
  // Fondu : linéaire si les deux fenêtres se ressemblent (pas de bosse), à puissance constante sinon.
  const puissance = meilleure.c < 0.5;
  for (let i = 0; i < f; i += 1) {
    const t = (i + 0.5) / f;
    const sortant = puissance ? Math.cos((t * Math.PI) / 2) : 1 - t;
    const entrant = puissance ? Math.sin((t * Math.PI) / 2) : t;
    out[n - f + i] = (pcm[b - f + i] ?? 0) * sortant + (pcm[a - f + i] ?? 0) * entrant;
  }
  return { pcm: out, debut: a / TAUX, fin: b / TAUX, correlation: Math.round(meilleure.c * 1000) / 1000 };
}

/**
 * Début et fin propres d'un son ponctuel : fondus en cosinus.
 * @param {Float32Array} pcm @param {number} [entree] secondes @param {number} [sortie] secondes
 */
export function adoucir(pcm, entree = 0.008, sortie = 0.06) {
  const out = new Float32Array(pcm);
  const e = Math.min(out.length >> 1, Math.round(entree * TAUX));
  const s = Math.min(out.length >> 1, Math.round(sortie * TAUX));
  for (let i = 0; i < e; i += 1) out[i] = (out[i] ?? 0) * 0.5 * (1 - Math.cos((Math.PI * i) / e));
  for (let i = 0; i < s; i += 1) {
    const k = out.length - 1 - i;
    out[k] = (out[k] ?? 0) * 0.5 * (1 - Math.cos((Math.PI * i) / s));
  }
  return out;
}

/**
 * Règle le niveau audible sur `cible` dBFS (plus `gain` dB), sans dépasser le plafond de crête.
 * @param {Float32Array} pcm @param {number} cible @param {number} [gain]
 * @returns {{ pcm: Float32Array, gainDb: number, limite: boolean }}
 */
export function niveler(pcm, cible, gain = 0) {
  const niveau = niveauAudible(pcm);
  let facteur = 10 ** ((cible + gain - niveau) / 20);
  let crete = 0;
  for (let i = 0; i < pcm.length; i += 1) crete = Math.max(crete, Math.abs(pcm[i] ?? 0));
  const limite = crete * facteur > PLAFOND;
  if (limite) facteur = PLAFOND / crete;
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i += 1) out[i] = (pcm[i] ?? 0) * facteur;
  return { pcm: out, gainDb: Math.round(enDb(facteur) * 10) / 10, limite };
}

/**
 * Durée réellement décodée d'un fichier fabriqué (contrôle du pré-roulement d'Opus), en échantillons.
 * @param {string} chemin
 */
export function echantillonsDecodes(chemin) {
  const sortie = spawnSync('ffmpeg', ['-v', 'error', '-i', chemin, '-ac', '1', '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  return sortie.status === 0 ? /** @type {Buffer} */ (sortie.stdout).byteLength / 4 : -1;
}
