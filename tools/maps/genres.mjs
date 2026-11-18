// @ts-check
// Genre des bâtiments des cartes, pour les façades de la sortie (src/drive/scene/materiaux.ts) :
// tiré de l'usage et de la nature du bâtiment dans la donnée (IGN : « Annexe », « Industriel »,
// « Agricole », « Commercial et services », « Religieux », nature « Eglise », « Chapelle »,
// « Château », « Industriel, agricole ou commercial »), et, faute d'usage connu, de sa taille (petit
// et bas : une annexe). Aucun nom, aucune adresse : seulement ces catégories.
//
// Le genre est porté jusqu'à l'app par la hauteur du pied des murs, sans un octet de plus dans la
// carte : le pied (toujours sous le sol) est posé sur une grille de 10 cm, relevé de 10 cm, puis
// abaissé d'autant de centimètres que le genre. src/drive/scene/abri.ts (genreDuPied) le relit.
// Fonctions pures, testées par tests/unit/cartes-genres.test.ts.

/** Genres des façades (même numérotation que src/drive/scene/abri.ts, genreDuPied). */
export const GENRES = /** @type {const} */ ({ ordinaire: 0, annexe: 1, hangar: 2, muret: 3, edifice: 4 });

/**
 * Genre d'un bâtiment d'après la donnée.
 * @param {{ u?: string | null, n?: string | null }} bt usage et nature (IGN ou OSM)
 * @param {number} h hauteur posée (m)
 * @param {number} surface emprise (m²)
 */
export function genreBatiment(bt, h, surface) {
  const u = String(bt.u ?? '');
  const n = String(bt.n ?? '');
  if (/religieux|[eé]glise|chapelle|ch[aâ]teau|cath[eé]drale/i.test(`${u} ${n}`)) return GENRES.edifice;
  if (/industriel|agricole|silo|serre/i.test(u)) return h <= 16 ? GENRES.hangar : GENRES.ordinaire;
  if (/annexe/i.test(u)) return h <= 6 ? GENRES.annexe : GENRES.ordinaire;
  // Grande surface commerciale basse (entrepôt, magasin) ; nature « industriel, agricole ou
  // commercial » sans usage résidentiel.
  if (/commercial/i.test(u) && h <= 9 && surface >= 400) return GENRES.hangar;
  if (/industriel, agricole ou commercial/i.test(n) && !/r[eé]sidentiel/i.test(u) && h <= 12) return GENRES.hangar;
  // Faute d'usage : petit et bas, c'est une annexe (garage, abri, remise).
  if (!/r[eé]sidentiel|commercial|sportif/i.test(u) && h <= 4.2 && surface <= 60) return GENRES.annexe;
  return GENRES.ordinaire;
}

/**
 * Pied des murs portant le genre : sur la grille de 10 cm, relevé de 10 cm, abaissé de `genre` cm
 * (toujours au-dessus de `y`, de 1 à 20 cm). Relu par genreDuPied (src/drive/scene/abri.ts).
 * @param {number} y pied voulu (m, sous le sol)
 * @param {number} genre 0 à 4
 */
export function piedCode(y, genre) {
  return Math.round((Math.ceil(y * 10 - 1e-9) / 10 + 0.1 - genre / 100) * 1000) / 1000;
}

/** Relecture du genre (même calcul que genreDuPied de src/drive/scene/abri.ts). @param {number} y */
export function genreDuPied(y) {
  const g = ((Math.round(-y * 100) % 10) + 10) % 10;
  return g <= 4 ? g : 0;
}
