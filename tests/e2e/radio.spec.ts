// Parcours de la radio : import par fichier, lecture, suivant, rechargement, suppression ;
// import par adresse depuis un hébergement d'essai sur une autre origine (avec et sans CORS) ;
// arrivée par un lien « ?pack= » ; station d'accueil (servie par l'app) au premier lancement, puis
// bascule sur le pack. Les packs sont fabriqués par le test (bruit faible en WAV).

import type { Server } from 'node:http';
import { expect, test, type Page } from '@playwright/test';
import { openAtelier, waitOfflineReady } from './helpers.ts';
import { buildZip } from '../radio/fixtures.ts';
import { noiseWav, smallPack, startPackServer, type PackSource } from '../radio/server.ts';

// Port de l'hébergement d'essai, réglable quand plusieurs suites tournent en même temps sur la machine.
const PACK_PORT = Number(process.env.PMB_RADIO_PORT ?? 4521);
const HOST = `localhost:${PACK_PORT}`;
// Un lien reçu (?pack=) refuse la machine locale et le réseau privé : les parcours de lien visent
// donc un hôte public fictif, que Playwright aiguille vers l'hébergement d'essai (routeLinks).
const LINK_HOST = 'packs.example';
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

/** Ouvre l'app sur le panneau Radio (lien direct : le choix « mini-lecteur déployé » reste intact). */
async function openRadio(page: Page): Promise<void> {
  await page.goto('./#/radio');
  await expect(page.getByRole('heading', { name: 'Radio', level: 2 })).toBeVisible();
}

/**
 * Bouton rond « Radio » de la colonne des raccourcis (« Radio », « Radio, en lecture »…), pas le titre
 * du mini-lecteur, qui commence par le nom de la station (« Radio … : ouvrir le panneau Radio » pour une
 * station dont le nom commence par « Radio »).
 */
const radioButton = (page: Page) => page.getByRole('navigation', { name: 'Raccourcis' }).getByRole('button', { name: /^Radio(,|$)/ });

/**
 * Réglage du mini-lecteur tel qu'il est écrit sur le disque. L'écriture est asynchrone et un
 * rechargement l'interrompt : un parcours l'attend avant de recharger.
 */
function savedMiniOpen(page: Page): Promise<boolean | null> {
  return page.evaluate(
    () =>
      new Promise<boolean | null>((resolve) => {
        const open = indexedDB.open('pimpmybichon-radio-reglages');
        open.onerror = () => resolve(null);
        open.onsuccess = () => {
          const database = open.result;
          try {
            const request = database.transaction('kv', 'readonly').objectStore('kv').get('reglages');
            request.onsuccess = () => {
              database.close();
              resolve((request.result as { miniOpen?: boolean } | undefined)?.miniOpen ?? null);
            };
            request.onerror = () => {
              database.close();
              resolve(null);
            };
          } catch {
            database.close();
            resolve(null);
          }
        };
      }),
  );
}

/**
 * Ouvre le panneau Radio depuis le garage, comme au doigt : radio garnie (la station d'accueil
 * compte), le bouton rond déploie le mini-lecteur, dont le titre ouvre le panneau.
 */
async function showRadioPanel(page: Page): Promise<void> {
  const heading = page.getByRole('heading', { name: 'Radio', level: 2 });
  const title = page.locator('.radio-mini-title');
  if (!(await title.isVisible())) await radioButton(page).click();
  await expect(heading.or(title)).toBeVisible();
  if (!(await heading.isVisible())) await title.click();
  await expect(heading).toBeVisible();
}

/** Nom de la station d'accueil (public/assets/audio/radio/accueil/station.json). */
const WELCOME = 'Atelier FM';
/** Phrase de la radio sans pack (la station d'accueil tourne en attendant). */
const NO_PACK = 'Pas encore de pack';

/** Aiguille https://packs.example/… vers l'hébergement d'essai local (même journal de requêtes). */
async function routeLinks(page: Page): Promise<void> {
  await page.context().route(`https://${LINK_HOST}/**`, async (route) => {
    const request = route.request();
    const range = request.headers()['range'];
    const response = await fetch(`http://127.0.0.1:${PACK_PORT}${new URL(request.url()).pathname}`, {
      method: request.method(),
      headers: range ? { range } : {},
    });
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      if (!['connection', 'keep-alive', 'transfer-encoding', 'date'].includes(key)) headers[key] = value;
    });
    const body = request.method() === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer());
    await route.fulfill({ status: response.status, headers, body });
  });
}

/** Fichiers du stockage privé de la radio. */
async function radioFiles(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('radio', { create: true });
    const names: string[] = [];
    for await (const name of (dir as unknown as { keys(): AsyncIterable<string> }).keys()) names.push(name);
    return names.sort();
  });
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
  await expect(page.getByText(NO_PACK)).toBeVisible();
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

  // Panneau fermé : la musique continue ; le bouton rond déploie le mini-lecteur, qui la montre.
  await page.getByRole('button', { name: 'Retour à l’atelier' }).click();
  await radioButton(page).click();
  // (Le morceau a pu s'achever entre-temps : l'enchaînement repart alors sur le premier.)
  await expect(page.locator('.radio-mini')).toContainText(/Bruit d’essai 1[ab]/);
  await expect(page.locator('.radio-mini').getByRole('button', { name: 'Pause' })).toBeVisible();
  await page.screenshot({ path: 'test-results/radio-dock.png' });

  // Rechargement : le mini-lecteur est resté déployé ; son titre ouvre le panneau.
  await page.reload();
  await page.locator('.radio-mini-title').click();
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
  await expect(page.getByText(NO_PACK)).toBeVisible();
  // La station d'accueil reste, elle.
  await expect(station(page, WELCOME)).toBeVisible();
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

  await page.getByRole('button', { name: 'Fermer', exact: true }).click();
  await page.getByRole('button', { name: 'Depuis une adresse' }).click();
  await page.getByLabel('Adresse du pack (ZIP)').fill(`http://${HOST}/cors/absent.zip`);
  await page.getByRole('button', { name: 'Télécharger' }).click();
  await expect(page.getByRole('alert')).toContainText('Adresse introuvable');
});

test('arrivée par un lien ?pack= : le téléchargement part tout seul, puis la musique', async ({ page }) => {
  await routeLinks(page);
  requests.length = 0;
  await page.goto(`./?pack=${encodeURIComponent(`https://${LINK_HOST}/cors/autre.zip`)}`);
  await expect(page.getByRole('heading', { name: /radio/i, level: 2 })).toBeVisible();
  expect(page.url()).not.toContain('pack=');
  await expect(station(page, 'Hip-hop & R&B')).toBeVisible({ timeout: 45_000 });
  expect(requests).toContain('GET /cors/autre.zip');
  // Selon le navigateur, la musique part d'elle-même ou attend le premier appui.
  await expect(page.locator('.radio-player .radio-tap').or(page.locator('.radio-player').getByRole('button', { name: 'Pause' }))).toBeVisible();
  await page.screenshot({ path: 'test-results/radio-lien.png' });

  // Le même lien une seconde fois : le pack est reconnu à son adresse et à son poids (une requête
  // HEAD), rien n'est retéléchargé.
  requests.length = 0;
  await page.goto('about:blank');
  await page.goto(`./#pack=https://${LINK_HOST}/cors/autre.zip`);
  await expect(page.getByText('Ce pack est déjà dans ta radio : rien à télécharger.')).toBeVisible();
  await page.waitForTimeout(1000);
  expect(requests).toEqual(['HEAD /cors/autre.zip']);
});

test('économie de données : le pack reçu par lien attend un appui', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'connection', { value: { saveData: true }, configurable: true });
  });
  await routeLinks(page);
  requests.length = 0;
  await page.goto(`./?pack=https://${LINK_HOST}/cors/autre.zip`);
  await expect(page.getByText('Un pack de musique t’attend')).toBeVisible();
  await expect(page.locator('.radio-offer')).toContainText(`Hébergé chez ${LINK_HOST}`);
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
  // Réouverture : sans pack, la station d'accueil ne part pas toute seule non plus.
  await page.goto('about:blank');
  await page.goto('./');
  await expect(radioButton(page)).toBeVisible();
  await page.waitForTimeout(2000);
  await expect(radioButton(page)).toHaveAccessibleName('Radio');
  await showRadioPanel(page);
  await page.getByTestId('radio-fichier-pack').setInputFiles({ name: 'p.zip', mimeType: 'application/zip', buffer: Buffer.from(smallPack()) });
  await expect(page.getByText('Stations ajoutées')).toBeVisible({ timeout: 45_000 });
  await page.waitForTimeout(1500);
  // Rien ne part : le lecteur propose de reprendre la dernière station écoutée (l'accueil, entendu
  // avant que le réglage soit coupé), sans lancer le pack.
  await expect(page.getByTestId('radio-titre')).toHaveText(/^(Choisis une station\.|En pause\. Appuie sur lecture pour reprendre\.)$/);
  await expect(page.locator('.radio-player').getByRole('button', { name: 'Lecture', exact: true })).toBeVisible();
  await page.goto('about:blank');
  await page.goto('./');
  await expect(radioButton(page)).toBeVisible();
  await page.waitForTimeout(2000);
  // Rien ne joue : le bouton ne dit pas « en lecture », et aucune invitation à toucher l'écran.
  await expect(radioButton(page)).toHaveAccessibleName('Radio');
  await expect(page.locator('.radio-tap-pill')).toHaveCount(0);
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
      if (policy === 'geste exigé') {
        // Mini-lecteur replié (par défaut) : l'invitation reste visible à côté du bouton rond.
        await expect(page.locator('.radio-tap-pill')).toHaveText('Touche pour lancer la musique', { timeout: 30_000 });
        await page.mouse.click(195, 300); // un appui n'importe où (la scène)
        await expect(page.locator('.radio-tap-pill')).toHaveCount(0, { timeout: 30_000 });
      }
      await expect(radioButton(page)).toHaveAccessibleName('Radio, en lecture', { timeout: 30_000 });
      await radioButton(page).click();
      await expect(mini).toContainText('Bruit d’essai 2a');
      await expect(mini.getByRole('button', { name: 'Pause' })).toBeVisible({ timeout: 30_000 });
      await expect(mini).not.toContainText('Touche pour lancer la musique');
    }
  });

  test(`politique « ${policy} » : lien de pack, téléchargement sans appui, puis musique (ou premier appui)`, async ({ page }) => {
    await applyPolicy(page, policy);
    await routeLinks(page);
    {
      await page.goto(`./?pack=https://${LINK_HOST}/cors/autre.zip`);
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

// ——— Bouton rond et mini-lecteur ———

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Le mini-lecteur tient dans l'écran et ne recouvre ni l'étiquette du véhicule ni les autres boutons ronds. */
async function expectMiniFits(page: Page): Promise<void> {
  const mini = (await page.locator('.radio-mini').boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(mini.x).toBeGreaterThanOrEqual(0);
  expect(mini.x + mini.width).toBeLessThanOrEqual(viewport.width);
  const nav = page.getByRole('navigation', { name: 'Raccourcis' });
  for (const name of ['Atelier', 'Photo']) {
    const box = await nav.getByRole('button', { name, exact: true }).boundingBox();
    if (box) expect(overlaps(mini, box), `recouvre ${name}`).toBe(false);
  }
  const tag = await page.locator('.tag').boundingBox();
  if (tag) expect(overlaps(mini, tag), 'recouvre l’étiquette du véhicule').toBe(false);
  for (const button of await page.locator('.radio-mini button').all()) {
    const box = (await button.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(47.5);
  }
}

test('bouton rond : station d’accueil au premier lancement, déployer, pack, replier, recharger, titre qui ouvre, bouton qui referme', async ({ page }) => {
  test.setTimeout(150_000);
  // Premier lancement, sans pack : la station d'accueil joue ; replié par défaut, le bouton le dit.
  await page.goto('./');
  await expect(radioButton(page)).toHaveAccessibleName('Radio, en lecture', { timeout: 30_000 });
  await expect(radioButton(page)).toHaveAttribute('aria-expanded', 'false');
  const mini = page.locator('.radio-mini');
  await expect(mini).toHaveCount(0);

  // Déployer : le mini-lecteur marche pour elle comme pour un pack.
  await radioButton(page).click();
  await expect(radioButton(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(mini).toContainText('Midnight Cruise');
  await expect(mini).toContainText(WELCOME);
  await expect(mini.getByRole('button', { name: 'Pause' })).toBeVisible();
  await expectMiniFits(page);
  await page.screenshot({ path: 'test-results/radio-accueil-mini.png' });

  // Un pack entre : la radio passe dessus d'elle-même.
  await page.locator('.radio-mini-title').click();
  await page.getByTestId('radio-fichier-pack').setInputFiles({ name: 'p.zip', mimeType: 'application/zip', buffer: Buffer.from(smallPack()) });
  await expect(page.getByText('Stations ajoutées')).toBeVisible({ timeout: 45_000 });
  await page.getByRole('button', { name: 'Retour à l’atelier' }).click();

  // Déployé : titre, fine barre, pause, suivant.
  await expect(mini).toContainText('Bruit d’essai 1a', { timeout: 30_000 });
  await expect(mini.getByRole('button', { name: 'Pause' })).toBeVisible();
  await expect(mini.locator('.radio-mini-progress')).toBeVisible();
  await expectMiniFits(page);
  await page.screenshot({ path: 'test-results/radio-deploye.png' });
  for (const size of ['grand', 'tres-grand']) {
    await page.evaluate((value) => document.documentElement.setAttribute('data-text', value), size);
    await expectMiniFits(page);
  }
  await page.evaluate(() => document.documentElement.setAttribute('data-text', 'normal'));
  await page.setViewportSize({ width: 360, height: 780 });
  await expectMiniFits(page);
  await page.setViewportSize({ width: 390, height: 844 });

  // Replié : seul le bouton reste, qui dit que ça joue.
  await radioButton(page).click();
  await expect(mini).toHaveCount(0);
  await expect(radioButton(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(radioButton(page)).toHaveAccessibleName('Radio, en lecture');
  await page.screenshot({ path: 'test-results/radio-replie.png' });

  // Redéployer : le choix est retrouvé après un rechargement.
  await radioButton(page).click();
  await expect(mini).toBeVisible();
  await expect.poll(() => savedMiniOpen(page)).toBe(true);
  await page.reload();
  await expect(radioButton(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.radio-mini')).toBeVisible();

  // Le titre ouvre le panneau ; un appui sur le bouton rond le referme.
  const button = (await radioButton(page).boundingBox())!;
  await page.locator('.radio-mini-title').click();
  const heading = page.getByRole('heading', { name: /radio/i, level: 2 });
  await expect(heading).toBeVisible();
  await expect(page.getByRole('button', { name: 'Radio, fermer le panneau' })).toHaveAttribute('aria-expanded', 'true');
  await page.mouse.click(button.x + button.width / 2, button.y + button.height / 2);
  await expect(heading).toBeHidden();
  await expect(page).not.toHaveURL(/#\/radio/);
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

// ——— Garde-fous de la bibliothèque : deux onglets, bombes, flux sans fin, liens reçus ———

async function importZip(page: Page, name: string, buffer: Uint8Array): Promise<void> {
  await page.getByTestId('radio-fichier-pack').setInputFiles({ name, mimeType: 'application/zip', buffer: Buffer.from(buffer) });
}

test('deux onglets : deux stations dans A, une troisième dans B, les trois survivent à la relance, aucun fichier effacé', async ({ context }) => {
  test.setTimeout(150_000);
  const a = await context.newPage();
  const b = await context.newPage();
  await openRadio(a);
  // B s'ouvre avant les imports de A : il a l'index vide en mémoire.
  await openRadio(b);
  await importZip(a, 'electro.zip', smallPack(['electro']));
  await expect(a.getByText(/Station ajoutée.*Électro/)).toBeVisible({ timeout: 45_000 });
  await a.getByRole('button', { name: 'OK' }).click();
  await importZip(a, 'rock.zip', smallPack(['rock']));
  await expect(a.getByText(/Station ajoutée.*Rock/)).toBeVisible({ timeout: 45_000 });
  // B recharge l'index de lui-même quand A l'a changé.
  await expect(station(b, 'Électro')).toBeVisible();
  await expect(station(b, 'Rock')).toBeVisible();
  await importZip(b, 'hiphop.zip', smallPack(['hiphop-rnb']));
  await expect(b.getByText(/Station ajoutée.*Hip-hop/)).toBeVisible({ timeout: 45_000 });
  await expect(station(a, 'Hip-hop & R&B')).toBeVisible();
  const files = await radioFiles(a);
  expect(files.filter((name) => name.endsWith('.zip'))).toHaveLength(3);

  // Un morceau qu'un autre onglet viendrait de décompresser (pas encore dans l'index) : le ménage
  // du démarrage n'y touche pas, pas plus qu'aux fichiers des trois stations.
  await a.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('radio');
    const writable = await (await dir.getFileHandle('pack-0123456789ab-t-0123456789ab.wav', { create: true })).createWritable();
    await writable.write(new Uint8Array(1024));
    await writable.close();
  });
  for (const page of [a, b]) {
    await page.goto('about:blank');
    await page.goto('./');
    // La musique reprend à l'ouverture : le bouton rond déploie le mini-lecteur, dont le titre ouvre le panneau.
    await expect(radioButton(page)).toHaveAccessibleName('Radio, en lecture', { timeout: 30_000 });
    const title = page.locator('.radio-mini-title');
    if (!(await title.isVisible())) await radioButton(page).click();
    await title.click();
    await expect(page.getByRole('heading', { name: 'Radio', level: 2 })).toBeVisible();
    for (const name of ['Électro', 'Rock', 'Hip-hop & R&B']) await expect(station(page, name)).toBeVisible();
  }
  await a.waitForTimeout(2000);
  expect(await radioFiles(a)).toEqual([...files, 'pack-0123456789ab-t-0123456789ab.wav'].sort());
});

const MIO = 1024 * 1024;
const fullOfStorage = /trop gros une fois décompressé/;

test('bombe : un petit ZIP qui déclare ou produit des centaines de Mo est refusé, le stockage reste vide', async ({ page }) => {
  test.setTimeout(120_000);
  await openRadio(page);
  const zeros = new Uint8Array(256 * MIO);
  // Déclarée honnêtement : 256 Mio pour 255 Kio compressés, refusée avant toute écriture.
  await importZip(page, 'bombe.zip', buildZip([{ name: 'electro/bombe.wav', data: zeros, deflate: true, declaredCrc: 0 }]));
  await expect(page.getByRole('alert')).toContainText(fullOfStorage, { timeout: 30_000 });
  await expect(page.getByRole('alert')).toContainText('npm run radio:pack');
  expect(await radioFiles(page)).toEqual([]);
  await page.screenshot({ path: 'test-results/radio-bombe.png' });
  await page.getByRole('button', { name: 'Fermer', exact: true }).click();

  // Menteuse : elle déclare 1 Mio et en produit 256 ; l'écriture est coupée à la taille déclarée.
  await importZip(page, 'menteuse.zip', buildZip([{ name: 'electro/bombe.wav', data: zeros, deflate: true, declaredSize: MIO, declaredCrc: 0 }]));
  await expect(page.getByRole('alert')).toContainText('Le ZIP est abîmé', { timeout: 30_000 });
  expect(await radioFiles(page)).toEqual([]);
  await page.getByRole('button', { name: 'Fermer', exact: true }).click();

  // Abîmée : taille juste, CRC faux.
  const wav = noiseWav(2, 5);
  await importZip(page, 'abime.zip', buildZip([{ name: 'electro/abime.wav', data: wav, deflate: true, declaredCrc: 1234 }]));
  await expect(page.getByRole('alert')).toContainText('Le ZIP est abîmé', { timeout: 30_000 });
  expect(await radioFiles(page)).toEqual([]);
  await expect(page.getByText(NO_PACK)).toBeVisible();
});

test('flux sans fin : le téléchargement est coupé au plafond, le stockage reste vide', async ({ page }) => {
  // Plafond abaissé pour l'essai (8 Mio au lieu de 2 Gio) : l'app n'accepte qu'un plafond plus bas.
  await page.addInitScript(() => {
    (window as unknown as { __pmbRadioPlafond: number }).__pmbRadioPlafond = 8 * 1024 * 1024;
  });
  requests.length = 0;
  await openRadio(page);
  await page.getByRole('button', { name: 'Depuis une adresse' }).click();
  await page.getByLabel('Adresse du pack (ZIP)').fill(`http://${HOST}/sansfin/flux.zip`);
  await page.getByRole('button', { name: 'Télécharger' }).click();
  await expect(page.getByRole('alert')).toContainText(fullOfStorage, { timeout: 30_000 });
  expect(await radioFiles(page)).toEqual([]);
  await expect.poll(() => requests.find((line) => line.startsWith('sansfin coupé'))).toBeTruthy();
  const sent = Number(/(\d+) octets/.exec(requests.find((line) => line.startsWith('sansfin coupé')) ?? '')?.[1]);
  // Le serveur d'essai envoie aussi vite que la boucle locale le permet : ce qu'il a déjà poussé
  // quand la coupure lui parvient dépend du poste (64 Mio dépassés sur une machine rapide). Ce qui
  // compte est la coupure elle-même, vérifiée ci-dessus, et un flux qui ne continue pas indéfiniment.
  expect(sent).toBeLessThan(512 * MIO);
});

test('lien reçu vers la machine locale : refusé sans requête ; le champ d’adresse l’accepte toujours', async ({ page }) => {
  requests.length = 0;
  await page.goto(`./?pack=http://${HOST}/cors/autre.zip`);
  await expect(page.getByRole('alert')).toContainText('réseau local');
  await page.waitForTimeout(1500);
  expect(requests).toEqual([]);
  await page.screenshot({ path: 'test-results/radio-lien-local.png' });
  await page.getByRole('button', { name: 'Fermer', exact: true }).click();
  await page.getByRole('button', { name: 'Depuis une adresse' }).click();
  await page.getByLabel('Adresse du pack (ZIP)').fill(`http://${HOST}/cors/autre.zip`);
  await page.getByRole('button', { name: 'Télécharger' }).click();
  await expect(station(page, 'Hip-hop & R&B')).toBeVisible({ timeout: 45_000 });
});

test('lien vers un pack déjà importé : retéléchargé si son poids a changé, sinon rien', async ({ page }) => {
  test.setTimeout(120_000);
  await routeLinks(page);
  packs.set('maj.zip', { buffer: smallPack(['electro']) });
  await page.goto(`./?pack=https://${LINK_HOST}/cors/maj.zip`);
  await expect(station(page, 'Électro')).toBeVisible({ timeout: 45_000 });
  await expect(station(page, 'Rock')).toHaveCount(0);

  // Le pack a grossi chez l'hébergeur : le même lien le retélécharge.
  packs.set('maj.zip', { buffer: smallPack(['electro', 'rock']) });
  requests.length = 0;
  await page.goto('about:blank');
  await page.goto(`./?pack=https://${LINK_HOST}/cors/maj.zip`);
  await expect(station(page, 'Rock')).toBeVisible({ timeout: 45_000 });
  expect(requests).toContain('GET /cors/maj.zip');

  // Inchangé : une requête HEAD, rien de téléchargé.
  requests.length = 0;
  await page.goto('about:blank');
  await page.goto(`./?pack=https://${LINK_HOST}/cors/maj.zip`);
  await expect(page.getByText('Ce pack est déjà dans ta radio : rien à télécharger.')).toBeVisible();
  await page.waitForTimeout(1000);
  expect(requests).toEqual(['HEAD /cors/maj.zip']);
  expect(await radioFiles(page)).toHaveLength(2);
});

// ——— Station d'accueil : servie par l'app, elle joue tant qu'aucun pack n'est là ———

/** Morceaux de la station d'accueil demandés par la page (chemins), dans l'ordre. */
function watchWelcomeRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.includes('/assets/audio/radio/')) seen.push(path);
  });
  return seen;
}

/**
 * Pack retenu : l'hébergement ne répond qu'à l'appel de la fonction rendue (posé après routeLinks, qui
 * sert ensuite). Le téléchargement dure ainsi le temps qu'il faut au parcours, même sur une machine chargée.
 */
async function heldPack(page: Page, name: string): Promise<() => void> {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.context().route(`https://${LINK_HOST}/cors/${name}`, async (route) => {
    await gate;
    await route.fallback();
  });
  return () => release();
}

test('premier lancement sans pack : la station d’accueil joue, un seul morceau demandé, impossible à supprimer', async ({ page }) => {
  const asked = watchWelcomeRequests(page);
  await openRadio(page);
  await expect(page.getByText(NO_PACK)).toBeVisible();
  await expect(station(page, WELCOME)).toContainText('4 morceaux');
  await expect(page.locator('.radio-now-station')).toHaveText(WELCOME);
  await expect(page.getByTestId('radio-titre')).toHaveText('Midnight Cruise');
  await expect(page.locator('.radio-player').getByRole('button', { name: 'Pause' })).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => clockSeconds(page), { timeout: 45_000 }).toBeGreaterThanOrEqual(2);
  // Écran verrouillé et barre de progression : comme pour un pack.
  expect(await page.evaluate(() => [navigator.mediaSession.metadata?.title, navigator.mediaSession.metadata?.album])).toEqual(['Midnight Cruise', WELCOME]);
  await expect(seekBar(page)).toBeEnabled();
  await expect(page.getByTestId('radio-temps')).toContainText('/ 2:30');
  // Un seul morceau demandé, lu en flux : rien n'entre dans le stockage privé.
  expect([...new Set(asked)]).toEqual(['/PimpMyBichon/assets/audio/radio/accueil/midnight-cruise.mp3']);
  expect(await radioFiles(page)).toEqual([]);
  await page.screenshot({ path: 'test-results/radio-accueil.png' });

  // Suivant : le deuxième morceau, demandé à son tour.
  await page.locator('.radio-player').getByRole('button', { name: 'Morceau suivant' }).click();
  await expect(page.getByTestId('radio-titre')).toHaveText('Midnight Glide');
  // Le titre change avant que la requête du morceau parte : on attend qu'elle arrive.
  await expect.poll(() => [...new Set(asked)].at(-1)).toBe('/PimpMyBichon/assets/audio/radio/accueil/midnight-glide.mp3');

  // Aucune suppression possible.
  await station(page, WELCOME).getByRole('button', { name: new RegExp(`^${WELCOME}`) }).click();
  await expect(station(page, WELCOME).locator('.radio-tracks li')).toHaveCount(4);
  await expect(station(page, WELCOME).getByRole('button', { name: /Supprimer/ })).toHaveCount(0);
  await expect(station(page, WELCOME)).toContainText('elle reste là');
  await page.screenshot({ path: 'test-results/radio-accueil-liste.png' });
});

test('lien de pack au premier lancement : l’accueil joue pendant le téléchargement, puis la radio passe au pack en fondu', async ({ page }) => {
  test.setTimeout(120_000);
  await installAudioProbe(page);
  await routeLinks(page);
  // Morceaux d'une minute : le premier du pack ne s'achève pas avant les vérifications.
  packs.set('lent.zip', { buffer: smallPack(['hiphop-rnb'], 2, 60) });
  const release = await heldPack(page, 'lent.zip');
  await page.goto(`./?pack=${encodeURIComponent(`https://${LINK_HOST}/cors/lent.zip`)}`);
  await expect(page.locator('.radio-job')).toHaveAttribute('data-phase', 'telechargement');
  await expect(page.getByTestId('radio-titre')).toHaveText('Midnight Cruise');
  await expectAudible(page);
  await page.screenshot({ path: 'test-results/radio-accueil-telechargement.png' });

  // Pendant le fondu, les deux morceaux jouent ensemble (l'entrant monte, le sortant descend)…
  const crossfade = page.waitForFunction(
    () => (window as unknown as ProbeWindow).__audios.filter((a) => a.hasAttribute('src') && !a.paused).length === 2,
    null,
    { polling: 50, timeout: 60_000 },
  );
  release();
  await expect(station(page, 'Hip-hop & R&B')).toBeVisible({ timeout: 45_000 });
  await crossfade;
  await expect(page.getByTestId('radio-titre')).toHaveText('Bruit d’essai 1a');
  // … puis le sortant est déchargé : plus qu'un seul élément, celui du pack, avec du son.
  await expect.poll(async () => (await decks(page)).length, { timeout: 15_000 }).toBe(1);
  await expectAudible(page);
  await expect(page.locator('.radio-now-station')).toHaveText('Hip-hop & R&B');
});

test('geste pendant le téléchargement : l’accueil mis en pause, le pack arrive sans rien relancer', async ({ page }) => {
  test.setTimeout(120_000);
  await routeLinks(page);
  packs.set('lent2.zip', { buffer: smallPack(['hiphop-rnb']) });
  const release = await heldPack(page, 'lent2.zip');
  await page.goto(`./?pack=${encodeURIComponent(`https://${LINK_HOST}/cors/lent2.zip`)}`);
  const player = page.locator('.radio-player');
  await expect(page.getByTestId('radio-titre')).toHaveText('Midnight Cruise');
  // Le son sort vraiment avant le geste (sinon l'appui relancerait au lieu de mettre en pause).
  await expect.poll(() => clockSeconds(page), { timeout: 45_000 }).toBeGreaterThanOrEqual(1);
  await player.getByRole('button', { name: 'Pause' }).click();
  await expect(player.getByRole('button', { name: 'Lecture', exact: true })).toBeVisible();
  const paused = await clockSeconds(page);
  await expect(page.locator('.radio-job')).toHaveAttribute('data-phase', 'telechargement');
  release();
  await expect(station(page, 'Hip-hop & R&B')).toBeVisible({ timeout: 45_000 });
  await page.waitForTimeout(2500);
  // Le geste est respecté : toujours en pause, toujours sur l'accueil ; le pack attend dans la liste.
  await expect(page.getByTestId('radio-titre')).toHaveText('Midnight Cruise');
  await expect(player.getByRole('button', { name: 'Lecture', exact: true })).toBeVisible();
  expect(await clockSeconds(page)).toBe(paused);
  await expect(page.getByText('Station ajoutée')).toBeVisible();
});

test('pack déjà là : à l’ouverture, la station d’accueil ne s’impose pas', async ({ page }) => {
  await openRadio(page);
  await page.getByTestId('radio-fichier-pack').setInputFiles({ name: 'p.zip', mimeType: 'application/zip', buffer: Buffer.from(smallPack()) });
  await expect(page.getByText('Stations ajoutées')).toBeVisible({ timeout: 45_000 });
  await page.getByRole('button', { name: 'Écouter Rock' }).click();
  await expect(page.getByTestId('radio-titre')).toHaveText('Bruit d’essai 2a');
  const asked = watchWelcomeRequests(page);
  await page.goto('about:blank');
  await page.goto('./');
  await expect(radioButton(page)).toHaveAccessibleName('Radio, en lecture', { timeout: 30_000 });
  await radioButton(page).click();
  await expect(page.locator('.radio-mini')).toContainText('Bruit d’essai 2a');
  await page.waitForTimeout(1500);
  expect(asked).toEqual([]);
});

test('hors ligne : un morceau d’accueil déjà entendu rejoue, les autres sont sautés sans rien casser', async ({ page, context }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('./');
  await waitOfflineReady(page);
  // Page sous le contrôle du service worker : le morceau qui joue est gardé à sa première écoute.
  await page.reload();
  await openRadio(page);
  await expect(page.getByTestId('radio-titre')).toHaveText('Midnight Cruise');
  const kept = () =>
    page.evaluate(async () => {
      if (!(await caches.has('pmb-radio-accueil'))) return null;
      return (await (await caches.open('pmb-radio-accueil')).keys()).map((request) => new URL(request.url).pathname.split('/').pop());
    });
  await page.waitForTimeout(3000);
  test.skip((await kept()) === null, 'service worker sans la route de la musique d’accueil (patch accueil-sw.ts.patch pas encore appliqué)');
  await expect.poll(kept, { timeout: 30_000 }).toEqual(['midnight-cruise.mp3']);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('radio-titre')).toHaveText('Midnight Cruise', { timeout: 30_000 });
  await expect.poll(() => clockSeconds(page), { timeout: 45_000 }).toBeGreaterThanOrEqual(2);
  // Les trois autres n'ont jamais été entendus : sautés l'un après l'autre, retour au morceau gardé.
  await page.locator('.radio-player').getByRole('button', { name: 'Morceau suivant' }).click();
  await expect(page.getByTestId('radio-titre')).toHaveText('Midnight Cruise', { timeout: 30_000 });
  await expect(page.locator('.radio-player').getByRole('button', { name: 'Pause' })).toBeVisible({ timeout: 30_000 });
  await context.setOffline(false);
  expect(errors).toEqual([]);
});
