// Nuancier de l'onglet « Peinture » : saturation et luminosité dans un carré, teinte sur une
// barre, code hexadécimal, pipette sur les autres zones. Écrit à la main (pointeur, clavier,
// aria) : aucune bibliothèque. Pendant un glissement, la couleur part vers le véhicule au plus une
// fois par image ; elle entre dans les dernières couleurs au relâchement.

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { Hex } from '../../data/vehicleTypes.ts';
import { normalizeHex } from '../../state/builds.ts';
import { hexToHsv, hsvToHex, type Hsv, type Pickable } from './paintLogic.ts';

interface ColorPickerProps {
  /** Couleur posée en ce moment sur la zone. */
  value: Hex;
  /** « Carrosserie », « Seconde teinte · Carrosserie »… */
  title: string;
  pickables: readonly Pickable[];
  /** Aperçu en direct (au plus une fois par image). */
  onLive: (hex: Hex) => void;
  /** Choix posé : relâchement, Entrée, pipette. */
  onCommit: (hex: Hex) => void;
  onClose: () => void;
}

const HUE_STEP = 5;
const HUE_PAGE = 30;
const SV_STEP = 0.02;
const SV_PAGE = 0.1;

const percent = (value: number) => `${Math.round(value * 100)} %`;
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** Coalesce les aperçus : le dernier de l'image part au rafraîchissement suivant. */
function useFrameSender(send: (hex: Hex) => void) {
  const pending = useRef<Hex | null>(null);
  const frame = useRef(0);
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  }, [send]);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  const flush = () => {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    if (pending.current !== null) sendRef.current(pending.current);
    pending.current = null;
  };
  const schedule = (hex: Hex) => {
    pending.current = hex;
    if (frame.current === 0) frame.current = requestAnimationFrame(flush);
  };
  return { schedule, flush };
}

export function ColorPicker({ value, title, pickables, onLive, onCommit, onClose }: ColorPickerProps) {
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value) ?? { h: 0, s: 0, v: 0 });
  const [text, setText] = useState<string>(value);
  // Couleur changée d'ailleurs (pipette, autre zone) : le nuancier la reprend, teinte gardée si grise.
  const [seen, setSeen] = useState<Hex>(value);
  if (value !== seen) {
    setSeen(value);
    if (value !== hsvToHex(hsv)) {
      setHsv(hexToHsv(value, hsv.h) ?? hsv);
      setText(value);
    }
  }

  const live = useFrameSender(onLive);
  const dragging = useRef<'sv' | 'hue' | null>(null);
  // Dernière couleur montrée : le relâchement peut arriver avant le rendu du dernier glissement.
  const latest = useRef<Hex>(value);

  const update = (next: Hsv) => {
    setHsv(next);
    const hex = hsvToHex(next);
    latest.current = hex;
    setText(hex);
    live.schedule(hex);
    return hex;
  };

  const commit = (hex: Hex) => {
    live.flush();
    onCommit(hex);
  };

  const fromSv = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return update({
      h: hsv.h,
      s: clamp01((event.clientX - box.left) / box.width),
      v: clamp01(1 - (event.clientY - box.top) / box.height),
    });
  };

  const fromHue = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return update({ ...hsv, h: Math.min(359.9, clamp01((event.clientX - box.left) / box.width) * 360) });
  };

  const down = (kind: 'sv' | 'hue', event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus({ preventScroll: true });
    dragging.current = kind;
    if (kind === 'sv') fromSv(event);
    else fromHue(event);
  };

  const move = (kind: 'sv' | 'hue', event: PointerEvent<HTMLDivElement>) => {
    if (dragging.current !== kind) return;
    if (kind === 'sv') fromSv(event);
    else fromHue(event);
  };

  const up = (event: PointerEvent<HTMLDivElement>) => {
    if (dragging.current === null) return;
    dragging.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    commit(latest.current);
  };

  const svKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey || event.key.startsWith('Page') ? SV_PAGE : SV_STEP;
    const moves: Record<string, Partial<Hsv>> = {
      ArrowLeft: { s: hsv.s - step },
      ArrowRight: { s: hsv.s + step },
      ArrowDown: { v: hsv.v - step },
      ArrowUp: { v: hsv.v + step },
      PageDown: { v: hsv.v - step },
      PageUp: { v: hsv.v + step },
      Home: { s: 0 },
      End: { s: 1 },
    };
    const patch = moves[event.key];
    if (!patch) return;
    event.preventDefault();
    update({ h: hsv.h, s: clamp01(patch.s ?? hsv.s), v: clamp01(patch.v ?? hsv.v) });
  };

  const hueKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, number> = {
      ArrowLeft: hsv.h - HUE_STEP,
      ArrowDown: hsv.h - HUE_STEP,
      ArrowRight: hsv.h + HUE_STEP,
      ArrowUp: hsv.h + HUE_STEP,
      PageDown: hsv.h - HUE_PAGE,
      PageUp: hsv.h + HUE_PAGE,
      Home: 0,
      End: 359,
    };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    update({ ...hsv, h: Math.min(359.9, Math.max(0, next)) });
  };

  // Au clavier, le choix est posé quand la touche remonte (le « relâchement » du clavier).
  const keyUp = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key.startsWith('Arrow') || event.key.startsWith('Page') || event.key === 'Home' || event.key === 'End') {
      commit(latest.current);
    }
  };

  const typeHex = (raw: string) => {
    setText(raw);
    const hex = /^#?[0-9a-f]{6}$/i.test(raw.trim()) ? normalizeHex(raw) : null;
    if (!hex) return;
    latest.current = hex;
    setHsv(hexToHsv(hex, hsv.h) ?? hsv);
    live.schedule(hex);
  };

  const commitText = () => {
    const hex = normalizeHex(text);
    if (!hex) {
      setText(hsvToHex(hsv));
      return;
    }
    latest.current = hex;
    setText(hex);
    setHsv(hexToHsv(hex, hsv.h) ?? hsv);
    commit(hex);
  };

  const current = hsvToHex(hsv);
  const pure = hsvToHex({ h: hsv.h, s: 1, v: 1 });

  return (
    <section className="paint-picker" aria-label={`Nuancier · ${title}`}>
      <header className="paint-picker-head">
        <span className="swatch paint-picker-now" aria-hidden="true" style={{ background: current }} />
        <b>{title}</b>
        <input
          className="paint-hex"
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          maxLength={7}
          aria-label="Code hexadécimal"
          value={text}
          onChange={(event) => typeHex(event.target.value)}
          onBlur={commitText}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitText();
            }
          }}
        />
        <button type="button" className="btn paint-done" onClick={onClose}>
          C’est bon
        </button>
      </header>

      <div
        className="paint-sv"
        role="slider"
        tabIndex={0}
        aria-label="Saturation et luminosité"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(hsv.s * 100)}
        aria-valuetext={`Saturation ${percent(hsv.s)}, luminosité ${percent(hsv.v)}`}
        style={{ backgroundColor: pure }}
        onPointerDown={(event) => down('sv', event)}
        onPointerMove={(event) => move('sv', event)}
        onPointerUp={up}
        onPointerCancel={up}
        onKeyDown={svKeys}
        onKeyUp={keyUp}
      >
        <span
          className="paint-thumb"
          aria-hidden="true"
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: current }}
        />
      </div>

      <div
        className="paint-hue"
        role="slider"
        tabIndex={0}
        aria-label="Teinte"
        aria-valuemin={0}
        aria-valuemax={359}
        aria-valuenow={Math.round(hsv.h)}
        aria-valuetext={`Teinte ${Math.round(hsv.h)} degrés`}
        onPointerDown={(event) => down('hue', event)}
        onPointerMove={(event) => move('hue', event)}
        onPointerUp={up}
        onPointerCancel={up}
        onKeyDown={hueKeys}
        onKeyUp={keyUp}
      >
        <span className="paint-thumb" aria-hidden="true" style={{ left: `${(hsv.h / 360) * 100}%`, background: pure }} />
      </div>

      {pickables.length > 0 && (
        <div className="paint-picker-row">
          <span className="paint-sep" aria-hidden="true">
            Pipette
          </span>
          <div className="chips paint-pipette" role="group" aria-label="Pipette : reprendre la couleur d’une zone">
            {pickables.map((item) => (
              <button
                key={item.zoneId}
                type="button"
                className="chip chip-swatch paint-pick"
                aria-label={`Reprendre ${item.label}`}
                onClick={() => {
                  setHsv(hexToHsv(item.color, hsv.h) ?? hsv);
                  setText(item.color);
                  latest.current = item.color;
                  commit(item.color);
                }}
              >
                <span className="swatch" aria-hidden="true" style={{ background: item.color }} />
                <b>{item.label}</b>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
