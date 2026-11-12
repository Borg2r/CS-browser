//! Client-side movement prediction: the exact same `sim::physics::step`
//! the server runs, compiled to WebAssembly with a tiny C-style ABI.
use sim::physics::{step, PState};
use sim::map::{map_by_id, MapId};
use std::ptr::addr_of_mut;

static mut STATE: [f32; 9] = [0.0; 9];
static mut MAP: MapId = MapId::Sirocco;

/// Switch prediction to the exact native map geometry. Invalid indices leave
/// both map and prediction state unchanged. JavaScript calls this on hello.
#[no_mangle]
pub extern "C" fn select_map(index: u32) -> u32 {
    let Some(id) = MapId::from_index(index) else { return 0 };
    unsafe {
        MAP = id;
        STATE = [0.0; 9];
    }
    1
}

#[no_mangle]
pub extern "C" fn state_ptr() -> *mut f32 {
    addr_of_mut!(STATE) as *mut f32
}

#[no_mangle]
pub extern "C" fn sim_step(buttons: u32, yaw: f32, dt: f32, max_speed: f32) {
    // Single-threaded wasm: the JS side is the only other accessor.
    let buf = unsafe { &mut *addr_of_mut!(STATE) };
    let mut s = PState::from_array(buf);
    step(map_by_id(unsafe { MAP }), &mut s, buttons, yaw, dt, max_speed);
    *buf = s.to_array();
}
