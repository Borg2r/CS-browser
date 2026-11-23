//! Geometry imported from the user-supplied de_dust2 model by vrchris.
//! See client/assets/dust2/LICENSE.md for source and attribution.
use crate::map::{Map, MapId, Zone};
use crate::mesh::CollisionMesh;

pub fn build() -> Map {
    Map::from_mesh(
        MapId::Dust2,
        CollisionMesh::from_bytes(include_bytes!("dust2_collision.bin")),
        [65, 96],
        [Zone { min: [26.4, -62.4], max: [31.2, -58.4] },
         Zone { min: [-43.2, -70.4], max: [-36.8, -64.0] }],
        [2.4, 0.0],
        [vec![[-28.0, 20.0], [-25.5, 20.0], [-23.0, 20.0],
              [-28.0, 17.5], [-25.5, 17.5], [-23.0, 17.5]],
         vec![[-2.0, -54.0], [0.0, -54.0], [2.0, -54.0],
              [-2.0, -52.0], [0.0, -52.0], [2.0, -52.0]]],
        [3.2, -3.2],
        [[[-8.0, 20.0]; 2], [[-15.0, -53.5]; 2]],
    )
}
