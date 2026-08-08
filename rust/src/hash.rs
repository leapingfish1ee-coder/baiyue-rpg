/// SplitMix64. Used only to derive independent 32-bit seeds for noise fields.
pub fn splitmix64(mut value: u64) -> u64 {
    value = value.wrapping_add(0x9E37_79B9_7F4A_7C15);
    value = (value ^ (value >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    value = (value ^ (value >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    value ^ (value >> 31)
}

pub fn derive_i32(world_seed: u64, tag: u64) -> i32 {
    let mixed = splitmix64(world_seed ^ tag);
    (mixed as u32) as i32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seed_derivation_is_deterministic() {
        assert_eq!(derive_i32(42, 7), derive_i32(42, 7));
    }

    #[test]
    fn tags_create_independent_streams() {
        assert_ne!(derive_i32(42, 1), derive_i32(42, 2));
    }
}
