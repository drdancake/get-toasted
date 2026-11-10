import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Models here are built from lots of little meshes (a basket is sixty rods and panels). Two things
// keep that cheap: throw a model's GPU memory away when it leaves the scene, and bake a model that
// never moves its parts into a few meshes, one per material.

/** Mark a geometry or texture as shared (cached, reused): `dispose` leaves it alone. */
export function shared<T extends THREE.BufferGeometry | THREE.Texture>(x: T): T {
  x.userData.shared = true;
  return x;
}

/** Free everything a model holds on the GPU (except shared geometry and textures). Call when it leaves the scene for good. */
export function dispose(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (!m.geometry.userData.shared) m.geometry.dispose();
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      const map = (mat as THREE.MeshStandardMaterial).map;
      if (map && !map.userData.shared) {
        map.dispose();
        mat.dispose();
      }
    }
  });
}

/** Take every child out of a group and free it. */
export function clear(group: THREE.Object3D) {
  for (const c of [...group.children]) {
    group.remove(c);
    dispose(c);
  }
}

/**
 * Bake a static model into one mesh per material: same look, a fraction of the draw calls. `warp`
 * can move each vertex (in the model's own space) on the way. The source model is freed.
 */
export function flatten(src: THREE.Object3D, warp?: (p: THREE.Vector3) => void) {
  const out = new THREE.Group();
  src.updateMatrixWorld(true);
  const groups = new Map<THREE.Material, { geos: THREE.BufferGeometry[]; order: number }>();
  const v = new THREE.Vector3();
  src.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    let geo = mesh.geometry.clone();
    geo.applyMatrix4(mesh.matrixWorld);
    if (geo.index) geo = geo.toNonIndexed();
    // Only what every mesh has, so they can merge.
    for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') geo.deleteAttribute(name);
    if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((geo.attributes.position?.count ?? 0) * 2), 2));
    if (!geo.attributes.normal) geo.computeVertexNormals();
    if (warp) {
      const p = geo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        warp(v);
        p.setXYZ(i, v.x, v.y, v.z);
      }
    }
    const g = groups.get(mesh.material) ?? { geos: [], order: mesh.renderOrder };
    g.geos.push(geo);
    groups.set(mesh.material, g);
  });
  for (const [mat, g] of groups) {
    const merged = mergeGeometries(g.geos, false);
    for (const x of g.geos) x.dispose();
    if (!merged) continue;
    const m = new THREE.Mesh(merged, mat);
    m.renderOrder = g.order;
    out.add(m);
  }
  dispose(src);
  return out;
}
