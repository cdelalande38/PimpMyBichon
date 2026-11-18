// Claquement du retour de flammes au garage (Mécanique · Échappement, ./flammesGarage.ts) : une prise du
// moteur (emplacement `backfire` de son manifeste, celui que joue la sortie, src/audio/sfx/route.ts),
// jouée sur le contexte et la sortie du moteur qui tourne, au niveau des bruitages et du curseur
// « Route ». Rien n'est fabriqué : un moteur sans prise de claquement reste muet, sans erreur.

import { engineFileUrl, parseEngineManifest } from '../../audio/engine/manifeste.ts';
import { PONCTUELS_ROUTE } from '../../data/bruitages.ts';
import { useEngineSound } from '../../state/engineSound.ts';
import { useMixage } from '../../state/mixage.ts';

/** Emplacement du claquement dans le manifeste du moteur, et son niveau (celui des bruitages de la route). */
const CLAQUEMENT = PONCTUELS_ROUTE.find((ponctuel) => ponctuel.famille === 'moteur');

interface Prise {
  buffer: AudioBuffer;
  gain: number;
}

/** Prises du claquement d'une famille, décodées une fois par contexte audio (un échec : aucune, sans erreur). */
const prises = new WeakMap<AudioContext, Map<string, Promise<Prise[]>>>();

function prisesDe(ctx: AudioContext, famille: string): Promise<Prise[]> {
  let parFamille = prises.get(ctx);
  if (!parFamille) {
    parFamille = new Map();
    prises.set(ctx, parFamille);
  }
  let pending = parFamille.get(famille);
  if (!pending) {
    pending = (async () => {
      try {
        if (!CLAQUEMENT) return [];
        const base = import.meta.env.BASE_URL;
        const response = await fetch(engineFileUrl(base, famille, 'engine.json'));
        if (!response.ok) return [];
        const parsed = parseEngineManifest(await response.json());
        if ('problems' in parsed) return [];
        const shots = parsed.manifest.ponctuels.filter((shot) => shot.emplacement === CLAQUEMENT.emplacement);
        const decoded = await Promise.all(
          shots.map(async (shot) => {
            const res = await fetch(engineFileUrl(base, famille, shot.fichier, shot.empreinte));
            if (!res.ok) return null;
            return { buffer: await ctx.decodeAudioData(await res.arrayBuffer()), gain: shot.gain };
          }),
        );
        return decoded.filter((prise): prise is Prise => prise !== null);
      } catch {
        return [];
      }
    })();
    parFamille.set(famille, pending);
  }
  return pending;
}

/** Joue un claquement du moteur qui tourne au garage, s'il en a une prise ; muet sinon. */
export function claquer(): void {
  const moteur = useEngineSound.getState();
  const audio = moteur.audio();
  const famille = moteur.famille;
  if (!audio || !famille || !CLAQUEMENT) return;
  void prisesDe(audio.ctx, famille).then((liste) => {
    const prise = liste[Math.floor(Math.random() * liste.length)];
    const niveau = (CLAQUEMENT.niveau * useMixage.getState().route) / 100;
    if (!prise || niveau <= 0 || audio.ctx.state !== 'running') return;
    const source = audio.ctx.createBufferSource();
    source.buffer = prise.buffer;
    const gain = audio.ctx.createGain();
    gain.gain.value = niveau * 10 ** (prise.gain / 20);
    source.connect(gain).connect(audio.sortie);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
    };
    source.start();
  });
}
