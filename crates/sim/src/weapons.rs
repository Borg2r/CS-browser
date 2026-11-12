//! Weapon table. All names are fictional.

pub const C_KNIFE: u8 = 0;
pub const C_PISTOL: u8 = 1;
pub const C_SHOTGUN: u8 = 2;
pub const C_SMG: u8 = 3;
pub const C_RIFLE: u8 = 4;
pub const C_SNIPER: u8 = 5;
pub const C_LMG: u8 = 6;
pub const C_FRAG: u8 = 7;
pub const C_FLASH: u8 = 8;
pub const C_SMOKE: u8 = 9;
pub const C_BOMB: u8 = 10;

pub struct Weapon {
    pub id: &'static str,
    pub name: &'static str,
    pub class: u8,
    pub price: u32,
    pub dmg: f32,
    /// Seconds between shots.
    pub interval: f32,
    pub mag: u16,
    pub reserve: u16,
    pub reload: f32,
    pub auto: bool,
    /// Base cone half-angle (radians), growth per shot, and cap.
    pub spread: f32,
    pub spread_inc: f32,
    pub spread_max: f32,
    /// Vertical climb per consecutive shot (radians).
    pub recoil: f32,
    /// Damage multiplier per 10 m.
    pub falloff: f32,
    /// Fraction of damage that gets through armour.
    pub pen: f32,
    /// Run speed while held (m/s).
    pub speed: f32,
    pub reward: u32,
    pub pellets: u8,
    /// Aim magnification. Values >= 4 use a telescopic scope.
    pub zoom: f32,
    /// Two independently fired sidearms, with half of mag capacity in each hand.
    pub dual: bool,
    /// Holding the secondary trigger aims this firearm.
    pub ads: bool,
    /// 0 both teams, 1 attackers only, 2 defenders only.
    pub team: u8,
}

const fn gun(
    id: &'static str, name: &'static str, class: u8, team: u8, price: u32, dmg: f32,
    interval: f32, mag: u16, reserve: u16, reload: f32, auto: bool,
    spread: f32, recoil: f32, pen: f32, speed: f32,
) -> Weapon {
    Weapon {
        id, name, class, price, dmg, interval, mag, reserve, reload, auto,
        spread, spread_inc: spread * 0.55 + 0.002, spread_max: spread * 5.0 + 0.02,
        recoil, falloff: 0.94, pen, speed, reward: 300, pellets: 1,
        zoom: if class >= C_PISTOL && class <= C_LMG { 1.35 } else { 0.0 },
        dual: false, ads: class >= C_PISTOL && class <= C_LMG, team,
    }
}

const fn with(mut w: Weapon, falloff: f32, reward: u32, pellets: u8, zoom: f32) -> Weapon {
    w.falloff = falloff;
    w.reward = reward;
    w.pellets = pellets;
    if zoom > 0.0 { w.zoom = zoom; }
    w
}

const fn akimbo(mut w: Weapon) -> Weapon {
    w.dual = true;
    w.ads = false;
    w.zoom = 0.0;
    w
}

pub const KNIFE: usize = 0;
pub const FRAG: usize = 1;
pub const FLASH: usize = 2;
pub const SMOKE: usize = 3;
pub const BOMB: usize = 4;
pub const PISTOL_ATK: usize = 5;
pub const PISTOL_DEF: usize = 6;

pub static WEAPONS: [Weapon; 29] = [
    with(gun("knife", "Combat Knife", C_KNIFE, 0, 0, 45.0, 0.45, 0, 0, 0.0, true, 0.0, 0.0, 0.85, 6.35), 1.0, 1500, 1, 0.0),
    gun("frag", "Frag Grenade", C_FRAG, 0, 300, 100.0, 0.8, 0, 0, 0.0, false, 0.0, 0.0, 0.6, 6.2),
    gun("flash", "Flashbang", C_FLASH, 0, 200, 0.0, 0.8, 0, 0, 0.0, false, 0.0, 0.0, 0.0, 6.2),
    gun("smoke", "Smoke Grenade", C_SMOKE, 0, 300, 0.0, 0.8, 0, 0, 0.0, false, 0.0, 0.0, 0.0, 6.2),
    gun("bomb", "Demolition Charge", C_BOMB, 1, 0, 0.0, 0.0, 0, 0, 0.0, false, 0.0, 0.0, 0.0, 6.2),
    // Pistols
    gun("kestrel", "Kestrel 9", C_PISTOL, 0, 200, 24.0, 0.13, 20, 120, 2.2, false, 0.010, 0.012, 0.50, 6.35),
    gun("bulwark", "Bulwark .45", C_PISTOL, 0, 200, 31.0, 0.15, 12, 96, 2.4, false, 0.010, 0.016, 0.50, 6.35),
    gun("viper", "Viper .357", C_PISTOL, 0, 600, 38.0, 0.17, 13, 52, 2.5, false, 0.009, 0.018, 0.65, 6.35),
    gun("hornet", "Hornet AP", C_PISTOL, 0, 750, 22.0, 0.11, 20, 100, 2.6, false, 0.011, 0.010, 0.88, 6.35),
    gun("mammoth", "Mammoth .50", C_PISTOL, 0, 700, 53.0, 0.28, 7, 35, 2.2, false, 0.008, 0.040, 0.80, 6.2),
    // Shotguns
    with(gun("ram", "Ram 12", C_SHOTGUN, 0, 1700, 20.0, 0.88, 8, 32, 3.0, false, 0.055, 0.050, 0.50, 5.8), 0.70, 900, 8, 0.0),
    with(gun("tempest", "Tempest Auto", C_SHOTGUN, 0, 3000, 18.0, 0.26, 7, 32, 2.8, true, 0.060, 0.035, 0.50, 5.6), 0.70, 900, 6, 0.0),
    // SMGs
    with(gun("wasp", "Wasp M10", C_SMG, 1, 1400, 24.0, 0.075, 30, 100, 2.6, true, 0.022, 0.006, 0.50, 6.2), 0.88, 600, 1, 0.0),
    with(gun("cricket", "Cricket SD", C_SMG, 2, 1250, 20.0, 0.070, 30, 120, 2.1, true, 0.016, 0.005, 0.50, 6.2), 0.88, 600, 1, 0.0),
    with(gun("lynx", "Lynx 5", C_SMG, 0, 1500, 26.0, 0.080, 30, 120, 2.6, true, 0.012, 0.006, 0.55, 6.1), 0.90, 600, 1, 0.0),
    with(gun("cinder", "Cinder 45", C_SMG, 0, 1700, 30.0, 0.100, 25, 100, 3.0, true, 0.013, 0.007, 0.55, 6.1), 0.88, 600, 1, 0.0),
    with(gun("volt", "Volt 90", C_SMG, 0, 2350, 24.0, 0.070, 50, 100, 3.2, true, 0.014, 0.005, 0.65, 6.0), 0.90, 300, 1, 0.0),
    // Rifles
    gun("jackal", "Jackal AR", C_RIFLE, 1, 2000, 30.0, 0.090, 35, 90, 2.6, true, 0.009, 0.008, 0.75, 5.8),
    gun("falcon", "Falcon AR", C_RIFLE, 2, 2250, 30.0, 0.090, 25, 90, 3.0, true, 0.008, 0.007, 0.70, 5.8),
    gun("rook", "Rook 762", C_RIFLE, 1, 2500, 36.0, 0.100, 30, 90, 2.5, true, 0.007, 0.011, 0.78, 5.6),
    gun("sentinel", "Sentinel 556", C_RIFLE, 2, 3100, 32.0, 0.088, 30, 90, 3.0, true, 0.005, 0.008, 0.70, 5.8),
    with(gun("sabre", "Sabre SG", C_RIFLE, 1, 3500, 33.0, 0.090, 30, 90, 3.0, true, 0.005, 0.009, 0.80, 5.6), 0.96, 300, 1, 2.0),
    with(gun("bastion", "Bastion BP", C_RIFLE, 2, 3500, 32.0, 0.085, 30, 90, 3.2, true, 0.005, 0.008, 0.80, 5.6), 0.96, 300, 1, 2.0),
    // Snipers
    with(gun("drifter", "Drifter LR", C_SNIPER, 0, 2750, 75.0, 1.25, 10, 60, 2.0, false, 0.001, 0.0, 0.85, 6.5), 0.99, 300, 1, 4.0),
    with(gun("longbow", "Longbow .338", C_SNIPER, 0, 4750, 115.0, 1.45, 10, 30, 3.0, false, 0.0005, 0.0, 0.95, 5.3), 0.99, 100, 1, 5.0),
    with(gun("reaper", "Reaper DMR", C_SNIPER, 0, 5000, 70.0, 0.25, 20, 60, 3.4, false, 0.001, 0.012, 0.90, 5.3), 0.99, 300, 1, 4.0),
    // Machine gun
    gun("anvil", "Anvil LMG", C_LMG, 0, 5750, 32.0, 0.080, 100, 200, 4.7, true, 0.011, 0.007, 0.75, 5.6),
    // Akimbo: mag is the combined capacity; mouse buttons fire each hand.
    akimbo(gun("twin_kestrel", "Twin Kestrels", C_PISTOL, 0, 500, 22.0, 0.16, 30, 120, 2.9, false, 0.016, 0.014, 0.50, 6.2)),
    akimbo(gun("twin_mammoth", "Twin Mammoths", C_PISTOL, 0, 750, 46.0, 0.34, 14, 56, 3.3, false, 0.014, 0.035, 0.75, 6.0)),
];

pub fn by_id(id: &str) -> Option<usize> {
    WEAPONS.iter().position(|w| w.id == id)
}

/// Inventory slot for a weapon class: 0 primary, 1 sidearm, 2 knife,
/// 3 frag, 4 flash, 5 smoke, 6 charge.
pub fn slot_of(class: u8) -> u8 {
    match class {
        C_KNIFE => 2,
        C_PISTOL => 1,
        C_FRAG => 3,
        C_FLASH => 4,
        C_SMOKE => 5,
        C_BOMB => 6,
        _ => 0,
    }
}

/// Fixed spray pattern: (sideways, upward) aim offset in radians for the
/// n-th consecutive shot. The client mirrors this to move the view.
pub fn recoil_offset(recoil: f32, shots: f32) -> (f32, f32) {
    let up = shots.min(9.0) * recoil;
    let side = if shots > 4.0 {
        recoil * 1.8 * ((shots - 4.0) * 0.5).sin() * ((shots - 4.0) / 4.0).min(1.0)
    } else {
        0.0
    };
    (side, up)
}
