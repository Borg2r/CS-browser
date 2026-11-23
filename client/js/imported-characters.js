// Uploaded classic operators with their original textured meshes. The source
// collection was static; its added skeleton is animated from shared game poses.
import * as THREE from '../vendor/three.module.min.js';

const sourceURL = new URL('../assets/characters/scene.json', import.meta.url);
let loading, source;
const textures = [], materials = [], templates = new Map();

async function fetchAsset(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Character asset HTTP ${response.status}: ${url.pathname}`);
  return response;
}
async function imageAsset(url) {
  const blob = await (await fetchAsset(url)).blob();
  if (typeof createImageBitmap === 'function') return createImageBitmap(blob, { imageOrientation: 'none', premultiplyAlpha: 'none' });
  const address = URL.createObjectURL(blob);
  try { const img = new Image(); img.src = address; await img.decode(); return img; }
  finally { URL.revokeObjectURL(address); }
}

export function loadCharacters() {
  if (loading) return loading;
  loading = (async () => {
    const manifest = await (await fetchAsset(sourceURL)).json();
    if (manifest.version !== 1) throw new Error('Unsupported character collection');
    const results = await Promise.allSettled([
      fetchAsset(new URL(manifest.geometry, sourceURL)).then(r => r.arrayBuffer()),
      ...manifest.textures.map(t => imageAsset(new URL(t.uri, sourceURL))),
    ]);
    const failure = results.find(r => r.status === 'rejected');
    if (failure) {
      results.slice(1).forEach(r => { if (r.status === 'fulfilled') r.value.close?.(); });
      throw failure.reason;
    }
    const data = results[0].value;
    results.slice(1).forEach(({ value }) => {
      const texture = new THREE.Texture(value);
      texture.colorSpace = THREE.SRGBColorSpace; texture.flipY = false;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = 4; texture.needsUpdate = true;
      textures.push(texture);
    });
    manifest.materials.forEach(m => materials.push(new THREE.MeshStandardMaterial({
      name: m.name, map: m.texture == null ? null : textures[m.texture],
      color: new THREE.Color().setRGB(...m.color.slice(0, 3)), roughness: .94, metalness: 0,
      side: THREE.DoubleSide,
    })));
    for (const operator of manifest.operators) {
      const batches = operator.batches.map(batch => {
        const geometry = new THREE.BufferGeometry();
        for (const [key, size, Type] of [['position', 3, Float32Array], ['normal', 3, Float32Array], ['uv', 2, Float32Array], ['skinIndex', 4, Uint16Array], ['skinWeight', 4, Float32Array]]) {
          const view = batch[key];
          geometry.setAttribute(key, new THREE.BufferAttribute(new Type(data, view.offset, view.length), size));
        }
        geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(data, batch.index.offset, batch.index.length), 1));
        geometry.computeBoundingSphere();
        return { geometry, material: materials[batch.material] };
      });
      templates.set(operator.id, { ...operator, batches });
    }
    source = manifest;
  })().catch(error => {
    for (const template of templates.values()) template.batches.forEach(b => b.geometry.dispose());
    templates.clear(); materials.splice(0).forEach(m => m.dispose());
    textures.splice(0).forEach(t => { t.image.close?.(); t.dispose(); });
    loading = null; source = null;
    throw error;
  });
  return loading;
}

const bombGeometry = new THREE.BoxGeometry(.23, .28, .10);
const bombMaterial = new THREE.MeshStandardMaterial({ color: 0x5b5138, roughness: .9 });

export function importedPlayerModel(team, id = 0) {
  if (!source) return null;
  const roster = source.operators.filter(o => o.team === (team === 1 ? 1 : 2));
  const choice = roster[Math.abs(id) % roster.length], template = templates.get(choice.id);
  const root = new THREE.Group(); root.name = `${choice.name} operator`;
  const body = new THREE.Group(); root.add(body);
  const bones = source.bones.map(def => { const b = new THREE.Bone(); b.name = def.name; return b; });
  source.bones.forEach((def, i) => {
    bones[i].position.fromArray(def.position);
    if (def.parent >= 0) { bones[i].position.sub(new THREE.Vector3().fromArray(source.bones[def.parent].position)); bones[def.parent].add(bones[i]); }
    else body.add(bones[i]);
  });
  body.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  template.batches.forEach(({ geometry, material }) => {
    const mesh = new THREE.SkinnedMesh(geometry, material); mesh.name = choice.id;
    mesh.castShadow = mesh.receiveShadow = true; mesh.frustumCulled = false;
    body.add(mesh); mesh.bind(skeleton);
  });
  const rig = Object.fromEntries(bones.map(b => [b.name, b]));
  const arms = new THREE.Group(); body.add(arms); arms.position.y = 1.34;
  const gunSlot = new THREE.Group(), gunSlotL = new THREE.Group();
  gunSlot.position.set(.16, 0, -.35); gunSlotL.position.set(-.20, 0, -.35); arms.add(gunSlot, gunSlotL);
  const pack = new THREE.Mesh(bombGeometry, bombMaterial); pack.position.set(0, -.13, .22); rig.chest.add(pack); pack.visible = false;
  return { imported: true, operator: choice.id, root, body, skeleton, rig, ...rig,
    torso: rig.spine, arms, gunSlot, gunSlotL, pack, team, phase: 0, poseTime: 0, weapon: null, deadT: 0, last: null };
}

export function disposeImportedPlayer(model) {
  // Geometry/materials are shared by the entire roster. Only per-player bone
  // textures need releasing when a player leaves or the map changes.
  if (model?.imported) model.skeleton.dispose();
}

function point(v) { return new THREE.Vector3(...v); }
function solveArm(model, side, target, palmDirection) {
  const { rig, body } = model;
  const upper = side > 0 ? rig.upperR : rig.upperL;
  const lower = side > 0 ? rig.lowerR : rig.lowerL;
  const hand = side > 0 ? rig.handR : rig.handL;
  body.updateMatrixWorld(true);
  const shoulder = body.worldToLocal(upper.getWorldPosition(new THREE.Vector3()));
  const delta = target.clone().sub(shoulder), reach = Math.min(.575, Math.max(.06, delta.length()));
  const direction = delta.normalize();
  const pole = point([side * .7, -.6, .1]);
  pole.addScaledVector(direction, -pole.dot(direction)).normalize();
  const along = reach * .5, bend = Math.sqrt(Math.max(0, .29 * .29 - along * along));
  const elbow = shoulder.clone().addScaledVector(direction, along).addScaledVector(pole, bend);
  const end = shoulder.clone().addScaledVector(direction, reach);
  const bodyRotation = body.getWorldQuaternion(new THREE.Quaternion());
  function orient(bone, direction) {
    const desired = new THREE.Quaternion().setFromUnitVectors(point([side, 0, 0]), direction.normalize());
    const parentRotation = bone.parent.getWorldQuaternion(new THREE.Quaternion());
    bone.quaternion.copy(parentRotation.invert()).multiply(bodyRotation).multiply(desired);
    bone.updateWorldMatrix(false, true);
  }
  orient(upper, elbow.clone().sub(shoulder));
  orient(lower, end.clone().sub(elbow));
  orient(hand, palmDirection);
}

export function updateImportedPlayer(model, snapshot, weapon, dt, id) {
  const m = model, rig = m.rig;
  const alive = !!snapshot.alive;
  const speed = alive && m.last ? Math.hypot(snapshot.x - m.last[0], snapshot.z - m.last[1]) / Math.max(dt, .001) : 0;
  m.last = alive ? [snapshot.x, snapshot.z] : null;
  const crouch = alive && !!(snapshot.flags & 1), previous = m.phase;
  m.poseTime += Math.min(dt, .05); m.phase += Math.min(speed, 7) * dt * 1.7;
  const stride = Math.sin(m.phase) * Math.min(1, speed / 3) * .60;
  m.body.rotation.set(0, 0, 0); m.body.position.y = 0;
  for (const bone of m.skeleton.bones) bone.quaternion.identity();
  rig.hips.position.y = crouch ? .35 : .85;
  rig.spine.position.y = crouch ? .22 : .32;
  rig.chest.rotation.z = Math.sin(m.phase) * Math.min(speed, 6) * .003;
  rig.head.rotation.x = THREE.MathUtils.clamp(snapshot.pitch * .35, -.4, .4);
  // Keep the outer helmet/hood within the standing and crouching head volume
  // while tilting; this small neck adjustment avoids an exposed visual crown.
  rig.head.position.y = .16 - Math.abs(rig.head.rotation.x) * .03;
  for (const [leg, knee, foot, swing] of [[rig.legL, rig.kneeL, rig.footL, stride], [rig.legR, rig.kneeR, rig.footR, -stride]]) {
    if (crouch) {
      const thigh = 1.6 + swing * .13;
      const kneeY = .35 - .42 * Math.cos(thigh);
      const calf = -Math.acos(THREE.MathUtils.clamp((kneeY - .13) / .30, .1, .98));
      leg.rotation.x = thigh; knee.rotation.x = calf - thigh; foot.rotation.x = -calf;
    } else {
      leg.rotation.x = swing; knee.rotation.x = Math.max(0, -swing) * .35;
      foot.rotation.x = -Math.max(0, swing) * .2;
    }
  }
  const elevation = crouch ? -.60 : 0;
  m.arms.position.y = 1.34 + elevation;
  m.arms.rotation.x = alive ? snapshot.pitch * .9 : 0;
  const aim = new THREE.Quaternion().setFromAxisAngle(point([1, 0, 0]), m.arms.rotation.x);
  const center = point([0, 1.34 + elevation, 0]);
  const target = v => point(v).applyQuaternion(aim).add(center);
  const forward = point([0, 0, -1]).applyQuaternion(aim);
  solveArm(m, 1, target(alive ? [.16, -.04, -.25] : [.25, -.48, 0]), forward.clone());
  const compact = weapon.cls <= 1 || weapon.cls > 6;
  solveArm(m, -1, target(!alive ? [-.25, -.48, 0] : weapon.dual ? [-.20, -.04, -.25] : compact ? [.075, -.08, -.23] : [.045, -.045, -.46]), forward.clone());
  // The server drops a dead player's gun. Relax the original arms and hide the
  // held duplicate rather than driving a long barrel through the floor.
  m.gunSlot.visible = m.gunSlotL.visible = alive;
  if (!alive) {
    m.deadT = Math.min(1, m.deadT + dt * 4);
    m.body.rotation.x = -m.deadT * Math.PI / 2; m.body.position.y = m.deadT * .27;
    return 0;
  }
  m.deadT = 0;
  return speed > 3.4 && Math.floor(previous / Math.PI) !== Math.floor(m.phase / Math.PI) ? 1 : 0;
}
