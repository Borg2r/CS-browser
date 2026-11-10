//! Ground navigation grid (1 m cells) generated from the map collision.
use sim::map::{Map, Zone};
use sim::physics::{collides, H_STAND};
use std::cmp::Ordering;
use std::collections::BinaryHeap;

pub struct Nav {
    pub w: i32,
    pub h: i32,
    ox: f32,
    oz: f32,
    walk: Vec<bool>,
}

#[derive(PartialEq)]
struct Node(f32, usize);
impl Eq for Node {}
impl Ord for Node {
    fn cmp(&self, o: &Self) -> Ordering {
        o.0.partial_cmp(&self.0).unwrap_or(Ordering::Equal)
    }
}
impl PartialOrd for Node {
    fn partial_cmp(&self, o: &Self) -> Option<Ordering> {
        Some(self.cmp(o))
    }
}

impl Nav {
    pub fn build(map: &Map) -> Nav {
        let w = (map.w * 2) as i32;
        let h = (map.h * 2) as i32;
        let (ox, oz) = (-(map.w as f32), -(map.h as f32));
        let mut walk = vec![false; (w * h) as usize];
        for r in 0..h {
            for c in 0..w {
                let p = [ox + c as f32 + 0.5, 0.01, oz + r as f32 + 0.5];
                walk[(r * w + c) as usize] = !collides(map, &p, H_STAND);
            }
        }
        Nav { w, h, ox, oz, walk }
    }

    fn cell(&self, p: [f32; 2]) -> (i32, i32) {
        (
            ((p[0] - self.ox).floor() as i32).clamp(0, self.w - 1),
            ((p[1] - self.oz).floor() as i32).clamp(0, self.h - 1),
        )
    }
    fn center(&self, c: i32, r: i32) -> [f32; 2] {
        [self.ox + c as f32 + 0.5, self.oz + r as f32 + 0.5]
    }
    fn ok(&self, c: i32, r: i32) -> bool {
        c >= 0 && r >= 0 && c < self.w && r < self.h && self.walk[(r * self.w + c) as usize]
    }
    fn nearest(&self, p: [f32; 2]) -> Option<(i32, i32)> {
        let (c, r) = self.cell(p);
        for rad in 0..6i32 {
            for dr in -rad..=rad {
                for dc in -rad..=rad {
                    if (dr.abs() == rad || dc.abs() == rad) && self.ok(c + dc, r + dr) {
                        return Some((c + dc, r + dr));
                    }
                }
            }
        }
        None
    }

    /// A* path of cell centres from `from` to `to` (ending exactly at `to`).
    pub fn path(&self, from: [f32; 2], to: [f32; 2]) -> Vec<[f32; 2]> {
        let (Some(s), Some(g)) = (self.nearest(from), self.nearest(to)) else {
            return Vec::new();
        };
        let idx = |c: i32, r: i32| (r * self.w + c) as usize;
        let n = (self.w * self.h) as usize;
        let mut cost = vec![f32::MAX; n];
        let mut prev = vec![usize::MAX; n];
        let mut heap = BinaryHeap::new();
        let hfn = |c: i32, r: i32| {
            let (dx, dz) = ((c - g.0).abs() as f32, (r - g.1).abs() as f32);
            dx.max(dz) + 0.414 * dx.min(dz)
        };
        cost[idx(s.0, s.1)] = 0.0;
        heap.push(Node(hfn(s.0, s.1), idx(s.0, s.1)));
        let goal = idx(g.0, g.1);
        while let Some(Node(_, cur)) = heap.pop() {
            if cur == goal {
                break;
            }
            let (c, r) = ((cur as i32) % self.w, (cur as i32) / self.w);
            for (dc, dr) in [(1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)] {
                let (nc, nr) = (c + dc, r + dr);
                if !self.ok(nc, nr) {
                    continue;
                }
                let diag = dc != 0 && dr != 0;
                if diag && !(self.ok(c + dc, r) && self.ok(c, r + dr)) {
                    continue;
                }
                let nd = cost[cur] + if diag { 1.414 } else { 1.0 };
                let ni = idx(nc, nr);
                if nd < cost[ni] {
                    cost[ni] = nd;
                    prev[ni] = cur;
                    heap.push(Node(nd + hfn(nc, nr), ni));
                }
            }
        }
        if prev[goal] == usize::MAX && goal != idx(s.0, s.1) {
            return Vec::new();
        }
        let mut out = vec![to];
        let mut cur = goal;
        while cur != usize::MAX {
            out.push(self.center((cur as i32) % self.w, (cur as i32) / self.w));
            cur = prev[cur];
        }
        out.reverse();
        out
    }

    /// Can a player walk in a straight line between two ground points?
    pub fn walk_clear(&self, map: &Map, a: [f32; 2], b: [f32; 2]) -> bool {
        let (dx, dz) = (b[0] - a[0], b[1] - a[1]);
        let len = (dx * dx + dz * dz).sqrt();
        let steps = (len / 0.3).ceil().max(1.0) as i32;
        (1..=steps).all(|i| {
            let t = i as f32 / steps as f32;
            !collides(map, &[a[0] + dx * t, 0.01, a[1] + dz * t], H_STAND)
        })
    }

    /// Random walkable point inside a zone (`u`, `v` are uniform randoms).
    pub fn point_in(&self, zone: &Zone, mut rnd: impl FnMut() -> f32) -> [f32; 2] {
        for _ in 0..40 {
            let p = [
                zone.min[0] + (zone.max[0] - zone.min[0]) * rnd(),
                zone.min[1] + (zone.max[1] - zone.min[1]) * rnd(),
            ];
            let (c, r) = self.cell(p);
            if self.ok(c, r) {
                return self.center(c, r);
            }
        }
        zone.center()
    }

    pub fn point_near(&self, p: [f32; 2], radius: f32, rnd: impl FnMut() -> f32) -> [f32; 2] {
        let zone = Zone { min: [p[0] - radius, p[1] - radius], max: [p[0] + radius, p[1] + radius] };
        self.point_in(&zone, rnd)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sim::map::map;

    #[test]
    fn spawns_reach_both_sites() {
        let m = map();
        let nav = Nav::build(m);
        for team in &m.spawns {
            for site in &m.sites {
                let p = nav.path(team[0], site.center());
                assert!(p.len() > 5, "no path from spawn to site");
            }
        }
    }
}
