//! Client-side movement prediction: the exact same `sim::physics::step`
//! the server runs, compiled to WebAssembly with a tiny C-style ABI.
use sim::physics::{step, PState};
use std::ptr::addr_of_mut;

static mut STATE: [f32; 9] = [0.0; 9];

#[no_mangle]
pub extern "C" fn state_ptr() -> *mut f32 {
    addr_of_mut!(STATE) as *mut f32
}

#[no_mangle]
pub extern "C" fn sim_step(buttons: u32, yaw: f32, dt: f32, max_speed: f32) {
    // Single-threaded wasm: the JS side is the only other accessor.
    let buf = unsafe { &mut *addr_of_mut!(STATE) };
    let mut s = PState::from_array(buf);
    step(sim::map::map(), &mut s, buttons, yaw, dt, max_speed);
    *buf = s.to_array();
}
