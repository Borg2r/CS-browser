// Uploaded weapon meshes use immutable shared geometry/materials. Only the
// cloned transforms (slide, magazine and optic) belong to an individual gun.
import * as THREE from '../vendor/three.module.min.js';

export const importedWeaponAssets = Object.freeze({
  knife: 'knife', wasp: 'mac10', sentinel: 'm4a1', rook: 'ak47',
  hornet: 'fiveseven', mammoth: 'desert_eagle', twin_mammoth: 'desert_eagle',
  twin_kestrel: 'dual_elite', twin_mp7: 'mp7', mp7: 'mp7',
  anvil: 'negev', m4a4: 'm4a4', longbow: 'awp', lynx: 'mp5sd',
  reaper: 'g3sg1', jackal: 'galil_ar', falcon: 'famas',
});

const assets = new Map(), loading = new Map();
let preload;
const wrapping = { 33071: THREE.ClampToEdgeWrapping, 33648: THREE.MirroredRepeatWrapping, 10497: THREE.RepeatWrapping };
const filtering = { 9728: THREE.NearestFilter, 9729: THREE.LinearFilter,
  9984: THREE.NearestMipmapNearestFilter, 9985: THREE.LinearMipmapNearestFilter,
  9986: THREE.NearestMipmapLinearFilter, 9987: THREE.LinearMipmapLinearFilter };

async function fetchAsset(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Weapon asset failed to load (${response.status}): ${url.pathname}`);
  return response;
}

async function decodeImage(url) {
  const blob = await (await fetchAsset(url)).blob();
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(blob, { imageOrientation: 'none', premultiplyAlpha: 'none' });
  }
  const objectURL = URL.createObjectURL(blob);
  try {
    const image = new Image(); image.src = objectURL;
    await image.decode(); return image;
  } finally { URL.revokeObjectURL(objectURL); }
}

async function loadAsset(id) {
  if (assets.has(id)) return assets.get(id);
  if (loading.has(id)) return loading.get(id);
  const task = (async () => {
    const url = new URL(`../assets/weapons/${id}/scene.json`, import.meta.url);
    const manifest = await (await fetchAsset(url)).json();
    if (manifest.version !== 1) throw new Error(`Unsupported weapon mesh: ${id}`);
    const loaded = await Promise.allSettled([
      fetchAsset(new URL(manifest.data, url)).then(response => response.arrayBuffer()),
      ...manifest.textures.map(source => decodeImage(new URL(source.uri, url))),
    ]);
    const images = loaded.slice(1).map(result => result.status === 'fulfilled' ? result.value : null);
    const failure = loaded.find(result => result.status === 'rejected');
    if (failure) { images.forEach(image => image?.close?.()); throw failure.reason; }
    const data = loaded[0].value;
    const textures = new Map(), materials = [], geometries = [];
    const textureFor = (reference, color = false) => {
      if (!reference) return null;
      const index = reference.index, channel = reference.texCoord || 0;
      const key = `${index}/${channel}/${color}`;
      if (textures.has(key)) return textures.get(key);
      const source = manifest.textures[index];
      if (!source || !images[index]) throw new Error(`Missing ${id} texture ${index}`);
      const texture = new THREE.Texture(images[index]);
      texture.flipY = false; texture.channel = channel;
      texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.wrapS = wrapping[source.wrapS ?? 10497];
      texture.wrapT = wrapping[source.wrapT ?? 10497];
      texture.magFilter = filtering[source.magFilter ?? 9729];
      texture.minFilter = filtering[source.minFilter ?? 9987];
      texture.anisotropy = 4; texture.needsUpdate = true;
      textures.set(key, texture); return texture;
    };
    try {
      for (const source of manifest.materials) {
        const pbr = source.pbrMetallicRoughness || {}, color = pbr.baseColorFactor || [1, 1, 1, 1];
        const specular = source.extensions?.KHR_materials_specular;
        const Material = source.extensions?.KHR_materials_unlit ? THREE.MeshBasicMaterial
          : specular ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
        const material = new Material({
          name: source.name || `${id} material`, map: textureFor(pbr.baseColorTexture, true),
          color: new THREE.Color().setRGB(...color.slice(0, 3)), opacity: color[3],
          side: source.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
          transparent: source.alphaMode === 'BLEND',
          alphaTest: source.alphaMode === 'MASK' ? source.alphaCutoff ?? .5 : 0,
        });
        if (!material.isMeshBasicMaterial) {
          material.roughness = pbr.roughnessFactor ?? 1;
          material.metalness = pbr.metallicFactor ?? 1;
          material.metalnessMap = material.roughnessMap = textureFor(pbr.metallicRoughnessTexture);
          material.normalMap = textureFor(source.normalTexture);
          material.normalScale.setScalar(source.normalTexture?.scale ?? 1);
          material.aoMap = textureFor(source.occlusionTexture);
          material.aoMapIntensity = source.occlusionTexture?.strength ?? 1;
          material.emissive.setRGB(...(source.emissiveFactor || [0, 0, 0]));
          material.emissiveMap = textureFor(source.emissiveTexture, true);
          material.emissiveIntensity = source.extensions?.KHR_materials_emissive_strength?.emissiveStrength ?? 1;
          if (specular) {
            material.specularIntensity = specular.specularFactor ?? 1;
            material.specularColor.setRGB(...(specular.specularColorFactor || [1, 1, 1]));
            material.specularIntensityMap = textureFor(specular.specularTexture);
            material.specularColorMap = textureFor(specular.specularColorTexture, true);
          }
        }
        materials.push(material);
      }
      const high = new THREE.Group(), low = new THREE.Group();
      high.name = low.name = `Imported ${id}`;
      const parts = new Map();
      const addBatch = (parent, batch, geometry) => {
        let target = parent;
        if (batch.part && batch.part !== 'body') {
          const key = `${parent.uuid}/${batch.part}`;
          if (!parts.has(key)) {
            const group = new THREE.Group(); group.name = batch.part;
            parent.add(group); parts.set(key, group);
          }
          target = parts.get(key);
        }
        const mesh = new THREE.Mesh(geometry, materials[batch.material]);
        mesh.name = batch.name || `${id} mesh`; mesh.castShadow = true; mesh.receiveShadow = true;
        target.add(mesh);
      };
      for (const batch of manifest.batches) {
        const geometry = new THREE.BufferGeometry(); geometries.push(geometry);
        for (const [key, size] of [['position', 3], ['normal', 3], ['uv', 2], ['uv1', 2]]) {
          const view = batch[key];
          if (view) geometry.setAttribute(key, new THREE.BufferAttribute(new Float32Array(data, view.byteOffset, view.length), size));
        }
        geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(data, batch.index.byteOffset, batch.index.length), 1));
        geometry.computeBoundingBox(); geometry.computeBoundingSphere();
        if (batch.lod !== 'low') addBatch(high, batch, geometry);
        if (batch.lod !== 'high') addBatch(low, batch, geometry);
      }
      const metadata = { ...manifest.metadata, imported: id };
      high.userData = metadata; low.userData = { ...metadata };
      const asset = { high, low: low.children.length ? low : high, manifest };
      assets.set(id, asset); return asset;
    } catch (error) {
      geometries.forEach(geometry => geometry.dispose());
      materials.forEach(material => material.dispose());
      textures.forEach(texture => texture.dispose());
      images.forEach(image => image.close?.());
      throw error;
    }
  })().finally(() => loading.delete(id));
  loading.set(id, task); return task;
}

export function loadImportedWeapons() {
  if (!preload) preload = (async () => {
    const queue = [...new Set(Object.values(importedWeaponAssets))];
    // Bound concurrent texture decoding; this also keeps initial memory use
    // predictable on computers with integrated graphics.
    const results = await Promise.allSettled(Array.from({ length: 3 }, async () => {
      while (queue.length) await loadAsset(queue.shift());
    }));
    const failure = results.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
  })().catch(error => { preload = null; throw error; });
  return preload;
}

export function cloneImportedWeapon(weapon, detail = 'world') {
  const id = importedWeaponAssets[weapon.id], asset = id && assets.get(id);
  if (!asset) return null;
  return (detail === 'view' ? asset.high : asset.low).clone(true);
}

export function importedWeaponReady(id) { return assets.has(importedWeaponAssets[id]); }
