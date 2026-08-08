use crate::macro_world::{MacroNeighborhood, MACRO_CELL_TILES};
use crate::noise::NoiseFields;

/// One runtime chunk is exactly one macro-map pixel expanded to playable tiles.
pub const CHUNK_SIZE: i64 = MACRO_CELL_TILES;
pub const CHUNK_AREA: usize = (CHUNK_SIZE * CHUNK_SIZE) as usize;

#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Terrain {
    DeepWater = 0,
    Water = 1,
    Sand = 2,
    Grass = 3,
    Forest = 4,
    Rock = 5,
    Snow = 6,
}

impl Terrain {
    pub fn classify(elevation: f32, moisture: f32) -> Self {
        if elevation < -0.25 {
            Self::DeepWater
        } else if elevation < -0.10 {
            Self::Water
        } else if elevation < -0.02 {
            Self::Sand
        } else if elevation > 0.78 {
            Self::Snow
        } else if elevation > 0.58 {
            Self::Rock
        } else if moisture > 0.30 {
            Self::Forest
        } else {
            Self::Grass
        }
    }
}

pub fn macro_cell_biome(world_seed: u64, macro_x: i64, macro_y: i64) -> Terrain {
    let fields = NoiseFields::new(world_seed);
    let (elevation, moisture) = fields.sample_macro(macro_x, macro_y);
    Terrain::classify(elevation, moisture)
}

pub fn generate_chunk(world_seed: u64, chunk_x: i64, chunk_y: i64) -> Vec<u8> {
    let fields = NoiseFields::new(world_seed);
    let macro_neighborhood = MacroNeighborhood::new(world_seed, chunk_x, chunk_y, &fields);
    let mut output = vec![0u8; CHUNK_AREA];

    let base_x = chunk_x
        .checked_mul(CHUNK_SIZE)
        .expect("chunk_x is outside supported i64 world range");
    let base_y = chunk_y
        .checked_mul(CHUNK_SIZE)
        .expect("chunk_y is outside supported i64 world range");

    for local_y in 0..CHUNK_SIZE {
        for local_x in 0..CHUNK_SIZE {
            let world_x = base_x + local_x;
            let world_y = base_y + local_y;
            let (macro_elevation, macro_moisture) = macro_neighborhood.sample_tile(world_x, world_y);
            let (local_elevation, local_moisture) = fields.sample_local(world_x, world_y);

            // Macro pixels define the dominant region. Local fields add playable-scale
            // variation without becoming a second independent chunk generator.
            let elevation = (macro_elevation + local_elevation * 0.085).clamp(-1.0, 1.0);
            let moisture = (macro_moisture + local_moisture * 0.12).clamp(-1.0, 1.0);
            let terrain = Terrain::classify(elevation, moisture);
            let index = (local_y * CHUNK_SIZE + local_x) as usize;
            output[index] = terrain as u8;
        }
    }

    output
}

#[cfg(test)]
mod tests {
    use super::*;

    fn checksum(bytes: &[u8]) -> u64 {
        let mut hash = 0xcbf2_9ce4_8422_2325u64;
        for byte in bytes {
            hash ^= *byte as u64;
            hash = hash.wrapping_mul(0x1000_0000_01b3);
        }
        hash
    }

    #[test]
    fn chunk_has_expected_size() {
        assert_eq!(generate_chunk(1, 0, 0).len(), CHUNK_AREA);
    }

    #[test]
    fn generation_is_deterministic() {
        assert_eq!(generate_chunk(12345, -7, 9), generate_chunk(12345, -7, 9));
    }

    #[test]
    fn seed_changes_output() {
        assert_ne!(generate_chunk(1, 0, 0), generate_chunk(2, 0, 0));
    }

    #[test]
    fn negative_chunk_coordinates_map_contiguously() {
        assert_eq!((-1_i64) * CHUNK_SIZE + (CHUNK_SIZE - 1), -1);
        assert_eq!(0_i64 * CHUNK_SIZE, 0);
    }

    #[test]
    fn all_ids_are_valid() {
        for id in generate_chunk(999, 12, -34) {
            assert!(id <= Terrain::Snow as u8);
        }
    }

    #[test]
    fn macro_biome_is_valid() {
        assert!((macro_cell_biome(88, -12, 7) as u8) <= Terrain::Snow as u8);
    }

    #[test]
    fn eight_by_eight_region_is_visit_order_independent() {
        let seed = 0xBADC_0FFE_E0DD_F00Du64;
        let mut forward = Vec::new();
        for y in -4..4 {
            for x in -4..4 {
                forward.push(((x, y), checksum(&generate_chunk(seed, x, y))));
            }
        }

        let mut reverse = Vec::new();
        for y in (-4..4).rev() {
            for x in (-4..4).rev() {
                reverse.push(((x, y), checksum(&generate_chunk(seed, x, y))));
            }
        }
        forward.sort_by_key(|entry| entry.0);
        reverse.sort_by_key(|entry| entry.0);
        assert_eq!(forward, reverse);
    }
}
