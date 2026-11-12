//! Geometry-level regression tests for spawn protection, independent of the
//! authored tile layout. Both directions matter: penetration uses the first wall.
use sim::map::Map;
use sim::physics::{
    collides, ray_world, ray_world_hit, step, PState, B_JUMP, EYE_STAND, H_CROUCH, H_STAND,
};
use sim::V3;

// Strongest firearm in server::game::shoot. The server allows one penetration,
// only when the first wall is strictly thinner than this many metres.
const SNIPER_PENETRATION: f32 = 2.6;

// Returns direct visibility and reach after the server's one-wall penetration.
fn shot_reaches(map: &Map, origin: V3, target: V3) -> (bool, bool) {
    let delta = std::array::from_fn::<_, 3, _>(|axis| target[axis] - origin[axis]);
    let distance = delta.iter().map(|v| v * v).sum::<f32>().sqrt();
    let direction = delta.map(|v| v / distance);
    let (wall_distance, thickness) = ray_world_hit(map, &origin, &direction, 250.0);
    let mut stop = wall_distance;
    if let Some(thickness) = thickness
        .filter(|thickness| *thickness < SNIPER_PENETRATION && wall_distance > 0.0)
    {
        let exit = wall_distance + thickness + 0.02;
        let after_wall = std::array::from_fn(|axis| origin[axis] + direction[axis] * exit);
        stop = exit + ray_world(map, &after_wall, &direction, 250.0);
    }
    (distance < wall_distance, distance < stop)
}

#[test]
fn every_opposing_spawn_pair_blocks_direct_and_penetrating_shots() {
    let map = Map::build();
    assert!(map.spawns.iter().all(|team| !team.is_empty()));
    let mut directly_exposed = 0;
    let mut bullet_reachable = 0;
    for a in &map.spawns[0] {
        for b in &map.spawns[1] {
            let a = [a[0], EYE_STAND, a[1]];
            let b = [b[0], EYE_STAND, b[1]];
            let forward = shot_reaches(&map, a, b);
            let reverse = shot_reaches(&map, b, a);
            directly_exposed += usize::from(forward.0 || reverse.0);
            bullet_reachable += usize::from(forward.1 || reverse.1);
        }
    }
    println!("{} opposing spawn pairs: {directly_exposed} direct sightlines, {bullet_reachable} sniper-reachable pairs",
        map.spawns[0].len() * map.spawns[1].len());
    assert_eq!(
        directly_exposed, 0, "opposing spawns have direct standing sightlines"
    );
    assert_eq!(
        bullet_reachable, 0, "a sniper can penetrate between opposing spawns"
    );
}

// A nearby sample must be reachable on foot, rather than lying on the other side
// of a room's wall. This checks the full player collision box along the segment.
fn walk_clear(map: &Map, from: [f32; 2], to: [f32; 2]) -> bool {
    let distance = ((to[0] - from[0]).powi(2) + (to[1] - from[1]).powi(2)).sqrt();
    let steps = (distance / 0.25).ceil().max(1.0) as usize;
    (0..=steps).all(|i| {
        let t = i as f32 / steps as f32;
        let position = [
            from[0] + (to[0] - from[0]) * t,
            0.001,
            from[1] + (to[1] - from[1]) * t,
        ];
        !collides(map, &position, H_STAND)
    })
}

fn spawn_room_samples(map: &Map, team: usize) -> Vec<[f32; 2]> {
    assert!(!map.spawns[team].is_empty());
    let mut samples = Vec::new();
    let mut add = |point: [f32; 2]| {
        if !samples.iter().any(|p: &[f32; 2]| {
            (p[0] - point[0]).abs() < 0.01 && (p[1] - point[1]).abs() < 0.01
        }) {
            samples.push(point);
        }
    };
    // Every spawn marker and the walkable space two metres around it.
    for &spawn in &map.spawns[team] {
        assert!(
            walk_clear(map, spawn, spawn), "spawn is inside collision: {spawn:?}"
        );
        for dx in [-2.0, 0.0, 2.0] {
            for dz in [-2.0, 0.0, 2.0] {
                let point = [spawn[0] + dx, spawn[1] + dz];
                if walk_clear(map, spawn, point) {
                    add(point);
                }
            }
        }
    }
    // Probe the courtyard from its spawn centroid out to its collision walls.
    // Sampling the midpoint and far edge covers lateral strafing room without
    // encoding this particular map's dimensions, buildings or tile layout.
    let center = std::array::from_fn(|axis| {
        map.spawns[team].iter().map(|p| p[axis]).sum::<f32>() / map.spawns[team].len() as f32
    });
    assert!(walk_clear(map, center, center));
    for direction in [[-1.0, 0.0], [1.0, 0.0], [0.0, -1.0], [0.0, 1.0]] {
        let mut extent = 0.0;
        for i in 1..=(map.w.max(map.h) * 4) {
            let distance = i as f32 * 0.5;
            let point = [
                center[0] + direction[0] * distance,
                center[1] + direction[1] * distance,
            ];
            if !walk_clear(map, center, point) {
                break;
            }
            extent = distance;
        }
        for distance in [extent * 0.5, extent] {
            add([
                center[0] + direction[0] * distance,
                center[1] + direction[1] * distance,
            ]);
        }
    }
    samples
}

fn stances(map: &Map, point: [f32; 2]) -> [PState; 3] {
    let standing = PState {
        pos: [point[0], 0.001, point[1]], ground: true, ..PState::default()
    };
    let crouching = PState { crouch: true, ..standing };
    let mut jumping = standing;
    let mut apex = standing;
    // Use real movement to get an attainable jump height, including ceilings.
    for _ in 0..90 {
        step(map, &mut jumping, B_JUMP, 0.0, 1.0 / 120.0, 6.0);
        if jumping.pos[1] > apex.pos[1] {
            apex = jumping;
        }
    }
    [standing, crouching, apex]
}

#[test]
fn spawn_rooms_block_crouching_standing_and_jumping_shots() {
    let map = Map::build();
    let samples = [spawn_room_samples(&map, 0), spawn_room_samples(&map, 1)];
    let poses = samples.each_ref().map(|team| {
        team.iter()
            .flat_map(|&point| stances(&map, point))
            .collect::<Vec<_>>()
    });
    let mut checked = 0;
    for team in 0..2 {
        for shooter in &poses[team] {
            for victim in &poses[1 - team] {
                let origin = shooter.eye();
                let height = if victim.crouch { H_CROUCH } else { H_STAND };
                let dx = victim.pos[0] - origin[0];
                let dz = victim.pos[2] - origin[2];
                let distance = dx.hypot(dz);
                // Head center and both exposed sides of the torso, inside the
                // actual server's 0.2m head sphere / 0.32m body half-width.
                for (y, side) in [
                    (height - 0.2, 0.0),
                    (height * 0.5, -0.31),
                    (height * 0.5, 0.31),
                ] {
                    let target = [
                        victim.pos[0] + dz / distance * side,
                        victim.pos[1] + y,
                        victim.pos[2] - dx / distance * side,
                    ];
                    let (visible, penetrable) = shot_reaches(&map, origin, target);
                    assert!(
                        !visible,
                        "direct spawn-room sightline: team {team}, {origin:?} -> {target:?}"
                    );
                    assert!(
                        !penetrable,
                        "sniper penetrates spawn protection: team {team}, {origin:?} -> {target:?}"
                    );
                    checked += 1;
                }
            }
        }
    }
    println!("{} attacker / {} defender room samples: {checked} blocked stance and target-edge rays",
        samples[0].len(), samples[1].len());
}
