// Écran de fin, lot « fin » (vague U, retour du 18 novembre 2026 : « dans l'écran de fin de courses proposer un
// bouton pour accéder directement à la course suivante ») : un seul jeu de boutons, trois au plus, le principal
// d'abord (src/ui/drive/FinCourseVue.tsx, `boutonsDeFin`) ; « Course suivante » enchaîne sur le rendez-vous
// suivant sans quitter la sortie (src/ui/carriere/actions.ts, `enchainerRendezVous` ; src/state/drive.ts,
// `relancerSur`) : tout imposé, la scène remontée (nouvel essai), les choix libres gardés pour le garage.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RendezVous } from '../../src/data/carriere.ts';
import type { VerdictRendezVous } from '../../src/jeu/carriereCloture.ts';
import type { Bilan } from '../../src/jeu/contrat.ts';

async function lancer() {
  vi.resetModules();
  const jeu = await import('../../src/state/jeu.ts');
  const drive = await import('../../src/state/drive.ts');
  const cloture = await import('../../src/jeu/carriereCloture.ts');
  const donnees = await import('../../src/data/carriere.ts');
  const vue = await import('../../src/ui/drive/FinCourseVue.tsx');
  const actions = await import('../../src/ui/carriere/actions.ts');
  await vi.waitFor(() => expect(jeu.useJeu.getState().hydrated && drive.useDrive.getState().hydrated).toBe(true));
  // La suite éprouvée ici est la saison 1 : numéros et totaux sont ceux de sa saison (vague V).
  return { ...jeu, ...drive, ...cloture, ...donnees, ...vue, ...actions, CARRIERE: donnees.SAISONS[0]!.rendezVous };
}

/** La course d'un rendez-vous, telle que la sortie la rend, avec le temps donné. */
const courseDe = (r: RendezVous, temps: number) => ({ carte: r.carte, depart: r.depart, vehicule: 'concept', format: r.format, meteo: r.meteo, moment: r.moment, temps, tours: [temps], stats: { distance: 1200, vitesseMax: 120, glisse: 0, chocs: 0, nos: 0 } });

/** Les boutons de l'écran de fin, dans l'ordre : `[libellé accessible, principal]`. */
function boutonsRendus(html: string): { nom: string; principal: boolean }[] {
  const actes = /<div class="fin-course-actes"[^>]*>([\s\S]*)<\/div><\/section>/.exec(html)?.[1] ?? '';
  return [...actes.matchAll(/<button[^>]*class="([^"]*)"[^>]*>([\s\S]*?)<\/button>/g)].map((m) => {
    const label = /aria-label="([^"]*)"/.exec(m[0])?.[1];
    const texte = (m[2] ?? '').replace(/<[^>]+>/g, '').trim();
    return { nom: label ?? texte, principal: (m[1] ?? '').split(' ').includes('cta') };
  });
}

describe('écran de fin : un seul jeu de boutons, « Course suivante » en carrière', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  it('boutonsDeFin : libre, réussi avec un suivant, manqué, carrière bouclée', async () => {
    const { boutonsDeFin, CARRIERE: suite, SAISONS } = await lancer();
    const [premier, second] = suite;
    if (!premier || !second) throw new Error('carrière vide');
    const base: VerdictRendezVous = { reussi: true, raison: 'fini', seuil: null, ecart: null, ecarts: [], manquees: [], rendezVous: premier, numero: 1, total: suite.length, saisonNumero: 1, saison: SAISONS[0]!, dejaReussi: false, prime: premier.prime, suivant: second, suivantNumero: 2, suivantTotal: suite.length, suivantSaison: 1, saisonBouclee: false, bouclee: false };
    const resume = (v: VerdictRendezVous | null) => boutonsDeFin(v).map((b) => `${b.principal ? '*' : ''}${b.label}${b.detail ? ` (${b.detail})` : ''}`);
    expect(resume(null)).toEqual(['*Rejouer', 'Rentrer au garage']);
    const reussi = boutonsDeFin(base);
    expect(reussi.map((b) => b.acte)).toEqual(['suivante', 'rejouer', 'garage']);
    expect(reussi[0]).toMatchObject({ label: 'Course suivante', principal: true });
    // Le petit texte dit lequel : son numéro, le lieu, la météo et le moment.
    expect(reussi[0]?.detail).toMatch(/^Rendez-vous 2 · .+ · (au sec|sous la pluie|sous la neige) · (de jour|de nuit)$/);
    expect(reussi[2]).toMatchObject({ label: 'Rentrer au garage', detail: 'préparer le véhicule', principal: false });
    expect(resume({ ...base, reussi: false, raison: 'trop-lent', suivant: premier, suivantNumero: 1 })).toEqual(['*Retenter', 'Rentrer au garage (préparer le véhicule)']);
    expect(resume({ ...base, bouclee: true, suivant: null })).toEqual(['*Rejouer', 'Rentrer au garage']);
    // Un rendez-vous rejoué une fois la carrière bouclée : rien à suivre.
    expect(resume({ ...base, dejaReussi: true, suivant: null })).toEqual(['*Rejouer', 'Rentrer au garage']);
    // Trois boutons au plus, un seul principal, toujours le premier ; un seul retour au garage.
    for (const v of [null, base, { ...base, reussi: false }, { ...base, bouclee: true, suivant: null }]) {
      const b = boutonsDeFin(v);
      expect(b.length).toBeLessThanOrEqual(3);
      expect(b.filter((x) => x.principal)).toEqual([b[0]]);
      expect(b.filter((x) => x.acte === 'garage')).toHaveLength(1);
    }
  });

  it('l’écran rendu : les boutons du bas seulement, aucun dans le bloc de la carrière', async () => {
    const { useDrive, useJeu, FinCourseVue, CARRIERE: suite } = await lancer();
    const rendre = (bilan: Bilan) => renderToStaticMarkup(createElement(FinCourseVue, { bilan, onRejouer: () => undefined, onGarage: () => undefined, onCourseSuivante: () => undefined }));
    const [premier, second] = suite;
    if (!premier || !second) throw new Error('carrière vide');
    // Réussi : « Course suivante » (principal), « Rejouer », « Rentrer au garage préparer le véhicule ».
    useDrive.getState().lancerRendezVous(premier, 1, suite.length);
    useDrive.getState().terminerCourse(courseDe(premier, 60));
    let html = rendre(useDrive.getState().fin!);
    let boutons = boutonsRendus(html);
    expect(boutons.map((b) => b.nom.split(' Rendez-vous')[0])).toEqual(['Course suivante', 'Rejouer', 'Rentrer au garage préparer le véhicule']);
    expect(boutons.map((b) => b.principal)).toEqual([true, false, false]);
    expect(boutons[0]?.nom).toContain(`Rendez-vous 2 · `);
    expect(html.match(/<button/g)).toHaveLength(3);
    expect(html).not.toContain('carriere-fin-actes');
    expect(html).toContain('Prochain rendez-vous');
    // Manqué : « Retenter » (principal), « Rentrer au garage préparer le véhicule » ; pas de « Rejouer ».
    const iBronze = suite.findIndex((x) => x.objectif === 'bronze');
    useJeu.setState({ carriere: { resultats: Object.fromEntries(suite.slice(0, iBronze).map((x) => [x.id, { reussi: true, essais: 1, meilleurTemps: 60, medaille: null }])) } });
    useDrive.getState().leave();
    useDrive.getState().lancerRendezVous(suite[iBronze]!, iBronze + 1, suite.length);
    useDrive.getState().terminerCourse(courseDe(suite[iBronze]!, 600));
    html = rendre(useDrive.getState().fin!);
    boutons = boutonsRendus(html);
    expect(boutons).toEqual([
      { nom: 'Retenter', principal: true },
      { nom: 'Rentrer au garage préparer le véhicule', principal: false },
    ]);
    expect(html.match(/<button/g)).toHaveLength(2);
    // Course libre : « Rejouer » (principal), « Rentrer au garage » ; pas de « Course suivante ».
    useDrive.getState().leave();
    useDrive.getState().terminerCourse(courseDe(premier, 60));
    html = rendre(useDrive.getState().fin!);
    expect(boutonsRendus(html)).toEqual([
      { nom: 'Rejouer', principal: true },
      { nom: 'Rentrer au garage', principal: false },
    ]);
    expect(html).not.toContain('Course suivante');
  });

  it('« Course suivante » : le rendez-vous suivant, tout imposé, la scène remontée, les choix libres gardés pour le garage', async () => {
    const { useDrive, verdictDe, enchainerRendezVous, CARRIERE: suite } = await lancer();
    const [premier, second] = suite;
    if (!premier || !second) throw new Error('carrière vide');
    // Choix libres du joueur, puis le premier rendez-vous ouvert comme depuis le panneau (la sortie entre ensuite).
    useDrive.setState({ weather: 'neige', moment: 'nuit', format: 'balade' });
    useDrive.getState().lancerRendezVous(premier, 1, suite.length);
    useDrive.getState().enter();
    expect(useDrive.getState().map).toBe(premier.carte);
    useDrive.getState().terminerCourse(courseDe(premier, 60));
    const v = verdictDe(useDrive.getState().fin)!;
    expect(v.suivant?.id).toBe(second.id);
    const essai = useDrive.getState().attempt;
    enchainerRendezVous(v.suivant!, v.suivantNumero, v.total);
    expect(useDrive.getState()).toMatchObject({
      map: second.carte,
      start: second.depart,
      weather: second.meteo,
      moment: second.moment,
      format: second.format,
      rendezVous: { id: second.id, numero: 2, total: suite.length, libre: { weather: 'neige', moment: 'nuit', format: 'balade' } },
      fin: null,
      apercu: true,
      attempt: essai + 1,
      telemetry: { ready: false, failed: false, finished: false },
    });
    // Même carte (un autre départ) : la scène se remonte quand même, sur le bon départ.
    const memeCarte = suite.find((r) => r.carte === second.carte && r.depart !== second.depart);
    if (memeCarte) {
      enchainerRendezVous(memeCarte, suite.indexOf(memeCarte) + 1, suite.length);
      expect(useDrive.getState()).toMatchObject({ map: memeCarte.carte, start: memeCarte.depart, attempt: essai + 2, rendezVous: { id: memeCarte.id } });
    }
    // Au garage, les choix libres reviennent.
    useDrive.getState().leave();
    expect(useDrive.getState()).toMatchObject({ map: null, rendezVous: null, weather: 'neige', moment: 'nuit', format: 'balade' });
    // Hors sortie : rien.
    enchainerRendezVous(second, 2, suite.length);
    expect(useDrive.getState()).toMatchObject({ map: null, rendezVous: null });
  });
});
