/// <reference types="vite/client" />

/** Identité du build, injectée par vite.config.ts. */
declare const __PMB_BUILD__: {
  version: string;
  /** SHA court du commit ; un « + » final signale un arbre de travail modifié. */
  commit: string;
  /** Date ISO du commit, vide hors dépôt git. */
  date: string;
  /** Dépôt privé d'assets : seulement des compteurs, jamais un nom de fichier. */
  privateAssets: { present: boolean; engines: number; sfx: number; stations: number };
};
