//! "Dockyard" - an original container-terminal map, authored as a tile grid.
use crate::V3;
use std::sync::OnceLock;

pub const CELL: f32 = 2.0;

/// Legend: `#` wall, `C` container, `D` stacked containers, `c` low crate,
/// `k` tall crate, `=` concrete barrier, `A`/`B` objective sites,
/// `1` attacker spawn, `2` defender spawn, `.` open ground.
pub const ROWS: [&str; 37] = [
    "########################################",
    "#BBBBBBBB#.......2222.......#AAAAAAAAA.#",
    "#BBBBBBBB#.......2222.......#AAAAAAAAA.#",
    "#BBkBBBBB........2222........AAAkkAAAA.#",
    "#BBBBBcBB....=..........=....AAAAAAAAA.#",
    "#BBBBBBBB#..................#AAcAAAAAA.#",
    "#BBBcBBBB#..................#AAAAAAAkA.#",
    "#BBBBBBBB####...######...####AAAAAAAAA.#",
    "#........#..................#..........#",
    "#..CC....#..CCC........DDD..#....CC....#",
    "####..####..................#####..#####",
    "#........#.....=......=.....#..........#",
    "#........#..................#..........#",
    "#..k.....####..########..####......C...#",
    "#........#..................#......C...#",
    "#.....c..#..CCCC....CCCC....#..........#",
    "#........#.....................cc......#",
    "#........#.............................#",
    "####..####....DDDD..........#.....DD...#",
    "#........#..........CCCC....#.....DD...#",
    "#........#..................#..........#",
    "#...CC......................#..........#",
    "#...CC......................#...=......#",
    "#........#..................#..........#",
    "#........#####..######..#####......k...#",
    "#..c.....#..................#..........#",
    "#........#..................#..........#",
    "#........#......c....c......#..CC......#",
    "###..#####..................#####..#####",
    "#........#..................#..........#",
    "#...........................#..........#",
    "#..............................DD......#",
    "#........#.....1111111.................#",
    "#..CCC...#.....1111111......#..........#",
    "#........#.....1111111......#......c...#",
    "#........#..................#..........#",
    "########################################",
];

#[derive(Clone, Copy, Debug)]
pub struct Aabb {
    pub min: V3,
    pub max: V3,
    /// 0 ground, 1 wall, 2 container, 3 crate, 4 barrier
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
        b'C' => Some((2.6, 2)),
        b'D' => Some((5.2, 2)),
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
