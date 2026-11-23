// Shared geometry and deterministic PBR finishes for our authored weapons.
// Geometry is baked into Parts' material batches; these source geometries never
// create extra draw calls. All lengths use metres, with the muzzle towards -Z.
import * as THREE from '../vendor/three.module.min.js';

export function profile(points, width, bevel = .002, holes = []) {
  const polygon = (vertices, path) => {
    vertices.forEach(([z, y], i) => i ? path.lineTo(-z, y) : path.moveTo(-z, y));
    path.closePath(); return path;
  };
  const shape = polygon(points, new THREE.Shape());
  for (const hole of holes) shape.holes.push(polygon(hole, new THREE.Path()));
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: width, bevelEnabled: bevel > 0, bevelSize: bevel,
    bevelThickness: bevel, bevelSegments: 2, curveSegments: 12, steps: 1,
  });
  geometry.translate(0, 0, -width / 2);
  geometry.rotateY(Math.PI / 2);
  // Wood grain follows the length of the furniture on its broad side faces.
  // Mapping is local to each part so small grips also resolve their texture.
  geometry.computeBoundingBox();
  const b = geometry.boundingBox, a = geometry.attributes;
  const dz = Math.max(.001, b.max.z - b.min.z), dy = Math.max(.001, b.max.y - b.min.y);
  const dx = Math.max(.001, b.max.x - b.min.x);
  for (let i = 0; i < a.position.count; i++) {
    const side = Math.abs(a.normal.getX(i)) > .5;
    a.uv.setXY(i, (a.position.getZ(i) - b.min.z) / dz,
      side ? (a.position.getY(i) - b.min.y) / dy : (a.position.getX(i) - b.min.x) / dx);
  }
  return geometry;
}

// Include both interior wall and annular end faces, never a black solid disc.
export function hollowTube(outer, inner, length, segments = 24) {
  const half = length / 2;
  const geometry = new THREE.LatheGeometry([
    new THREE.Vector2(inner, -half), new THREE.Vector2(outer, -half),
    new THREE.Vector2(outer, half), new THREE.Vector2(inner, half),
    new THREE.Vector2(inner, -half),
  ], segments);
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

export function turned(stations, segments = 24) {
  let outline = stations;
  if (outline[0][0] > outline[outline.length - 1][0]) outline = [...outline].reverse();
  const geometry = new THREE.LatheGeometry(outline.map(([z, r]) => new THREE.Vector2(r, z)), segments);
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

const finishCache = new Map(), textureCache = new Map();
const surface = {
  steel: [.73, .39, .13], blued: [.72, .32, .10], stainless: [.8, .29, .12],
  polymer: [.02, .69, .26], rubber: [0, .87, .34], wood: [0, .49, .16],
};
function textures(kind) {
  if (textureCache.has(kind)) return textureCache.get(kind);
  if (typeof document === 'undefined') return {};
  const size = 512, canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d'), pixels = ctx.createImageData(size, size);
  const roughCanvas = canvas.cloneNode(), roughCtx = roughCanvas.getContext('2d');
  const rough = roughCtx.createImageData(size, size), heights = new Float32Array(size * size);
  let seed = 0x937a26;
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
  const grain = kind === 'wood', soft = kind === 'polymer' || kind === 'rubber';
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x, n = random();
    const streak = Math.sin(y * .87 + 3.7 * Math.sin(x * .011) + Math.sin(y * .031));
    const growth = Math.sin(y * .13 + 4.5 * Math.sin(x * .008) + 1.4 * Math.sin(y * .025));
    const value = grain ? 221 + growth * 14 + streak * 9 + (n - .5) * 14
      : soft ? 228 + (n - .5) * 32 : 235 + Math.sin(y * 1.7) * 4 + (n - .5) * 11;
    pixels.data.set([value, grain ? value * .94 : value, grain ? value * .84 : value, 255], i * 4);
    const roughness = grain ? 191 + growth * 15 + n * 19 : soft ? 217 + n * 35 : 207 + n * 33;
    rough.data.set([roughness, roughness, roughness, 255], i * 4);
    heights[i] = grain ? (growth + streak) * .13 + n * .18 : soft ? n : n * .2 + Math.sin(y * 1.7) * .1;
  }
  ctx.putImageData(pixels, 0, 0); roughCtx.putImageData(rough, 0, 0);
  const normalCanvas = canvas.cloneNode(), normalCtx = normalCanvas.getContext('2d');
  const normal = normalCtx.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = heights[y * size + (x + 1) % size] - heights[y * size + (x + size - 1) % size];
    const dy = heights[((y + 1) % size) * size + x] - heights[((y + size - 1) % size) * size + x];
    const inv = 1 / Math.hypot(dx, dy, 1);
    normal.data.set([128 - dx * inv * 127, 128 - dy * inv * 127, 128 + inv * 127, 255], (y * size + x) * 4);
  }
  normalCtx.putImageData(normal, 0, 0);
  const result = { map: new THREE.CanvasTexture(canvas), roughnessMap: new THREE.CanvasTexture(roughCanvas), normalMap: new THREE.CanvasTexture(normalCanvas) };
  result.map.colorSpace = THREE.SRGBColorSpace;
  for (const texture of Object.values(result)) { texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.anisotropy = 4; }
  textureCache.set(kind, result); return result;
}

export function finish(kind, color) {
  if (!surface[kind]) throw new Error(`Unknown weapon finish: ${kind}`);
  const key = `${kind}/${color}`;
  if (!finishCache.has(key)) {
    const [metalness, roughness, strength] = surface[kind];
    const material = new THREE.MeshStandardMaterial({ color, metalness, roughness,
      ...textures(kind), normalScale: new THREE.Vector2(strength, strength) });
    material.name = `weapon/${kind}/${color}`;
    finishCache.set(key, material);
  }
  return finishCache.get(key);
}
