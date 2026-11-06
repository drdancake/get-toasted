import * as THREE from 'three';
import { FLAVORS } from '../config/flavors';
import { FILLING_TINT } from '../config/look';
import { RAV } from '../config/toss';
import { donenessAt } from '../game/doneness';
import { rampColor, ravGeometry } from '../render/models';
import type { Rav } from './physics';

const GEOS = [0, 1, 2].map(ravGeometry);

/** One mesh per rav, colored by doneness, scaled by flavor. Sweep what you didn't draw. */
export class RavMeshes {
  private meshes = new Map<number, THREE.Mesh>();
  private seen = new Set<number>();
  private tint = new THREE.Color();
  constructor(private parent: THREE.Object3D) {}

  begin() {
    this.seen.clear();
  }

  get(r: Rav) {
    this.seen.add(r.id);
    let m = this.meshes.get(r.id);
    if (!m) {
      m = new THREE.Mesh(
        GEOS[r.id % GEOS.length] ?? GEOS[0],
        new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.75 }),
      );
      m.userData.zj = (Math.random() - 0.5) * 0.44;
      m.userData.yaw = (Math.random() - 0.5) * 0.7;
      this.parent.add(m);
      this.meshes.set(r.id, m);
    }
    const mat = m.material as THREE.MeshStandardMaterial;
    const d = donenessAt(r.cooked, r.flavor, r.fryer);
    rampColor(d, mat.color);
    // The filling shows faintly through the dough: subtle raw, subtler cooked.
    const k = FILLING_TINT.raw + (FILLING_TINT.cooked - FILLING_TINT.raw) * Math.min(1, d * 2);
    mat.color.lerp(this.tint.set(FLAVORS[r.flavor].filling), k);
    mat.transparent = false;
    mat.opacity = 1;
    const s = RAV.hx * 2 * FLAVORS[r.flavor].size;
    const sq = r.squash;
    m.scale.set(s * (1 + 0.25 * sq), s * (1 - 0.45 * sq), s * (1 + 0.25 * sq));
    return m;
  }

  end() {
    for (const [id, m] of this.meshes) {
      if (this.seen.has(id)) continue;
      this.parent.remove(m);
      (m.material as THREE.Material).dispose();
      this.meshes.delete(id);
    }
  }

  hideAll() {
    this.begin();
    this.end();
  }
}
