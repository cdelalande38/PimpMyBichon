// « Sous le capot » : l'état du socle, pour la recette sur le téléphone.
// Quelle version tourne, est-elle prête hors ligne, installée, sauvegardée, et à quelle cadence ;
// « Comparer » dit, en un essai sur le téléphone, où part le temps d'une image.

import { useEffect, useState } from 'react';
import { BUILD, formatBuildDate } from '../app/buildInfo.ts';
import { precachePercent, usePwa } from '../pwa/pwaStore.ts';
import { promptInstall } from '../pwa/register.ts';
import { QUALITY_LABELS, resolveQuality } from '../render/quality.ts';
import {
  atScreenCap,
  COMPARE_ANNOUNCED_S,
  COMPARE_ORDER,
  COMPARE_STEPS,
  inNoise,
  METER_DURATION_MS,
  readCompare,
  type CompareOutcome,
  type CompareReading,
} from '../render/frameMeter.ts';
import { abortCompare, startCompare, startMeter, useRenderStats, type CompareState, type RenderStatsState } from '../render/renderStats.ts';
import { readStorageStatus, type StorageStatus } from '../state/persistence.ts';
import { useSettings } from '../state/store.ts';
import { count, formatBytes, offlineDetail, typo } from './labels.ts';
import { soundCreditsText } from '../audio/engine/manifeste.ts';

function useStorageStatus(): StorageStatus | null {
  const [status, setStatus] = useState<StorageStatus | null>(null);
  useEffect(() => {
    let alive = true;
    void readStorageStatus().then((value) => {
      if (alive) setStatus(value);
    });
    return () => {
      alive = false;
    };
  }, []);
  return status;
}

function storageLine(status: StorageStatus | null): string {
  if (!status) return 'Vérification…';
  if (!status.writable) {
    return 'Indisponible sur ce navigateur : tes réglages ne survivront pas à la fermeture de l’app.';
  }
  // Le navigateur ne dit pas toujours la place occupée : dans ce cas, on n'en parle pas. Son
  // chiffre vaut pour toute l'adresse du site, pas pour l'atelier seul.
  const used =
    status.usage === null ? '' : ` Le navigateur garde ${formatBytes(status.usage)} pour toute l’adresse du site, atelier hors ligne compris.`;
  if (status.persisted === true) return `Protégée.${used}`;
  if (status.persisted === false) {
    return `Pas encore protégée : le navigateur peut l’effacer si la place manque. Installe l’atelier pour la mettre à l’abri.${used}`;
  }
  return `Protection inconnue sur ce navigateur.${used}`;
}

function privateAssetsLine(): string {
  const assets = BUILD.privateAssets;
  if (!assets.present) return 'Absents : sons et musique muets, substituts déclarés.';
  if (assets.engines + assets.sfx + assets.stations === 0) {
    return 'Dossier privé présent, sans son ni musique pour l’instant : emplacements muets.';
  }
  return `Présents : ${count(assets.engines, 'moteur')}, ${count(assets.sfx, 'bruitage')}, ${count(assets.stations, 'station')}.`;
}

function installLine(standalone: boolean, canInstall: boolean, later = false): string {
  if (standalone) return 'Installée : l’atelier tourne comme une app.';
  if (canInstall && later) return 'Dans le navigateur. Tu as rangé le bouton d’installation : il t’attend ici.';
  if (canInstall) return 'Dans le navigateur. Le bouton « Installer » est aussi en haut à droite de l’écran.';
  return 'Dans le navigateur. Pour l’installer : menu de Chrome, puis « Ajouter à l’écran d’accueil ».';
}

const EMPTY_READING: CompareReading = { noiseMs: null, noiseGpuMs: null, redo: false };

const decimal = (value: number) => value.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function qualityLine(quality: string, level: string, auto: RenderStatsState['auto'], floatTargets: boolean | null, fullFloat: boolean | null): string {
  if (floatTargets === false) return `${level} imposé : ce processeur graphique ne rend pas en demi-flottants`;
  const wantsMax = quality === 'max' || (quality === 'auto' && auto.level === 'max');
  if (wantsMax && fullFloat === false) return `${level} au lieu du max : ce processeur graphique ne rend pas en flottants 32 bits (occlusion)`;
  if (quality !== 'auto') return level;
  if (auto.fps === null) return `Auto, niveau ${level.toLowerCase()} pour l’instant : cadence pas encore mesurée`;
  const fixed = auto.settled ? ', retenu' : '';
  return `Auto, niveau ${level.toLowerCase()}${fixed} (cadence vue : ${Math.round(auto.fps)} i/s)`;
}

function meterLine(meter: RenderStatsState['meter']): string {
  if (meter.running) return `Mesure en cours : la scène tourne ${METER_DURATION_MS / 1000} secondes…`;
  const result = meter.result;
  if (!result) return 'Appuie sur « Mesurer » : la scène tourne cinq secondes au niveau en cours.';
  return (
    `${QUALITY_LABELS[result.level]} : ${decimal(result.fps)} i/s en moyenne, ${decimal(result.worstFps)} i/s au pire centile · ` +
    `${result.calls.toLocaleString('fr-FR')} appels de dessin · ${result.triangles.toLocaleString('fr-FR')} triangles par image ` +
    `(${result.frames} images).`
  );
}

function cutLine(cut: RenderStatsState['cut']): string {
  if (cut === null) return 'Pas encore décidée.';
  const { min, max } = cut.vehicle;
  const size = [0, 2, 1].map((k) => decimal((max[k] ?? 0) - (min[k] ?? 0))).join(' × ');
  const protectedBox = ` Véhicule protégé : ${size} m.`;
  if (cut.hidden === 0) return `Rien ne passe devant le véhicule : aucun des ${cut.total} éléments du décor n’est retiré.${protectedBox}`;
  const verb = cut.hidden > 1 ? 'retirés de l’image : ils passeraient' : 'retiré de l’image : il passerait';
  return `${count(cut.hidden, 'élément')} du décor sur ${cut.total} ${verb} devant le véhicule.${protectedBox}`;
}

function ditherLine(dither: RenderStatsState['cutDither']): string {
  if (dither === null) return '';
  if (!dither.ready) return ' Fondu en trame pas prêt : le décor bascule d’un coup (mouvement réduit, photo, ou nuanceurs en préparation).';
  const now = dither.active > 0 ? ` (${count(dither.active, 'matériau', 'matériaux')} en fondu)` : '';
  const warm = dither.warm ? `, préparé en ${dither.warm.ms} ms (prêt en ${dither.warm.readyMs} ms)` : '';
  return ` Fondu en trame prêt, compilé à part pour ${count(dither.carriers, 'matériau opaque', 'matériaux opaques')}${warm}${now}.`;
}

// Lignes de « Comparer » : nombre et unité liés par une espace insécable (jamais coupés en fin de
// ligne), et recopiables telles quelles dans un message.
const NBSP = '\u00a0';
const withUnit = (value: string, unit: string) => `${value}${NBSP}${unit}`;
const ms = (value: number) => withUnit(decimal(value), 'ms');
const signedMs = (value: number) => withUnit(`${value > 0 ? '+' : value < 0 ? '−' : '±'}${decimal(Math.abs(value))}`, 'ms');
/** Séparateur des morceaux d'une ligne : le point médian reste en fin de ligne, jamais en tête. */
const SEP = `${NBSP}· `;

/** Écart au réglage en cours, et s'il tient dans le bruit de l'essai. */
function gapText(delta: number, noise: number | null): string {
  return ` (${signedMs(delta)}${inNoise(delta, noise) ? ', dans le bruit' : ''})`;
}

/**
 * Une ligne de la comparaison : cadence (et son écart au réglage en cours, ou le plafond de
 * l'écran), temps de carte (et son écart), écarts aller-retour, processeur, appels.
 */
function compareLine(outcome: CompareOutcome, base: CompareOutcome | undefined, reading: CompareReading, screenMs: number | null, timed: boolean): string {
  if (!outcome.measured) return `${outcome.label} : non mesurée, ${outcome.reason}.`;
  const { summary } = outcome;
  const reference = outcome.id !== 'courant' && base?.measured ? base.summary : null;
  const capped = atScreenCap(summary, screenMs);
  const cadence =
    `${withUnit(decimal(summary.fps), 'i/s')}, ${ms(summary.meanMs)}` +
    (capped ? ', au plafond de l’écran' : reference ? gapText(summary.meanMs - reference.meanMs, reading.noiseMs) : '');
  // Sans minuterie de la carte (navigateur qui ne la donne pas), l'état le dit une fois pour toutes.
  const gpu =
    summary.gpuMs === null
      ? timed
        ? `${SEP}carte pas chronométrée`
        : ''
      : `${SEP}carte ${ms(summary.gpuMs)}` + (reference?.gpuMs != null ? gapText(summary.gpuMs - reference.gpuMs, reading.noiseGpuMs) : '');
  const gaps =
    summary.gapGpuMs === null
      ? `aller-retour à ${ms(summary.gapMs)} près`
      : `aller-retour à ${decimal(summary.gapMs)} et ${ms(summary.gapGpuMs)} près`;
  return (
    `${outcome.label} : ${cadence}${gpu}${SEP}${gaps}${SEP}processeur ${ms(summary.cpuMs)}${SEP}` +
    `${withUnit(summary.calls.toLocaleString('fr-FR'), 'appels')}.`
  );
}

/** Au moins une variante a son temps de carte (minuterie de la carte présente). */
const isTimed = (outcomes: readonly CompareOutcome[]) => outcomes.some((outcome) => outcome.measured && outcome.summary.gpuMs !== null);

function compareStatus(compare: CompareState, reading: CompareReading | null): string {
  if (compare.running) {
    const step = COMPARE_STEPS[compare.step];
    const pass = compare.slot < COMPARE_STEPS.length ? 'aller' : 'retour';
    return `Mesure ${compare.slot + 1} sur ${COMPARE_ORDER.length}${step ? ` (${step.label.toLowerCase()}, ${pass})` : ''}… Ne touche à rien.`;
  }
  const result = compare.result;
  if (compare.aborted !== null) return `Comparaison interrompue : ${compare.aborted}. Relance-la quand tu veux.`;
  if (result === null) {
    return (
      `« Comparer » mesure ${withUnit(String(COMPARE_STEPS.length), 'variantes')} de la scène, deux fois chacune (aller puis retour) : ` +
      `compte ${withUnit(String(COMPARE_ANNOUNCED_S), 'secondes')}, pose le téléphone et ne touche à rien.`
    );
  }
  const ratio = result.dpr.toLocaleString('fr-FR', { maximumFractionDigits: 2 });
  const noise =
    reading?.noiseMs == null
      ? ''
      : ` Bruit : ${ms(reading.noiseMs)} par image${reading.noiseGpuMs === null ? '' : `, ${ms(reading.noiseGpuMs)} de carte`}.`;
  const screen = result.screenMs === null ? ' Rythme de l’écran pas reconnu.' : ` Écran : ${withUnit(String(Math.round(1000 / result.screenMs)), 'i/s')}.`;
  const untimed = isTimed(result.outcomes) ? '' : ' Carte pas chronométrée : ce navigateur ne donne pas sa minuterie.';
  const redo = reading?.redo ? ' Trop de bruit pour conclure : relance « Comparer », téléphone posé, rien d’autre d’ouvert.' : '';
  return `${QUALITY_LABELS[result.level]}, pixel ratio ${ratio}, deux passages par variante.${noise}${screen}${untimed}${redo}`;
}

/** Libellé d'un bouton qui garde la largeur du plus long de ses libellés (la rangée ne saute pas). */
function SteadyLabel({ text, widest }: { text: string; widest: readonly string[] }) {
  return (
    <span className="btn-cale">
      {widest.map((wide) => (
        <span key={wide} aria-hidden="true">
          {wide}
        </span>
      ))}
      <span>{text}</span>
    </span>
  );
}

const METER_LABELS = ['Mesurer', 'Mesure…'] as const;
const COMPARE_LABELS = ['Comparer', `${COMPARE_ORDER.length} sur ${COMPARE_ORDER.length}…`] as const;

/**
 * « Mesurer » (cinq secondes de rotation, cadence et coût par image au niveau en cours) et
 * « Comparer » (cinq variantes de la scène, deux passages chacune ; src/scene/FrameMeter.tsx).
 * Leurs libellés gardent leur largeur pendant la mesure : la rangée de boutons ne saute pas.
 */
export function MeterButton() {
  const running = useRenderStats((state) => state.meter.running);
  const comparing = useRenderStats((state) => state.compare.running);
  const slot = useRenderStats((state) => state.compare.slot);
  const ready = useRenderStats((state) => state.gpu !== null);
  // Panneau fermé pendant la comparaison : elle s'arrête, la scène revient à son état d'origine.
  useEffect(() => () => abortCompare('panneau fermé'), []);
  const busy = running || comparing;
  return (
    <>
      <button type="button" className="btn btn-mesure" disabled={busy || !ready} aria-busy={running} onClick={startMeter}>
        <SteadyLabel text={running ? METER_LABELS[1] : METER_LABELS[0]} widest={METER_LABELS} />
      </button>
      <button type="button" className="btn btn-mesure" disabled={busy || !ready} aria-busy={comparing} onClick={startCompare}>
        <SteadyLabel
          text={comparing ? `${Math.min(slot + 1, COMPARE_ORDER.length)} sur ${COMPARE_ORDER.length}…` : COMPARE_LABELS[0]}
          widest={COMPARE_LABELS}
        />
      </button>
    </>
  );
}

/** Nombre d'objets du mobilier et deux de leurs noms, tirés des données du garage (chargées à part). */
function useGarageProps(): { count: number; names: string[] } | null {
  const [props, setProps] = useState<{ count: number; names: string[] } | null>(null);
  useEffect(() => {
    let alive = true;
    // Import à part : les données du garage voyagent avec la scène, pas avec la coque.
    void import('../data/garage.ts').then(({ GARAGE }) => {
      const list = GARAGE.props;
      const names = [list[0]?.name, list.length > 1 ? list.at(-1)?.name : undefined].filter((name) => name !== undefined);
      if (alive) setProps({ count: list.length, names });
    });
    return () => {
      alive = false;
    };
  }, []);
  return props;
}

/**
 * Attribution du modèle sous licence CC-BY 4.0 (titre, auteur, licence, modifications), recopiée
 * de CREDITS.md : la licence demande qu'elle soit visible là où le modèle est montré. Du texte
 * seulement, aucune adresse (tests/unit/credits-et-libelles.test.ts la confronte à CREDITS.md).
 * « CC-BY 4.0 » ne se coupe jamais : liant de mots (U+2060) après le tiret, espace insécable avant la version.
 */
const MODEL_CREDITS =
  'Le concept : modèle « Car Concept » d’Eric Chadwick, Darmstadt Graphics Group GmbH (2024), sous licence CC-\u2060BY\u00a04.0. ' +
  'Modifié pour l’atelier : logos retirés, plaque unie. Tous les crédits (polices, bibliothèques) sont dans CREDITS.md.';

/** Crédits des sons de moteur sous licence CC BY (src/audio/engine/familles.json, écrit par sons:build). */
const SOUND_CREDITS = soundCreditsText();

function substitutesLine(props: { count: number; names: string[] } | null): string {
  const detail = props === null || props.count === 0 ? '' : ` : ${count(props.count, 'objet')} (${props.names.join(', ')}…)`;
  return `Le mobilier du garage, modelé par le code${detail}, et les véhicules substituts (placeholder_banc pour le concept, placeholder_* pour les autres), en attendant les vrais modèles. Liste complète dans TODO_ASSETS.md.`;
}

export function UnderHoodPanel() {
  const offline = usePwa((state) => state.offline);
  const percent = usePwa(precachePercent);
  const standalone = usePwa((state) => state.standalone);
  const online = usePwa((state) => state.online);
  const canInstall = usePwa((state) => state.canInstall);
  const installLater = usePwa((state) => state.installLater);
  const gpu = useRenderStats((state) => state.gpu);
  const fps = useRenderStats((state) => state.fps);
  const dpr = useRenderStats((state) => state.dpr);
  const frame = useRenderStats((state) => state.frame);
  const probe = useRenderStats((state) => state.probe);
  const reflection = useRenderStats((state) => state.reflection);
  const quality = useSettings((state) => state.quality);
  const auto = useRenderStats((state) => state.auto);
  const floatTargets = useRenderStats((state) => state.floatTargets);
  const fullFloat = useRenderStats((state) => state.fullFloatTargets);
  const meter = useRenderStats((state) => state.meter);
  const compare = useRenderStats((state) => state.compare);
  // Bruit et conseil : seulement une fois l'essai allé au bout (les deux passages de chaque variante).
  const finished = compare.result !== null && !compare.running && compare.aborted === null;
  const reading = finished && compare.result ? readCompare(compare.result.outcomes, compare.result.screenMs) : null;
  const garageProps = useGarageProps();
  const cut = useRenderStats((state) => state.cut);
  const dither = useRenderStats((state) => state.cutDither);
  const programs = useRenderStats((state) => state.programs);
  const storage = useStorageStatus();

  const date = formatBuildDate(BUILD.date);
  const level = QUALITY_LABELS[resolveQuality(quality, auto.level, floatTargets !== false, fullFloat !== false)];
  const ratio =
    dpr === null ? '' : ` · pixel ratio ${dpr.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}`;

  return (
    <dl className="facts">
      <dt>Version</dt>
      <dd>
        {BUILD.version} · {BUILD.commit}
        {date && ` · ${date}`}
      </dd>

      <dt>Hors ligne</dt>
      <dd>{typo(offlineDetail(offline, percent))}</dd>

      <dt>Installation</dt>
      <dd>
        {typo(installLine(standalone, canInstall, installLater))}
        {canInstall && !standalone && (
          <button type="button" className="btn install-here" onClick={() => void promptInstall()}>
            Installer l’atelier
          </button>
        )}
      </dd>

      <dt>Réseau</dt>
      <dd>{online ? 'En ligne.' : 'Hors ligne.'}</dd>

      <dt>Sauvegarde</dt>
      <dd>{typo(storageLine(storage))}</dd>

      <dt>Rendu 3D</dt>
      <dd>
        {gpu
          ? `${gpu.webgl2 ? 'WebGL 2' : 'WebGL 2 absent'}${gpu.renderer ? ` · ${gpu.renderer}` : ''}`
          : 'Pas encore démarré.'}
      </dd>

      <dt>Cadence</dt>
      <dd>
        {typo(
          fps === null
            ? 'Pas encore mesurée : fais tourner le véhicule.'
            : `${fps} i/s à la dernière mesure.`,
        )}
      </dd>

      <dt>Image</dt>
      <dd data-fact="image">
        {typo(
          frame === null
            ? 'Pas encore dessinée.'
            : `${frame.calls.toLocaleString('fr-FR')} appels de dessin · ${frame.triangles.toLocaleString('fr-FR')} triangles` +
                `${programs === null ? '' : ` · ${programs} programmes de nuanceur`}.`,
        )}
      </dd>

      <dt>Reflets</dt>
      <dd data-fact="sonde">
        {typo(
          probe === null
            ? 'Sonde pas encore calculée.'
            : `Sonde de ${probe.size} px par face, calculée en ${probe.ms} ms (${probe.updates} calcul${probe.updates > 1 ? 's' : ''}).`,
        )}
      </dd>
      <dt>Sol</dt>
      <dd data-fact="sol">
        {typo(
          reflection === null
            ? 'Sol sans réflexion planaire : il brille par la sonde.'
            : `Réflexion du sol sur ${reflection.width} × ${reflection.height} px.`,
        )}
      </dd>

      <dt>Coupe</dt>
      <dd data-fact="coupe">{typo(cutLine(cut) + ditherLine(dither))}</dd>

      <dt>Qualité</dt>
      <dd data-fact="qualite">
        {typo(qualityLine(quality, level, auto, floatTargets, fullFloat))}
        {ratio}.
      </dd>

      <dt>Mesure</dt>
      <dd data-fact="mesure" aria-live="polite">
        {typo(meterLine(meter))}
      </dd>

      <dt>Comparer</dt>
      <dd
        data-fact="comparer"
        aria-live="polite"
        data-etat={compare.running ? 'en-cours' : compare.aborted !== null ? 'interrompue' : compare.result ? 'finie' : 'vide'}
        data-ecran={compare.result?.screenMs == null ? undefined : Math.round(1000 / compare.result.screenMs)}
        data-recommencer={reading === null ? undefined : reading.redo ? 'oui' : 'non'}
      >
        {typo(compareStatus(compare, reading))}
        {compare.result !== null && compare.result.outcomes.length > 0 && (
          <ul className="comparaison">
            {compare.result.outcomes.map((outcome, _, all) => (
              <li
                key={outcome.id}
                data-fact={`comparer-${outcome.id}`}
                data-mesuree={outcome.measured ? 'oui' : 'non'}
                data-programmes={outcome.measured ? outcome.programs : undefined}
                data-plafond={outcome.measured && !compare.running ? (atScreenCap(outcome.summary, compare.result?.screenMs ?? null) ? 'oui' : 'non') : undefined}
              >
                {typo(compareLine(outcome, all.find((entry) => entry.id === 'courant'), reading ?? EMPTY_READING, compare.result?.screenMs ?? null, isTimed(all)))}
              </li>
            ))}
          </ul>
        )}
      </dd>

      <dt>Assets privés</dt>
      <dd>{typo(privateAssetsLine())}</dd>

      <dt>Substituts</dt>
      <dd data-fact="substituts">{typo(substitutesLine(garageProps))}</dd>

      <dt>Crédits</dt>
      <dd data-fact="credits">{typo(MODEL_CREDITS)}</dd>

      {SOUND_CREDITS !== '' && (
        <>
          <dt>Sons</dt>
          <dd data-fact="credits-sons">{typo(SOUND_CREDITS)}</dd>
        </>
      )}
    </dl>
  );
}
