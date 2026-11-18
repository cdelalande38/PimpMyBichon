// Onglet « Stickers » du dock (§ 5.3, premier lot) : on choisit une zone du véhicule (celles que
// déclare son manifeste), on y pose un motif de la bibliothèque, puis on le règle au doigt sur le
// plan à plat de la zone : glisser pour déplacer, la poignée ronde pour tourner et agrandir, et les
// curseurs de taille, de rotation et d'opacité en repli (aucun geste à deux doigts). Retourner,
// colorer, dupliquer, changer l'ordre, supprimer. La symétrie gauche-droite est mise par défaut sur
// les flancs : le flanc droit reprend le gauche en miroir. Le véhicule à l'écran suit en direct.
// Tant que le panneau est ouvert, la caméra du garage montre la zone choisie en grand au-dessus de lui
// (src/scene/cadrageZone.ts, src/scene/useZoneFraming.ts), puis revient à la vue d'avant. Un pack pas
// encore acheté se débloque sur place (bloc d'achat partagé) ; un trophée pas encore gagné dit comment
// le gagner.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { possedeDans } from "../../jeu/achats.ts";
import { articleParId } from "../../data/boutique.ts";
import { PAINT_COLORS } from "../../data/paintColors.ts";
import {
  motifsOf,
  STICKER_PACKS,
  stickerById,
  stickerUnlocked,
  type StickerMotif,
  type StickerPack,
} from "../../data/stickers.ts";
import {
  addLayer,
  duplicateLayer,
  editableZones,
  MAX_LAYERS,
  maxSize,
  mirrorOn,
  moveLayer,
  OPACITY_RANGE,
  removeLayer,
  setMirror,
  SIZE_MIN,
  twinOf,
  updateLayer,
  type BuildStickers,
  type LiveryZone,
  type StickerLayer,
} from "../../data/stickersCalques.ts";
import { stickerUrl } from "../../data/stickersFichiers.ts";
import { resolveVehicle } from "../../data/vehicles.ts";
import { useZoneFocus } from "../../scene/cadrageZone.ts";
import { useBuilds } from "../../state/builds.ts";
import { useJeu } from "../../state/jeu.ts";
import { useView } from "../../state/view.ts";
import { Achat } from "../jeu/Achat.tsx";
import { dollars } from "../jeu/libelles.ts";
import { Padlock } from "../paint/Padlock.tsx";
import { handleGesture, PLAN_MAX_HEIGHT, planWidth } from "./gestes.ts";
import { packForSale, trophyHint } from "./verrous.ts";
import "./stickers.css";

type Tab = StickerPack | "trophees";
const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  ...STICKER_PACKS.map((pack) => ({ id: pack.id as Tab, label: pack.label })),
  { id: "trophees", label: "Trophées" },
];

/** Écart de la poignée au coin du sticker, en pixels. */
const HANDLE_GAP = 26;

/** Délai entre deux enregistrements pendant un glissé : la texture du véhicule n'est pas refaite à chaque image. */
const DRAG_COMMIT_MS = 120;

function maskStyle(motif: string): CSSProperties {
  const url = stickerUrl(motif);
  return url
    ? { maskImage: `url("${url}")`, WebkitMaskImage: `url("${url}")` }
    : {};
}

function MotifThumb({ motif, color }: { motif: string; color?: string }) {
  return (
    <span
      className="stk-thumb"
      aria-hidden="true"
      style={{ ...maskStyle(motif), background: color ?? "currentColor" }}
    />
  );
}

export function StickersPanel() {
  const vehicle = resolveVehicle(useBuilds((state) => state.current));
  const saved = useBuilds((state) => state.builds[vehicle.id]?.stickers);
  const setStickers = useBuilds((state) => state.setStickers);
  // Ce qui est acheté ou gagné (src/state/jeu.ts) : le panneau suit un achat ou un haut fait sans
  // qu'on ait à le rouvrir.
  const acquis = useJeu((state) => state.articles);
  const owns = useCallback(
    (article: string) => possedeDans({ articles: acquis }, article),
    [acquis],
  );
  const zones = useMemo(() => vehicle.livery ?? [], [vehicle]);
  const editable = editableZones(zones, saved);
  const [zoneId, setZoneId] = useState<string | null>(null);
  const zone = editable.find((item) => item.id === zoneId) ?? editable[0];
  // Calque choisi, retenu avec sa zone : changer de zone ou de véhicule le lâche.
  const [choice, setChoice] = useState<{ key: string; index: number } | null>(
    null,
  );
  const [library, setLibrary] = useState(false);
  const [tab, setTab] = useState<Tab>("depart");
  const [notice, setNotice] = useState("");
  // Pack dont le bloc d'achat est ouvert sous la bibliothèque (identifiant d'article), ou aucun.
  const [buying, setBuying] = useState<string | null>(null);
  // Curseurs de taille, de rotation et d'opacité : en repli, sous un bouton (le plan suffit au doigt).
  const [fine, setFine] = useState(false);
  // Calques en cours de glissé : affichés tout de suite, enregistrés par paquets.
  const [draft, setDraft] = useState<StickerLayer[] | null>(null);
  const pending = useRef<{ timer: number; layers: StickerLayer[] | null }>({
    timer: 0,
    layers: null,
  });

  const key = `${vehicle.id}/${zone?.id ?? ""}`;
  const selected = choice?.key === key ? choice.index : null;
  const setSelected = (index: number | null) =>
    setChoice(index === null ? null : { key, index });
  const layers = draft ?? (zone ? (saved?.layers[zone.id] ?? []) : []);
  const layer = selected === null ? undefined : layers[selected];

  useEffect(() => () => window.clearTimeout(pending.current.timer), []);

  // Cadrage : la scène montre la zone choisie au-dessus du panneau, tant qu'il est ouvert ; on la
  // regarde de dehors (la vue intérieure se referme).
  const root = useRef<HTMLDivElement>(null);
  const focusZone = zone?.id ?? null;
  useEffect(() => {
    useZoneFocus
      .getState()
      .setFocus(focusZone ? { vehicle: vehicle.id, zone: focusZone } : null);
  }, [vehicle.id, focusZone]);
  useEffect(() => {
    useView.getState().setMode("atelier");
    return () => {
      useZoneFocus.getState().setFocus(null);
      useZoneFocus.getState().setCoverTop(null);
    };
  }, []);
  // Haut du panneau à l'écran (le dock qui le porte) : la zone se cadre au-dessus. Gelé pendant la
  // bibliothèque, plus haute : on choisit un motif, la caméra ne fait pas l'aller-retour.
  useLayoutEffect(() => {
    if (library) return undefined;
    const element = root.current;
    const dock = element?.closest<HTMLElement>("footer.dock") ?? element;
    if (!dock) return undefined;
    const measure = () =>
      useZoneFocus
        .getState()
        .setCoverTop(Math.round(dock.getBoundingClientRect().top));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(dock);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [library, focusZone]);

  if (!zone) {
    return (
      <p className="stk-empty">
        Ce véhicule n’a pas encore de zone où coller un sticker.
      </p>
    );
  }

  const write = (
    next: StickerLayer[],
    stickers: BuildStickers | undefined = useBuilds.getState().builds[
      vehicle.id
    ]?.stickers,
  ) => {
    const kept: BuildStickers = {
      ...stickers,
      layers: { ...stickers?.layers, [zone.id]: next },
    };
    setStickers(vehicle.id, kept);
  };
  const commit = (next: StickerLayer[] | null) => {
    if (next) write(next);
  };
  // Glissé : enregistré au plus toutes les DRAG_COMMIT_MS, et au lâcher.
  const dragTo = (next: StickerLayer[]) => {
    setDraft(next);
    pending.current.layers = next;
    if (pending.current.timer) return;
    pending.current.timer = window.setTimeout(() => {
      pending.current.timer = 0;
      if (pending.current.layers) write(pending.current.layers);
    }, DRAG_COMMIT_MS);
  };
  const dragEnd = () => {
    window.clearTimeout(pending.current.timer);
    pending.current.timer = 0;
    if (pending.current.layers) write(pending.current.layers);
    pending.current.layers = null;
    setDraft(null);
  };
  const patch = (change: Partial<StickerLayer>) => {
    if (selected !== null) commit(updateLayer(layers, selected, change, zone));
  };

  const twin = twinOf(zones, zone.id);
  const mirrored = twin !== undefined && mirrorOn(saved);
  const zoneLabel = (item: LiveryZone) => {
    const pair = twinOf(zones, item.id);
    return pair && mirrorOn(saved)
      ? (item.pairLabel ?? `${item.label} + ${pair.label.toLowerCase()}`)
      : item.label;
  };

  const pick = (motif: StickerMotif) => {
    if (!stickerUnlocked(motif, owns)) {
      // Motif d'un pack à vendre : le bloc d'achat s'ouvre ; trophée : comment le gagner.
      const sale = packForSale(motif.pack);
      if (sale) {
        setBuying(sale.id);
        setNotice("");
      } else setNotice(`${motif.label}. ${trophyHint(motif)}`);
      return;
    }
    const color = layer?.color ?? "#f4f1ea";
    const next = addLayer(layers, zone, motif, color);
    if (!next) {
      setNotice(
        `${MAX_LAYERS} stickers au plus sur une zone : enlève-en un d’abord.`,
      );
      return;
    }
    commit(next);
    setSelected(next.length - 1);
    setLibrary(false);
    setNotice("");
  };

  // --- Plan à plat de la zone ---
  const ratio = zone.size[0] / zone.size[1];
  const startMove = (event: ReactPointerEvent<HTMLElement>, index: number) => {
    event.stopPropagation();
    setSelected(index);
    const plan = (event.currentTarget as HTMLElement).closest(".stk-plan-cadre");
    const start = layers[index];
    if (!plan || !start) return;
    const box = plan.getBoundingClientRect();
    const origin = { x: event.clientX, y: event.clientY };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) => {
      const x = start.x + (moveEvent.clientX - origin.x) / box.width;
      const y = start.y - (moveEvent.clientY - origin.y) / box.height;
      dragTo(updateLayer(layers, index, { x, y }, zone));
    };
    const target = event.currentTarget as HTMLElement;
    const end = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", end);
      target.removeEventListener("pointercancel", end);
      dragEnd();
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", end);
    target.addEventListener("pointercancel", end);
  };
  const startHandle = (event: ReactPointerEvent<HTMLElement>) => {
    event.stopPropagation();
    if (selected === null || !layer) return;
    const plan = (event.currentTarget as HTMLElement).closest(".stk-plan-cadre");
    if (!plan) return;
    const box = plan.getBoundingClientRect();
    const index = selected;
    const start = layer;
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    const centre = {
      x: box.left + start.x * box.width,
      y: box.top + (1 - start.y) * box.height,
    };
    const from = { x: event.clientX - centre.x, y: event.clientY - centre.y };
    const move = (moveEvent: PointerEvent) => {
      const change = handleGesture(start, from, {
        x: moveEvent.clientX - centre.x,
        y: moveEvent.clientY - centre.y,
      });
      dragTo(updateLayer(layers, index, change, zone));
    };
    const end = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", end);
      target.removeEventListener("pointercancel", end);
      dragEnd();
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", end);
    target.addEventListener("pointercancel", end);
  };

  const stickerStyle = (item: StickerLayer): CSSProperties => {
    const motifRatio = stickerById(item.motif)?.ratio ?? 1;
    return {
      ...maskStyle(item.motif),
      left: `${item.x * 100}%`,
      bottom: `${item.y * 100}%`,
      width: `${((item.size * motifRatio) / zone.size[0]) * 100}%`,
      height: `${(item.size / zone.size[1]) * 100}%`,
      transform: `translate(-50%, 50%) rotate(${-item.rotation}deg) scaleX(${item.flip ? -1 : 1})`,
      background: item.color,
      opacity: item.opacity,
    };
  };
  // Poignée : au coin haut droit du sticker choisi, tournée avec lui.
  const handleStyle = (item: StickerLayer): CSSProperties => {
    const motifRatio = stickerById(item.motif)?.ratio ?? 1;
    const angle = (item.rotation * Math.PI) / 180;
    const w = (item.size * motifRatio) / zone.size[0] / 2;
    const h = item.size / zone.size[1] / 2;
    // En fractions du plan : x en largeur, y en hauteur ; la rotation se fait en mètres.
    const mx =
      w * zone.size[0] * Math.cos(angle) - h * zone.size[1] * Math.sin(angle);
    const my =
      w * zone.size[0] * Math.sin(angle) + h * zone.size[1] * Math.cos(angle);
    // Écartée du coin de HANDLE_GAP px vers l'extérieur : sur un petit sticker, elle ne cache pas le
    // milieu, qu'on prend pour le déplacer (le plan a la même échelle en largeur et en hauteur).
    const length = Math.hypot(mx, my) || 1;
    const gap = {
      x: (mx / length) * HANDLE_GAP,
      y: (-my / length) * HANDLE_GAP,
    };
    return {
      left: `${(item.x + mx / zone.size[0]) * 100}%`,
      bottom: `${(item.y + my / zone.size[1]) * 100}%`,
      transform: `translate(-50%, 50%) translate(${gap.x.toFixed(1)}px, ${gap.y.toFixed(1)}px)`,
    };
  };

  const sale = tab === "trophees" ? undefined : packForSale(tab);
  const saleOpen = sale !== undefined && !owns(sale.id);
  const buyingArticle =
    buying !== null && !owns(buying) ? articleParId(buying) : undefined;
  const libraryView = (
    <div className="stk-library" data-bibliotheque="">
      <div
        className="chips stk-tabs"
        role="group"
        aria-label="Packs de stickers"
      >
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className="chip"
            aria-pressed={tab === item.id}
            onClick={() => {
              setTab(item.id);
              setBuying(null);
              setNotice("");
            }}
          >
            <b>{item.label}</b>
          </button>
        ))}
      </div>
      {saleOpen && sale && (
        <button
          type="button"
          className="btn stk-offer"
          data-pack={sale.id}
          aria-expanded={buying === sale.id}
          onClick={() => {
            setNotice("");
            setBuying(buying === sale.id ? null : sale.id);
          }}
        >
          <Padlock open={false} className="stk-offer-lock" />
          <span>Débloquer le {sale.label}</span>
          <b>{dollars(sale.prix ?? 0)}</b>
        </button>
      )}
      {buyingArticle && (
        <Achat
          article={buyingArticle}
          nom={`le ${buyingArticle.label}`}
          fait={`${buyingArticle.label} débloqué : ses motifs sont à toi.`}
          onClose={() => setBuying(null)}
          onDone={(text) => {
            setBuying(null);
            setNotice(text);
          }}
        />
      )}
      {tab === "trophees" ? (
        <ul className="stk-trophees" aria-label="Trophées">
          {motifsOf(null).map((motif) => {
            const won = stickerUnlocked(motif, owns);
            return (
              <li key={motif.id}>
                <button
                  type="button"
                  className="stk-trophee"
                  data-motif={motif.id}
                  data-verrou={won ? undefined : "ferme"}
                  aria-label={
                    won
                      ? `${motif.label}, gagné`
                      : `${motif.label}, à gagner. ${trophyHint(motif)}`
                  }
                  onClick={() => pick(motif)}
                >
                  <MotifThumb motif={motif.id} />
                  <span className="stk-trophee-texte">
                    <b>{motif.label}</b>
                    <small>
                      {won ? "Gagné : touche pour le poser." : trophyHint(motif)}
                    </small>
                  </span>
                  {!won && <Padlock open={false} className="stk-lock" />}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="stk-grid" role="group" aria-label="Motifs">
          {motifsOf(tab).map((motif) => {
            const free = stickerUnlocked(motif, owns);
            return (
              <button
                key={motif.id}
                type="button"
                className="stk-tile"
                data-motif={motif.id}
                data-verrou={free ? undefined : "ferme"}
                aria-label={free ? motif.label : `${motif.label}, verrouillé`}
                onClick={() => pick(motif)}
              >
                <MotifThumb motif={motif.id} />
                <small>{motif.label}</small>
                {!free && <Padlock open={false} className="stk-lock" />}
              </button>
            );
          })}
        </div>
      )}
      <button
        type="button"
        className="btn stk-back"
        onClick={() => {
          setLibrary(false);
          setBuying(null);
        }}
      >
        Retour à la zone
      </button>
    </div>
  );

  return (
    <div ref={root} className="stickers" data-zone={zone.id}>
      <div
        className="chips stk-zones"
        role="group"
        aria-label="Zones de stickers"
      >
        {editable.map((item) => (
          <button
            key={item.id}
            type="button"
            className="chip"
            aria-pressed={item.id === zone.id}
            onClick={() => setZoneId(item.id)}
          >
            <b>{zoneLabel(item)}</b>
          </button>
        ))}
        {twin && (
          <button
            type="button"
            className="chip stk-mirror"
            aria-pressed={mirrored}
            onClick={() =>
              setStickers(vehicle.id, setMirror(zones, saved, !mirrored))
            }
          >
            <b>Symétrie</b>
            <small>{mirrored ? "gauche = droite" : "côtés libres"}</small>
          </button>
        )}
      </div>

      {library ? (
        libraryView
      ) : (
        <>
          <div className="stk-plan-wrap">
            {/* Le plan rogne les stickers à la zone ; la poignée, à côté, reste visible et prenable
                même quand le sticker remplit la zone. */}
            <div
              className="stk-plan-cadre"
              style={{
                width: planWidth(ratio),
                aspectRatio: `${zone.size[0]} / ${zone.size[1]}`,
                maxHeight: PLAN_MAX_HEIGHT,
              }}
            >
            <div
              className="stk-plan"
              aria-label={`Plan de la zone : ${zone.label}`}
              onPointerDown={() => setSelected(null)}
            >
              {layers.map((item, index) => (
                <button
                  key={index}
                  type="button"
                  className="stk-layer"
                  data-calque={index}
                  aria-pressed={selected === index}
                  aria-label={`${stickerById(item.motif)?.label ?? item.motif}, calque ${index + 1}`}
                  style={stickerStyle(item)}
                  onPointerDown={(event) => startMove(event, index)}
                />
              ))}
            </div>
              {layer && (
                <span
                  className="stk-handle"
                  data-poignee=""
                  style={handleStyle(layer)}
                  onPointerDown={startHandle}
                  aria-hidden="true"
                >
                  <span />
                </span>
              )}
            </div>
          </div>

          {/* Une seule rangée sous le plan : les calques, l'ajout, puis les gestes du calque choisi. */}
          <div className="chips stk-tools">
            <div className="stk-row stk-layers" role="group" aria-label="Calques">
              {layers.map((item, index) => (
                <button
                  key={index}
                  type="button"
                  className="stk-pick"
                  aria-pressed={selected === index}
                  aria-label={`Calque ${index + 1}`}
                  onClick={() => setSelected(index)}
                >
                  <MotifThumb motif={item.motif} color={item.color} />
                </button>
              ))}
              <button
                type="button"
                className="btn stk-add"
                aria-label="Ajouter un sticker"
                disabled={layers.length >= MAX_LAYERS}
                onClick={() => {
                  setLibrary(true);
                  setNotice("");
                }}
              >
                <span aria-hidden="true">+</span> Ajouter
              </button>
            </div>
            {layer && selected !== null && (
              <div
                className="stk-row stk-actions"
                role="group"
                aria-label="Gestes sur le sticker"
              >
                <button
                  type="button"
                  className="btn"
                  onClick={() => patch({ flip: !layer.flip })}
                >
                  Retourner
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={layers.length >= MAX_LAYERS}
                  onClick={() => {
                    const next = duplicateLayer(layers, selected);
                    if (next) {
                      commit(next);
                      setSelected(selected + 1);
                    }
                  }}
                >
                  Dupliquer
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={selected === layers.length - 1}
                  onClick={() => {
                    const moved = moveLayer(layers, selected, 1);
                    commit(moved.layers);
                    setSelected(moved.index);
                  }}
                >
                  Devant
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={selected === 0}
                  onClick={() => {
                    const moved = moveLayer(layers, selected, -1);
                    commit(moved.layers);
                    setSelected(moved.index);
                  }}
                >
                  Derrière
                </button>
                <button
                  type="button"
                  className="btn stk-delete"
                  onClick={() => {
                    commit(removeLayer(layers, selected));
                    setSelected(null);
                  }}
                >
                  Supprimer
                </button>
                <button
                  type="button"
                  className="btn"
                  aria-pressed={fine}
                  onClick={() => setFine(!fine)}
                >
                  Curseurs
                </button>
              </div>
            )}
          </div>

          {layer && selected !== null && (
            <div className="stk-edit" data-calque-choisi={selected}>
              <div
                className="chips stk-colors"
                role="group"
                aria-label="Couleur du sticker"
              >
                {[
                  { id: "blanc", label: "Blanc", hex: "#f4f1ea" },
                  ...PAINT_COLORS,
                ].map((color) => (
                  <button
                    key={color.id}
                    type="button"
                    className="stk-dot"
                    aria-label={color.label}
                    aria-pressed={layer.color === color.hex}
                    onClick={() => patch({ color: color.hex })}
                  >
                    <span style={{ background: color.hex }} />
                  </button>
                ))}
              </div>
              {fine && (
                <div className="stk-sliders">
                  <label>
                    <span>Taille</span>
                    <input
                      type="range"
                      min={SIZE_MIN}
                      max={maxSize(zone, stickerById(layer.motif)?.ratio ?? 1)}
                      step={0.01}
                      value={layer.size}
                      onChange={(event) =>
                        patch({ size: Number(event.target.value) })
                      }
                    />
                    <output>{Math.round(layer.size * 100)} cm</output>
                  </label>
                  <label>
                    <span>Rotation</span>
                    <input
                      type="range"
                      min={-180}
                      max={180}
                      step={1}
                      value={layer.rotation}
                      onChange={(event) =>
                        patch({ rotation: Number(event.target.value) })
                      }
                    />
                    <output>{Math.round(layer.rotation)}°</output>
                  </label>
                  <label>
                    <span>Opacité</span>
                    <input
                      type="range"
                      min={OPACITY_RANGE.min}
                      max={OPACITY_RANGE.max}
                      step={0.05}
                      value={layer.opacity}
                      onChange={(event) =>
                        patch({ opacity: Number(event.target.value) })
                      }
                    />
                    <output>{Math.round(layer.opacity * 100)} %</output>
                  </label>
                </div>
              )}
            </div>
          )}
        </>
      )}
      <p className="stk-notice" role="status" aria-live="polite">
        {notice}
      </p>
    </div>
  );
}
