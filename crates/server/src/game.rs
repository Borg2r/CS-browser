//! Match state and rules: rounds, economy, weapons, grenades, the charge.
use crate::bot::{self, Bot, Difficulty};
use crate::nav::Nav;
use serde::Deserialize;
use serde_json::json;
use sim::map::{map, map_by_id, Map, MapId};
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

// Keep serialization dependencies out of the shared WASM simulation crate.
fn deserialize_map<'de, D: serde::Deserializer<'de>>(d: D) -> Result<MapId, D::Error> {
    let id = String::deserialize(d)?;
    MapId::from_id(&id).ok_or_else(|| serde::de::Error::custom("unknown map"))
}

fn deserialize_optional_map<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<MapId>, D::Error> {
    Option::<String>::deserialize(d)?.map(|id| {
        MapId::from_id(&id).ok_or_else(|| serde::de::Error::custom("unknown map"))
    }).transpose()
}

#[derive(Deserialize)]
#[serde(tag = "t")]
pub enum ClientMsg {
    #[serde(rename = "join")]
    Join {
        name: String,
        team: u8,
        #[serde(default)]
        difficulty: Option<Difficulty>,
        #[serde(default, deserialize_with = "deserialize_optional_map")]
        map: Option<MapId>,
    },
    #[serde(rename = "set_difficulty")]
    SetDifficulty { difficulty: Difficulty },
    #[serde(rename = "set_map")]
    SetMap { #[serde(deserialize_with = "deserialize_map")] map: MapId },
    #[serde(rename = "restart_round")]
    RestartRound { #[serde(rename = "roundId")] round_id: u64 },
    #[serde(rename = "skip_round")]
    SkipRound { #[serde(rename = "roundId")] round_id: u64 },
    #[serde(rename = "in")]
    Input {
        s: u32,
        b: u32,
        y: f32,
        p: f32,
        d: f32,
        #[serde(default)]
        it: f64,
        #[serde(default, deserialize_with = "deserialize_optional_map")]
        map: Option<MapId>,
        #[serde(default, rename = "roundId")]
        round_id: Option<u64>,
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
    /// Loaded rounds in the left gun. Right rounds = ammo - left_ammo.
    pub left_ammo: u16,
    /// Installed attachment: 0 none, 1 red dot, 2 ACOG.
    pub optic: u8,
}

impl Gun {
    pub fn new(w: usize) -> Gun {
        let def = &WEAPONS[w];
        Gun { w, ammo: def.mag, reserve: def.reserve, left_ammo: if def.dual { def.mag / 2 } else { 0 }, optic: 0 }
    }

    pub fn effective_zoom(&self) -> f32 {
        OPTICS.iter().find(|o| o.index == self.optic)
            .map(|o| o.zoom).unwrap_or(WEAPONS[self.w].zoom)
    }

    fn ammo_hand(&self, hand: usize) -> u16 {
        if hand == 0 { self.left_ammo } else { self.ammo - self.left_ammo }
    }

    fn consume(&mut self, hand: usize) -> bool {
        if self.ammo_hand(hand) == 0 { return false; }
        self.ammo -= 1;
        if hand == 0 { self.left_ammo -= 1; }
        true
    }

    fn reload(&mut self) {
        let def = &WEAPONS[self.w];
        if def.dual {
            let mut rounds = [self.left_ammo, self.ammo - self.left_ammo];
            for loaded in &mut rounds {
                let take = (def.mag / 2 - *loaded).min(self.reserve);
                *loaded += take;
                self.reserve -= take;
            }
            self.left_ammo = rounds[0];
            self.ammo = rounds[0] + rounds[1];
        } else {
            let take = (def.mag - self.ammo).min(self.reserve);
            self.ammo += take;
            self.reserve -= take;
        }
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

/// Starting equipment and economy, before purchases or rewards in this round.
/// Restarts restore these values instead of creating money from aborted rounds.
#[derive(Clone, Copy)]
struct RoundPlayer {
    id: u32,
    money: u32,
    kills: u32,
    deaths: u32,
    prim: Option<Gun>,
    sec: Option<Gun>,
    nades: [u8; 3],
    kit: bool,
    armor: i32,
    helmet: bool,
}

impl RoundPlayer {
    fn capture(p: &Player) -> Self {
        Self { id: p.id, money: p.money, kills: p.kills, deaths: p.deaths,
            prim: p.prim, sec: p.sec, nades: p.nades, kit: p.kit,
            armor: p.armor, helmet: p.helmet }
    }

    fn restore(self, p: &mut Player) {
        p.money = self.money; p.kills = self.kills; p.deaths = self.deaths;
        p.prim = self.prim; p.sec = self.sec; p.nades = self.nades;
        p.kit = self.kit; p.armor = self.armor; p.helmet = self.helmet;
        p.alive = true;
    }
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
    /// Actual bolt cycle only; equip delays must not prevent aiming in freeze time.
    bolt_t: f32,
    hand_cooldown: [f32; 2],
    hand_shots: [f32; 2],
    hand_since_shot: [f32; 2],
    pub reload_t: f32,
    pub shots: f32,
    pub since_shot: f32,
    /// 0 hip fire, 1 aiming while the secondary trigger is held.
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
            slot: 2, cooldown: 0.0, bolt_t: 0.0, hand_cooldown: [0.0; 2], hand_shots: [0.0; 2], hand_since_shot: [9.0; 2], reload_t: 0.0, shots: 0.0, since_shot: 9.0, scoped: 0,
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

    fn update_aim(&mut self) {
        let def = &WEAPONS[self.cur_weapon()];
        self.scoped = u8::from(self.alive && def.ads && !def.dual && self.buttons & B_FIRE2 != 0
            && self.reload_t <= 0.0 && self.plant_t <= 0.0 && self.defuse_t <= 0.0
            && (!def.bolt_action || self.bolt_t <= 0.0));
    }

    pub fn max_speed(&self) -> f32 {
        let w = &WEAPONS[self.cur_weapon()];
        if self.scoped > 0 && self.gun().is_some_and(|g| g.effective_zoom() > 0.0) { w.speed * 0.6 } else { w.speed }
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
    pub left_ammo: u16,
    pub optic: u8,
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
    pub difficulty: Difficulty,
    pub phase_t: f32,
    live_elapsed: f32,
    pub score: [u32; 2],
    loss_streak: [u32; 2],
    round: u32,
    round_id: u64,
    round_players: Vec<RoundPlayer>,
    skipping: bool,
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
            difficulty: Difficulty::default(),
            phase_t: FREEZE_TIME,
            live_elapsed: 0.0,
            score: [0; 2],
            loss_streak: [0; 2],
            round: 0,
            round_id: 0,
            round_players: Vec::new(),
            skipping: false,
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

    fn host(&self) -> Option<&Player> {
        // Human players retain join order when bots are replaced or teams swap.
        self.players.iter().find(|p| p.conn.is_some())
    }

    fn settings(&self, conn: u32) -> String {
        let host = self.host();
        json!({
            "t": "settings",
            "difficulty": self.difficulty.id(),
            "map": self.map.id.id(),
            "host": host.map(|p| p.id),
            "hostName": host.map(|p| p.name.as_str()),
            "canChange": host.is_some_and(|p| p.conn == Some(conn)),
        }).to_string()
    }

    fn broadcast_settings(&self) {
        for &conn in self.conns.keys() {
            self.send(conn, self.settings(conn));
        }
    }

    fn set_difficulty(&mut self, conn: u32, difficulty: Difficulty) {
        if !self.host().is_some_and(|p| p.conn == Some(conn)) {
            self.send(conn, json!({
                "t": "settings_error",
                "m": "Only the match host can change bot difficulty.",
            }).to_string());
            self.send(conn, self.settings(conn));
            return;
        }
        self.difficulty = difficulty;
        self.broadcast_settings();
    }

    fn set_map(&mut self, conn: u32, map: MapId) {
        if !self.host().is_some_and(|p| p.conn == Some(conn)) {
            self.send(conn, json!({
                "t": "settings_error",
                "m": "Only the match host can change the map.",
            }).to_string());
            self.send(conn, self.settings(conn));
            return;
        }
        if self.map.id != map {
            self.change_map(map);
        }
        self.broadcast_settings();
    }

    fn can_restart(&self, conn: u32) -> bool {
        !self.skipping && matches!(self.phase, Phase::Freeze | Phase::Live)
            && self.host().is_some_and(|p| p.conn == Some(conn))
    }

    fn can_skip(&self, conn: u32) -> bool {
        !self.skipping && self.phase == Phase::Live
            && self.players.iter().any(|p| p.conn == Some(conn) && !p.alive)
            && !self.players.iter().any(|p| p.conn.is_some() && p.alive)
            && self.players.iter().any(|p| p.bot.is_some() && p.alive)
    }

    fn round_error(&self, conn: u32, message: &str) {
        self.send(conn, json!({"t": "round_error", "m": message}).to_string());
    }

    fn restart_round(&mut self, conn: u32, round_id: u64) {
        if round_id != self.round_id {
            self.round_error(conn, "The round has changed. Try again.");
            return;
        }
        if !self.can_restart(conn) {
            self.round_error(conn, "Only the host can restart an active round, while no skip is running.");
            return;
        }
        self.events.clear();
        self.private.clear();
        self.swap_pending = false;
        for p in &mut self.players {
            if let Some(checkpoint) = self.round_players.iter().find(|r| r.id == p.id) {
                checkpoint.restore(p);
            } else {
                // A player who joined after the round began starts with their
                // normal pistol and money, never the previous player's gear.
                p.money = START_MONEY;
                p.kills = 0;
                p.deaths = 0;
                p.alive = false;
            }
        }
        self.begin_round(false);
        self.broadcast_inner(true);
    }

    fn skip_round(&mut self, conn: u32, round_id: u64) {
        if round_id != self.round_id {
            self.round_error(conn, "The round has changed. Try again.");
            return;
        }
        if !self.can_skip(conn) {
            self.round_error(conn, "You can skip only when all human players are dead and bots are still playing.");
            return;
        }
        self.skipping = true;
        self.events.clear();
        self.private.clear();
        self.clear_round_inputs();
        // Acknowledge before simulating; the menu can show progress even when
        // the bot round needs several bounded batches to finish.
        self.broadcast_inner(true);
    }

    fn clear_round_inputs(&mut self) {
        for p in &mut self.players {
            p.cmds.clear();
            p.budget = 0.0;
            p.buttons = 0;
            p.prev_buttons = 0;
            p.interp_time = self.time;
            p.hist.clear();
        }
    }

    fn change_map(&mut self, map: MapId) {
        self.map = map_by_id(map);
        self.nav = Nav::build(self.map);
        // Nothing from the old arena may replay into the fresh match, including
        // halftime swaps, private hit events or lag-compensation positions.
        self.swap_pending = false;
        self.events.clear();
        self.private.clear();
        for p in &mut self.players {
            p.cmds.clear();
            p.budget = 0.0;
            p.interp_time = self.time;
            p.hist.clear();
        }
        self.reset_match();
        self.roster_dirty = true;
        let hello = self.hello();
        for &conn in self.conns.keys() {
            self.send(conn, hello.clone());
        }
    }

    // ---------------------------------------------------------------- lobby

    pub fn handle(&mut self, m: Incoming) {
        match m {
            Incoming::Connect(conn, tx) => {
                self.conns.insert(conn, tx);
                self.send(conn, self.hello());
                self.send(conn, self.settings(conn));
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
                self.broadcast_settings();
            }
            Incoming::Msg(conn, msg) => self.on_msg(conn, msg),
        }
    }

    fn on_msg(&mut self, conn: u32, msg: ClientMsg) {
        let pi = self.conn_player.get(&conn).and_then(|id| self.idx(*id));
        match (msg, pi) {
            (ClientMsg::Join { name, team, difficulty, map }, None) => self.join(conn, name, team, difficulty, map),
            (ClientMsg::SetDifficulty { difficulty }, _) => self.set_difficulty(conn, difficulty),
            (ClientMsg::SetMap { map }, _) => self.set_map(conn, map),
            (ClientMsg::RestartRound { round_id }, _) => self.restart_round(conn, round_id),
            (ClientMsg::SkipRound { round_id }, _) => self.skip_round(conn, round_id),
            (ClientMsg::Input { s, b, y, p, d, it, map, round_id }, Some(i)) => {
                if map.is_some_and(|id| id != self.map.id)
                    || round_id.is_some_and(|id| id != self.round_id) { return; }
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

    fn join(&mut self, conn: u32, name: String, want: u8, difficulty: Option<Difficulty>, map: Option<MapId>) {
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
            if let Some(difficulty) = difficulty {
                self.difficulty = difficulty;
            }
            match map {
                Some(map) if map != self.map.id => self.change_map(map),
                _ => self.reset_match(),
            }
        } else if self.phase == Phase::Freeze {
            let i = self.players.len() - 1;
            let n = self.rng.below(64);
            self.spawn(i, n);
        }
        self.broadcast_settings();
    }

    fn remove_player(&mut self, i: usize) {
        if self.players[i].alive && self.players[i].has_bomb {
            self.players[i].has_bomb = false;
            let pos = self.players[i].st.pos;
            self.drop_item(Gun::new(BOMB), pos, 0);
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
        self.swap_pending = false;
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
            let optic = g.optic;
            *g = Gun::new(g.w);
            g.optic = optic;
        }
        if p.sec.is_none() {
            p.sec = Some(Gun::new(default_pistol));
        }
        p.alive = true;
        p.hp = 100;
        p.has_bomb = false;
        p.st = PState { pos: [sp[0], 0.01, sp[1]], ..Default::default() };
        p.yaw = self.map.spawn_yaw((team - 1) as usize, sp);
        p.pitch = 0.0;
        p.buttons = 0;
        p.prev_buttons = 0;
        p.cooldown = 0.0;
        p.hand_cooldown = [0.0; 2];
        p.hand_shots = [0.0; 2];
        p.hand_since_shot = [9.0; 2];
        p.reload_t = 0.0;
        p.shots = 0.0;
        p.scoped = 0;
        p.bolt_t = 0.0;
        p.plant_t = 0.0;
        p.defuse_t = 0.0;
        p.flash_t = 0.0;
        p.hist.clear();
        p.slot = p.best_slot();
    }

    fn start_round(&mut self) {
        self.begin_round(true);
    }

    fn begin_round(&mut self, advance: bool) {
        self.fill_bots();
        if advance { self.round += 1; }
        self.round_id = self.round_id.wrapping_add(1);
        self.skipping = false;
        self.clear_round_inputs();
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
        self.round_players = self.players.iter().map(RoundPlayer::capture).collect();
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
        p.bolt_t = 0.0;
        p.plant_t = 0.0;
        p.shots = 0.0;
        p.hand_cooldown = [0.0; 2];
        p.hand_shots = [0.0; 2];
        p.cooldown = p.cooldown.max(0.35);
    }

    pub fn buy(&mut self, i: usize, item: &str) -> bool {
        if !self.can_buy(&self.players[i]) {
            return false;
        }
        let p = &mut self.players[i];
        if let Some(optic) = OPTICS.iter().find(|optic| optic.id == item) {
            let Some(gun) = p.gun() else { return false };
            if !WEAPONS[gun.w].accepts_optic(optic.index) || gun.optic == optic.index || p.money < optic.price {
                return false;
            }
            p.gun_mut().unwrap().optic = optic.index;
            p.money -= optic.price;
            p.reload_t = 0.0;
            p.scoped = 0;
            p.cooldown = p.cooldown.max(0.35);
            return true;
        }
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
                        p.bolt_t = 0.0;
                        p.shots = 0.0;
                        p.hand_cooldown = [0.0; 2];
                        p.hand_shots = [0.0; 2];
                        p.cooldown = 0.35;
                    }
                }
                p.money -= def.price;
            }
        }
        let (pos, id) = (p.st.pos, p.id);
        if let Some(g) = dropped {
            self.drop_item(g, pos, id);
        }
        true
    }

    fn drop_item(&mut self, gun: Gun, pos: V3, by: u32) {
        let o = [pos[0], pos[1] + 0.6, pos[2]];
        let y = o[1] - ray_world(self.map, &o, &[0.0, -1.0, 0.0], 50.0);
        let id = self.id();
        self.items.push(Item {
            id, w: gun.w, ammo: gun.ammo, reserve: gun.reserve, left_ammo: gun.left_ammo, optic: gun.optic,
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
                Some(Gun::new(BOMB))
            }
            _ => None,
        };
        let Some(g) = gun else { return };
        p.slot = p.best_slot();
        p.reload_t = 0.0;
        p.scoped = 0;
        p.bolt_t = 0.0;
        p.plant_t = 0.0;
        p.shots = 0.0;
        p.since_shot = 9.0;
        p.hand_cooldown = [0.0; 2];
        p.hand_shots = [0.0; 2];
        p.hand_since_shot = [9.0; 2];
        p.cooldown = p.cooldown.max(0.35);
        if collides(self.map, &pos, 0.5) {
            pos = self.players[i].st.pos;
        }
        self.drop_item(g, pos, id);
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
                    let g = Gun { w: it.w, ammo: it.ammo, reserve: it.reserve, left_ammo: it.left_ammo, optic: it.optic };
                    match slot {
                        6 => p.has_bomb = true,
                        0 => {
                            p.prim = Some(g);
                            if p.slot != 6 {
                                p.slot = 0;
                                p.reload_t = 0.0;
                                p.scoped = 0;
                                p.bolt_t = 0.0;
                                p.shots = 0.0;
                                p.since_shot = 9.0;
                                p.hand_cooldown = [0.0; 2];
                                p.hand_shots = [0.0; 2];
                                p.hand_since_shot = [9.0; 2];
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

    fn shoot(&mut self, i: usize, hand: usize) {
        let (w, origin, yaw, pitch, team, id, shots, speed, ground, crouch, scoped, zoom, at) = {
            let p = &mut self.players[i];
            let w = p.cur_weapon();
            let Some(g) = p.gun_mut() else { return };
            if !g.consume(hand) { return; }
            let def = &WEAPONS[w];
            let shots = if def.dual { p.hand_shots[hand] } else { p.shots };
            if def.dual {
                p.hand_shots[hand] += 1.0;
                p.hand_since_shot[hand] = 0.0;
                p.hand_cooldown[hand] = def.interval;
            } else {
                p.shots += 1.0;
                p.cooldown = def.interval;
                if def.bolt_action { p.bolt_t = def.interval; }
            }
            p.since_shot = 0.0;
            let at = if p.conn.is_some() && p.interp_time > 0.0 {
                p.interp_time.clamp(self.time - 0.4, self.time)
            } else {
                self.time
            };
            (w, p.st.eye(), p.yaw, p.pitch, p.team, p.id, shots,
             p.st.vel[0].hypot(p.st.vel[2]), p.st.ground, p.st.crouch, p.scoped > 0, p.gun().unwrap().effective_zoom(), at)
        };
        let def = &WEAPONS[w];
        let mv = (speed / def.speed).min(1.0);
        let light = matches!(def.class, C_PISTOL | C_SMG | C_SHOTGUN);
        let mut spread = def.spread + (shots * def.spread_inc).min(def.spread_max);
        if def.class == C_SNIPER && zoom >= 4.0 && !scoped {
            spread += 0.08;
        }
        spread = spread * (1.0 + 1.5 * mv) + if light { 0.012 } else { 0.035 } * mv * mv;
        if !ground {
            spread += if light { 0.03 } else { 0.07 };
        }
        if crouch {
            spread *= 0.75;
        }
        if scoped && def.ads && zoom > 0.0 { spread *= 0.62; }
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
                let dmg = def.damage_at(best_t) * mult * through;
                self.damage(j, Some(i), dmg, w, zone);
            }
        }
        if def.bolt_action { self.players[i].scoped = 0; }
        self.events.push(format!(
            "{{\"t\":\"shot\",\"id\":{},\"w\":{},\"hand\":{},\"o\":[{:.2},{:.2},{:.2}],\"h\":[{}]}}",
            id, w, hand, origin[0], origin[1], origin[2], ends
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
            (v.st.pos, v.id, v.prim.take().or_else(|| v.sec.take()), bomb)
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
            self.drop_item(g, pos, 0);
        }
        if bomb {
            self.drop_item(Gun::new(BOMB), [pos[0] + 0.4, pos[1], pos[2] + 0.3], 0);
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
        let cycling = p.bolt_t > 0.0;
        p.bolt_t = (p.bolt_t - dt).max(0.0);
        if cycling && p.bolt_t == 0.0 { p.shots = 0.0; }
        p.flash_t = (p.flash_t - dt).max(0.0);
        p.since_shot += dt;
        let w = p.cur_weapon();
        let def = &WEAPONS[w];
        for hand in 0..2 {
            p.hand_cooldown[hand] = (p.hand_cooldown[hand] - dt).max(0.0);
            p.hand_since_shot[hand] += dt;
            if p.hand_since_shot[hand] > (def.interval * 1.7).max(0.2) {
                p.hand_shots[hand] = (p.hand_shots[hand] - dt * 14.0).max(0.0);
            }
        }
        if p.since_shot > (def.interval * 1.7).max(0.2) {
            p.shots = (p.shots - dt * 14.0).max(0.0);
        }
        let fire = p.buttons & B_FIRE != 0;
        let pressed = fire && p.prev_buttons & B_FIRE == 0;
        let right_fire = p.buttons & B_FIRE2 != 0;
        let right_pressed = right_fire && p.prev_buttons & B_FIRE2 == 0;
        p.update_aim();
        let reload = p.buttons & B_RELOAD != 0;
        let using = p.buttons & B_USE != 0;
        p.prev_buttons = p.buttons;

        // Defusing takes priority over everything else.
        let mut defusing = false;
        if let (Some(bp), true, DEF) = (bomb_pos, using, p.team) {
            defusing = dist(&bp, &p.st.pos) < 1.8 && p.st.ground;
        }
        if defusing {
            p.scoped = 0;
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
            Shoot(u8),
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
                if p.reload_t > 0.0 {
                    p.scoped = 0;
                    p.reload_t = (p.reload_t - dt).max(0.0);
                    if p.reload_t == 0.0 {
                        if let Some(g) = p.gun_mut() { g.reload(); }
                    }
                } else if let Some(g) = p.gun().copied() {
                    if (reload || g.ammo == 0) && g.ammo < def.mag && g.reserve > 0 && p.cooldown <= 0.0 {
                        p.reload_t = def.reload;
                        p.scoped = 0;
                        p.shots = 0.0;
                        p.hand_shots = [0.0; 2];
                        self.events.push(format!("{{\"t\":\"reload\",\"id\":{}}}", p.id));
                    } else if p.cooldown <= 0.0 {
                        if def.dual {
                            let mut hands = 0;
                            for (hand, held, down) in [(0, fire, pressed), (1, right_fire, right_pressed)] {
                                if (down || (def.auto && held)) && p.hand_cooldown[hand] <= 0.0 && g.ammo_hand(hand) > 0 {
                                    hands |= 1 << hand;
                                }
                            }
                            if hands != 0 { act = Act::Shoot(hands); }
                        } else if ((def.auto && fire) || pressed) && g.ammo > 0 {
                            act = Act::Shoot(1 << 1);
                        }
                    }
                }
            }
        }
        match act {
            Act::Shoot(hands) => {
                for hand in 0..2 {
                    if hands & (1 << hand) != 0 { self.shoot(i, hand); }
                }
            }
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
        if self.skipping {
            self.advance_skipped_round();
        } else {
            self.simulate_tick();
            self.broadcast();
        }
    }

    fn advance_skipped_round(&mut self) {
        // Keep the socket loop responsive: at most two simulated seconds or
        // four milliseconds of work in each real server tick. No intermediate
        // shots, hit markers or snapshots are sent during this acceleration.
        let started = std::time::Instant::now();
        for _ in 0..120 {
            self.simulate_tick();
            self.private.clear();
            if self.phase != Phase::Live {
                self.events.retain(|e| e.contains("\"t\":\"end\""));
                // Use the ordinary transition, including halftime and match
                // victory, exactly once. begin_round stops acceleration.
                self.phase_t = 0.0;
                self.update_phase(0.0);
                self.broadcast_inner(true);
                break;
            }
            self.events.clear();
            if started.elapsed() >= std::time::Duration::from_millis(4) {
                break;
            }
        }
    }

    fn simulate_tick(&mut self) {
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
                    p.update_aim();
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
                    p.update_aim();
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
                       "dmg": w.dmg, "pellets": w.pellets, "dual": w.dual, "ads": w.ads,
                       "boltAction": w.bolt_action, "optics": OPTICS.iter().filter(|o| w.accepts_optic(o.index)).map(|o| o.index).collect::<Vec<_>>()})
            })
            .collect();
        let metadata = |id: MapId| json!({
            "id": id.id(), "index": id.index(), "name": id.name(),
            "theme": id.theme(), "description": id.description(),
        });
        let maps: Vec<_> = MapId::ALL.into_iter().map(metadata).collect();
        let mut map = metadata(self.map.id);
        map["boxes"] = json!(boxes);
        map["sites"] = json!(sites);
        map["w"] = json!(self.map.w);
        map["h"] = json!(self.map.h);
        let optics: Vec<_> = OPTICS.iter().map(|o| json!({"index": o.index, "id": o.id, "name": o.name, "price": o.price, "zoom": o.zoom})).collect();
        json!({"t": "hello", "map": map, "maps": maps,
               "weapons": weapons, "optics": optics, "win": WIN_ROUNDS, "teamSize": self.team_size})
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
        self.broadcast_inner(false);
    }

    fn broadcast_inner(&mut self, force_snapshot: bool) {
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
        if !force_snapshot && self.tick_n % 2 != 0 {
            return;
        }

        let mut c = String::with_capacity(2048);
        let ph = match self.phase {
            Phase::Freeze => 0,
            Phase::Live => 1,
            Phase::End => 2,
            Phase::MatchEnd => 3,
        };
        let buy_seconds = match self.phase {
            Phase::Freeze => self.phase_t.max(0.0) + BUY_TIME,
            Phase::Live => (BUY_TIME - self.live_elapsed).max(0.0),
            _ => 0.0,
        };
        let _ = write!(c, "\"map\":\"{}\",\"buySeconds\":{:.1},\"tm\":{:.3},\"ph\":{},\"pt\":{:.1},\"sc\":[{},{}],\"rd\":{},\"roundId\":{},\"skipping\":{},",
            self.map.id.id(), buy_seconds, self.time, ph, self.phase_t.max(0.0), self.score[0], self.score[1], self.round,
            self.round_id, self.skipping);
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
            let _ = write!(c, "{}[{},{},{},{:.2},{:.2},{:.2},{:.3},{:.3},{},{},{},{}]",
                if k > 0 { "," } else { "" }, p.id, p.team, p.alive as u8,
                p.st.pos[0], p.st.pos[1], p.st.pos[2], p.yaw, p.pitch, p.hp.max(0), p.cur_weapon(), flags, p.gun().map(|g| g.optic).unwrap_or(0));
        }
        c.push_str("],\"it\":[");
        for (k, it) in self.items.iter().enumerate() {
            let _ = write!(c, "{}[{},{},{:.2},{:.2},{:.2},{}]", if k > 0 { "," } else { "" },
                it.id, it.w, it.pos[0], it.pos[1], it.pos[2], it.optic);
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
            let _ = write!(s, ",\"canRestart\":{},\"canSkip\":{}", self.can_restart(*conn), self.can_skip(*conn));
            match me {
                None => s.push_str(",\"me\":null}"),
                Some(p) => {
                    let st = p.st.to_array();
                    let g = p.gun();
                    let w = |g: &Option<Gun>| g.map(|g| g.w as i32).unwrap_or(-1);
                    let _ = write!(s,
                        ",\"me\":{{\"st\":[{},{},{},{},{},{},{},{},{}],\"ack\":{},\"hp\":{},\"ar\":{},\"he\":{},\"mo\":{},\"sl\":{},\"w\":{},\"am\":{},\"amL\":{},\"amR\":{},\"rs\":{},\"pr\":{},\"se\":{},\"nd\":[{},{},{}],\"bm\":{},\"kit\":{},\"rl\":{:.2},\"sc\":{},\"pl\":{:.2},\"df\":{:.2},\"cb\":{},\"optic\":{},\"prOptic\":{},\"seOptic\":{},\"zoom\":{}}}}}",
                        st[0], st[1], st[2], st[3], st[4], st[5], st[6], st[7], st[8],
                        p.ack, p.hp.max(0), p.armor, p.helmet, p.money, p.slot, p.cur_weapon(),
                        g.map(|g| g.ammo).unwrap_or(0), g.map(|g| g.ammo_hand(0)).unwrap_or(0),
                        g.map(|g| g.ammo_hand(1)).unwrap_or(0), g.map(|g| g.reserve).unwrap_or(0),
                        w(&p.prim), w(&p.sec), p.nades[0], p.nades[1], p.nades[2],
                        p.has_bomb, p.kit, p.reload_t, p.scoped,
                        p.plant_t / PLANT_TIME, p.defuse_t / if p.kit { 5.0 } else { 10.0 },
                        self.can_buy(p), g.map(|g| g.optic).unwrap_or(0),
                        p.prim.map(|g| g.optic).unwrap_or(0), p.sec.map(|g| g.optic).unwrap_or(0),
                        g.map(|g| g.effective_zoom()).unwrap_or(0.0));
                }
            }
            self.send(*conn, s);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn connect_player(g: &mut Game, conn: u32) -> mpsc::Receiver<String> {
        let (tx, rx) = mpsc::channel(64);
        g.handle(Incoming::Connect(conn, tx));
        rx
    }

    fn join_player(g: &mut Game, conn: u32, name: &str, difficulty: Option<Difficulty>) {
        g.handle(Incoming::Msg(conn, ClientMsg::Join { name: name.into(), team: ATK, difficulty, map: None }));
    }

    fn messages(rx: &mut mpsc::Receiver<String>) -> Vec<serde_json::Value> {
        let mut out = Vec::new();
        while let Ok(message) = rx.try_recv() {
            out.push(serde_json::from_str(&message).unwrap());
        }
        out
    }

    fn latest_settings(rx: &mut mpsc::Receiver<String>) -> serde_json::Value {
        messages(rx).into_iter().rev().find(|m| m["t"] == "settings").unwrap()
    }

    #[test]
    fn first_human_owns_settings_and_initial_preference_is_optional() {
        let mut g = Game::new();
        let mut rx = connect_player(&mut g, 50);
        let initial = messages(&mut rx);
        assert_eq!(initial[0]["t"], "hello");
        assert_eq!(initial[1], json!({"t": "settings", "difficulty": "medium", "map": "sirocco", "host": null,
                                    "hostName": null, "canChange": false}));
        join_player(&mut g, 50, "Host", None);
        let settings = latest_settings(&mut rx);
        assert_eq!(settings["difficulty"], "medium");
        assert_eq!(settings["host"], g.conn_player[&50]);
        assert_eq!(settings["hostName"], "Host");
        assert_eq!(settings["canChange"], true);
        g.handle(Incoming::Disconnect(50));

        let mut next = connect_player(&mut g, 60);
        join_player(&mut g, 60, "Next host", Some(Difficulty::Expert));
        assert_eq!(latest_settings(&mut next)["difficulty"], "expert");
        g.handle(Incoming::Disconnect(60));
        let mut last = connect_player(&mut g, 70);
        join_player(&mut g, 70, "No preference", None);
        assert_eq!(latest_settings(&mut last)["difficulty"], "expert");
    }

    #[test]
    fn guests_and_unjoined_visitors_cannot_change_match_difficulty() {
        let mut g = Game::new();
        let mut host = connect_player(&mut g, 50);
        join_player(&mut g, 50, "Host", Some(Difficulty::Hard));
        let mut guest = connect_player(&mut g, 30);
        messages(&mut guest);
        g.handle(Incoming::Msg(30, ClientMsg::SetDifficulty { difficulty: Difficulty::Easy }));
        let rejected = messages(&mut guest);
        assert_eq!(rejected.len(), 2);
        assert_eq!(rejected[0], json!({"t": "settings_error", "m": "Only the match host can change bot difficulty."}));
        assert_eq!(rejected[1]["difficulty"], "hard");
        assert_eq!(rejected[1]["canChange"], false);
        join_player(&mut g, 30, "Guest", Some(Difficulty::Easy));
        assert_eq!(latest_settings(&mut guest)["difficulty"], "hard");
        g.handle(Incoming::Msg(30, ClientMsg::SetDifficulty { difficulty: Difficulty::Easy }));
        let rejected = messages(&mut guest);
        assert_eq!(rejected[0]["t"], "settings_error");
        assert_eq!(rejected[1]["difficulty"], "hard");
        assert_eq!(g.difficulty, Difficulty::Hard);

        // Reconnecting is still joining an existing match, not becoming its host.
        g.handle(Incoming::Disconnect(30));
        let mut reconnected = connect_player(&mut g, 31);
        join_player(&mut g, 31, "Guest again", Some(Difficulty::Expert));
        let settings = latest_settings(&mut reconnected);
        assert_eq!(settings["difficulty"], "hard");
        assert_eq!(settings["host"], g.conn_player[&50]);
        assert_eq!(settings["canChange"], false);
        assert_eq!(latest_settings(&mut host)["canChange"], true);
    }

    #[test]
    fn host_transfer_follows_human_join_order_and_broadcasts_permissions() {
        let mut g = Game::new();
        g.team_size = 3;
        let mut observer = connect_player(&mut g, 90);
        let mut host = connect_player(&mut g, 50);
        join_player(&mut g, 50, "First", Some(Difficulty::Easy));
        let mut older = connect_player(&mut g, 30);
        join_player(&mut g, 30, "Older guest", None);
        let mut newer = connect_player(&mut g, 10);
        join_player(&mut g, 10, "Newer guest", None);
        g.handle(Incoming::Disconnect(50));
        let transfer = latest_settings(&mut older);
        assert_eq!(transfer["host"], g.conn_player[&30]);
        assert_eq!(transfer["hostName"], "Older guest");
        assert_eq!(transfer["canChange"], true);
        assert_eq!(latest_settings(&mut newer)["canChange"], false);

        // The transferred host can change settings immediately during combat.
        g.phase = Phase::Live;
        let phase_time = g.phase_t;
        g.handle(Incoming::Msg(30, ClientMsg::SetDifficulty { difficulty: Difficulty::Expert }));
        assert_eq!(g.difficulty, Difficulty::Expert);
        assert!(g.phase == Phase::Live);
        assert_eq!(g.phase_t, phase_time);
        assert_eq!(latest_settings(&mut older)["difficulty"], "expert");
        assert_eq!(latest_settings(&mut newer)["difficulty"], "expert");
        messages(&mut host);
        g.handle(Incoming::Disconnect(30));
        assert_eq!(latest_settings(&mut newer)["canChange"], true);
        g.handle(Incoming::Disconnect(10));
        assert!(g.host().is_none());
        assert_eq!(latest_settings(&mut observer),
                   json!({"t": "settings", "difficulty": "expert", "map": "sirocco", "host": null,
                          "hostName": null, "canChange": false}));
    }

    #[test]
    fn difficulty_and_host_survive_rounds_halftime_and_match_reset() {
        let mut g = Game::new();
        let _rx = connect_player(&mut g, 50);
        join_player(&mut g, 50, "Host", Some(Difficulty::Hard));
        let host_id = g.host().unwrap().id;
        for _ in 0..15 {
            play_round(&mut g, ATK);
            assert_eq!(g.difficulty, Difficulty::Hard);
            assert_eq!(g.host().unwrap().id, host_id);
        }
        play_round(&mut g, DEF);
        g.reset_match();
        assert_eq!(g.difficulty, Difficulty::Hard);
        assert_eq!(g.host().unwrap().id, host_id);
    }

    #[test]
    fn difficulty_protocol_accepts_exactly_four_levels_and_legacy_join() {
        for (id, expected) in [("easy", Difficulty::Easy), ("medium", Difficulty::Medium),
                               ("hard", Difficulty::Hard), ("expert", Difficulty::Expert)] {
            let change = json!({"t": "set_difficulty", "difficulty": id}).to_string();
            assert!(matches!(serde_json::from_str::<ClientMsg>(&change).unwrap(),
                             ClientMsg::SetDifficulty { difficulty } if difficulty == expected));
            let join = json!({"t": "join", "name": "Host", "team": 1, "difficulty": id}).to_string();
            assert!(matches!(serde_json::from_str::<ClientMsg>(&join).unwrap(),
                             ClientMsg::Join { difficulty: Some(difficulty), .. } if difficulty == expected));
        }
        assert!(matches!(serde_json::from_str::<ClientMsg>(r#"{"t":"join","name":"Legacy","team":1}"#).unwrap(),
                         ClientMsg::Join { difficulty: None, .. }));
        for invalid in [json!("impossible"), json!("Expert"), json!(1), json!(null)] {
            let change = json!({"t": "set_difficulty", "difficulty": invalid}).to_string();
            assert!(serde_json::from_str::<ClientMsg>(&change).is_err());
        }
        let invalid_join = json!({"t": "join", "name": "Host", "team": 1, "difficulty": "impossible"}).to_string();
        assert!(serde_json::from_str::<ClientMsg>(&invalid_join).is_err());
    }

    #[test]
    fn map_preferences_apply_only_when_starting_an_empty_lobby() {
        let mut g = Game::new();
        let mut host = connect_player(&mut g, 50);
        g.handle(Incoming::Msg(50, ClientMsg::Join {
            name: "Host".into(), team: ATK, difficulty: Some(Difficulty::Hard),
            map: Some(MapId::Norheim),
        }));
        assert_eq!(g.map.id, MapId::Norheim);
        assert_eq!(latest_settings(&mut host)["map"], "norheim");
        let host_id = g.host().unwrap().id;
        let mut guest = connect_player(&mut g, 30);
        g.handle(Incoming::Msg(30, ClientMsg::Join {
            name: "Guest".into(), team: DEF, difficulty: Some(Difficulty::Easy),
            map: Some(MapId::Dockyard),
        }));
        assert_eq!(g.map.id, MapId::Norheim);
        assert_eq!(g.difficulty, Difficulty::Hard);
        assert_eq!(latest_settings(&mut guest)["host"], host_id);
        g.handle(Incoming::Disconnect(50));
        g.handle(Incoming::Disconnect(30));
        let mut next = connect_player(&mut g, 60);
        join_player(&mut g, 60, "No preference", None);
        assert_eq!(latest_settings(&mut next)["map"], "norheim");
        g.handle(Incoming::Disconnect(60));
        let mut last = connect_player(&mut g, 70);
        g.handle(Incoming::Msg(70, ClientMsg::Join {
            name: "Next host".into(), team: ATK, difficulty: None,
            map: Some(MapId::Meridian),
        }));
        assert_eq!(latest_settings(&mut last)["map"], "meridian");
    }

    #[test]
    fn map_changes_require_the_host_and_host_transfer_keeps_the_map() {
        let mut g = Game::new();
        let mut host = connect_player(&mut g, 50);
        join_player(&mut g, 50, "Host", None);
        let mut guest = connect_player(&mut g, 30);
        let mut observer = connect_player(&mut g, 90);
        for (conn, rx) in [(30, &mut guest), (90, &mut observer)] {
            messages(rx);
            g.handle(Incoming::Msg(conn, ClientMsg::SetMap { map: MapId::Dockyard }));
            let rejected = messages(rx);
            assert_eq!(rejected[0]["t"], "settings_error");
            assert_eq!(rejected[1]["map"], "sirocco");
            assert_eq!(g.map.id, MapId::Sirocco);
        }
        join_player(&mut g, 30, "Guest", None);
        messages(&mut guest);
        g.handle(Incoming::Msg(30, ClientMsg::SetMap { map: MapId::Meridian }));
        assert_eq!(messages(&mut guest)[0]["t"], "settings_error");
        g.handle(Incoming::Msg(50, ClientMsg::SetMap { map: MapId::Dockyard }));
        assert_eq!(g.map.id, MapId::Dockyard);
        assert_eq!(latest_settings(&mut host)["map"], "dockyard");
        g.handle(Incoming::Disconnect(50));
        assert_eq!(latest_settings(&mut guest)["canChange"], true);
        assert_eq!(g.map.id, MapId::Dockyard);
        g.handle(Incoming::Msg(30, ClientMsg::SetMap { map: MapId::Meridian }));
        assert_eq!(g.map.id, MapId::Meridian);
        assert_eq!(latest_settings(&mut observer)["map"], "meridian");
    }

    #[test]
    fn changing_maps_resets_combat_and_announces_geometry_before_new_state() {
        let mut g = Game::new();
        let mut host = connect_player(&mut g, 50);
        join_player(&mut g, 50, "Host", Some(Difficulty::Expert));
        let mut guest = connect_player(&mut g, 30);
        join_player(&mut g, 30, "Guest", None);
        let mut observer = connect_player(&mut g, 90);
        let identities: Vec<_> = g.players.iter().map(|p| (p.id, p.team, p.conn)).collect();
        let host_id = g.host().unwrap().id;
        g.phase = Phase::Live;
        g.phase_t = 30.0;
        g.live_elapsed = 85.0;
        g.score = [6, 8];
        g.round = 15;
        g.swap_pending = true;
        g.planted = Some(Planted { pos: [0.0; 3], timer: 10.0, site: 0 });
        g.smokes.push(Smoke { pos: [0.0; 3], t: 20.0 });
        g.nades.push(Nade { id: 1000, kind: FRAG, pos: [0.0; 3], vel: [0.0; 3], fuse: 1.0, owner: host_id, team: ATK });
        g.drop_item(Gun::new(PISTOL_ATK), [0.0; 3], 0);
        g.events.push(json!({"t": "stale_shot"}).to_string());
        g.private.push((host_id, json!({"t": "stale_hit"}).to_string()));
        for p in &mut g.players {
            p.money = 16000;
            p.kills = 10;
            p.deaths = 5;
            p.cmds.push_back(Cmd { seq: 80, buttons: B_FIRE, yaw: 1.0, pitch: 0.0, dt: TICK, it: 0.0 });
            p.budget = 0.2;
            p.ack = 77;
            p.hist.push_back((0.0, [0.0; 3], false));
        }
        messages(&mut host);
        messages(&mut guest);
        messages(&mut observer);
        g.handle(Incoming::Msg(50, ClientMsg::SetMap { map: MapId::Meridian }));
        assert_eq!(g.map.id, MapId::Meridian);
        assert_eq!(g.host().unwrap().id, host_id);
        assert_eq!(g.difficulty, Difficulty::Expert);
        assert_eq!(g.players.iter().map(|p| (p.id, p.team, p.conn)).collect::<Vec<_>>(), identities);
        assert!(g.phase == Phase::Freeze);
        assert_eq!(g.round, 1);
        assert_eq!(g.score, [0, 0]);
        assert!(!g.swap_pending);
        assert!(g.items.is_empty() && g.nades.is_empty() && g.smokes.is_empty() && g.planted.is_none());
        assert!(g.private.is_empty());
        for p in &g.players {
            assert!(p.alive && p.hp == 100);
            assert_eq!((p.money, p.kills, p.deaths), (START_MONEY, 0, 0));
            assert!(p.cmds.is_empty() && p.hist.is_empty());
            assert_eq!(p.budget, 0.0);
            assert_eq!(p.ack, 77);
            assert_eq!(p.buttons, 0);
            assert!(g.map.spawns[(p.team - 1) as usize].contains(&p.xz()));
            assert!(!collides(g.map, &p.st.pos, H_STAND));
        }
        g.broadcast();
        for rx in [&mut host, &mut guest, &mut observer] {
            let sent = messages(rx);
            assert_eq!(sent[0]["t"], "hello");
            assert_eq!(sent[0]["map"]["id"], "meridian");
            assert_eq!(sent[0]["map"]["index"], MapId::Meridian.index());
            assert_eq!(sent[0]["maps"].as_array().unwrap().len(), MapId::ALL.len());
            assert_eq!(sent[1]["t"], "settings");
            assert_eq!(sent[1]["map"], "meridian");
            let snapshot = sent.iter().find(|m| m["t"] == "s").unwrap();
            assert_eq!(snapshot["map"], "meridian");
            assert_eq!(snapshot["rd"], 1);
            assert_eq!(snapshot["buySeconds"], FREEZE_TIME + BUY_TIME);
            assert!(sent.iter().all(|m| !m.to_string().contains("stale_")));
        }
        let i = g.idx(host_id).unwrap();
        g.handle(Incoming::Msg(50, ClientMsg::Input {
            s: 81, b: B_FIRE, y: 0.0, p: 0.0, d: TICK, it: 0.0, map: Some(MapId::Sirocco), round_id: None,
        }));
        assert!(g.players[i].cmds.is_empty(), "buffered movement from the old map must be ignored");
        g.handle(Incoming::Msg(50, ClientMsg::Input {
            s: 82, b: 0, y: 0.0, p: 0.0, d: TICK, it: 0.0, map: Some(MapId::Meridian), round_id: None,
        }));
        assert_eq!(g.players[i].cmds.len(), 1);
    }

    #[test]
    fn map_protocol_rejects_unknown_ids_without_defaulting() {
        for id in MapId::ALL {
            let change = json!({"t": "set_map", "map": id.id()}).to_string();
            assert!(matches!(serde_json::from_str::<ClientMsg>(&change).unwrap(),
                             ClientMsg::SetMap { map } if map == id));
            let join = json!({"t": "join", "name": "Host", "team": 1, "map": id.id()}).to_string();
            assert!(matches!(serde_json::from_str::<ClientMsg>(&join).unwrap(),
                             ClientMsg::Join { map: Some(map), .. } if map == id));
        }
        for invalid in [json!("missing"), json!("Sirocco"), json!(3), json!(null)] {
            let change = json!({"t": "set_map", "map": invalid}).to_string();
            assert!(serde_json::from_str::<ClientMsg>(&change).is_err());
        }
        let invalid_join = json!({"t": "join", "name": "Host", "team": 1, "map": "missing"}).to_string();
        assert!(serde_json::from_str::<ClientMsg>(&invalid_join).is_err());
    }

    fn weapon_game(weapon: &str) -> Game {
        let mut g = Game::new();
        g.players.truncate(1);
        g.phase = Phase::Live;
        let p = &mut g.players[0];
        p.bot = None;
        p.alive = true;
        p.has_bomb = false;
        p.hp = 100;
        let w = by_id(weapon).unwrap();
        p.slot = slot_of(WEAPONS[w].class);
        p.prim = (p.slot == 0).then(|| Gun::new(w));
        p.sec = (p.slot == 1).then(|| Gun::new(w));
        p.cooldown = 0.0;
        p.buttons = 0;
        p.prev_buttons = 0;
        p.st.ground = true;
        g.events.clear();
        g
    }

    fn input(g: &mut Game, buttons: u32, dt: f32) {
        g.players[0].buttons = buttons;
        g.update_weapon(0, dt);
    }

    fn shot_hands(g: &Game) -> Vec<u64> {
        g.events.iter().filter_map(|event| {
            let event: serde_json::Value = serde_json::from_str(event).unwrap();
            (event["t"] == "shot").then(|| event["hand"].as_u64().unwrap())
        }).collect()
    }

    #[test]
    fn optics_purchases_obey_held_weapon_compatibility_budget_and_replacement_prices() {
        for def in &WEAPONS {
            for optic in &OPTICS {
                let mut g = weapon_game(def.id);
                g.players[0].money = 5000;
                let allowed = !def.dual && match def.class {
                    C_PISTOL => optic.index == 1,
                    C_SHOTGUN | C_SMG | C_RIFLE | C_LMG => true,
                    _ => false,
                };
                assert_eq!(g.buy(0, optic.id), allowed, "{} + {}", def.id, optic.id);
                assert_eq!(g.players[0].money, 5000 - if allowed { optic.price } else { 0 });
                if allowed {
                    assert_eq!(g.players[0].gun().unwrap().optic, optic.index);
                    assert_eq!(g.players[0].gun().unwrap().effective_zoom(), optic.zoom);
                    assert!(!g.buy(0, optic.id), "an already-installed optic cannot be bought again");
                    assert_eq!(g.players[0].money, 5000 - optic.price);
                }
            }
        }
        for team in [ATK, DEF] {
            let mut g = weapon_game("sentinel");
            let p = &mut g.players[0];
            p.team = team;
            let point = g.map.spawns[(team - 1) as usize][0];
            p.st.pos = [point[0], 0.01, point[1]];
            p.money = 499;
            assert!(!g.buy(0, "red_dot"));
            assert_eq!(g.players[0].gun().unwrap().optic, 0);
            assert_eq!(g.players[0].money, 499);
            g.players[0].money = 3000;
            assert!(g.buy(0, "red_dot"));
            assert!(g.buy(0, "acog"));
            assert_eq!(g.players[0].money, 1300, "replacement charges the full price, without a refund");
            assert_eq!(g.players[0].gun().unwrap().optic, 2);
            g.players[0].alive = false;
            assert!(!g.buy(0, "red_dot"));
            g.players[0].alive = true;
            g.players[0].st.pos = [0.0, 0.01, 0.0];
            assert!(!g.buy(0, "red_dot"), "installation is restricted to the buy zone");
            g.players[0].st.pos = [point[0], 0.01, point[1]];
            g.live_elapsed = BUY_TIME + 1.0;
            assert!(!g.buy(0, "red_dot"), "installation respects the buy timer");
        }
    }

    #[test]
    fn optics_follow_the_gun_through_pickup_death_and_surviving_rounds() {
        let mut g = weapon_game("sentinel");
        g.players[0].money = 6000;
        g.players[0].sec = Some(Gun::new(PISTOL_ATK));
        assert!(g.buy(0, "acog"));
        g.select_slot(0, 1);
        assert!(g.buy(0, "red_dot"));
        g.select_slot(0, 0);
        g.players[0].gun_mut().unwrap().ammo = 7;
        g.players[0].gun_mut().unwrap().reserve = 13;
        g.drop_active(0);
        assert_eq!(g.items[0].optic, 2);
        g.players[0].st.pos = g.items[0].pos;
        g.time += 2.0;
        g.pickups();
        let gun = g.players[0].gun().unwrap();
        assert_eq!((gun.optic, gun.ammo, gun.reserve), (2, 7, 13));
        assert_eq!(g.players[0].sec.unwrap().optic, 1);
        g.spawn(0, 0);
        assert_eq!(g.players[0].prim.unwrap().optic, 2, "survivors keep their attachments when ammo refills");
        assert_eq!(g.players[0].sec.unwrap().optic, 1);
        assert_eq!(g.players[0].prim.unwrap().ammo, WEAPONS[by_id("sentinel").unwrap()].mag);
        g.kill(0, None, KNIFE, false);
        assert_eq!(g.items.len(), 1);
        assert_eq!(g.items[0].optic, 2);
        let mut collector = Player::new(999, "Collector".into(), DEF, None, None);
        collector.alive = true; collector.hp = 100; collector.st.pos = g.items[0].pos;
        g.players.push(collector);
        g.pickups();
        assert_eq!(g.players[1].prim.unwrap().optic, 2, "enemy-dropped sights transfer with the gun");
        assert!(g.items.is_empty());
        g.spawn(0, 0);
        assert!(g.players[0].prim.is_none());
        assert_eq!(g.players[0].sec.unwrap().optic, 0, "dying does not grant free attachments next round");
    }

    #[test]
    fn optics_are_replicated_per_weapon_and_change_effective_aim_zoom() {
        let mut g = weapon_game("sabre");
        g.players[0].money = 6000;
        g.players[0].sec = Some(Gun::new(PISTOL_ATK));
        let original_ammo = g.players[0].gun().unwrap().ammo;
        assert!(g.buy(0, "acog"));
        input(&mut g, B_FIRE2, 0.4);
        assert_eq!(g.players[0].scoped, 1);
        assert_eq!(g.players[0].gun().unwrap().ammo, original_ammo);
        assert_eq!(g.players[0].gun().unwrap().effective_zoom(), 4.0);
        assert_eq!(g.players[0].max_speed(), WEAPONS[by_id("sabre").unwrap()].speed * 0.6);
        g.select_slot(0, 1);
        assert!(g.buy(0, "red_dot"));
        g.select_slot(0, 0);
        let dropped = g.players[0].sec.unwrap();
        g.drop_item(dropped, g.players[0].st.pos, 0);
        let (tx, mut rx) = mpsc::channel(64);
        g.conns.insert(1, tx); g.conn_player.insert(1, g.players[0].id); g.tick_n = 2;
        g.broadcast();
        let snap = messages(&mut rx).into_iter().find(|m| m["t"] == "s").unwrap();
        assert_eq!(snap["me"]["optic"], 2);
        assert_eq!(snap["me"]["prOptic"], 2);
        assert_eq!(snap["me"]["seOptic"], 1);
        assert_eq!(snap["me"]["zoom"], 4.0);
        assert_eq!(snap["pl"][0][11], 2);
        assert_eq!(snap["it"][0][5], 1);
        let hello: serde_json::Value = serde_json::from_str(&g.hello()).unwrap();
        assert_eq!(hello["optics"], json!([
            {"index":1,"id":"red_dot","name":"Red Dot","price":500,"zoom":1.5},
            {"index":2,"id":"acog","name":"ACOG","price":1200,"zoom":4.0},
        ]));
        for (id, allowed) in [("kestrel", vec![1]), ("sabre", vec![1, 2]), ("titan", vec![]), ("twin_mp7", vec![])] {
            let weapon = hello["weapons"].as_array().unwrap().iter().find(|w| w["id"] == id).unwrap();
            assert_eq!(weapon["optics"], json!(allowed));
        }
        assert!(g.buy(0, "red_dot"));
        assert_eq!(g.players[0].gun().unwrap().effective_zoom(), 1.5, "a replacement overrides Sabre's built-in2x optic");
    }

    fn titan_target(distance: f32, height: f32, cover: Option<f32>) -> Game {
        let mut g = weapon_game("titan");
        let mut arena = Map::build();
        arena.boxes.clear();
        arena.boxes.push(sim::map::Aabb { min: [-300.0, -2.0, -300.0], max: [300.0, 0.0, 300.0], mat: 0, var: 0 });
        if let Some(thickness) = cover {
            arena.boxes.push(sim::map::Aabb {
                min: [-3.0, 0.0, -distance / 2.0 - thickness / 2.0],
                max: [3.0, 3.0, -distance / 2.0 + thickness / 2.0], mat: 1, var: 0,
            });
        }
        g.map = Box::leak(Box::new(arena));
        g.players[0].team = ATK;
        g.players[0].st = PState { pos: [0.0, 0.01, 0.0], ground: true, ..PState::default() };
        g.players[0].yaw = 0.0;
        g.players[0].pitch = (height - EYE_STAND).atan2(distance);
        let mut target = Player::new(999, "Armored target".into(), DEF, None, None);
        target.alive = true; target.hp = 100; target.armor = 100; target.helmet = true;
        target.st = PState { pos: [0.0, 0.01, -distance], ground: true, ..PState::default() };
        g.players.push(target);
        g
    }

    #[test]
    fn titan_actual_hits_kill_close_torsos_and_all_heads_including_penetrated_helmet_hits() {
        for distance in [5.0, 20.0, 35.0, 50.0, 120.0, 240.0] {
            let mut head = titan_target(distance, 1.6, None);
            input(&mut head, B_FIRE | B_FIRE2, TICK);
            assert!(!head.players[1].alive, "helmet headshot at {distance}m must be lethal");
            let mut covered_head = titan_target(distance, 1.6, Some(2.59));
            input(&mut covered_head, B_FIRE | B_FIRE2, TICK);
            assert!(!covered_head.players[1].alive, "penetrated helmet headshot at {distance}m must be lethal");
            let mut body = titan_target(distance, 1.1, None);
            input(&mut body, B_FIRE | B_FIRE2, TICK);
            if distance <= 20.0 {
                assert!(!body.players[1].alive, "close armored torso hit must be lethal");
            } else if distance >= 50.0 {
                assert!(body.players[1].alive);
                assert_eq!(body.players[1].hp, 6, "far armored torso hit should deal94 at {distance}m");
            } else {
                assert!(body.players[1].hp < 6, "mid-range torso damage must interpolate smoothly");
            }
        }
    }

    #[test]
    fn titan_leg_hits_cover_attenuation_and_solid_walls_keep_normal_rules() {
        let mut legs = titan_target(10.0, 0.4, None);
        input(&mut legs, B_FIRE | B_FIRE2, TICK);
        assert!(legs.players[1].alive && legs.players[1].hp >= 17);
        let mut through_cover = titan_target(10.0, 1.1, Some(1.0));
        input(&mut through_cover, B_FIRE | B_FIRE2, TICK);
        assert!(through_cover.players[1].alive && through_cover.players[1].hp > 10 && through_cover.players[1].hp < 100,
                "penetrated body damage should be reduced normally");
        let mut blocked = titan_target(10.0, 1.6, Some(2.7));
        input(&mut blocked, B_FIRE | B_FIRE2, TICK);
        assert_eq!(blocked.players[1].hp, 100, "the new rifle must not penetrate beyond the existing2.6m limit");
    }

    #[test]
    fn titan_stationary_aimed_shots_settle_after_each_completed_bolt_cycle() {
        let mut g = titan_target(240.0, 1.6, None);
        for shot in 0..5 {
            g.players[1].alive = true; g.players[1].hp = 100;
            if shot > 0 { input(&mut g, B_FIRE2, 2.3 + TICK); }
            input(&mut g, B_FIRE | B_FIRE2, TICK);
            assert!(!g.players[1].alive, "settled shot {shot} must hit the aimed head at long range");
            assert_eq!(g.players[0].gun().unwrap().ammo, 4 - shot);
        }
    }

    #[test]
    fn titan_bolt_cycle_is_slow_and_lowers_the_scope_until_ready() {
        let mut g = weapon_game("titan");
        assert_eq!(g.players[0].gun().unwrap().effective_zoom(), 12.0);
        assert_eq!(g.players[0].max_speed(), 4.5);
        input(&mut g, B_FIRE2, TICK);
        assert_eq!(g.players[0].scoped, 1);
        assert!((g.players[0].max_speed() - 2.7).abs() < 0.001);
        input(&mut g, B_FIRE | B_FIRE2, TICK);
        assert_eq!(g.players[0].gun().unwrap().ammo, 4);
        assert_eq!(g.players[0].scoped, 0);
        g.select_slot(0, 0);
        assert!(g.players[0].bolt_t > 2.2, "selecting the already-held slot must not skip the bolt cycle");
        for _ in 0..100 {
            input(&mut g, B_FIRE | B_FIRE2, TICK);
            assert_eq!(g.players[0].scoped, 0);
            assert_eq!(g.players[0].gun().unwrap().ammo, 4);
        }
        input(&mut g, B_FIRE2, TICK);
        input(&mut g, B_FIRE | B_FIRE2, TICK);
        assert_eq!(g.players[0].gun().unwrap().ammo, 4, "repressing cannot skip the bolt cycle");
        input(&mut g, B_FIRE2, 1.0);
        assert_eq!(g.players[0].scoped, 1);
        input(&mut g, B_FIRE | B_FIRE2, TICK);
        assert_eq!(g.players[0].gun().unwrap().ammo, 3);
        let hello: serde_json::Value = serde_json::from_str(&g.hello()).unwrap();
        let titan = &hello["weapons"][31];
        assert_eq!(titan["id"], "titan"); assert_eq!(titan["boltAction"], true);
        assert_eq!(titan["zoom"], 12.0); assert_eq!(titan["interval"], json!(2.3_f32));
    }

    #[test]
    fn kar98k_is_an_affordable_both_team_iron_sight_rifle_with_optional_optics() {
        let w = by_id("kar98k").unwrap();
        assert_eq!(w, 32, "new weapons must not shift existing protocol indices");
        for team in [ATK, DEF] {
            let mut g = weapon_game("kestrel");
            let p = &mut g.players[0];
            p.team = team;
            let point = g.map.spawns[(team - 1) as usize][0];
            p.st.pos = [point[0], 0.01, point[1]];
            p.money = 1499;
            assert!(!g.buy(0, "kar98k"));
            assert_eq!(g.players[0].money, 1499);
            assert!(g.players[0].prim.is_none());
            g.players[0].money = 1500;
            assert!(g.buy(0, "kar98k"));
            let p = &g.players[0];
            assert_eq!(p.money, 0);
            assert_eq!(p.slot, 0);
            assert_eq!(p.sec.unwrap().w, PISTOL_ATK, "buying the rifle preserves the sidearm");
            assert_eq!(p.gun().unwrap().w, w);
            assert_eq!((p.gun().unwrap().ammo, p.gun().unwrap().reserve, p.gun().unwrap().optic), (5, 35, 0));
            assert_eq!(p.gun().unwrap().effective_zoom(), 1.35, "the default is iron sights, not a telescope");
            g.players[0].money = 1700;
            assert!(g.buy(0, "red_dot"));
            assert_eq!(g.players[0].gun().unwrap().effective_zoom(), 1.5);
            assert!(g.buy(0, "acog"));
            assert_eq!(g.players[0].gun().unwrap().effective_zoom(), 4.0);
            assert_eq!(g.players[0].money, 0);
            let hello: serde_json::Value = serde_json::from_str(&g.hello()).unwrap();
            let rifle = &hello["weapons"][w];
            assert_eq!(rifle["name"], "Kar98k"); assert_eq!(rifle["cls"], C_RIFLE);
            assert_eq!(rifle["zoom"], json!(1.35_f32)); assert_eq!(rifle["optics"], json!([1, 2]));
            assert_eq!(rifle["boltAction"], true); assert_eq!(rifle["auto"], false);
            assert_eq!(hello["weapons"][PISTOL_ATK]["id"], "kestrel");
            assert_eq!(hello["weapons"][PISTOL_ATK]["name"], "P9S");
            let cheapest_smg = WEAPONS.iter().filter(|w| w.class == C_SMG).min_by_key(|w| w.price).unwrap();
            assert_eq!(cheapest_smg.id, "cricket"); assert_eq!(cheapest_smg.name, "QK-9mm");
            assert_eq!(cheapest_smg.team, DEF); assert_eq!(cheapest_smg.price, 1250);
        }
    }

    #[test]
    fn kar98k_hits_distant_targets_at_normal_bolt_cadence_with_irons_and_optics() {
        for optic in [0, 1, 2] {
            let mut g = titan_target(240.0, 1.6, None);
            g.players[0].prim = Some(Gun::new(by_id("kar98k").unwrap()));
            g.players[0].gun_mut().unwrap().optic = optic;
            for shot in 0..5 {
                g.players[1].alive = true; g.players[1].hp = 100;
                if shot > 0 { input(&mut g, B_FIRE2, 1.8 + TICK); }
                input(&mut g, B_FIRE | B_FIRE2, TICK);
                assert!(!g.players[1].alive, "optic{optic}: settled shot{shot} must hit the aimed helmet at240m");
                assert_eq!(g.players[0].gun().unwrap().ammo, 4 - shot);
                assert_eq!(g.players[0].scoped, 0, "working the bolt lowers either sight");
            }
        }
        for (distance, lowest, highest) in [(10.0, 62, 63), (120.0, 59, 60), (240.0, 55, 56)] {
            let mut g = titan_target(distance, 1.1, None);
            g.players[0].prim = Some(Gun::new(by_id("kar98k").unwrap()));
            input(&mut g, B_FIRE | B_FIRE2, TICK);
            let dealt = 100 - g.players[1].hp;
            assert!(dealt >= lowest && dealt <= highest,
                    "armored torso at{distance}m took{dealt}; rifle must retain range without a body one-shot");
            assert!(g.players[1].alive);
        }
    }

    #[test]
    fn installing_an_optic_mid_bolt_cycle_keeps_cadence_and_settles_the_next_shot() {
        for optic in ["red_dot", "acog"] {
            let mut g = titan_target(240.0, 1.6, None);
            let point = g.map.spawns[0][0];
            g.players[0].st.pos = [point[0], 0.01, point[1]];
            g.players[1].st.pos = [point[0], 0.01, point[1] - 240.0];
            g.players[0].prim = Some(Gun::new(by_id("kar98k").unwrap()));
            g.players[0].money = 2000;
            input(&mut g, B_FIRE | B_FIRE2, TICK);
            assert!(!g.players[1].alive);
            assert!(g.buy(0, optic));
            assert!(g.players[0].bolt_t > 1.7, "installing a sight must not cancel the action still cycling");
            g.players[1].alive = true; g.players[1].hp = 100;
            input(&mut g, B_FIRE2, TICK);
            assert_eq!(g.players[0].scoped, 0);
            input(&mut g, B_FIRE | B_FIRE2, TICK);
            assert_eq!(g.players[0].gun().unwrap().ammo, 4, "installing sights cannot shorten the firing delay");
            input(&mut g, B_FIRE2, 1.8);
            assert_eq!(g.players[0].scoped, 1);
            input(&mut g, B_FIRE | B_FIRE2, TICK);
            assert!(!g.players[1].alive, "completed cycle must settle recoil for the new{optic} sight");
            assert_eq!(g.players[0].gun().unwrap().ammo, 3);
        }
    }

    #[test]
    fn kar98k_bolt_cadence_cannot_be_shortened_by_holding_or_switching_slots() {
        let mut g = weapon_game("kar98k");
        g.players[0].sec = Some(Gun::new(PISTOL_ATK));
        input(&mut g, B_FIRE2, TICK);
        assert_eq!(g.players[0].scoped, 1);
        input(&mut g, B_FIRE | B_FIRE2, TICK);
        assert_eq!(g.players[0].gun().unwrap().ammo, 4);
        assert_eq!(g.players[0].scoped, 0);
        g.select_slot(0, 0);
        assert!(g.players[0].bolt_t > 1.7, "selecting the current slot cannot skip cycling");
        for _ in 0..60 { input(&mut g, B_FIRE | B_FIRE2, TICK); }
        assert_eq!(g.players[0].gun().unwrap().ammo, 4);
        assert_eq!(g.players[0].scoped, 0);
        g.select_slot(0, 1); g.select_slot(0, 0);
        input(&mut g, B_FIRE2, TICK);
        input(&mut g, B_FIRE | B_FIRE2, TICK);
        assert_eq!(g.players[0].gun().unwrap().ammo, 4, "switching away and back does not shorten the firing cooldown");
        input(&mut g, B_FIRE2, 0.85);
        assert_eq!(g.players[0].scoped, 1);
        input(&mut g, B_FIRE | B_FIRE2, TICK);
        assert_eq!(g.players[0].gun().unwrap().ammo, 3);
        for _ in 0..120 { input(&mut g, B_FIRE | B_FIRE2, TICK); }
        assert_eq!(g.players[0].gun().unwrap().ammo, 3, "holding fire cannot repeat a bolt-action shot");
        input(&mut g, B_FIRE2, TICK);
        input(&mut g, B_FIRE | B_FIRE2, TICK);
        assert_eq!(g.players[0].gun().unwrap().ammo, 2);
    }

    #[test]
    fn dual_primaries_buy_into_primary_slot_for_both_teams() {
        for team in [ATK, DEF] {
            for id in ["twin_mp7", "twin_lever"] {
                let mut g = weapon_game("kestrel");
                let w = by_id(id).unwrap();
                let p = &mut g.players[0];
                p.team = team;
                p.st.pos = [g.map.spawns[(team - 1) as usize][0][0], 0.001,
                            g.map.spawns[(team - 1) as usize][0][1]];
                p.money = WEAPONS[w].price - 1;
                p.prim = Some(Gun::new(by_id("sentinel").unwrap()));
                p.prim.as_mut().unwrap().ammo = 9;
                let sidearm = p.sec.unwrap();
                assert!(!g.buy(0, id), "the price still applies to dual primaries");
                assert_eq!(g.players[0].money, WEAPONS[w].price - 1);
                assert!(g.items.is_empty());
                g.players[0].money = 6000;
                assert!(g.buy(0, id), "{id} must be available to team {team}");
                let p = &g.players[0];
                assert_eq!(p.slot, 0);
                assert_eq!(p.prim.unwrap().w, w);
                assert_eq!(p.money, 6000 - WEAPONS[w].price);
                assert_eq!((p.sec.unwrap().w, p.sec.unwrap().ammo), (sidearm.w, sidearm.ammo));
                assert_eq!(p.prim.unwrap().ammo_hand(0), WEAPONS[w].mag / 2);
                assert_eq!(p.prim.unwrap().ammo_hand(1), WEAPONS[w].mag / 2);
                assert_eq!(g.items.len(), 1);
                assert_eq!((g.items[0].w, g.items[0].ammo), (by_id("sentinel").unwrap(), 9));
                assert!(!g.buy(0, id), "buying the same owned pair must not duplicate it");
                assert_eq!(g.players[0].money, 6000 - WEAPONS[w].price);
            }
        }
    }

    #[test]
    fn dual_mp7_holds_fire_independently_and_stops_each_released_hand() {
        let mut g = weapon_game("twin_mp7");
        for _ in 0..30 { input(&mut g, B_FIRE, TICK); }
        let left = g.players[0].gun().unwrap().ammo_hand(0);
        assert!(left < 38 && left >= 30, "holding left should produce an automatic burst");
        assert_eq!(g.players[0].gun().unwrap().ammo_hand(1), 40);
        assert!(shot_hands(&g).iter().all(|&hand| hand == 0));
        let events = shot_hands(&g).len();
        for _ in 0..30 { input(&mut g, B_FIRE2, TICK); }
        assert_eq!(g.players[0].gun().unwrap().ammo_hand(0), left, "released left stops firing");
        assert!(g.players[0].gun().unwrap().ammo_hand(1) < 38);
        assert!(shot_hands(&g)[events..].iter().all(|&hand| hand == 1));
        let before = g.players[0].gun().unwrap().ammo;
        for _ in 0..30 { input(&mut g, B_FIRE | B_FIRE2, TICK); }
        assert!(g.players[0].gun().unwrap().ammo < before - 8, "both held triggers fire automatically");
        assert_eq!(g.players[0].scoped, 0, "RMB fires the right MP7 instead of aiming");
        let stopped = g.players[0].gun().unwrap().ammo;
        for _ in 0..30 { input(&mut g, 0, TICK); }
        assert_eq!(g.players[0].gun().unwrap().ammo, stopped);
    }

    #[test]
    fn lever_pair_cycles_each_hand_and_emits_one_pellet_cloud_per_shell() {
        let mut g = weapon_game("twin_lever");
        input(&mut g, B_FIRE, TICK);
        input(&mut g, B_FIRE | B_FIRE2, TICK);
        assert_eq!(shot_hands(&g), [0, 1]);
        assert_eq!((g.players[0].gun().unwrap().ammo_hand(0), g.players[0].gun().unwrap().ammo_hand(1)), (4, 4));
        input(&mut g, 0, TICK);
        input(&mut g, B_FIRE | B_FIRE2, TICK);
        assert_eq!(shot_hands(&g), [0, 1], "repressing during the lever cycle must not bypass its delay");
        for _ in 0..90 { input(&mut g, B_FIRE | B_FIRE2, TICK); }
        assert_eq!(shot_hands(&g), [0, 1], "holding after cycling must not repeat a semi-automatic shot");
        input(&mut g, 0, TICK);
        input(&mut g, B_FIRE | B_FIRE2, TICK);
        assert_eq!(shot_hands(&g), [0, 1, 0, 1]);
        assert_eq!(g.players[0].gun().unwrap().ammo, 6);
        assert_eq!(g.players[0].scoped, 0);
        for event in &g.events {
            let event: serde_json::Value = serde_json::from_str(event).unwrap();
            if event["t"] == "shot" {
                assert_eq!(event["h"].as_array().unwrap().len(), 7, "each shell is a shotgun spread");
            }
        }
    }

    #[test]
    fn dual_primaries_reload_without_firing_or_creating_ammunition() {
        for id in ["twin_mp7", "twin_lever"] {
            let mut g = weapon_game(id);
            input(&mut g, B_FIRE, TICK);
            input(&mut g, B_FIRE | B_FIRE2, TICK);
            input(&mut g, B_RELOAD, TICK);
            assert!(g.players[0].reload_t > 0.0);
            let before = *g.players[0].gun().unwrap();
            input(&mut g, B_FIRE | B_FIRE2, TICK);
            assert_eq!(g.players[0].gun().unwrap().ammo, before.ammo);
            assert_eq!(g.players[0].scoped, 0);
            input(&mut g, 0, WEAPONS[before.w].reload);
            let gun = g.players[0].gun().unwrap();
            assert_eq!(gun.ammo_hand(0), WEAPONS[gun.w].mag / 2);
            assert_eq!(gun.ammo_hand(1), WEAPONS[gun.w].mag / 2);
            assert_eq!(gun.ammo + gun.reserve, before.ammo + before.reserve);
        }
    }

    #[test]
    fn empty_dual_primary_hands_and_limited_reserve_stay_independent() {
        for id in ["twin_mp7", "twin_lever"] {
            let w = by_id(id).unwrap();
            let capacity = WEAPONS[w].mag / 2;
            for empty in [0, 1] {
                let mut g = weapon_game(id);
                let gun = g.players[0].gun_mut().unwrap();
                gun.ammo = capacity;
                gun.left_ammo = if empty == 0 { 0 } else { capacity };
                let button = if empty == 0 { B_FIRE } else { B_FIRE2 };
                for _ in 0..60 { input(&mut g, button, TICK); }
                assert_eq!(g.players[0].gun().unwrap().ammo, capacity);
                assert_eq!(g.players[0].reload_t, 0.0, "empty hand must not block the loaded hand with auto-reload");
                assert!(shot_hands(&g).is_empty());
                input(&mut g, B_FIRE | B_FIRE2, TICK);
                assert_eq!(g.players[0].gun().unwrap().ammo, capacity - 1);
                assert_eq!(shot_hands(&g), [1 - empty]);
            }
            let mut limited = Gun::new(w);
            limited.ammo = 2; limited.left_ammo = 0; limited.reserve = 3;
            limited.reload();
            assert_eq!(limited.ammo + limited.reserve, 5);
            assert_eq!(limited.reserve, 0);
            assert!(limited.ammo_hand(0) <= capacity && limited.ammo_hand(1) <= capacity);
        }
    }

    #[test]
    fn leaving_lever_guns_resets_hand_cycle_but_keeps_the_equip_delay() {
        for transition in ["select", "buy", "drop"] {
            let mut g = weapon_game("twin_lever");
            g.players[0].sec = Some(Gun::new(by_id("twin_kestrel").unwrap()));
            input(&mut g, B_FIRE | B_FIRE2, TICK);
            assert!(g.players[0].hand_cooldown[0] > 0.8);
            match transition {
                "select" => g.select_slot(0, 1),
                "drop" => g.drop_active(0),
                _ => { g.players[0].money = 6000; assert!(g.buy(0, "twin_mp7")); }
            }
            let before = g.players[0].gun().unwrap().ammo;
            input(&mut g, 0, TICK);
            input(&mut g, B_FIRE | B_FIRE2, TICK);
            assert_eq!(g.players[0].gun().unwrap().ammo, before, "{transition}: cannot fire during equip delay");
            input(&mut g, 0, 0.35);
            input(&mut g, B_FIRE | B_FIRE2, TICK);
            assert_eq!(g.players[0].gun().unwrap().ammo, before - 2,
                       "{transition}: new pair must not inherit the old lever cycle");
        }
    }

    #[test]
    fn enemy_dual_primary_drops_keep_each_hand_ammo_when_picked_up() {
        for id in ["twin_mp7", "twin_lever"] {
            let mut g = weapon_game(id);
            g.players[0].team = DEF;
            input(&mut g, B_FIRE, TICK);
            let before = *g.players[0].gun().unwrap();
            let victim_pos = g.players[0].st.pos;
            let mut collector = Player::new(999, "Collector".into(), ATK, None, None);
            collector.alive = true;
            collector.hp = 100;
            collector.st.pos = victim_pos;
            collector.sec = Some(Gun::new(PISTOL_ATK));
            collector.slot = 1;
            g.players.push(collector);
            g.kill(0, Some(1), PISTOL_ATK, false);
            assert_eq!(g.items.len(), 1);
            assert!(!g.players[0].alive && g.players[0].prim.is_none());
            g.pickups();
            let after = g.players[1].prim.unwrap();
            assert_eq!((after.w, after.ammo, after.left_ammo, after.reserve),
                       (before.w, before.ammo, before.left_ammo, before.reserve));
            assert_eq!(g.players[1].slot, 0);
            assert_eq!(g.players[1].sec.unwrap().w, PISTOL_ATK);
            assert!(g.items.is_empty());
        }
    }

    #[test]
    fn akimbo_has_independent_triggers_magazines_cooldowns_and_recoil() {
        for id in ["twin_kestrel", "twin_mammoth"] {
            let mut g = weapon_game(id);
            let capacity = g.players[0].gun().unwrap().ammo / 2;
            input(&mut g, B_FIRE, TICK);
            let gun = g.players[0].gun().unwrap();
            assert_eq!((gun.ammo_hand(0), gun.ammo_hand(1)), (capacity - 1, capacity));
            assert_eq!(g.players[0].hand_shots, [1.0, 0.0]);
            input(&mut g, B_FIRE | B_FIRE2, TICK);
            let gun = g.players[0].gun().unwrap();
            assert_eq!((gun.ammo_hand(0), gun.ammo_hand(1)), (capacity - 1, capacity - 1));
            assert_eq!(g.players[0].hand_shots, [1.0, 1.0]);
            assert_eq!(shot_hands(&g), [0, 1]);
            assert_eq!(g.players[0].scoped, 0);
            // Holding either semi-automatic trigger must not produce more shots.
            for _ in 0..60 { input(&mut g, B_FIRE | B_FIRE2, TICK); }
            assert_eq!(g.players[0].gun().unwrap().ammo, capacity * 2 - 2);
            input(&mut g, 0, TICK);
            input(&mut g, B_FIRE | B_FIRE2, TICK);
            assert_eq!(shot_hands(&g), [0, 1, 0, 1]);
            assert_eq!(g.players[0].gun().unwrap().ammo, capacity * 2 - 4);
        }
    }

    #[test]
    fn empty_left_pistol_does_not_consume_right_ammo_or_force_reload() {
        let mut g = weapon_game("twin_kestrel");
        let gun = g.players[0].gun_mut().unwrap();
        gun.left_ammo = 0;
        gun.ammo = 15;
        input(&mut g, B_FIRE, TICK);
        assert_eq!(g.players[0].gun().unwrap().ammo, 15);
        assert_eq!(g.players[0].reload_t, 0.0);
        input(&mut g, B_FIRE | B_FIRE2, TICK);
        assert_eq!(g.players[0].gun().unwrap().ammo, 14);
        assert_eq!(shot_hands(&g), [1]);
        assert_eq!(g.players[0].scoped, 0);
    }

    #[test]
    fn dual_reload_preserves_ammunition_and_blocks_both_triggers() {
        let mut g = weapon_game("twin_kestrel");
        input(&mut g, B_FIRE, TICK);
        input(&mut g, B_FIRE | B_FIRE2, TICK);
        input(&mut g, B_RELOAD, 0.5);
        assert!(g.players[0].reload_t > 0.0);
        let before = g.players[0].gun().copied().unwrap();
        input(&mut g, B_FIRE | B_FIRE2, TICK);
        assert_eq!(g.players[0].gun().unwrap().ammo, before.ammo);
        assert_eq!(g.players[0].scoped, 0);
        input(&mut g, 0, 4.0);
        let gun = g.players[0].gun().unwrap();
        assert_eq!((gun.ammo_hand(0), gun.ammo_hand(1)), (15, 15));
        assert_eq!(gun.ammo + gun.reserve, before.ammo + before.reserve);

        let mut limited = Gun::new(by_id("twin_kestrel").unwrap());
        limited.ammo = 2;
        limited.left_ammo = 0;
        limited.reserve = 3;
        limited.reload();
        assert_eq!(limited.ammo + limited.reserve, 5);
        assert_eq!(limited.reserve, 0);
        assert!(limited.ammo_hand(0) <= 15 && limited.ammo_hand(1) <= 15);
    }

    #[test]
    fn dual_round_counts_survive_dropping_and_picking_up() {
        let mut g = weapon_game("twin_mammoth");
        input(&mut g, B_FIRE, TICK);
        let before = g.players[0].gun().copied().unwrap();
        g.drop_active(0);
        assert!(g.players[0].sec.is_none());
        assert_eq!(g.items.len(), 1);
        g.players[0].st.pos = g.items[0].pos;
        g.time += 2.0;
        g.pickups();
        let after = g.players[0].sec.as_ref().unwrap();
        assert_eq!((after.w, after.ammo, after.left_ammo, after.reserve),
                   (before.w, before.ammo, before.left_ammo, before.reserve));
        assert!(g.items.is_empty());
    }

    #[test]
    fn primary_pickup_cancels_previous_reload_aim_and_recoil() {
        for id in ["kestrel", "twin_kestrel"] {
            for reloading in [false, true] {
                let mut g = weapon_game(id);
                input(&mut g, B_FIRE | B_FIRE2, TICK);
                if reloading {
                    input(&mut g, B_RELOAD, 0.5);
                    assert!(g.players[0].reload_t > 0.0);
                }
                let mut primary = Gun::new(by_id("sentinel").unwrap());
                primary.ammo = 7;
                g.drop_item(primary, g.players[0].st.pos, 0);
                g.players[0].st.pos = g.items[0].pos;
                g.pickups();
                let p = &g.players[0];
                assert_eq!(p.slot, 0);
                assert_eq!(p.reload_t, 0.0);
                assert_eq!(p.scoped, 0);
                assert_eq!(p.shots, 0.0);
                assert_eq!(p.hand_shots, [0.0; 2]);
                assert!(p.cooldown >= 0.35);
                input(&mut g, 0, 4.0);
                let gun = g.players[0].gun().unwrap();
                assert_eq!((gun.ammo, gun.reserve), (primary.ammo, primary.reserve),
                           "pistol reload must not fill the newly picked-up rifle");
            }
        }
    }

    #[test]
    fn dropping_fired_duals_delays_and_resets_the_next_weapon() {
        let mut g = weapon_game("twin_kestrel");
        g.players[0].prim = Some(Gun::new(by_id("sentinel").unwrap()));
        input(&mut g, B_FIRE | B_FIRE2, TICK);
        assert_eq!(g.players[0].hand_shots, [1.0; 2]);
        assert_eq!(g.players[0].cooldown, 0.0);
        g.drop_active(0);
        let p = &g.players[0];
        assert_eq!(p.slot, 0);
        assert_eq!(p.shots, 0.0);
        assert_eq!(p.hand_shots, [0.0; 2]);
        assert!(p.cooldown >= 0.35);
        let ammo = p.gun().unwrap().ammo;
        input(&mut g, B_FIRE, TICK);
        assert_eq!(g.players[0].gun().unwrap().ammo, ammo);
        input(&mut g, B_FIRE, 0.4);
        assert_eq!(g.players[0].gun().unwrap().ammo, ammo - 1);
    }

    #[test]
    fn ordinary_guns_aim_while_held_and_release_or_reload_exits_aim() {
        for id in ["kestrel", "sentinel", "longbow"] {
            let mut g = weapon_game(id);
            let speed = g.players[0].max_speed();
            let ammo = g.players[0].gun().unwrap().ammo;
            input(&mut g, B_FIRE2, TICK);
            assert_eq!(g.players[0].scoped, 1, "{id}");
            assert!(g.players[0].max_speed() < speed);
            assert_eq!(g.players[0].gun().unwrap().ammo, ammo, "aiming must not shoot");
            input(&mut g, B_FIRE | B_FIRE2, TICK);
            assert_eq!(g.players[0].gun().unwrap().ammo, ammo - 1);
            assert_eq!(shot_hands(&g), [1]);
            input(&mut g, 0, 2.0);
            assert_eq!(g.players[0].scoped, 0);
            input(&mut g, B_FIRE2 | B_RELOAD, TICK);
            assert_eq!(g.players[0].scoped, 0);
            assert!(g.players[0].reload_t > 0.0);
        }
    }

    #[test]
    fn freeze_allows_aiming_but_neither_weapon_fires() {
        for id in ["kestrel", "twin_kestrel", "titan"] {
            let mut g = weapon_game(id);
            g.players[0].cooldown = 0.35;
            g.phase = Phase::Freeze;
            g.phase_t = 6.0;
            let (tx, _rx) = mpsc::channel(16);
            g.conns.insert(1, tx);
            let p = &mut g.players[0];
            let ammo = p.gun().unwrap().ammo;
            p.cmds.push_back(Cmd { seq: 1, buttons: B_FIRE | B_FIRE2, yaw: 0.0, pitch: 0.0, dt: TICK, it: 0.0 });
            g.tick();
            assert_eq!(g.players[0].scoped, u8::from(id != "twin_kestrel"));
            assert_eq!(g.players[0].gun().unwrap().ammo, ammo);
            assert!(shot_hands(&g).is_empty());
        }
    }

    #[test]
    fn weapon_metadata_and_snapshot_publish_dual_contract() {
        let mut g = weapon_game("twin_kestrel");
        let hello: serde_json::Value = serde_json::from_str(&g.hello()).unwrap();
        let definitions = hello["weapons"].as_array().unwrap();
        assert_eq!(definitions.len(), 33);
        for (id, class, capacity, pellets, automatic) in [("twin_mp7", C_SMG, 80, 1, true), ("twin_lever", C_SHOTGUN, 10, 7, false)] {
            let def = definitions.iter().find(|w| w["id"] == id).unwrap();
            assert_eq!(def["cls"], class); assert_eq!(def["slot"], 0); assert_eq!(def["team"], 0);
            assert_eq!(def["dual"], true); assert_eq!(def["ads"], false); assert_eq!(def["zoom"], 0.0);
            assert_eq!(def["mag"], capacity); assert_eq!(def["pellets"], pellets); assert_eq!(def["auto"], automatic);
        }
        let twins = definitions.iter().find(|w| w["id"] == "twin_kestrel").unwrap();
        assert_eq!(twins["dual"], true);
        assert_eq!(twins["ads"], false);
        assert_eq!(twins["mag"], 30);
        assert_eq!(twins["zoom"], 0.0);
        let (tx, mut rx) = mpsc::channel(16);
        g.conns.insert(1, tx);
        g.conn_player.insert(1, g.players[0].id);
        g.tick_n = 2;
        g.broadcast();
        let mut snapshot = None;
        while let Ok(raw) = rx.try_recv() {
            let message: serde_json::Value = serde_json::from_str(&raw).unwrap();
            if message["t"] == "s" { snapshot = Some(message); }
        }
        let snapshot = snapshot.unwrap();
        assert_eq!(snapshot["me"]["am"], 30);
        assert_eq!(snapshot["me"]["amL"], 15);
        assert_eq!(snapshot["me"]["amR"], 15);
    }

    #[test]
    fn round_controls_require_tokens_but_legacy_inputs_still_parse() {
        for action in ["restart_round", "skip_round"] {
            assert!(serde_json::from_str::<ClientMsg>(&json!({"t": action, "roundId": 5}).to_string()).is_ok());
            assert!(serde_json::from_str::<ClientMsg>(&json!({"t": action}).to_string()).is_err());
        }
        let input = r#"{"t":"in","s":1,"b":0,"y":0,"p":0,"d":0.016}"#;
        assert!(matches!(serde_json::from_str::<ClientMsg>(input).unwrap(), ClientMsg::Input { round_id: None, .. }));
        let input = r#"{"t":"in","s":1,"b":0,"y":0,"p":0,"d":0.016,"roundId":5}"#;
        assert!(matches!(serde_json::from_str::<ClientMsg>(input).unwrap(), ClientMsg::Input { round_id: Some(5), .. }));
    }

    #[test]
    fn restarting_rolls_back_economy_equipment_stats_and_stale_combat_without_advancing_score() {
        let mut g = Game::new();
        let mut host = connect_player(&mut g, 50);
        join_player(&mut g, 50, "Host", None);
        let hi = g.idx(g.conn_player[&50]).unwrap();
        let id = g.players[hi].id;
        {
            let p = &mut g.players[hi];
            p.money = 4500; p.kills = 7; p.deaths = 3;
            p.prim = Some(Gun { optic: 2, ..Gun::new(by_id("kar98k").unwrap()) });
            p.armor = 73; p.helmet = true; p.kit = true; p.nades = [1, 1, 1];
        }
        g.score = [3, 4]; g.loss_streak = [2, 0];
        g.start_round();
        let mut guest = connect_player(&mut g, 60);
        join_player(&mut g, 60, "Late guest", None);
        let hi = g.idx(id).unwrap();
        let gi = g.idx(g.conn_player[&60]).unwrap();
        assert!(g.buy(gi, "red_dot"));
        g.phase = Phase::Live;
        let round = g.round;
        let token = g.round_id;
        let team = g.players[hi].team;
        for p in &mut g.players {
            p.money = 16000; p.kills += 10; p.deaths += 1;
            p.alive = false; p.prim = None; p.armor = 0; p.helmet = false;
            p.kit = false; p.nades = [0; 3]; p.reload_t = 2.0;
            p.plant_t = 1.0; p.defuse_t = 1.0; p.flash_t = 1.0;
            p.buttons = B_FIRE; p.prev_buttons = B_FIRE;
            p.cmds.push_back(Cmd { seq: 80, buttons: B_FIRE, yaw: 1.0, pitch: 0.0, dt: TICK, it: 0.0 });
            p.budget = 0.2; p.ack = 77; p.hist.push_back((0.0, [0.0; 3], false));
        }
        g.planted = Some(Planted { pos: [0.0; 3], timer: 10.0, site: 0 });
        g.nades.push(Nade { id: 1000, kind: FRAG, pos: [0.0; 3], vel: [0.0; 3], fuse: 1.0, owner: id, team });
        g.smokes.push(Smoke { pos: [0.0; 3], t: 10.0 });
        g.drop_item(Gun::new(PISTOL_ATK), [0.0; 3], 0);
        g.events.push(json!({"t": "stale_shot"}).to_string());
        g.private.push((id, json!({"t": "stale_hit"}).to_string()));
        messages(&mut host); messages(&mut guest);
        g.handle(Incoming::Msg(50, ClientMsg::RestartRound { round_id: token }));
        assert_eq!(g.round, round); assert_eq!(g.round_id, token + 1);
        assert_eq!(g.score, [3, 4]); assert_eq!(g.loss_streak, [2, 0]);
        assert_eq!(g.players[hi].team, team); assert!(g.phase == Phase::Freeze);
        let p = &g.players[hi];
        assert_eq!((p.money, p.kills, p.deaths), (4500, 7, 3));
        assert_eq!((p.armor, p.helmet, p.kit, p.nades), (73, true, true, [1, 1, 1]));
        assert_eq!((p.prim.unwrap().w, p.prim.unwrap().optic, p.prim.unwrap().ammo), (by_id("kar98k").unwrap(), 2, 5));
        assert_eq!((g.players[gi].money, g.players[gi].kills, g.players[gi].deaths), (800, 0, 0));
        assert_eq!(g.players[gi].sec.unwrap().optic, 0);
        assert!(g.items.is_empty() && g.nades.is_empty() && g.smokes.is_empty() && g.planted.is_none());
        for p in &g.players {
            assert!(p.alive && p.hp == 100 && p.cmds.is_empty() && p.hist.is_empty());
            assert_eq!((p.budget, p.buttons, p.prev_buttons, p.reload_t, p.plant_t, p.defuse_t, p.flash_t), (0.0, 0, 0, 0.0, 0.0, 0.0, 0.0));
            assert_eq!(p.ack, 77);
        }
        let sent = messages(&mut host);
        assert!(!sent.iter().any(|m| m.to_string().contains("stale_")));
        let state = sent.iter().find(|m| m["t"] == "s").unwrap();
        assert_eq!(state["roundId"], token + 1); assert_eq!(state["canRestart"], true);
        assert_eq!(state["canSkip"], false); assert_eq!(state["skipping"], false);
        g.handle(Incoming::Msg(50, ClientMsg::RestartRound { round_id: token }));
        assert_eq!(g.round_id, token + 1, "replaying a request cannot restart twice");
        assert!(messages(&mut host).iter().any(|m| m["t"] == "round_error"));
        g.handle(Incoming::Msg(50, ClientMsg::Input { s: 81, b: B_FIRE, y: 1.0, p: 0.0, d: TICK, it: 0.0, map: None, round_id: Some(token) }));
        assert!(g.players[hi].cmds.is_empty()); assert_eq!(g.players[hi].ack, 77);
        g.players[hi].money += 1000; g.players[hi].kills += 1;
        g.restart_round(50, g.round_id);
        assert_eq!((g.players[hi].money, g.players[hi].kills), (4500, 7), "repeated restarts cannot farm aborted rewards");
    }

    #[test]
    fn round_control_permissions_follow_host_living_humans_and_busy_state() {
        let mut g = Game::new();
        let mut host = connect_player(&mut g, 50);
        join_player(&mut g, 50, "Host", None);
        let mut guest = connect_player(&mut g, 60);
        join_player(&mut g, 60, "Guest", None);
        let mut observer = connect_player(&mut g, 90);
        let token = g.round_id;
        assert!(g.can_restart(50)); assert!(!g.can_restart(60) && !g.can_restart(90));
        for conn in [60, 90] { g.restart_round(conn, token); }
        assert_eq!(g.round_id, token);
        assert!(messages(&mut guest).iter().any(|m| m["t"] == "round_error"));
        assert!(messages(&mut observer).iter().any(|m| m["t"] == "round_error"));
        for p in &mut g.players { if p.conn.is_some() { p.alive = false; } }
        assert!(!g.can_skip(50), "freeze is not a bot remainder");
        g.phase = Phase::Live;
        let hi = g.idx(g.conn_player[&50]).unwrap();
        g.players[hi].alive = true;
        assert!(!g.can_skip(50) && !g.can_skip(60));
        g.skip_round(60, token); assert!(!g.skipping);
        g.players[hi].alive = false;
        assert!(g.can_skip(60), "a dead guest need not wait for the host");
        assert!(!g.can_skip(90), "unjoined visitors have no round control");
        messages(&mut guest);
        g.skip_round(60, token);
        assert!(g.skipping && !g.can_restart(50) && !g.can_skip(60));
        let ack = messages(&mut guest);
        assert!(ack.iter().any(|m| m["t"] == "s" && m["skipping"] == true && m["roundId"] == token));
        g.restart_round(50, token); assert_eq!(g.round_id, token);
        assert!(messages(&mut host).iter().any(|m| m["t"] == "round_error"));
        g.handle(Incoming::Disconnect(50));
        assert_eq!(g.host().unwrap().conn, Some(60));
        g.skipping = false;
        assert!(g.can_restart(60));
        for p in &mut g.players { p.alive = false; }
        assert!(!g.can_skip(60), "there must still be live bots to accelerate");
    }

    #[test]
    fn skipping_resolves_real_objectives_and_preserves_halftime_and_match_end() {
        for (score, planted, expected_score, expected_round, swaps) in [
            ([0, 0], false, [0, 1], 2, false),
            ([7, 7], false, [8, 7], 16, true),
            ([15, 0], true, [0, 0], 1, true),
        ] {
            let mut g = Game::new();
            let mut host = connect_player(&mut g, 50);
            join_player(&mut g, 50, "Host", None);
            let hi = g.idx(g.conn_player[&50]).unwrap();
            let team = g.players[hi].team;
            g.players[hi].alive = false; g.players[hi].hp = 0;
            g.score = score; g.round = score[0] + score[1] + 1;
            g.phase = Phase::Live; g.phase_t = TICK * 0.5;
            if planted { g.planted = Some(Planted { pos: [0.0; 3], timer: TICK * 0.5, site: 0 }); }
            let token = g.round_id;
            messages(&mut host);
            g.skip_round(50, token);
            messages(&mut host);
            g.tick();
            assert!(!g.skipping && g.phase == Phase::Freeze);
            assert_eq!(g.round_id, token + 1); assert_eq!(g.round, expected_round);
            assert_eq!(g.score, expected_score); assert!(!g.swap_pending);
            assert_eq!(g.players[hi].team, if swaps { 3 - team } else { team });
            assert_eq!(g.players[hi].money, if swaps { 800 } else { 2200 });
            assert!(g.players.iter().all(|p| p.alive && p.cmds.is_empty() && p.hist.is_empty()));
            let sent = messages(&mut host);
            let events: Vec<_> = sent.iter().filter(|m| m["t"] == "e").flat_map(|m| m["ev"].as_array().unwrap()).collect();
            assert_eq!(events.len(), 2, "only the result and new round are broadcast, not accelerated shots");
            assert_eq!(events[0]["t"], "end"); assert_eq!(events[0]["w"], if planted { ATK } else { DEF });
            assert_eq!(events[0]["r"], if planted { "detonated" } else { "time" });
            assert_eq!(events[1]["t"], "round");
            assert!(sent.iter().any(|m| m["t"] == "s" && m["roundId"] == token + 1 && m["skipping"] == false));
            g.skip_round(50, token); assert_eq!(g.round_id, token + 1);
        }
    }

    #[test]
    fn skipping_runs_in_bounded_batches_without_intermediate_network_effects() {
        let mut g = Game::new();
        g.rng = Rng(17);
        let mut host = connect_player(&mut g, 50);
        join_player(&mut g, 50, "Host", Some(Difficulty::Easy));
        for p in &mut g.players { if p.conn.is_some() { p.alive = false; p.hp = 0; } }
        g.phase = Phase::Live; g.phase_t = ROUND_TIME;
        let token = g.round_id;
        g.skip_round(50, token);
        messages(&mut host);
        let started = std::time::Instant::now();
        let mut slowest = std::time::Duration::ZERO;
        let mut batches = 0;
        while g.skipping {
            let before = g.time;
            let batch = std::time::Instant::now();
            g.tick();
            slowest = slowest.max(batch.elapsed());
            batches += 1;
            assert!(g.time - before <= 2.001, "one server callback can simulate at most 120 ticks");
            if g.skipping { assert!(messages(&mut host).is_empty()); }
            assert!(batches < 2000, "normal round/bomb timers bound accelerated work");
        }
        eprintln!("bot skip benchmark: {batches} bounded batches, {:.2?} total loop time, {:.2?} slowest batch", started.elapsed(), slowest);
        assert!(batches > 1); assert_eq!(g.round_id, token + 1);
        assert_eq!(g.round, 2); assert_eq!(g.score.iter().sum::<u32>(), 1);
        assert!(g.phase == Phase::Freeze);
        let sent = messages(&mut host);
        assert_eq!(sent.iter().filter(|m| m["t"] == "s").count(), 1);
        assert!(!sent.iter().any(|m| m.to_string().contains("\"t\":\"shot\"")));
    }

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
