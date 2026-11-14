// @ts-check
// Lecture des fichiers texte : les contrôles ligne par ligne ne lisent pas les binaires.

import { closeSync, openSync, readFileSync, readSync } from 'node:fs';

/** Taille de l'échantillon examiné pour reconnaître un binaire (même ordre de grandeur que git). */
const SNIFF_BYTES = 8000;

/**
 * Lit un fichier s'il contient du texte.
 * Un octet nul dans le début du fichier désigne un binaire (modèle, image, son, police).
 * Les fichiers UTF-16 (reconnus à leur marque d'ordre) sont décodés comme du texte.
 * @param {string} abs
 * @returns {string | null}  le texte, ou null pour un fichier binaire
 */
export function readTextFile(abs) {
  const head = Buffer.alloc(SNIFF_BYTES);
  const fd = openSync(abs, 'r');
  let length = 0;
  try {
    length = readSync(fd, head, 0, SNIFF_BYTES, 0);
  } finally {
    closeSync(fd);
  }
  const sample = head.subarray(0, length);

  if (sample.length >= 2 && sample[0] === 0xff && sample[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(readFileSync(abs));
  }
  if (sample.length >= 2 && sample[0] === 0xfe && sample[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(readFileSync(abs));
  }
  if (sample.includes(0)) return null;

  // TextDecoder retire la marque d'ordre UTF-8 éventuelle et remplace les octets invalides.
  return new TextDecoder('utf-8').decode(readFileSync(abs));
}

/**
 * @param {string} text
 * @returns {string[]}
 */
export function splitLines(text) {
  return text.split(/\r\n|\n|\r/);
}

/**
 * Numéro de ligne (à partir de 1) du caractère placé à `index`.
 * @param {string} text
 * @param {number} index
 */
export function lineNumberAt(text, index) {
  let line = 1;
  for (let i = text.indexOf('\n'); i !== -1 && i < index; i = text.indexOf('\n', i + 1)) line += 1;
  return line;
}

/**
 * Analyse du JSON en gardant, quand le moteur la donne, la ligne de l'erreur.
 * @param {string} text
 * @returns {{ ok: true, value: unknown } | { ok: false, message: string, line: number }}
 */
export function parseJson(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const explicit = /line (\d+)/.exec(message);
    const position = /position (\d+)/.exec(message);
    let line = 0;
    if (explicit?.[1]) line = Number(explicit[1]);
    else if (position?.[1]) line = lineNumberAt(text, Number(position[1]));
    return { ok: false, message, line };
  }
}

/**
 * Raccourcit un extrait pour l'affichage.
 * @param {string} text
 * @param {number} [max]
 */
export function truncate(text, max = 80) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
