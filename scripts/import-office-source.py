#!/usr/bin/env python3
r"""Prepare the supplied Office FBX and baked atlases for import-maps.py.

Run with Blender 4.3 or later; no external Python packages are required:

  blender --background --python-exit-code 1 --python scripts/import-office-source.py -- \
    /path/to/extracted/cs-office-with-real-light /tmp/office.glb \
    --archive /path/to/cs-office-with-real-light.zip

The input directory must contain source/1.fbx and textures/part1..part14.
This creates an intermediate GLB only. Run the shared map importer separately
to normalize its coordinates and produce browser assets and collision data.

Blender applies the FBX's inch-to-metre conversion and exports Y-up coordinates.
The source geometry and both UV channels remain intact. The second UV channel
contains the packed baked-light atlas; the first contains tiled legacy UVs.
Atlases are resized with Blender to at most 2048px and embedded as PNGs for the
shared importer's final WebP encoding. Glass remains a transparent material.
"""

import argparse
import hashlib
import json
from pathlib import Path
import struct
import sys
import tempfile


SOURCE_RELEASE = "https://github.com/Borg2r/CS-browser/releases/tag/map-assets"


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def finish_glb(path, provenance):
    """Represent baked emission as unlit base colour without changing geometry."""
    raw = path.read_bytes()
    if struct.unpack_from("<III", raw) != (0x46546C67, 2, len(raw)):
        raise ValueError("Blender did not produce a complete GLB 2 file")
    chunks = {}
    cursor = 12
    while cursor < len(raw):
        length, kind = struct.unpack_from("<II", raw, cursor)
        cursor += 8
        chunks[kind] = raw[cursor:cursor + length]
        cursor += length
    gltf = json.loads(chunks[0x4E4F534A])
    unlit_count = 0
    for material in gltf["materials"]:
        if material["name"] == "Glass Clear":
            continue
        texture = material.pop("emissiveTexture")
        if texture.get("texCoord", 0) != 1:
            raise ValueError(f"{material['name']}: baked atlas must use TEXCOORD_1")
        material["pbrMetallicRoughness"] = {
            "baseColorFactor": [1, 1, 1, 1],
            "baseColorTexture": texture,
            "metallicFactor": 0,
            "roughnessFactor": 1,
        }
        material.pop("emissiveFactor", None)
        material.setdefault("extensions", {})["KHR_materials_unlit"] = {}
        unlit_count += 1
    if unlit_count != 14:
        raise ValueError(f"Expected fourteen Office atlases, found {unlit_count}")
    extensions = gltf.setdefault("extensionsUsed", [])
    if "KHR_materials_unlit" not in extensions:
        extensions.append("KHR_materials_unlit")
    gltf["asset"].setdefault("extras", {}).update(provenance)
    document = json.dumps(gltf, separators=(",", ":")).encode()
    document += b" " * (-len(document) % 4)
    binary = chunks[0x004E4942]
    binary += b"\0" * (-len(binary) % 4)
    path.write_bytes(
        struct.pack("<III", 0x46546C67, 2, 28 + len(document) + len(binary))
        + struct.pack("<II", len(document), 0x4E4F534A) + document
        + struct.pack("<II", len(binary), 0x004E4942) + binary
    )
    return sum(gltf["accessors"][primitive["indices"]]["count"] // 3
               for mesh in gltf["meshes"] for primitive in mesh["primitives"])


def convert(source, output, archive=None, texture_size=2048):
    import bpy

    source = source.resolve()
    output = output.resolve()
    fbx = source / "source" / "1.fbx"
    if not fbx.is_file():
        raise FileNotFoundError(f"Missing Office source: {fbx}")
    if archive is not None and not archive.is_file():
        raise FileNotFoundError(f"Missing original archive: {archive}")
    textures = {}
    for number in range(1, 15):
        stem = f"part{number}"
        candidates = [p for p in (source / "textures").iterdir()
                      if p.stem.lower() == stem and p.suffix.lower() in (".jpg", ".jpeg", ".png")]
        if len(candidates) != 1:
            raise ValueError(f"Expected one source atlas for {stem}, found {len(candidates)}")
        textures[stem] = candidates[0]
    output.parent.mkdir(parents=True, exist_ok=True)

    provenance = {
        "sourceArchive": archive.name if archive else "cs-office-with-real-light.zip",
        "sourceRelease": SOURCE_RELEASE,
        "sourceFBXSha256": sha256(fbx),
        "sourceTextures": {name: {"file": path.name, "sha256": sha256(path)}
                           for name, path in textures.items()},
        "conversion": (
            "Blender FBX import preserves source units (.0254 metres per inch). "
            "Y-up GLB preserves fifteen meshes and both UV channels; baked atlases "
            f"use TEXCOORD_1 and are resized to at most {texture_size}px PNGs."
        ),
    }
    if archive:
        provenance["sourceArchiveSha256"] = sha256(archive)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=str(fbx))
    mesh_objects = [obj for obj in bpy.data.objects if obj.type == "MESH"]
    if len(mesh_objects) != 15:
        raise ValueError(f"Expected fifteen Office meshes, found {len(mesh_objects)}")
    for obj in mesh_objects:
        if obj.name != "glass" and "UVChannel_2" not in obj.data.uv_layers:
            raise ValueError(f"{obj.name}: missing packed atlas UV channel")

    with tempfile.TemporaryDirectory(prefix="office-atlases-") as temporary:
        for material in bpy.data.materials:
            material.use_nodes = True
            nodes = material.node_tree.nodes
            links = material.node_tree.links
            nodes.clear()
            target = nodes.new("ShaderNodeOutputMaterial")
            if material.name == "Glass Clear":
                shader = nodes.new("ShaderNodeBsdfPrincipled")
                shader.inputs["Base Color"].default_value = (.62, .72, .79, 1)
                shader.inputs["Alpha"].default_value = .22
                shader.inputs["Roughness"].default_value = .15
                material.diffuse_color = (.62, .72, .79, .22)
                material.surface_render_method = "DITHERED"
                material.use_backface_culling = False
                links.new(shader.outputs["BSDF"], target.inputs["Surface"])
                continue
            if material.name not in textures:
                raise ValueError(f"Unexpected Office material: {material.name}")
            image = bpy.data.images.load(str(textures[material.name]))
            width, height = image.size
            factor = min(1.0, texture_size / max(width, height))
            if factor < 1:
                image.scale(max(1, round(width * factor)), max(1, round(height * factor)))
            image.filepath_raw = str(Path(temporary) / f"{material.name}.png")
            image.file_format = "PNG"
            image.save()
            shader = nodes.new("ShaderNodeEmission")
            shader.inputs["Strength"].default_value = 1
            uv = nodes.new("ShaderNodeUVMap")
            uv.uv_map = "UVChannel_2"
            texture = nodes.new("ShaderNodeTexImage")
            texture.image = image
            links.new(uv.outputs["UV"], texture.inputs["Vector"])
            links.new(texture.outputs["Color"], shader.inputs["Color"])
            links.new(shader.outputs["Emission"], target.inputs["Surface"])
            material.use_backface_culling = True
        bpy.ops.export_scene.gltf(
            filepath=str(output), export_format="GLB", export_yup=True,
            export_apply=False, export_extras=True, export_image_format="AUTO",
        )

    triangles = finish_glb(output, provenance)
    print(f"Office: {triangles} triangles, fourteen unlit atlases and transparent glass")
    print(f"Wrote {output} ({output.stat().st_size} bytes; SHA-256 {sha256(output)})")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("source", type=Path, help="Extracted archive directory containing source/ and textures/")
    parser.add_argument("output", type=Path, help="Intermediate .glb output path")
    parser.add_argument("--archive", type=Path, help="Original ZIP, when available, to record its SHA-256")
    parser.add_argument("--texture-size", type=int, default=2048, help="Maximum atlas dimension (default: 2048)")
    arguments = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    args = parser.parse_args(arguments)
    if not 256 <= args.texture_size <= 8192:
        parser.error("--texture-size must be between 256 and 8192")
    if args.output.suffix.lower() != ".glb":
        parser.error("output must end with .glb")
    convert(args.source, args.output, args.archive, args.texture_size)


if __name__ == "__main__":
    main()
