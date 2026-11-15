import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import { capture, changedRatio, openApp, openAtelier, openEntry, paintAndReload, sceneBand, VIEWPORT, waitForBench, waitForScene, waitForStill } from './helpers.ts';

// Jalon 1, rendu cible : une capture par ambiance, la planche de revue (3 ambiances × 4
// peintures, captures/jalon-1/planche-c.jpg) et les relevés de « Sous le capot » (coût d'une
// image, sonde, réflexion du sol) en standard et en max.

const dock = (page: Page) => page.locator('footer.dock');

async function pick(page: Page, tab: string, choice: string): Promise<void> {
  await openEntry(page, tab);
  // Le nom exact (« Chrome » n'est pas « Chrome coloré ») est dans le <b> du bouton.
  const button = dock(page)
    .getByRole('group', { name: tab })
    .getByRole('button')
    .filter({ has: page.locator('b', { hasText: new RegExp(`^${choice}$`) }) });
  await button.tap();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
}

interface Facts {
  image: string;
  sonde: string;
  sol: string;
}

async function facts(page: Page): Promise<Facts> {
  await page.goto('./#/capot');
  const read = async (name: string) => (await page.locator(`[data-fact="${name}"]`).innerText()).trim();
  const result = { image: await read('image'), sonde: await read('sonde'), sol: await read('sol') };
  await page.goBack();
  return result;
}

async function setQuality(page: Page, label: string): Promise<void> {
  await openAtelier(page, 'Réglages');
  const dialog = page.getByRole('dialog', { name: 'Réglages' });
  await expect(dialog).toBeVisible();
  const button = dialog.getByRole('group', { name: 'Qualité' }).getByRole('button', { name: new RegExp(`^${label}`) });
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await page.goBack();
  await expect(dialog).toBeHidden();
}

/** Moyenne RGB d'une zone de la capture (fractions de l'écran) : un relevé chiffré à côté de l'œil. */
async function meanColor(png: Buffer, box: { x: number; y: number; w: number; h: number }): Promise<number[]> {
  const { width = VIEWPORT.width, height = VIEWPORT.height } = await sharp(png).metadata();
  const region = {
    left: Math.round(box.x * width),
    top: Math.round(box.y * height),
    width: Math.round(box.w * width),
    height: Math.round(box.h * height),
  };
  const { channels } = await sharp(await sharp(png).extract(region).toBuffer()).stats();
  return channels.slice(0, 3).map((channel) => Math.round(channel.mean));
}

test.describe('rendu cible', () => {
  test.setTimeout(900_000);

  test('trois ambiances : la sonde se refait à chaque changement, jamais au repos', async ({ page }) => {
    await openApp(page);
    await waitForScene(page);
    await waitForBench(page);
    await capture(page, '10-ambiance-bichon');

    const first = await facts(page);
    expect(first.image).toMatch(/\d+ appels de dessin · [\d\s ]+ triangles/);
    expect(first.sonde).toMatch(/Sonde de 256 px par face, calculée en \d+ ms \(1 calcul\)/);
    expect(first.sol).toMatch(/Réflexion du sol sur \d+ × \d+ px/);
    test.info().annotations.push({ type: 'image', description: first.image }, { type: 'sonde', description: first.sonde });
    await waitForStill(page);

    for (const [label, file] of [
      ['Néon', '11-ambiance-neon'],
      ['Atelier', '12-ambiance-atelier'],
    ] as const) {
      const before = await sceneBand(page);
      await pick(page, 'Ambiance', label);
      await waitForStill(page);
      expect(await changedRatio(before, await sceneBand(page)), `« ${label} » change l’image`).toBeGreaterThan(0.05);
      await capture(page, file);
    }
    const last = await facts(page);
    expect(last.sonde).toMatch(/\(3 calculs\)/);
    test.info().annotations.push({ type: 'sonde-fin', description: last.sonde });
  });

  test('planche de revue : 3 ambiances × 4 peintures, et relevés standard puis max', async ({ page }) => {
    // Douze images arrêtées en rendu logiciel, à côté d'un autre parcours : c'est long.
    test.setTimeout(1_800_000);
    await openApp(page);
    await waitForScene(page);
    await waitForBench(page);

    const ambiances = ['Bichon', 'Néon', 'Atelier'] as const;
    // Peinture de la carrosserie posée par la sauvegarde des builds (l'interface de peinture a ses
    // propres parcours) : un rechargement par peinture, puis les trois ambiances au pouce.
    const looks: ReadonlyArray<readonly [color: string, finish: string, caption: string]> = [
      ['#0a3a46', 'paillete', 'Vert Bichon pailleté'],
      ['#ff6a00', 'brillant', 'Orange piste brillant'],
      ['#5b1a8e', 'chrome-colore', 'Violet chrome coloré'],
      ['#0b0b0e', 'brillant', 'Noir brillant'],
    ];
    const vehicle = (await page.locator('.stage').getAttribute('data-vehicle')) ?? '';
    const taken = new Map<string, Buffer>();
    for (const [color, finish, caption] of looks) {
      await paintAndReload(page, vehicle, { carrosserie: { color, finish } });
      for (const ambiance of ambiances) {
        await pick(page, 'Ambiance', ambiance);
        await waitForStill(page);
        taken.set(`${ambiance} · ${caption}`, await page.screenshot());
      }
    }
    const shots: Array<{ png: Buffer; caption: string }> = [];
    const stats: Record<string, { voiture: number[]; haut: number[]; bas: number[] }> = {};
    for (const ambiance of ambiances) {
      for (const [, , caption] of looks) {
        const label = `${ambiance} · ${caption}`;
        const png = taken.get(label) as Buffer;
        shots.push({ png, caption: label });
        stats[label] = {
          voiture: await meanColor(png, { x: 0.3, y: 0.36, w: 0.4, h: 0.06 }),
          haut: await meanColor(png, { x: 0, y: 0.1, w: 1, h: 0.06 }),
          bas: await meanColor(png, { x: 0, y: 0.6, w: 1, h: 0.05 }),
        };
      }
    }

    // Planche : vignettes de 390 px de large, légendées, 4 colonnes (peintures) × 3 lignes (ambiances).
    const thumbWidth = 390;
    const thumbHeight = Math.round((VIEWPORT.height / VIEWPORT.width) * thumbWidth);
    const captionHeight = 34;
    const columns = looks.length;
    const width = columns * thumbWidth;
    const height = ambiances.length * (thumbHeight + captionHeight);
    const tiles = await Promise.all(
      shots.map(async ({ png, caption }, index) => {
        const left = (index % columns) * thumbWidth;
        const top = Math.floor(index / columns) * (thumbHeight + captionHeight);
        const thumb = await sharp(png).resize(thumbWidth, thumbHeight).toBuffer();
        const text = Buffer.from(
          `<svg width="${thumbWidth}" height="${captionHeight}"><rect width="100%" height="100%" fill="#111"/>` +
            `<text x="10" y="23" font-family="sans-serif" font-size="17" fill="#fff">${caption}</text></svg>`,
        );
        return [
          { input: thumb, left, top },
          { input: text, left, top: top + thumbHeight },
        ];
      }),
    );
    const file = resolve('captures', 'jalon-1', 'planche-c.jpg');
    mkdirSync(resolve('captures', 'jalon-1'), { recursive: true });
    await sharp({ create: { width, height, channels: 3, background: '#000' } })
      .composite(tiles.flat())
      .jpeg({ quality: 82 })
      .toFile(file);

    // Relevés : standard (niveau « auto ») puis max.
    const standard = await facts(page);
    await setQuality(page, 'Max');
    await waitForStill(page);
    const max = await facts(page);
    expect(max.sonde).toMatch(/Sonde de 512 px/);
    expect(max.sol).toMatch(/Réflexion du sol sur \d+ × \d+ px/);
    writeFileSync(resolve('captures', 'jalon-1', 'planche-c.json'), JSON.stringify({ standard, max, stats }, null, 2));
  });
});
