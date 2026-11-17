// Départ arrêté, chrono et arrivée de la sortie de nuit (§ 5.5) : le cœur, pur, sans allocation par
// image. La scène (src/drive/scene/moteur.ts) l'avance à chaque image avec le temps de sortie (nul en
// pause) ; l'interface (src/ui/drive/Depart.tsx) le lit pour les feux et le chrono.
//
// Phases : « attente » (la route n'est pas prête), « feux » (le véhicule est tenu sur la ligne : rouge,
// rouge, puis vert), « parti » (le chrono tourne), « arrive » (parcours ouvert : la ligne d'arrivée,
// au bout du parcours, est passée ; le chrono est arrêté). Sur un parcours en boucle, il n'y a pas
// d'arrivée : chaque passage de la ligne de départ fait un tour (dernier tour, meilleur tour) et le
// chrono continue.
//
// Départ lancé (aperçu du début de sortie : la vitrine en pilote automatique) : tenu tant que la
// route n'est pas prête, puis « parti » sans feux ni vert (aucun bip), et aucun temps gardé.
//
// Ni classement, ni adversaire, ni récompense ici : un mode de jeu (contre la montre, par exemple)
// pourra lire cet état et y brancher les siens.

export type PhaseDepart = 'attente' | 'feux' | 'parti' | 'arrive';

export const PHASES_DEPART: readonly PhaseDepart[] = ['attente', 'feux', 'parti', 'arrive'];

/** Réglage des feux, en secondes de temps de sortie. */
export interface ReglageDepart {
  /** Lampes éteintes avant le premier rouge (la scène apparaît). */
  avant: number;
  /** Durée de chaque feu rouge. */
  feu: number;
  /** Nombre de feux rouges avant le vert. */
  rouges: number;
  /** Les lampes s'effacent ce temps après le vert. */
  effacement: number;
}

export const DEPART: Readonly<ReglageDepart> = Object.freeze({ avant: 0.8, feu: 1, rouges: 2, effacement: 1 });

/** Ce que le départ sait du parcours (src/drive/contrat.ts, Rail). */
export interface ParcoursDepart {
  readonly length: number;
  readonly loop: boolean;
}

export interface EtatDepart {
  phase: PhaseDepart;
  /** Départ lancé, sans feux (aperçu) : la scène ne garde pas de temps à l'arrivée. */
  lance: boolean;
  /** Parcours en boucle : des tours, pas d'arrivée. */
  boucle: boolean;
  /** Feux rouges allumés (0 à `rouges`). */
  rouges: number;
  /** Feu vert allumé (toutes les lampes au vert). */
  vert: boolean;
  /** Temps passé dans les feux, en secondes. */
  dansFeux: number;
  /** Temps depuis le vert, en secondes (effacement des lampes). */
  depuisVert: number;
  /** Abscisse de la ligne de départ, en mètres. */
  ligne: number;
  /** Chrono, en millisecondes de temps de sortie depuis le vert ; arrêté à l'arrivée. */
  chrono: number;
  /** Distance parcourue depuis la ligne, en mètres (déroulée sur une boucle). */
  parcouru: number;
  /** Dernière abscisse vue. */
  sPrec: number;
  /** Tours bouclés (parcours en boucle). */
  tours: number;
  /** Chrono au début du tour en cours, en ms. */
  debutTour: number;
  /** Dernier tour et meilleur tour, en ms ; -1 tant qu'il n'y en a pas. */
  dernierTour: number;
  meilleurTour: number;
  /** Temps de l'arrivée, en ms ; -1 tant qu'elle n'est pas passée. */
  arrivee: number;
}

export function createDepart(): EtatDepart {
  return {
    phase: 'attente',
    lance: false,
    boucle: false,
    rouges: 0,
    vert: false,
    dansFeux: 0,
    depuisVert: 0,
    ligne: 0,
    chrono: 0,
    parcouru: 0,
    sPrec: 0,
    tours: 0,
    debutTour: 0,
    dernierTour: -1,
    meilleurTour: -1,
    arrivee: -1,
  };
}

/**
 * Nouveau départ depuis l'abscisse `s` : arrêté (les feux reprendront dès que la route sera prête),
 * ou `lance` (aperçu : parti sans feux dès que la route est prête).
 */
export function armerDepart(etat: EtatDepart, s: number, boucle = false, lance = false): EtatDepart {
  etat.phase = 'attente';
  etat.lance = lance;
  etat.boucle = boucle;
  etat.rouges = 0;
  etat.vert = false;
  etat.dansFeux = 0;
  etat.depuisVert = 0;
  etat.ligne = Number.isFinite(s) ? s : 0;
  etat.chrono = 0;
  etat.parcouru = 0;
  etat.sPrec = etat.ligne;
  etat.tours = 0;
  etat.debutTour = 0;
  etat.dernierTour = -1;
  etat.meilleurTour = -1;
  etat.arrivee = -1;
  return etat;
}

/** Départ lancé sans les feux (prise de diagnostic, véhicule posé ailleurs) : le chrono part de `s`. */
export function lancerDepart(etat: EtatDepart, s: number, boucle = false): EtatDepart {
  armerDepart(etat, s, boucle);
  etat.phase = 'parti';
  etat.vert = true;
  etat.depuisVert = Infinity;
  return etat;
}

/** Le véhicule est-il tenu sur la ligne (route pas prête, ou feux pas encore au vert) ? */
export function tenuSurLaLigne(etat: EtatDepart): boolean {
  return etat.phase === 'attente' || etat.phase === 'feux';
}

/** Les lampes des feux sont-elles à montrer (pendant les feux, puis `effacement` s après le vert) ? */
export function feuxVisibles(etat: EtatDepart, reglage: ReglageDepart = DEPART): boolean {
  return etat.phase === 'feux' || (etat.phase === 'parti' && etat.depuisVert < reglage.effacement);
}

/**
 * Avance le départ de `dt` secondes de temps de sortie (0 en pause : tout se fige). `pret` : la route
 * et le véhicule sont posés ; `s` : abscisse du véhicule après ce pas ; `fini` : bout d'un parcours
 * ouvert atteint (DriveMotion.finished).
 */
export function pasDepart(etat: EtatDepart, dt: number, pret: boolean, s: number, parcours: ParcoursDepart, fini: boolean, reglage: ReglageDepart = DEPART): EtatDepart {
  const pas = Number.isFinite(dt) && dt > 0 ? dt : 0;
  if (etat.phase === 'attente') {
    if (!pret) return etat;
    if (etat.lance) {
      // Aperçu : parti sans feux ; ni vert (aucun bip), ni lampes à effacer.
      etat.phase = 'parti';
      etat.depuisVert = Infinity;
      etat.sPrec = Number.isFinite(s) ? s : etat.sPrec;
      return etat;
    }
    etat.phase = 'feux';
    etat.dansFeux = 0;
  }
  if (etat.phase === 'feux') {
    etat.dansFeux += pas;
    const t = etat.dansFeux - reglage.avant;
    const allumes = t < 0 ? 0 : Math.floor(t / reglage.feu + 1e-9) + 1;
    if (allumes <= reglage.rouges) {
      etat.rouges = allumes;
      return etat;
    }
    // Vert : le chrono part de l'instant exact du vert (le reste du pas compte déjà).
    etat.rouges = reglage.rouges;
    etat.vert = true;
    etat.phase = 'parti';
    const deborde = Math.max(0, t - reglage.rouges * reglage.feu);
    etat.depuisVert = deborde;
    etat.chrono = deborde * 1000;
    etat.sPrec = Number.isFinite(s) ? s : etat.sPrec;
    return etat;
  }
  if (etat.phase === 'arrive') {
    etat.depuisVert += pas;
    return etat;
  }
  // Parti : le chrono tourne, la distance se déroule (une boucle se referme sur elle-même).
  etat.depuisVert += pas;
  const avant = etat.chrono;
  etat.chrono += pas * 1000;
  const ici = Number.isFinite(s) ? s : etat.sPrec;
  let ds = ici - etat.sPrec;
  if (parcours.loop && parcours.length > 0) {
    if (ds > parcours.length / 2) ds -= parcours.length;
    else if (ds < -parcours.length / 2) ds += parcours.length;
  }
  etat.sPrec = ici;
  const parcouruAvant = etat.parcouru;
  etat.parcouru += ds;
  if (parcours.loop) {
    // Un tour à chaque passage de la ligne, à l'instant interpolé dans le pas.
    if (parcours.length > 0 && ds > 0) {
      while (etat.parcouru >= (etat.tours + 1) * parcours.length) {
        const cible = (etat.tours + 1) * parcours.length;
        const passage = avant + ((cible - parcouruAvant) / ds) * (etat.chrono - avant);
        const tour = passage - etat.debutTour;
        etat.tours += 1;
        etat.dernierTour = tour;
        if (etat.meilleurTour < 0 || tour < etat.meilleurTour) etat.meilleurTour = tour;
        etat.debutTour = passage;
      }
    }
    return etat;
  }
  // Parcours ouvert : la ligne d'arrivée est le bout du parcours.
  const ligneArrivee = parcours.length;
  if (fini || ici >= ligneArrivee) {
    const reste = ligneArrivee - (ici - ds);
    const part = ds > 0 ? Math.min(1, Math.max(0, reste / ds)) : 1;
    etat.chrono = avant + part * (etat.chrono - avant);
    etat.arrivee = etat.chrono;
    etat.phase = 'arrive';
  }
  return etat;
}

/** Chrono du tour en cours, en ms (boucle), ou chrono total (parcours ouvert). */
export function chronoDuTour(etat: EtatDepart): number {
  return etat.chrono - etat.debutTour;
}

/** « m:ss.d » : minutes, secondes, dixièmes (arrondis vers le bas, comme un chrono). */
export function formatChrono(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 100) : 0;
  const dixiemes = total % 10;
  const secondes = Math.floor(total / 10) % 60;
  const minutes = Math.floor(total / 600);
  return `${minutes}:${secondes < 10 ? '0' : ''}${secondes}.${dixiemes}`;
}

/** Clé d'un meilleur temps : parcours (carte), départ et véhicule. */
export function cleTemps(carte: string, depart: string, vehicule: string): string {
  return `${carte}|${depart}|${vehicule}`;
}
