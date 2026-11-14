// Garde-fou autour de la scène 3D : si three.js ne se charge pas ou si WebGL refuse de démarrer,
// le reste de l'app (dock, panneaux, réglages) continue de tourner et propose de relancer.

import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Appelé une fois quand la scène tombe. */
  onFail: () => void;
}

interface State {
  failed: boolean;
}

export class SceneBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    console.error('[garage] la scène 3D ne démarre pas', error);
    this.props.onFail();
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
