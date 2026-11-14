// Seul module qui touche à la constante injectée par le build.
export const BUILD = __PMB_BUILD__;

/** « 14 nov. 2026 » à partir de la date ISO du commit ; chaîne vide si inconnue. */
export function formatBuildDate(iso: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}
