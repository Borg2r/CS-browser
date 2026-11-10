//! Player movement and collision against the box world, plus ray casts.
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
    hit
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
}
