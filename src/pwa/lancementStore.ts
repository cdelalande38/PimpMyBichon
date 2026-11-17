// État du lancement vu par l'interface (écran de chargement) et par les flux qui durent (radio) :
// une fine couche sur la machine pure de lancement.ts. Rien ici ne touche au service worker.

import { create } from 'zustand';
import { demarrer, doitRecharger, reduire, type EnvLancement, type EtatLancement, type EvenementLancement } from './lancement.ts';

const TICK_MS = 250;

/** Avant que startPwa() ait décidé : en vérification, comme au vrai lancement (l'écran s'affiche ainsi dès la première image). */
export const useLancement = create<EtatLancement>()(() => demarrer({ indisponible: false, controle: true, enLigne: true, depuisRechargeMs: Number.POSITIVE_INFINITY }, Date.now()));

let attente: Promise<void> | null = null;
let ouvrir: (() => void) | null = null;
let horloge = 0;

function promesse(): Promise<void> {
  attente ??= new Promise<void>((resolve) => {
    ouvrir = resolve;
  });
  return attente;
}

function arreterHorloge(): void {
  if (horloge) window.clearInterval(horloge);
  horloge = 0;
}

function appliquer(etat: EtatLancement): void {
  useLancement.setState(etat, true);
  if (etat.phase === 'entree') {
    // Trace lisible par les parcours et au débogage : pourquoi l'app est entrée, et après combien de temps.
    const racine = document.documentElement;
    racine.dataset.lancement = etat.raison ?? '';
    racine.dataset.lancementMs = String(Math.round(Date.now() - etat.debutMs));
    arreterHorloge();
    ouvrir?.();
    ouvrir = null;
    attente = Promise.resolve();
  }
}

/**
 * Résolu dès que l'app est entrée : tout flux qui dure (musique d'accueil, téléchargement d'un pack)
 * attend ici. Toujours résolu un jour : chaque phase a son délai.
 */
export function attendreLancement(): Promise<void> {
  return useLancement.getState().phase === 'entree' ? Promise.resolve() : promesse();
}

/** Fixe l'état de départ, et lance l'horloge des délais si le lancement attend quelque chose. */
export function lancer(env: EnvLancement): EtatLancement {
  const etat = demarrer(env, Date.now());
  promesse();
  appliquer(etat);
  if (etat.phase !== 'entree') {
    arreterHorloge();
    horloge = window.setInterval(() => envoyer({ type: 'tick' }), TICK_MS);
  }
  return etat;
}

/** Applique un événement ; dit si la transition demande de recharger la page (une version a pris la main). */
export function envoyer(evenement: EvenementLancement): { avant: EtatLancement; apres: EtatLancement; recharger: boolean } {
  const avant = useLancement.getState();
  const apres = reduire(avant, evenement, Date.now());
  if (apres !== avant) appliquer(apres);
  return { avant, apres, recharger: doitRecharger(avant, apres) };
}
