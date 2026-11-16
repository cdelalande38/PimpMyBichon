// Ce que l'app doit lâcher avant d'appliquer une mise à jour. Une nouvelle version du service worker
// ne prend la main que lorsque l'ancienne n'a plus aucune requête en cours ; un flux qui dure (un
// morceau de la radio en lecture ou en cours de mise en tampon) la fait attendre indéfiniment, et le
// rechargement de secours part alors au mauvais moment (page bloquée, constaté le 16 novembre 2026).
// Les modules qui tiennent un tel flux s'inscrivent ici ; src/pwa/register.ts les appelle juste avant
// de demander l'activation. La page se recharge aussitôt après : rien n'a besoin d'être remis en état.

const taches = new Set<() => void>();

/** Inscrit une tâche à faire avant une mise à jour ; rend de quoi la retirer. */
export function avantMiseAJour(tache: () => void): () => void {
  taches.add(tache);
  return () => {
    taches.delete(tache);
  };
}

/** Lance les tâches inscrites ; une tâche qui échoue n'empêche ni les autres ni la mise à jour. */
export function preparerMiseAJour(): void {
  for (const tache of taches) {
    try {
      tache();
    } catch {
      // Sans conséquence : la page va se recharger.
    }
  }
}
