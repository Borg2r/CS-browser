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
}

impl MapId {
    pub const ALL: [Self; 4] = [Self::Sirocco, Self::Dockyard, Self::Norheim, Self::Meridian];

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
        }
    }

    pub const fn name(self) -> &'static str {
        match self {
            Self::Sirocco => "Sirocco", Self::Dockyard => "Dockyard",
            Self::Norheim => "Norheim", Self::Meridian => "Meridian",
        }
    }

    pub const fn theme(self) -> &'static str {
        match self {
            Self::Sirocco => "desert", Self::Dockyard => "industrial",
            Self::Norheim => "office", Self::Meridian => "ship",
        }
    }

    pub const fn description(self) -> &'static str {
        match self {
            Self::Sirocco => "Sandstone courtyards, market tunnels and wide desert avenues.",
            Self::Dockyard => "The original container yard, with sheltered spawns and industrial lanes.",
            Self::Norheim => "A night shift through offices, meeting rooms and service corridors.",
            Self::Meridian => "A cargo ship with open deck routes, cargo stacks and a central superstructure.",
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
    pub w: usize,
    pub h: usize,
    /// Site A, site B.
    pub sites: [Zone; 2],
    /// Spawn points (x, z): attackers, defenders.
    pub spawns: [Vec<[f32; 2]>; 2],
    /// Team, then left/right courtyard exit. Used to face newly spawned players.
    spawn_exits: [[[f32; 2]; 2]; 2],
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
            boxes,
            w,
            h,
            sites: [zone(b'A'), zone(b'B')],
            spawns: [spawns(b'1'), spawns(b'2')],
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
    match id {
        MapId::Sirocco => SIROCCO.get_or_init(crate::maps::sirocco::build),
        MapId::Dockyard => DOCKYARD.get_or_init(crate::maps::dockyard::build),
        MapId::Norheim => NORHEIM.get_or_init(crate::maps::norheim::build),
        MapId::Meridian => MERIDIAN.get_or_init(crate::maps::meridian::build),
    }
}

pub fn map() -> &'static Map { map_by_id(MapId::Sirocco) }

#[cfg(test)]
mod tests {
    use super::*;
    use crate::physics::{collides, view_dir, H_STAND};
    use std::collections::VecDeque;

    #[test]
    fn all_spawns_and_both_sites_share_walkable_routes() {
        for id in MapId::ALL {
            println!("checking walkable routes on {}", id.id());
            check_walkable_routes(map_by_id(id));
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
        for id in MapId::ALL {
            assert_eq!(MapId::from_index(id.index()), Some(id));
            assert_eq!(MapId::from_id(id.id()), Some(id));
            assert_eq!(map_by_id(id).id, id);
        }
        assert_eq!(MapId::from_index(4), None);
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
    fn spawn_facing_offers_twelve_metres_of_clear_courtyard() {
        for id in MapId::ALL {
            println!("checking spawn-facing clearance on {}", id.id());
            check_spawn_facing(map_by_id(id));
        }
    }

    fn check_spawn_facing(m: &Map) {
        for (team, spawns) in m.spawns.iter().enumerate() {
            for &spawn in spawns {
                let direction = view_dir(m.spawn_yaw(team, spawn), 0.0);
                for step in 1..=24 {
                    let distance = step as f32 * 0.5;
                    let position = [spawn[0] + direction[0] * distance, 0.01, spawn[1] + direction[2] * distance];
                    assert!(!collides(&m, &position, H_STAND), "spawn {spawn:?} faces nearby obstruction at {position:?}");
                }
            }
        }
    }
}
