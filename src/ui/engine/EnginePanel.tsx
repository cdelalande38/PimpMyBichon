// Corps du panneau « moteur » : la fiche de préparation du véhicule à l'écran. Le moteur d'origine
// en clair, les trois chiffres en grand (origine, gain, préparé), une rangée de puces par poste.
// Les postes et les gains sont des données (src/data/enginePrep.ts) ; les choix vont dans le build.
// Chaque option au-dessus de l'origine est un article de la boutique, valable pour tous les véhicules :
// non acquise, elle porte un cadenas et son prix, et un appui ouvre le bloc d'achat partagé
// (src/ui/jeu/Achat.tsx) ; payée, elle se monte. Une option déjà montée sans l'article (une sauvegarde
// d'avant) reste montée et continue d'agir : rien n'est retiré (src/ui/nonAcquis.tsx).

import { useId, useState } from 'react';
import {
  BOOST_LABEL,
  FEED_LABEL,
  FUEL_LABEL,
  ORIGIN_LABEL,
  articlePrep,
  chosenOption,
  computePrep,
  gainPieces,
  resultLabelFor,
  slotsFor,
  type PrepOption,
  type PrepSlot,
} from '../../data/enginePrep.ts';
import { articleParId } from '../../data/boutique.ts';
import type { Build, VehicleId } from '../../data/vehicleTypes.ts';
import { resolveVehicle } from '../../data/vehicles.ts';
import { possedeDans } from '../../jeu/achats.ts';
import { useBuilds } from '../../state/builds.ts';
import { useJeu } from '../../state/jeu.ts';
import { Achat } from '../jeu/Achat.tsx';
import { dollars } from '../jeu/libelles.ts';
import { nomNonAcquis, NoteNonAcquise } from '../nonAcquis.tsx';
import { Padlock } from '../paint/Padlock.tsx';
import { EngineSoundControls } from './EngineSoundControls.tsx';
import './engine.css';

const NBSP = ' ';

function hp(value: number): string {
  return `${value}${NBSP}ch`;
}

/** Option dont le bloc d'achat est ouvert : poste et option. */
interface EnAchat {
  vehicle: VehicleId;
  slot: string;
  option: string;
}

function SlotRow({
  slot,
  vehicle,
  build,
  engine,
  achat,
  setAchat,
  setMessage,
}: {
  slot: PrepSlot;
  vehicle: VehicleId;
  build: Build | undefined;
  engine: Parameters<typeof chosenOption>[0];
  achat: EnAchat | null;
  setAchat: (achat: EnAchat | null) => void;
  setMessage: (text: string | null) => void;
}) {
  const setPart = useBuilds((state) => state.setPart);
  // Ce qui est acheté (src/state/jeu.ts) : la fiche suit un achat sans qu'on ait à la rouvrir.
  const acquis = useJeu((state) => state.articles);
  const titleId = useId();
  const chosen = chosenOption(engine, build, slot.id);
  const article = (option: PrepOption) => articleParId(articlePrep(slot.id, option.id));
  const locked = (option: PrepOption) => {
    const item = article(option);
    return item !== undefined && !possedeDans({ articles: acquis }, item.id);
  };
  const enAchat = achat?.vehicle === vehicle && achat.slot === slot.id ? slot.options.find((option) => option.id === achat.option && locked(option)) : undefined;
  const enAchatArticle = enAchat ? article(enAchat) : undefined;
  return (
    <section className="engine-slot" aria-labelledby={titleId}>
      <h3 id={titleId}>{slot.label}</h3>
      <p className="engine-hint">{slot.hint}</p>
      <div className="chips engine-chips" role="group" aria-labelledby={titleId}>
        <button
          type="button"
          className="chip"
          aria-pressed={chosen === undefined}
          onClick={() => {
            setAchat(null);
            setMessage(null);
            setPart(vehicle, slot.id, null);
          }}
        >
          {ORIGIN_LABEL}
          <small>Comme sorti d’usine</small>
        </button>
        {slot.options.map((option) => {
          const shut = locked(option);
          return (
            <button
              key={option.id}
              type="button"
              className="chip"
              data-option={option.id}
              data-verrou={shut ? 'ferme' : undefined}
              aria-pressed={chosen?.id === option.id}
              aria-expanded={shut ? enAchat?.id === option.id : undefined}
              aria-label={shut ? (chosen?.id === option.id ? nomNonAcquis(option.label, option.prix) : `${option.label}, verrouillé : ${option.prix} dollars`) : undefined}
              onClick={() => {
                setMessage(null);
                if (shut) {
                  setAchat(enAchat?.id === option.id ? null : { vehicle, slot: slot.id, option: option.id });
                  return;
                }
                setAchat(null);
                setPart(vehicle, slot.id, option.id);
              }}
            >
              {option.label}
              <small>{option.hint}</small>
              {shut && (
                <small className="engine-prix">
                  <Padlock open={false} className="engine-lock" />
                  {dollars(option.prix)}
                </small>
              )}
            </button>
          );
        })}
      </div>
      {/* Une option montée sans être acquise reste en place : la fiche le dit (src/ui/nonAcquis.tsx). */}
      {chosen && locked(chosen) && <NoteNonAcquise label={chosen.label} prix={chosen.prix} />}
      {enAchat && enAchatArticle && (
        <Achat
          key={`${slot.id}-${enAchat.id}`}
          article={enAchatArticle}
          fait={`Payé, c’est monté : ${enAchatArticle.label}, sur tous tes véhicules.`}
          onClose={() => setAchat(null)}
          onDone={(text) => {
            setAchat(null);
            setMessage(text);
            setPart(vehicle, slot.id, enAchat.id);
          }}
        />
      )}
    </section>
  );
}

export function EnginePanel() {
  const current = useBuilds((state) => state.current);
  const builds = useBuilds((state) => state.builds);
  const setPart = useBuilds((state) => state.setPart);
  const vehicle = resolveVehicle(current);
  const engine = vehicle?.engine;
  const prep = vehicle ? computePrep(vehicle, builds[vehicle.id]) : null;
  const pieces = vehicle ? gainPieces(vehicle, builds[vehicle.id]) : null;
  const [achat, setAchat] = useState<EnAchat | null>(null);
  const [message, setMessage] = useState<{ vehicle: VehicleId; text: string } | null>(null);

  if (!vehicle || !engine || !prep) {
    return (
      <div className="engine">
        <EngineSoundControls />
        <p className="engine-empty">
          {vehicle ? `${vehicle.name} n’a pas encore de moteur déclaré` : 'Aucun véhicule à l’écran'}
          &nbsp;: pas de fiche de préparation pour l’instant.
        </p>
      </div>
    );
  }

  const build = builds[vehicle.id];
  const slots = slotsFor(engine);
  const touched = slots.some((slot) => chosenOption(engine, build, slot.id) !== undefined);

  return (
    <div className="engine" data-agrandir="toujours">
      <EngineSoundControls />
      <p className="engine-spec">
        <strong>{engine.label}</strong>
        <span>
          {[FUEL_LABEL[engine.fuel], FEED_LABEL[engine.feed], BOOST_LABEL[engine.boost]].join(' · ')}
        </span>
      </p>

      <dl className="engine-figures" aria-live="polite">
        <div>
          <dt>Origine</dt>
          <dd data-testid="moteur-origine">{hp(prep.origin)}</dd>
        </div>
        <div className="engine-gain">
          <dt>Gain</dt>
          <dd data-testid="moteur-gain">{`+${NBSP}${hp(prep.gain)}`}</dd>
        </div>
        <div className="engine-result">
          <dt>{resultLabelFor(engine)}</dt>
          <dd data-testid="moteur-prepare">{hp(prep.prepared)}</dd>
        </div>
      </dl>

      {/* Pièces optimisées sur l'établi (Mécanique · Moteur) : comprises dans le gain et le total. */}
      {pieces && pieces.pourcent > 0 && (
        <p className="engine-note engine-pieces" data-testid="moteur-pieces">
          Dont pièces du moteur&nbsp;: <strong>{`+${NBSP}${pieces.pourcent}${NBSP}%`}</strong>, soit {`+${NBSP}${hp(pieces.chevaux)}`}, réglées dans Moteur.
        </p>
      )}

      {prep.nitro > 0 && (
        <p className="engine-nitro" data-testid="moteur-nitro">
          Bouteille ouverte&nbsp;: <strong>{`+${NBSP}${hp(prep.nitro)}`}</strong>, soit {hp(prep.withNitro)}{' '}
          le temps de la poussée.
        </p>
      )}

      {slots.map((slot) => (
        <SlotRow key={slot.id} slot={slot} vehicle={vehicle.id} build={build} engine={engine} achat={achat} setAchat={setAchat} setMessage={(text) => setMessage(text === null ? null : { vehicle: vehicle.id, text })} />
      ))}

      {message?.vehicle === vehicle.id && (
        <p className="engine-message" role="status">
          {message.text}
        </p>
      )}

      <button
        type="button"
        className="btn engine-reset"
        disabled={!touched}
        onClick={() => {
          setAchat(null);
          setMessage(null);
          for (const slot of slots) setPart(vehicle.id, slot.id, null);
        }}
      >
        Tout remettre d’origine
      </button>

      <p className="engine-note">
        Chiffres d’atelier pour le plaisir, pas un passage au banc&nbsp;: on ne simule pas la mécanique.
      </p>
    </div>
  );
}
