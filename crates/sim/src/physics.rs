//! Player movement and collision against box and imported mesh worlds, plus rays.
//! Deterministic for a given (state, buttons, yaw, dt) so the client can
//! predict with the very same code the server is authoritative with.
use crate::map::Map;
use crate::V3;

pub const HALF_W: f32 = 0.4;
pub const H_STAND: f32 = 1.8;
pub const H_CROUCH: f32 = 1.2;
pub const EYE_STAND: f32 = 1.62;
pub const EYE_CROUCH: f32 = 1.05;

pub const B_FWD: u32 = 1;
pub const B_BACK: u32 = 2;
pub const B_LEFT: u32 = 4;
pub const B_RIGHT: u32 = 8;
pub const B_JUMP: u32 = 16;
pub const B_CROUCH: u32 = 32;
pub const B_WALK: u32 = 64;
pub const B_FIRE: u32 = 128;
pub const B_RELOAD: u32 = 256;
pub const B_USE: u32 = 512;
pub const B_FIRE2: u32 = 1024;
pub const B_MOVE_MASK: u32 = B_FWD | B_BACK | B_LEFT | B_RIGHT | B_JUMP | B_CROUCH;

const GRAVITY: f32 = 20.0;
const JUMP_V: f32 = 6.7;
const ACCEL: f32 = 5.5;
const AIR_ACCEL: f32 = 10.0;
const AIR_CAP: f32 = 0.76;
const FRICTION: f32 = 4.0;
const STOP_SPEED: f32 = 1.9;
const EPS: f32 = 0.001;

#[derive(Clone, Copy, Default, Debug)]
pub struct PState {
    /// Feet centre.
    pub pos: V3,
    pub vel: V3,
    pub ground: bool,
    pub crouch: bool,
    pub jump_held: bool,
}

impl PState {
    pub fn height(&self) -> f32 {
        if self.crouch { H_CROUCH } else { H_STAND }
    }
    pub fn eye(&self) -> V3 {
        let e = if self.crouch { EYE_CROUCH } else { EYE_STAND };
        [self.pos[0], self.pos[1] + e, self.pos[2]]
    }
    pub fn to_array(&self) -> [f32; 9] {
        let b = |v: bool| if v { 1.0 } else { 0.0 };
        [
            self.pos[0], self.pos[1], self.pos[2],
            self.vel[0], self.vel[1], self.vel[2],
            b(self.ground), b(self.crouch), b(self.jump_held),
        ]
    }
    pub fn from_array(a: &[f32; 9]) -> PState {
        PState {
            pos: [a[0], a[1], a[2]],
            vel: [a[3], a[4], a[5]],
            ground: a[6] > 0.5,
            crouch: a[7] > 0.5,
            jump_held: a[8] > 0.5,
        }
    }
}

fn overlaps(map: &Map, pos: &V3, h: f32, mut f: impl FnMut(&crate::map::Aabb)) {
    for b in &map.boxes {
        if pos[0] + HALF_W > b.min[0]
            && pos[0] - HALF_W < b.max[0]
            && pos[2] + HALF_W > b.min[2]
            && pos[2] - HALF_W < b.max[2]
            && pos[1] + h > b.min[1]
            && pos[1] < b.max[1]
        {
            f(b);
        }
    }
}

/// Would a player box of height `h` standing at `pos` intersect the world?
pub fn collides(map: &Map, pos: &V3, h: f32) -> bool {
    let mut hit = false;
    overlaps(map, pos, h, |_| hit = true);
    hit || map.mesh.as_ref().is_some_and(|mesh| mesh.overlaps_box(
        [pos[0] - HALF_W, pos[1], pos[2] - HALF_W],
        [pos[0] + HALF_W, pos[1] + h, pos[2] + HALF_W],
    ))
}

/// Continuous world collision for a feet-centered box. Also useful for small
/// moving objects: the same geometry stops grenades and players.
pub fn sweep_box(map: &Map, pos: V3, delta: V3, half_width: f32, height: f32) -> Option<crate::mesh::MeshHit> {
    let mut best = map.mesh.as_ref().and_then(|mesh| mesh.sweep_box(pos, delta, half_width, height));
    for b in &map.boxes {
        let min = [b.min[0]-half_width, b.min[1]-height, b.min[2]-half_width];
        let max = [b.max[0]+half_width, b.max[1], b.max[2]+half_width];
        if let Some((enter, _)) = ray_aabb_span(&pos, &delta, &min, &max) {
            if enter > 1.0 || best.is_some_and(|hit| enter >= hit.fraction) { continue; }
            // Resolve the entering face, ignoring an existing contact when the
            // requested motion is parallel to it or away from it.
            let mut normal = [0.0; 3];
            let mut entry = f32::NEG_INFINITY;
            for axis in 0..3 {
                if delta[axis].abs() < 1e-9 { continue; }
                let edge = if delta[axis] > 0.0 { min[axis] } else { max[axis] };
                let t = (edge-pos[axis])/delta[axis];
                if t > entry {
                    entry = t;
                    normal = [0.0; 3];
                    normal[axis] = -delta[axis].signum();
                }
            }
            if entry >= -1e-5 {
                best = Some(crate::mesh::MeshHit { fraction: enter, normal });
            }
        }
    }
    best
}

const STEP_HEIGHT: f32 = 0.5;

fn move_mesh_axis(map: &Map, pos: &mut V3, axis: usize, amount: f32, height: f32) -> Option<crate::mesh::MeshHit> {
    if amount.abs() < 1e-8 { return None; }
    let mut delta = [0.0; 3];
    delta[axis] = amount;
    let hit = sweep_box(map, *pos, delta, HALF_W, height);
    let fraction = hit.map_or(1.0, |h| (h.fraction - EPS/amount.abs()).max(0.0));
    pos[axis] += amount * fraction;
    hit
}

/// Mesh maps contain real elevations. Sweep continuously, try a short stair
/// step when grounded, and retain contact while descending stairs and ramps.
fn move_mesh(map: &Map, s: &mut PState, dt: f32, height: f32) {
    let grounded = s.ground && s.vel[1] <= 0.0;
    let start = s.pos;
    let dx = s.vel[0] * dt;
    let dz = s.vel[2] * dt;
    let blocked_x = move_mesh_axis(map, &mut s.pos, 0, dx, height).is_some();
    let blocked_z = move_mesh_axis(map, &mut s.pos, 2, dz, height).is_some();
    let mut stepped = false;
    if grounded && (blocked_x || blocked_z) {
        let mut candidate = start;
        move_mesh_axis(map, &mut candidate, 1, STEP_HEIGHT, height);
        let rise = candidate[1] - start[1];
        if rise > EPS {
            move_mesh_axis(map, &mut candidate, 0, dx, height);
            move_mesh_axis(map, &mut candidate, 2, dz, height);
            let floor = move_mesh_axis(map, &mut candidate, 1, -(rise + STEP_HEIGHT), height);
            let progress = |p: V3| (p[0]-start[0])*dx + (p[2]-start[2])*dz;
            if floor.is_some_and(|h| h.normal[1] >= 0.65)
                && candidate[1] <= start[1] + STEP_HEIGHT + EPS
                && progress(candidate) > progress(s.pos) + 1e-7
                && !collides(map, &candidate, height)
            {
                s.pos = candidate;
                s.vel[1] = 0.0;
                stepped = true;
            }
        }
    }
    if !stepped {
        if blocked_x { s.vel[0] = 0.0; }
        if blocked_z { s.vel[2] = 0.0; }
    }
    s.ground = stepped;
    let vertical = s.vel[1] * dt;
    if let Some(hit) = move_mesh_axis(map, &mut s.pos, 1, vertical, height) {
        s.vel[1] = 0.0;
        s.ground = vertical < 0.0 && hit.normal[1] >= 0.65;
    }
    if grounded && !s.ground && s.vel[1] <= 0.0 {
        let mut candidate = s.pos;
        if let Some(hit) = move_mesh_axis(map, &mut candidate, 1, -STEP_HEIGHT, height) {
            if hit.normal[1] >= 0.65 {
                s.pos = candidate;
                s.vel[1] = 0.0;
                s.ground = true;
            }
        }
    }
}

fn accelerate(vel: &mut V3, wx: f32, wz: f32, wish_speed: f32, cap: f32, accel: f32, dt: f32) {
    let cur = vel[0] * wx + vel[2] * wz;
    let add = wish_speed.min(cap) - cur;
    if add <= 0.0 {
        return;
    }
    let a = (accel * dt * wish_speed).min(add);
    vel[0] += wx * a;
    vel[2] += wz * a;
}

fn substep(map: &Map, s: &mut PState, buttons: u32, yaw: f32, dt: f32, max_speed: f32) {
    if buttons & B_CROUCH != 0 {
        s.crouch = true;
    } else if s.crouch && !collides(map, &s.pos, H_STAND) {
        s.crouch = false;
    }
    let h = s.height();

    let f = (buttons & B_FWD != 0) as i32 - (buttons & B_BACK != 0) as i32;
    let r = (buttons & B_RIGHT != 0) as i32 - (buttons & B_LEFT != 0) as i32;
    let (sin, cos) = yaw.sin_cos();
    let mut wx = -sin * f as f32 + cos * r as f32;
    let mut wz = -cos * f as f32 - sin * r as f32;
    let len = (wx * wx + wz * wz).sqrt();
    if len > 0.0 {
        wx /= len;
        wz /= len;
    }
    let mut speed = if len > 0.0 { max_speed } else { 0.0 };
    if s.crouch {
        speed *= 0.34;
    } else if buttons & B_WALK != 0 {
        speed *= 0.52;
    }

    let jump = buttons & B_JUMP != 0;
    if s.ground {
        let sp = (s.vel[0] * s.vel[0] + s.vel[2] * s.vel[2]).sqrt();
        if sp > 0.0 {
            let drop = sp.max(STOP_SPEED) * FRICTION * dt;
            let k = (sp - drop).max(0.0) / sp;
            s.vel[0] *= k;
            s.vel[2] *= k;
        }
        accelerate(&mut s.vel, wx, wz, speed, speed, ACCEL, dt);
        if jump && !s.jump_held {
            s.vel[1] = JUMP_V;
            s.ground = false;
        }
    } else {
        accelerate(&mut s.vel, wx, wz, speed, AIR_CAP, AIR_ACCEL, dt);
    }
    s.jump_held = jump;
    s.vel[1] = (s.vel[1] - GRAVITY * dt).max(-40.0);

    if map.mesh.is_some() {
        move_mesh(map, s, dt, h);
        return;
    }

    // Move and resolve one axis at a time (x, z, then y).
    for axis in [0usize, 2, 1] {
        let v = s.vel[axis];
        if v == 0.0 {
            continue;
        }
        s.pos[axis] += v * dt;
        let mut fix: Option<f32> = None;
        overlaps(map, &s.pos, h, |b| {
            let p = if v > 0.0 {
                b.min[axis] - if axis == 1 { h } else { HALF_W } - EPS
            } else {
                b.max[axis] + if axis == 1 { 0.0 } else { HALF_W } + EPS
            };
            fix = Some(match fix {
                Some(q) if v > 0.0 => q.min(p),
                Some(q) => q.max(p),
                None => p,
            });
        });
        if axis == 1 {
            s.ground = false;
        }
        if let Some(p) = fix {
            s.pos[axis] = p;
            s.vel[axis] = 0.0;
            if axis == 1 && v < 0.0 {
                s.ground = true;
            }
        } else if axis == 1 && v < 0.0 {
            // Resting within the contact skin still counts as standing.
            let probe = [s.pos[0], s.pos[1] - 4.0 * EPS, s.pos[2]];
            if collides(map, &probe, h) {
                s.ground = true;
                s.vel[1] = 0.0;
            }
        }
    }
}

/// Advance a player by `dt` seconds (internally sub-stepped).
pub fn step(map: &Map, s: &mut PState, buttons: u32, yaw: f32, dt: f32, max_speed: f32) {
    let t = dt.clamp(0.0, 0.1);
    if t < 1e-5 {
        return;
    }
    let n = (t * 64.0).ceil().max(1.0);
    for _ in 0..n as u32 {
        substep(map, s, buttons, yaw, t / n, max_speed);
    }
}

/// Ray vs box; returns entry distance (0 if the origin is inside).
pub fn ray_aabb(o: &V3, d: &V3, min: &V3, max: &V3) -> Option<f32> {
    ray_aabb_span(o, d, min, max).map(|s| s.0)
}

/// Ray vs box; returns (entry, exit) distances.
pub fn ray_aabb_span(o: &V3, d: &V3, min: &V3, max: &V3) -> Option<(f32, f32)> {
    let mut t0 = 0.0f32;
    let mut t1 = f32::MAX;
    for a in 0..3 {
        if d[a].abs() < 1e-8 {
            if o[a] < min[a] || o[a] > max[a] {
                return None;
            }
        } else {
            let inv = 1.0 / d[a];
            let (mut n, mut f) = ((min[a] - o[a]) * inv, (max[a] - o[a]) * inv);
            if n > f {
                std::mem::swap(&mut n, &mut f);
            }
            t0 = t0.max(n);
            t1 = t1.min(f);
            if t0 > t1 {
                return None;
            }
        }
    }
    Some((t0, t1))
}

/// First world surface along a ray: (distance, thickness of the box that was hit).
pub fn ray_world_hit(map: &Map, o: &V3, d: &V3, max_t: f32) -> (f32, Option<f32>) {
    let mut best = (max_t, None);
    for b in &map.boxes {
        if let Some((t0, t1)) = ray_aabb_span(o, d, &b.min, &b.max) {
            if t0 < best.0 {
                best = (t0, Some(t1 - t0));
            }
        }
    }
    if let Some(hit) = map.mesh.as_ref().and_then(|mesh| mesh.raycast(o, d, best.0)) {
        // BSP exports are visible surface shells, not closed brush solids. A
        // missing back face cannot establish a safe wall-penetration thickness.
        best = (hit.distance, Some(f32::INFINITY));
    }
    best
}

pub fn ray_sphere(o: &V3, d: &V3, c: &V3, r: f32) -> Option<f32> {
    let oc = [o[0] - c[0], o[1] - c[1], o[2] - c[2]];
    let b = oc[0] * d[0] + oc[1] * d[1] + oc[2] * d[2];
    let cc = oc[0] * oc[0] + oc[1] * oc[1] + oc[2] * oc[2] - r * r;
    let disc = b * b - cc;
    if disc < 0.0 {
        return None;
    }
    let t = -b - disc.sqrt();
    if t >= 0.0 {
        Some(t)
    } else if cc < 0.0 {
        Some(0.0)
    } else {
        None
    }
}

/// Distance along a normalised ray to the first world surface (or `max_t`).
pub fn ray_world(map: &Map, o: &V3, d: &V3, max_t: f32) -> f32 {
    let mut best = max_t;
    for b in &map.boxes {
        if let Some(t) = ray_aabb(o, d, &b.min, &b.max) {
            if t < best {
                best = t;
            }
        }
    }
    if let Some(hit) = map.mesh.as_ref().and_then(|mesh| mesh.raycast(o, d, best)) {
        best = hit.distance;
    }
    best
}

/// Unobstructed straight line between two points?
pub fn line_clear(map: &Map, a: &V3, b: &V3) -> bool {
    let d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    let len = (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt();
    if len < 1e-4 {
        return true;
    }
    let n = [d[0] / len, d[1] / len, d[2] / len];
    ray_world(map, a, &n, len) >= len
}

/// View direction for yaw/pitch (yaw 0 looks down -Z, positive pitch looks up).
pub fn view_dir(yaw: f32, pitch: f32) -> V3 {
    let (sy, cy) = yaw.sin_cos();
    let (sp, cp) = pitch.sin_cos();
    [-sy * cp, sp, -cy * cp]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::map::map;

    #[test]
    fn spawns_are_free_and_players_settle_on_ground() {
        let m = map();
        assert!(m.spawns[0].len() >= 5 && m.spawns[1].len() >= 5);
        for team in &m.spawns {
            for sp in team {
                let mut s = PState { pos: [sp[0], 0.5, sp[1]], ..Default::default() };
                assert!(!collides(m, &s.pos, H_STAND));
                for _ in 0..120 {
                    step(m, &mut s, 0, 0.0, 1.0 / 60.0, 6.35);
                }
                assert!(s.ground && s.pos[1].abs() < 0.01, "{:?}", s);
            }
        }
    }

    #[test]
    fn walls_stop_movement() {
        let m = map();
        let sp = m.spawns[0][0];
        let mut s = PState { pos: [sp[0], 0.01, sp[1]], ..Default::default() };
        for _ in 0..3000 {
            step(m, &mut s, B_FWD, 1.0, 1.0 / 60.0, 6.35);
        }
        let lim_x = m.w as f32;
        let lim_z = m.h as f32;
        assert!(s.pos[0].abs() < lim_x && s.pos[2].abs() < lim_z);
        assert!(!collides(m, &s.pos, s.height()));
    }

    fn mesh_map(triangles: &[[V3; 3]]) -> Map {
        let mut map = Map::build();
        map.boxes.clear();
        let bytes: Vec<u8> = triangles.iter().flatten().flatten().flat_map(|v| v.to_le_bytes()).collect();
        map.mesh = Some(crate::mesh::CollisionMesh::from_bytes(&bytes));
        map
    }

    fn floor(x0: f32, x1: f32, y: f32) -> [[V3; 3]; 2] {
        [
            [[x0, y, -3.0], [x0, y, 3.0], [x1, y, -3.0]],
            [[x1, y, -3.0], [x0, y, 3.0], [x1, y, 3.0]],
        ]
    }

    #[test]
    fn mesh_stairs_are_walkable_in_both_directions_without_jump() {
        let mut triangles = Vec::new();
        triangles.extend(floor(-10.0, 0.0, 0.0));
        triangles.extend(floor(0.0, 10.0, 0.3));
        triangles.extend([
            [[0.0, 0.0, -3.0], [0.0, 0.3, -3.0], [0.0, 0.3, 3.0]],
            [[0.0, 0.0, -3.0], [0.0, 0.3, 3.0], [0.0, 0.0, 3.0]],
        ]);
        let map = mesh_map(&triangles);
        let mut state = PState { pos: [-2.0, EPS, 0.0], ground: true, ..Default::default() };
        for _ in 0..60 { step(&map, &mut state, B_FWD, -std::f32::consts::FRAC_PI_2, 1.0/60.0, 6.35); }
        assert!(state.pos[0] > 2.0 && (state.pos[1]-0.301).abs()<0.01 && state.ground, "ascending {state:?}");
        for _ in 0..80 { step(&map, &mut state, B_BACK, -std::f32::consts::FRAC_PI_2, 1.0/60.0, 6.35); }
        assert!(state.pos[0] < -1.0 && state.pos[1]<0.01 && state.ground, "descending {state:?}");
        assert!(!collides(&map, &state.pos, state.height()));
    }

    #[test]
    fn mesh_ramps_support_full_player_footprint_and_allow_jumps() {
        let mut triangles = Vec::new();
        triangles.extend(floor(-10.0, 0.0, 0.0));
        triangles.extend([
            [[0.0, 0.0, -3.0], [0.0, 0.0, 3.0], [4.0, 2.0, -3.0]],
            [[4.0, 2.0, -3.0], [0.0, 0.0, 3.0], [4.0, 2.0, 3.0]],
        ]);
        triangles.extend(floor(4.0, 10.0, 2.0));
        let map = mesh_map(&triangles);
        let mut state = PState { pos: [-2.0, EPS, 0.0], ground: true, ..Default::default() };
        for _ in 0..100 {
            step(&map, &mut state, B_FWD, -std::f32::consts::FRAC_PI_2, 1.0/60.0, 6.35);
            assert!(!collides(&map, &state.pos, state.height()), "{state:?}");
        }
        assert!(state.pos[0]>5.0 && (state.pos[1]-2.001).abs()<0.01 && state.ground, "{state:?}");
        step(&map, &mut state, B_JUMP, 0.0, 1.0/60.0, 6.35);
        assert!(state.pos[1]>2.05 && !state.ground && state.vel[1]>0.0, "{state:?}");
    }

    #[test]
    fn dust2_import_has_real_multilevel_floors_and_mesh_shot_cover() {
        let map = crate::map::map_by_id(crate::map::MapId::Dust2);
        let mesh = map.mesh.as_ref().unwrap();
        for (x,z,y) in [(-25.5,20.0,3.2),(0.0,-54.0,-3.2),(28.8,-60.4,2.4),(-40.0,-67.2,0.0)] {
            let support=mesh.standing_height(x,z,y,0.3,0.3,HALF_W,H_STAND).expect("imported spawn/site support");
            assert!((support-y).abs()<0.01,"{x} {z}: {support}");
            let mut state=PState{pos:[x,y+0.4,z],..Default::default()};
            for _ in 0..60 {step(map,&mut state,0,0.0,1.0/60.0,6.35);}
            assert!(state.ground && (state.pos[1]-y).abs()<0.01,"{state:?}");
            assert!(!collides(map,&state.pos,H_STAND));
            assert!((ray_world(map,&[x,y+2.0,z],&[0.0,-1.0,0.0],5.0)-2.0).abs()<0.01);
        }
        let a=[-25.5,4.82,20.0];
        let b=[0.0,-1.58,-54.0];
        assert!(!line_clear(map,&a,&b),"uploaded world must shield the two actual spawn regions");
    }

    #[test]
    fn dust2_actual_t_spawn_ramp_short_stairs_and_tunnel_stairs_are_walkable() {
        let map=crate::map::map_by_id(crate::map::MapId::Dust2);
        let mesh=map.mesh.as_ref().unwrap();
        for (name, start, end, reference_y, final_y) in [
            ("T spawn ramp",[-14.0,20.0],[-3.0,20.0],3.2,0.85),
            ("short stairs",[10.0,-40.0],[10.0,-46.0],0.0,2.4),
            ("lower tunnel stairs",[-27.0,-28.0],[-33.0,-28.0],-1.2,0.8),
        ] {
            let y=mesh.standing_height(start[0],start[1],reference_y,0.5,0.5,HALF_W,H_STAND).unwrap();
            let mut state=PState{pos:[start[0],y+EPS,start[1]],ground:true,..Default::default()};
            let dx: f32=end[0]-start[0];
            let dz: f32=end[1]-start[1];
            let yaw=(-dx).atan2(-dz);
            let length=dx.hypot(dz);
            for _ in 0..600 {
                let progress=((state.pos[0]-start[0])*dx+(state.pos[2]-start[1])*dz)/length;
                if progress>=length { break; }
                step(map,&mut state,B_FWD,yaw,1.0/60.0,3.0);
                assert!(!collides(map,&state.pos,H_STAND),"{name}: {state:?}");
            }
            assert!((state.pos[0]-end[0]).hypot(state.pos[2]-end[1])<0.15,"{name}: {state:?}");
            assert!((state.pos[1]-final_y).abs()<0.1 && state.ground,"{name}: {state:?}");
        }
    }
}
