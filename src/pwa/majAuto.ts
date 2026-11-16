// Mise à jour appliquée d'office (retour du 16 novembre 2026 : le bandeau « Nouvelle version » du
// menu passait inaperçu, le téléphone restait des heures sur l'ancienne version, alors que les cartes,
// hors précache, étaient déjà les nouvelles). Règle pure, branchée par src/pwa/register.ts :
// tant que l'utilisateur n'a rien touché, une version déjà téléchargée s'applique d'elle-même ; dès
// le premier geste, on la propose seulement.

export interface EtatMiseAJour {
  /** Un geste a déjà eu lieu dans cette page (appui, touche). */
  geste: boolean;
  /** L'écran courant est la sortie de nuit (elle se regarde sans toucher : pas de rechargement en route). */
  enSortie: boolean;
  /** Temps écoulé depuis le lancement de la page, en millisecondes. */
  depuisLancementMs: number;
  /** Temps écoulé depuis la dernière mise à jour appliquée d'office dans cet onglet, en millisecondes. */
  depuisDerniereMs: number;
}

export const MAJ_AUTO = Object.freeze({
  /** En sortie de nuit, on ne recharge d'office que dans les premières secondes. */
  debutSortieMs: 4000,
  /** Jamais deux rechargements d'office coup sur coup (garde contre une boucle). */
  gardeMs: 60_000,
});

export function peutAppliquerDoffice(etat: EtatMiseAJour): boolean {
  if (etat.geste) return false;
  if (etat.enSortie && etat.depuisLancementMs > MAJ_AUTO.debutSortieMs) return false;
  return etat.depuisDerniereMs >= MAJ_AUTO.gardeMs;
}
