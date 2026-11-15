// Petites pièces communes au dock et au panneau de la radio : icônes et mise en forme.

const number = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

/** Poids lisible : « 406 Mo », « 1,2 Go ». */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return 'inconnu';
  if (bytes >= 1e9) return `${number.format(bytes / 1e9)} Go`;
  if (bytes >= 1e6) return `${number.format(Math.round(bytes / 1e5) / 10)} Mo`;
  return `${Math.max(1, Math.round(bytes / 1e3))} ko`;
}

export function percent(done: number, total: number | null): string | null {
  if (!total) return null;
  return `${Math.min(100, Math.floor((done / total) * 100))} %`;
}

export function formatDuration(seconds: number | undefined): string {
  if (!seconds || !Number.isFinite(seconds)) return '';
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count > 1 ? many : one}`;
}

const svg = { width: 22, height: 22, viewBox: '0 0 24 24', 'aria-hidden': true, focusable: false } as const;

export function IconPlay() {
  return (
    <svg {...svg}>
      <path d="M7 4.5v15l12.5-7.5z" fill="currentColor" />
    </svg>
  );
}

export function IconPause() {
  return (
    <svg {...svg}>
      <path d="M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z" fill="currentColor" />
    </svg>
  );
}

export function IconNext() {
  return (
    <svg {...svg}>
      <path d="M5 5v14l10-7zM16.5 5h3v14h-3z" fill="currentColor" />
    </svg>
  );
}

export function IconPrevious() {
  return (
    <svg {...svg}>
      <path d="M19 5v14L9 12zM4.5 5h3v14h-3z" fill="currentColor" />
    </svg>
  );
}

export function IconShuffle() {
  return (
    <svg {...svg}>
      <path
        d="M3 7h3.5c2 0 3.2 1 4.3 2.6l2.4 3.8c1.1 1.6 2.3 2.6 4.3 2.6H20M3 17h3.5c1.3 0 2.2-.4 3-1.2M14 8.2c.8-.8 1.7-1.2 3-1.2H20M17.5 4.5 20 7l-2.5 2.5M17.5 14.5 20 17l-2.5 2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
