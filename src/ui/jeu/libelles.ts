// Mots et nombres du jeu, en français : fonctions pures, testées sans navigateur.

const ESPACE = ' ';

/** « 1 250 $ » : espace insécable entre les milliers et avant le signe. */
export function dollars(n: number): string {
  const entier = Math.max(0, Math.floor(Number.isFinite(n) ? n : 0));
  return `${entier.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ESPACE)}${ESPACE}$`;
}

/** Avec le signe d'un gain : « +50 $ ». */
export function gain(n: number): string {
  return `+${dollars(n)}`;
}

/** Kilomètres à une décimale, virgule française : « 12,3 km ». */
export function kilometres(metres: number): string {
  const km = Math.max(0, metres) / 1000;
  return `${(Math.round(km * 10) / 10).toString().replace('.', ',')}${ESPACE}km`;
}

/** « 1 course », « 3 courses ». */
export function pluriel(n: number, un: string, plusieurs = `${un}s`): string {
  return `${n}${ESPACE}${n > 1 ? plusieurs : un}`;
}
