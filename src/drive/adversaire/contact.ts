// Le contact entre le joueur et l'adversaire du duel (§ 5.5, jeu). Décision : pas de vraie physique de choc,
// mais les deux véhicules ne se traversent jamais et aucun des deux n'est jamais déplacé d'un coup.
//
// - Quand l'un arrive sur l'autre (moins de `approche` m de pare-chocs à pare-chocs), l'adversaire choisit son
//   côté et le garde jusqu'à ce qu'ils soient à plus de `relache` m : devant ou à sa hauteur, celui où il est
//   (il laisse l'autre côté au joueur qui double) ; derrière, le côté où la chaussée a la place de passer (il
//   double sans couper la route du joueur). Il demande ce bord à son pilote (src/drive/pilote.ts, direction
//   assistée, `lane`), et un écart latéral doux (`ecart`, au plus `ecartParSeconde` m/s, borné par la chaussée)
//   garde les flancs à `garde` m l'un de l'autre.
// - Au contact, ils se gênent comme deux caisses qui frottent : flanc contre flanc, chacun est repoussé de côté
//   (l'adversaire par son écart, le joueur par une poussée `pousse` qui retombe en douceur, au plus
//   `ecartParSeconde` m/s, quand il n'y a plus contact), dans les limites de la chaussée, et tous deux perdent
//   de la vitesse (`frottement` m/s²). Nez contre pare-chocs, celui de derrière est arrêté contre celui de
//   devant (`recul` : de quoi ne pas entrer, quelques centimètres par pas) et roule à sa vitesse : on ne
//   passe pas au travers, on attend la place.
// - Là où la chaussée est trop étroite pour deux (les deux flancs déjà contre les bords), le joueur nettement
//   derrière cède, l'adversaire s'ils sont à la même hauteur : il recule sur l'autre d'au plus `cedeParSeconde`
//   m/s, sans saut.
// - Une fois l'un des deux arrivé (`traversable`, demande du 20 novembre 2026 : « Il faut pas que ça bloque une fois
//   sur la ligne ») : plus de gêne, ni frottement, ni poussée, ni retenue ; l'adversaire prend encore son côté
//   (l'autre passe à côté quand la chaussée a la place, au travers sinon).
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
  /** Poussée latérale du joueur par l'adversaire, m (s'ajoute à l'écart de son pilote ; retombe à 0 sans contact). */
  pousse: number;
  /** Flanc contre flanc à ce pas : les deux perdent de la vitesse. */
  frotte: boolean;
  /** De combien (m) reculer celui qui est retenu à ce pas (0 sans retenue). */
  recul: number;
}

/** Qui est retenu derrière l'autre à ce pas. */
export type Retenue = 'joueur' | 'adversaire' | null;

export function createContact(): EtatContact {
  return { cote: 0, ecart: 0, pousse: 0, frotte: false, recul: 0 };
}

export function remettreContact(c: EtatContact): void {
  c.cote = 0;
  c.ecart = 0;
  c.pousse = 0;
  c.frotte = false;
  c.recul = 0;
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

const borne = (x: number, lo: number, hi: number): number => Math.max(Math.min(lo, hi), Math.min(Math.max(lo, hi), x));

/**
 * Le côté que prend l'adversaire (1 : à gauche du joueur) quand l'un arrive sur l'autre. `d` : de combien il est
 * devant le joueur (m) ; `vu`, `jo` : écarts montrés de l'adversaire et du joueur ; [`lo`, `hi`] : ses limites.
 * Devant ou à sa hauteur, il garde le côté où il est ; derrière, il prend celui où il y a la place de passer
 * (le sien si les deux l'ont).
 */
export function coteLibre(d: number, vu: number, jo: number, g: number, lo: number, hi: number): -1 | 1 {
  const ici: -1 | 1 = vu >= jo ? 1 : -1;
  if (d >= 0) return ici;
  const place = (cote: -1 | 1) => (cote > 0 ? Math.max(lo, hi) - (jo + g) : jo - g - Math.min(lo, hi));
  return place(ici) >= 0 || place(ici) >= place(-ici as -1 | 1) ? ici : (-ici as -1 | 1);
}

/**
 * Un pas de `dt` s. `adv.offset` et `joueur.offset` sont les écarts de leurs PILOTES (sans le décalage
 * d'évitement ni la poussée) ; [`lo`, `hi`] et [`loJ`, `hiJ`] : écarts permis à l'adversaire et au joueur ici
 * (laneLimits). Met à jour le côté, le décalage, la poussée, le frottement et le recul ; rend qui doit être
 * retenu derrière l'autre (de `c.recul` m) pour qu'ils ne se recouvrent pas. `traversable` : l'un des deux est
 * arrivé, ils ne se gênent plus (la poussée retombe, rien n'est retenu).
 */
export function pasContact(c: EtatContact, joueur: CorpsRoute, adv: CorpsRoute, lo: number, hi: number, loJ: number, hiJ: number, reglage: ReglageContact, dt: number, longueur: number, boucle: boolean, traversable = false): Retenue {
  const pas = Math.max(0, Number.isFinite(dt) ? dt : 0);
  const d = devant(joueur.s, adv.s, longueur, boucle);
  const longueurs = joueur.demiLongueur + adv.demiLongueur;
  const largeurs = joueur.demiLargeur + adv.demiLargeur;
  const jour = Math.abs(d) - longueurs;
  const g = largeurs + reglage.garde;
  c.frotte = false;
  c.recul = 0;
  // La poussée du joueur retombe en douceur ; le contact la remettra s'il le faut.
  const retour = reglage.ecartParSeconde * pas;
  c.pousse -= Math.max(-retour, Math.min(retour, c.pousse));
  let jo = borne(joueur.offset + c.pousse, loJ, hiJ);
  c.pousse = jo - joueur.offset;
  const vu = adv.offset + c.ecart;
  if (c.cote === 0 && jour < reglage.approche) c.cote = coteLibre(d, vu, jo, g, lo, hi);
  else if (c.cote !== 0 && jour > reglage.relache) c.cote = 0;
  // Décalage voulu : de quoi garder les flancs à `garde` m, borné par la chaussée ; rien hors d'approche.
  let voulu = 0;
  if (c.cote !== 0 && jour < reglage.approche) {
    const cible = borne(c.cote > 0 ? Math.max(adv.offset, jo + g) : Math.min(adv.offset, jo - g), lo, hi);
    voulu = cible - adv.offset;
  }
  const max = reglage.ecartParSeconde * pas;
  c.ecart += Math.max(-max, Math.min(max, voulu - c.ecart));
  // Au bord de la chaussée, le décalage ne pousse jamais l'adversaire dehors.
  let ao = borne(adv.offset + c.ecart, lo, hi);
  c.ecart = ao - adv.offset;
  if (traversable) return null;
  const penL = longueurs - Math.abs(d);
  const dl = ao - jo;
  const penW = largeurs - Math.abs(dl);
  if (penL <= 0 || penW <= 0) return null;
  if (penW <= penL) {
    // Flanc contre flanc : chacun repoussé de son côté de la moitié du recouvrement, le reste à l'autre s'il est au bord.
    const cote = dl > 0 ? 1 : dl < 0 ? -1 : c.cote || 1;
    const ecarter = penW + 1e-3;
    const a1 = borne(ao + (cote * ecarter) / 2, lo, hi);
    const j1 = borne(jo - cote * (ecarter - Math.abs(a1 - ao)), loJ, hiJ);
    const a2 = borne(ao + cote * (ecarter - Math.abs(j1 - jo)), lo, hi);
    const reste = ecarter - Math.abs(a2 - ao) - Math.abs(j1 - jo);
    ao = a2;
    jo = j1;
    c.ecart = ao - adv.offset;
    c.pousse = jo - joueur.offset;
    c.frotte = true;
    if (reste <= 2e-3) return null;
    // Trop étroit pour deux : le joueur nettement derrière (son avant pas au-delà du milieu de l'adversaire) cède ;
    // à sa hauteur, c'est l'adversaire (on ne bloque pas le joueur). Peu à peu, jamais d'un coup.
    c.recul = Math.min(penL, reglage.cedeParSeconde * pas);
    return d >= longueurs / 2 ? 'joueur' : 'adversaire';
  }
  // Nez contre pare-chocs : celui de derrière est arrêté contre celui de devant.
  c.recul = penL + 0.02;
  return d > 0 ? 'joueur' : 'adversaire';
}

/** Recule l'abscisse `s` de `recul` m (repliée sur une boucle, jamais avant le début d'une route ouverte). */
export function reculer(s: number, recul: number, longueur: number, boucle: boolean): number {
  const r = s - recul;
  if (boucle && longueur > 0) return ((r % longueur) + longueur) % longueur;
  return Math.max(0, r);
}
