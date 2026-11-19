// Le contact entre le joueur et l'adversaire du duel (§ 5.5, jeu). Décision : pas de vraie collision ni de
// physique de choc, mais les deux véhicules ne se traversent jamais.
//
// - Quand le joueur arrive à sa hauteur (moins de `approche` m de pare-chocs à pare-chocs), l'adversaire
//   choisit son côté (celui où il est par rapport au joueur) et le garde jusqu'à ce que le joueur soit
//   repassé à plus de `relache` m : il demande ce bord de la chaussée à son pilote (src/drive/pilote.ts,
//   direction assistée, `lane`), qui s'y range en douceur.
// - Un écart latéral doux (`ecart`, au plus `ecartParSeconde` m/s, borné par la chaussée) l'écarte en plus
//   de ce qu'il faut pour que les flancs restent à `garde` m l'un de l'autre.
// - Si la chaussée est trop étroite pour passer à deux (ou que le joueur le pousse contre le bord) : le joueur
//   nettement derrière est retenu juste derrière l'adversaire, à sa vitesse ; à sa hauteur, c'est l'adversaire
//   qui cède et se range derrière lui (`Retenue`). On ne passe pas au travers, et le joueur n'est jamais
//   bloqué à côté de lui.
//
// Repère de la route : abscisse s (m), écart à l'axe (m, positif à gauche de la marche). Pur, sans
// allocation : l'état est réécrit sur place.

import type { ReglageContact } from '../../data/adversaires.ts';

export interface CorpsRoute {
  s: number;
  /** Écart à l'axe, m, positif à gauche. */
  offset: number;
  demiLargeur: number;
  demiLongueur: number;
}

export interface EtatContact {
  /** Côté choisi par l'adversaire : −1 à droite du joueur, 1 à sa gauche, 0 aucun (il suit sa trajectoire). */
  cote: -1 | 0 | 1;
  /** Décalage latéral d'évitement appliqué à l'adversaire, m (s'ajoute à l'écart de son pilote). */
  ecart: number;
}

/** Qui est retenu derrière l'autre à ce pas. */
export type Retenue = 'joueur' | 'adversaire' | null;

export function createContact(): EtatContact {
  return { cote: 0, ecart: 0 };
}

export function remettreContact(c: EtatContact): void {
  c.cote = 0;
  c.ecart = 0;
}

/** Distance (m) dont `b` est devant `a` le long de la route ; repliée sur une boucle (entre −L/2 et L/2). */
export function devant(sa: number, sb: number, longueur: number, boucle: boolean): number {
  let d = sb - sa;
  if (boucle && longueur > 0) {
    d = ((d % longueur) + longueur) % longueur;
    if (d > longueur / 2) d -= longueur;
  }
  return d;
}

/** Vrai si les deux rectangles (repère de la route) se recouvrent. */
export function recouvrement(a: CorpsRoute, b: CorpsRoute, longueur: number, boucle: boolean): boolean {
  const d = Math.abs(devant(a.s, b.s, longueur, boucle));
  return d < a.demiLongueur + b.demiLongueur - 1e-6 && Math.abs(a.offset - b.offset) < a.demiLargeur + b.demiLargeur - 1e-6;
}

/** Demande de bord au pilote de l'adversaire pour un côté choisi (`DriveInput.lane` : −1 gauche, 1 droite). */
export function laneDuCote(cote: -1 | 0 | 1): -1 | 0 | 1 {
  return cote === 0 ? 0 : cote > 0 ? -1 : 1;
}

/**
 * Un pas de `dt` s. `adv.offset` est l'écart de son PILOTE (sans le décalage d'évitement) ; [`lo`, `hi`] :
 * écarts permis à l'adversaire ici (laneLimits). Met à jour le côté et le décalage, et dit qui doit être
 * retenu pour qu'ils ne se recouvrent pas.
 */
export function pasContact(c: EtatContact, joueur: CorpsRoute, adv: CorpsRoute, lo: number, hi: number, reglage: ReglageContact, dt: number, longueur: number, boucle: boolean): Retenue {
  const d = devant(joueur.s, adv.s, longueur, boucle);
  const longueurs = joueur.demiLongueur + adv.demiLongueur;
  const jour = Math.abs(d) - longueurs;
  const vu = adv.offset + c.ecart;
  if (c.cote === 0 && jour < reglage.approche) c.cote = vu >= joueur.offset ? 1 : -1;
  else if (c.cote !== 0 && jour > reglage.relache) c.cote = 0;
  // Décalage voulu : de quoi garder les flancs à `garde` m, borné par la chaussée ; rien hors d'approche.
  let voulu = 0;
  if (c.cote !== 0 && jour < reglage.approche) {
    const g = joueur.demiLargeur + adv.demiLargeur + reglage.garde;
    let cible = c.cote > 0 ? Math.max(adv.offset, joueur.offset + g) : Math.min(adv.offset, joueur.offset - g);
    cible = Math.max(Math.min(lo, hi), Math.min(Math.max(lo, hi), cible));
    voulu = cible - adv.offset;
  }
  const pas = reglage.ecartParSeconde * Math.max(0, Number.isFinite(dt) ? dt : 0);
  c.ecart += Math.max(-pas, Math.min(pas, voulu - c.ecart));
  // Au bord de la chaussée, le décalage ne pousse jamais l'adversaire dehors.
  const total = Math.max(Math.min(lo, hi), Math.min(Math.max(lo, hi), adv.offset + c.ecart));
  c.ecart = total - adv.offset;
  if (jour >= 0) return null;
  if (Math.abs(joueur.offset - total) >= joueur.demiLargeur + adv.demiLargeur) return null;
  // Ils se recouvriraient : le joueur nettement derrière (son avant pas au-delà du milieu de l'adversaire) est
  // retenu ; à sa hauteur, c'est l'adversaire qui cède et se range derrière lui (on ne bloque pas le joueur).
  return d >= longueurs / 2 ? 'joueur' : 'adversaire';
}

/** Abscisse où retenir le véhicule de derrière (`retenu`), juste derrière celui de devant (`s`). */
export function abscisseRetenue(sDevant: number, longueurs: number, longueur: number, boucle: boolean): number {
  const s = sDevant - longueurs - 0.02;
  if (boucle && longueur > 0) return ((s % longueur) + longueur) % longueur;
  return Math.max(0, s);
}
