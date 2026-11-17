// Démarrage de la radio, au montage du bouton du dock : index, réglages, lecture automatique, et
// lien de pack reçu (« ?pack=… » ou « #pack=… »). Le lien est retiré de l'adresse aussitôt lu, pour
// qu'un rechargement ne recommence pas ; le panneau Radio s'ouvre et le téléchargement part tout
// seul. Exceptions : économie de données demandée par le navigateur (le pack attend un appui) et
// pack déjà là au même poids (une requête HEAD, rien n'est retéléchargé, il joue). Une adresse
// refusée (illisible, pas en https, machine locale ou réseau privé) ne déclenche aucune requête.
// Tant qu'aucun pack n'est là (premier lancement, pack en route ou en attente d'un appui), la station
// d'accueil, servie par l'app, joue ; elle laisse la place au pack dès qu'il est prêt.

import { openSheet } from '../../app/useRoute.ts';
import {
  autoStartOnOpen,
  downloadPack,
  findPackByUrl,
  initRadio,
  remoteSize,
  settingsReady,
  startPack,
  startWelcome,
} from '../../audio/radio/library.ts';
import { readPackLink, stripPackLink } from '../../audio/radio/link.ts';
import { attendreLancement } from '../../pwa/lancementStore.ts';
import { useRadio } from '../../state/radio.ts';

let booted = false;

function saveData(): boolean {
  return (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
}

export function bootRadio(): void {
  if (booted) return;
  booted = true;
  // Ni musique d'accueil ni téléchargement de pack avant la fin de la vérification de version du
  // lancement (écran de chargement, src/pwa/lancement.ts) : un flux qui dure retiendrait l'ancienne
  // version du service worker, et la nouvelle ne prendrait jamais la main. Quelques secondes au plus.
  void attendreLancement().then(demarrerRadio);
}

function demarrerRadio(): void {
  const { pathname, search, hash } = window.location;
  const link = readPackLink(search, hash);
  const ready = initRadio();
  if (!link) {
    void autoStartOnOpen();
    return;
  }

  window.history.replaceState(window.history.state, '', stripPackLink(pathname, search, hash));
  openSheet({ name: 'radio' });
  // Sans pack sur le téléphone : la station d'accueil (rien si un pack est déjà là).
  void startWelcome();
  if (!link.ok) {
    useRadio.setState({
      job: {
        kind: 'adresse',
        label: '',
        phase: 'erreur',
        done: 0,
        total: null,
        fail:
          link.reason === 'local'
            ? {
                code: 'adresse',
                title: 'Ce lien vise une machine de ton réseau local.',
                hint: 'Par prudence, un lien reçu ne part pas tout seul vers le téléphone ou ta box. Si tu sais d’où il vient, colle l’adresse ci-dessous.',
              }
            : {
                code: 'adresse',
                title: 'Le lien de pack est illisible.',
                hint: 'Il faut une adresse complète en https. Redemande le lien, ou colle l’adresse ci-dessous.',
              },
      },
    });
    return;
  }
  void Promise.all([ready, settingsReady()]).then(async () => {
    if (useRadio.getState().status !== 'pret') return;
    const existing = findPackByUrl(link.url);
    // Même adresse : on ne retélécharge que si le poids annoncé a changé (sans réponse : on garde).
    const size = existing ? await remoteSize(link.url) : null;
    if (existing && (size === null || size === existing.sourceBytes)) {
      useRadio.setState({
        job: { kind: 'adresse', label: link.host, phase: 'fini', done: 0, total: null, message: 'Ce pack est déjà dans ta radio : rien à télécharger.' },
      });
      startPack(existing.id);
      return;
    }
    if (saveData()) {
      useRadio.setState({ offer: { url: link.url, host: link.host } });
      return;
    }
    void downloadPack(link.url);
  });
}
