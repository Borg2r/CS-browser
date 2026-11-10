//! Shared simulation core: map, collision, movement and the weapon table.
//! Compiled natively into the server and to WebAssembly for the client.
pub mod map;
pub mod physics;
pub mod weapons;

pub type V3 = [f32; 3];
