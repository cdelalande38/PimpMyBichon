// Sonde de réflexion mobile (§ 8, « sonde de réflexion mobile pour la caisse ») : une cubemap
// rendue depuis le véhicule, une face par image (ou toutes les `every` images), pour étaler le coût ;
// la conversion en environnement filtré (PMREM) se fait d'elle-même quand la sixième face est
// posée (needsPMREMUpdate). Le véhicule, la pluie et les faisceaux en sont masqués.

import { CubeCamera, HalfFloatType, WebGLCubeRenderTarget, type Camera, type Object3D, type Scene, type Vector3, type WebGLRenderer } from 'three';
import { NO_MIRROR_LAYER, PROBE_ONLY_LAYER } from '../../render/layers.ts';

export class MovingProbe {
  readonly target: WebGLCubeRenderTarget;
  private readonly cube: CubeCamera;
  private face = 0;
  private frame = 0;

  constructor(size: number, far: number) {
    this.target = new WebGLCubeRenderTarget(size, { type: HalfFloatType, generateMipmaps: false });
    this.cube = new CubeCamera(0.5, far, this.target);
    for (const child of this.cube.children) {
      child.layers.enable(NO_MIRROR_LAYER);
      child.layers.enable(PROBE_ONLY_LAYER);
    }
  }

  private renderFace(gl: WebGLRenderer, scene: Scene): void {
    const camera = this.cube.children[this.face] as Camera;
    gl.setRenderTarget(this.target, this.face);
    gl.render(scene, camera);
    this.face = (this.face + 1) % 6;
    if (this.face === 0) this.target.texture.needsPMREMUpdate = true;
  }

  /** Rend la face suivante (ou les six si `all`) depuis `position`, `hidden` masqués le temps du rendu. */
  step(gl: WebGLRenderer, scene: Scene, position: Vector3, hidden: readonly Object3D[], every: number, all = false): void {
    this.frame += 1;
    if (!all && this.frame % every !== 0) return;
    if (this.cube.coordinateSystem !== gl.coordinateSystem) {
      this.cube.coordinateSystem = gl.coordinateSystem;
      this.cube.updateCoordinateSystem();
    }
    if (this.face === 0 || all) {
      this.cube.position.copy(position);
      this.cube.updateMatrixWorld(true);
    }
    const previous = gl.getRenderTarget();
    const previousFace = gl.getActiveCubeFace();
    const previousLevel = gl.getActiveMipmapLevel();
    for (let i = 0; i < hidden.length; i += 1) (hidden[i] as Object3D).visible = false;
    if (all) {
      this.face = 0;
      for (let i = 0; i < 6; i += 1) this.renderFace(gl, scene);
    } else this.renderFace(gl, scene);
    for (let i = 0; i < hidden.length; i += 1) (hidden[i] as Object3D).visible = true;
    gl.setRenderTarget(previous, previousFace, previousLevel);
  }

  dispose(): void {
    this.target.dispose();
  }
}
