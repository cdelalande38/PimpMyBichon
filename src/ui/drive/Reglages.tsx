// Réglages de la sortie de nuit (demande du 17 novembre 2026 : « on envoie tout ça dans une petite
// icône de réglages dans le coin »). La petite icône du coin, en haut à droite, ouvre ce panneau ; il
// range tout ce qui ne sert pas à conduire : caméra et réalisateur, ralenti, météo, commande (manche ou
// pédales, en portrait), direction (libre ou assistée), mode manette, son (moteur coupé ou non, les
// trois curseurs), puis le pilote automatique (ou « Commencer la course » dans l'aperçu, « Prendre le
// volant » quand le pilote conduit), « Repartir » et « Rentrer au garage » (avec sa confirmation).
// Ouvert pendant la course, il la met en pause, et la reprend en se fermant (si c'est lui qui l'avait
// arrêtée) ; dans l'aperçu, la route continue derrière. Échap, la croix ou un appui à côté le ferment.
// En portrait, il monte du bas ; en paysage, il occupe le côté droit. Chaque commande offre 48 px.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { closeSheet } from '../../app/useRoute.ts';
import { CAMERA_IDS, type CameraId } from '../../drive/contrat.ts';
import { basculerMoteur, useSonSortie } from '../../drive/son.ts';
import { MOMENTS } from '../../data/moments.ts';
import { CAMERA_LABELS, COMMANDES, DIRECTIONS, useDrive, WEATHERS } from '../../state/drive.ts';
import { useEngineSoundPrefs } from '../../state/engineSound.ts';
import { DriveIcon, type DriveIconName } from './icones.tsx';
import { entrerManette, manettePossible, quitterManette, useManette } from './manette.ts';
import { MixageCurseurs } from './Mixage.tsx';
import './reglages.css';

/** Ouverture des réglages ; la course (pas l'aperçu) se met en pause tant qu'ils sont ouverts. */
export function useReglages(): { ouvert: boolean; ouvrir: () => void; fermer: () => void } {
  const [ouvert, setOuvert] = useState(false);
  const pauseParNous = useRef(false);
  const ouvrir = () => {
    const drive = useDrive.getState();
    if (!drive.apercu && !drive.paused) {
      pauseParNous.current = true;
      drive.setPaused(true);
    }
    setOuvert(true);
  };
  const fermer = () => {
    if (pauseParNous.current) {
      pauseParNous.current = false;
      useDrive.getState().setPaused(false);
    }
    setOuvert(false);
  };
  return { ouvert, ouvrir, fermer };
}

interface Option<T extends string> {
  id: T;
  label: string;
}

/** Un choix parmi quelques-uns : des puces côte à côte, celle choisie allumée. */
function Choix<T extends string>({ nom, options, valeur, onChoix }: { nom: string; options: readonly Option<T>[]; valeur: T | null; onChoix: (id: T) => void }) {
  return (
    <div className="drive-choix" role="group" aria-label={nom}>
      <span className="drive-choix-nom" aria-hidden="true">
        {nom}
      </span>
      <div className="drive-choix-puces">
        {options.map((option) => (
          <button key={option.id} type="button" className="drive-puce" aria-pressed={option.id === valeur} onClick={() => onChoix(option.id)}>
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Une ligne qui s'allume ou s'éteint (aria-pressed), avec son icône et une aide courte. */
function Bascule({
  nom,
  aide,
  icone,
  actif,
  onBascule,
  disabled,
  data,
}: {
  nom: string;
  aide: string;
  icone: DriveIconName;
  actif: boolean | undefined;
  onBascule: () => void;
  disabled?: boolean;
  data?: Record<string, string>;
}) {
  return (
    <button type="button" className="drive-bascule" aria-label={nom} aria-pressed={actif} disabled={disabled} onClick={onBascule} {...data}>
      <DriveIcon name={icone} />
      <span className="drive-bascule-texte">
        <b>{nom}</b>
        <small>{aide}</small>
      </span>
      <i className="drive-bascule-interrupteur" aria-hidden="true" />
    </button>
  );
}

function Rubrique({ titre, children }: { titre: string; children: ReactNode }) {
  return (
    <section className="drive-rubrique" aria-label={titre}>
      <h3>{titre}</h3>
      {children}
    </section>
  );
}

/** Son du moteur coupé ou non (gardé d'une sortie à l'autre). */
function MoteurBascule() {
  const { etat } = useSonSortie();
  const enSortie = useEngineSoundPrefs((state) => state.enSortie);
  const sansSon = etat === 'sans-son';
  return (
    <Bascule
      nom="Son du moteur"
      aide={sansSon ? 'Pas encore de son pour ce moteur' : enSortie ? 'Il tourne avec toi' : 'Coupé'}
      icone={enSortie && !sansSon ? 'moteur' : 'moteurCoupe'}
      actif={sansSon ? undefined : enSortie}
      disabled={sansSon}
      onBascule={basculerMoteur}
    />
  );
}

/** Mode manette : plein écran et paysage verrouillé, là où le navigateur sait le faire. */
function ManetteBascule() {
  const active = useManette();
  const [refus, setRefus] = useState(false);
  if (!manettePossible()) return null;
  return (
    <>
      <Bascule
        nom="Manette (paysage)"
        aide="Plein écran, téléphone couché"
        icone="manette"
        actif={active}
        onBascule={() => {
          setRefus(false);
          if (active) void quitterManette();
          else void entrerManette().then((ok) => setRefus(!ok));
        }}
      />
      {refus && (
        <p className="drive-refus" role="status">
          Ton téléphone ne veut pas tourner l’écran : couche-le, la manette suit.
        </p>
      )}
    </>
  );
}

export function ReglagesPanneau({ paysage, fermer }: { paysage: boolean; fermer: () => void }) {
  const apercu = useDrive((state) => state.apercu);
  const auto = useDrive((state) => state.input.auto);
  const camera = useDrive((state) => state.camera);
  const director = useDrive((state) => state.director);
  const slow = useDrive((state) => state.slow);
  const weather = useDrive((state) => state.weather);
  const moment = useDrive((state) => state.moment);
  const commande = useDrive((state) => state.commande);
  const direction = useDrive((state) => state.direction);
  const croix = useRef<HTMLButtonElement>(null);
  const fermerRef = useRef(fermer);
  useLayoutEffect(() => {
    fermerRef.current = fermer;
  });
  const drive = useDrive.getState;

  // Le focus va sur la croix ; il revient où il était à la fermeture. Échap ferme.
  useEffect(() => {
    const avant = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    croix.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      fermerRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (avant?.isConnected) avant.focus({ preventScroll: true });
    };
  }, []);

  const puis = (action: () => void) => () => {
    fermer();
    action();
  };
  const cameras: Option<CameraId>[] = CAMERA_IDS.map((id) => ({ id, label: CAMERA_LABELS[id] }));

  return (
    <div className="drive-reglages-voile" data-paysage={paysage || undefined} onPointerDown={(event) => event.target === event.currentTarget && fermer()}>
      <section className="drive-reglages" role="dialog" aria-modal="true" aria-labelledby="drive-reglages-titre">
        <header className="drive-reglages-tete">
          <h2 id="drive-reglages-titre">Réglages</h2>
          <span className="drive-reglages-etat">{apercu ? 'La route continue derrière' : 'Course en pause'}</span>
          <button ref={croix} type="button" className="drive-reglages-fermer" aria-label="Fermer les réglages" onClick={fermer}>
            <DriveIcon name="fermer" />
          </button>
        </header>
        <div className="drive-reglages-corps">
          <Rubrique titre="Vue">
            <Choix nom="Caméra" options={cameras} valeur={director ? null : camera} onChoix={(id) => drive().setCamera(id)} />
            <Bascule nom="Réalisateur" aide="Les plans changent tout seuls" icone="realisateur" actif={director} onBascule={() => drive().setDirector(!director)} />
            <Bascule nom="Ralenti" aide="Tout passe au ralenti" icone="ralenti" actif={slow} onBascule={() => drive().setSlow(!slow)} />
          </Rubrique>
          <Rubrique titre="Route">
            <Choix nom="Moment" options={MOMENTS} valeur={moment} onChoix={(id) => drive().setMoment(id)} />
            <Choix nom="Météo" options={WEATHERS} valeur={weather} onChoix={(id) => drive().setWeather(id)} />
          </Rubrique>
          <Rubrique titre="Conduite">
            {/* En paysage, toujours la manette : le choix du manche ou des pédales vaut en portrait. */}
            {!paysage && <Choix nom="Commande" options={COMMANDES} valeur={commande} onChoix={(id) => drive().setCommande(id)} />}
            <Choix nom="Direction" options={DIRECTIONS} valeur={direction} onChoix={(id) => drive().setDirection(id)} />
            <ManetteBascule />
          </Rubrique>
          <Rubrique titre="Son">
            <MoteurBascule />
            <MixageCurseurs />
          </Rubrique>
        </div>
        <footer className="drive-reglages-actes">
          {apercu ? (
            <button type="button" className="btn cta" onClick={puis(() => drive().commencer())}>
              <DriveIcon name="main" />
              Commencer la course
            </button>
          ) : auto ? (
            <button type="button" className="btn" onClick={puis(() => drive().setAuto(false))}>
              <DriveIcon name="main" />
              Prendre le volant
            </button>
          ) : (
            <button type="button" className="btn" onClick={puis(() => drive().laisserConduire())}>
              <DriveIcon name="auto" />
              Pilote automatique
            </button>
          )}
          {!apercu && (
            <button type="button" className="btn" onClick={puis(() => drive().commencer())}>
              <DriveIcon name="repartir" />
              Repartir
            </button>
          )}
          <button type="button" className="btn drive-home" onClick={puis(closeSheet)}>
            <DriveIcon name="garage" />
            Rentrer au garage
          </button>
        </footer>
      </section>
    </div>
  );
}
