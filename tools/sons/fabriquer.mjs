// @ts-check
// Fabrication d'un emplacement à partir de sa prise retenue : la même fonction sert à
// « npm run sons:build » et à l'aperçu de la page d'écoute (on entend ce qui sera fabriqué).

import { cheminPrive } from './catalogue.mjs';
import { adoucir, analyser, boucler, decoder, niveler, plageStable, TAUX } from './signal.mjs';

/** Fondu de bouclage par défaut, en secondes. */
export const FONDU = 0.12;

/** Longueur de boucle visée quand le choix ne fixe pas les points de bouclage, en secondes. */
export const BOUCLE_DEFAUT = 6;

/**
 * @param {import('./catalogue.mjs').Retenue} retenue
 * @param {import('./emplacements.mjs').Emplacement} emplacement
 * @param {import('./catalogue.mjs').Prise} prise
 * @param {{ niveau?: boolean }} [options]  niveau : régler le niveau (faux pour écouter la prise brute)
 */
export function fabriquer(retenue, emplacement, prise, options = {}) {
  const brut = decoder(cheminPrive(prise.fichier), retenue.debut, retenue.fin);
  if (brut.length < TAUX * 0.05) throw new Error('extrait vide ou illisible');
  const analyse = analyser(brut);
  /** @type {Float32Array} */
  let pcm;
  /** @type {{ debut: number, fin: number, correlation: number } | null} */
  let boucle = null;
  const fondu = retenue.fondu ?? FONDU;
  if (emplacement.genre === 'boucle') {
    const duree = brut.length / TAUX;
    const voulue = retenue.boucle ?? plageStable(brut, Math.min(BOUCLE_DEFAUT, duree - fondu - 0.3), fondu + 0.05);
    const faite = boucler(brut, Math.max(fondu, voulue.debut), Math.min(duree, voulue.fin), fondu);
    pcm = faite.pcm;
    boucle = { debut: faite.debut, fin: faite.fin, correlation: faite.correlation };
  } else {
    pcm = adoucir(brut, 0.008, Math.min(0.15, brut.length / TAUX / 10));
  }
  if (options.niveau === false) return { pcm, boucle, analyse, gainDb: 0, limite: false };
  const reglage = niveler(pcm, emplacement.cible, retenue.gain ?? 0);
  return { pcm: reglage.pcm, boucle, analyse, gainDb: reglage.gainDb, limite: reglage.limite };
}
