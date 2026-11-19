// Entrée « Néons » du dock (Custom), en deux étapes : la liste des zones du véhicule (avant, flancs,
// arrière, roues, habitacle ; cadre et roues sur une moto), chacune avec sa couleur et son état, plus deux
// gestes pour toutes à la fois (même couleur partout, tout éteindre) ; puis, une zone choisie, ses
// réglages à la place de la liste : allumée ou éteinte, fixe ou en respiration lente, couleur (teintes
// d'un appui, ou le nuancier de la peinture), intensité. « Retour » remonte de la zone à la liste (niveau
// `element` du dock, comme Moteur et Carrosserie : src/state/dock.ts). Tout vient des données (src/data/neons.ts, manifeste ; prix dans
// src/data/articles/neons.ts) : une zone par genre de véhicule est libre, les autres se débloquent sur
// place (cadenas et prix, bloc d'achat partagé), et une zone posée sans être acquise reste allumée (règle
// de src/ui/nonAcquis.tsx). Pendant les réglages de l'avant ou de l'arrière, la caméra cadre ce bout ;
// ceux de l'habitacle se font assis dedans (vue intérieure). Les mêmes réglages servent aux LED de
// l'habitacle dans Custom › Intérieur (NeonZoneReglages).

import { useEffect, useRef, useState, type RefObject } from 'react';
import { articleParId, type ArticleBoutique } from '../../data/boutique.ts';
import type { CoteVehicule } from '../../data/framings.ts';
import {
  articleNeon,
  etatNeon,
  NEON_INTENSITE,
  NEON_MODES,
  NEON_TEINTES,
  neonKeys,
  neonSlot,
  neonZonesOf,
  type NeonMode,
  type NeonZoneInfo,
} from '../../data/neons.ts';
import { placeForVolet, placesOf, resolveVehicle } from '../../data/vehicles.ts';
import type { Build, Hex, VehicleManifest } from '../../data/vehicleTypes.ts';
import { possedeDans } from '../../jeu/achats.ts';
import { normalizeHex, useBuilds } from '../../state/builds.ts';
import { useDock } from '../../state/dock.ts';
import { useJeu } from '../../state/jeu.ts';
import { NEON_REGARD } from '../../scene/vehicle/neons.ts';
import { useView } from '../../state/view.ts';
import { Icon } from '../icons.tsx';
import { Achat } from '../jeu/Achat.tsx';
import { dollars } from '../jeu/libelles.ts';
import { nomNonAcquis, NoteNonAcquise } from '../nonAcquis.tsx';
import { ColorPicker } from '../paint/ColorPicker.tsx';
import { Padlock } from '../paint/Padlock.tsx';
import { useRevealPressed } from '../scroll.ts';
import { useCadreBout } from '../useCadreBout.ts';
import './neons.css';

/** Espace fine insécable, entre un nombre et son unité. */
const NNBSP = ' ';

/**
 * Réglages éteints d'une zone, gardés le temps de la séance : rallumer une zone retrouve sa couleur, son
 * mode et son intensité, sans rien écrire dans la sauvegarde tant qu'elle est éteinte.
 */
const memoire = new Map<string, { mode: NeonMode; color: Hex | null; intensity: number | null }>();

type ZoneDuVehicule = NeonZoneInfo & { label: string; hint: string };

/** Les gestes sur les néons d'un véhicule, partagés par Néons et Intérieur. */
function useGestes(vehicle: VehicleManifest) {
  const setPart = useBuilds((state) => state.setPart);
  const setPartPaint = useBuilds((state) => state.setPartPaint);
  const setTune = useBuilds((state) => state.setTune);
  const resetKeys = useBuilds((state) => state.resetKeys);
  const rememberColor = useBuilds((state) => state.rememberColor);
  const buildOf = () => useBuilds.getState().builds[vehicle.id];
  const cle = (zone: NeonZoneInfo) => `${vehicle.id}:${zone.id}`;
  const eteindre = (zone: NeonZoneInfo) => {
    const build = buildOf();
    const slot = neonSlot(zone.id);
    const etat = etatNeon(zone, build);
    if (etat.on) memoire.set(cle(zone), { mode: etat.mode, color: build?.partPaints?.[slot]?.color ?? null, intensity: build?.tune?.[slot] ?? null });
    resetKeys(vehicle.id, { parts: [slot], partPaints: [slot], tune: [slot] });
  };
  return {
    allumer: (zone: NeonZoneInfo) => {
      const slot = neonSlot(zone.id);
      const kept = memoire.get(cle(zone));
      setPart(vehicle.id, slot, kept?.mode ?? 'fixe');
      if (kept?.color) setPartPaint(vehicle.id, slot, { color: kept.color });
      if (kept?.intensity !== null && kept?.intensity !== undefined) setTune(vehicle.id, slot, kept.intensity);
    },
    eteindre,
    mode: (zone: NeonZoneInfo, mode: NeonMode) => setPart(vehicle.id, neonSlot(zone.id), mode),
    couleur: (zone: NeonZoneInfo, hex: string) => {
      const value = normalizeHex(hex);
      if (!value) return;
      setPartPaint(vehicle.id, neonSlot(zone.id), { color: value });
    },
    retenir: (hex: string) => {
      const value = normalizeHex(hex);
      if (value) rememberColor(value);
    },
    intensite: (zone: NeonZoneInfo, value: number) => setTune(vehicle.id, neonSlot(zone.id), Math.abs(value - NEON_INTENSITE.origine) < 1e-6 ? null : value),
    toutEteindre: () => {
      for (const zone of neonZonesOf(vehicle)) {
        const etat = etatNeon(zone, buildOf());
        if (etat.on) eteindre(zone);
      }
      resetKeys(vehicle.id, neonKeys(vehicle));
    },
  };
}

/** Une zone verrouillée ? Libre, ou son article acquis : non. */
function useAcquis() {
  const acquis = useJeu((state) => state.articles);
  return (zone: NeonZoneInfo): { article: ArticleBoutique | undefined; owned: boolean } => {
    const id = articleNeon(zone.id);
    const article = id ? articleParId(id) : undefined;
    return { article, owned: article === undefined || possedeDans({ articles: acquis }, article.id) };
  };
}

/** Pastille d'une zone : sa couleur, lumineuse quand elle est allumée. */
function Pastille({ color, on }: { color: Hex; on: boolean }) {
  return <span className="swatch neons-pastille" aria-hidden="true" data-allume={on ? 'oui' : 'non'} style={{ background: color, boxShadow: on ? `0 0 0.6rem ${color}` : 'none' }} />;
}

/**
 * Réglages d'une zone : allumée ou éteinte, mode, couleur, intensité ; cadenas et achat si elle n'est pas
 * acquise (une fois achetée, elle s'allume).
 */
export function NeonZoneReglages({ vehicle, zone, build }: { vehicle: VehicleManifest; zone: ZoneDuVehicule; build: Build | undefined }) {
  const gestes = useGestes(vehicle);
  const acquis = useAcquis()(zone);
  const etat = etatNeon(zone, build);
  const [achat, setAchat] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [nuancier, setNuancier] = useState(false);
  const locked = !acquis.owned;
  // Posée sans être acquise (règle commune) : elle reste allumée, on peut l'éteindre, pas la régler.
  const reglable = etat.on && !locked;
  const percent = Math.round(etat.intensity * 100);
  const teintes = useRevealPressed<HTMLDivElement>(`${zone.id}/${etat.color}`);

  if (nuancier && reglable) {
    return (
      <div className="neons neons-reglages" data-testid="neons-zone" data-zone={zone.id}>
        <ColorPicker
          value={etat.color}
          title={`Néon · ${zone.label}`}
          pickables={[]}
          onLive={(hex) => gestes.couleur(zone, hex)}
          onCommit={(hex) => {
            gestes.couleur(zone, hex);
            gestes.retenir(hex);
          }}
          onClose={() => setNuancier(false)}
        />
      </div>
    );
  }

  return (
    <div className="neons neons-reglages" data-testid="neons-zone" data-zone={zone.id} data-etat={etat.on ? etat.mode : 'eteint'}>
      <div className="neons-head">
        <div className="neons-bascule" role="group" aria-label={`Néon · ${zone.label}`}>
          {locked && !etat.on ? (
            <button
              type="button"
              className="neons-bouton neons-verrou"
              data-verrou="ferme"
              aria-label={`Allumer · ${zone.label}, à débloquer pour ${dollars(acquis.article?.prix ?? 0)}`}
              onClick={() => {
                setMessage(null);
                setAchat(!achat);
              }}
            >
              <Padlock open={false} className="neons-cadenas" />
              <span>{dollars(acquis.article?.prix ?? 0)}</span>
            </button>
          ) : (
            <button type="button" className="neons-bouton" aria-pressed={etat.on} data-neon="allume" onClick={() => !etat.on && gestes.allumer(zone)}>
              <span>Allumé</span>
            </button>
          )}
          <button
            type="button"
            className="neons-bouton"
            aria-pressed={!etat.on}
            data-neon="eteint"
            aria-label={locked && etat.on ? nomNonAcquis(`Éteindre · ${zone.label}`, acquis.article?.prix) : undefined}
            onClick={() => etat.on && gestes.eteindre(zone)}
          >
            <span>Éteint</span>
          </button>
        </div>
        <div className="neons-bascule" role="group" aria-label="Mode">
          {NEON_MODES.map((mode) => (
            <button key={mode.id} type="button" className="neons-bouton" aria-pressed={etat.on && etat.mode === mode.id} disabled={!reglable} data-mode={mode.id} onClick={() => gestes.mode(zone, mode.id)}>
              <span>{mode.label}</span>
            </button>
          ))}
        </div>
      </div>

      {achat && locked && acquis.article && (
        <Achat
          article={acquis.article}
          fait={`C’est débloqué et allumé : ${acquis.article.label}.`}
          onClose={() => setAchat(false)}
          onDone={(texte) => {
            setAchat(false);
            gestes.allumer(zone);
            setMessage(texte);
          }}
        />
      )}
      {message && (
        <p className="neons-message" role="status">
          {message}
        </p>
      )}
      {etat.on && locked && <NoteNonAcquise label={`Néon · ${zone.label}`} prix={acquis.article?.prix} />}

      <div ref={teintes} className="chips neons-teintes" role="group" aria-label="Couleur du néon">
        {NEON_TEINTES.map((teinte) => (
          <button
            key={teinte.color}
            type="button"
            className="neons-teinte"
            style={{ background: teinte.color, boxShadow: reglable && etat.color === teinte.color ? `0 0 0.6rem ${teinte.color}` : undefined }}
            aria-label={teinte.label}
            aria-pressed={etat.on && etat.color === teinte.color}
            disabled={!reglable}
            onClick={() => {
              gestes.couleur(zone, teinte.color);
              gestes.retenir(teinte.color);
            }}
          />
        ))}
        <button type="button" className="neons-teinte neons-teinte-libre" style={{ background: etat.color }} aria-label="Autre couleur : le nuancier" disabled={!reglable} onClick={() => setNuancier(true)}>
          <span aria-hidden="true">+</span>
        </button>
      </div>

      <label className="neons-slider">
        <span>Intensité</span>
        <input
          type="range"
          min={Math.round(NEON_INTENSITE.min * 100)}
          max={Math.round(NEON_INTENSITE.max * 100)}
          step={Math.round(NEON_INTENSITE.step * 100)}
          value={percent}
          disabled={!reglable}
          aria-valuetext={`${percent}${NNBSP}%`}
          data-testid="neons-intensite"
          onChange={(event) => gestes.intensite(zone, Number(event.target.value) / 100)}
        />
        <output>{`${percent}${NNBSP}%`}</output>
      </label>
    </div>
  );
}

/** Cadrage pendant les réglages d'une zone : l'avant, l'arrière, ou l'habitacle vu de dedans. */
function useCadrageZone(root: RefObject<HTMLDivElement | null>, vehicle: VehicleManifest, zone: ZoneDuVehicule | null): void {
  const cote: CoteVehicule | null = zone?.id === 'avant' ? 'avant' : zone?.id === 'arriere' ? 'arriere' : null;
  useCadreBout(root, vehicle.id, cote, `neons-${zone?.id ?? 'liste'}`);
  const places = placesOf(vehicle);
  const dedans = zone?.habitacle === true && places.length > 0;
  const place = placeForVolet(places, 'led');
  useEffect(() => {
    if (!dedans) return undefined;
    useView.getState().sit(vehicle.id, place, false, NEON_REGARD);
    return () => useView.getState().setMode('atelier');
  }, [dedans, vehicle.id, place]);
}

export function NeonsPanel() {
  const vehicle = resolveVehicle(useBuilds((state) => state.current));
  const build = useBuilds((state) => state.builds[vehicle.id]);
  const levels = useDock((state) => state.levels);
  const push = useDock((state) => state.push);
  const gestes = useGestes(vehicle);
  const acquisDe = useAcquis();
  const zones = neonZonesOf(vehicle);
  const level = levels[0]?.kind === 'element' ? levels[0] : null;
  const zone = (level && zones.find((item) => item.id === level.element)) ?? null;
  const root = useRef<HTMLDivElement>(null);
  useCadrageZone(root, vehicle, zone);

  if (zones.length === 0) {
    return (
      <div className="neons" data-testid="neons">
        <p className="neons-vide">{`${vehicle.name} n’a pas encore de néons : leurs tubes ne sont pas tracés dans son manifeste.`}</p>
      </div>
    );
  }
  if (zone) {
    return (
      <div ref={root} className="neons-cadre">
        <NeonZoneReglages vehicle={vehicle} zone={zone} build={build} />
      </div>
    );
  }

  const etats = zones.map((item) => ({ zone: item, etat: etatNeon(item, build), ...acquisDe(item) }));
  const allumees = etats.filter((item) => item.etat.on);
  const reglables = allumees.filter((item) => item.owned);
  const sansAchat = allumees.find((item) => !item.owned);
  return (
    <div ref={root} className="neons" data-testid="neons" data-allumees={allumees.length}>
      <div className="chips neons-zones" role="group" aria-label="Zones des néons">
        {etats.map(({ zone: item, etat, article, owned }) => {
          const locked = !owned;
          const state = etat.on ? NEON_MODES.find((mode) => mode.id === etat.mode)?.label ?? 'Fixe' : 'Éteint';
          return (
            <button
              key={item.id}
              type="button"
              className="chip chip-swatch neons-zone"
              data-neon-zone={item.id}
              data-allume={etat.on ? 'oui' : 'non'}
              data-verrou={locked ? 'ferme' : undefined}
              aria-label={locked ? (etat.on ? nomNonAcquis(item.label, article?.prix) : `${item.label}, à débloquer pour ${dollars(article?.prix ?? 0)}`) : `${item.label}, ${state.toLowerCase()}`}
              onClick={() => push({ kind: 'element', element: item.id, libelle: item.label })}
            >
              <Pastille color={etat.color} on={etat.on} />
              <span className="chip-text">
                <b>{item.label}</b>
                {locked && !etat.on ? (
                  <small className="neons-prix">
                    <Padlock open={false} className="neons-cadenas" />
                    {dollars(article?.prix ?? 0)}
                  </small>
                ) : (
                  <small>{etat.on ? `${state} · ${Math.round(etat.intensity * 100)}${NNBSP}%` : item.hint}</small>
                )}
              </span>
            </button>
          );
        })}
      </div>
      {sansAchat && <NoteNonAcquise label={`Néon · ${sansAchat.zone.label}`} prix={sansAchat.article?.prix} />}
      <div className="neons-tout">
        <div className="chips neons-teintes" role="group" aria-label="Même couleur partout">
          <span className="neons-tout-label" aria-hidden="true">
            Tout en
          </span>
          {NEON_TEINTES.map((teinte) => (
            <button
              key={teinte.color}
              type="button"
              className="neons-teinte"
              style={{ background: teinte.color }}
              aria-label={`Tout en ${teinte.label.toLowerCase()}`}
              disabled={reglables.length === 0}
              onClick={() => {
                for (const item of reglables) gestes.couleur(item.zone, teinte.color);
                gestes.retenir(teinte.color);
              }}
            />
          ))}
        </div>
        <button type="button" className="btn neons-eteindre" disabled={allumees.length === 0} onClick={gestes.toutEteindre}>
          <Icon name="origine" />
          <span>Tout éteindre</span>
        </button>
      </div>
    </div>
  );
}
