mod hash;
mod macro_world;
mod noise;
mod terrain;

use macro_world::{edge_contract, EdgeDirection};
use wasm_bindgen::prelude::*;

pub const GENERATOR_VERSION: u32 = 2;

#[wasm_bindgen]
pub fn generator_version() -> u32 {
    GENERATOR_VERSION
}

#[wasm_bindgen]
pub fn chunk_size() -> u32 {
    terrain::CHUNK_SIZE as u32
}

/// Return the dominant biome of one macro-map pixel.
#[wasm_bindgen]
pub fn macro_cell_biome(seed: u64, macro_x: i64, macro_y: i64) -> u8 {
    terrain::macro_cell_biome(seed, macro_x, macro_y) as u8
}

/// Return the shared deterministic signature for one macro-cell edge.
/// Direction: 0=N, 1=E, 2=S, 3=W.
#[wasm_bindgen]
pub fn macro_edge_signature(seed: u64, macro_x: i64, macro_y: i64, direction: u8) -> u64 {
    let direction = EdgeDirection::from_u8(direction).expect("direction must be 0..=3");
    edge_contract(seed, macro_x, macro_y, direction).signature
}

/// Generate one macro pixel expanded into a 64×64 playable semantic TileMap region.
/// JavaScript passes `u64`/`i64` as BigInt through wasm-bindgen.
#[wasm_bindgen]
pub fn generate_chunk(seed: u64, chunk_x: i64, chunk_y: i64) -> Vec<u8> {
    terrain::generate_chunk(seed, chunk_x, chunk_y)
}
