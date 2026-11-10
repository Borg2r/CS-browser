//! Bot AI: buying, objective play, navigation and combat.
use crate::game::{Game, Phase, ATK, DEF};
use sim::physics::*;
use sim::weapons::*;
use std::f32::consts::PI;

pub struct Bot {
    skill: f32,
    site: usize,
    bought: bool,
    path: Vec<[f32; 2]>,
    pi: usize,
    goal: Option<[f32; 2]>,
    goal_tag: u32,
    hold_t: f32,
    target: Option<u32>,
    seen_t: f32,
    lost_t: f32,
    aim_err: [f32; 2],
    err_t: f32,
    strafe: i32,
    strafe_t: f32,
    burst_t: f32,
    tap_t: f32,
    stuck_t: f32,
    last_pos: [f32; 2],
    look_off: f32,
    look_t: f32,
    watch: Option<[f32; 2]>,
}

fn wrap(a: f32) -> f32 {
    let mut a = a % (2.0 * PI);
    if a > PI {
        a -= 2.0 * PI;
    } else if a < -PI {
        a += 2.0 * PI;
    }
    a
}

fn turn(cur: f32, want: f32, max: f32) -> f32 {
    cur + wrap(want - cur).clamp(-max, max)
}

impl Bot {
    pub fn new(skill: f32) -> Bot {
        Bot {
            skill, site: 0, bought: false, path: Vec::new(), pi: 0, goal: None, goal_tag: 0,
            hold_t: 0.0, target: None, seen_t: 0.0, lost_t: 0.0, aim_err: [0.0; 2], err_t: 0.0,
            strafe: 0, strafe_t: 0.0, burst_t: 0.0, tap_t: 0.0, stuck_t: 0.0, last_pos: [0.0; 2],
            look_off: 0.0, look_t: 0.0, watch: None,
        }
    }

    pub fn reset(&mut self, site: usize) {
        *self = Bot { site, ..Bot::new(self.skill) };
    }

    /// Called when this bot takes damage: turn on whoever did it.
    pub fn alarm(&mut self, attacker: u32) {
        if self.target.is_none() || self.lost_t > 0.0 {
            self.target = Some(attacker);
            self.seen_t = 0.0;
            self.lost_t = 0.0;
        }
    }

    fn set_goal(&mut self, g: &Game, from: [f32; 2], tag: u32, pick: impl FnOnce() -> [f32; 2]) {
        if self.goal_tag != tag || self.goal.is_none() {
            let to = pick();
            self.goal_tag = tag;
            self.goal = Some(to);
            self.path = g.nav.path(from, to);
            self.pi = 0;
            self.hold_t = 0.0;
            self.watch = None;
        }
    }
}

fn shop(g: &mut Game, i: usize) {
    let (team, money, has_prim) = {
        let p = &g.players[i];
        (p.team, p.money, p.prim.is_some())
    };
    let atk = team == ATK;
    let roll = g.rng.f();
    let mut list: Vec<&str> = Vec::new();
    if !has_prim {
        if money >= 5200 && roll < 0.12 {
            list.push("longbow");
        } else if money >= 4000 {
            list.push(if atk { "rook" } else { "sentinel" });
        } else if money >= 2900 {
            list.push(if atk { "jackal" } else { "falcon" });
        } else if money >= 2100 {
            list.push(["lynx", "cinder", "ram"][g.rng.below(3)]);
        } else if money >= 1000 && roll < 0.5 {
            list.push(["viper", "mammoth", "hornet"][g.rng.below(3)]);
        }
    }
    list.push(if money >= 4500 { "vesthelm" } else { "vest" });
    if !atk {
        list.push("kit");
    }
    if roll > 0.6 {
        list.push("frag");
    }
    for item in list {
        g.buy(i, item);
    }
}

pub fn think(g: &mut Game, i: usize, dt: f32) {
    let Some(mut bot) = g.players[i].bot.take() else { return };
    run(g, i, dt, &mut bot);
    g.players[i].bot = Some(bot);
}

fn run(g: &mut Game, i: usize, dt: f32, bot: &mut Bot) {
    if !g.players[i].alive {
        g.players[i].buttons = 0;
        return;
    }
    if g.phase == Phase::Freeze {
        if !bot.bought && g.phase_t < 4.5 - bot.skill * 2.0 {
            bot.bought = true;
            shop(g, i);
        }
        g.players[i].buttons = 0;
        return;
    }
    if g.phase == Phase::MatchEnd {
        g.players[i].buttons = 0;
        return;
    }

    let (team, eye, pos, xz, yaw, pitch, flash, has_bomb, id) = {
        let p = &g.players[i];
        (p.team, p.st.eye(), p.st.pos, p.xz(), p.yaw, p.pitch, p.flash_t, p.has_bomb, p.id)
    };
    let look = view_dir(yaw, pitch);

    // ---- perception
    let mut best: Option<(u32, f32, [f32; 3])> = None;
    if flash < 0.6 {
        for e in g.players.iter().filter(|e| e.alive && e.team != team) {
            let h = e.st.height();
            let chest = [e.st.pos[0], e.st.pos[1] + h * 0.68, e.st.pos[2]];
            let d = [chest[0] - eye[0], chest[1] - eye[1], chest[2] - eye[2]];
            let len = (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt().max(0.01);
            if len > 70.0 || best.map(|b| len >= b.1).unwrap_or(false) {
                continue;
            }
            let dot = (d[0] * look[0] + d[1] * look[1] + d[2] * look[2]) / len;
            let known = bot.target == Some(e.id);
            // Running enemies nearby are heard even when out of view.
            let heard = len < 13.0 && e.st.vel[0].hypot(e.st.vel[2]) > 3.4;
            if dot < 0.15 && len > 6.0 && !known && !heard {
                continue;
            }
            let head = [e.st.pos[0], e.st.pos[1] + h - 0.2, e.st.pos[2]];
            if g.visible(&eye, &chest) || g.visible(&eye, &head) {
                best = Some((e.id, len, chest));
            }
        }
    }
    match best {
        Some((tid, _, _)) => {
            if bot.target != Some(tid) {
                bot.target = Some(tid);
                bot.seen_t = 0.0;
            }
            bot.seen_t += dt;
            bot.lost_t = 0.0;
        }
        None => {
            bot.lost_t += dt;
            if bot.lost_t > 1.2 {
                bot.target = None;
            }
        }
    }

    // Defenders call out where the push is coming from and rotate to it.
    if team == DEF && g.planted.is_none() {
        if let (Some((_, _, at)), None) = (best, g.alert) {
            let d = |s: &sim::map::Zone| (s.center()[0] - at[0]).hypot(s.center()[1] - at[2]);
            let near = if d(&g.map.sites[0]) < d(&g.map.sites[1]) { 0 } else { 1 };
            if d(&g.map.sites[near]) < 26.0 {
                g.alert = Some(near);
            }
        }
        if let Some(s) = g.alert {
            if bot.site != s {
                bot.site = s;
                bot.goal = None;
            }
        }
    }

    let mut buttons = 0u32;
    let mut want_yaw = yaw;
    let mut want_pitch = 0.0;
    let mut turn_rate = 5.0;
    let mut want_slot = g.players[i].best_slot();
    let mut busy = false; // planting / defusing: do not walk

    // ---- objective
    let planted = g.planted.as_ref().map(|b| b.pos);
    let site = &g.map.sites[if team == ATK { g.atk_site } else { bot.site }];
    let nav = &g.nav;
    let mut r1 = sim_rng(g.rng.next());
    if team == ATK {
        if has_bomb && planted.is_none() && g.phase == Phase::Live {
            let in_site = g.map.site_at(xz[0], xz[1]).is_some();
            let arrived = bot.goal.map(|t| (t[0] - xz[0]).hypot(t[1] - xz[1]) < 1.0).unwrap_or(false);
            if in_site && arrived && bot.goal_tag == 1 {
                if best.is_none() {
                    want_slot = 6;
                    buttons |= B_FIRE;
                    want_pitch = -0.9;
                    busy = true;
                }
            } else {
                bot.set_goal(g, xz, 1, || nav.point_in(site, &mut r1));
            }
        } else if let Some(bp) = planted {
            bot.set_goal(g, xz, 2, || nav.point_near([bp[0], bp[2]], 7.0, &mut r1));
        } else {
            let dropped = g.items.iter().find(|it| it.w == BOMB).map(|it| [it.pos[0], it.pos[2]]);
            let nearest = dropped.map(|d| {
                let mine = (d[0] - xz[0]).hypot(d[1] - xz[1]);
                !g.players.iter().any(|o| {
                    o.alive && o.team == ATK && o.id != id && (d[0] - o.st.pos[0]).hypot(d[1] - o.st.pos[2]) < mine
                })
            });
            match (dropped, nearest) {
                (Some(d), Some(true)) => {
                    if bot.goal.map(|t| (t[0] - d[0]).hypot(t[1] - d[1]) > 0.5).unwrap_or(true) {
                        bot.goal = None;
                    }
                    bot.set_goal(g, xz, 3, || d);
                }
                _ => bot.set_goal(g, xz, 4, || nav.point_in(site, &mut r1)),
            }
        }
    } else if let (Some(bp), Phase::Live) = (planted, g.phase) {
        let d = (bp[0] - xz[0]).hypot(bp[2] - xz[1]);
        if d < 1.4 {
            if best.map(|b| b.1 > 12.0).unwrap_or(true) || g.players[i].defuse_t > 0.0 {
                buttons |= B_USE;
                want_pitch = -1.0;
                busy = true;
                best = None;
            }
        } else {
            bot.set_goal(g, xz, 5, || [bp[0], bp[2]]);
        }
    } else {
        bot.set_goal(g, xz, 6, || nav.point_in(site, &mut r1));
    }

    // ---- combat
    let wdef = &WEAPONS[g.players[i].cur_weapon()];
    if let Some((_, d, chest)) = best {
        bot.err_t -= dt;
        if bot.err_t <= 0.0 {
            bot.err_t = g.rng.range(0.25, 0.5);
            let e = 0.012 + 0.05 * (1.0 - bot.skill);
            bot.aim_err = [g.rng.range(-e, e), g.rng.range(-e, e) * 0.6];
        }
        let (dx, dy, dz) = (chest[0] - eye[0], chest[1] - eye[1], chest[2] - eye[2]);
        want_yaw = (-dx).atan2(-dz) + bot.aim_err[0];
        want_pitch = dy.atan2(dx.hypot(dz)) + bot.aim_err[1];
        turn_rate = 6.0 + 6.0 * bot.skill;
        let off = wrap(want_yaw - yaw).abs() + (want_pitch - pitch).abs();
        let reaction = 0.2 + 0.4 * (1.0 - bot.skill);
        let armed = wdef.class != C_KNIFE && g.players[i].gun().map(|x| x.ammo > 0).unwrap_or(false);
        if armed && !busy {
            if off < 0.07 + 0.6 / d && bot.seen_t > reaction {
                if wdef.auto {
                    bot.burst_t -= dt;
                    if bot.burst_t > 0.0 || d < 10.0 {
                        buttons |= B_FIRE;
                    } else if bot.burst_t < -g.rng.range(0.15, 0.4) {
                        bot.burst_t = g.rng.range(0.25, 0.6);
                    }
                } else {
                    bot.tap_t -= dt;
                    if bot.tap_t <= 0.0 {
                        buttons |= B_FIRE;
                        bot.tap_t = wdef.interval + g.rng.range(0.08, 0.22);
                    }
                }
            }
            bot.strafe_t -= dt;
            if bot.strafe_t <= 0.0 {
                bot.strafe_t = g.rng.range(0.4, 1.1);
                bot.strafe = g.rng.below(3) as i32 - 1;
            }
            if wdef.class != C_SNIPER {
                buttons |= match bot.strafe {
                    -1 => B_LEFT,
                    1 => B_RIGHT,
                    _ => 0,
                };
                if d > 28.0 {
                    buttons |= B_FWD;
                }
            }
        } else if !busy {
            buttons |= B_FWD;
            if d < 2.0 {
                buttons |= B_FIRE;
            }
        }
        bot.stuck_t = 0.0;
    } else if !busy {
        // ---- navigation
        let mut moving = false;
        if let Some(goal) = bot.goal {
            let dg = (goal[0] - xz[0]).hypot(goal[1] - xz[1]);
            if dg < 0.7 || bot.pi >= bot.path.len() {
                // Arrived: hold a while, then pick a new spot (roaming goals only).
                bot.hold_t += dt;
                let roam = matches!(bot.goal_tag, 2 | 4 | 6);
                if roam && bot.hold_t > 4.0 + 6.0 * bot.skill {
                    bot.goal = None;
                } else if !roam && dg >= 0.7 {
                    bot.goal = None;
                }
            } else {
                while bot.pi + 1 < bot.path.len() {
                    let n = bot.path[bot.pi];
                    if (n[0] - xz[0]).hypot(n[1] - xz[1]) < 0.6 {
                        bot.pi += 1;
                    } else {
                        break;
                    }
                }
                // Look ahead for a straight shortcut.
                for ahead in [6usize, 3] {
                    let k = (bot.pi + ahead).min(bot.path.len() - 1);
                    if k > bot.pi && g.nav.walk_clear(g.map, xz, bot.path[k]) {
                        bot.pi = k;
                        break;
                    }
                }
                let n = bot.path[bot.pi];
                want_yaw = (-(n[0] - xz[0])).atan2(-(n[1] - xz[1]));
                turn_rate = 9.0;
                if wrap(want_yaw - yaw).abs() < 1.2 {
                    buttons |= B_FWD;
                }
                moving = true;
            }
        }
        if moving {
            bot.stuck_t += dt;
            if bot.stuck_t > 1.0 {
                if (bot.last_pos[0] - xz[0]).hypot(bot.last_pos[1] - xz[1]) < 0.4 {
                    buttons |= B_JUMP;
                    bot.goal = None;
                }
                bot.last_pos = xz;
                bot.stuck_t = 0.0;
            }
        } else {
            // Watch towards where the enemy comes from.
            bot.look_t -= dt;
            if bot.look_t <= 0.0 {
                bot.look_t = g.rng.range(1.5, 3.5);
                bot.look_off = g.rng.range(-1.0, 1.0);
            }
            // Watch the route the enemy would take to get here.
            if bot.watch.is_none() {
                let foe = g.map.spawns[if team == ATK { 1 } else { 0 }][0];
                let route = g.nav.path(xz, foe);
                bot.watch = Some(route.get(7.min(route.len().saturating_sub(1))).copied().unwrap_or(foe));
            }
            let focus = bot.watch.unwrap_or(xz);
            want_yaw = (-(focus[0] - xz[0])).atan2(-(focus[1] - xz[1])) + bot.look_off * 0.6;
            turn_rate = 3.0;
        }
        if g.players[i].gun().map(|x| x.ammo * 3 < WEAPONS[x.w].mag && x.reserve > 0).unwrap_or(false) {
            buttons |= B_RELOAD;
        }
    }

    if g.players[i].slot != want_slot {
        g.select_slot(i, want_slot);
    }
    let _ = pos;
    let p = &mut g.players[i];
    p.yaw = wrap(turn(yaw, want_yaw, turn_rate * dt));
    p.pitch = turn(pitch, want_pitch, turn_rate * dt).clamp(-1.5, 1.5);
    p.buttons = buttons;
}

/// Small standalone generator so closures can draw randoms without borrowing the game.
fn sim_rng(seed: u64) -> impl FnMut() -> f32 {
    let mut s = seed | 1;
    move || {
        s ^= s << 13;
        s ^= s >> 7;
        s ^= s << 17;
        (s >> 40) as f32 / (1u64 << 24) as f32
    }
}
