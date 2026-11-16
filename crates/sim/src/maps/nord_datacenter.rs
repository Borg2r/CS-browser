//! NORD DC-02, adapted from NORD_Datacenter_Completo_v12_IFC4.ifc.
//!
//! The source is metres, X east / Y north. Horizontal coordinates are doubled:
//! game x = 2 * (IFC x - 22), game z = 2 * (12 - IFC y). The 32 x 24 m main
//! building, southern 32 x 14 m annex, east plant yard and four rows of twelve
//! racks retain their source relationships. Doorways and two rack cross-aisles
//! are widened for players and the one-metre bot grid. Upper offices remain a
//! solid, unreachable NOC silhouette; every playable route is on one level.
//!
//! mat 2: rack cabinets (var = source row); mat 3: UPS / desks / cargo / consoles
//! (var 0 / 1 / 2 / 3); mat 4: chillers / generators / pumps / barriers (0..3).
//! Decorative detail must stay on these solid bodies. Native and WASM share
//! the complete collision, including roofs, equipment and spawn protection.
use crate::map::{Aabb, Map, MapId, Zone};

fn solid(boxes: &mut Vec<Aabb>, min: [f32; 3], max: [f32; 3], mat: u8, var: u8) {
    boxes.push(Aabb { min, max, mat, var });
}

// axis 0 runs east-west, axis 2 north-south. Gaps are actual clear passages.
fn wall(boxes: &mut Vec<Aabb>, axis: usize, fixed: f32, start: f32, end: f32, gaps: &[(f32, f32)]) {
    let mut cursor = start;
    for &(a, b) in gaps.iter().chain(std::iter::once(&(end, end))) {
        if a > cursor {
            let (min, max) = if axis == 0 {
                ([cursor, 0.0, fixed - 0.25], [a, 5.2, fixed + 0.25])
            } else {
                ([fixed - 0.25, 0.0, cursor], [fixed + 0.25, 5.2, a])
            };
            solid(boxes, min, max, 1, 0);
        }
        cursor = b;
    }
}

pub fn build() -> Map {
    // Added security courts sit outside the source footprint. Their six-metre
    // deep front screens and offset side exits also stop sniper penetration.
    let (w, h) = (60, 74);
    let mut grid = vec![vec![b'.'; w]; h];
    for r in 0..h { for c in 0..w {
        if r == 0 || c == 0 || r == h - 1 || c == w - 1 { grid[r][c] = b'#'; }
    }}
    let mark = |grid: &mut Vec<Vec<u8>>, x: i32, z: i32, ch: u8| {
        grid[((z + h as i32) / 2) as usize][((x + w as i32) / 2) as usize] = ch;
    };
    for x in [-15, -11, -7, -3, 1, 5] {
        for z in [-51, -47] { mark(&mut grid, x, z, b'1'); }
        for z in [67, 69] { mark(&mut grid, x, z, b'2'); }
    }
    mark(&mut grid, -12, 16, b'A'); mark(&mut grid, -24, 42, b'B');
    let rows: Vec<String> = grid.into_iter().map(|r| String::from_utf8(r).unwrap()).collect();
    let rows: Vec<&str> = rows.iter().map(String::as_str).collect();
    let mut boxes = Vec::new();

    for (z0, z1) in [(-36.0, -30.0), (54.0, 60.0)] {
        solid(&mut boxes, [-44.0, 0.0, z0], [40.0, 8.0, z1], 1, 5);
    }
    for (z0, z1) in [(-74.0, -42.0), (64.0, 74.0)] {
        for (x0, x1) in [(-38.0, -34.0), (30.0, 34.0)] {
            solid(&mut boxes, [x0, 0.0, z0], [x1, 8.0, z1], 1, 5);
        }
    }

    // Main source facades, front reception / loading corridor and plant access.
    wall(&mut boxes, 0, -24.0, -44.0, 20.0, &[(-40.0, -34.0), (-28.0, -22.0), (8.0, 14.0)]);
    wall(&mut boxes, 2, -44.0, -24.0, 52.0, &[(-6.0, 0.0), (16.0, 22.0), (38.0, 44.0)]);
    wall(&mut boxes, 2, 20.0, -24.0, 52.0, &[(-6.0, 0.0), (17.0, 23.0), (36.0, 42.0)]);
    wall(&mut boxes, 0, 52.0, -44.0, 20.0, &[(-28.0, -22.0), (8.0, 14.0)]);

    // Source front support rooms. Adjacent small WC/lift spaces are combined
    // into a wider security/NOC access room, rather than dead-end cubicles.
    wall(&mut boxes, 0, -14.0, -44.0, 20.0, &[(-40.0, -35.0), (-28.0, -23.0), (-18.0, -13.0), (-7.0, -3.0), (8.0, 14.0)]);
    for x in [-32.0, -22.0, -12.0, -3.0] {
        wall(&mut boxes, 2, x, -24.0, -14.0, &[]);
    }
    // Two doors into the data hall and a clear continuation into plant rooms.
    wall(&mut boxes, 0, -10.0, -44.0, 20.0, &[(-36.0, -30.0), (-16.0, -10.0), (-6.0, -2.0), (8.0, 14.0)]);

    // Data hall -> technical corridor -> UPS A/B, electrical and pump rooms.
    wall(&mut boxes, 2, -6.0, -10.0, 24.0, &[(-6.0, -2.0), (3.0, 7.0), (17.0, 21.0)]);
    wall(&mut boxes, 2, -2.0, -10.0, 24.0, &[(-6.0, -3.0), (2.0, 5.0), (10.0, 13.0), (19.0, 22.0)]);
    for z in [0.0, 8.0, 16.0] {
        wall(&mut boxes, 0, z, -2.0, 20.0, &[(10.0, 14.0)]);
    }

    // The real annex connection has a transverse corridor and two large rooms.
    wall(&mut boxes, 0, 24.0, -44.0, 20.0, &[(-34.0, -28.0), (-16.0, -10.0), (-6.0, -2.0), (8.0, 14.0)]);
    wall(&mut boxes, 0, 30.0, -44.0, 20.0, &[(-34.0, -28.0), (-18.0, -12.0), (8.0, 14.0)]);
    wall(&mut boxes, 2, -7.0, 30.0, 52.0, &[(38.0, 44.0)]);

    // Forty-eight distinct 42U cabinets, in the source's four rows of twelve.
    // Bank 2/3 shift by .8/1.6 m to widen the source's narrow crossing slots.
    let source_y = [3.0_f32, 5.92, 9.5, 12.42];
    for (row, y) in source_y.into_iter().enumerate() {
        for bank in 0..3 { for cabinet in 0..4 {
            let x0 = -38.0 + bank as f32 * 6.8 + cabinet as f32 * 1.2;
            solid(&mut boxes, [x0, 0.0, 24.0 - (y + 1.42) * 2.0],
                [x0 + 1.2, 2.7, 24.0 - y * 2.0], 2, row as u8);
        }}
    }

    // Redundant UPS A/B and electrical switchboards leave broad central aisles.
    for z in [18.2, 10.2, 2.2] {
        for x in [2.0, 6.0] {
            solid(&mut boxes, [x, 0.0, z], [x + 2.0, 2.4, z + 3.5], 3, 0);
        }
    }
    for x in [2.0, 8.0] {
        solid(&mut boxes, [x, 0.0, -7.0], [x + 3.0, 1.6, -4.5], 4, 2);
    }
    // Reception, workshop and security consoles are on source room footprints.
    for (min, max, var) in [
        ([-42.0, 0.0, -20.5], [-37.0, 1.0, -18.8], 1),
        ([-20.0, 0.0, -22.0], [-15.0, 1.0, -20.2], 1),
        ([0.0, 0.0, -22.0], [5.0, 1.1, -20.2], 3),
        ([-30.0, 0.0, -21.5], [-27.0, 1.5, -18.5], 2),
        ([-40.0, 0.0, 33.0], [-35.0, 1.5, 36.0], 2),
        ([-17.0, 0.0, 45.0], [-12.0, 1.5, 48.0], 2),
        ([-36.0, 0.0, 46.0], [-31.0, 1.0, 48.0], 1),
        ([-3.0, 0.0, 33.0], [3.0, 0.85, 35.0], 1),
        ([10.0, 0.0, 46.0], [16.0, 0.85, 48.0], 1),
    ] { solid(&mut boxes, min, max, 3, var); }

    // Source east-yard CH-01/02 and GEN-01/02 positions, retaining 12m bodies.
    for z in [15.4, 5.4] {
        solid(&mut boxes, [26.0, 0.0, z], [38.0, 2.2, z + 4.6], 4, 0);
    }
    for z in [-4.6, -16.6] {
        solid(&mut boxes, [26.0, 0.0, z], [38.0, 3.2, z + 4.65], 4, 1);
    }
    // A few low barriers break up the added peripheral service lanes.
    for (x, z) in [(-53.0, -16.0), (-53.0, 12.0), (-53.0, 40.0), (46.0, -20.0), (46.0, 14.0), (30.0, 40.0)] {
        solid(&mut boxes, [x, 0.0, z], [x + 3.0, 1.05, z + 4.0], 4, 3);
    }

    solid(&mut boxes, [-44.0, 5.2, -24.0], [20.0, 5.55, 24.0], 1, 0);
    solid(&mut boxes, [-44.0, 5.0, 24.0], [20.0, 5.35, 52.0], 1, 0);
    // The actual upper offices sit only over the north reception strip.
    solid(&mut boxes, [-44.0, 5.55, -24.0], [20.0, 9.0, -10.0], 1, 4);

    let mut map = Map::from_rows(MapId::NordDatacenter, &rows,
        |ch| if ch == b'#' { Some((9.0, 1)) } else { None }, &boxes,
        [[[-50.0, -49.0], [48.0, -49.0]], [[-50.0, 68.0], [48.0, 68.0]]]);
    // A is the source hall's wide service strip; B is the future expansion hall.
    map.sites = [Zone { min: [-16.0, 12.0], max: [-8.0, 20.0] },
        Zone { min: [-28.0, 38.0], max: [-20.0, 46.0] }];
    map
}
