// Entrée « Suspension » du dock (Custom) : l'assiette du véhicule à l'écran. Quatre préréglages
// (rehaussée, origine, rabaissée, posée au sol) et un curseur fin, en part de la descente possible : la
// place au-dessus des roues (passage de roue, garde-boue) et sous la caisse, déclarée par le manifeste et
// réduite par de plus grandes roues (src/data/wheels.ts) ; en dessous de l'origine, en part de la montée
// (`RIDE_RISE`). Les roues restent au sol, la caisse descend ou monte : chaque cran le montre en petit
// (src/ui/pictos/), tiré de sa valeur, et dit son terrain (« Sec : + +, pluie : =, neige : − − »,
// src/data/preparation.ts). L'assiette rehaussée se débloque avec des dollars, sur place : cadenas et
// prix, puis le bloc d'achat partagé ; acquise, le curseur descend aussi sous l'origine.

import { useState } from 'react';
import { articleParId } from '../../data/boutique.ts';
import { ARTICLE_REHAUSSE, articleAssiette, ligneAssiette } from '../../data/preparation.ts';
import { resolveVehicle } from '../../data/vehicles.ts';
import { RIDE_PRESETS, RIDE_RISE, resolveWheels, WHEEL_TUNE, wheelKind } from '../../data/wheels.ts';
import { possedeDans } from '../../jeu/achats.ts';
import { useBuilds } from '../../state/builds.ts';
import { useDock } from '../../state/dock.ts';
import { useJeu } from '../../state/jeu.ts';
import { Achat } from '../jeu/Achat.tsx';
import { dollars } from '../jeu/libelles.ts';
import { Padlock } from '../paint/Padlock.tsx';
import { PictoAssiette } from '../pictos/Pictos.tsx';
import './wheels.css';

/** Espace fine insécable, entre un nombre et son unité. */
const NNBSP = '\u202f';

const cm = (meters: number) => `${(meters * 100).toFixed(1).replace('.', ',')}${NNBSP}cm`;

export function SuspensionPanel() {
  const current = useBuilds((state) => state.current);
  const builds = useBuilds((state) => state.builds);
  const setTune = useBuilds((state) => state.setTune);
  const openEntry = useDock((state) => state.openEntry);
  const acquis = useJeu((state) => state.articles);
  const [achat, setAchat] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const vehicle = resolveVehicle(current);
  const wheels = resolveWheels(vehicle, builds[vehicle.id]);

  if (!wheels) {
    return (
      <div className="wheels">
        <p className="wheels-empty">{vehicle.name} n’a pas encore de suspension réglable.</p>
      </div>
    );
  }

  const percent = Math.round(wheels.ride * 100);
  const set = (value: number | null) => setTune(vehicle.id, WHEEL_TUNE.ride, value);
  const tight = wheels.maxDrop < 0.01;
  // La montée (sous l'origine) est à débloquer : sans elle, le curseur part de l'origine.
  const monte = possedeDans({ articles: acquis }, ARTICLE_REHAUSSE);
  const hauteur = wheels.drop > 0 ? `${cm(wheels.drop)} plus bas` : wheels.drop < 0 ? `${cm(-wheels.drop)} plus haut` : 'Origine';
  const ouvert = achat !== null && !possedeDans({ articles: acquis }, achat) ? articleParId(achat) : undefined;

  return (
    <div className="wheels" data-testid="suspension">
      <div className="chips" role="group" aria-label="Assiette">
        {RIDE_PRESETS.map((preset) => {
          // Les trois assiettes de toujours sont libres ; une nouvelle a son article.
          const article = preset.value === 0 ? undefined : articleParId(articleAssiette(preset.id));
          const locked = article !== undefined && !possedeDans({ articles: acquis }, article.id);
          const terrain = ligneAssiette(preset.id);
          return (
            <button
              key={preset.id}
              type="button"
              className="chip chip-picto"
              aria-pressed={Math.abs(wheels.ride - preset.value) < 0.005}
              aria-label={`${preset.label}${locked ? `, à débloquer pour ${dollars(article.prix ?? 0)}` : ''}. ${terrain}`}
              title={preset.hint}
              data-assiette={preset.id}
              data-verrou={locked ? 'ferme' : undefined}
              onClick={() => {
                setMessage(null);
                if (locked) setAchat(achat === article.id ? null : article.id);
                else {
                  setAchat(null);
                  set(preset.value === 0 ? null : preset.value);
                }
              }}
            >
              <PictoAssiette part={preset.value} />
              <span className="chip-text">
                <span className="wheels-titre">
                  <b>{preset.label}</b>
                  {locked && (
                    <small className="wheels-prix">
                      <Padlock open={false} className="wheels-cadenas" />
                      {dollars(article.prix ?? 0)}
                    </small>
                  )}
                </span>
                <small className="wheels-terrain" data-terrain={preset.id}>
                  {terrain}
                </small>
              </span>
            </button>
          );
        })}
      </div>
      {ouvert && (
        <Achat
          article={ouvert}
          nom={`l’${ouvert.label.charAt(0).toLowerCase()}${ouvert.label.slice(1)}`}
          fait={`${ouvert.label} débloquée : elle est réglée.`}
          onClose={() => setAchat(null)}
          onDone={(texte) => {
            const preset = RIDE_PRESETS.find((item) => articleAssiette(item.id) === ouvert.id);
            setAchat(null);
            if (preset) set(preset.value === 0 ? null : preset.value);
            setMessage(texte);
          }}
        />
      )}
      {message && (
        <p className="wheels-message" role="status">
          {message}
        </p>
      )}
      <label className="wheels-slider">
        <span>Hauteur</span>
        <input
          type="range"
          min={monte ? -100 : 0}
          max={100}
          step={1}
          value={percent}
          disabled={tight && !monte}
          aria-valuetext={hauteur}
          data-testid="suspension-hauteur"
          onChange={(event) => {
            const value = Number(event.target.value) / 100;
            set(value === 0 ? null : value);
          }}
        />
        <output data-testid="suspension-descente">{wheels.drop > 0 ? `−${cm(wheels.drop)}` : wheels.drop < 0 ? `+${cm(-wheels.drop)}` : 'Origine'}</output>
      </label>
      <p className="wheels-note">
        <span>
          {tight
            ? 'Plus de place sous les ailes : une jante plus petite ou un flanc plus bas, et ça descend.'
            : `${monte ? `De ${cm(RIDE_RISE[wheelKind(vehicle)])} plus haut à ${cm(wheels.maxDrop)} plus bas` : `Jusqu’à ${cm(wheels.maxDrop)} plus bas`} avec ces roues ; « Origine » remet la hauteur d’usine.`}
        </span>
        {wheels.swap && (
          <button type="button" className="btn wheels-link" onClick={() => openEntry('roues')}>
            Roues
          </button>
        )}
      </p>
    </div>
  );
}
