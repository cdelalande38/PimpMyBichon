// Mécanique · Moteur : l'établi (§ 5.11, première partie). Ouvrir l'entrée sort le moteur du véhicule
// sur son support (la scène, src/scene/moteur/Etabli.tsx) ; le panneau, tiré des données
// (src/data/moteurs.ts), donne la vue éclatée au curseur, la liste des pièces, le traitement de la
// pièce choisie (sa couleur s'il en a une) et, pour une pièce qui s'échange, ses options. L'origine
// (brut de fonderie) et la peinture haute température sont libres ; un traitement ou une option qui
// n'est pas acquis porte un cadenas et son prix, un appui ouvre le bloc d'achat partagé
// (src/ui/jeu/Achat.tsx), et il s'applique une fois payé. Un véhicule dont le moteur n'a pas encore de
// modèle le dit en une phrase. Ajouter une famille, une pièce ou une option ne touche pas à ce fichier.

import { useLayoutEffect, useRef, useState } from 'react';
import { articleParId } from '../../data/boutique.ts';
import {
  articleEchange,
  articleTraitement,
  clesMoteur,
  cleMoteur,
  echangeLibre,
  ecritTraitement,
  familleOf,
  moteurTouche,
  resolveEchange,
  resolveTraitement,
  sansModele,
  traitementsDe,
  type EchangeOption,
  type MoteurPiece,
  type Traitement,
} from '../../data/moteurs.ts';
import { PAINT_COLORS } from '../../data/paintColors.ts';
import { resolveVehicle } from '../../data/vehicles.ts';
import { possedeDans } from '../../jeu/achats.ts';
import { useEtabli } from '../../scene/moteur/etabli.ts';
import { normalizeHex, useBuilds } from '../../state/builds.ts';
import { useJeu } from '../../state/jeu.ts';
import { Icon } from '../icons.tsx';
import { Achat } from '../jeu/Achat.tsx';
import { dollars } from '../jeu/libelles.ts';
import { Padlock } from '../paint/Padlock.tsx';
import { useRevealPressed } from '../scroll.ts';
import './moteur.css';

/** Ce qu'on est en train d'acheter : un traitement, ou une option d'échange d'une pièce. */
type EnAchat = { vehicle: string; kind: 'traitement'; id: string } | { vehicle: string; kind: 'echange'; piece: string; id: string };

/** Pastille d'un traitement : un aperçu de sa matière (couleur choisie pour la peinture et l'anodisé). */
function Pastille({ traitement, couleur }: { traitement: Traitement; couleur: string | null }) {
  return <span className="moteur-pastille" data-traitement={traitement.id} style={traitement.teinte ? { background: couleur ?? traitement.teinte } : undefined} aria-hidden="true" />;
}

export function MoteurPanel() {
  const vehicle = resolveVehicle(useBuilds((state) => state.current));
  const build = useBuilds((state) => state.builds[vehicle.id]);
  const setPart = useBuilds((state) => state.setPart);
  const setPartPaint = useBuilds((state) => state.setPartPaint);
  const rememberColor = useBuilds((state) => state.rememberColor);
  const resetKeys = useBuilds((state) => state.resetKeys);
  // Ce qui est acheté (src/state/jeu.ts) : le panneau suit un achat sans qu'on ait à le rouvrir.
  const acquis = useJeu((state) => state.articles);
  const eclate = useEtabli((state) => state.eclate);
  const setEclate = useEtabli((state) => state.setEclate);
  const wanted = useEtabli((state) => state.piece);
  const setPiece = useEtabli((state) => state.setPiece);
  const [achat, setAchat] = useState<EnAchat | null>(null);
  // Haut du panneau à l'écran (le dock qui le porte) : la scène cadre le moteur au-dessus.
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const dock = root.current?.closest<HTMLElement>('footer.dock') ?? root.current;
    if (!dock) return undefined;
    const measure = () => useEtabli.getState().setCoverTop(Math.round(dock.getBoundingClientRect().top));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(dock);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      useEtabli.getState().setCoverTop(null);
    };
  }, []);
  const [message, setMessage] = useState<{ vehicle: string; text: string } | null>(null);
  const famille = familleOf(vehicle);
  const piece: MoteurPiece | undefined = famille?.pieces.find((item) => item.id === wanted) ?? famille?.pieces[0];
  const resolved = piece ? resolveTraitement(piece, build) : null;
  const pieceRow = useRevealPressed<HTMLDivElement>(piece?.id ?? '');
  const treatRow = useRevealPressed<HTMLDivElement>(`${piece?.id}:${resolved?.traitement.id}`);

  if (!famille || !piece || !resolved) {
    return (
      <div ref={root} className="moteur" data-testid="moteur">
        <p className="moteur-empty">{sansModele(vehicle)}</p>
      </div>
    );
  }

  const owned = (id: string | undefined) => id === undefined || possedeDans({ articles: acquis }, id);
  const traitementArticle = (traitement: Traitement) => (traitement.libre ? undefined : articleParId(articleTraitement(traitement.id)));
  const traitementLocked = (traitement: Traitement) => !owned(traitementArticle(traitement)?.id);
  const echangeArticle = (option: EchangeOption) => (echangeLibre(piece, option.id) ? undefined : articleParId(articleEchange(piece.id, option.id)));
  const echangeLocked = (option: EchangeOption) => !owned(echangeArticle(option)?.id);

  const key = cleMoteur(piece.id);
  const stored = build?.partPaints?.[key]?.color;
  const applyTraitement = (traitement: Traitement) => setPartPaint(vehicle.id, key, ecritTraitement(traitement, resolved.couleur ?? stored));
  const pickTraitement = (traitement: Traitement) => {
    setMessage(null);
    if (traitementLocked(traitement)) {
      setAchat(achat?.vehicle === vehicle.id && achat.kind === 'traitement' && achat.id === traitement.id ? null : { vehicle: vehicle.id, kind: 'traitement', id: traitement.id });
      return;
    }
    setAchat(null);
    applyTraitement(traitement);
  };
  const paintColor = (hex: string) => {
    const value = normalizeHex(hex);
    if (!value || !resolved.traitement.porte) return;
    setPartPaint(vehicle.id, key, { finish: resolved.traitement.porte, color: value });
    rememberColor(value);
  };

  const posee = resolveEchange(piece, build);
  const poseOption = (id: string) => setPart(vehicle.id, key, piece.echange?.origine === id ? null : id);
  const pickOption = (option: EchangeOption) => {
    setMessage(null);
    if (echangeLocked(option)) {
      setAchat(achat?.vehicle === vehicle.id && achat.kind === 'echange' && achat.id === option.id ? null : { vehicle: vehicle.id, kind: 'echange', piece: piece.id, id: option.id });
      return;
    }
    setAchat(null);
    poseOption(option.id);
  };
  const choosePiece = (id: string) => {
    setAchat(null);
    setMessage(null);
    setPiece(id);
  };

  // Bloc d'achat ouvert : sur le traitement ou l'option touchés, tant qu'ils ne sont pas acquis.
  const achatTraitement = achat?.vehicle === vehicle.id && achat.kind === 'traitement' ? traitementsDe(piece).find((item) => item.id === achat.id) : undefined;
  const achatOption = achat?.vehicle === vehicle.id && achat.kind === 'echange' && achat.piece === piece.id ? piece.echange?.options.find((item) => item.id === achat.id) : undefined;
  const achatTraitementArticle = achatTraitement && traitementLocked(achatTraitement) ? traitementArticle(achatTraitement) : undefined;
  const achatOptionArticle = achatOption && echangeLocked(achatOption) ? echangeArticle(achatOption) : undefined;
  const percent = Math.round(eclate * 100);

  return (
    <div ref={root} className="moteur" data-testid="moteur" data-famille={famille.id} data-piece={piece.id} data-traitement={resolved.traitement.id} data-option={posee?.id}>
      <label className="moteur-eclate">
        <span>Vue éclatée</span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={percent}
          aria-valuetext={percent === 0 ? 'Assemblé' : `Éclaté à ${percent} %`}
          data-testid="moteur-eclate"
          onChange={(event) => setEclate(Number(event.target.value) / 100)}
        />
        <output>{percent === 0 ? 'Assemblé' : `${percent} %`}</output>
      </label>

      <div ref={pieceRow} className="chips moteur-pieces" role="group" aria-label="Pièces du moteur">
        {famille.pieces.map((item) => {
          const look = resolveTraitement(item, build);
          return (
            <button key={item.id} type="button" className="chip moteur-piece" aria-pressed={item.id === piece.id} data-piece={item.id} onClick={() => choosePiece(item.id)}>
              <b>{item.label}</b>
              <small className="moteur-piece-etat">
                <Pastille traitement={look.traitement} couleur={look.couleur} />
                {look.traitement.label}
              </small>
            </button>
          );
        })}
      </div>

      <div ref={treatRow} className="chips moteur-traitements" role="group" aria-label={`Traitement · ${piece.label}`}>
        {traitementsDe(piece).map((traitement) => {
          const shut = traitementLocked(traitement);
          const price = traitementArticle(traitement)?.prix ?? 0;
          return (
            <button
              key={traitement.id}
              type="button"
              className="chip moteur-traitement"
              aria-pressed={resolved.traitement.id === traitement.id}
              aria-expanded={shut ? achatTraitement?.id === traitement.id : undefined}
              aria-label={shut ? `${traitement.label}, verrouillé : ${price} dollars` : traitement.label}
              data-traitement={traitement.id}
              data-verrou={shut ? 'ferme' : undefined}
              onClick={() => pickTraitement(traitement)}
            >
              <b>
                <Pastille traitement={traitement} couleur={resolved.traitement.id === traitement.id ? resolved.couleur : null} />
                {traitement.label}
              </b>
              {shut ? (
                <small className="moteur-prix">
                  <Padlock open={false} className="moteur-lock" />
                  {dollars(price)}
                </small>
              ) : (
                <small className="moteur-hint">{traitement.hint}</small>
              )}
            </button>
          );
        })}
      </div>

      {achatTraitement && achatTraitementArticle && (
        <Achat
          key={`traitement-${achatTraitement.id}`}
          article={achatTraitementArticle}
          nom={achatTraitement.phrase}
          fait={`Payé : ${achatTraitement.phrase} est à toi, pour toutes les pièces de tous tes moteurs.`}
          onClose={() => setAchat(null)}
          onDone={(text) => {
            setAchat(null);
            setMessage({ vehicle: vehicle.id, text });
            applyTraitement(achatTraitement);
          }}
        />
      )}

      {resolved.traitement.teinte && (
        <div className="moteur-swatches" role="group" aria-label={`${resolved.traitement.label} : teinte`}>
          {PAINT_COLORS.map((swatch) => (
            <button key={swatch.id} type="button" className="moteur-swatch" style={{ background: swatch.hex }} aria-label={swatch.label} aria-pressed={resolved.couleur === swatch.hex} onClick={() => paintColor(swatch.hex)} />
          ))}
          <label className="moteur-swatch moteur-swatch-free" style={{ background: resolved.couleur ?? undefined }} title="Autre couleur">
            <span>+</span>
            <input type="color" aria-label="Autre couleur" value={resolved.couleur ?? '#000000'} onChange={(event) => paintColor(event.target.value)} />
          </label>
        </div>
      )}

      {piece.echange && posee && (
        <div className="chips moteur-echange" role="group" aria-label={piece.echange.label}>
          {piece.echange.options.map((option) => {
            const shut = echangeLocked(option);
            const price = echangeArticle(option)?.prix ?? 0;
            return (
              <button
                key={option.id}
                type="button"
                className="chip moteur-option"
                aria-pressed={posee.id === option.id}
                aria-expanded={shut ? achatOption?.id === option.id : undefined}
                aria-label={shut ? `${option.label}, verrouillé : ${price} dollars` : option.label}
                data-option={option.id}
                data-verrou={shut ? 'ferme' : undefined}
                onClick={() => pickOption(option)}
              >
                <b>{option.label}</b>
                {shut ? (
                  <small className="moteur-prix">
                    <Padlock open={false} className="moteur-lock" />
                    {dollars(price)}
                  </small>
                ) : (
                  option.hint && <small className="moteur-hint">{option.hint}</small>
                )}
              </button>
            );
          })}
        </div>
      )}

      {achatOption && achatOptionArticle && (
        <Achat
          key={`echange-${achatOption.id}`}
          article={achatOptionArticle}
          fait="Payé : c’est monté, et l’échange vaut pour tous tes moteurs."
          onClose={() => setAchat(null)}
          onDone={(text) => {
            setAchat(null);
            setMessage({ vehicle: vehicle.id, text });
            poseOption(achatOption.id);
          }}
        />
      )}

      {message?.vehicle === vehicle.id && (
        <p className="moteur-message" role="status">
          {message.text}
        </p>
      )}

      <div className="moteur-head">
        <p className="moteur-note">
          {famille.label}
          {famille.placeholder ? ' · modèle provisoire' : ''}
        </p>
        <button type="button" className="btn moteur-reset" disabled={!moteurTouche(famille, build)} onClick={() => resetKeys(vehicle.id, clesMoteur(famille))}>
          <Icon name="origine" />
          <span>D’origine</span>
        </button>
      </div>
    </div>
  );
}
