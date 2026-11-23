//! Layered ground navigation generated from the shared movement collision.
//! A cell can contain several floors, so a tunnel and the walkway above it stay
//! separate until a real staircase or ramp connects them.
use sim::map::{Map, Zone};
use sim::physics::{collides, HALF_W, H_STAND};
use sim::V3;
use std::cmp::Ordering;
use std::collections::BinaryHeap;

pub struct Nav {
    pub w: i32,
    pub h: i32,
    ox: f32,
    oz: f32,
    cells: Vec<Vec<usize>>,
    points: Vec<V3>,
    edges: Vec<Vec<usize>>,
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
    fn partial_cmp(&self, o: &Self) -> Option<Ordering> { Some(self.cmp(o)) }
}

fn distance(a: V3, b: V3) -> f32 {
    ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2) + (a[2] - b[2]).powi(2)).sqrt()
}

impl Nav {
    pub fn build(map: &Map) -> Nav {
        let w = (map.w * 2) as i32;
        let h = (map.h * 2) as i32;
        let (ox, oz) = (-(map.w as f32), -(map.h as f32));
        let mut nav = Nav { w, h, ox, oz, cells: vec![Vec::new(); (w * h) as usize], points: Vec::new(), edges: Vec::new() };
        for r in 0..h {
            for c in 0..w {
                let (x, z) = (ox + c as f32 + 0.5, oz + r as f32 + 0.5);
                let floors = match &map.mesh {
                    Some(mesh) => mesh.floor_heights(x, z),
                    None => vec![0.0],
                };
                for y in floors {
                    let support = match &map.mesh {
                        Some(mesh) => match mesh.standing_height(x, z, y, 0.5, 0.1, HALF_W, H_STAND) {
                            Some(y) => y, None => continue,
                        },
                        None => y,
                    };
                    let p = [x, support + 0.02, z];
                    if !collides(map, &p, H_STAND) {
                        let id = nav.points.len();
                        nav.points.push(p);
                        nav.cells[(r * w + c) as usize].push(id);
                    }
                }
            }
        }
        nav.edges.resize(nav.points.len(), Vec::new());
        for cur in 0..nav.points.len() {
            let a = nav.points[cur];
            let (c, r) = nav.cell(a);
            for (dc, dr) in [(1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)] {
                let (nc, nr) = (c + dc, r + dr);
                if nc < 0 || nr < 0 || nc >= w || nr >= h { continue; }
                for &next in &nav.cells[(nr * w + nc) as usize] {
                    let b = nav.points[next];
                    // An edge may follow a ramp or several stair risers, but
                    // never teleport directly between stacked floors.
                    if (a[1] - b[1]).abs() <= 1.1 && nav.walk_clear(map, a, b) {
                        nav.edges[cur].push(next);
                    }
                }
            }
        }
        nav
    }

    fn cell(&self, p: V3) -> (i32, i32) {
        (((p[0] - self.ox).floor() as i32).clamp(0, self.w - 1),
         ((p[2] - self.oz).floor() as i32).clamp(0, self.h - 1))
    }

    fn nearest(&self, p: V3) -> Option<usize> {
        let (c, r) = self.cell(p);
        let mut best = None;
        let mut score = f32::MAX;
        for rad in 0..6i32 {
            for dr in -rad..=rad {
                for dc in -rad..=rad {
                    if dc.abs() != rad && dr.abs() != rad { continue; }
                    let (nc, nr) = (c + dc, r + dr);
                    if nc < 0 || nr < 0 || nc >= self.w || nr >= self.h { continue; }
                    for &id in &self.cells[(nr * self.w + nc) as usize] {
                        let q = self.points[id];
                        // Prefer the player's actual floor, never a roof above
                        // them merely because its cell centre is closer in XZ.
                        if (p[1] - q[1]).abs() > 1.2 { continue; }
                        let d = distance(p, q);
                        if d < score { score = d; best = Some(id); }
                    }
                }
            }
            if best.is_some() && rad as f32 > score { break; }
        }
        best
    }

    /// A* through connected floor surfaces. Every waypoint carries its height.
    pub fn path(&self, from: V3, to: V3) -> Vec<V3> {
        let (Some(start), Some(goal)) = (self.nearest(from), self.nearest(to)) else { return Vec::new(); };
        let mut cost = vec![f32::MAX; self.points.len()];
        let mut prev = vec![usize::MAX; self.points.len()];
        let mut heap = BinaryHeap::new();
        cost[start] = 0.0;
        heap.push(Node(distance(self.points[start], self.points[goal]), start));
        while let Some(Node(_, cur)) = heap.pop() {
            if cur == goal { break; }
            for &next in &self.edges[cur] {
                let nd = cost[cur] + distance(self.points[cur], self.points[next]);
                if nd < cost[next] {
                    cost[next] = nd;
                    prev[next] = cur;
                    heap.push(Node(nd + distance(self.points[next], self.points[goal]), next));
                }
            }
        }
        if prev[goal] == usize::MAX && goal != start { return Vec::new(); }
        let mut out = Vec::new();
        let mut cur = goal;
        while cur != usize::MAX {
            out.push(self.points[cur]);
            cur = prev[cur];
        }
        out.reverse();
        // The final destination is already chosen on the desired floor. Exact
        // bomb positions matter for interaction; ordinary goals are cell centres.
        if distance(*out.last().unwrap(), to) > 0.05 { out.push(to); }
        out
    }

    /// Follow continuous supporting floors; shortcuts cannot jump through a
    /// wall, across a drop, or from a tunnel to the surface directly above it.
    pub fn walk_clear(&self, map: &Map, a: V3, b: V3) -> bool {
        let (dx, dz) = (b[0] - a[0], b[2] - a[2]);
        let len = dx.hypot(dz);
        let steps = (len / 0.18).ceil().max(1.0) as i32;
        let mut y = a[1];
        for i in 1..=steps {
            let t = i as f32 / steps as f32;
            let (x, z) = (a[0] + dx * t, a[2] + dz * t);
            y = match &map.mesh {
                Some(mesh) => match mesh.standing_height(x, z, y, 0.50, 0.55, HALF_W, H_STAND) {
                    Some(floor) => floor + 0.02,
                    None => return false,
                },
                None => 0.02,
            };
            if collides(map, &[x, y, z], H_STAND) { return false; }
        }
        (y - b[1]).abs() < 0.35
    }

    /// Pick a clear point on the requested floor of an objective zone.
    pub fn point_in(&self, zone: &Zone, height: f32, mut rnd: impl FnMut() -> f32) -> V3 {
        for _ in 0..40 {
            let p = [zone.min[0] + (zone.max[0] - zone.min[0]) * rnd(), height,
                     zone.min[1] + (zone.max[1] - zone.min[1]) * rnd()];
            let (c, r) = self.cell(p);
            if let Some(&id) = self.cells[(r * self.w + c) as usize].iter()
                .filter(|&&id| (self.points[id][1] - height).abs() < 0.8
                    && zone.contains(self.points[id][0], self.points[id][2]))
                .min_by(|&&a, &&b| (self.points[a][1] - height).abs().total_cmp(&(self.points[b][1] - height).abs())) {
                return self.points[id];
            }
        }
        let c = zone.center();
        let p = [c[0], height + 0.02, c[1]];
        self.points.iter().copied()
            .filter(|q| (q[1] - height).abs() < 0.8 && zone.contains(q[0], q[2]))
            .min_by(|a, b| distance(*a, p).total_cmp(&distance(*b, p)))
            .unwrap_or(p)
    }

    pub fn point_near(&self, p: V3, radius: f32, rnd: impl FnMut() -> f32) -> V3 {
        let zone = Zone { min: [p[0] - radius, p[2] - radius], max: [p[0] + radius, p[2] + radius] };
        self.point_in(&zone, p[1], rnd)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sim::map::{map_by_id, MapId};

    #[test]
    fn imported_routes_are_walkable_by_the_actual_player_simulation() {
        use sim::physics::{step, PState, B_FWD};
        for id in MapId::ALL {
            let map = map_by_id(id);
            if map.mesh.is_none() { continue; }
            println!("checking actual player movement through {}", id.id());
            let nav = Nav::build(map);
            for team in 0..2 {
                for site in 0..2 {
                    let center = map.sites[site].center();
                    let target = [center[0], map.site_height(site) + 0.02, center[1]];
                    let mut st = PState { pos: map.spawn_position(team, 0), ..PState::default() };
                    let minimum_y = st.pos[1].min(target[1]) - 5.0;
                    let route = nav.path(st.pos, target);
                    assert!(!route.is_empty(), "{} has no route for team {team} to site {site}", id.id());
                    let mut waypoint = 0;
                    for _ in 0..180 * 60 {
                        while waypoint + 1 < route.len() && distance(st.pos, route[waypoint]) < 0.65 { waypoint += 1; }
                        for ahead in [6usize, 3] {
                            let next = (waypoint + ahead).min(route.len() - 1);
                            if nav.walk_clear(map, st.pos, route[next]) { waypoint = next; break; }
                        }
                        let next = route[waypoint];
                        let yaw = (st.pos[0] - next[0]).atan2(st.pos[2] - next[2]);
                        step(map, &mut st, B_FWD, yaw, 1.0 / 60.0, 5.0);
                        assert!(st.pos[1] > minimum_y,
                            "{} player fell below the playable route for team {team} to site {site} at {:?}", id.id(), st.pos);
                        if distance(st.pos, target) < 0.7 { break; }
                    }
                    assert!(distance(st.pos, target) < 0.7,
                        "{} team {team} cannot walk to site {site}: feet {:?}, next {:?}, target {target:?}", id.id(), st.pos, route[waypoint]);
                }
            }
        }
    }

    #[test]
    fn spawns_reach_both_sites() {
        for id in MapId::ALL {
            println!("checking bot routes on {}", id.id());
            let m = map_by_id(id);
            let nav = Nav::build(m);
            for (index, site) in m.sites.iter().enumerate() {
                for random in [0.0, 0.001, 0.5, 0.9999, 1.0] {
                    let p = nav.point_in(site, m.site_height(index), || random);
                    assert!(site.contains(p[0], p[2]), "{} goal {p:?} escaped site {index}", id.id());
                    assert!(!collides(m, &p, H_STAND));
                }
            }
            for team in 0..2 {
                for slot in 0..m.spawns[team].len() {
                    let spawn = m.spawn_position(team, slot);
                    for (index, site) in m.sites.iter().enumerate() {
                        let c = site.center();
                        let target = [c[0], m.site_height(index) + 0.02, c[1]];
                        let p = nav.path(spawn, target);
                        assert!(p.len() > 5, "{} no route from {spawn:?} to site {index}", id.id());
                        assert!(p.iter().all(|p| !collides(m, p, H_STAND)), "{} path crosses solid geometry", id.id());
                        assert!(p.windows(2).all(|pair| nav.walk_clear(m, pair[0], pair[1])), "{} path has disconnected levels", id.id());
                    }
                }
            }
        }
    }
}
