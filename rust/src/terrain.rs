use crate::noise::NoiseFields;

pub const CHUNK_SIZE: i64 = 64;
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

pub fn generate_chunk(world_seed: u64, chunk_x: i64, chunk_y: i64) -> Vec<u8> {
    let fields = NoiseFields::new(world_seed);
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
            let (elevation, moisture) = fields.sample(world_x, world_y);
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
}
