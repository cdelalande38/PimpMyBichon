// Mise à jour au lancement (demande du commanditaire, 17 novembre 2026 : « profiter de l'écran de
// chargement pour faire les vérifications »). Machine d'états PURE : phases, délais, décisions. Le
// branchement (service worker, écran, rechargement) est dans register.ts et lancementStore.ts.
//
// Déroulé :
//   verification   : on demande au navigateur s'il existe une nouvelle version (court délai) ;
//   telechargement : une nouvelle version s'installe, l'écran montre l'avancement ; « Plus tard »
//                    laisse entrer, la version s'appliquera au prochain lancement ;
//   application    : la version est prête, on lui passe la main ; la page se recharge UNE fois, au
//                    changement de version effectif (controllerchange), jamais à l'aveugle ;
//   entree         : l'app s'ouvre (et la musique d'accueil peut partir).
// Sans service worker aux commandes (première visite, navigateur sans), sans réseau, ou si la
// vérification échoue ou tarde : on entre tout de suite, sans attendre davantage. Après un
// rechargement provoqué ici, on n'en refait pas un second avant `gardeMs` (garde contre une boucle).

export type PhaseLancement = 'verification' | 'telechargement' | 'application' | 'entree';

export type RaisonEntree =
  /** Aucun service worker possible (développement, navigateur sans) : rien à vérifier. */
  | 'indisponible'
  /** Première visite : pas de service worker aux commandes, donc pas d'ancienne version. */
  | 'premiere-visite'
  | 'hors-ligne'
  /** La page vient d'être rechargée par ce même écran : on ne recommence pas avant la garde. */
  | 'deja-recharge'
  | 'aucune-version'
  | 'echec'
  /** La vérification n'a pas répondu à temps. */
  | 'delai'
  | 'plus-tard'
  /** Le téléchargement n'avance plus, ou dure trop. */
  | 'trop-lent'
  /** La nouvelle version est prête mais l'ancienne ne lui laisse pas la main : proposée, sans recharger. */
  | 'activation-lente'
  /** La nouvelle version a pris la main : la page doit se recharger (une fois). */
  | 'recharge';

export interface EtatLancement {
  phase: PhaseLancement;
  /** Pourquoi on est entré (seulement en phase `entree`). */
  raison: RaisonEntree | null;
  /** Début de la phase courante (ms, horloge de l'appelant). */
  depuisMs: number;
  /** Dernier signe de vie du téléchargement. */
  progresMs: number;
  /** Début du lancement. */
  debutMs: number;
  /** Fichiers déjà installés, sur combien (0 tant que le service worker ne l'a pas dit). */
  done: number;
  total: number;
}

export const LANCEMENT = Object.freeze({
  /** Délai de la vérification : au-delà, on entre (la réponse tardive sera proposée dans le menu). */
  verificationMs: 3500,
  /** Téléchargement sans aucun progrès pendant ce temps : on entre. */
  sansProgresMs: 20_000,
  /** Durée maximale de l'attente d'un téléchargement. */
  telechargementMaxMs: 120_000,
  /** La version est prête : temps laissé à l'ancienne pour lui passer la main. */
  activationMs: 8_000,
  /** Pas de second rechargement de lancement avant ce délai. */
  gardeMs: 60_000,
});

export interface EnvLancement {
  /** Mode développement ou navigateur sans service worker. */
  indisponible: boolean;
  /** Un service worker est déjà aux commandes de la page. */
  controle: boolean;
  enLigne: boolean;
  /** Temps écoulé depuis le dernier rechargement provoqué par cet écran (Infinity : jamais). */
  depuisRechargeMs: number;
}

export type EvenementLancement =
  /** Réponse de la vérification : rien de nouveau, une version qui s'installe, une version prête, ou un échec. */
  | { type: 'verifie'; version: 'aucune' | 'en-cours' | 'prete' | 'echec' }
  /** Progression du précache d'une version qui s'installe. */
  | { type: 'progres'; done: number; total: number }
  /** La nouvelle version est installée et attend la main. */
  | { type: 'prete' }
  /** L'installation a échoué (service worker devenu redondant). */
  | { type: 'perdue' }
  /** Une nouvelle version a pris la main (controllerchange). */
  | { type: 'controle' }
  | { type: 'plus-tard' }
  | { type: 'tick' };

function entree(etat: EtatLancement, raison: RaisonEntree, now: number): EtatLancement {
  return { ...etat, phase: 'entree', raison, depuisMs: now };
}

/** État au lancement : on entre aussitôt, ou on passe à la vérification. */
export function demarrer(env: EnvLancement, now: number): EtatLancement {
  const base: EtatLancement = { phase: 'verification', raison: null, depuisMs: now, progresMs: now, debutMs: now, done: 0, total: 0 };
  if (env.indisponible) return entree(base, 'indisponible', now);
  if (!env.controle) return entree(base, 'premiere-visite', now);
  if (!env.enLigne) return entree(base, 'hors-ligne', now);
  if (env.depuisRechargeMs < LANCEMENT.gardeMs) return entree(base, 'deja-recharge', now);
  return base;
}

function passerA(etat: EtatLancement, phase: 'telechargement' | 'application', now: number): EtatLancement {
  return { ...etat, phase, depuisMs: now, progresMs: now };
}

/** Transition : un événement, à l'instant `now`. Hors des phases qui l'attendent, l'événement est ignoré. */
export function reduire(etat: EtatLancement, evenement: EvenementLancement, now: number): EtatLancement {
  if (etat.phase === 'entree') return etat;
  switch (evenement.type) {
    case 'verifie': {
      if (etat.phase !== 'verification') return etat;
      switch (evenement.version) {
        case 'aucune':
          return entree(etat, 'aucune-version', now);
        case 'echec':
          return entree(etat, 'echec', now);
        case 'en-cours':
          return passerA(etat, 'telechargement', now);
        case 'prete':
          return passerA(etat, 'application', now);
      }
      return etat;
    }
    case 'progres': {
      // Un message de progression pendant la vérification prouve qu'une version s'installe.
      const courant = etat.phase === 'verification' ? passerA(etat, 'telechargement', now) : etat;
      if (courant.phase !== 'telechargement') return etat;
      return { ...courant, done: evenement.done, total: evenement.total, progresMs: now };
    }
    case 'prete':
      return etat.phase === 'application' ? etat : passerA(etat, 'application', now);
    case 'perdue':
      return etat.phase === 'telechargement' || etat.phase === 'application' ? entree(etat, 'echec', now) : etat;
    case 'controle':
      return entree(etat, 'recharge', now);
    case 'plus-tard':
      return etat.phase === 'telechargement' ? entree(etat, 'plus-tard', now) : etat;
    case 'tick':
      switch (etat.phase) {
        case 'verification':
          return now - etat.depuisMs >= LANCEMENT.verificationMs ? entree(etat, 'delai', now) : etat;
        case 'telechargement':
          if (now - etat.progresMs >= LANCEMENT.sansProgresMs || now - etat.depuisMs >= LANCEMENT.telechargementMaxMs) {
            return entree(etat, 'trop-lent', now);
          }
          return etat;
        case 'application':
          return now - etat.depuisMs >= LANCEMENT.activationMs ? entree(etat, 'activation-lente', now) : etat;
      }
      return etat;
  }
}

/** Vrai quand la transition `avant` → `apres` demande de recharger la page (une version a pris la main). */
export function doitRecharger(avant: EtatLancement, apres: EtatLancement): boolean {
  return avant.phase !== 'entree' && apres.phase === 'entree' && apres.raison === 'recharge';
}

/** Vrai tant que l'écran de chargement doit rester pour la mise à jour. */
export function lancementEnCours(etat: Pick<EtatLancement, 'phase'>): boolean {
  return etat.phase !== 'entree';
}

/** Vrai quand on entre sans recharger alors qu'une version en attente reste à proposer. */
export function entreeAvecOffre(etat: Pick<EtatLancement, 'phase' | 'raison'>): boolean {
  return etat.phase === 'entree' && etat.raison !== 'recharge' && etat.raison !== 'premiere-visite' && etat.raison !== 'indisponible';
}

/** Avancement du téléchargement, de 0 à 100 (0 tant que le total est inconnu). */
export function pourcentage(etat: Pick<EtatLancement, 'done' | 'total'>): number {
  if (etat.total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((etat.done / etat.total) * 100)));
}
