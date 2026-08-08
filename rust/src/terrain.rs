use crate::hash::hash_coords;
use crate::macro_world::{MacroNeighborhood, MACRO_CELL_TILES};
use crate::noise::NoiseFields;

/// One runtime chunk is exactly one macro-map pixel expanded to playable tiles.
pub const CHUNK_SIZE: i64 = MACRO_CELL_TILES;
pub const CHUNK_AREA: usize = (CHUNK_SIZE * CHUNK_SIZE) as usize;
pub const CHUNK_OUTPUT_BYTES: usize = CHUNK_AREA * 2;

const GRASS_TAG: u64 = 0x4752_4153_535F_5633;
const GROVE_CLUSTER_TAG: u64 = 0x4752_4F56_455F_4333;
const GROVE_SINGLETON_TAG: u64 = 0x4752_4F56_455F_5333;
const GROVE_CLUSTER_CELL: i64 = 8;

#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BaseTerrain {
    DeepWater = 0,
    Water = 1,
    Sand = 2,
    Land = 3,
    Rock = 4,
    Snow = 5,
}

impl BaseTerrain {
    pub fn classify(elevation: f32) -> Self {
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
        } else {
            Self::Land
        }
    }
}

#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decoration {
    None = 0,
    Grass = 1,
    Grove = 2,
}

pub fn macro_cell_biome(world_seed: u64, macro_x: i64, macro_y: i64) -> BaseTerrain {
    let fields = NoiseFields::new(world_seed);
    let (elevation, _) = fields.sample_macro(macro_x, macro_y);
    BaseTerrain::classify(elevation)
}

fn hash01(value: u64) -> f32 {
    const DENOMINATOR: f32 = 16_777_215.0;
    ((value >> 40) & 0x00ff_ffff) as f32 / DENOMINATOR
}

fn grove_cluster_contains(world_seed: u64, world_x: i64, world_y: i64, moisture: f32) -> bool {
    let moisture01 = ((moisture + 1.0) * 0.5).clamp(0.0, 1.0);
    let cell_x = world_x.div_euclid(GROVE_CLUSTER_CELL);
    let cell_y = world_y.div_euclid(GROVE_CLUSTER_CELL);
    let activation_threshold = 0.06 + moisture01 * 0.14;

    for offset_y in -1..=1 {
        for offset_x in -1..=1 {
            let candidate_x = cell_x + offset_x;
            let candidate_y = cell_y + offset_y;
            let signature = hash_coords(
                world_seed,
                GROVE_CLUSTER_TAG,
                candidate_x,
                candidate_y,
            );
            if hash01(signature) >= activation_threshold {
                continue;
            }

            let center_x = candidate_x * GROVE_CLUSTER_CELL + ((signature >> 8) & 7) as i64;
            let center_y = candidate_y * GROVE_CLUSTER_CELL + ((signature >> 16) & 7) as i64;
            let radius = 1.25 + (((signature >> 24) & 3) as f32) * 0.40;
            let dx = (world_x - center_x) as f32;
            let dy = (world_y - center_y) as f32;
            if dx * dx + dy * dy <= radius * radius {
                return true;
            }
        }
    }

    false
}

fn decoration_for_land(world_seed: u64, world_x: i64, world_y: i64, moisture: f32) -> Decoration {
    let moisture01 = ((moisture + 1.0) * 0.5).clamp(0.0, 1.0);

    if grove_cluster_contains(world_seed, world_x, world_y, moisture) {
        return Decoration::Grove;
    }

    let singleton_chance = 0.004 + moisture01 * 0.016;
    if hash01(hash_coords(
        world_seed,
        GROVE_SINGLETON_TAG,
        world_x,
        world_y,
    )) < singleton_chance
    {
        return Decoration::Grove;
    }

    let grass_chance = 0.08 + moisture01 * 0.18;
    if hash01(hash_coords(world_seed, GRASS_TAG, world_x, world_y)) < grass_chance {
        Decoration::Grass
    } else {
        Decoration::None
    }
}

/// Generate two semantic planes in one allocation:
/// [0..CHUNK_AREA) = BaseTerrain, [CHUNK_AREA..2*CHUNK_AREA) = Decoration.
pub fn generate_chunk(world_seed: u64, chunk_x: i64, chunk_y: i64) -> Vec<u8> {
    let fields = NoiseFields::new(world_seed);
    let macro_neighborhood = MacroNeighborhood::new(chunk_x, chunk_y, &fields);
    let mut output = vec![0u8; CHUNK_OUTPUT_BYTES];

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
            let base_terrain = BaseTerrain::classify(elevation);
            let decoration = if base_terrain == BaseTerrain::Land {
                decoration_for_land(world_seed, world_x, world_y, moisture)
            } else {
                Decoration::None
            };

            let index = (local_y * CHUNK_SIZE + local_x) as usize;
            output[index] = base_terrain as u8;
            output[CHUNK_AREA + index] = decoration as u8;
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

    fn planes(bytes: &[u8]) -> (&[u8], &[u8]) {
        bytes.split_at(CHUNK_AREA)
    }

    #[test]
    fn chunk_has_expected_two_plane_size() {
        assert_eq!(generate_chunk(1, 0, 0).len(), CHUNK_OUTPUT_BYTES);
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
        let generated = generate_chunk(999, 12, -34);
        let (base, decoration) = planes(&generated);
        assert!(base.iter().all(|id| *id <= BaseTerrain::Snow as u8));
        assert!(decoration.iter().all(|id| *id <= Decoration::Grove as u8));
    }

    #[test]
    fn decorations_only_exist_on_land() {
        let generated = generate_chunk(0xD3C0_A710, 2, -3);
        let (base, decoration) = planes(&generated);
        for index in 0..CHUNK_AREA {
            if decoration[index] != Decoration::None as u8 {
                assert_eq!(base[index], BaseTerrain::Land as u8);
            }
        }
    }

    #[test]
    fn land_is_the_primary_walkable_surface_and_decorations_are_sparse() {
        let seed = 0xBA17_2026_0808_u64;
        let mut land_count = 0usize;
        let mut grass_count = 0usize;
        let mut grove_count = 0usize;

        for y in -2..=2 {
            for x in -2..=2 {
                let generated = generate_chunk(seed, x, y);
                let (base, decoration) = planes(&generated);
                for index in 0..CHUNK_AREA {
                    if base[index] == BaseTerrain::Land as u8 {
                        land_count += 1;
                        if decoration[index] == Decoration::Grass as u8 {
                            grass_count += 1;
                        } else if decoration[index] == Decoration::Grove as u8 {
                            grove_count += 1;
                        }
                    }
                }
            }
        }

        assert!(land_count > 0);
        assert!(grass_count > 0);
        assert!(grove_count > 0);
        assert!(grass_count + grove_count < land_count);
    }

    #[test]
    fn macro_biome_is_valid() {
        assert!((macro_cell_biome(88, -12, 7) as u8) <= BaseTerrain::Snow as u8);
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
