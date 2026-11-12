//! "Sirocco" — an original sandstone-town tactical map authored as a tile grid.
use crate::V3;
use std::sync::OnceLock;

pub const CELL: f32 = 2.0;

/// Sirocco: a sun-bleached town with west market tunnels, offset middle
/// gates, an eastern long street, and a short arcade into the A courtyard.
/// `#`/`H` building blocks, `D` timber gate leaves, `c`/`k` supply crates,
/// `=` stone breastwork, `A`/`B` sites, `1`/`2` team spawns, `.` lanes.
/// Walk routes stay at ground level so native and WASM movement and the
/// bot navigation grid share exactly the same traversal rules.
pub const ROWS: [&str; 40] = [
    "##############################################",
    "######HHHHHH######..........##HHHHHH##########",
    "##BBBBBBBBBBBB####..222222..##HAAAAAAAAAAAAA##",
    "##BkkBBBBBBBBB####..222222..##HAAkkAAAAAAAAA##",
    "##BkkBBBBBBBBB####..........##HAAkkAAAAAAAAA##",
    "##BBBBBBBBB........................AAAAAAAAA##",
    "##BBBcBBBBB........................AAAAAAAAA##",
    "#HBBBBBBBBkk.......................AAAAAkkAA##",
    "#HBBBBBBBBkk....###........HHH#AAAAccA..kk..##",
    "#HB......BB.....###........HHH#AAAAAAA......##",
    "#HB......BB.....###................AAA......##",
    "#HH......##..............c.........###......##",
    "#HH......##........................###....=.##",
    "#HH......##........................###....=.##",
    "###......#####................########......H#",
    "###......#########H...........########......H#",
    "###......#########H.........=.########......H#",
    "###......#########HHD...D##.=.########..kk..H#",
    "###......#########HHD...D##.=.########..kk..H#",
    "###......#########H...........########......H#",
    "###......#########H...........########......H#",
    "###......###HHHHHH#...........######HH......##",
    "###........................#########HH......##",
    "###...........==...........#########HH......##",
    "###.................kk.....#########HH......##",
    "###.................kk.....#########HHD...D###",
    "###...........HHHH#........#########HHD...D###",
    "###...........HHHH#........#########HH......##",
    "###...........##.............#HHHHHH##......##",
    "###.cc......................................##",
    "###.........................c...............##",
    "###.........c...............................##",
    "######HHH...c...............................##",
    "######HHH.........11111111..................##",
    "######HHH.........11111111................####",
    "#HHHHH###.........11111111...H################",
    "#HHHHH##########.............H################",
    "#HHHHH##########.............H################",
    "#HHHHH##################HHHHHH################",
    "##############################################",
];

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
    pub boxes: Vec<Aabb>,
    pub w: usize,
    pub h: usize,
    /// Site A, site B.
    pub sites: [Zone; 2],
    /// Spawn points (x, z): attackers, defenders.
    pub spawns: [Vec<[f32; 2]>; 2],
}

fn solid(ch: u8) -> Option<(f32, u8)> {
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
    pub fn build() -> Map {
        let h = ROWS.len();
        let w = ROWS[0].len();
        let grid: Vec<&[u8]> = ROWS.iter().map(|r| r.as_bytes()).collect();
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
                let Some((height, mat)) = solid(ch) else { continue };
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

        // True collision roofs make the western route a sheltered tunnel.
        // Their undersides are above a standing/jumping player. Unlike ground
        // obstacles they must not block the server's navigation grid.
        for (min, max, var) in [
            ([-40.0, 3.6, -18.0], [-28.0, 4.3, 12.0], 1),
            ([-4.0, 4.2, -6.0], [2.0, 7.0, -2.0], 2),
            ([32.0, 4.2, 10.0], [38.0, 7.0, 14.0], 3),
        ] {
            boxes.push(Aabb { min, max, mat: 1, var });
        }

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
            v
        };

        Map {
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
}

pub fn map() -> &'static Map {
    static MAP: OnceLock<Map> = OnceLock::new();
    MAP.get_or_init(Map::build)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::physics::{collides, H_STAND};
    use std::collections::VecDeque;

    #[test]
    fn all_spawns_and_both_sites_share_walkable_routes() {
        let m = Map::build();
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
    fn tunnel_and_both_gateways_have_standing_clearance() {
        let m = Map::build();
        for (x, z) in [(-34.0, -15.0), (-34.0, 8.0), (-1.0, -4.0), (35.0, 12.0)] {
            assert!(!collides(&m, &[x, 0.01, z], H_STAND), "blocked passage at {x},{z}");
            assert!(m.boxes.iter().any(|b| b.min[1] > H_STAND && x >= b.min[0] && x <= b.max[0] && z >= b.min[2] && z <= b.max[2]), "passage lacks a physical ceiling");
        }
    }
}
