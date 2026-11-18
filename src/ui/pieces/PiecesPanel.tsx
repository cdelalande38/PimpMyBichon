// Panneau d'un poste de pièce montée (Custom · Ailerons aujourd'hui ; sorties d'échappement, lame avant,
// jupes ensuite), tiré des données : les options du catalogue que le manifeste du véhicule permet
// (src/data/pieces.ts), chacune avec sa silhouette, l'option posée cochée. Ce qui n'est pas acquis porte
// un cadenas et son prix : un appui ouvre le bloc d'achat partagé (src/ui/jeu/Achat.tsx), et l'option se
// pose une fois payée. L'origine et l'absence de pièce sont toujours libres. La pièce prend la peinture
// de la caisse, ou sa couleur propre (teintes de la palette ou nuancier, mêmes finitions que Peinture).
// Un véhicule sans ce poste (une moto) le dit. Ajouter une option ou un poste ne touche pas à ce fichier.

import { useState } from 'react';
import { articleParId } from '../../data/boutique.ts';
import { FINISHES } from '../../data/finishes.ts';
import { PAINT_COLORS } from '../../data/paintColors.ts';
import { articleIdOf, isFree, optionsFor, originOf, piecePaint, pieceKeys, pieceTouched, posteById, resolvePiece, type PieceOption } from '../../data/pieces.ts';
import { resolveVehicle } from '../../data/vehicles.ts';
import { possedeDans } from '../../jeu/achats.ts';
import { masterZone, normalizeHex, resolvePaint, useBuilds } from '../../state/builds.ts';
import { useJeu } from '../../state/jeu.ts';
import { Icon } from '../icons.tsx';
import { Achat } from '../jeu/Achat.tsx';
import { dollars } from '../jeu/libelles.ts';
import { Padlock } from '../paint/Padlock.tsx';
import { useRevealPressed } from '../scroll.ts';
import './pieces.css';

/** Silhouette d'une option : l'arrière de la caisse (dessin du poste) et la pièce (dessin de l'option). */
function PictoPiece({ base, path }: { base: string; path: string | null }) {
  return (
    <svg className="picto picto-piece" viewBox="0 0 48 30" aria-hidden="true" focusable="false">
      <path d={base} className="picto-piece-caisse" />
      {path && <path d={path} className="picto-piece-option" />}
    </svg>
  );
}

export function PiecesPanel({ poste: posteId }: { poste: string }) {
  const vehicle = resolveVehicle(useBuilds((state) => state.current));
  const build = useBuilds((state) => state.builds[vehicle.id]);
  const setPart = useBuilds((state) => state.setPart);
  const setPartPaint = useBuilds((state) => state.setPartPaint);
  const rememberColor = useBuilds((state) => state.rememberColor);
  const resetKeys = useBuilds((state) => state.resetKeys);
  // Ce qui est acheté (src/state/jeu.ts) : le panneau suit un achat sans qu'on ait à le rouvrir.
  const acquis = useJeu((state) => state.articles);
  const [achat, setAchat] = useState<{ vehicle: string; option: string } | null>(null);
  const [message, setMessage] = useState<{ vehicle: string; text: string } | null>(null);
  const poste = posteById(posteId);
  const resolved = resolvePiece(vehicle, build, posteId);
  const row = useRevealPressed<HTMLDivElement>(resolved?.id ?? '');
  if (!poste) return null;
  if (!resolved) {
    return (
      <div className="pieces" data-testid="pieces" data-poste={posteId}>
        <p className="pieces-empty">{`${vehicle.name} ${poste.absent}`}</p>
      </div>
    );
  }

  const options = optionsFor(vehicle, posteId);
  const origin = originOf(vehicle, posteId);
  const article = (option: PieceOption) => (isFree(vehicle, posteId, option.id) ? undefined : articleParId(articleIdOf(posteId, option.id)));
  const locked = (option: PieceOption) => {
    const item = article(option);
    return item !== undefined && !possedeDans({ articles: acquis }, item.id);
  };
  const pose = (id: string) => setPart(vehicle.id, posteId, id === origin ? null : id);
  const pick = (id: string) => {
    setMessage(null);
    const option = options.find((item) => item.id === id);
    if (option && locked(option)) {
      setAchat(achat?.vehicle === vehicle.id && achat.option === id ? null : { vehicle: vehicle.id, option: id });
      return;
    }
    setAchat(null);
    pose(id);
  };
  const buying = achat?.vehicle === vehicle.id ? options.find((item) => item.id === achat.option) : undefined;
  const buyingArticle = buying ? article(buying) : undefined;

  const master = masterZone(vehicle);
  const body = master ? resolvePaint(vehicle, build, master.id) : undefined;
  const paint = body ? piecePaint(body, resolved.own) : undefined;
  const own = resolved.own !== null;
  const paintColor = (hex: string) => {
    const value = normalizeHex(hex);
    if (!value) return;
    setPartPaint(vehicle.id, posteId, { color: value });
    rememberColor(value);
  };

  return (
    <div className="pieces" data-testid="pieces" data-poste={posteId} data-option={resolved.id}>
      <div ref={row} className="chips" role="group" aria-label={poste.label}>
        {[{ ...poste.none, picto: null as string | null, option: null as PieceOption | null }, ...options.map((option) => ({ ...option, option }))].map((item) => {
          const shut = item.option !== null && locked(item.option);
          const price = item.option ? article(item.option)?.prix : undefined;
          return (
            <button
              key={item.id}
              type="button"
              className="chip chip-picto pieces-option"
              aria-pressed={resolved.id === item.id}
              aria-expanded={shut ? buying?.id === item.id : undefined}
              aria-label={shut ? `${item.label}, verrouillé : ${price ?? 0} dollars` : item.label}
              data-option={item.id}
              data-verrou={shut ? 'ferme' : undefined}
              onClick={() => pick(item.id)}
            >
              <PictoPiece base={poste.picto} path={item.picto} />
              <span className="chip-text">
                <b>{item.label}</b>
                {shut ? (
                  <small className="pieces-prix">
                    <Padlock open={false} className="pieces-lock" />
                    {dollars(price ?? 0)}
                  </small>
                ) : (
                  item.hint && <small className="pieces-hint">{item.hint}</small>
                )}
              </span>
            </button>
          );
        })}
      </div>
      {buying && buyingArticle && locked(buying) && (
        <Achat
          key={buying.id}
          article={buyingArticle}
          nom={buying.phrase}
          fait={`Payé : ${buying.phrase} t’appartient, et c’est posé.`}
          onClose={() => setAchat(null)}
          onDone={(text) => {
            setAchat(null);
            setMessage({ vehicle: vehicle.id, text });
            pose(buying.id);
          }}
        />
      )}
      {message?.vehicle === vehicle.id && (
        <p className="pieces-message" role="status">
          {message.text}
        </p>
      )}
      <div className="pieces-head">
        {resolved.option && paint ? (
          <div className="pieces-modes" role="group" aria-label={poste.colorLabel}>
            <button type="button" className="pieces-mode" aria-pressed={!own} onClick={() => setPartPaint(vehicle.id, posteId, null)}>
              <span className="pieces-pastille" style={{ background: body?.color }} aria-hidden="true" />
              <span>Comme la caisse</span>
            </button>
            <button type="button" className="pieces-mode" aria-pressed={own} onClick={() => !own && setPartPaint(vehicle.id, posteId, { color: paint.color, finish: paint.finish })}>
              <span className="pieces-pastille" style={{ background: paint.color }} aria-hidden="true" />
              <span>Couleur propre</span>
            </button>
          </div>
        ) : (
          <p className="pieces-note">{resolved.option ? poste.colorLabel : `${poste.none.label} : la caisse reste comme à l’origine.`}</p>
        )}
        <button type="button" className="btn pieces-reset" disabled={!pieceTouched(build, posteId)} onClick={() => resetKeys(vehicle.id, pieceKeys(posteId))}>
          <Icon name="origine" />
          <span>D’origine</span>
        </button>
      </div>
      {resolved.option && own && paint && (
        <>
          <div className="pieces-swatches" role="group" aria-label={`${poste.colorLabel} : teinte`}>
            {PAINT_COLORS.map((swatch) => (
              <button
                key={swatch.id}
                type="button"
                className="pieces-swatch"
                style={{ background: swatch.hex }}
                aria-label={swatch.label}
                aria-pressed={paint.color === swatch.hex}
                onClick={() => paintColor(swatch.hex)}
              />
            ))}
            <label className="pieces-swatch pieces-swatch-free" style={{ background: paint.color }} title="Autre couleur">
              <span>+</span>
              <input type="color" aria-label="Autre couleur" value={paint.color} onChange={(event) => paintColor(event.target.value)} />
            </label>
          </div>
          <div className="chips" role="group" aria-label={`${poste.colorLabel} : finition`}>
            {FINISHES.map((finish) => (
              <button key={finish.id} type="button" className="chip pieces-finish" aria-pressed={paint.finish === finish.id} onClick={() => setPartPaint(vehicle.id, posteId, { finish: finish.id })}>
                <b>{finish.label}</b>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
