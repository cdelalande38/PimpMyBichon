// Outillage commun aux tests des contrôles du dépôt (guard, assets-check, audio-check) :
// arbres de travail temporaires et chaînes sensibles fabriquées à l'exécution.
import { mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach } from 'vitest';
import { brandForms, hashForm } from '../../../tools/lib/brands.mjs';
import type { Finding } from '../../../tools/lib/report.mjs';

/** Contenu d'un fichier : du texte, des octets, ou une taille (fichier creux, rien n'est écrit). */
export type FileSpec = string | Uint8Array | { size: number };
export type TreeSpec = Record<string, FileSpec>;

export function writeTree(root: string, files: TreeSpec): void {
  for (const [rel, spec] of Object.entries(files)) {
    const path = join(root, rel);
    mkdirSync(dirname(path), { recursive: true });
    if (typeof spec === 'string' || spec instanceof Uint8Array) {
      writeFileSync(path, spec);
    } else {
      writeFileSync(path, '');
      truncateSync(path, spec.size);
    }
  }
}

/**
 * À appeler dans un `describe` : retourne la fonction qui crée un arbre temporaire.
 * Tous les arbres créés pendant un test sont supprimés à la fin de ce test.
 */
export function useTempTrees(): (files?: TreeSpec) => string {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });
  return (files = {}) => {
    const root = mkdtempSync(join(tmpdir(), 'pmb-outils-'));
    roots.push(root);
    writeTree(root, files);
    return root;
  };
}

/** Résumé d'une liste de constats, pour des comparaisons lisibles : « chemin:ligne règle ». */
export function located(findings: Finding[]): string[] {
  return findings.map((item) => `${item.file}:${item.line} ${item.rule}`);
}

export function rulesOf(findings: Finding[]): string[] {
  return findings.map((item) => item.rule);
}

/** Empreintes d'une liste de termes, comme les écrirait la commande --add-brand. */
export function hashesOf(...terms: string[]): Set<string> {
  return new Set(terms.flatMap((term) => brandForms(term).map(hashForm)));
}

/** Octets d'un fichier binaire quelconque (commence par un octet nul, comme un modèle ou une image). */
export const BINARY = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe, 0x00, 0x10]);

const AT = String.fromCharCode(64);
const DASHES = '-'.repeat(5);

/**
 * Données sensibles de test, toutes inventées et fabriquées à l'exécution. Écrites en clair
 * dans ce fichier, le garde les signalerait dans ce dépôt : c'est le comportement attendu.
 */
export const fake = {
  email: (local = 'prenom.nom', domain = 'atelier-fictif.fr') => [local, domain].join(AT),
  phone: (separator = ' ') => ['06', '12', '34', '56', '78'].join(separator),
  internationalPhone: () => ['+33', '6', '12', '34', '56', '78'].join(' '),
  plate: () => ['AB', '123', 'CD'].join('-'),
  formerPlate: () => ['1234', 'AB', '56'].join(' '),
  homePath: (base = 'home', name = 'bichon') => ['', base, name, 'projets', 'garage'].join('/'),
  windowsHomePath: (name = 'bichon') => ['C:', 'Users', name, 'Documents'].join('\\'),
  pemHeader: (kind = 'RSA PRIVATE') => `${DASHES}BEGIN ${kind} KEY${DASHES}`,
  githubToken: () => ['gh', 'p_'].join('') + 'a1B2c3D4e5'.repeat(4),
  fineGrainedGithubToken: () => ['github', 'pat', ''].join('_') + 'a1B2c3D4e5_'.repeat(6),
  gitlabToken: () => ['gl', 'pat-'].join('') + 'a1B2c3D4e5'.repeat(2),
  awsKey: () => ['AK', 'IA'].join('') + 'ABCDEFGHIJKLMNOP',
  assignedSecret: (name = ['api', 'Key'].join('')) => `const ${name} = "${'aB3dE6gH9j'.repeat(2)}";`,
  /** Directive d'exception, à poser sur la ligne qui précède. */
  ignore: (rule: string, reason: string, open = '//') =>
    `${open} ${['guard', 'ignore', 'next', 'line'].join('-')} ${rule} : ${reason}`,
};
