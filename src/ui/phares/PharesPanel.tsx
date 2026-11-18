// Entrée « Phares » du dock (Custom) : la couleur de l'éclairage avant, la teinte des optiques (de clair
// à fumé) et les feux arrière, pour le véhicule à l'écran. Trois volets dans le même cadre, un seul à
// la fois : le menu garde sa hauteur et le véhicule reste visible au-dessus. Tout vient des données
// (src/data/phares.ts, articles dans src/data/articles/phares.ts). L'origine est libre ; le reste se
// débloque avec des dollars, sur place : une option verrouillée montre son cadenas et son prix, un
// appui ouvre le bloc d'achat partagé (src/ui/jeu/Achat.tsx), et l'option est posée une fois achetée.
// Une option posée sans être acquise reste en place, et le panneau le dit (src/ui/nonAcquis.tsx).
// Tant que le panneau est ouvert, la caméra du garage cadre l'avant du véhicule (Lumière, Optiques) ou
// son arrière (Feux), au-dessus du menu (src/ui/useCadreBout.ts) ; l'orbite au doigt reste libre.

import { useRef, useState, type ReactNode } from 'react';
import { articleParId, type ArticleBoutique } from '../../data/boutique.ts';
import type { CoteVehicule } from '../../data/framings.ts';
import {
  ARTICLE_TEINTE,
  articleCouleur,
  articleFeux,
  COULEURS_PHARES,
  OPTIONS_FEUX,
  PHARES_SLOTS,
  PHARES_TUNE,
  pharesTouches,
  resolvePhares,
  TEINTE_OPTIQUES,
} from '../../data/phares.ts';
import { resolveVehicle } from '../../data/vehicles.ts';
import { possedeDans } from '../../jeu/achats.ts';
import { useBuilds } from '../../state/builds.ts';
import { useJeu } from '../../state/jeu.ts';
import { Icon } from '../icons.tsx';
import { Achat } from '../jeu/Achat.tsx';
import { dollars } from '../jeu/libelles.ts';
import { nomNonAcquis, NoteNonAcquise } from '../nonAcquis.tsx';
import { Padlock } from '../paint/Padlock.tsx';
import { useRevealPressed } from '../scroll.ts';
import { useCadreBout } from '../useCadreBout.ts';
import './phares.css';

/** Espace fine insécable, entre un nombre et son unité. */
const NNBSP = '\u202f';

type Volet = 'eclairage' | 'optiques' | 'feux';

/** Les volets, et le côté du véhicule que la caméra cadre pendant chacun. */
const VOLETS: ReadonlyArray<{ id: Volet; label: string; cote: CoteVehicule }> = [
  { id: 'eclairage', label: 'Lumière', cote: 'avant' },
  { id: 'optiques', label: 'Optiques', cote: 'avant' },
  { id: 'feux', label: 'Feux', cote: 'arriere' },
];

/** Une puce de choix : libre, posée, ou verrouillée (cadenas et prix ; un appui ouvre l'achat). */
function Choix({
  pressed,
  article,
  owned,
  label,
  hint,
  swatch,
  data,
  onPick,
  onLocked,
}: {
  pressed: boolean;
  article: ArticleBoutique | undefined;
  owned: boolean;
  label: string;
  hint: string;
  swatch?: ReactNode;
  data: Record<string, string>;
  onPick: () => void;
  onLocked: (article: ArticleBoutique) => void;
}) {
  const locked = article !== undefined && !owned;
  return (
    <button
      type="button"
      className={`chip phares-choix${swatch ? ' chip-swatch' : ''}`}
      aria-pressed={pressed}
      aria-label={locked ? (pressed ? nomNonAcquis(label, article.prix) : `${label}, à débloquer pour ${dollars(article.prix ?? 0)}`) : label}
      data-verrou={locked ? 'ferme' : undefined}
      {...data}
      onClick={() => (locked ? onLocked(article) : onPick())}
    >
      {swatch}
      <span className="chip-text">
        <b>{label}</b>
        {locked ? (
          <small className="phares-prix">
            <Padlock open={false} className="phares-cadenas" />
            {dollars(article.prix ?? 0)}
          </small>
        ) : (
          <small>{hint}</small>
        )}
      </span>
    </button>
  );
}

export function PharesPanel() {
  const vehicle = resolveVehicle(useBuilds((state) => state.current));
  const build = useBuilds((state) => state.builds[vehicle.id]);
  const setPart = useBuilds((state) => state.setPart);
  const setTune = useBuilds((state) => state.setTune);
  const resetKeys = useBuilds((state) => state.resetKeys);
  const acquis = useJeu((state) => state.articles);
  const owns = (id: string) => possedeDans({ articles: acquis }, id);
  const [volet, setVolet] = useState<Volet>('eclairage');
  // Article dont le bloc d'achat est ouvert, et la phrase dite après un achat.
  const [achat, setAchat] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const choisis = resolvePhares(build);
  const row = useRevealPressed<HTMLDivElement>(`${volet}/${choisis.couleur.id}/${choisis.feux.id}`);

  const couleur = (id: string, origine: boolean) => setPart(vehicle.id, PHARES_SLOTS.couleur, origine ? null : id);
  const feux = (id: string, origine: boolean) => setPart(vehicle.id, PHARES_SLOTS.feux, origine ? null : id);
  const teinte = (value: number) => setTune(vehicle.id, PHARES_TUNE.teinte, value <= 0 ? null : value);
  const locked = (article: ArticleBoutique) => {
    setMessage(null);
    setAchat(achat === article.id ? null : article.id);
  };
  const pick = (apply: () => void) => {
    setAchat(null);
    setMessage(null);
    apply();
  };
  const teinteLibre = owns(ARTICLE_TEINTE);
  const percent = Math.round(choisis.teinte * 100);

  // Cadrage : l'avant ou l'arrière du véhicule, au-dessus du menu, tant que le panneau est ouvert.
  const root = useRef<HTMLDivElement>(null);
  const cote = VOLETS.find((item) => item.id === volet)?.cote ?? 'avant';
  useCadreBout(root, vehicle.id, cote, `phares-${cote}`);

  /** Bloc d'achat de l'article ouvert, s'il appartient à ce volet ; `poser` : l'option, une fois achetée. */
  const bloc = (ids: readonly string[], poser: (id: string) => void, fait: (article: ArticleBoutique) => string) => {
    if (achat === null || !ids.includes(achat) || owns(achat)) return null;
    const article = articleParId(achat);
    if (!article) return null;
    return (
      <Achat
        article={article}
        fait={fait(article)}
        onClose={() => setAchat(null)}
        onDone={(texte) => {
          setAchat(null);
          poser(article.id);
          setMessage(texte);
        }}
      />
    );
  };

  const couleurs = COULEURS_PHARES.map((item) => ({ item, article: item.origine ? undefined : articleParId(articleCouleur(item.id)) }));
  const optionsFeux = OPTIONS_FEUX.map((item) => ({ item, article: item.origine ? undefined : articleParId(articleFeux(item.id)) }));
  const articleTeinte = articleParId(ARTICLE_TEINTE);
  // Posé sans être acquis (la règle commune, src/ui/nonAcquis.tsx) : l'article de ce qui est posé, s'il manque.
  const sansAchat = (article: ArticleBoutique | undefined) => (article && !owns(article.id) ? article : undefined);
  const couleurSansAchat = sansAchat(couleurs.find(({ item }) => item.id === choisis.couleur.id)?.article);
  const teinteSansAchat = percent > 0 ? sansAchat(articleTeinte) : undefined;
  const feuxSansAchat = sansAchat(optionsFeux.find(({ item }) => item.id === choisis.feux.id)?.article);

  return (
    <div ref={root} className="phares" data-testid="phares" data-cote={cote}>
      <div className="phares-head">
        <div className="phares-volets" role="group" aria-label="Volets des phares">
          {VOLETS.map((item) => (
            <button
              key={item.id}
              type="button"
              className="phares-volet"
              aria-pressed={volet === item.id}
              onClick={() => {
                setVolet(item.id);
                setAchat(null);
              }}
            >
              <span>{item.label}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          className="btn phares-reset"
          disabled={!pharesTouches(build)}
          onClick={() => pick(() => resetKeys(vehicle.id, { parts: [PHARES_SLOTS.couleur, PHARES_SLOTS.feux], tune: [PHARES_TUNE.teinte] }))}
        >
          <Icon name="origine" />
          <span>D’origine</span>
        </button>
      </div>

      {message && (
        <p className="phares-message" role="status">
          {message}
        </p>
      )}

      {volet === 'eclairage' && (
        <>
          <div ref={row} className="chips" role="group" aria-label="Couleur de l’éclairage">
            {couleurs.map(({ item, article }) => (
              <Choix
                key={item.id}
                pressed={choisis.couleur.id === item.id}
                article={article}
                owned={article ? owns(article.id) : true}
                label={item.label}
                hint={item.hint}
                swatch={<span className="swatch phares-pastille" aria-hidden="true" style={{ background: item.color, boxShadow: `0 0 0.5rem ${item.color}` }} />}
                data={{ 'data-phares': item.id }}
                onPick={() => pick(() => couleur(item.id, item.origine === true))}
                onLocked={locked}
              />
            ))}
          </div>
          {bloc(
            couleurs.flatMap(({ article }) => (article ? [article.id] : [])),
            (id) => {
              const found = couleurs.find(({ article }) => article?.id === id);
              if (found) couleur(found.item.id, false);
            },
            (article) => `${article.label} débloqués : c’est posé.`,
          )}
          {couleurSansAchat && <NoteNonAcquise label={choisis.couleur.label} prix={couleurSansAchat.prix} />}
        </>
      )}

      {volet === 'optiques' && (
        <>
          <div ref={row} className="chips" role="group" aria-label="Teinte des optiques">
            <Choix
              pressed={percent === 0}
              article={undefined}
              owned
              label="Claires"
              hint="D’origine"
              data={{ 'data-teinte': 'claire' }}
              onPick={() => pick(() => teinte(0))}
              onLocked={locked}
            />
            <Choix
              pressed={percent > 0}
              article={articleTeinte}
              owned={teinteLibre}
              label="Fumées"
              hint={percent > 0 ? `${percent}${NNBSP}%` : 'Glace sombre'}
              data={{ 'data-teinte': 'fumee' }}
              onPick={() => pick(() => teinte(percent > 0 ? choisis.teinte : TEINTE_OPTIQUES.fume))}
              onLocked={locked}
            />
          </div>
          {bloc(
            [ARTICLE_TEINTE],
            () => teinte(TEINTE_OPTIQUES.fume),
            () => 'Optiques fumées débloquées : règle la teinte au curseur.',
          )}
          {teinteSansAchat && <NoteNonAcquise label="Fumées" prix={teinteSansAchat.prix} />}
          <label className="phares-slider">
            <span>Teinte</span>
            <input
              type="range"
              min={0}
              max={100}
              step={Math.round(TEINTE_OPTIQUES.step * 100)}
              value={percent}
              disabled={!teinteLibre}
              aria-valuetext={percent === 0 ? 'Claires' : `Fumées à ${percent}${NNBSP}%`}
              data-testid="phares-teinte"
              onChange={(event) => teinte(Number(event.target.value) / 100)}
            />
            <output>{percent === 0 ? 'Claires' : `${percent}${NNBSP}%`}</output>
          </label>
        </>
      )}

      {volet === 'feux' && (
        <>
          <div ref={row} className="chips" role="group" aria-label="Feux arrière">
            {optionsFeux.map(({ item, article }) => (
              <Choix
                key={item.id}
                pressed={choisis.feux.id === item.id}
                article={article}
                owned={article ? owns(article.id) : true}
                label={item.label}
                hint={item.hint}
                swatch={<span className="swatch phares-pastille" aria-hidden="true" style={{ background: item.glace ?? '#b3140d' }} />}
                data={{ 'data-feux': item.id }}
                onPick={() => pick(() => feux(item.id, item.origine === true))}
                onLocked={locked}
              />
            ))}
          </div>
          {bloc(
            optionsFeux.flatMap(({ article }) => (article ? [article.id] : [])),
            (id) => {
              const found = optionsFeux.find(({ article }) => article?.id === id);
              if (found) feux(found.item.id, false);
            },
            (article) => `${article.label} débloqués : c’est posé.`,
          )}
          {feuxSansAchat && <NoteNonAcquise label={choisis.feux.label} prix={feuxSansAchat.prix} />}
        </>
      )}
    </div>
  );
}
