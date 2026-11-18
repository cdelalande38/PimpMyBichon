// Adresses des dessins des stickers (src/data/stickers/<id>.svg), servis par l'app : aucune requête
// vers un tiers, aucun dessin intégré au code (chaque fichier garde son adresse, mis en cache hors
// ligne avec le reste du build). À part de src/data/stickers.ts : seul Vite sait lire ce glob.

const FILES = import.meta.glob<string>('./stickers/*.svg', { query: '?url&no-inline', import: 'default', eager: true });

/** Adresse du dessin d'un motif ; `undefined` si le fichier manque. */
export function stickerUrl(id: string): string | undefined {
  return FILES[`./stickers/${id}.svg`];
}

/** Identifiants des dessins présents (tests : chaque motif du catalogue a son fichier). */
export function stickerFiles(): string[] {
  return Object.keys(FILES).map((path) => path.replace(/^\.\/stickers\//, '').replace(/\.svg$/, ''));
}
