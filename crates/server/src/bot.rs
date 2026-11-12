//! Bot AI: buying, objective play, navigation and combat.
use crate::game::{Game, Phase, ATK, DEF};
use sim::physics::*;
use sim::weapons::*;
use std::f32::consts::PI;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Difficulty {
    Easy,
    #[default]
    Medium,
    Hard,
    Expert,
}

impl Difficulty {
    pub fn id(self) -> &'static str {
        match self {
            Self::Easy => "easy",
            Self::Medium => "medium",
            Self::Hard => "hard",
            Self::Expert => "expert",
        }
    }

    fn profile(self, skill: f32) -> Profile {
        // Personality adds a little variation within a level, while the levels
        // themselves stay distinct. No level alters health or weapon damage.
        let skill = skill.clamp(0.0, 1.0);
        match self {
            Self::Easy => Profile {
                reaction: 1.2 - skill * 0.35, aim_error: 0.075 + 0.045 * (1.0 - skill),
                turn_rate: 3.0 + 2.0 * skill, aim_height: 0.60,
                aim_refresh: [0.6, 1.0], burst: [0.16, 0.28], pause: [0.45, 0.7], tap: [0.35, 0.65],
                strafe_chance: 0.15, strafe_interval: [1.0, 1.7], stop_to_shoot: false,
                hearing: 8.0, vision: 48.0, fov_dot: 0.45, callout_delay: 1.2,
            },
            Self::Medium => Profile {
                reaction: 0.55 - skill * 0.25, aim_error: 0.012 + 0.05 * (1.0 - skill),
                turn_rate: 6.0 + 6.0 * skill, aim_height: 0.68,
                aim_refresh: [0.25, 0.5], burst: [0.25, 0.6], pause: [0.15, 0.4], tap: [0.08, 0.22],
                strafe_chance: 0.66, strafe_interval: [0.4, 1.1], stop_to_shoot: false,
                hearing: 13.0, vision: 70.0, fov_dot: 0.15, callout_delay: 0.5,
            },
            Self::Hard => Profile {
                reaction: 0.28 - skill * 0.08, aim_error: 0.007 + 0.012 * (1.0 - skill),
                turn_rate: 10.0 + 3.0 * skill, aim_height: 0.76,
                aim_refresh: [0.16, 0.3], burst: [0.18, 0.36], pause: [0.1, 0.2], tap: [0.04, 0.1],
                strafe_chance: 0.8, strafe_interval: [0.35, 0.8], stop_to_shoot: true,
                hearing: 16.0, vision: 80.0, fov_dot: 0.05, callout_delay: 0.25,
            },
            Self::Expert => Profile {
                reaction: 0.17 - skill * 0.05, aim_error: 0.003 + 0.006 * (1.0 - skill),
                turn_rate: 13.0 + 3.0 * skill, aim_height: 0.84,
                aim_refresh: [0.1, 0.2], burst: [0.12, 0.24], pause: [0.07, 0.14], tap: [0.015, 0.06],
                strafe_chance: 0.95, strafe_interval: [0.25, 0.6], stop_to_shoot: true,
                hearing: 20.0, vision: 90.0, fov_dot: 0.0, callout_delay: 0.15,
            },
        }
    }
}

struct Profile {
    reaction: f32,
    aim_error: f32,
    turn_rate: f32,
    aim_height: f32,
    aim_refresh: [f32; 2],
    burst: [f32; 2],
    pause: [f32; 2],
    tap: [f32; 2],
    strafe_chance: f32,
    strafe_interval: [f32; 2],
    stop_to_shoot: bool,
    hearing: f32,
    vision: f32,
    fov_dot: f32,
    callout_delay: f32,
}

fn aim_error(profile: &Profile, mut random: impl FnMut() -> f32) -> [f32; 2] {
    [(random() * 2.0 - 1.0) * profile.aim_error,
        (random() * 2.0 - 1.0) * profile.aim_error * 0.6]
}

pub struct Bot {
    skill: f32,
    difficulty: Difficulty,
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
            skill, difficulty: Difficulty::default(), site: 0, bought: false, path: Vec::new(), pi: 0, goal: None, goal_tag: 0,
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
            list.push(["viper", "mammoth", "hornet", "twin_kestrel", "twin_mammoth"][g.rng.below(5)]);
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
    if bot.difficulty != g.difficulty {
        bot.difficulty = g.difficulty;
        // Apply a host's selection to an existing bot without respawning it or
        // discarding its objective. Refresh previously sampled combat choices.
        bot.seen_t = 0.0; bot.err_t = 0.0; bot.strafe_t = 0.0;
        bot.burst_t = 0.0; bot.tap_t = 0.0;
    }
    let profile = g.difficulty.profile(bot.skill);
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
            if len > profile.vision || best.map(|b| len >= b.1).unwrap_or(false) {
                continue;
            }
            let dot = (d[0] * look[0] + d[1] * look[1] + d[2] * look[2]) / len;
            let known = bot.target == Some(e.id);
            // Running enemies nearby are heard even when out of view.
            let heard = len < profile.hearing && e.st.vel[0].hypot(e.st.vel[2]) > 3.4;
            if dot < profile.fov_dot && len > 6.0 && !known && !heard {
                continue;
            }
            let head = [e.st.pos[0], e.st.pos[1] + h - 0.2, e.st.pos[2]];
            let chest_visible = g.visible(&eye, &chest);
            if chest_visible || g.visible(&eye, &head) {
                let aim = [e.st.pos[0], e.st.pos[1] + h * profile.aim_height, e.st.pos[2]];
                let aim = if g.visible(&eye, &aim) { aim } else if chest_visible { chest } else { head };
                best = Some((e.id, len, aim));
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
            if d(&g.map.sites[near]) < 26.0 && bot.seen_t >= profile.callout_delay {
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
    // The carrier always goes to the chosen site; some attackers lurk at the other.
    let site = &g.map.sites[if team == ATK && has_bomb { g.atk_site } else { bot.site }];
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
            bot.err_t = g.rng.range(profile.aim_refresh[0], profile.aim_refresh[1]);
            bot.aim_err = aim_error(&profile, || g.rng.f());
        }
        let (dx, dy, dz) = (chest[0] - eye[0], chest[1] - eye[1], chest[2] - eye[2]);
        want_yaw = (-dx).atan2(-dz) + bot.aim_err[0];
        want_pitch = dy.atan2(dx.hypot(dz)) + bot.aim_err[1];
        turn_rate = profile.turn_rate;
        let off = wrap(want_yaw - yaw).abs() + (want_pitch - pitch).abs();
        let armed = wdef.class != C_KNIFE && g.players[i].gun().map(|x| x.ammo > 0).unwrap_or(false);
        if armed && !busy {
            if wdef.ads && d > 8.0 { buttons |= B_FIRE2; }
            if off < 0.07 + 0.6 / d && bot.seen_t > profile.reaction {
                if wdef.auto {
                    bot.burst_t -= dt;
                    if bot.burst_t > 0.0 || d < 10.0 {
                        buttons |= B_FIRE;
                    } else if bot.burst_t < -g.rng.range(profile.pause[0], profile.pause[1]) {
                        bot.burst_t = g.rng.range(profile.burst[0], profile.burst[1]);
                    }
                } else {
                    bot.tap_t -= dt;
                    if bot.tap_t <= 0.0 {
                        buttons |= B_FIRE;
                        if wdef.dual { buttons |= B_FIRE2; }
                        bot.tap_t = wdef.interval + g.rng.range(profile.tap[0], profile.tap[1]);
                    }
                }
            }
            bot.strafe_t -= dt;
            if bot.strafe_t <= 0.0 {
                bot.strafe_t = g.rng.range(profile.strafe_interval[0], profile.strafe_interval[1]);
                bot.strafe = if g.rng.f() < profile.strafe_chance {
                    if g.rng.f() < 0.5 { -1 } else { 1 }
                } else { 0 };
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
                // Better bots release their movement keys for distant bursts,
                // using the same friction and moving spread as human players.
                if profile.stop_to_shoot && d > 16.0 && buttons & B_FIRE != 0 {
                    buttons &= !(B_FWD | B_LEFT | B_RIGHT);
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::{Gun, TICK};

    fn duel(difficulty: Difficulty) -> Game {
        let mut g = Game::new();
        g.players.truncate(2);
        g.phase = Phase::Live;
        g.difficulty = difficulty;
        for (i, p) in g.players.iter_mut().enumerate() {
            p.team = if i == 0 { ATK } else { DEF };
            p.alive = true;
            p.has_bomb = false;
            p.st = PState { pos: [0.0, 0.001, 24.0 - i as f32 * 20.0], ground: true, ..PState::default() };
            p.prim = None;
            p.sec = Some(Gun::new(PISTOL_ATK));
            p.slot = 1;
            p.flash_t = 0.0;
            p.bot = None;
        }
        let mut bot = Bot::new(0.5);
        bot.difficulty = difficulty;
        // Suppress random aim/strafe samples for an isolated reaction test.
        bot.err_t = 99.0;
        bot.strafe_t = 99.0;
        bot.goal = Some([0.0, 24.0]);
        bot.goal_tag = 4;
        g.players[0].yaw = 0.0;
        g.players[0].pitch = (H_STAND * difficulty.profile(bot.skill).aim_height - EYE_STAND).atan2(20.0);
        g.players[0].bot = Some(Box::new(bot));
        assert!(g.visible(&g.players[0].st.eye(), &g.players[1].st.eye()), "test duel needs clear sight");
        g
    }

    fn first_trigger(g: &mut Game, max_ticks: usize) -> f32 {
        for tick in 1..=max_ticks {
            think(g, 0, TICK);
            if g.players[0].buttons & B_FIRE != 0 {
                return tick as f32 * TICK;
            }
        }
        panic!("bot never fired at a visible opponent");
    }

    #[test]
    fn difficulty_changes_actual_first_shot_reaction() {
        for (level, earliest, latest) in [
            (Difficulty::Easy, 1.0, 1.1),
            (Difficulty::Medium, 0.4, 0.46),
            (Difficulty::Hard, 0.22, 0.27),
            (Difficulty::Expert, 0.13, 0.18),
        ] {
            let latency = first_trigger(&mut duel(level), 120);
            assert!(latency >= earliest && latency <= latest,
                "{level:?} first trigger after {latency}s should be within {earliest}..{latest}s");
        }
    }

    #[test]
    fn seeded_aim_samples_are_distinct_and_bounded_at_every_level() {
        let levels = [Difficulty::Easy, Difficulty::Medium, Difficulty::Hard, Difficulty::Expert];
        for skill in [0.0, 0.25, 0.5, 0.8, 1.0] {
            let mut rms = Vec::new();
            for level in levels {
                let profile = level.profile(skill);
                let mut random = sim_rng(0x5eed_cafe);
                let mut squared = 0.0;
                for _ in 0..2048 {
                    let error = aim_error(&profile, &mut random);
                    assert!(error[0].abs() <= profile.aim_error && error[1].abs() <= profile.aim_error * 0.6);
                    squared += error[0] * error[0] + error[1] * error[1];
                }
                rms.push((squared / 2048.0).sqrt());
                assert!(profile.reaction >= 0.12 && profile.turn_rate.is_finite());
            }
            assert!(rms.windows(2).all(|pair| pair[0] > pair[1] * 1.5),
                "levels should have clearly separated aim accuracy, skill {skill}: {rms:?}");
            assert!(rms[0] > 0.045 && rms[3] < 0.007, "Easy should forgive aim and Expert should be precise");
        }
    }

    #[test]
    fn changing_difficulty_updates_existing_bot_combat_immediately() {
        let mut g = duel(Difficulty::Easy);
        for _ in 0..30 {
            think(&mut g, 0, TICK);
            assert_eq!(g.players[0].buttons & B_FIRE, 0);
        }
        g.difficulty = Difficulty::Expert;
        assert!(first_trigger(&mut g, 15) <= 0.2, "existing bot should use Expert reaction immediately");
        let bot = g.players[0].bot.as_ref().unwrap();
        assert_eq!(bot.difficulty, Difficulty::Expert);
        assert_eq!(bot.skill, 0.5, "keep the existing bot's personality");
        assert_eq!(bot.goal_tag, 4, "keep the existing objective");
        g.difficulty = Difficulty::Easy;
        for _ in 0..30 {
            think(&mut g, 0, TICK);
            assert_eq!(g.players[0].buttons & B_FIRE, 0, "lowering difficulty restores forgiving reaction");
        }
    }

    #[test]
    fn expert_cannot_fire_at_a_known_enemy_through_spawn_cover() {
        let mut g = duel(Difficulty::Expert);
        for (team, p) in g.players.iter_mut().enumerate() {
            let point = g.map.spawns[team][0];
            p.st.pos = [point[0], 0.001, point[1]];
        }
        assert!(!g.visible(&g.players[0].st.eye(), &g.players[1].st.eye()));
        let enemy_id = g.players[1].id;
        g.players[0].bot.as_mut().unwrap().alarm(enemy_id);
        for _ in 0..180 {
            think(&mut g, 0, TICK);
            assert_eq!(g.players[0].buttons & B_FIRE, 0, "Expert must still see its target before shooting");
        }
    }
}
