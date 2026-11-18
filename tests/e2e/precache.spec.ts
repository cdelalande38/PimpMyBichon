// Précache (vite.config.ts, injectManifest) : un fichier dont le nom ne porte pas l'empreinte de son
// contenu doit avoir un numéro de révision, sinon un téléphone qui l'a déjà en cache ne le recharge
// plus jamais (constaté le 16 novembre 2026 : l'ancienne Cox restait servie avec le code nouveau).
import { expect, test } from '@playwright/test';

const HACHE = /^assets\/[^/]+-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/;

test('précache : seuls les fichiers nommés d’après leur contenu se passent de révision', { tag: '@essentiel' }, async ({ request }) => {
  const response = await request.get('./sw.js');
  expect(response.ok()).toBe(true);
  const source = await response.text();
  const entries = [...source.matchAll(/\{[^{}]*?url:?"?[^{}]*?\}/g)]
    .map((match) => match[0])
    .filter((text) => /revision/.test(text))
    .map((text) => ({
      url: /"?url"?:"([^"]+)"/.exec(text)?.[1] ?? '',
      revision: /"?revision"?:(null|"[^"]*")/.exec(text)?.[1] ?? '',
    }))
    .filter((entry) => entry.url !== '');
  expect(entries.length).toBeGreaterThan(20);
  const sansRevision = entries.filter((entry) => entry.revision === 'null').map((entry) => entry.url);
  expect(sansRevision.filter((url) => !HACHE.test(url))).toEqual([]);
  // Les modèles des véhicules et les pièces partagées sont bien du lot, avec une révision.
  const avecRevision = entries.filter((entry) => entry.revision !== 'null').map((entry) => entry.url);
  expect(avecRevision.some((url) => /^assets\/vehicles\/[^/]+\/body\.glb$/.test(url))).toBe(true);
  expect(avecRevision.some((url) => url.startsWith('assets/shared/'))).toBe(true);
});
