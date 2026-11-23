// Original uploaded Dust2 mesh, baked once into the same metre coordinates as
// server/WASM collision. The CPU cache is bounded to this one map; every map
// instance owns its GPU resources so normal World cleanup remains sufficient.
import * as THREE from '../vendor/three.module.min.js';

const manifestURL = new URL('../assets/dust2/scene.json', import.meta.url);
let sourcePromise;

async function fetchAsset(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Dust2 asset failed to load (${response.status}): ${url.pathname}`);
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
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(objectURL);
  }
}

function loadSource() {
  if (!sourcePromise) {
    sourcePromise = (async () => {
      const manifest = await (await fetchAsset(manifestURL)).json();
      if (manifest.version !== 1) throw new Error('Unsupported Dust2 mesh version');
      // Wait for all decodes even on failure, so partially loaded bitmaps can be
      // released. A later map selection can retry a failed network request.
      const loaded = await Promise.allSettled([
        fetchAsset(new URL(manifest.data, manifestURL)).then(r => r.arrayBuffer()),
        ...manifest.textures.map(t => decodeImage(new URL(t.uri, manifestURL))),
      ]);
      const failure = loaded.find(r => r.status === 'rejected');
      if (failure) {
        loaded.slice(1).forEach(r => { if (r.status === 'fulfilled') r.value.close?.(); });
        throw failure.reason;
      }
      return { manifest, data: loaded[0].value, images: loaded.slice(1).map(r => r.value) };
    })().catch(error => { sourcePromise = null; throw error; });
  }
  return sourcePromise;
}

const wrapping = { 33071: THREE.ClampToEdgeWrapping, 33648: THREE.MirroredRepeatWrapping, 10497: THREE.RepeatWrapping };
const filtering = { 9728: THREE.NearestFilter, 9729: THREE.LinearFilter,
  9984: THREE.NearestMipmapNearestFilter, 9985: THREE.LinearMipmapNearestFilter,
  9986: THREE.NearestMipmapLinearFilter, 9987: THREE.LinearMipmapLinearFilter };

export async function buildDust2(parent, isCurrent, anisotropy = 8) {
  const { manifest, data, images } = await loadSource();
  // No GPU objects are created by an obsolete load. Changing maps while the
  // first download is in progress cannot populate the newly selected map.
  if (!isCurrent()) return false;

  const textures = [], materials = [], geometries = [];
  const group = new THREE.Group(); group.name = 'Dust2 original mesh';
  group.userData.source = manifest.source;
  group.userData.triangles = manifest.triangleCount;
  try {
    manifest.textures.forEach((source, i) => {
      const texture = new THREE.Texture(images[i]);
      texture.flipY = false; texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = wrapping[source.wrapS ?? 10497];
      texture.wrapT = wrapping[source.wrapT ?? 10497];
      texture.magFilter = filtering[source.magFilter ?? 9729];
      texture.minFilter = filtering[source.minFilter ?? 9987];
      texture.anisotropy = anisotropy; texture.needsUpdate = true;
      textures.push(texture);
    });
    manifest.materials.forEach(source => {
      const pbr = source.pbrMetallicRoughness || {};
      const color = pbr.baseColorFactor || [1, 1, 1, 1];
      const material = new THREE.MeshStandardMaterial({
        name: source.name,
        map: pbr.baseColorTexture ? textures[pbr.baseColorTexture.index] : null,
        color: new THREE.Color().setRGB(...color.slice(0, 3)),
        opacity: color[3],
        roughness: pbr.roughnessFactor ?? 1,
        metalness: pbr.metallicFactor ?? 1,
        side: source.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
        transparent: source.alphaMode === 'BLEND',
        alphaTest: source.alphaMode === 'MASK' ? source.alphaCutoff ?? .5 : 0,
      });
      materials.push(material);
    });
    manifest.batches.forEach(batch => {
      const geometry = new THREE.BufferGeometry(); geometries.push(geometry);
      for (const [key, size] of [['position', 3], ['normal', 3], ['uv', 2]]) {
        const view = batch[key];
        geometry.setAttribute(key, new THREE.BufferAttribute(new Float32Array(data, view.byteOffset, view.length), size));
      }
      geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(data, batch.index.byteOffset, batch.index.length), 1));
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, materials[batch.material]);
      mesh.name = batch.name; mesh.castShadow = true; mesh.receiveShadow = true;
      group.add(mesh);
    });
    parent.add(group);
    return true;
  } catch (error) {
    geometries.forEach(g => g.dispose());
    materials.forEach(m => m.dispose());
    textures.forEach(t => t.dispose());
    throw error;
  }
}
