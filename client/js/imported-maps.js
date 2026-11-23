// Uploaded map geometry uses exactly the same metre coordinates as collision.
// One source is cached. Each visible map leases its decoded images until its
// GPU textures are disposed; replaced downloads are cancelled and can retry.
import * as THREE from '../vendor/three.module.min.js';

const paths = Object.freeze({
  dust2: '../assets/dust2/',
  compound: '../assets/maps/compound/',
  province: '../assets/maps/province/',
  italy: '../assets/maps/italy/',
  assault: '../assets/maps/assault/',
  office: '../assets/maps/office/',
});

export function importedMapURL(id, filename = 'scene.json') {
  return Object.hasOwn(paths, id) ? new URL(filename, new URL(paths[id], import.meta.url)) : null;
}

let cached;
function closeSource(record) {
  if (!record.retired || record.leases || !record.source) return;
  record.source.images.forEach(image => image.close?.());
  record.source = null;
}
function retire(record) {
  record.retired = true;
  if (!record.source) record.controller.abort();
  closeSource(record);
}
function release(record) {
  record.leases--;
  closeSource(record);
}

// Flat maps must also cancel an imported map which is still downloading.
export function cancelPendingImportedMap() {
  if (cached && !cached.source) {
    const record = cached; cached = null; retire(record);
  }
}

async function fetchAsset(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Map asset failed to load (${response.status}): ${url.pathname}`);
  return response;
}

async function decodeImage(url, signal) {
  const blob = await (await fetchAsset(url, signal)).blob();
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

async function readSource(record) {
  const { url, controller } = record, { signal } = controller;
  const manifest = await (await fetchAsset(url, signal)).json();
  if (manifest.version !== 1) throw new Error('Unsupported imported map version');
  const images = new Array(manifest.textures.length);
  let next = 0, failureReason;
  const fail = error => {
    // Keep the original HTTP/decode error when cancellation also rejects the
    // parallel geometry request, which otherwise masks the useful diagnosis.
    failureReason ||= error;
    controller.abort(); return error;
  };
  const worker = async () => {
    while (next < images.length) {
      const index = next++;
      try {
        images[index] = await decodeImage(new URL(manifest.textures[index].uri, url), signal);
      } catch (error) {
        throw fail(error);
      }
    }
  };
  // Bound simultaneous texture requests, and settle every decoder before
  // closing partial results. Failed loads never poison a later selection.
  const loaded = await Promise.allSettled([
    fetchAsset(new URL(manifest.data, url), signal).then(r => r.arrayBuffer())
      .catch(error => { throw fail(error); }),
    ...Array.from({ length: Math.min(6, images.length) }, worker),
  ]);
  const failure = loaded.find(result => result.status === 'rejected');
  if (failure) {
    images.forEach(image => image?.close?.());
    throw failureReason || failure.reason;
  }
  return { manifest, data: loaded[0].value, images };
}

function acquire(id) {
  if (!cached || cached.id !== id) {
    if (cached) retire(cached);
    const url = importedMapURL(id);
    if (!url) throw new Error(`Unknown imported map: ${id}`);
    const record = { id, url, controller: new AbortController(), leases: 0, retired: false, source: null };
    cached = record;
    record.promise = readSource(record).then(source => {
      record.source = source; closeSource(record); return source;
    }).catch(error => {
      if (cached === record) cached = null;
      record.retired = true; throw error;
    });
  }
  cached.leases++;
  return cached;
}

const wrapping = { 33071: THREE.ClampToEdgeWrapping, 33648: THREE.MirroredRepeatWrapping, 10497: THREE.RepeatWrapping };
const filtering = { 9728: THREE.NearestFilter, 9729: THREE.LinearFilter,
  9984: THREE.NearestMipmapNearestFilter, 9985: THREE.LinearMipmapNearestFilter,
  9986: THREE.NearestMipmapLinearFilter, 9987: THREE.LinearMipmapLinearFilter };

export async function buildImportedMap(parent, map, isCurrent, anisotropy = 8) {
  const record = acquire(map.id);
  let source;
  try {
    source = await record.promise;
  } catch (error) {
    release(record);
    if (!isCurrent()) return false;
    throw error;
  }
  if (!isCurrent()) { release(record); return false; }
  const { manifest, data, images } = source;
  const textures = new Map(), materials = new Map(), geometries = [];
  const group = new THREE.Group(); group.name = `${map.name || map.id} original mesh`;
  group.userData.source = manifest.source;
  group.userData.triangles = manifest.triangleCount;

  const textureFor = (info, srgb = false) => {
    if (!info) return null;
    const transform = info.extensions?.KHR_texture_transform;
    const channel = transform?.texCoord ?? info.texCoord ?? 0;
    const key = JSON.stringify([info.index, srgb, channel, transform]);
    if (textures.has(key)) return textures.get(key);
    const description = manifest.textures[info.index];
    if (!description || !images[info.index]) throw new Error('Missing map texture');
    const texture = new THREE.Texture(images[info.index]);
    texture.flipY = false; texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.channel = channel;
    texture.wrapS = wrapping[description.wrapS ?? 10497] ?? THREE.RepeatWrapping;
    texture.wrapT = wrapping[description.wrapT ?? 10497] ?? THREE.RepeatWrapping;
    texture.magFilter = filtering[description.magFilter ?? 9729] ?? THREE.LinearFilter;
    texture.minFilter = filtering[description.minFilter ?? 9987] ?? THREE.LinearMipmapLinearFilter;
    texture.anisotropy = anisotropy;
    if (transform?.offset) texture.offset.fromArray(transform.offset);
    if (transform?.scale) texture.repeat.fromArray(transform.scale);
    if (transform?.rotation) texture.rotation = transform.rotation;
    texture.needsUpdate = true;
    textures.set(key, texture);
    return texture;
  };

  const materialFor = (index, vertexColors) => {
    const key = `${index}:${vertexColors}`;
    if (materials.has(key)) return materials.get(key);
    const description = manifest.materials[index] || {};
    const pbr = description.pbrMetallicRoughness || {};
    const color = pbr.baseColorFactor || [1, 1, 1, 1];
    const unlit = manifest.unlit || !!description.extensions?.KHR_materials_unlit;
    const parameters = {
      name: description.name || `Map material ${index}`,
      map: textureFor(pbr.baseColorTexture, true),
      color: new THREE.Color().setRGB(...color.slice(0, 3)),
      opacity: color[3], vertexColors,
      side: description.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
      transparent: description.alphaMode === 'BLEND',
      depthWrite: description.alphaMode !== 'BLEND',
      alphaTest: description.alphaMode === 'MASK' ? description.alphaCutoff ?? .5 : 0,
      toneMapped: !unlit,
    };
    let material;
    if (unlit) {
      material = new THREE.MeshBasicMaterial(parameters);
    } else {
      material = new THREE.MeshStandardMaterial({
        ...parameters,
        roughness: pbr.roughnessFactor ?? 1,
        metalness: pbr.metallicFactor ?? 1,
        roughnessMap: textureFor(pbr.metallicRoughnessTexture),
        metalnessMap: textureFor(pbr.metallicRoughnessTexture),
        normalMap: textureFor(description.normalTexture),
        normalScale: new THREE.Vector2(1, 1).multiplyScalar(description.normalTexture?.scale ?? 1),
        aoMap: textureFor(description.occlusionTexture),
        aoMapIntensity: description.occlusionTexture?.strength ?? 1,
        emissive: new THREE.Color().setRGB(...(description.emissiveFactor || [0, 0, 0])),
        emissiveMap: textureFor(description.emissiveTexture, true),
        emissiveIntensity: description.extensions?.KHR_materials_emissive_strength?.emissiveStrength ?? 1,
      });
    }
    materials.set(key, material);
    return material;
  };

  try {
    for (const batch of manifest.batches) {
      const geometry = new THREE.BufferGeometry(); geometries.push(geometry);
      for (const [name, itemSize] of [['position', 3], ['normal', 3], ['uv', 2], ['uv1', 2], ['color', 3]]) {
        const view = batch[name];
        if (!view) continue;
        const size = name === 'color' ? view.itemSize ?? view.length / (batch.position.length / 3) : itemSize;
        geometry.setAttribute(name, new THREE.BufferAttribute(new Float32Array(data, view.byteOffset, view.length), size));
      }
      if (batch.index) geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(data, batch.index.byteOffset, batch.index.length), 1));
      if (!batch.normal) geometry.computeVertexNormals();
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, materialFor(batch.material, !!batch.color));
      mesh.name = batch.name;
      mesh.castShadow = true; mesh.receiveShadow = !mesh.material.isMeshBasicMaterial;
      group.add(mesh);
    }
    // World calls this after disposing textures. Keeping the lease until then
    // also supports a WebGL context restoration while this map is visible.
    let released = false;
    group.userData.releaseImportedSource = () => {
      if (!released) { released = true; release(record); }
    };
    parent.add(group);
    return manifest;
  } catch (error) {
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
    textures.forEach(texture => texture.dispose());
    release(record);
    throw error;
  }
}
