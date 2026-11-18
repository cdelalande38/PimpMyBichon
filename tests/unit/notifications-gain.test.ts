// Les notifications de gain (src/ui/jeu/notifications.ts, NotificationsGain.tsx, FinCourseVue.tsx,
// src/state/jeu.ts) : la liste d'un bilan (ordre, genres, sons, total qui monte), les phrases pour un lecteur
// d'écran, l'écran de fin au premier rendu (défilé ou « moins de mouvement »), l'annonce d'un haut fait obtenu
// hors course, et le premier haut fait (« Premier tour de piste ») sur une sauvegarde neuve, quel que soit le temps.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HAUTS_FAITS } from '../../src/data/hautsFaits.ts';
import { ECONOMIE } from '../../src/data/economie.ts';
import { cloturer } from '../../src/jeu/cloture.ts';
import type { Bilan, ResultatCourse } from '../../src/jeu/contrat.ts';
import { etatVide } from '../../src/jeu/etat.ts';
import { FinCourseVue } from '../../src/ui/drive/FinCourseVue.tsx';
import {
  CADENCE_NOTIFICATIONS,
  DELAI_PREMIERE_NOTIFICATION,
  notificationsDeHautsFaits,
  notificationsDuBilan,
  phraseLot,
  phraseNotification,
  sonDuLot,
  totalApres,
} from '../../src/ui/jeu/notifications.ts';

const COURSE: ResultatCourse = {
  carte: 'carte-a',
  depart: 'depart-a',
  vehicule: 'vehicule-a',
  format: 'tour1',
  meteo: 'sec',
  moment: 'nuit',
  temps: 95,
  tours: [95],
  ancienRecord: null,
  medaille: null,
  stats: { distance: 3000, vitesseMax: 130, glisse: 5, chocs: 2, nos: 1 },
};
const course = (o: Partial<ResultatCourse> = {}): ResultatCourse => ({ ...COURSE, ...o });

/** Un bilan chargé : prime, médaille d'or, record, tour propre, pluie, et ce qu'ils font obtenir. */
function bilanChaud(): Bilan {
  return cloturer(etatVide(), course({ medaille: 'or', ancienRecord: 100, temps: 90, meteo: 'pluie', stats: { ...COURSE.stats, chocs: 0, vitesseMax: 165 } })).bilan;
}

describe('notifications d’un bilan', () => {
  it('une par ligne de gain, puis chaque haut fait, puis chaque objet ; le son suit le genre', () => {
    const bilan = bilanChaud();
    const liste = notificationsDuBilan(bilan);
    const genres = liste.map((n) => n.genre);
    expect(genres.slice(0, bilan.gains.detail.length)).toEqual(['dollars', 'medaille', 'record', 'dollars', 'dollars']);
    expect(liste.slice(0, bilan.gains.detail.length).map((n) => n.titre)).toEqual(bilan.gains.detail.map((l) => l.motif));
    const hauts = liste.filter((n) => n.genre === 'haut-fait');
    expect(hauts.map((n) => n.titre)).toEqual(bilan.hautsFaits.map((h) => h.label));
    expect(hauts.length).toBeGreaterThanOrEqual(3);
    expect(liste.slice(-bilan.deblocages.length || undefined).length).toBeGreaterThan(0);
    for (const n of liste) {
      expect(n.son, n.id).toBe(n.genre === 'dollars' ? 'dollars' : 'gain');
      expect(n.titre.length).toBeGreaterThan(0);
    }
    // Les ids sont uniques (clés d'affichage).
    expect(new Set(liste.map((n) => n.id)).size).toBe(liste.length);
    // La médaille garde sa couleur pour le dessin.
    expect(liste.find((n) => n.genre === 'medaille')?.medaille).toBe('or');
  });

  it('le total monte à mesure et finit sur ce que le solde a reçu (gains de la course + récompenses des hauts faits)', () => {
    const bilan = bilanChaud();
    const liste = notificationsDuBilan(bilan);
    const totaux = liste.map((_, i) => totalApres(liste, i + 1));
    for (let i = 1; i < totaux.length; i += 1) expect(totaux[i]).toBeGreaterThanOrEqual(totaux[i - 1] as number);
    expect(totalApres(liste, 0)).toBe(0);
    const recompenses = bilan.hautsFaits.reduce((somme, h) => somme + (h.recompense.dollars ?? 0), 0);
    expect(totalApres(liste, liste.length)).toBe(bilan.gains.dollars + recompenses);
    expect(totalApres(liste, 999)).toBe(totalApres(liste, liste.length));
    // Sur un état neuf, le solde après la course est exactement ce total.
    expect(bilan.solde).toBe(totalApres(liste, liste.length));
  });

  it('les montants viennent du bilan, jamais d’ici : la prime d’un tour est celle de l’économie', () => {
    const liste = notificationsDuBilan(cloturer(etatVide(), course({ stats: { ...COURSE.stats, chocs: 3 } })).bilan);
    expect(liste[0]).toMatchObject({ genre: 'dollars', dollars: ECONOMIE.tour1.base, son: 'dollars' });
  });

  it('un bilan sans rien (économie absente) : aucune notification, aucun son', () => {
    const vide: Bilan = { resultat: COURSE, gains: { dollars: 0, detail: [] }, solde: 0, hautsFaits: [], deblocages: [] };
    expect(notificationsDuBilan(vide)).toEqual([]);
    expect(sonDuLot([])).toBeNull();
    expect(phraseLot([])).toBe('');
  });

  it('« moins de mouvement » : un seul son, `gain` dès qu’il y a plus que de l’argent', () => {
    const argent = notificationsDuBilan({ resultat: COURSE, gains: { dollars: 40, detail: [{ motif: 'Course d’un tour finie', dollars: 40 }] }, solde: 40, hautsFaits: [], deblocages: [] });
    expect(sonDuLot(argent)).toBe('dollars');
    expect(sonDuLot(notificationsDuBilan(bilanChaud()))).toBe('gain');
  });

  it('le rythme est de 0,6 à 0,9 s par notification', () => {
    expect(CADENCE_NOTIFICATIONS).toBeGreaterThanOrEqual(600);
    expect(CADENCE_NOTIFICATIONS).toBeLessThanOrEqual(900);
    expect(DELAI_PREMIERE_NOTIFICATION).toBeGreaterThan(0);
  });

  it('phrases pour un lecteur d’écran : chaque gain une fois, le lot en une seule phrase', () => {
    const liste = notificationsDuBilan(bilanChaud());
    for (const n of liste) expect(phraseNotification(n)).toContain(n.titre);
    expect(phraseNotification({ id: 'x', genre: 'objet', titre: 'Flammes bleues', dollars: 0, son: 'gain' })).toBe('Objet débloqué : Flammes bleues.');
    expect(phraseNotification(liste[0]!)).toMatch(/plus 40 dollars\.$/);
    const lot = phraseLot(liste);
    expect(lot).toMatch(/^\d+ gains, plus \d+ dollars en tout\./);
    for (const n of liste) expect(lot).toContain(n.titre);
  });

  it('un haut fait obtenu hors course (le premier achat) : une notification de haut fait, son récompense, ses objets', () => {
    const premierAchat = HAUTS_FAITS.find((h) => h.id === 'premier-achat')!;
    const liste = notificationsDeHautsFaits([premierAchat], [{ id: 'sticker-x', famille: 'sticker', label: 'Sticker X', prix: null }]);
    expect(liste.map((n) => [n.genre, n.titre, n.dollars, n.son])).toEqual([
      ['haut-fait', 'Premier achat', 25, 'gain'],
      ['objet', 'Sticker X', 0, 'gain'],
    ]);
  });
});

const rendre = (bilan: Bilan, anime?: boolean) => renderToStaticMarkup(createElement(FinCourseVue, { bilan, onRejouer: () => undefined, onGarage: () => undefined, ...(anime === undefined ? {} : { anime }) }));

describe('écran de fin : premier rendu', () => {
  it('sans « anime » (moins de mouvement) : l’écran complet d’emblée, aucune liste de notifications', () => {
    const html = rendre(bilanChaud());
    expect(html).toContain('fin-course-gains');
    expect(html).toContain('fin-course-debloque');
    expect(html).not.toContain('notif-liste');
    expect(html).toContain('data-defilement="fini"');
    // La région vocale existe, vide au premier rendu (elle se remplit après, pour être annoncée).
    expect(html).toContain('role="status"');
  });

  it('avec mouvement : le défilé, aucune carte au premier rendu, « Tout afficher » (48 px) et le total à zéro', () => {
    const html = rendre(bilanChaud(), true);
    expect(html).toContain('data-defilement="en-cours"');
    expect(html).toContain('fin-course-notifs');
    expect(html).toContain('role="log"');
    expect(html).not.toContain('notif-carte');
    expect(html).toContain('Tout afficher');
    expect(html).not.toContain('fin-course-gains');
    // Le résultat et les deux boutons du bas sont déjà là.
    expect(html).toContain('Arrivée');
    expect(html).toContain('Rejouer');
    expect(html).toContain('Rentrer au garage');
  });

  it('un bilan sans notification n’attend rien, même avec mouvement', () => {
    const vide: Bilan = { resultat: COURSE, gains: { dollars: 0, detail: [] }, solde: 0, hautsFaits: [], deblocages: [] };
    const html = rendre(vide, true);
    expect(html).toContain('data-defilement="fini"');
    expect(html).toContain('Rien de gagné cette fois.');
  });
});

describe('le premier haut fait, sur une sauvegarde neuve', () => {
  it('« Premier tour de piste » tombe à la première course finie, quel que soit le temps, le format, la météo, le moment, les chocs, la médaille', () => {
    const cas: Partial<ResultatCourse>[] = [];
    for (const temps of [0.5, 12, 95, 600, 3600, 99999])
      for (const format of ['tour1', 'tours3'] as const)
        for (const meteo of ['sec', 'pluie', 'neige'] as const)
          for (const moment of ['nuit', 'jour'] as const)
            for (const medaille of [null, 'bronze', 'argent', 'or'] as const)
              cas.push({ temps, tours: [temps], format, meteo, moment, medaille, stats: { distance: 0, vitesseMax: 0, glisse: 0, chocs: temps > 1000 ? 40 : 0, nos: 0 } });
    expect(cas.length).toBe(6 * 2 * 3 * 2 * 4);
    for (const c of cas) {
      const { bilan, etat } = cloturer(etatVide(), course(c));
      expect(bilan.hautsFaits.map((h) => h.id), JSON.stringify(c)).toContain('premiere-course');
      expect(etat.hautsFaits['premiere-course']).toBe(true);
      expect(etat.cumuls.courses).toBe(1);
    }
  });

  it('une course finie sans temps de référence, sans record, sans gain nul : elle compte quand même', () => {
    const { bilan } = cloturer(etatVide(), course({ temps: 1, ancienRecord: 0.5, medaille: null }));
    expect(bilan.hautsFaits.map((h) => h.id)).toContain('premiere-course');
    expect(notificationsDuBilan(bilan).some((n) => n.genre === 'haut-fait' && n.titre === 'Premier tour de piste')).toBe(true);
  });

  it('sur le store : la clôture enregistrée donne le haut fait, une deuxième clôture du même résultat ne le redonne pas', async () => {
    globalThis.indexedDB = new IDBFactory();
    vi.resetModules();
    const store = await import('../../src/state/jeu.ts');
    const bilan = await import('../../src/jeu/bilan.ts');
    await vi.waitFor(() => expect(store.useJeu.getState().hydrated).toBe(true));
    const resultat = course();
    const premier = bilan.cloturerCourse(resultat);
    expect(premier.hautsFaits.map((h) => h.id)).toContain('premiere-course');
    expect(store.useJeu.getState().hautsFaits['premiere-course']).toBe(true);
    expect(store.useJeu.getState().cumuls.courses).toBe(1);
    expect(bilan.cloturerCourse(resultat)).toBe(premier);
    expect(store.useJeu.getState().cumuls.courses).toBe(1);
    // Une course d'après ne le redonne pas.
    const suite = bilan.cloturerCourse(course());
    expect(suite.hautsFaits.map((h) => h.id)).not.toContain('premiere-course');
  });
});

describe('annonces hors course', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  it('le premier achat pose une annonce de haut fait dans l’état ; lotAnnonce la retire ; rien n’est sauvegardé', async () => {
    vi.resetModules();
    const store = await import('../../src/state/jeu.ts');
    await vi.waitFor(() => expect(store.useJeu.getState().hydrated).toBe(true));
    store.useJeu.setState({ solde: 200 });
    expect(store.useJeu.getState().annonces).toEqual([]);
    const issue = store.useJeu.getState().acheter('pack-flammes');
    expect(issue.ok).toBe(true);
    const annonces = store.useJeu.getState().annonces;
    expect(annonces).toHaveLength(1);
    expect(annonces[0]?.map((n) => [n.genre, n.titre, n.dollars, n.son])).toEqual([['haut-fait', 'Premier achat', 25, 'gain']]);
    expect(store.etatDe(store.useJeu.getState())).not.toHaveProperty('annonces');
    // Un second achat n'annonce rien de plus (le haut fait est déjà obtenu).
    store.useJeu.setState({ solde: 500 });
    store.useJeu.getState().acheter('pack-course');
    expect(store.useJeu.getState().annonces).toHaveLength(1);
    store.useJeu.getState().lotAnnonce();
    expect(store.useJeu.getState().annonces).toEqual([]);
    store.useJeu.getState().lotAnnonce();
    expect(store.useJeu.getState().annonces).toEqual([]);
  });

  it('un achat refusé n’annonce rien', async () => {
    vi.resetModules();
    const store = await import('../../src/state/jeu.ts');
    await vi.waitFor(() => expect(store.useJeu.getState().hydrated).toBe(true));
    expect(store.useJeu.getState().acheter('pack-flammes').ok).toBe(false);
    expect(store.useJeu.getState().annonces).toEqual([]);
  });
});
