// Ce que la bibliothèque des stickers dit d'un motif verrouillé (src/ui/stickers/StickersPanel.tsx),
// en fonctions pures : l'article à acheter pour un motif de pack, la phrase qui dit comment gagner un
// trophée (le haut fait qui l'offre, src/data/hautsFaits.ts).

import { articleParId, type ArticleBoutique } from '../../data/boutique.ts';
import { HAUTS_FAITS } from '../../data/hautsFaits.ts';
import { lockHint, packArticle, stickerArticle, type StickerMotif, type StickerPack } from '../../data/stickers.ts';

/** Article du pack (src/data/boutique.ts), s'il se vend ; `undefined` pour un pack offert ou inconnu. */
export function packForSale(pack: StickerPack | null): ArticleBoutique | undefined {
  if (pack === null) return undefined;
  const article = articleParId(packArticle(pack));
  return article && !article.offert && article.prix !== null && article.prix > 0 ? article : undefined;
}

/** Haut fait qui offre ce sticker de trophée, s'il y en a un. */
export function trophyAchievement(motif: Pick<StickerMotif, 'id'>) {
  const article = stickerArticle(motif.id);
  return HAUTS_FAITS.find((def) => def.recompense.articles?.includes(article));
}

/** Comment gagner un trophée, en une phrase : « Pour le gagner : décroche ta première médaille d’or. » */
export function trophyHint(motif: StickerMotif): string {
  const def = trophyAchievement(motif);
  if (!def) return `${motif.label} : ${lockHint(motif)}`;
  const how = def.description.trim();
  return `Pour le gagner : ${how.charAt(0).toLocaleLowerCase('fr-FR')}${how.slice(1)}`;
}
