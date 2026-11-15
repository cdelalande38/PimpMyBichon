// Démarrage de la radio, au montage du bouton du dock : index, réglages, et lien de pack reçu
// (« ?pack=… » ou « #pack=… »). Le lien est retiré de l'adresse aussitôt lu, pour qu'un
// rechargement ne recommence pas ; le panneau Radio s'ouvre sur l'offre, un appui lance.
// Aucune requête ne part vers l'hébergement du pack avant cet appui (pas même pour le poids).

import { openSheet } from '../../app/useRoute.ts';
import { findPackByUrl, initRadio } from '../../audio/radio/library.ts';
import { readPackLink, stripPackLink } from '../../audio/radio/link.ts';
import { useRadio } from '../../state/radio.ts';

let booted = false;

export function bootRadio(): void {
  if (booted) return;
  booted = true;
  const { pathname, search, hash } = window.location;
  const link = readPackLink(search, hash);
  const ready = initRadio();
  if (!link) return;

  window.history.replaceState(window.history.state, '', stripPackLink(pathname, search, hash));
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
  } else {
    useRadio.setState({ offer: { url: link.url, host: link.host, already: false } });
    void ready.then(() => {
      const offer = useRadio.getState().offer;
      if (offer?.url !== link.url) return;
      useRadio.setState({ offer: { ...offer, already: findPackByUrl(link.url) !== undefined } });
    });
  }
  openSheet({ name: 'radio' });
}
