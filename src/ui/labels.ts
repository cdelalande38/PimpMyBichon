// Textes calculés de l'interface. Module pur (testable) : français, tutoiement, ton d'atelier.

import type { OfflineStatus } from '../pwa/pwaStore.ts';

/** Libellé de l'indicateur hors ligne ; la partie chiffrée est rendue à part. */
export function offlineLabel(offline: OfflineStatus, online: boolean): string {
  switch (offline) {
    case 'pret':
      return online ? 'Prêt hors ligne' : 'Hors ligne · tout est là';
    case 'preparation':
      return 'Préparation du garage…';
    case 'indisponible':
      return 'Sans cache hors ligne';
    case 'erreur':
      return 'Cache hors ligne en panne';
    case 'dev':
      return 'Mode développement';
    case 'inconnu':
      return '';
  }
}

/** Explication longue du même état, pour « Sous le capot ». */
export function offlineDetail(offline: OfflineStatus, percent: number): string {
  switch (offline) {
    case 'pret':
      return 'Prêt : l’atelier s’ouvre sans réseau.';
    case 'preparation':
      return `Préparation en cours (${percent} %). Garde l’app ouverte et le wifi allumé.`;
    case 'indisponible':
      return 'Ce navigateur ne sait pas garder l’app hors ligne. Essaie avec Chrome.';
    case 'erreur':
      return 'La mise en cache a échoué. Relance l’app avec du réseau.';
    case 'dev':
      return 'Serveur de développement : pas de cache hors ligne.';
    case 'inconnu':
      return 'Vérification…';
  }
}

const NBSP = '\u00a0';

/** « 1,2 Mo », « 340 ko » (espace insécable) ; « inconnu » si le navigateur ne dit rien. */
export function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return 'inconnu';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024).toLocaleString('fr-FR')}${NBSP}ko`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toLocaleString('fr-FR', { maximumFractionDigits: 1 })}${NBSP}Mo`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toLocaleString('fr-FR', { maximumFractionDigits: 1 })}${NBSP}Go`;
}

/** Typographie française : espace insécable devant « : ; ? ! % » et à l'intérieur des guillemets. */
export function typo(text: string): string {
  return text.replace(/ ([:;?!%»])/g, `${NBSP}$1`).replace(/« /g, `«${NBSP}`);
}

/** Accord simple : « 1 moteur », « 3 moteurs ». */
export function count(n: number, singular: string, plural = `${singular}s`): string {
  return `${n.toLocaleString('fr-FR')} ${n > 1 ? plural : singular}`;
}
