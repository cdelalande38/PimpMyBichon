// Petits dessins des choix du menu, à gauche du mot dans leur puce (classe chip-picto) : SVG fabriqué
// à partir des données du choix (src/ui/pictos/dessins.ts, src/ui/pictos/carte.ts), au trait de la
// couleur du texte ; la sphère des finitions et les ambiances portent leurs propres couleurs. Toujours
// aria-hidden : le nom du bouton reste son texte. Sans dessin (style inconnu, miniature absente), rien
// n'est rendu et la puce garde son mot seul.

import { useId } from 'react';
import { apercuDe } from './carte.ts';
import { dessinAssiette, dessinEtoiles, dessinJante, dessinPneu, dessinPommeau, dessinSiege, dessinVolant, sphere, type FinitionLike, type Trait } from './dessins.ts';
import './pictos.css';

function Traits({ traits, className = 'picto' }: { traits: readonly Trait[] | null; className?: string }) {
  if (!traits) return null;
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {traits.map((trait, index) => (
        <path
          key={index}
          d={trait.d}
          fill={trait.fill ? 'currentColor' : 'none'}
          fillOpacity={trait.fill}
          stroke={trait.w > 0 ? 'currentColor' : 'none'}
          strokeWidth={trait.w > 0 ? trait.w : undefined}
          strokeOpacity={trait.o}
          strokeDasharray={trait.dash}
          strokeLinecap={trait.butt ? 'butt' : undefined}
        />
      ))}
    </svg>
  );
}

export function PictoJante({ rim }: { rim: { style: string } }) {
  return <Traits traits={dessinJante(rim)} />;
}

export function PictoPneu({ tire }: { tire: { mark: string; tread?: string } }) {
  return <Traits traits={dessinPneu(tire)} />;
}

export function PictoVolant({ style }: { style: string }) {
  return <Traits traits={dessinVolant(style)} />;
}

export function PictoPommeau({ style }: { style: string }) {
  return <Traits traits={dessinPommeau(style)} />;
}

export function PictoSiege({ style }: { style: string }) {
  return <Traits traits={dessinSiege(style)} />;
}

export function PictoAssiette({ part }: { part: number }) {
  return <Traits traits={dessinAssiette(part)} />;
}

/** Étoiles d'une densité du ciel : petite icône au-dessus du mot (bouton de volet). */
export function PictoEtoiles({ facteur }: { facteur: number }) {
  return <Traits traits={dessinEtoiles(facteur)} className="icon picto-etoiles" />;
}

/** Identifiant sûr pour un dégradé SVG (url(#…)). */
function useSvgId(): string {
  return `p${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

/** Finition de peinture : une sphère peinte de la teinte de la zone, qui en montre le reflet. */
export function PictoFinition({ finish, color }: { finish: FinitionLike; color: string }) {
  const id = useSvgId();
  const s = sphere(finish, color);
  const disque = (fill: string) => <circle cx="12" cy="12" r="10" fill={fill} />;
  return (
    <svg className="picto picto-sphere" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={`${id}d`} cx="0.38" cy="0.34" r="0.72">
          <stop offset="0" stopColor={s.clair} />
          <stop offset="0.55" stopColor={s.base} />
          <stop offset="1" stopColor={s.ombre} />
        </radialGradient>
        {s.bord && (
          <radialGradient id={`${id}b`} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0.5" stopColor={s.bord.couleur} stopOpacity="0" />
            <stop offset="1" stopColor={s.bord.couleur} stopOpacity={s.bord.o} />
          </radialGradient>
        )}
        {s.profondeur && (
          <radialGradient id={`${id}p`} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0.45" stopColor={s.profondeur.couleur} stopOpacity="0" />
            <stop offset="1" stopColor={s.profondeur.couleur} stopOpacity={s.profondeur.o} />
          </radialGradient>
        )}
        {s.horizon > 0 && (
          <linearGradient id={`${id}h`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffffff" stopOpacity={0.4 * s.horizon} />
            <stop offset="0.5" stopColor="#ffffff" stopOpacity={0.05 * s.horizon} />
            <stop offset="0.53" stopColor="#000000" stopOpacity={0.6 * s.horizon} />
            <stop offset="0.75" stopColor="#000000" stopOpacity={0.2 * s.horizon} />
            <stop offset="1" stopColor="#ffffff" stopOpacity={0.3 * s.horizon} />
          </linearGradient>
        )}
        {s.irise > 0 && (
          <radialGradient id={`${id}i`} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0.55" stopColor="#66ddee" stopOpacity="0" />
            <stop offset="0.78" stopColor="#88ccff" stopOpacity={0.45 * s.irise} />
            <stop offset="0.9" stopColor="#ff88cc" stopOpacity={0.5 * s.irise} />
            <stop offset="1" stopColor="#ffdd88" stopOpacity={0.45 * s.irise} />
          </radialGradient>
        )}
        <radialGradient id={`${id}r`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffffff" stopOpacity={s.reflet.o} />
          <stop offset={0.6 * s.reflet.net} stopColor="#ffffff" stopOpacity={s.reflet.o} />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>
      {disque(`url(#${id}d)`)}
      {s.bord && disque(`url(#${id}b)`)}
      {s.profondeur && disque(`url(#${id}p)`)}
      {s.horizon > 0 && disque(`url(#${id}h)`)}
      {s.irise > 0 && disque(`url(#${id}i)`)}
      <ellipse cx="8.8" cy="8.3" rx={s.reflet.r} ry={s.reflet.r * 0.8} fill={`url(#${id}r)`} />
      {s.vernis > 0.05 && <circle cx="8.3" cy="7.7" r="0.95" fill="#ffffff" fillOpacity={s.vernis} />}
      {s.paillettes.map(([x, y, r], index) => (
        <circle key={index} cx={x} cy={y} r={r} fill="#ffffff" fillOpacity="0.9" />
      ))}
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeOpacity="0.45" strokeWidth="0.8" />
    </svg>
  );
}

/** Ambiance lumineuse : ses couleurs, gauche, nappe, milieu et droite, et ses trois spots. */
export function PictoAmbiance({ ambiance }: { ambiance: { left: string; violet: string; center: string; right: string; spots: readonly string[] } }) {
  const id = useSvgId();
  return (
    <svg className="picto" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}a`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={ambiance.left} />
          <stop offset="0.3" stopColor={ambiance.violet} />
          <stop offset="0.6" stopColor={ambiance.center} />
          <stop offset="1" stopColor={ambiance.right} />
        </linearGradient>
      </defs>
      <rect x="2" y="9.5" width="20" height="11" rx="2" fill={`url(#${id}a)`} stroke="currentColor" strokeOpacity="0.45" strokeWidth="0.8" />
      {ambiance.spots.slice(0, 3).map((spot, index) => (
        <circle key={index} cx={6 + index * 6} cy="5" r="2.1" fill={spot} stroke="currentColor" strokeOpacity="0.45" strokeWidth="0.8" />
      ))}
    </svg>
  );
}

/** Carte de sortie : la miniature de son tracé, départ en point plein, arrivée en anneau. */
export function PictoCarte({ id }: { id: string }) {
  const apercu = apercuDe(id);
  if (!apercu) return null;
  return (
    <svg className="picto picto-carte" viewBox={`0 0 ${apercu.taille} ${apercu.taille}`} aria-hidden="true" focusable="false">
      <path d={apercu.d} fill="none" stroke="currentColor" strokeWidth="1.5" />
      {apercu.arrivee && <circle cx={apercu.arrivee[0]} cy={apercu.arrivee[1]} r="1.5" fill="none" stroke="currentColor" strokeWidth="1" />}
      <circle cx={apercu.depart[0]} cy={apercu.depart[1]} r="1.7" fill="currentColor" />
    </svg>
  );
}
