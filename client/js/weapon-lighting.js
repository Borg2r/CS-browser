// One small, filtered reflection probe for first-person weapon materials.
// Broad neutral reflections reveal curved metalwork without a per-frame cube
// capture or external HDR download. Map lighting remains independent.
import * as THREE from '../vendor/three.module.min.js';

export function weaponEnvironment(renderer) {
  const scene = new THREE.Scene();
  const geometry = new THREE.BoxGeometry(12, 12, 12);
  const surfaces = [0x8995a3, 0x6c7580, 0xb9c4cf, 0x514b40, 0x8b9198, 0x6b7581]
    .map(color => new THREE.MeshBasicMaterial({ color, side: THREE.BackSide }));
  scene.add(new THREE.Mesh(geometry, surfaces));
  const cardGeometry = new THREE.PlaneGeometry(1, 1);
  const cardMaterials = [];
  for (const [width, height, position, strength] of [
    [3.4, 6.0, [-4, 3, 3], 2.5],
    [1.2, 4.6, [4, 1, -3], 1.8],
    [4.0, 1.5, [0, 4, -4], 1.5],
  ]) {
    const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(strength, strength, strength), side: THREE.DoubleSide });
    cardMaterials.push(material);
    const card = new THREE.Mesh(cardGeometry, material);
    card.position.set(...position); card.scale.set(width, height, 1); card.lookAt(0, 0, 0);
    scene.add(card);
  }
  const generator = new THREE.PMREMGenerator(renderer);
  try {
    // r170 fromScene uses a 256px source cubemap. This is generated once;
    // the returned small CubeUV target is shared by every viewmodel.
    return generator.fromScene(scene, .04, .1, 30);
  } finally {
    generator.dispose(); geometry.dispose(); cardGeometry.dispose();
    surfaces.forEach(material => material.dispose());
    cardMaterials.forEach(material => material.dispose());
    scene.clear();
  }
}
