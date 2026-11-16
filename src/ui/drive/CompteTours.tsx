// Compte-tours de la sortie de nuit (§ 5.5) : un cadran d'atelier, aiguille sur un arc de 270°,
// trois zones (vert : la plage utile ; orange : il est temps de passer, le témoin s'allume ; rouge :
// la zone rouge), le rapport engagé en grand, la vitesse en km/h en plus petit. Régime et rapport
// viennent du pilote (src/drive/pilote.ts, `train`), la même vérité que le son du moteur.
//
// Il vit à la cadence de l'image sans faire rendre React : le cadran (zones, graduations) est rendu
// une fois par pilote, l'aiguille, les chiffres et les témoins sont mis à jour par référence dans une
// boucle requestAnimationFrame, arrêtée en pause et page cachée (`useBoucleImage`).

import { useEffect, useRef, useState } from 'react';
import type { DriveTrain, Pilot } from '../../drive/contrat.ts';
import { zoneDe } from '../../drive/boite.ts';
import { livePilot, useDrive } from '../../state/drive.ts';

/**
 * Appelle `tick` à chaque image tant que la sortie roule (ni en pause, ni page cachée) ; le reste du
 * temps, aucune image n'est demandée.
 */
export function useBoucleImage(tick: (pilot: Pilot | null) => void): void {
  const ref = useRef(tick);
  useEffect(() => {
    ref.current = tick;
  });
  useEffect(() => {
    let frame = 0;
    const loop = () => {
      ref.current(livePilot.current);
      frame = requestAnimationFrame(loop);
    };
    const update = () => {
      const running = !useDrive.getState().paused && !document.hidden;
      if (running && frame === 0) frame = requestAnimationFrame(loop);
      if (!running && frame !== 0) {
        cancelAnimationFrame(frame);
        frame = 0;
        // Une dernière mise à jour : l'état figé reste juste.
        ref.current(livePilot.current);
      }
    };
    const off = useDrive.subscribe((state, previous) => {
      if (state.paused !== previous.paused) update();
    });
    document.addEventListener('visibilitychange', update);
    update();
    return () => {
      off();
      document.removeEventListener('visibilitychange', update);
      if (frame !== 0) cancelAnimationFrame(frame);
      frame = 0;
    };
  }, []);
}

/** Géométrie du cadran (unités du viewBox). */
const C = { x: 60, y: 54, r: 44, start: 135, sweep: 270 } as const;

function angleOf(rpm: number, max: number): number {
  return C.start + C.sweep * Math.min(1.02, Math.max(0, rpm / max));
}

function point(angle: number, radius: number): [number, number] {
  const a = (angle * Math.PI) / 180;
  return [C.x + radius * Math.cos(a), C.y + radius * Math.sin(a)];
}

function arc(from: number, to: number, max: number, radius: number): string {
  const a = angleOf(from, max);
  const b = angleOf(to, max);
  const [x0, y0] = point(a, radius);
  const [x1, y1] = point(b, radius);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${radius} ${radius} 0 ${b - a > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

type Zones = DriveTrain['zones'];

/** Zones d'un cadran sans pilote (avant que la scène soit prête). */
const ATTENTE: Zones = { vert: 1500, orange: 4500, rouge: 5500, max: 7000 };

function Cadran({ zones }: { zones: Zones }) {
  const step = zones.max > 10000 ? 2000 : 1000;
  const ticks: number[] = [];
  for (let rpm = 0; rpm <= zones.max + 1; rpm += step) ticks.push(rpm);
  return (
    <>
      <path className="ct-fond" d={arc(0, zones.max, zones.max, C.r)} />
      <path className="ct-zone" data-zone="vert" d={arc(zones.vert, zones.orange, zones.max, C.r)} />
      <path className="ct-zone" data-zone="orange" d={arc(zones.orange, zones.rouge, zones.max, C.r)} />
      <path className="ct-zone" data-zone="rouge" d={arc(zones.rouge, zones.max, zones.max, C.r)} />
      {ticks.map((rpm) => {
        const a = angleOf(rpm, zones.max);
        const [x0, y0] = point(a, C.r - 7);
        const [x1, y1] = point(a, C.r - 2);
        const [tx, ty] = point(a, C.r - 14);
        return (
          <g key={rpm}>
            <line className="ct-trait" x1={x0} y1={y0} x2={x1} y2={y1} />
            <text className="ct-chiffre" x={tx} y={ty + 2.5} textAnchor="middle">
              {rpm / 1000}
            </text>
          </g>
        );
      })}
    </>
  );
}

/**
 * Le cadran. Pour les parcours : data-regime (tr/min, au cent), data-rapport, data-zone (bas, vert,
 * orange, rouge), data-passage (passage de rapport en cours), data-temoin (témoin de passage),
 * data-nos ; la vitesse dans `.drive-speed b` (data-vitesse-affichee).
 */
export function CompteTours() {
  const root = useRef<HTMLDivElement>(null);
  const needle = useRef<SVGGElement>(null);
  const gear = useRef<SVGTextElement>(null);
  const speed = useRef<HTMLElement>(null);
  const [zones, setZones] = useState<Zones>(ATTENTE);
  const shown = useRef({ zones: ATTENTE as Zones, rpm: -1, gear: -1, kmh: -1, zone: '', shift: false, light: false, nos: false });

  useBoucleImage((pilot) => {
    const train = pilot?.train;
    const kmh = Math.max(0, Math.round((pilot?.motion.speed ?? 0) * 3.6));
    const memo = shown.current;
    if (train && train.zones !== memo.zones) {
      memo.zones = train.zones;
      setZones(train.zones);
    }
    const z = train?.zones ?? memo.zones;
    const rpm = train ? train.rpm : 0;
    if (Math.abs(rpm - memo.rpm) > 4 && needle.current) {
      memo.rpm = rpm;
      needle.current.setAttribute('transform', `rotate(${angleOf(rpm, z.max).toFixed(2)} ${C.x} ${C.y})`);
    }
    const g = train?.gear ?? 0;
    if (g !== memo.gear && gear.current) {
      memo.gear = g;
      gear.current.textContent = g > 0 ? String(g) : 'N';
    }
    if (kmh !== memo.kmh && speed.current) {
      memo.kmh = kmh;
      speed.current.textContent = String(kmh);
      speed.current.dataset.vitesseAffichee = String(kmh);
    }
    const el = root.current;
    if (!el) return;
    const zone = train ? zoneDe(rpm, z) : 'bas';
    const shift = train?.shifting ?? false;
    // Témoin : il est temps de passer (orange sur un rapport qui n'est pas le dernier), ou zone rouge.
    const light = train ? (zone === 'orange' && train.gear < train.gears) || zone === 'rouge' : false;
    const nos = train?.nos ?? false;
    if (zone !== memo.zone) el.dataset.zone = memo.zone = zone;
    if (shift !== memo.shift) el.dataset.passage = String((memo.shift = shift));
    if (light !== memo.light) el.dataset.temoin = String((memo.light = light));
    if (nos !== memo.nos) el.dataset.nos = String((memo.nos = nos));
    const r = String(Math.round(rpm / 100) * 100);
    if (el.dataset.regime !== r) el.dataset.regime = r;
    if (el.dataset.rapport !== String(g)) el.dataset.rapport = String(g);
  });

  const [nx, ny] = point(C.start, C.r - 4);
  return (
    <div ref={root} className="drive-dial" role="img" aria-label="Compte-tours" data-zone="bas" data-passage="false" data-temoin="false" data-nos="false">
      <svg viewBox="0 0 120 104" aria-hidden="true" focusable="false">
        <Cadran zones={zones} />
        <circle className="ct-temoin" cx={C.x} cy={14} r={3.4} />
        <text ref={gear} className="ct-rapport" x={C.x} y={C.y + 8} textAnchor="middle">
          N
        </text>
        <g ref={needle} transform={`rotate(${C.start} ${C.x} ${C.y})`}>
          <line className="ct-aiguille" x1={C.x - 8} y1={C.y} x2={C.x + C.r - 4} y2={C.y} />
        </g>
        <circle className="ct-moyeu" cx={C.x} cy={C.y} r={3} />
        <text className="ct-unite" x={C.x} y={98} textAnchor="middle">
          tr/min × 1000
        </text>
      </svg>
      <p className="drive-speed">
        <b ref={speed} data-vitesse-affichee="0">
          0
        </b>
        <small>km/h</small>
      </p>
      {/* Point de départ de l'aiguille, pour le lecteur d'écran sans effet. */}
      <span hidden data-x={nx} data-y={ny} />
    </div>
  );
}
