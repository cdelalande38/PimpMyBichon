// Mise à jour au lancement (src/pwa/lancement.ts) : la machine d'états pure, ses délais et ses décisions.
import { describe, expect, it } from 'vitest';
import {
  demarrer,
  doitRecharger,
  entreeAvecOffre,
  LANCEMENT,
  lancementEnCours,
  pourcentage,
  reduire,
  type EnvLancement,
  type EtatLancement,
  type EvenementLancement,
} from '../../src/pwa/lancement.ts';

const env: EnvLancement = { indisponible: false, controle: true, enLigne: true, depuisRechargeMs: Number.POSITIVE_INFINITY };
const T0 = 1_000_000;

/** Rejoue des événements datés (ms après le lancement) et rend le dernier état. */
function jouer(depart: EtatLancement, suite: Array<[number, EvenementLancement]>): EtatLancement {
  return suite.reduce((etat, [apres, evenement]) => reduire(etat, evenement, T0 + apres), depart);
}

describe('démarrage du lancement', () => {
  it('service worker aux commandes et réseau : on vérifie', () => {
    const etat = demarrer(env, T0);
    expect(etat.phase).toBe('verification');
    expect(lancementEnCours(etat)).toBe(true);
  });

  it.each([
    ['développement ou navigateur sans service worker', { indisponible: true }, 'indisponible'],
    ['première visite (aucun service worker aux commandes)', { controle: false }, 'premiere-visite'],
    ['sans réseau', { enLigne: false }, 'hors-ligne'],
    ['page rechargée par ce même écran il y a un instant', { depuisRechargeMs: 5_000 }, 'deja-recharge'],
  ] as const)('%s : on entre tout de suite', (_nom, ecart, raison) => {
    const etat = demarrer({ ...env, ...ecart }, T0);
    expect(etat).toMatchObject({ phase: 'entree', raison });
    expect(lancementEnCours(etat)).toBe(false);
  });

  it('la garde contre la boucle tombe après son délai', () => {
    expect(demarrer({ ...env, depuisRechargeMs: LANCEMENT.gardeMs - 1 }, T0).phase).toBe('entree');
    expect(demarrer({ ...env, depuisRechargeMs: LANCEMENT.gardeMs }, T0).phase).toBe('verification');
  });
});

describe('vérification', () => {
  const depart = demarrer(env, T0);

  it('rien de nouveau : on entre, sans recharger', () => {
    const etat = jouer(depart, [[200, { type: 'verifie', version: 'aucune' }]]);
    expect(etat).toMatchObject({ phase: 'entree', raison: 'aucune-version' });
    expect(doitRecharger(depart, etat)).toBe(false);
  });

  it('échec de la vérification : on entre', () => {
    expect(jouer(depart, [[200, { type: 'verifie', version: 'echec' }]])).toMatchObject({ phase: 'entree', raison: 'echec' });
  });

  it('pas de réponse dans le délai : on entre (la réponse tardive sera proposée dans le menu)', () => {
    expect(jouer(depart, [[LANCEMENT.verificationMs - 1, { type: 'tick' }]]).phase).toBe('verification');
    expect(jouer(depart, [[LANCEMENT.verificationMs, { type: 'tick' }]])).toMatchObject({ phase: 'entree', raison: 'delai' });
  });

  it('une version qui s’installe : téléchargement ; une version déjà prête : application', () => {
    expect(jouer(depart, [[300, { type: 'verifie', version: 'en-cours' }]]).phase).toBe('telechargement');
    expect(jouer(depart, [[300, { type: 'verifie', version: 'prete' }]]).phase).toBe('application');
  });

  it('un message de progression avant la réponse prouve qu’une version s’installe', () => {
    const etat = jouer(depart, [[300, { type: 'progres', done: 4, total: 40 }]]);
    expect(etat).toMatchObject({ phase: 'telechargement', done: 4, total: 40 });
  });

  it('une réponse tardive de la vérification, en cours de téléchargement, ne défait rien', () => {
    const etat = jouer(depart, [
      [300, { type: 'progres', done: 4, total: 40 }],
      [400, { type: 'verifie', version: 'aucune' }],
    ]);
    expect(etat.phase).toBe('telechargement');
  });
});

describe('téléchargement', () => {
  const telechargement = jouer(demarrer(env, T0), [[300, { type: 'verifie', version: 'en-cours' }]]);

  it('suit l’avancement et le dit en pourcentage', () => {
    const etat = jouer(telechargement, [[1000, { type: 'progres', done: 10, total: 40 }]]);
    expect(etat).toMatchObject({ phase: 'telechargement', done: 10, total: 40 });
    expect(pourcentage(etat)).toBe(25);
    expect(pourcentage({ done: 0, total: 0 })).toBe(0);
    expect(pourcentage({ done: 50, total: 40 })).toBe(100);
  });

  it('« Plus tard » laisse entrer, sans recharger', () => {
    const etat = jouer(telechargement, [[1000, { type: 'plus-tard' }]]);
    expect(etat).toMatchObject({ phase: 'entree', raison: 'plus-tard' });
    expect(doitRecharger(telechargement, etat)).toBe(false);
    expect(entreeAvecOffre(etat)).toBe(true);
  });

  it('sans aucun progrès pendant le délai : on entre', () => {
    const progres: EvenementLancement = { type: 'progres', done: 1, total: 40 };
    // Un progrès tous les 15 s entretient l'attente, jusqu'à la durée maximale.
    const vivant = jouer(telechargement, [
      [15_000, progres],
      [30_000, progres],
      [LANCEMENT.sansProgresMs + 29_999, { type: 'tick' }],
    ]);
    expect(vivant.phase).toBe('telechargement');
    expect(jouer(telechargement, [[300 + LANCEMENT.sansProgresMs, { type: 'tick' }]])).toMatchObject({ phase: 'entree', raison: 'trop-lent' });
  });

  it('durée maximale dépassée, même avec des progrès : on entre', () => {
    const etat = jouer(telechargement, [
      [LANCEMENT.telechargementMaxMs, { type: 'progres', done: 30, total: 40 }],
      [300 + LANCEMENT.telechargementMaxMs, { type: 'tick' }],
    ]);
    expect(etat).toMatchObject({ phase: 'entree', raison: 'trop-lent' });
  });

  it('installation perdue : on entre', () => {
    expect(jouer(telechargement, [[2000, { type: 'perdue' }]])).toMatchObject({ phase: 'entree', raison: 'echec' });
  });

  it('version installée : application', () => {
    expect(jouer(telechargement, [[2000, { type: 'prete' }]]).phase).toBe('application');
  });
});

describe('application', () => {
  const application = jouer(demarrer(env, T0), [[300, { type: 'verifie', version: 'prete' }]]);

  it('recharge une seule fois, au changement de version effectif', () => {
    const etat = reduire(application, { type: 'controle' }, T0 + 1500);
    expect(etat).toMatchObject({ phase: 'entree', raison: 'recharge' });
    expect(doitRecharger(application, etat)).toBe(true);
    // Un second changement de version, une fois entré : aucune nouvelle décision, aucun rechargement.
    const encore = reduire(etat, { type: 'controle' }, T0 + 1600);
    expect(encore).toBe(etat);
    expect(doitRecharger(etat, encore)).toBe(false);
    expect(entreeAvecOffre(etat)).toBe(false);
  });

  it('l’ancienne version ne passe pas la main : on entre sans recharger, la version reste proposée', () => {
    expect(jouer(application, [[300 + LANCEMENT.activationMs - 1, { type: 'tick' }]]).phase).toBe('application');
    const etat = jouer(application, [[300 + LANCEMENT.activationMs, { type: 'tick' }]]);
    expect(etat).toMatchObject({ phase: 'entree', raison: 'activation-lente' });
    expect(doitRecharger(application, etat)).toBe(false);
    expect(entreeAvecOffre(etat)).toBe(true);
  });

  it('« Plus tard » n’existe pas à ce stade : la main est déjà en train de passer', () => {
    expect(reduire(application, { type: 'plus-tard' }, T0 + 400)).toBe(application);
  });
});

describe('entrée', () => {
  it('est définitive : aucun événement ne la défait', () => {
    const entre = demarrer({ ...env, enLigne: false }, T0);
    for (const evenement of [
      { type: 'verifie', version: 'en-cours' },
      { type: 'progres', done: 1, total: 2 },
      { type: 'prete' },
      { type: 'controle' },
      { type: 'tick' },
    ] as const) {
      expect(reduire(entre, evenement, T0 + 999_999)).toBe(entre);
    }
  });

  it('une première visite ou un mode sans service worker n’a rien à proposer', () => {
    expect(entreeAvecOffre(demarrer({ ...env, controle: false }, T0))).toBe(false);
    expect(entreeAvecOffre(demarrer({ ...env, indisponible: true }, T0))).toBe(false);
    expect(entreeAvecOffre(demarrer({ ...env, enLigne: false }, T0))).toBe(true);
  });
});
