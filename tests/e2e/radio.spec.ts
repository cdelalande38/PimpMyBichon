// Parcours de la radio : import par fichier, lecture, suivant, rechargement, suppression ;
// import par adresse depuis un hébergement d'essai sur une autre origine (avec et sans CORS) ;
// arrivée par un lien « ?pack= ». Les packs sont fabriqués par le test (bruit faible en WAV).

import type { Server } from 'node:http';
import { expect, test, type Page } from '@playwright/test';
import { openAtelier } from './helpers.ts';
import { noiseWav, smallPack, startPackServer, type PackSource } from '../radio/server.ts';

// Port de l'hébergement d'essai, réglable quand plusieurs suites tournent en même temps sur la machine.
const PACK_PORT = Number(process.env.PMB_RADIO_PORT ?? 4521);
const HOST = `localhost:${PACK_PORT}`;
const packs = new Map<string, PackSource>([
  ['pack.zip', { buffer: smallPack() }],
  ['autre.zip', { buffer: smallPack(['hiphop-rnb']) }],
]);
if (process.env.PMB_RADIO_GROS) packs.set('gros.zip', { file: process.env.PMB_RADIO_GROS });

let server: Server | null = null;
const requests: string[] = [];

test.beforeAll(async () => {
  server = await startPackServer(PACK_PORT, packs, requests);
});

test.afterAll(async () => {
  await new Promise((resolve) => server?.close(resolve));
});

async function openRadio(page: Page): Promise<void> {
  await page.goto('./');
  await page.getByRole('button', { name: /^Radio/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Radio', level: 2 })).toBeVisible();
}

const station = (page: Page, name: string) => page.locator('.radio-station', { has: page.getByText(name, { exact: true }) });

// Sur une machine chargée (WebGL en rendu logiciel), l'horloge audio de Chromium sans tête avance
// par à-coups : les attentes sur la position de lecture sont donc larges.
async function clockSeconds(page: Page): Promise<number> {
  const text = (await page.getByTestId('radio-temps').textContent()) ?? '0:00';
  const [m, s] = text.split('/')[0]!.trim().split(':').map(Number);
  return (m ?? 0) * 60 + (s ?? 0);
}

test('import par fichier, lecture, suivant, rechargement, suppression', async ({ page }) => {
  // Parcours long (import, lecture, rechargement, deux suppressions) : plus de temps sur une machine chargée.
  test.setTimeout(150_000);
  await openRadio(page);
  await expect(page.getByText('Ta radio est vide.')).toBeVisible();
  await page.getByTestId('radio-fichier-pack').setInputFiles({
    name: 'pack-essai.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from(smallPack()),
  });
  await expect(page.getByText('Stations ajoutées')).toBeVisible({ timeout: 45_000 });
  await expect(station(page, 'Électro')).toContainText('2 morceaux');
  await expect(station(page, 'Rock')).toBeVisible();

  await page.getByRole('button', { name: 'Écouter Électro' }).click();
  await expect(page.getByTestId('radio-titre')).toHaveText('Bruit d’essai 1a');
  expect(await page.evaluate(() => navigator.mediaSession.metadata?.title)).toBe('Bruit d’essai 1a');
  await expect.poll(() => clockSeconds(page), { timeout: 45_000 }).toBeGreaterThanOrEqual(2);

  await page.locator('.radio-player').getByRole('button', { name: 'Morceau suivant' }).click();
  await expect(page.getByTestId('radio-titre')).toHaveText('Bruit d’essai 1b');
  await expect.poll(() => clockSeconds(page), { timeout: 45_000 }).toBeGreaterThanOrEqual(1);
  await page.screenshot({ path: 'test-results/radio-lecture.png' });

  // Panneau fermé : la musique continue, le mini-lecteur du dock la montre.
  await page.getByRole('button', { name: 'Retour à l’atelier' }).click();
  // (Le morceau a pu s'achever entre-temps : l'enchaînement repart alors sur le premier.)
  await expect(page.locator('.radio-mini')).toContainText(/Bruit d’essai 1[ab]/);
  await expect(page.locator('.radio-mini').getByRole('button', { name: 'Pause' })).toBeVisible();
  await page.screenshot({ path: 'test-results/radio-dock.png' });

  await page.reload();
  await page.getByRole('button', { name: /^Radio/ }).first().click();
  await expect(station(page, 'Électro')).toBeVisible();
  await expect(station(page, 'Rock')).toBeVisible();

  const placeBefore = await page.getByTestId('radio-place').textContent();
  await station(page, 'Rock').getByRole('button', { name: /^Rock/ }).click();
  await station(page, 'Rock').getByRole('button', { name: 'Supprimer la station' }).click();
  await station(page, 'Rock').getByRole('button', { name: 'Supprimer', exact: true }).click();
  await expect(station(page, 'Rock')).toHaveCount(0);
  await expect(station(page, 'Électro')).toBeVisible();
  await station(page, 'Électro').getByRole('button', { name: /^Électro/ }).click();
  await station(page, 'Électro').getByRole('button', { name: 'Supprimer la station' }).click();
  await station(page, 'Électro').getByRole('button', { name: 'Supprimer', exact: true }).click();
  await expect(page.getByText('Ta radio est vide.')).toBeVisible();
  await expect(page.getByTestId('radio-place')).not.toHaveText(placeBefore ?? '');
  const files = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('radio');
    const names: string[] = [];
    for await (const name of (dir as unknown as { keys(): AsyncIterable<string> }).keys()) names.push(name);
    return names;
  });
  expect(files).toEqual([]);
});

test('import par adresse : avec CORS, puis sans CORS', async ({ page }) => {
  await openRadio(page);
  await page.getByRole('button', { name: 'Depuis une adresse' }).click();
  await page.getByLabel('Adresse du pack (ZIP)').fill(`http://${HOST}/cors/pack.zip`);
  await page.getByRole('button', { name: 'Télécharger' }).click();
  await expect(page.getByText('Stations ajoutées')).toBeVisible({ timeout: 45_000 });
  await expect(station(page, 'Électro')).toBeVisible();
  await page.getByRole('button', { name: 'OK' }).click();

  await page.getByRole('button', { name: 'Depuis une adresse' }).click();
  await page.getByLabel('Adresse du pack (ZIP)').fill(`http://${HOST}/nocors/autre.zip`);
  await page.getByRole('button', { name: 'Télécharger' }).click();
  await expect(page.getByRole('alert')).toContainText('n’autorise pas l’atelier à lire le fichier');
  await page.screenshot({ path: 'test-results/radio-cors.png' });

  await page.getByRole('button', { name: 'Fermer' }).click();
  await page.getByRole('button', { name: 'Depuis une adresse' }).click();
  await page.getByLabel('Adresse du pack (ZIP)').fill(`http://${HOST}/cors/absent.zip`);
  await page.getByRole('button', { name: 'Télécharger' }).click();
  await expect(page.getByRole('alert')).toContainText('Adresse introuvable');
});

test('arrivée par un lien ?pack= : le téléchargement part tout seul, puis la musique', async ({ page }) => {
  requests.length = 0;
  await page.goto(`./?pack=${encodeURIComponent(`http://${HOST}/cors/autre.zip`)}`);
  await expect(page.getByRole('heading', { name: /radio/i, level: 2 })).toBeVisible();
  expect(page.url()).not.toContain('pack=');
  await expect(station(page, 'Hip-hop & R&B')).toBeVisible({ timeout: 45_000 });
  expect(requests).toContain('GET /cors/autre.zip');
  // Selon le navigateur, la musique part d'elle-même ou attend le premier appui.
  await expect(page.locator('.radio-player .radio-tap').or(page.locator('.radio-player').getByRole('button', { name: 'Pause' }))).toBeVisible();
  await page.screenshot({ path: 'test-results/radio-lien.png' });

  // Le même lien une seconde fois : le pack est reconnu, rien ne part vers l'hébergement.
  requests.length = 0;
  await page.goto('about:blank');
  await page.goto(`./#pack=http://${HOST}/cors/autre.zip`);
  await expect(page.getByText('Ce pack est déjà dans ta radio : rien à télécharger.')).toBeVisible();
  await page.waitForTimeout(1000);
  expect(requests).toEqual([]);
});

test('économie de données : le pack reçu par lien attend un appui', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'connection', { value: { saveData: true }, configurable: true });
  });
  requests.length = 0;
  await page.goto(`./?pack=http://${HOST}/cors/autre.zip`);
  await expect(page.getByText('Un pack de musique t’attend')).toBeVisible();
  await expect(page.locator('.radio-offer')).toContainText(`Hébergé chez ${HOST}`);
  await page.waitForTimeout(1500);
  expect(requests).toEqual([]);
  await page.locator('.radio-offer').getByRole('button', { name: 'Télécharger' }).click();
  await expect(station(page, 'Hip-hop & R&B')).toBeVisible({ timeout: 45_000 });
});

test('réglage « Lecture automatique » coupé : rien ne démarre après un import ni à l’ouverture', async ({ page }) => {
  await page.goto('./');
  await openAtelier(page, 'Réglages');
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Lecture automatique' }).click();
  await dialog.getByRole('button', { name: /^Coupée/ }).click();
  await expect(dialog.getByRole('button', { name: /^Coupée/ })).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByRole('button', { name: 'Retour à l’atelier' }).click();
  await page.getByRole('button', { name: /^Radio/ }).first().click();
  await page.getByTestId('radio-fichier-pack').setInputFiles({ name: 'p.zip', mimeType: 'application/zip', buffer: Buffer.from(smallPack()) });
  await expect(page.getByText('Stations ajoutées')).toBeVisible({ timeout: 45_000 });
  await page.waitForTimeout(1500);
  await expect(page.getByTestId('radio-titre')).toHaveText('Choisis une station.');
  await page.goto('about:blank');
  await page.goto('./');
  await expect(page.getByRole('button', { name: /^Radio/ }).first()).toBeVisible();
  await page.waitForTimeout(2000);
  await expect(page.locator('.radio-mini')).toHaveCount(0);
});

type Policy = 'geste exigé' | 'lecture libre';

/**
 * Le Chromium piloté par Playwright laisse toujours jouer sans geste (ses propres scripts comptent
 * comme des gestes, et le drapeau --autoplay-policy n'y change rien) : on reproduit la règle du
 * téléphone en refusant play() tant que la page n'a reçu aucun vrai appui ni aucune touche.
 */
async function applyPolicy(page: Page, policy: Policy): Promise<void> {
  if (policy === 'lecture libre') return;
  await page.addInitScript(() => {
    let gesture = false;
    for (const type of ['pointerup', 'keydown']) {
      window.addEventListener(type, (event) => {
        if (event.isTrusted) gesture = true;
      }, true);
    }
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      if (!gesture) return Promise.reject(new DOMException('geste requis', 'NotAllowedError'));
      return play.call(this);
    };
  });
}

for (const policy of ['geste exigé', 'lecture libre'] as const) {
  test(`politique « ${policy} » : à l’ouverture de l’app, la dernière station reprend (ou attend le premier appui)`, async ({ page }) => {
    await applyPolicy(page, policy);
    {
      await openRadio(page);
      await page.getByTestId('radio-fichier-pack').setInputFiles({ name: 'p.zip', mimeType: 'application/zip', buffer: Buffer.from(smallPack()) });
      await expect(page.getByText('Stations ajoutées')).toBeVisible({ timeout: 45_000 });
      await page.getByRole('button', { name: 'Écouter Rock' }).click();
      await expect(page.getByTestId('radio-titre')).toHaveText('Bruit d’essai 2a');
      // Réouverture de l'app, panneau fermé.
      await page.goto('about:blank');
      await page.goto('./');
      const mini = page.locator('.radio-mini');
      await expect(mini).toContainText('Bruit d’essai 2a', { timeout: 30_000 });
      if (policy === 'geste exigé') {
        await expect(mini).toContainText('Touche pour lancer la musique');
        await page.mouse.click(195, 300); // un appui n'importe où (la scène)
      }
      await expect(mini.getByRole('button', { name: 'Pause' })).toBeVisible({ timeout: 30_000 });
      await expect(mini).not.toContainText('Touche pour lancer la musique');
    }
  });

  test(`politique « ${policy} » : lien de pack, téléchargement sans appui, puis musique (ou premier appui)`, async ({ page }) => {
    await applyPolicy(page, policy);
    {
      await page.goto(`./?pack=http://${HOST}/cors/autre.zip`);
      await expect(station(page, 'Hip-hop & R&B')).toBeVisible({ timeout: 45_000 });
      const player = page.locator('.radio-player');
      if (policy === 'geste exigé') {
        await expect(player.locator('.radio-tap')).toHaveText('Touche pour lancer la musique');
        await page.getByRole('heading', { name: /radio/i, level: 2 }).click();
      }
      await expect(player.getByRole('button', { name: 'Pause' })).toBeVisible({ timeout: 30_000 });
      await expect(player.locator('.radio-tap')).toHaveCount(0);
    }
  });
}

// ——— Enchaînement des morceaux : le bogue du silence (page cachée, play() refusé ou en attente) ———

/**
 * Sonde posée avant le chargement de l'app : liste des éléments audio créés, page cachée simulée
 * (visibilityState), et play() pilotable : « refuse » (NotAllowedError), « attente » (la promesse ne
 * se résout qu'à __release()), « cache-strict » (page cachée : un élément qui n'a jamais joué ne
 * démarre pas, comme sur un téléphone ; celui qui jouait continue). __slow ralentit la lecture d'un
 * fichier du stockage privé (pour éprouver la garde de transition).
 */
async function installAudioProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown> & { __audios: HTMLAudioElement[]; __pending: (() => void)[] };
    w.__audios = [];
    w.__pending = [];
    w.__mode = 'normal';
    w.__hidden = false;
    w.__slow = false;
    // Adresses d'objet vivantes des morceaux, et instants des « ended » et des play() (enchaînement sans délai).
    const live = new Set<string>();
    w.__liveUrls = live;
    w.__endedAt = 0;
    const playAt: number[] = [];
    w.__playAt = playAt;
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (obj: Blob | MediaSource) => {
      const url = create(obj);
      // Seules les adresses des morceaux comptent (la scène 3D crée aussi les siennes pour ses textures).
      if (obj instanceof Blob && obj.type.startsWith('audio/')) live.add(url);
      return url;
    };
    URL.revokeObjectURL = (url: string) => {
      live.delete(url);
      revoke(url);
    };
    const Native = window.Audio;
    window.Audio = class extends Native {
      constructor(src?: string) {
        super(src);
        w.__audios.push(this);
        // Posé avant les écoutes de l'app : l'instant est noté avant son gestionnaire « ended ».
        this.addEventListener('ended', () => {
          w.__endedAt = performance.now();
        });
      }
    } as typeof Audio;
    Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get: () => (w.__hidden ? 'hidden' : 'visible') });
    Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: () => w.__hidden });
    w.__setHidden = (value: boolean) => {
      w.__hidden = value;
      document.dispatchEvent(new Event('visibilitychange'));
    };
    const played = new WeakSet<HTMLMediaElement>();
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      playAt.push(performance.now());
      const mode = w.__mode;
      if (mode === 'refuse') return Promise.reject(new DOMException('geste requis', 'NotAllowedError'));
      if (mode === 'attente' || (mode === 'cache-strict' && w.__hidden && !played.has(this))) {
        return new Promise<void>((resolve, reject) => w.__pending.push(() => void play.call(this).then(resolve, reject)));
      }
      played.add(this);
      return play.call(this);
    };
    w.__release = () => w.__pending.splice(0).forEach((run) => run());
    // Durée masquée à la demande (barre inactive), et dernière position confiée à l'écran verrouillé.
    w.__noDuration = false;
    const durationDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'duration')!;
    Object.defineProperty(HTMLMediaElement.prototype, 'duration', {
      configurable: true,
      get(this: HTMLMediaElement) {
        return w.__noDuration ? Number.NaN : (durationDesc.get!.call(this) as number);
      },
    });
    w.__positionState = null;
    const session = navigator.mediaSession;
    const setPositionState = session.setPositionState?.bind(session);
    session.setPositionState = (state?: MediaPositionState) => {
      w.__positionState = state ?? null;
      setPositionState?.(state);
    };
    const getFile = FileSystemFileHandle.prototype.getFile;
    FileSystemFileHandle.prototype.getFile = async function (this: FileSystemFileHandle) {
      if (w.__slow) await new Promise((resolve) => setTimeout(resolve, 1500));
      return getFile.call(this);
    };
  });
}

type ProbeWindow = Window & Record<string, unknown> & { __audios: HTMLAudioElement[]; __pending: unknown[] };

/** Éléments audio chargés : index, en pause ou non, position, volume. */
async function decks(page: Page) {
  return page.evaluate(() =>
    (window as unknown as ProbeWindow).__audios
      .map((a, i) => ({ i, src: a.hasAttribute('src'), paused: a.paused, t: a.currentTime, volume: a.volume, ended: a.ended }))
      .filter((a) => a.src),
  );
}

/** Le son sort : un seul élément joue, à volume non nul, et sa position avance. */
async function expectAudible(page: Page): Promise<number> {
  let first: { i: number; t: number } | null = null;
  await expect
    .poll(async () => {
      const playing = (await decks(page)).filter((d) => !d.paused && d.volume > 0);
      if (playing.length !== 1) return 'pas un seul élément audible';
      const [d] = playing;
      if (!first || first.i !== d!.i) first = { i: d!.i, t: d!.t };
      return d!.t > first.t + 0.5 ? 'ok' : 'la position n’avance pas encore';
    }, { timeout: 45_000, intervals: [500] })
    .toBe('ok');
  return first!.i;
}

async function setProbe(page: Page, values: Record<string, unknown>): Promise<void> {
  await page.evaluate((patch) => {
    const w = window as unknown as ProbeWindow & { __setHidden(v: boolean): void };
    for (const [key, value] of Object.entries(patch)) {
      if (key === '__hidden') w.__setHidden(Boolean(value));
      else w[key] = value;
    }
  }, values);
}

/** Saute près de la fin du morceau en cours (l'élément qui joue). */
async function seekNearEnd(page: Page, remaining: number): Promise<void> {
  await page.evaluate((left) => {
    const a = (window as unknown as ProbeWindow).__audios.find((x) => x.hasAttribute('src') && !x.paused);
    if (a) a.currentTime = Math.max(0, a.duration - left);
  }, remaining);
}

async function startFourTracks(page: Page): Promise<void> {
  await installAudioProbe(page);
  await openRadio(page);
  await page.getByTestId('radio-fichier-pack').setInputFiles({
    name: 'quatre.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from(smallPack(['electro'], 4, 12)),
  });
  await expect(page.getByText('Station ajoutée')).toBeVisible({ timeout: 45_000 });
  await page.getByRole('button', { name: 'Écouter Électro' }).click();
  await expect(page.getByTestId('radio-titre')).toHaveText('Bruit d’essai 1a');
  await expectAudible(page);
}

test('page cachée : la fin du morceau enchaîne sur le même élément, avec du son', async ({ page }) => {
  await startFourTracks(page);
  const before = await expectAudible(page);
  // Comme sur un téléphone : page cachée, un élément qui n'a jamais joué ne démarre pas.
  await setProbe(page, { __mode: 'cache-strict', __hidden: true });
  await seekNearEnd(page, 1.2);
  await expect(page.getByTestId('radio-titre')).toHaveText('Bruit d’essai 1b', { timeout: 30_000 });
  expect(await expectAudible(page)).toBe(before);
  expect(await page.evaluate(() => (window as unknown as ProbeWindow).__pending.length)).toBe(0);
  await setProbe(page, { __hidden: false });
  await expectAudible(page);
});

test('page cachée, lecture du fichier ralentie à la fin du morceau : enchaînement sans délai, avec du son', async ({ page }) => {
  await startFourTracks(page);
  const before = await expectAudible(page);
  // L'adresse du morceau suivant est préparée dès le démarrage du morceau courant.
  await expect.poll(() => page.evaluate(() => (window as unknown as { __liveUrls: Set<string> }).__liveUrls.size)).toBe(2);
  await setProbe(page, { __mode: 'cache-strict', __hidden: true, __slow: true });
  await seekNearEnd(page, 1.2);
  await expect(page.getByTestId('radio-titre')).toHaveText('Bruit d’essai 1b', { timeout: 30_000 });
  // play() du morceau suivant appelé dans le gestionnaire « ended », sans attendre la lecture du fichier (ralentie à 1,5 s).
  const delay = await page.evaluate(() => {
    const w = window as unknown as { __endedAt: number; __playAt: number[] };
    const after = w.__playAt.filter((t) => t >= w.__endedAt);
    return after.length > 0 ? after[0]! - w.__endedAt : -1;
  });
  expect(delay).toBeGreaterThanOrEqual(0);
  expect(delay).toBeLessThan(100);
  expect(await expectAudible(page)).toBe(before);
});

test('adresse préparée : une seule à la fois, refaite quand la file change, libérée à l’arrêt', async ({ page }) => {
  await startFourTracks(page);
  const live = () => page.evaluate(() => (window as unknown as { __liveUrls: Set<string> }).__liveUrls.size);
  // Le morceau courant et le suivant préparé, pas plus.
  await expect.poll(live).toBe(2);
  const player = page.locator('.radio-player');
  await player.getByRole('button', { name: 'Lecture aléatoire' }).click();
  await expect(player.getByRole('button', { name: 'Lecture aléatoire' })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(live).toBe(2);
  for (let i = 0; i < 3; i += 1) {
    await player.getByRole('button', { name: 'Morceau suivant' }).click();
    await expect.poll(live).toBe(2);
  }
  await player.getByRole('button', { name: 'Lecture aléatoire' }).click();
  await expect.poll(live).toBe(2);
  // Arrêt (station supprimée) : plus aucune adresse vivante.
  await station(page, 'Électro').getByRole('button', { name: /^Électro/ }).click();
  await station(page, 'Électro').getByRole('button', { name: 'Supprimer la station' }).click();
  await station(page, 'Électro').getByRole('button', { name: 'Supprimer', exact: true }).click();
  await expect(station(page, 'Électro')).toHaveCount(0);
  await expect.poll(live).toBe(0);
});

test('retour au premier plan : un morceau resté en attente repart avec du son, sans changer de morceau', async ({ page }) => {
  await startFourTracks(page);
  await setProbe(page, { __hidden: true, __mode: 'attente' });
  await seekNearEnd(page, 1.2);
  await expect(page.getByTestId('radio-titre')).toHaveText('Bruit d’essai 1b', { timeout: 30_000 });
  // Rien ne sort : l'interface ne dit pas « en lecture ».
  await expect(page.locator('.radio-player').getByRole('button', { name: 'Lecture', exact: true })).toBeVisible();
  await setProbe(page, { __mode: 'normal', __hidden: false });
  await expectAudible(page);
  await expect(page.getByTestId('radio-titre')).toHaveText('Bruit d’essai 1b');
  await expect(page.locator('.radio-player').getByRole('button', { name: 'Pause' })).toBeVisible();
});

test('page visible : play() du morceau entrant refusé, le premier appui relance avec du son', async ({ page }) => {
  await startFourTracks(page);
  await setProbe(page, { __mode: 'refuse' });
  await seekNearEnd(page, 3);
  await expect(page.locator('.radio-player .radio-tap')).toHaveText('Touche pour lancer la musique', { timeout: 30_000 });
  await expect(page.getByTestId('radio-titre')).toHaveText('Bruit d’essai 1b');
  await setProbe(page, { __mode: 'normal' });
  await page.getByRole('heading', { name: /radio/i, level: 2 }).click();
  await expectAudible(page);
  const [deck] = (await decks(page)).filter((d) => !d.paused);
  expect(deck!.volume).toBeGreaterThan(0.5);
});

test('page visible : play() du morceau entrant en attente, le gain revient à plein (fondu ou chien de garde)', async ({ page }) => {
  await startFourTracks(page);
  await setProbe(page, { __mode: 'attente' });
  await seekNearEnd(page, 3);
  await expect(page.getByTestId('radio-titre')).toHaveText('Bruit d’essai 1b', { timeout: 30_000 });
  // Fondu (2 s) + marge (1,5 s) : l'élément sortant est déchargé, l'entrant est à plein gain.
  await expect.poll(async () => (await decks(page)).map((d) => d.volume), { timeout: 15_000 }).toEqual([expect.any(Number)]);
  expect((await decks(page))[0]!.volume).toBeGreaterThan(0.5);
  await setProbe(page, { __mode: 'normal' });
  await page.evaluate(() => (window as unknown as { __release(): void }).__release());
  await expectAudible(page);
});

test('garde de transition : une fin de morceau ne fait avancer la file que d’un morceau', async ({ page }) => {
  await startFourTracks(page);
  // Lecture du fichier ralentie : plusieurs timeupdate arrivent pendant la transition.
  await setProbe(page, { __slow: true });
  await seekNearEnd(page, 3);
  await expect(page.getByTestId('radio-titre')).toHaveText('Bruit d’essai 1b', { timeout: 30_000 });
  await page.waitForTimeout(3000);
  await expect(page.getByTestId('radio-titre')).toHaveText('Bruit d’essai 1b');
  await setProbe(page, { __slow: false });
  await expectAudible(page);
});

// ——— Barre de progression ———

const seekBar = (page: Page) => page.getByRole('slider', { name: 'Position dans le morceau' });

async function playingTime(page: Page): Promise<number> {
  const deck = (await decks(page)).find((d) => !d.paused);
  return deck ? deck.t : -1;
}

test('barre de progression : glisser au milieu, la position saute et la lecture continue', async ({ page }) => {
  await startFourTracks(page);
  const bar = seekBar(page);
  await expect(bar).toBeEnabled();
  await expect(bar).toHaveAttribute('aria-valuetext', /^\d+ s sur 12 s$/);
  const box = (await bar.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.05, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, y, { steps: 6 });
  // Pendant le glissement, le temps affiché suit le doigt.
  await expect(page.getByTestId('radio-temps')).toHaveText(/^0:0[5-7] \/ 0:12$/);
  await page.mouse.up();
  await expect.poll(() => playingTime(page)).toBeGreaterThanOrEqual(5);
  expect(await playingTime(page)).toBeLessThan(9);
  await expectAudible(page);
  await expect(page.getByTestId('radio-titre')).toHaveText('Bruit d’essai 1a');
  // L'écran verrouillé connaît la nouvelle position.
  const state = await page.evaluate(() => (window as unknown as { __positionState: MediaPositionState | null }).__positionState);
  expect(state?.duration).toBeCloseTo(12, 0);
  expect(state?.position ?? 0).toBeGreaterThanOrEqual(4.5);
});

test('barre de progression : flèches du clavier par pas de 5 secondes', async ({ page }) => {
  await startFourTracks(page);
  const bar = seekBar(page);
  await bar.focus();
  const t0 = await playingTime(page);
  await page.keyboard.press('ArrowRight');
  const t1 = await playingTime(page);
  expect(t1 - t0).toBeGreaterThan(4);
  expect(t1 - t0).toBeLessThan(6.5);
  await page.keyboard.press('ArrowLeft');
  const t2 = await playingTime(page);
  expect(t1 - t2).toBeGreaterThan(3.5);
  expect(t1 - t2).toBeLessThan(5.5);
  await expectAudible(page);
});

test('barre de progression inactive tant que la durée manque, sans erreur', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await installAudioProbe(page);
  await openRadio(page);
  await setProbe(page, { __noDuration: true });
  await page.getByTestId('radio-fichier-pack').setInputFiles({ name: 'p.zip', mimeType: 'application/zip', buffer: Buffer.from(smallPack(['electro'], 2, 12)) });
  await expect(page.getByText('Station ajoutée')).toBeVisible({ timeout: 45_000 });
  await page.getByRole('button', { name: 'Écouter Électro' }).click();
  await expectAudible(page);
  await expect(seekBar(page)).toBeDisabled();
  await expect(seekBar(page)).toHaveAttribute('aria-valuetext', 'Durée pas encore connue');
  expect(errors).toEqual([]);
});

test('coupure pendant le téléchargement, puis reprise par une requête Range', async ({ page }) => {
  await openRadio(page);
  await page.getByRole('button', { name: 'Depuis une adresse' }).click();
  await page.getByLabel('Adresse du pack (ZIP)').fill(`http://${HOST}/coupe/pack.zip`);
  await page.getByRole('button', { name: 'Télécharger' }).click();
  await expect(page.getByRole('alert')).toContainText('Le téléchargement a été coupé');
  await page.getByRole('button', { name: 'Reprendre' }).click();
  await expect(page.getByText('Stations ajoutées')).toBeVisible({ timeout: 45_000 });
  await expect(station(page, 'Rock')).toBeVisible();
  expect(requests.some((line) => /^GET \/coupe\/pack\.zip bytes=[1-9]\d*-$/.test(line))).toBe(true);
});

test('« Ajouter mes morceaux » : la station Ma playlist', async ({ page }) => {
  await openRadio(page);
  await page.getByTestId('radio-fichier-morceaux').setInputFiles([
    { name: '01 - Groupe Essai - Bruit court.wav', mimeType: 'audio/wav', buffer: Buffer.from(noiseWav(20, 5)) },
    { name: '02 - Groupe Essai - Autre bruit.wav', mimeType: 'audio/wav', buffer: Buffer.from(noiseWav(20, 9)) },
  ]);
  await expect(page.getByText('2 morceaux ajoutés à «\u00a0Ma playlist\u00a0»')).toBeVisible({ timeout: 45_000 });
  await expect(station(page, 'Ma playlist')).toContainText('2 morceaux');
  await page.getByRole('button', { name: 'Écouter Ma playlist' }).click();
  await expect(page.getByTestId('radio-titre')).toHaveText('Bruit court');
  await expect(page.locator('.radio-now-artist')).toHaveText('Groupe Essai');
});

test('trois tailles de texte : cibles de 48 px, rien ne déborde en largeur', async ({ page }) => {
  await openRadio(page);
  await page.getByTestId('radio-fichier-pack').setInputFiles({ name: 'p.zip', mimeType: 'application/zip', buffer: Buffer.from(smallPack()) });
  await expect(page.getByText('Stations ajoutées')).toBeVisible({ timeout: 45_000 });
  await page.getByRole('button', { name: 'Écouter Électro' }).click();
  await station(page, 'Électro').getByRole('button', { name: /^Électro/ }).click();
  for (const size of ['normal', 'grand', 'tres-grand']) {
    await page.evaluate((value) => document.documentElement.setAttribute('data-text', value), size);
    const report = await page.evaluate(() => {
      const panel = document.querySelector('.radio-panel')!;
      const small = [...panel.querySelectorAll('button')]
        .filter((b) => b.offsetParent !== null)
        .map((b) => b.getBoundingClientRect())
        .filter((r) => r.height < 47.5 || r.width < 47.5).length;
      const card = document.querySelector('.sheet .card-scroll')!;
      return { small, overflow: card.scrollWidth - card.clientWidth };
    });
    expect(report).toEqual({ small: 0, overflow: 0 });
    await page.screenshot({ path: `test-results/radio-texte-${size}.png` });
  }
});

test('sans stockage privé : un message clair, pas d’erreur', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(StorageManager.prototype, 'getDirectory', { value: undefined, configurable: true });
  });
  await openRadio(page);
  await expect(page.getByText('Le stockage privé n’est pas disponible')).toBeVisible();
  expect(errors).toEqual([]);
});

test('épreuve de taille : un pack de 400 Mo par adresse', async ({ page }) => {
  test.skip(!process.env.PMB_RADIO_GROS, 'PMB_RADIO_GROS=<chemin du gros pack> pour la lancer');
  test.setTimeout(15 * 60_000);
  await openRadio(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  let heapMax = 0;
  const sample = async () => {
    const { metrics } = await cdp.send('Performance.getMetrics');
    const used = metrics.find((m) => m.name === 'JSHeapUsedSize')?.value ?? 0;
    heapMax = Math.max(heapMax, used);
  };
  await sample();
  const heapStart = heapMax;
  const t0 = Date.now();
  await page.getByRole('button', { name: 'Depuis une adresse' }).click();
  await page.getByLabel('Adresse du pack (ZIP)').fill(`http://${HOST}/cors/gros.zip`);
  await page.getByRole('button', { name: 'Télécharger' }).click();
  const done = page.getByText(/Stations? ajoutée/);
  while (!(await done.isVisible())) {
    await sample();
    const alert = page.getByRole('alert');
    if (await alert.isVisible()) throw new Error(`échec : ${await alert.textContent()}`);
    await page.waitForTimeout(500);
  }
  const seconds = (Date.now() - t0) / 1000;
  await sample();
  const usage = await page.evaluate(async () => (await navigator.storage.estimate()).usage ?? 0);
  const stations = await page.locator('.radio-station').count();
  console.log(
    `ÉPREUVE : ${seconds.toFixed(1)} s, tas JS max ${(heapMax / 1e6).toFixed(1)} Mo (départ ${(heapStart / 1e6).toFixed(1)} Mo), ` +
      `place occupée ${(usage / 1e6).toFixed(1)} Mo, ${stations} stations`,
  );
  expect(heapMax - heapStart).toBeLessThan(100e6);
});
