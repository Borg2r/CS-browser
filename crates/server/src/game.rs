//! Match state and rules: rounds, economy, weapons, grenades, the charge.
use crate::bot::{self, Bot};
use crate::nav::Nav;
use serde::Deserialize;
use serde_json::json;
use sim::map::{map, Map};
use sim::physics::*;
use sim::weapons::*;
use sim::V3;
use std::collections::{HashMap, VecDeque};
use std::fmt::Write;
use tokio::sync::mpsc;

pub const ATK: u8 = 1;
pub const DEF: u8 = 2;
pub const TICK: f32 = 1.0 / 60.0;
const FREEZE_TIME: f32 = 6.0;
const ROUND_TIME: f32 = 115.0;
const END_TIME: f32 = 5.0;
const MATCH_END_TIME: f32 = 10.0;
const BUY_TIME: f32 = 90.0;
const BOMB_TIME: f32 = 45.0;
const PLANT_TIME: f32 = 3.0;
const WIN_ROUNDS: u32 = 16;
const HALF_ROUNDS: u32 = 15;
const START_MONEY: u32 = 800;
const MAX_MONEY: u32 = 16000;
const SMOKE_RADIUS: f32 = 3.5;

#[derive(Deserialize)]
#[serde(tag = "t")]
pub enum ClientMsg {
    #[serde(rename = "join")]
    Join { name: String, team: u8 },
    #[serde(rename = "in")]
    Input {
        s: u32,
        b: u32,
        y: f32,
        p: f32,
        d: f32,
        #[serde(default)]
        it: f64,
    },
    #[serde(rename = "sel")]
    Select { slot: u8 },
    #[serde(rename = "buy")]
    Buy { item: String },
    #[serde(rename = "drop")]
    Drop,
    #[serde(rename = "chat")]
    Chat { m: String },
}

pub enum Incoming {
    Connect(u32, mpsc::Sender<String>),
    Msg(u32, ClientMsg),
    Disconnect(u32),
}

pub struct Rng(u64);
impl Rng {
    pub fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    pub fn f(&mut self) -> f32 {
        (self.next() >> 40) as f32 / (1u64 << 24) as f32
    }
    pub fn range(&mut self, a: f32, b: f32) -> f32 {
        a + (b - a) * self.f()
    }
    pub fn below(&mut self, n: usize) -> usize {
        (self.next() % n.max(1) as u64) as usize
    }
}

#[derive(Clone, Copy, PartialEq)]
pub enum Phase {
    Freeze,
    Live,
    End,
    MatchEnd,
}

#[derive(Clone, Copy)]
pub struct Gun {
    pub w: usize,
    pub ammo: u16,
    pub reserve: u16,
}

impl Gun {
    pub fn new(w: usize) -> Gun {
        Gun { w, ammo: WEAPONS[w].mag, reserve: WEAPONS[w].reserve }
    }
}

struct Cmd {
    seq: u32,
    buttons: u32,
    yaw: f32,
    pitch: f32,
    dt: f32,
    it: f64,
}

pub struct Player {
    pub id: u32,
    pub name: String,
    pub team: u8,
    pub conn: Option<u32>,
    pub bot: Option<Box<Bot>>,
    pub alive: bool,
    pub st: PState,
    pub yaw: f32,
    pub pitch: f32,
    pub buttons: u32,
    pub prev_buttons: u32,
    pub hp: i32,
    pub armor: i32,
    pub helmet: bool,
    pub money: u32,
    pub kills: u32,
    pub deaths: u32,
    pub prim: Option<Gun>,
    pub sec: Option<Gun>,
    pub nades: [u8; 3],
    pub has_bomb: bool,
    pub kit: bool,
    pub slot: u8,
    pub cooldown: f32,
    pub reload_t: f32,
    pub shots: f32,
    pub since_shot: f32,
    /// Scope zoom level: 0 off, 1 or 2 zoomed.
    pub scoped: u8,
    pub plant_t: f32,
    pub defuse_t: f32,
    pub flash_t: f32,
    cmds: VecDeque<Cmd>,
    ack: u32,
    budget: f32,
    interp_time: f64,
    hist: VecDeque<(f64, V3, bool)>,
}

impl Player {
    fn new(id: u32, name: String, team: u8, conn: Option<u32>, bot: Option<Box<Bot>>) -> Player {
        Player {
            id, name, team, conn, bot,
            alive: false,
            st: PState::default(),
            yaw: 0.0, pitch: 0.0, buttons: 0, prev_buttons: 0,
            hp: 0, armor: 0, helmet: false, money: START_MONEY, kills: 0, deaths: 0,
            prim: None, sec: None, nades: [0; 3], has_bomb: false, kit: false,
            slot: 2, cooldown: 0.0, reload_t: 0.0, shots: 0.0, since_shot: 9.0, scoped: 0,
            plant_t: 0.0, defuse_t: 0.0, flash_t: 0.0,
            cmds: VecDeque::new(), ack: 0, budget: 0.0, interp_time: 0.0,
            hist: VecDeque::new(),
        }
    }

    pub fn has_slot(&self, slot: u8) -> bool {
        match slot {
            0 => self.prim.is_some(),
            1 => self.sec.is_some(),
            2 => true,
            3..=5 => self.nades[(slot - 3) as usize] > 0,
            6 => self.has_bomb,
            _ => false,
        }
    }

    pub fn cur_weapon(&self) -> usize {
        match self.slot {
            0 => self.prim.map(|g| g.w).unwrap_or(KNIFE),
            1 => self.sec.map(|g| g.w).unwrap_or(KNIFE),
            3 => FRAG,
            4 => FLASH,
            5 => SMOKE,
            6 => BOMB,
            _ => KNIFE,
        }
    }

    pub fn gun(&self) -> Option<&Gun> {
        match self.slot {
            0 => self.prim.as_ref(),
            1 => self.sec.as_ref(),
            _ => None,
        }
    }

    fn gun_mut(&mut self) -> Option<&mut Gun> {
        match self.slot {
            0 => self.prim.as_mut(),
            1 => self.sec.as_mut(),
            _ => None,
        }
    }

    pub fn best_slot(&self) -> u8 {
        let usable = |g: &Option<Gun>| g.map(|g| g.ammo + g.reserve > 0).unwrap_or(false);
        if usable(&self.prim) {
            0
        } else if usable(&self.sec) {
            1
        } else {
            2
        }
    }

    pub fn max_speed(&self) -> f32 {
        let w = &WEAPONS[self.cur_weapon()];
        if self.scoped > 0 && w.zoom > 0.0 { w.speed * 0.6 } else { w.speed }
    }

    pub fn xz(&self) -> [f32; 2] {
        [self.st.pos[0], self.st.pos[2]]
    }
}

pub struct Item {
    pub id: u32,
    pub w: usize,
    pub ammo: u16,
    pub reserve: u16,
    pub pos: V3,
    no_pick: (u32, f64),
}

struct Nade {
    id: u32,
    kind: usize,
    pos: V3,
    vel: V3,
    fuse: f32,
    owner: u32,
    team: u8,
}

pub struct Smoke {
    pub pos: V3,
    pub t: f32,
}

pub struct Planted {
    pub pos: V3,
    pub timer: f32,
    pub site: usize,
}

pub struct Game {
    pub map: &'static Map,
    pub nav: Nav,
    pub players: Vec<Player>,
    conns: HashMap<u32, mpsc::Sender<String>>,
    conn_player: HashMap<u32, u32>,
    pub time: f64,
    tick_n: u64,
    pub phase: Phase,
    pub phase_t: f32,
    live_elapsed: f32,
    pub score: [u32; 2],
    loss_streak: [u32; 2],
    round: u32,
    pub planted: Option<Planted>,
    pub items: Vec<Item>,
    nades: Vec<Nade>,
    pub smokes: Vec<Smoke>,
    events: Vec<String>,
    private: Vec<(u32, String)>,
    pub rng: Rng,
    next_id: u32,
    pub atk_site: usize,
    /// Site where defenders have spotted the attack (bots rotate there).
    pub alert: Option<usize>,
    swap_pending: bool,
    roster_dirty: bool,
    team_size: usize,
}

fn dist(a: &V3, b: &V3) -> f32 {
    ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2) + (a[2] - b[2]).powi(2)).sqrt()
}

/// Ray vs player hit volumes. Returns (distance, zone): 0 head, 1 torso, 2 legs.
fn hit_player(o: &V3, d: &V3, pos: &V3, crouch: bool) -> Option<(f32, u8)> {
    let h = if crouch { H_CROUCH } else { H_STAND };
    let head = ray_sphere(o, d, &[pos[0], pos[1] + h - 0.2, pos[2]], 0.2);
    let body = ray_aabb(
        o,
        d,
        &[pos[0] - 0.32, pos[1], pos[2] - 0.32],
        &[pos[0] + 0.32, pos[1] + h - 0.36, pos[2] + 0.32],
    );
    match (head, body) {
        (Some(th), Some(tb)) if th <= tb + 0.3 => Some((th, 0)),
        (Some(th), None) => Some((th, 0)),
        (_, Some(tb)) => {
            let y = o[1] + d[1] * tb - pos[1];
            Some((tb, if y < h * 0.42 { 2 } else { 1 }))
        }
        _ => None,
    }
}

pub async fn run(mut rx: mpsc::UnboundedReceiver<Incoming>) {
    let mut g = Game::new();
    let mut iv = tokio::time::interval(std::time::Duration::from_secs_f32(TICK));
    iv.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        iv.tick().await;
        while let Ok(m) = rx.try_recv() {
            g.handle(m);
        }
        g.tick();
    }
}

impl Game {
    pub fn new() -> Game {
        let m = map();
        let seed = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(1)
            | 1;
        let team_size = std::env::var("TEAM_SIZE")
            .ok()
            .and_then(|v| v.parse::<usize>().ok())
            .unwrap_or(5)
            .clamp(1, 10);
        let mut g = Game {
            map: m,
            nav: Nav::build(m),
            players: Vec::new(),
            conns: HashMap::new(),
            conn_player: HashMap::new(),
            time: 0.0,
            tick_n: 0,
            phase: Phase::Freeze,
            phase_t: FREEZE_TIME,
            live_elapsed: 0.0,
            score: [0; 2],
            loss_streak: [0; 2],
            round: 0,
            planted: None,
            items: Vec::new(),
            nades: Vec::new(),
            smokes: Vec::new(),
            events: Vec::new(),
            private: Vec::new(),
            rng: Rng(seed),
            next_id: 1,
            atk_site: 0,
            alert: None,
            swap_pending: false,
            roster_dirty: true,
            team_size,
        };
        g.reset_match();
        g
    }

    fn id(&mut self) -> u32 {
        self.next_id += 1;
        self.next_id
    }

    fn humans(&self) -> usize {
        self.players.iter().filter(|p| p.conn.is_some()).count()
    }

    pub fn idx(&self, id: u32) -> Option<usize> {
        self.players.iter().position(|p| p.id == id)
    }

    fn send(&self, conn: u32, msg: String) {
        if let Some(tx) = self.conns.get(&conn) {
            let _ = tx.try_send(msg);
        }
    }

    // ---------------------------------------------------------------- lobby

    pub fn handle(&mut self, m: Incoming) {
        match m {
            Incoming::Connect(conn, tx) => {
                self.conns.insert(conn, tx);
                self.send(conn, self.hello());
                self.roster_dirty = true;
            }
            Incoming::Disconnect(conn) => {
                self.conns.remove(&conn);
                if let Some(pid) = self.conn_player.remove(&conn) {
                    if let Some(i) = self.idx(pid) {
                        self.remove_player(i);
                    }
                }
                self.fill_bots();
                self.roster_dirty = true;
            }
            Incoming::Msg(conn, msg) => self.on_msg(conn, msg),
        }
    }

    fn on_msg(&mut self, conn: u32, msg: ClientMsg) {
        let pi = self.conn_player.get(&conn).and_then(|id| self.idx(*id));
        match (msg, pi) {
            (ClientMsg::Join { name, team }, None) => self.join(conn, name, team),
            (ClientMsg::Input { s, b, y, p, d, it }, Some(i)) => {
                let q = &mut self.players[i].cmds;
                if q.len() < 64 {
                    q.push_back(Cmd { seq: s, buttons: b, yaw: y, pitch: p, dt: d, it });
                }
            }
            (ClientMsg::Select { slot }, Some(i)) => self.select_slot(i, slot),
            (ClientMsg::Buy { item }, Some(i)) => {
                self.buy(i, &item);
            }
            (ClientMsg::Drop, Some(i)) => self.drop_active(i),
            (ClientMsg::Chat { m }, Some(i)) => {
                let text: String = m.chars().filter(|c| !c.is_control()).take(120).collect();
                if !text.trim().is_empty() {
                    let p = &self.players[i];
                    self.events.push(
                        json!({"t": "chat", "n": p.name, "tm": p.team, "m": text}).to_string(),
                    );
                }
            }
            _ => {}
        }
    }

    fn join(&mut self, conn: u32, name: String, want: u8) {
        let mut name: String = name.chars().filter(|c| !c.is_control()).take(16).collect();
        if name.trim().is_empty() {
            name = "Player".into();
        }
        let humans_on =
            |g: &Game, t: u8| g.players.iter().filter(|p| p.team == t && p.conn.is_some()).count();
        let (ha, hd) = (humans_on(self, ATK), humans_on(self, DEF));
        let mut team = match want {
            ATK | DEF => want,
            _ if ha < hd => ATK,
            _ if hd < ha => DEF,
            _ => 1 + self.rng.below(2) as u8,
        };
        if humans_on(self, team) >= self.team_size {
            team = 3 - team;
            if humans_on(self, team) >= self.team_size {
                self.send(conn, json!({"t": "full"}).to_string());
                return;
            }
        }
        let first = self.humans() == 0;
        if self.players.iter().filter(|p| p.team == team).count() >= self.team_size {
            let bots = |alive: bool| {
                self.players.iter().position(|p| p.team == team && p.bot.is_some() && p.alive == alive)
            };
            if let Some(bi) = bots(false).or_else(|| bots(true)) {
                self.remove_player(bi);
            }
        }
        let id = self.id();
        self.players.push(Player::new(id, name, team, Some(conn), None));
        self.conn_player.insert(conn, id);
        self.send(conn, json!({"t": "joined", "id": id, "team": team}).to_string());
        self.roster_dirty = true;
        if first {
            self.reset_match();
        } else if self.phase == Phase::Freeze {
            let i = self.players.len() - 1;
            let n = self.rng.below(64);
            self.spawn(i, n);
        }
    }

    fn remove_player(&mut self, i: usize) {
        if self.players[i].alive && self.players[i].has_bomb {
            self.players[i].has_bomb = false;
            let pos = self.players[i].st.pos;
            self.drop_item(BOMB, 0, 0, pos, 0);
        }
        self.players.remove(i);
        self.roster_dirty = true;
    }

    fn fill_bots(&mut self) {
        const NAMES: [&str; 20] = [
            "Ada", "Brick", "Cobalt", "Dune", "Echo", "Flint", "Ghost", "Hex", "Iris", "Jolt",
            "Kite", "Lumen", "Moss", "Nova", "Onyx", "Pike", "Quill", "Rust", "Sable", "Tarn",
        ];
        for team in [ATK, DEF] {
            while self.players.iter().filter(|p| p.team == team).count() < self.team_size {
                let id = self.id();
                let mut name = format!("[BOT] {}", NAMES[self.rng.below(NAMES.len())]);
                if self.players.iter().any(|p| p.name == name) {
                    name = format!("{} {}", name, id % 100);
                }
                let skill = self.rng.range(0.25, 0.8);
                self.players.push(Player::new(id, name, team, None, Some(Box::new(Bot::new(skill)))));
                self.roster_dirty = true;
            }
        }
    }

    // --------------------------------------------------------------- rounds

    fn reset_match(&mut self) {
        self.score = [0; 2];
        self.loss_streak = [0; 2];
        self.round = 0;
        for p in &mut self.players {
            p.money = START_MONEY;
            p.kills = 0;
            p.deaths = 0;
            p.alive = false;
        }
        self.start_round();
    }

    fn spawn(&mut self, i: usize, n: usize) {
        let team = self.players[i].team;
        let pts = &self.map.spawns[(team - 1) as usize];
        let sp = pts[n % pts.len()];
        let default_pistol = if team == ATK { PISTOL_ATK } else { PISTOL_DEF };
        let p = &mut self.players[i];
        if !p.alive {
            p.prim = None;
            p.sec = Some(Gun::new(default_pistol));
            p.nades = [0; 3];
            p.kit = false;
            p.armor = 0;
            p.helmet = false;
        }
        for g in [&mut p.prim, &mut p.sec].into_iter().flatten() {
            *g = Gun::new(g.w);
        }
        if p.sec.is_none() {
            p.sec = Some(Gun::new(default_pistol));
        }
        p.alive = true;
        p.hp = 100;
        p.has_bomb = false;
        p.st = PState { pos: [sp[0], 0.01, sp[1]], ..Default::default() };
        p.yaw = if team == ATK { 0.0 } else { std::f32::consts::PI };
        p.pitch = 0.0;
        p.buttons = 0;
        p.prev_buttons = 0;
        p.cooldown = 0.0;
        p.reload_t = 0.0;
        p.shots = 0.0;
        p.scoped = 0;
        p.plant_t = 0.0;
        p.defuse_t = 0.0;
        p.flash_t = 0.0;
        p.hist.clear();
        p.slot = p.best_slot();
    }

    fn start_round(&mut self) {
        self.fill_bots();
        self.round += 1;
        self.phase = Phase::Freeze;
        self.phase_t = FREEZE_TIME;
        self.live_elapsed = 0.0;
        self.planted = None;
        self.items.clear();
        self.nades.clear();
        self.smokes.clear();
        self.atk_site = self.rng.below(2);
        self.alert = None;
        let offset = self.rng.below(64);
        let mut count = [0usize; 2];
        for i in 0..self.players.len() {
            let t = (self.players[i].team - 1) as usize;
            // Stride 5 is coprime with both spawn counts, so nobody stacks.
            self.spawn(i, offset + count[t] * 5);
            count[t] += 1;
            let site = if self.players[i].team == DEF {
                count[t] % 2
            } else if self.rng.f() < 0.2 {
                1 - self.atk_site
            } else {
                self.atk_site
            };
            if let Some(b) = self.players[i].bot.as_mut() {
                b.reset(site);
            }
        }
        let atk: Vec<usize> = (0..self.players.len()).filter(|&i| self.players[i].team == ATK).collect();
        if !atk.is_empty() {
            let c = atk[self.rng.below(atk.len())];
            self.players[c].has_bomb = true;
        }
        self.events.push(json!({"t": "round", "n": self.round}).to_string());
        self.roster_dirty = true;
    }

    fn end_round(&mut self, winner: u8, reason: &str) {
        if self.phase != Phase::Live {
            return;
        }
        let wi = (winner - 1) as usize;
        self.score[wi] += 1;
        self.loss_streak[wi] = 0;
        self.loss_streak[1 - wi] += 1;
        let loss = 1400 + 500 * self.loss_streak[1 - wi].min(4).saturating_sub(1);
        for p in &mut self.players {
            let gain = if p.team == winner { 3250 } else { loss };
            p.money = (p.money + gain).min(MAX_MONEY);
        }
        let total = self.score[0] + self.score[1];
        let draw = total >= HALF_ROUNDS * 2 && self.score[0] == self.score[1];
        let over = self.score[wi] >= WIN_ROUNDS || draw;
        let half = !over && total == HALF_ROUNDS;
        self.swap_pending = half;
        self.phase = if over { Phase::MatchEnd } else { Phase::End };
        self.phase_t = if over { MATCH_END_TIME } else { END_TIME };
        self.events.push(
            json!({"t": "end", "w": winner, "r": reason, "over": over, "half": half, "draw": draw})
                .to_string(),
        );
        self.roster_dirty = true;
    }

    pub fn can_buy(&self, p: &Player) -> bool {
        if !p.alive || !(self.phase == Phase::Freeze || (self.phase == Phase::Live && self.live_elapsed < BUY_TIME)) {
            return false;
        }
        let pts = &self.map.spawns[(p.team - 1) as usize];
        let n = pts.len() as f32;
        let c = pts.iter().fold([0.0, 0.0], |a, s| [a[0] + s[0] / n, a[1] + s[1] / n]);
        (p.st.pos[0] - c[0]).hypot(p.st.pos[2] - c[1]) < 16.0
    }

    // ------------------------------------------------------------ inventory

    pub fn select_slot(&mut self, i: usize, slot: u8) {
        let p = &mut self.players[i];
        if !p.alive || p.slot == slot || !p.has_slot(slot) {
            return;
        }
        p.slot = slot;
        p.reload_t = 0.0;
        p.scoped = 0;
        p.plant_t = 0.0;
        p.shots = 0.0;
        p.cooldown = p.cooldown.max(0.35);
    }

    pub fn buy(&mut self, i: usize, item: &str) -> bool {
        if !self.can_buy(&self.players[i]) {
            return false;
        }
        let p = &mut self.players[i];
        let mut dropped: Option<Gun> = None;
        match item {
            "vest" => {
                if p.armor >= 100 || p.money < 650 {
                    return false;
                }
                p.money -= 650;
                p.armor = 100;
            }
            "vesthelm" => {
                let price = if p.armor >= 100 && !p.helmet { 350 } else { 1000 };
                if (p.armor >= 100 && p.helmet) || p.money < price {
                    return false;
                }
                p.money -= price;
                p.armor = 100;
                p.helmet = true;
            }
            "kit" => {
                if p.team != DEF || p.kit || p.money < 200 {
                    return false;
                }
                p.money -= 200;
                p.kit = true;
            }
            _ => {
                let Some(w) = by_id(item) else { return false };
                let def = &WEAPONS[w];
                if w == KNIFE || w == BOMB || p.money < def.price || (def.team != 0 && def.team != p.team) {
                    return false;
                }
                match slot_of(def.class) {
                    s @ 3..=5 => {
                        let k = (s - 3) as usize;
                        if p.nades[k] >= if k == 1 { 2 } else { 1 } {
                            return false;
                        }
                        p.nades[k] += 1;
                    }
                    s => {
                        let cur = if s == 0 { &mut p.prim } else { &mut p.sec };
                        if cur.map(|g| g.w) == Some(w) {
                            return false;
                        }
                        dropped = cur.replace(Gun::new(w));
                        p.slot = s;
                        p.reload_t = 0.0;
                        p.scoped = 0;
                        p.cooldown = 0.35;
                    }
                }
                p.money -= def.price;
            }
        }
        let (pos, id) = (p.st.pos, p.id);
        if let Some(g) = dropped {
            self.drop_item(g.w, g.ammo, g.reserve, pos, id);
        }
        true
    }

    fn drop_item(&mut self, w: usize, ammo: u16, reserve: u16, pos: V3, by: u32) {
        let o = [pos[0], pos[1] + 0.6, pos[2]];
        let y = o[1] - ray_world(self.map, &o, &[0.0, -1.0, 0.0], 50.0);
        let id = self.id();
        self.items.push(Item {
            id, w, ammo, reserve,
            pos: [pos[0], y, pos[2]],
            no_pick: (by, self.time + 1.5),
        });
    }

    fn drop_active(&mut self, i: usize) {
        let p = &mut self.players[i];
        if !p.alive {
            return;
        }
        let d = view_dir(p.yaw, 0.0);
        let mut pos = [p.st.pos[0] + d[0] * 1.2, p.st.pos[1], p.st.pos[2] + d[2] * 1.2];
        let id = p.id;
        let gun = match p.slot {
            0 => p.prim.take(),
            1 => p.sec.take(),
            6 if p.has_bomb => {
                p.has_bomb = false;
                Some(Gun { w: BOMB, ammo: 0, reserve: 0 })
            }
            _ => None,
        };
        let Some(g) = gun else { return };
        p.slot = p.best_slot();
        p.reload_t = 0.0;
        p.scoped = 0;
        p.plant_t = 0.0;
        if collides(self.map, &pos, 0.5) {
            pos = self.players[i].st.pos;
        }
        self.drop_item(g.w, g.ammo, g.reserve, pos, id);
    }

    fn pickups(&mut self) {
        let now = self.time;
        for p in self.players.iter_mut().filter(|p| p.alive) {
            let mut k = 0;
            while k < self.items.len() {
                let it = &self.items[k];
                let near = (it.pos[0] - p.st.pos[0]).hypot(it.pos[2] - p.st.pos[2]) < 1.1
                    && (it.pos[1] - p.st.pos[1]).abs() < 1.5;
                let blocked = it.no_pick.0 == p.id && it.no_pick.1 > now;
                let slot = slot_of(WEAPONS[it.w].class);
                let wants = match slot {
                    6 => p.team == ATK,
                    0 => p.prim.is_none(),
                    1 => p.sec.is_none(),
                    _ => false,
                };
                if near && !blocked && wants {
                    let it = self.items.swap_remove(k);
                    let g = Gun { w: it.w, ammo: it.ammo, reserve: it.reserve };
                    match slot {
                        6 => p.has_bomb = true,
                        0 => {
                            p.prim = Some(g);
                            if p.slot != 6 {
                                p.slot = 0;
                                p.cooldown = p.cooldown.max(0.35);
                            }
                        }
                        _ => p.sec = Some(g),
                    }
                    self.private.push((p.id, json!({"t": "pickup", "w": it.w}).to_string()));
                } else {
                    k += 1;
                }
            }
        }
    }

    // --------------------------------------------------------------- combat

    pub fn visible(&self, a: &V3, b: &V3) -> bool {
        if !line_clear(self.map, a, b) {
            return false;
        }
        let d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        let len = (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt().max(1e-4);
        let n = [d[0] / len, d[1] / len, d[2] / len];
        !self.smokes.iter().any(|s| {
            let c = [s.pos[0], s.pos[1] + 1.5, s.pos[2]];
            ray_sphere(a, &n, &c, SMOKE_RADIUS).map(|t| t < len).unwrap_or(false)
        })
    }

    fn pos_at(&self, j: usize, time: f64) -> (V3, bool) {
        let p = &self.players[j];
        let mut prev: Option<&(f64, V3, bool)> = None;
        for h in &p.hist {
            if h.0 >= time {
                if let Some(a) = prev {
                    let k = ((time - a.0) / (h.0 - a.0).max(1e-6)) as f32;
                    let l = |x: usize| a.1[x] + (h.1[x] - a.1[x]) * k;
                    return ([l(0), l(1), l(2)], h.2);
                }
                return (h.1, h.2);
            }
            prev = Some(h);
        }
        (p.st.pos, p.st.crouch)
    }

    fn shoot(&mut self, i: usize) {
        let (w, origin, yaw, pitch, team, id, shots, speed, ground, crouch, scoped, at) = {
            let p = &mut self.players[i];
            let w = p.cur_weapon();
            let Some(g) = p.gun_mut() else { return };
            g.ammo -= 1;
            let shots = p.shots;
            p.shots += 1.0;
            p.since_shot = 0.0;
            p.cooldown = WEAPONS[w].interval;
            let at = if p.conn.is_some() && p.interp_time > 0.0 {
                p.interp_time.clamp(self.time - 0.4, self.time)
            } else {
                self.time
            };
            (w, p.st.eye(), p.yaw, p.pitch, p.team, p.id, shots,
             p.st.vel[0].hypot(p.st.vel[2]), p.st.ground, p.st.crouch, p.scoped > 0 || p.bot.is_some(), at)
        };
        let def = &WEAPONS[w];
        let mv = (speed / def.speed).min(1.0);
        let light = matches!(def.class, C_PISTOL | C_SMG | C_SHOTGUN);
        let mut spread = def.spread + (shots * def.spread_inc).min(def.spread_max);
        if def.zoom >= 4.0 && !scoped {
            spread += 0.08;
        }
        spread = spread * (1.0 + 1.5 * mv) + if light { 0.012 } else { 0.035 } * mv * mv;
        if !ground {
            spread += if light { 0.03 } else { 0.07 };
        }
        if crouch {
            spread *= 0.75;
        }
        let (side, climb) = recoil_offset(def.recoil, shots);
        // How much solid material (metres) a round can punch through.
        let power = match def.class {
            C_SNIPER => 2.6,
            C_RIFLE | C_LMG => 1.6,
            C_SMG => 0.7,
            C_PISTOL => 0.6,
            _ => 0.0,
        };

        let mut ends = String::new();
        for _ in 0..def.pellets {
            let r = spread * self.rng.f().sqrt();
            let phi = self.rng.f() * std::f32::consts::TAU;
            let dir = view_dir(yaw + side + r * phi.cos(), (pitch + climb + r * phi.sin()).clamp(-1.56, 1.56));
            let (wall_t, thick) = ray_world_hit(self.map, &origin, &dir, 250.0);
            let mut best_t = wall_t;
            let mut pen_mult = 1.0;
            if let Some(th) = thick.filter(|th| *th < power && wall_t > 0.0) {
                let exit = wall_t + th + 0.02;
                let o2 = [origin[0] + dir[0] * exit, origin[1] + dir[1] * exit, origin[2] + dir[2] * exit];
                best_t = exit + ray_world(self.map, &o2, &dir, 250.0);
                pen_mult = 1.0 - 0.7 * th / power;
            }
            let mut hit: Option<(usize, u8)> = None;
            for j in 0..self.players.len() {
                let v = &self.players[j];
                if !v.alive || v.team == team || j == i {
                    continue;
                }
                let (pos, cr) = self.pos_at(j, at);
                if let Some((t, zone)) = hit_player(&origin, &dir, &pos, cr) {
                    if t < best_t {
                        best_t = t;
                        hit = Some((j, zone));
                    }
                }
            }
            let end = [origin[0] + dir[0] * best_t, origin[1] + dir[1] * best_t, origin[2] + dir[2] * best_t];
            let _ = write!(ends, "{}[{:.2},{:.2},{:.2},{}]", if ends.is_empty() { "" } else { "," },
                end[0], end[1], end[2], hit.is_some() as u8);
            if let Some((j, zone)) = hit {
                let mult = [4.0, 1.0, 0.75][zone as usize];
                let through = if best_t > wall_t { pen_mult } else { 1.0 };
                let dmg = def.dmg * def.falloff.powf(best_t / 10.0) * mult * through;
                self.damage(j, Some(i), dmg, w, zone);
            }
        }
        self.events.push(format!(
            "{{\"t\":\"shot\",\"id\":{},\"w\":{},\"o\":[{:.2},{:.2},{:.2}],\"h\":[{}]}}",
            id, w, origin[0], origin[1], origin[2], ends
        ));
    }

    /// Quick slash, or a slow heavy stab that is lethal from behind.
    fn melee(&mut self, i: usize, stab: bool) {
        let (origin, dir, team, id) = {
            let p = &mut self.players[i];
            p.cooldown = if stab { 1.0 } else { 0.4 };
            (p.st.eye(), view_dir(p.yaw, p.pitch), p.team, p.id)
        };
        let reach = ray_world(self.map, &origin, &dir, if stab { 1.8 } else { 2.2 });
        let mut best: Option<(usize, f32)> = None;
        for (j, v) in self.players.iter().enumerate() {
            if !v.alive || v.team == team {
                continue;
            }
            let c = [v.st.pos[0], v.st.pos[1] + 1.0, v.st.pos[2]];
            if let Some(t) = ray_sphere(&origin, &dir, &c, 0.75) {
                if t < reach && best.map(|b| t < b.1).unwrap_or(true) {
                    best = Some((j, t));
                }
            }
        }
        self.events.push(format!("{{\"t\":\"swing\",\"id\":{},\"hit\":{}}}", id, best.is_some()));
        if let Some((j, _)) = best {
            let facing = view_dir(self.players[j].yaw, 0.0);
            let behind = facing[0] * dir[0] + facing[2] * dir[2] > 0.5;
            let dmg = if !stab { 25.0 } else if behind { 195.0 } else { 65.0 };
            self.damage(j, Some(i), dmg, KNIFE, 1);
        }
    }

    /// zone: 0 head, 1 torso, 2 legs.
    fn damage(&mut self, j: usize, attacker: Option<usize>, raw: f32, w: usize, zone: u8) {
        if self.phase == Phase::Freeze {
            return;
        }
        let from = attacker.map(|a| self.players[a].st.pos).unwrap_or(self.players[j].st.pos);
        let v = &mut self.players[j];
        if !v.alive {
            return;
        }
        let mut dmg = raw;
        if v.armor > 0 && zone != 2 && (zone != 0 || v.helmet) {
            let through = dmg * WEAPONS[w].pen;
            v.armor = (v.armor - ((dmg - through) * 0.5).ceil() as i32).max(0);
            dmg = through;
        }
        let d = dmg.round().max(1.0) as i32;
        v.hp -= d;
        let dead = v.hp <= 0;
        let vid = v.id;
        self.private.push((vid, format!(
            "{{\"t\":\"hurt\",\"d\":{},\"x\":{:.1},\"z\":{:.1}}}", d, from[0], from[2])));
        if let Some(a) = attacker {
            if a != j {
                let aid = self.players[a].id;
                // Getting hit slows you down.
                self.players[j].st.vel[0] *= 0.5;
                self.players[j].st.vel[2] *= 0.5;
                if let Some(b) = self.players[j].bot.as_mut() {
                    b.alarm(aid);
                }
                self.private.push((self.players[a].id, format!(
                    "{{\"t\":\"hit\",\"hs\":{},\"k\":{}}}", zone == 0, dead)));
            }
        }
        if dead {
            self.kill(j, attacker, w, zone == 0);
        }
    }

    fn kill(&mut self, j: usize, attacker: Option<usize>, w: usize, hs: bool) {
        let (pos, vid, prim, bomb) = {
            let v = &mut self.players[j];
            v.alive = false;
            v.hp = 0;
            v.deaths += 1;
            v.plant_t = 0.0;
            v.defuse_t = 0.0;
            v.scoped = 0;
            let bomb = std::mem::take(&mut v.has_bomb);
            (v.st.pos, v.id, v.prim.take(), bomb)
        };
        let mut kid = 0;
        if let Some(a) = attacker {
            if a != j {
                let k = &mut self.players[a];
                k.kills += 1;
                k.money = (k.money + WEAPONS[w].reward).min(MAX_MONEY);
                kid = k.id;
            }
        }
        if let Some(g) = prim {
            self.drop_item(g.w, g.ammo, g.reserve, pos, 0);
        }
        if bomb {
            self.drop_item(BOMB, 0, 0, [pos[0] + 0.4, pos[1], pos[2] + 0.3], 0);
        }
        self.events
            .push(format!("{{\"t\":\"kill\",\"k\":{},\"v\":{},\"w\":{},\"hs\":{}}}", kid, vid, w, hs));
        self.roster_dirty = true;
    }

    fn throw(&mut self, i: usize, kind: usize) {
        let id = self.id();
        let p = &mut self.players[i];
        let k = (slot_of(WEAPONS[kind].class) - 3) as usize;
        p.nades[k] -= 1;
        p.cooldown = 0.6;
        let d = view_dir(p.yaw, p.pitch);
        let e = p.st.eye();
        let nade = Nade {
            id,
            kind,
            pos: [e[0] + d[0] * 0.3, e[1] + d[1] * 0.3, e[2] + d[2] * 0.3],
            vel: [d[0] * 17.0 + p.st.vel[0] * 0.5, d[1] * 17.0 + 2.5, d[2] * 17.0 + p.st.vel[2] * 0.5],
            fuse: 1.7,
            owner: p.id,
            team: p.team,
        };
        if p.nades[k] == 0 {
            p.slot = p.best_slot();
        }
        self.events.push(format!("{{\"t\":\"throw\",\"id\":{}}}", p.id));
        self.nades.push(nade);
    }

    fn update_nades(&mut self, dt: f32) {
        let map = self.map;
        let inside = |p: &V3| {
            map.boxes.iter().any(|b| (0..3).all(|a| p[a] > b.min[a] - 0.1 && p[a] < b.max[a] + 0.1))
        };
        let mut done = Vec::new();
        for (k, n) in self.nades.iter_mut().enumerate() {
            n.vel[1] -= 14.0 * dt;
            for a in 0..3 {
                let old = n.pos[a];
                n.pos[a] += n.vel[a] * dt;
                if inside(&n.pos) {
                    n.pos[a] = old;
                    n.vel[a] *= -0.45;
                    n.vel[(a + 1) % 3] *= 0.8;
                    n.vel[(a + 2) % 3] *= 0.8;
                }
            }
            n.fuse -= dt;
            if n.fuse <= 0.0 {
                done.push(k);
            }
        }
        for k in done.into_iter().rev() {
            let n = self.nades.swap_remove(k);
            let c = [n.pos[0], n.pos[1] + 0.2, n.pos[2]];
            match n.kind {
                FRAG => {
                    self.events.push(format!("{{\"t\":\"boom\",\"p\":[{:.2},{:.2},{:.2}]}}", c[0], c[1], c[2]));
                    let owner = self.idx(n.owner);
                    for j in 0..self.players.len() {
                        let v = &self.players[j];
                        if !v.alive || (v.team == n.team && v.id != n.owner) {
                            continue;
                        }
                        let body = [v.st.pos[0], v.st.pos[1] + 1.0, v.st.pos[2]];
                        let d = dist(&c, &body);
                        if d < 8.0 && line_clear(self.map, &c, &body) {
                            self.damage(j, owner.or(Some(j)), 110.0 * (1.0 - d / 8.0), FRAG, 1);
                        }
                    }
                }
                FLASH => {
                    self.events.push(format!("{{\"t\":\"pop\",\"p\":[{:.2},{:.2},{:.2}]}}", c[0], c[1], c[2]));
                    for v in self.players.iter_mut().filter(|v| v.alive) {
                        let e = v.st.eye();
                        let d = dist(&c, &e);
                        if d > 40.0 || !line_clear(self.map, &c, &e) {
                            continue;
                        }
                        let look = view_dir(v.yaw, v.pitch);
                        let dot = ((c[0] - e[0]) * look[0] + (c[1] - e[1]) * look[1] + (c[2] - e[2]) * look[2]) / d.max(0.01);
                        let facing = if dot > 0.3 { 1.0 } else if dot > -0.3 { 0.55 } else { 0.25 };
                        let dur = 4.0 * facing * (1.0 - d / 40.0);
                        v.flash_t = v.flash_t.max(dur);
                        self.private.push((v.id, format!("{{\"t\":\"flash\",\"a\":{:.2}}}", dur)));
                    }
                }
                _ => {
                    self.events.push(format!("{{\"t\":\"smoke\",\"p\":[{:.2},{:.2},{:.2}]}}", c[0], c[1], c[2]));
                    self.smokes.push(Smoke { pos: n.pos, t: 16.0 });
                }
            }
        }
        self.smokes.retain_mut(|s| {
            s.t -= dt;
            s.t > 0.0
        });
    }

    fn update_weapon(&mut self, i: usize, dt: f32) {
        let live = self.phase == Phase::Live;
        let can_plant = live && self.planted.is_none();
        let bomb_pos = if live { self.planted.as_ref().map(|b| b.pos) } else { None };
        let map = self.map;
        let p = &mut self.players[i];
        p.cooldown = (p.cooldown - dt).max(0.0);
        p.flash_t = (p.flash_t - dt).max(0.0);
        p.since_shot += dt;
        let w = p.cur_weapon();
        let def = &WEAPONS[w];
        if p.since_shot > (def.interval * 1.7).max(0.2) {
            p.shots = (p.shots - dt * 14.0).max(0.0);
        }
        let fire = p.buttons & B_FIRE != 0;
        let pressed = fire && p.prev_buttons & B_FIRE == 0;
        let fire2 = p.buttons & B_FIRE2 != 0 && p.prev_buttons & B_FIRE2 == 0;
        let reload = p.buttons & B_RELOAD != 0;
        let using = p.buttons & B_USE != 0;
        p.prev_buttons = p.buttons;

        // Defusing takes priority over everything else.
        let mut defusing = false;
        if let (Some(bp), true, DEF) = (bomb_pos, using, p.team) {
            defusing = dist(&bp, &p.st.pos) < 1.8 && p.st.ground;
        }
        if defusing {
            if p.defuse_t == 0.0 {
                self.events.push(format!("{{\"t\":\"defusing\",\"id\":{}}}", p.id));
            }
            p.defuse_t += dt;
            if p.defuse_t >= if p.kit { 5.0 } else { 10.0 } {
                p.defuse_t = 0.0;
                p.money = (p.money + 300).min(MAX_MONEY);
                self.planted = None;
                self.events.push("{\"t\":\"defused\"}".to_string());
                self.end_round(DEF, "defused");
            }
            return;
        }
        p.defuse_t = 0.0;

        enum Act {
            None,
            Shoot,
            Melee(bool),
            Throw(usize),
        }
        let mut act = Act::None;
        match def.class {
            C_KNIFE => {
                if p.cooldown <= 0.0 && (fire || p.buttons & B_FIRE2 != 0) {
                    act = Act::Melee(!fire);
                }
            }
            C_FRAG | C_FLASH | C_SMOKE => {
                if pressed && p.cooldown <= 0.0 && p.has_slot(p.slot) {
                    act = Act::Throw(w);
                }
            }
            C_BOMB => {
                let in_site = map.site_at(p.st.pos[0], p.st.pos[2]);
                if let (true, true, true, Some(site)) = (fire, can_plant, p.st.ground && p.has_bomb, in_site) {
                    if p.plant_t == 0.0 {
                        self.events.push(format!("{{\"t\":\"planting\",\"id\":{}}}", p.id));
                    }
                    p.plant_t += dt;
                    if p.plant_t >= PLANT_TIME {
                        p.plant_t = 0.0;
                        p.has_bomb = false;
                        p.slot = p.best_slot();
                        p.cooldown = 0.4;
                        p.money = (p.money + 300).min(MAX_MONEY);
                        self.planted = Some(Planted { pos: p.st.pos, timer: BOMB_TIME, site });
                        self.events.push(format!("{{\"t\":\"planted\",\"site\":{}}}", site));
                    }
                } else {
                    p.plant_t = 0.0;
                }
            }
            _ => {
                let zoom = def.zoom > 0.0;
                if p.reload_t > 0.0 {
                    p.reload_t -= dt;
                    if p.reload_t <= 0.0 {
                        p.reload_t = 0.0;
                        if let Some(g) = p.gun_mut() {
                            let take = (def.mag - g.ammo).min(g.reserve);
                            g.ammo += take;
                            g.reserve -= take;
                        }
                    }
                } else if let Some(g) = p.gun().copied() {
                    if (reload || g.ammo == 0) && g.ammo < def.mag && g.reserve > 0 && p.cooldown <= 0.0 {
                        p.reload_t = def.reload;
                        p.scoped = 0;
                        p.shots = 0.0;
                        self.events.push(format!("{{\"t\":\"reload\",\"id\":{}}}", p.id));
                    } else if ((def.auto && fire) || pressed) && p.cooldown <= 0.0 && g.ammo > 0 {
                        act = Act::Shoot;
                    } else if zoom && fire2 {
                        p.scoped = (p.scoped + 1) % if def.zoom >= 4.0 { 3 } else { 2 };
                    }
                }
            }
        }
        match act {
            Act::Shoot => self.shoot(i),
            Act::Melee(stab) => self.melee(i, stab),
            Act::Throw(k) => self.throw(i, k),
            Act::None => {}
        }
    }

    // ----------------------------------------------------------------- tick

    pub fn tick(&mut self) {
        // Idle servers sleep; a visitor in the menu already sees a live match.
        if self.conns.is_empty() {
            return;
        }
        let dt = TICK;
        self.time += dt as f64;
        self.tick_n += 1;
        let frozen = matches!(self.phase, Phase::Freeze | Phase::MatchEnd);
        const FREEZE_MASK: u32 = !(B_FWD | B_BACK | B_LEFT | B_RIGHT | B_JUMP);

        let mut falls: Vec<(usize, f32)> = Vec::new();
        let landed = |before: (bool, f32), st: &PState| {
            (!before.0 && st.ground && before.1 < -13.0).then(|| (-before.1 - 13.0) * 7.0)
        };
        for i in 0..self.players.len() {
            if self.players[i].bot.is_some() {
                bot::think(self, i, dt);
                let p = &mut self.players[i];
                if p.alive {
                    let held = frozen || p.plant_t > 0.0 || p.defuse_t > 0.0;
                    let b = if held { p.buttons & FREEZE_MASK } else { p.buttons };
                    let sp = p.max_speed();
                    let before = (p.st.ground, p.st.vel[1]);
                    step(self.map, &mut p.st, b, p.yaw, dt, sp);
                    falls.extend(landed(before, &p.st).map(|d| (i, d)));
                }
            } else {
                let map = self.map;
                let p = &mut self.players[i];
                p.budget = (p.budget + dt).min(0.3);
                for _ in 0..12 {
                    let Some(c) = p.cmds.pop_front() else { break };
                    p.ack = c.seq;
                    p.yaw = c.yaw;
                    p.pitch = c.pitch.clamp(-1.55, 1.55);
                    p.buttons = c.buttons;
                    p.interp_time = c.it;
                    let d = c.dt.clamp(0.0, 0.05);
                    if p.alive && d <= p.budget + 1e-4 {
                        p.budget -= d;
                        let held = frozen || p.plant_t > 0.0 || p.defuse_t > 0.0;
                        let b = if held { c.buttons & FREEZE_MASK } else { c.buttons };
                        let sp = p.max_speed();
                        let before = (p.st.ground, p.st.vel[1]);
                        step(map, &mut p.st, b, p.yaw, d, sp);
                        falls.extend(landed(before, &p.st).map(|d| (i, d)));
                    }
                }
            }
        }
        for (i, d) in falls {
            self.damage(i, None, d, KNIFE, 2);
        }

        if !frozen {
            for i in 0..self.players.len() {
                if self.players[i].alive {
                    self.update_weapon(i, dt);
                }
            }
            self.pickups();
            self.update_nades(dt);
        }

        let now = self.time;
        for p in self.players.iter_mut().filter(|p| p.alive) {
            p.hist.push_back((now, p.st.pos, p.st.crouch));
            while p.hist.front().map(|h| h.0 < now - 0.5).unwrap_or(false) {
                p.hist.pop_front();
            }
        }

        self.update_phase(dt);
        self.broadcast();
    }

    fn update_phase(&mut self, dt: f32) {
        self.phase_t -= dt;
        match self.phase {
            Phase::Freeze => {
                if self.phase_t <= 0.0 {
                    self.phase = Phase::Live;
                    self.phase_t = ROUND_TIME;
                    self.events.push("{\"t\":\"go\"}".to_string());
                }
            }
            Phase::Live => {
                self.live_elapsed += dt;
                let alive = |g: &Game, t: u8| g.players.iter().filter(|p| p.team == t && p.alive).count();
                let (atk, def) = (alive(self, ATK), alive(self, DEF));
                if let Some(b) = self.planted.as_mut() {
                    b.timer -= dt;
                    if b.timer <= 0.0 {
                        let c = b.pos;
                        self.events.push(format!("{{\"t\":\"bigboom\",\"p\":[{:.2},{:.2},{:.2}]}}", c[0], c[1], c[2]));
                        for j in 0..self.players.len() {
                            let d = dist(&c, &self.players[j].st.pos);
                            if self.players[j].alive && d < 22.0 {
                                self.damage(j, None, 260.0 * (1.0 - d / 22.0), BOMB, 2);
                            }
                        }
                        self.end_round(ATK, "detonated");
                    } else if def == 0 {
                        self.end_round(ATK, "eliminated");
                    }
                } else if atk == 0 {
                    self.end_round(DEF, "eliminated");
                } else if def == 0 {
                    self.end_round(ATK, "eliminated");
                } else if self.phase_t <= 0.0 {
                    self.end_round(DEF, "time");
                }
            }
            Phase::End => {
                if self.phase_t <= 0.0 {
                    if std::mem::take(&mut self.swap_pending) {
                        // Half-time: sides swap, scores follow the players, economy resets.
                        self.score.swap(0, 1);
                        self.loss_streak = [0; 2];
                        for p in &mut self.players {
                            p.team = 3 - p.team;
                            p.money = START_MONEY;
                            p.alive = false;
                        }
                    }
                    self.start_round();
                }
            }
            Phase::MatchEnd => {
                if self.phase_t <= 0.0 {
                    for p in &mut self.players {
                        p.team = 3 - p.team;
                    }
                    self.reset_match();
                }
            }
        }
    }

    // ------------------------------------------------------------- protocol

    fn hello(&self) -> String {
        let boxes: Vec<_> = self
            .map
            .boxes
            .iter()
            .map(|b| json!([b.min[0], b.min[1], b.min[2], b.max[0], b.max[1], b.max[2], b.mat, b.var]))
            .collect();
        let sites: Vec<_> = self.map.sites.iter().map(|s| json!([s.min[0], s.min[1], s.max[0], s.max[1]])).collect();
        let weapons: Vec<_> = WEAPONS
            .iter()
            .map(|w| {
                json!({"id": w.id, "name": w.name, "cls": w.class, "price": w.price, "mag": w.mag,
                       "interval": w.interval, "auto": w.auto, "speed": w.speed, "zoom": w.zoom,
                       "team": w.team, "recoil": w.recoil, "slot": slot_of(w.class), "reload": w.reload,
                       "dmg": w.dmg})
            })
            .collect();
        json!({"t": "hello", "map": {"boxes": boxes, "sites": sites, "w": self.map.w, "h": self.map.h},
               "weapons": weapons, "win": WIN_ROUNDS, "teamSize": self.team_size})
        .to_string()
    }

    fn roster(&self) -> String {
        let pl: Vec<_> = self
            .players
            .iter()
            .map(|p| json!({"id": p.id, "n": p.name, "tm": p.team, "k": p.kills, "d": p.deaths,
                            "bot": p.bot.is_some(), "mo": p.money}))
            .collect();
        json!({"t": "r", "pl": pl}).to_string()
    }

    fn broadcast(&mut self) {
        // Events go out every tick so shots and hits feel immediate.
        if !self.events.is_empty() || !self.private.is_empty() {
            let global = self.events.join(",");
            for (conn, _) in &self.conns {
                let pid = self.conn_player.get(conn).copied().unwrap_or(0);
                let mut s = String::with_capacity(global.len() + 64);
                s.push_str("{\"t\":\"e\",\"ev\":[");
                s.push_str(&global);
                for (to, e) in &self.private {
                    if *to == pid {
                        if !s.ends_with('[') {
                            s.push(',');
                        }
                        s.push_str(e);
                    }
                }
                s.push_str("]}");
                if s.len() > 20 {
                    self.send(*conn, s);
                }
            }
            self.events.clear();
            self.private.clear();
        }
        if self.roster_dirty || self.tick_n % 120 == 0 {
            self.roster_dirty = false;
            let r = self.roster();
            for conn in self.conns.keys() {
                self.send(*conn, r.clone());
            }
        }
        if self.tick_n % 2 != 0 {
            return;
        }

        let mut c = String::with_capacity(2048);
        let ph = match self.phase {
            Phase::Freeze => 0,
            Phase::Live => 1,
            Phase::End => 2,
            Phase::MatchEnd => 3,
        };
        let _ = write!(c, "\"tm\":{:.3},\"ph\":{},\"pt\":{:.1},\"sc\":[{},{}],\"rd\":{},",
            self.time, ph, self.phase_t.max(0.0), self.score[0], self.score[1], self.round);
        match &self.planted {
            Some(b) => {
                let _ = write!(c, "\"bomb\":[{:.2},{:.2},{:.2},{:.1},{}],", b.pos[0], b.pos[1], b.pos[2], b.timer, b.site);
            }
            None => c.push_str("\"bomb\":null,"),
        }
        c.push_str("\"pl\":[");
        for (k, p) in self.players.iter().enumerate() {
            let flags = p.st.crouch as u8
                | (p.has_bomb as u8) << 1
                | ((p.scoped > 0) as u8) << 2
                | ((p.defuse_t > 0.0) as u8) << 3
                | ((p.plant_t > 0.0) as u8) << 4;
            let _ = write!(c, "{}[{},{},{},{:.2},{:.2},{:.2},{:.3},{:.3},{},{},{}]",
                if k > 0 { "," } else { "" }, p.id, p.team, p.alive as u8,
                p.st.pos[0], p.st.pos[1], p.st.pos[2], p.yaw, p.pitch, p.hp.max(0), p.cur_weapon(), flags);
        }
        c.push_str("],\"it\":[");
        for (k, it) in self.items.iter().enumerate() {
            let _ = write!(c, "{}[{},{},{:.2},{:.2},{:.2}]", if k > 0 { "," } else { "" },
                it.id, it.w, it.pos[0], it.pos[1], it.pos[2]);
        }
        c.push_str("],\"nd\":[");
        for (k, n) in self.nades.iter().enumerate() {
            let _ = write!(c, "{}[{},{},{:.2},{:.2},{:.2}]", if k > 0 { "," } else { "" },
                n.id, n.kind, n.pos[0], n.pos[1], n.pos[2]);
        }
        c.push_str("],\"sm\":[");
        for (k, s) in self.smokes.iter().enumerate() {
            let _ = write!(c, "{}[{:.2},{:.2},{:.2},{:.1}]", if k > 0 { "," } else { "" },
                s.pos[0], s.pos[1], s.pos[2], s.t);
        }
        c.push(']');

        for conn in self.conns.keys() {
            let me = self.conn_player.get(conn).and_then(|id| self.idx(*id)).map(|i| &self.players[i]);
            let mut s = String::with_capacity(c.len() + 400);
            s.push_str("{\"t\":\"s\",");
            s.push_str(&c);
            match me {
                None => s.push_str(",\"me\":null}"),
                Some(p) => {
                    let st = p.st.to_array();
                    let g = p.gun();
                    let w = |g: &Option<Gun>| g.map(|g| g.w as i32).unwrap_or(-1);
                    let _ = write!(s,
                        ",\"me\":{{\"st\":[{},{},{},{},{},{},{},{},{}],\"ack\":{},\"hp\":{},\"ar\":{},\"he\":{},\"mo\":{},\"sl\":{},\"w\":{},\"am\":{},\"rs\":{},\"pr\":{},\"se\":{},\"nd\":[{},{},{}],\"bm\":{},\"kit\":{},\"rl\":{:.2},\"sc\":{},\"pl\":{:.2},\"df\":{:.2},\"cb\":{}}}}}",
                        st[0], st[1], st[2], st[3], st[4], st[5], st[6], st[7], st[8],
                        p.ack, p.hp.max(0), p.armor, p.helmet, p.money, p.slot, p.cur_weapon(),
                        g.map(|g| g.ammo).unwrap_or(0), g.map(|g| g.reserve).unwrap_or(0),
                        w(&p.prim), w(&p.sec), p.nades[0], p.nades[1], p.nades[2],
                        p.has_bomb, p.kit, p.reload_t, p.scoped,
                        p.plant_t / PLANT_TIME, p.defuse_t / if p.kit { 5.0 } else { 10.0 },
                        self.can_buy(p));
                }
            }
            self.send(*conn, s);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn play_round(g: &mut Game, winner: u8) {
        g.phase = Phase::Live;
        g.end_round(winner, "time");
        g.phase_t = 0.0;
        g.update_phase(0.0);
    }

    #[test]
    fn half_time_swaps_sides_and_sixteen_wins() {
        let mut g = Game::new();
        let (id, team) = (g.players[0].id, g.players[0].team);
        for _ in 0..15 {
            play_round(&mut g, ATK);
        }
        let i = g.idx(id).unwrap();
        assert_eq!(g.players[i].team, 3 - team, "sides swap after round 15");
        assert_eq!(g.score, [0, 15], "score follows the players");
        assert_eq!(g.players[i].money, START_MONEY);
        assert!(g.phase == Phase::Freeze);
        g.phase = Phase::Live;
        g.end_round(DEF, "time");
        assert!(g.phase == Phase::MatchEnd && g.score == [0, 16]);
    }

    #[test]
    fn spray_pattern_climbs_then_sways() {
        let (s0, u0) = recoil_offset(0.01, 0.0);
        let (s3, u3) = recoil_offset(0.01, 3.0);
        let (s8, u8_) = recoil_offset(0.01, 8.0);
        assert_eq!((s0, u0, s3), (0.0, 0.0, 0.0));
        assert!(u3 > 0.0 && u8_ > u3 && s8.abs() > 0.0);
    }
}
