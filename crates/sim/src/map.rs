//! Authored tactical maps shared by the native server and WebAssembly client.
use crate::V3;
use std::sync::OnceLock;

pub const CELL: f32 = 2.0;

/// Stable IDs shared by native collision, client prediction and the wire protocol.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[repr(u32)]
pub enum MapId {
    #[default]
    Sirocco = 0,
    Dockyard = 1,
    Norheim = 2,
    Meridian = 3,
    NordDatacenter = 4,
    Dust2 = 5,
    Compound = 6,
    Province = 7,
    Italy = 8,
    Assault = 9,
    Office = 10,
}

impl MapId {
    pub const ALL: [Self; 11] = [
        Self::Sirocco, Self::Dockyard, Self::Norheim, Self::Meridian,
        Self::NordDatacenter, Self::Dust2, Self::Compound, Self::Province,
        Self::Italy, Self::Assault, Self::Office,
    ];

    pub const fn index(self) -> u32 { self as u32 }

    pub fn from_index(index: u32) -> Option<Self> {
        Self::ALL.get(index as usize).copied()
    }

    pub fn from_id(id: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|map| map.id() == id)
    }

    pub const fn id(self) -> &'static str {
        match self {
            Self::Sirocco => "sirocco", Self::Dockyard => "dockyard",
            Self::Norheim => "norheim", Self::Meridian => "meridian",
            Self::NordDatacenter => "nord_datacenter",
            Self::Dust2 => "dust2",
            Self::Compound => "compound", Self::Province => "province",
            Self::Italy => "italy", Self::Assault => "assault", Self::Office => "office",
        }
    }

    pub const fn name(self) -> &'static str {
        match self {
            Self::Sirocco => "Sirocco", Self::Dockyard => "Dockyard",
            Self::Norheim => "Norheim", Self::Meridian => "Meridian",
            Self::NordDatacenter => "NORD Datacenter",
            Self::Dust2 => "Dust2",
            Self::Compound => "Compound", Self::Province => "Province",
            Self::Italy => "Italy", Self::Assault => "Assault", Self::Office => "Office",
        }
    }

    pub const fn theme(self) -> &'static str {
        match self {
            Self::Sirocco => "desert", Self::Dockyard => "industrial",
            Self::Norheim => "office", Self::Meridian => "ship",
            Self::NordDatacenter => "datacenter",
            Self::Dust2 => "dust2",
            Self::Compound => "compound", Self::Province => "province",
            Self::Italy => "italy", Self::Assault => "assault", Self::Office => "cs_office",
        }
    }

    pub const fn description(self) -> &'static str {
        match self {
            Self::Sirocco => "Sandstone courtyards, market tunnels and wide desert avenues.",
            Self::Dockyard => "The original container yard, with sheltered spawns and industrial lanes.",
            Self::Norheim => "A night shift through offices, meeting rooms and service corridors.",
            Self::Meridian => "A cargo ship with open deck routes, cargo stacks and a central superstructure.",
            Self::NordDatacenter => "Server halls, cooling equipment and service routes adapted from the NORD datacenter model.",
            Self::Dust2 => "Classic desert streets, double doors and tunnels, with the original textured layout and elevation changes.",
            Self::Compound => "An industrial compound with warehouse routes and open yards, imported from the supplied map model.",
            Self::Province => "Winding streets and enclosed courtyards through the original Province map.",
            Self::Italy => "Narrow Italian streets, market routes and interiors, preserving the supplied map's textures and lighting.",
            Self::Assault => "A warehouse assault through industrial streets and indoor routes, using the original textured map.",
            Self::Office => "Office corridors, meeting rooms and exterior approaches from the supplied classic map model.",
        }
    }
}

// Keep the original public layout available to existing tools.
pub use crate::maps::sirocco::ROWS;

#[derive(Clone, Copy, Debug)]
pub struct Aabb {
    pub min: V3,
    pub max: V3,
    /// 0 sandy ground, 1 plaster/stone wall, 2 timber gate, 3 crate, 4 stone barrier
    pub mat: u8,
    /// colour variant
    pub var: u8,
}

/// Axis-aligned ground zone (x/z).
#[derive(Clone, Copy, Debug)]
pub struct Zone {
    pub min: [f32; 2],
    pub max: [f32; 2],
}

impl Zone {
    pub fn contains(&self, x: f32, z: f32) -> bool {
        x >= self.min[0] && x <= self.max[0] && z >= self.min[1] && z <= self.max[1]
    }
    pub fn center(&self) -> [f32; 2] {
        [(self.min[0] + self.max[0]) * 0.5, (self.min[1] + self.max[1]) * 0.5]
    }
}

pub struct Map {
    pub id: MapId,
    pub boxes: Vec<Aabb>,
    /// Imported surface geometry, shared by server collision and prediction.
    pub mesh: Option<crate::mesh::CollisionMesh>,
    pub w: usize,
    pub h: usize,
    /// Site A, site B.
    pub sites: [Zone; 2],
    /// Spawn points (x, z): attackers, defenders.
    pub spawns: [Vec<[f32; 2]>; 2],
    /// Team, then left/right courtyard exit. Used to face newly spawned players.
    spawn_exits: [[[f32; 2]; 2]; 2],
    spawn_heights: [f32; 2],
    site_heights: [f32; 2],
}

pub fn standard_tile(ch: u8) -> Option<(f32, u8)> {
    match ch {
        b'#' => Some((7.0, 1)),
        b'H' => Some((9.5, 1)),
        b'D' => Some((3.4, 2)),
        b'c' => Some((1.0, 3)),
        b'k' => Some((1.6, 3)),
        b'=' => Some((1.0, 4)),
        _ => None,
    }
}

impl Map {
    /// The original default map remains Sirocco for legacy callers.
    pub fn build() -> Map { crate::maps::sirocco::build() }

    /// Build a flat tactical map from 2 m ASCII tiles. Solid tiles merge into
    /// collision boxes; A/B mark bomb sites and 1/2 mark team spawn centers.
    pub fn from_rows(
        id: MapId,
        rows: &[&str],
        tile_style: fn(u8) -> Option<(f32, u8)>,
        extras: &[Aabb],
        spawn_exits: [[[f32; 2]; 2]; 2],
    ) -> Map {
        assert!(!rows.is_empty(), "map needs at least one row");
        let h = rows.len();
        let w = rows[0].len();
        assert!(w > 0, "map needs at least one column");
        let grid: Vec<&[u8]> = rows.iter().map(|r| r.as_bytes()).collect();
        for r in &grid {
            assert_eq!(r.len(), w, "map rows must have equal width");
        }
        let wx = |c: usize| (c as f32 - w as f32 * 0.5) * CELL;
        let wz = |r: usize| (r as f32 - h as f32 * 0.5) * CELL;

        let mut boxes = vec![Aabb {
            min: [wx(0), -2.0, wz(0)],
            max: [wx(w), 0.0, wz(h)],
            mat: 0,
            var: 0,
        }];

        // Greedy rectangle merge of identical solid tiles.
        let mut used = vec![vec![false; w]; h];
        for r in 0..h {
            for c in 0..w {
                let ch = grid[r][c];
                let Some((height, mat)) = tile_style(ch) else { continue };
                if used[r][c] {
                    continue;
                }
                let mut c2 = c;
                while c2 + 1 < w && grid[r][c2 + 1] == ch && !used[r][c2 + 1] {
                    c2 += 1;
                }
                let mut r2 = r;
                'grow: while r2 + 1 < h {
                    for cc in c..=c2 {
                        if grid[r2 + 1][cc] != ch || used[r2 + 1][cc] {
                            break 'grow;
                        }
                    }
                    r2 += 1;
                }
                for row in used.iter_mut().take(r2 + 1).skip(r) {
                    for cell in row.iter_mut().take(c2 + 1).skip(c) {
                        *cell = true;
                    }
                }
                boxes.push(Aabb {
                    min: [wx(c), 0.0, wz(r)],
                    max: [wx(c2 + 1), height, wz(r2 + 1)],
                    mat,
                    var: ((r * 7 + c * 13) % 6) as u8,
                });
            }
        }

        boxes.extend_from_slice(extras);

        let zone = |target: u8| {
            let mut z = Zone { min: [f32::MAX; 2], max: [f32::MIN; 2] };
            for r in 0..h {
                for c in 0..w {
                    if grid[r][c] == target {
                        z.min[0] = z.min[0].min(wx(c));
                        z.min[1] = z.min[1].min(wz(r));
                        z.max[0] = z.max[0].max(wx(c + 1));
                        z.max[1] = z.max[1].max(wz(r + 1));
                    }
                }
            }
            assert!(z.min[0].is_finite() && z.min[0] <= z.max[0], "map needs both bomb sites");
            z
        };
        let spawns = |target: u8| {
            let mut v = Vec::new();
            for r in 0..h {
                for c in 0..w {
                    if grid[r][c] == target {
                        v.push([wx(c) + CELL * 0.5, wz(r) + CELL * 0.5]);
                    }
                }
            }
            assert!(!v.is_empty(), "map needs spawn points for both teams");
            v
        };

        Map {
            id,
            spawn_exits,
            spawn_heights: [0.0; 2],
            site_heights: [0.0; 2],
            mesh: None,
            boxes,
            w,
            h,
            sites: [zone(b'A'), zone(b'B')],
            spawns: [spawns(b'1'), spawns(b'2')],
        }
    }

    /// Imported maps retain their authored floor surfaces instead of flattening
    /// ramps, stairs and tunnels into tile columns.
    pub fn from_mesh(
        id: MapId, mesh: crate::mesh::CollisionMesh, extent: [usize; 2],
        sites: [Zone; 2], site_heights: [f32; 2],
        spawns: [Vec<[f32; 2]>; 2], spawn_heights: [f32; 2],
        spawn_exits: [[[f32; 2]; 2]; 2],
    ) -> Map {
        Map { id, boxes: Vec::new(), mesh: Some(mesh), w: extent[0], h: extent[1],
              sites, site_heights, spawns, spawn_heights, spawn_exits }
    }

    pub fn spawn_position(&self, team: usize, slot: usize) -> V3 {
        let [x, z] = self.spawns[team][slot % self.spawns[team].len()];
        let y = self.surface_height(x, z, self.spawn_heights[team]).unwrap_or(self.spawn_heights[team]);
        [x, y + 0.01, z]
    }

    pub fn site_height(&self, index: usize) -> f32 { self.site_heights[index] }

    /// Highest nearby floor, with limited upward reach to avoid selecting a
    /// tunnel roof when the caller is on the level below it.
    pub fn surface_height(&self, x: f32, z: f32, near_y: f32) -> Option<f32> {
        if let Some(mesh) = &self.mesh {
            mesh.floor_height(x, z, near_y, 0.5, 6.0)
        } else {
            self.boxes.iter().filter(|b| x >= b.min[0] && x <= b.max[0]
                && z >= b.min[2] && z <= b.max[2] && b.max[1] <= near_y + 0.5
                && b.max[1] >= near_y - 6.0)
                .map(|b| b.max[1]).max_by(f32::total_cmp)
        }
    }

    /// Which site (0 = A, 1 = B) contains the point, if any.
    pub fn site_at(&self, x: f32, z: f32) -> Option<usize> {
        self.sites.iter().position(|s| s.contains(x, z))
    }

    /// Face the nearest broad courtyard exit instead of the protective front
    /// building. Team indices match `spawns`: 0 attackers, 1 defenders.
    pub fn spawn_yaw(&self, team: usize, position: [f32; 2]) -> f32 {
        let side = usize::from(position[0] >= 0.0);
        let target = self.spawn_exits[team][side];
        (position[0] - target[0]).atan2(position[1] - target[1])
    }
}

pub fn map_by_id(id: MapId) -> &'static Map {
    static SIROCCO: OnceLock<Map> = OnceLock::new();
    static DOCKYARD: OnceLock<Map> = OnceLock::new();
    static NORHEIM: OnceLock<Map> = OnceLock::new();
    static MERIDIAN: OnceLock<Map> = OnceLock::new();
    static NORD_DATACENTER: OnceLock<Map> = OnceLock::new();
    static DUST2: OnceLock<Map> = OnceLock::new();
    static COMPOUND: OnceLock<Map> = OnceLock::new();
    static PROVINCE: OnceLock<Map> = OnceLock::new();
    static ITALY: OnceLock<Map> = OnceLock::new();
    static ASSAULT: OnceLock<Map> = OnceLock::new();
    static OFFICE: OnceLock<Map> = OnceLock::new();
    match id {
        MapId::Sirocco => SIROCCO.get_or_init(crate::maps::sirocco::build),
        MapId::Dockyard => DOCKYARD.get_or_init(crate::maps::dockyard::build),
        MapId::Norheim => NORHEIM.get_or_init(crate::maps::norheim::build),
        MapId::Meridian => MERIDIAN.get_or_init(crate::maps::meridian::build),
        MapId::NordDatacenter => NORD_DATACENTER.get_or_init(crate::maps::nord_datacenter::build),
        MapId::Dust2 => DUST2.get_or_init(crate::maps::dust2::build),
        MapId::Compound => COMPOUND.get_or_init(|| crate::maps::imported::build(id)),
        MapId::Province => PROVINCE.get_or_init(|| crate::maps::imported::build(id)),
        MapId::Italy => ITALY.get_or_init(|| crate::maps::imported::build(id)),
        MapId::Assault => ASSAULT.get_or_init(|| crate::maps::imported::build(id)),
        MapId::Office => OFFICE.get_or_init(|| crate::maps::imported::build(id)),
    }
}

pub fn map() -> &'static Map { map_by_id(MapId::Sirocco) }

#[cfg(test)]
mod tests {
    use super::*;
    use crate::physics::{collides, view_dir, H_STAND};
    use std::collections::VecDeque;

    #[test]
    fn flat_maps_have_one_connected_playable_floor() {
        for id in MapId::ALL {
            // Layered imported maps also contain inaccessible rooftops and
            // outside faces. Their playable routes are checked by the server's
            // layered navigation tests, using actual player movement.
            if map_by_id(id).mesh.is_some() { continue; }
            println!("checking walkable routes on {}", id.id());
            check_walkable_routes(map_by_id(id));
        }
    }

    #[test]
    fn imported_map_spawns_and_objectives_have_clear_supported_floors() {
        for id in MapId::ALL {
            let m = map_by_id(id);
            let Some(mesh) = &m.mesh else { continue; };
            for team in 0..2 {
                assert!(m.spawns[team].len() >= 5 && m.spawns[team].len() % 5 != 0);
                for slot in 0..m.spawns[team].len() {
                    let p = m.spawn_position(team, slot);
                    assert!(!collides(m, &p, H_STAND), "obstructed spawn {p:?}");
                    assert!(mesh.floor_height(p[0], p[2], p[1], 0.0, 0.03).is_some(), "unsupported spawn {p:?}");
                }
            }
            for (index, site) in m.sites.iter().enumerate() {
                let c = site.center();
                let p = [c[0], m.site_height(index) + 0.01, c[1]];
                assert!(!collides(m, &p, H_STAND), "obstructed objective {p:?}");
                assert!(mesh.floor_height(p[0], p[2], p[1], 0.0, 0.03).is_some(), "unsupported objective {p:?}");
            }
        }
    }

    fn check_walkable_routes(m: &Map) {
        let (w, h) = (m.w * 2, m.h * 2);
        let at = |c: usize, r: usize| [c as f32 + 0.5 - m.w as f32, 0.01, r as f32 + 0.5 - m.h as f32];
        let cell = |p: [f32; 2]| ((p[0] + m.w as f32).floor() as usize, (p[1] + m.h as f32).floor() as usize);
        let walk: Vec<_> = (0..h).flat_map(|r| (0..w).map(move |c| (c, r)))
            .map(|(c, r)| !collides(&m, &at(c, r), H_STAND)).collect();
        let mut seen = vec![false; w * h];
        let start = cell(m.spawns[0][0]);
        let mut queue = VecDeque::from([start]);
        seen[start.1 * w + start.0] = true;
        while let Some((c, r)) = queue.pop_front() {
            for (nc, nr) in [(c.wrapping_sub(1), r), (c + 1, r), (c, r.wrapping_sub(1)), (c, r + 1)] {
                if nc < w && nr < h && walk[nr * w + nc] && !seen[nr * w + nc] {
                    seen[nr * w + nc] = true;
                    queue.push_back((nc, nr));
                }
            }
        }
        for team in &m.spawns {
            assert!(team.len() >= 5);
            assert_ne!(team.len() % 5, 0, "spawn count must be coprime to the server's five-slot stride");
            for &spawn in team {
                let (c, r) = cell(spawn);
                assert!(walk[r * w + c] && seen[r * w + c], "unreachable spawn: {spawn:?}");
            }
        }
        for site in &m.sites {
            let center = site.center();
            assert!(!collides(&m, &[center[0], 0.01, center[1]], H_STAND), "objective centre overlaps cover");
            let (c, r) = cell(center);
            assert!(walk[r * w + c] && seen[r * w + c], "unreachable objective centre");
        }
        assert!(walk.iter().zip(&seen).all(|(&walkable, &visited)| !walkable || visited), "isolated walkable pocket");
    }

    #[test]
    fn map_ids_are_stable_and_invalid_ids_do_not_fall_back() {
        assert_eq!(MapId::ALL.map(|id| (id.index(), id.id())), [
            (0, "sirocco"), (1, "dockyard"), (2, "norheim"), (3, "meridian"), (4, "nord_datacenter"),
            (5, "dust2"), (6, "compound"), (7, "province"), (8, "italy"),
            (9, "assault"), (10, "office"),
        ], "wire and WASM indices are an append-only contract");
        for id in MapId::ALL {
            assert_eq!(MapId::from_index(id.index()), Some(id));
            assert_eq!(MapId::from_id(id.id()), Some(id));
            assert_eq!(map_by_id(id).id, id);
        }
        assert_eq!(MapId::from_index(MapId::ALL.len() as u32), None);
        assert_eq!(MapId::from_index(u32::MAX), None);
        assert_eq!(MapId::from_id("Sirocco"), None);
        assert_eq!(MapId::from_id("missing"), None);
        assert!(std::ptr::eq(map(), map_by_id(MapId::Sirocco)));
        assert_eq!(Map::build().id, MapId::Sirocco);
    }

    #[test]
    fn tunnel_and_both_gateways_have_standing_clearance() {
        let m = Map::build();
        for (x, z) in [(-34.0, -15.0), (-34.0, 8.0), (-1.0, -4.0), (35.0, 12.0)] {
            assert!(!collides(&m, &[x, 0.01, z], H_STAND), "blocked passage at {x},{z}");
            assert!(m.boxes.iter().any(|b| b.min[1] > H_STAND && x >= b.min[0] && x <= b.max[0] && z >= b.min[2] && z <= b.max[2]), "passage lacks a physical ceiling");
        }
    }

    #[test]
    fn spawn_facing_offers_clear_room_to_move() {
        for id in MapId::ALL {
            println!("checking spawn-facing clearance on {}", id.id());
            check_spawn_facing(map_by_id(id));
        }
    }

    fn check_spawn_facing(m: &Map) {
        // Existing outdoor spawn courtyards retain their 12m guarantee. The
        // imported interiors keep their source dimensions and nearby corridor
        // turn; its connectivity is checked separately by actual bot routes.
        let clearance = match m.id {
            MapId::Compound => 5.0, MapId::Province => 7.0,
            MapId::Italy | MapId::Assault => 4.0, _ => 12.0,
        };
        for (team, spawns) in m.spawns.iter().enumerate() {
            for (slot, &spawn) in spawns.iter().enumerate() {
                let direction = view_dir(m.spawn_yaw(team, spawn), 0.0);
                let mut y = m.spawn_position(team, slot)[1];
                for step in 1..=(clearance / 0.5) as usize {
                    let distance = step as f32 * 0.5;
                    let x = spawn[0] + direction[0] * distance;
                    let z = spawn[1] + direction[2] * distance;
                    y = if let Some(mesh) = &m.mesh {
                        mesh.standing_height(x, z, y, 0.5, 0.6, crate::physics::HALF_W, H_STAND)
                    } else {
                        m.surface_height(x, z, y)
                    }.expect("spawn faces a drop") + 0.01;
                    let position = [x, y, z];
                    assert!(!collides(&m, &position, H_STAND), "spawn {spawn:?} faces nearby obstruction at {position:?}");
                }
            }
        }
    }
}
