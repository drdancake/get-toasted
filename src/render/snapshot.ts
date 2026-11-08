import * as THREE from 'three';

// Little pictures of 3D models for DOM screens (expo's boxes): rendered once per look, then cached.
// A tiny separate renderer, so it never fights the game's canvas.

let renderer: THREE.WebGLRenderer | null = null;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
const cache = new Map<string, string>();

function setup() {
  if (renderer) return renderer;
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  scene.add(new THREE.HemisphereLight('#fff6e8', '#8a7c68', 1.6));
  const key = new THREE.DirectionalLight('#fff6e8', 2.4);
  key.position.set(-2, 6, 4);
  scene.add(key);
  return renderer;
}

/**
 * A picture of a model seen from above and in front (like looking down at the cutting board),
 * framed to `span` world units across. Same key, same picture.
 */
export function snapshot(key: string, build: () => THREE.Object3D, span: number, w = 220, h = 220, tiltDeg = 58, lookY = 0.2) {
  const hit = cache.get(key);
  if (hit) return hit;
  const r = setup();
  r.setSize(w, h, false);
  const obj = build();
  scene.add(obj);
  camera.aspect = w / h;
  const dist = span / 2 / Math.tan(THREE.MathUtils.degToRad(15));
  const tilt = THREE.MathUtils.degToRad(tiltDeg);
  camera.position.set(0, lookY + Math.sin(tilt) * dist, Math.cos(tilt) * dist);
  camera.lookAt(0, lookY, tiltDeg > 45 ? -0.25 : 0);
  camera.updateProjectionMatrix();
  r.render(scene, camera);
  const url = r.domElement.toDataURL('image/png');
  scene.remove(obj);
  cache.set(key, url);
  return url;
}
