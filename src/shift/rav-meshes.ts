import * as THREE from 'three';
import { FLAVORS } from '../config/flavors';
import { FILLING_TINT } from '../config/look';
import { RAV } from '../config/toss';
import { donenessAt, qualityAt } from '../game/doneness';
import { rampColor, ravGeometry } from '../render/models';
import type { Rav } from './physics';

const GEOS = [0, 1, 2].map(ravGeometry);
/** Filling squeezed out of a burst seam: a flattened blob poking out one side. */
const OOZE = new THREE.SphereGeometry(0.22, 8, 5);
const WHITE = new THREE.Color('#ffffff');

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
    // A salted rav reads a touch lighter: the salt on the crumb.
    if (r.salted) mat.color.lerp(WHITE, 0.12);
    mat.transparent = false;
    mat.opacity = 1;
    // Left too long: it bursts at the seam and the filling comes out.
    const burst = qualityAt(r.cooked, r.flavor, r.fryer) === 'popped';
    let ooze = m.userData.ooze as THREE.Mesh | undefined;
    if (burst && !ooze) {
      ooze = new THREE.Mesh(OOZE, new THREE.MeshStandardMaterial({ color: FLAVORS[r.flavor].filling, roughness: 0.4 }));
      ooze.position.set(0.42, 0.05, 0.1);
      ooze.scale.set(1.1, 0.45, 0.8);
      m.add(ooze);
      m.userData.ooze = ooze;
    }
    if (ooze) ooze.visible = burst;
    const s = RAV.hx * 2 * FLAVORS[r.flavor].size;
    const sq = r.squash;
    // (A mozzarella stick is a rav stretched long and thick.)
    const [lx, ly, lz] = FLAVORS[r.flavor].shape ?? [1, 1, 1];
    m.scale.set(s * lx * (1 + 0.25 * sq), s * ly * (1 - 0.45 * sq), s * lz * (1 + 0.25 * sq));
    return m;
  }

  end() {
    for (const [id, m] of this.meshes) {
      if (this.seen.has(id)) continue;
      this.parent.remove(m);
      (m.material as THREE.Material).dispose();
      ((m.userData.ooze as THREE.Mesh | undefined)?.material as THREE.Material | undefined)?.dispose();
      this.meshes.delete(id);
    }
  }

  hideAll() {
    this.begin();
    this.end();
  }
}
