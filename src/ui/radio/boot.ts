// Démarrage de la radio, au montage du bouton du dock : index, réglages, lecture automatique, et
// lien de pack reçu (« ?pack=… » ou « #pack=… »). Le lien est retiré de l'adresse aussitôt lu, pour
// qu'un rechargement ne recommence pas ; le panneau Radio s'ouvre et le téléchargement part tout
// seul. Exceptions : économie de données demandée par le navigateur (le pack attend un appui) et
// pack déjà là (rien n'est retéléchargé, il joue). Une adresse refusée ne déclenche aucune requête.

import { openSheet } from '../../app/useRoute.ts';
import { autoStartOnOpen, downloadPack, findPackByUrl, initRadio, settingsReady, startPack } from '../../audio/radio/library.ts';
import { readPackLink, stripPackLink } from '../../audio/radio/link.ts';
import { useRadio } from '../../state/radio.ts';

let booted = false;

function saveData(): boolean {
  return (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
}

export function bootRadio(): void {
  if (booted) return;
  booted = true;
  const { pathname, search, hash } = window.location;
  const link = readPackLink(search, hash);
  const ready = initRadio();
  if (!link) {
    void autoStartOnOpen();
    return;
  }

  window.history.replaceState(window.history.state, '', stripPackLink(pathname, search, hash));
  openSheet({ name: 'radio' });
  if (!link.ok) {
    useRadio.setState({
      job: {
        kind: 'adresse',
        label: '',
        phase: 'erreur',
        done: 0,
        total: null,
        fail: {
          code: 'adresse',
          title: 'Le lien de pack est illisible.',
          hint: 'Il faut une adresse complète en https. Redemande le lien, ou colle l’adresse ci-dessous.',
        },
      },
    });
    return;
  }
  void Promise.all([ready, settingsReady()]).then(() => {
    if (useRadio.getState().status !== 'pret') return;
    const existing = findPackByUrl(link.url);
    if (existing) {
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
