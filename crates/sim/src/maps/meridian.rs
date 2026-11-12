//! MV Meridian: a cargo vessel with a forward muster deck and stern bridge.
//! Bounds x ±38m, z ±66m. Bow is +z; port cargo site B and stern bridge
//! site A connect through both side decks and staggered container aisles.
//! The 1.35m bulwark is below eye height but above the maximum jump step.
use crate::map::{standard_tile, Aabb, Map, MapId};

// One cell is two metres. Traversal stays on the y=0 deck / quay;
// all overhead structures have matching physical ceiling boxes.
const ROWS: &[&str] = &[
    "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
    "RHHH..............................HHHR",
    "RHHH..............................HHHR",
    "RHHH...........22222222...........HHHR",
    "RHHH...........22222222...........HHHR",
    "RHHH...........22222222...........HHHR",
    "RHHH..............................HHHR",
    "RHHH..............................HHHR",
    "RHHH..............................HHHR",
    "R.........HHHHHHHHHHHHHHHHHH.........R",
    "R.........HHHHHHHHHHHHHHHHHH.........R",
    "R.........HHHHHHHHHHHHHHHHHH.........R",
    "R.........HHHHHHHHHHHHHHHHHH.........R",
    "R....................................R",
    "R....................................R",
    "R.........kk.........................R",
    "R.........kk.........LLL....LLLL.....R",
    "R....................LAAAAAAAAAL.....R",
    "R....................LAAAAAAAAAL.....R",
    "RDDDDDDDD......DDDDD..AAAAAAAAA......R",
    "RDDDDDDDD......DDDDD..AAAAAAAAA......R",
    "R..............DDDDD..AAAAAAAAA......R",
    "R.....DDDDDDDD.DDDDD.LAAAAAAAAAL.....R",
    "R.....DDDDDDDD.DDDDD.LLLL....LLL.....R",
    "R.....BBBBBBBB.DDDDD.................R",
    "R.....BBBBBBBB.DDDDD.................R",
    "R.....BBBBBBBB.......................R",
    "R.....BBBBBBBB.......................R",
    "R.....BBBBBBBB...........CCCC........R",
    "R.....BBBBBBBB...DDDDDD..CCCC........R",
    "R.....BBBBBBBB...DDDDDD..............R",
    "R................DDDDDD..............R",
    "R.......CCCC.....DDDDDD..............R",
    "R.......CCCC.....DDDDDD.......DDDDDDDR",
    "R................DDDDDD.......DDDDDDDR",
    "R................DDDDDD..............R",
    "R........DDDDDD......................R",
    "R........DDDDDD......................R",
    "R........DDDDDD.........DDDDDDD......R",
    "R........DDDDDD.........DDDDDDD......R",
    "R........DDDDDD.........DDDDDDD......R",
    "R........DDDDDD.........DDDDDDD......R",
    "R.......................DDDDDDD......R",
    "R.......................DDDDDDD......R",
    "R....................................R",
    "RDDDDDDD.............................R",
    "RDDDDDDD.............................R",
    "R.........cc...DDDDDDD...CCCC........R",
    "R.........cc...DDDDDDD...CCCC........R",
    "R..............DDDDDDD...............R",
    "R..............DDDDDDD...kk..........R",
    "R....................................R",
    "R....................................R",
    "R.........HHHHHHHHHHHHHHHHHH.........R",
    "R.........HHHHHHHHHHHHHHHHHH.........R",
    "R.........HHHHHHHHHHHHHHHHHH.........R",
    "R.........HHHHHHHHHHHHHHHHHH.........R",
    "RHHH..............................HHHR",
    "RHHH..............................HHHR",
    "RHHH..............................HHHR",
    "RHHH...........11111111...........HHHR",
    "RHHH...........11111111...........HHHR",
    "RHHH...........11111111...........HHHR",
    "RHHH..............................HHHR",
    "RHHH..............................HHHR",
    "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
];

fn tile_style(ch: u8) -> Option<(f32, u8)> {
    match ch {
        b'R' => Some((1.35, 4)),
        b'L' => Some((5.0, 1)),
        b'C' => Some((2.6, 2)),
        b'D' => Some((5.2, 2)),
        _ => standard_tile(ch),
    }
}

const EXTRAS: &[Aabb] = &[
    // Physical roof over the bridge room; no decorative platform pretends
    // to be a second walkable deck. Door clearance is five metres.
    Aabb {
        min: [4.0, 5.0, -34.0],
        max: [26.0, 5.5, -18.0],
        mat: 1,
        var: 1,
    },
];

pub fn build() -> Map {
    Map::from_rows(
        MapId::Meridian,
        ROWS,
        tile_style,
        EXTRAS,
        [
            [[-25.0, 57.0], [25.0, 57.0]],
            [[-25.0, -57.0], [25.0, -57.0]],
        ],
    )
}

#[cfg(test)]
mod tests {
    use super::build;
    use crate::physics::{step, PState, B_CROUCH, B_FWD, B_JUMP};
    use std::f32::consts::{FRAC_PI_2, PI};

    #[test]
    fn low_bulwarks_stop_running_and_crouch_jumping_overboard() {
        let map = build();
        for (position, yaw) in [
            ([34.0, 0.001, -8.0], -FRAC_PI_2),
            ([-34.0, 0.001, -8.0], FRAC_PI_2),
            ([0.0, 0.001, -62.0], 0.0),
            ([0.0, 0.001, 62.0], PI),
        ] {
            for crouch in [false, true] {
                let mut player = PState {
                    pos: position,
                    ground: true,
                    ..PState::default()
                };
                for tick in 0..360 {
                    // Release between attempts so this exercises several real
                    // jumps while pressing into each exposed hull boundary.
                    let buttons = B_FWD
                        | if tick % 90 < 45 { B_JUMP } else { 0 }
                        | if crouch { B_CROUCH } else { 0 };
                    step(&map, &mut player, buttons, yaw, 1.0 / 120.0, 6.35);
                    assert!(player.pos[0].abs() < 36.0 && player.pos[2].abs() < 64.0);
                    assert!(player.pos[1] >= 0.0, "player fell below the deck");
                }
            }
        }
    }
}
