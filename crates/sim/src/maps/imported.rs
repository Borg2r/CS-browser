//! Shared collision-map construction for the five uploaded classic maps.
//! Rendering and these collision triangles use the same baked metre coordinates.
use crate::map::{Map, MapId, Zone};
use crate::mesh::CollisionMesh;
use super::imported_layouts;

/// Gameplay anchors selected on connected, supported floors of each source map.
/// Slices allow the original maps to use as many safe spawn slots as they need.
pub struct ImportedLayout {
    pub extent: [usize; 2],
    pub sites: [Zone; 2],
    pub site_heights: [f32; 2],
    pub spawns: [&'static [[f32; 2]]; 2],
    pub spawn_heights: [f32; 2],
    pub spawn_exits: [[[f32; 2]; 2]; 2],
}

pub fn build(id: MapId) -> Map {
    let (layout, collision): (&ImportedLayout, &[u8]) = match id {
        MapId::Compound => (&imported_layouts::COMPOUND, include_bytes!("compound_collision.bin")),
        MapId::Province => (&imported_layouts::PROVINCE, include_bytes!("province_collision.bin")),
        MapId::Italy => (&imported_layouts::ITALY, include_bytes!("italy_collision.bin")),
        MapId::Assault => (&imported_layouts::ASSAULT, include_bytes!("assault_collision.bin")),
        MapId::Office => (&imported_layouts::OFFICE, include_bytes!("office_collision.bin")),
        _ => unreachable!("map is not one of the imported classic maps"),
    };
    Map::from_mesh(
        id, CollisionMesh::from_bytes(collision), layout.extent,
        layout.sites, layout.site_heights,
        layout.spawns.map(|points| points.to_vec()),
        layout.spawn_heights, layout.spawn_exits,
    )
}
