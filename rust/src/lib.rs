mod hash;
mod noise;
mod terrain;

use wasm_bindgen::prelude::*;

pub const GENERATOR_VERSION: u32 = 1;

#[wasm_bindgen]
pub fn generator_version() -> u32 {
    GENERATOR_VERSION
}

#[wasm_bindgen]
pub fn chunk_size() -> u32 {
    terrain::CHUNK_SIZE as u32
}

/// Generate one 64x64 semantic terrain chunk.
///
/// JavaScript passes `u64`/`i64` as BigInt through wasm-bindgen.
/// Output is row-major terrain IDs, one byte per tile.
#[wasm_bindgen]
pub fn generate_chunk(seed: u64, chunk_x: i64, chunk_y: i64) -> Vec<u8> {
    terrain::generate_chunk(seed, chunk_x, chunk_y)
}
