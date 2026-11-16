// État de la PWA vu par l'interface : précache, mise à jour, installation, réseau.

import { create } from 'zustand';

export type OfflineStatus =
  /** Pas encore de réponse du navigateur. */
  | 'inconnu'
  /** Serveur de développement : pas de service worker. */
  | 'dev'
  /** Navigateur sans service worker : l'app marche, mais pas hors ligne. */
  | 'indisponible'
  /** Première visite : les fichiers de l'app se mettent en cache. */
  | 'preparation'
  /** Tout est en cache : l'app s'ouvre sans réseau. */
  | 'pret'
  /** L'enregistrement du service worker a échoué. */
  | 'erreur';

export interface PwaState {
  offline: OfflineStatus;
  /** Fichiers déjà en cache pendant la préparation. */
  done: number;
  total: number;
  /** Une nouvelle version est téléchargée et attend un geste. */
  updateReady: boolean;
  /** Chrome propose l'installation (événement beforeinstallprompt reçu). */
  canInstall: boolean;
  /**
   * « Plus tard » : le bouton d'installation est rangé (croix de la pastille, ou refus dans la
   * fenêtre du navigateur). Il ne reste que dans Atelier › Sous le capot. Retenu sur l'appareil.
   */
  installLater: boolean;
  /** L'app tourne en fenêtre autonome (installée). */
  standalone: boolean;
  online: boolean;
}

const INSTALL_LATER_KEY = 'pmb-installer-plus-tard';

function readInstallLater(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(INSTALL_LATER_KEY) === '1';
  } catch {
    return false;
  }
}

export const usePwa = create<PwaState>()(() => ({
  offline: 'inconnu',
  done: 0,
  total: 0,
  updateReady: false,
  canInstall: false,
  installLater: readInstallLater(),
  standalone: false,
  online: true,
}));

/** Avancement de la préparation, de 0 à 100. */
export function precachePercent(state: Pick<PwaState, 'done' | 'total'>): number {
  if (state.total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((state.done / state.total) * 100)));
}

/** Range le bouton d'installation (ou le ressort) et le retient sur l'appareil. */
export function setInstallLater(later: boolean): void {
  usePwa.setState({ installLater: later });
  try {
    if (later) localStorage.setItem(INSTALL_LATER_KEY, '1');
    else localStorage.removeItem(INSTALL_LATER_KEY);
  } catch {
    // Stockage refusé (navigation privée) : le choix vaut pour la séance.
  }
}
