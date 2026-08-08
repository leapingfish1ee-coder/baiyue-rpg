/// SplitMix64. Used to derive deterministic independent random streams.
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

pub fn hash_coords(world_seed: u64, tag: u64, x: i64, y: i64) -> u64 {
    let x_mix = splitmix64(x as u64);
    let y_mix = splitmix64((y as u64).rotate_left(32));
    splitmix64(world_seed ^ tag ^ x_mix ^ y_mix)
}

/// Hash an undirected edge. A→B and B→A always produce the same signature.
pub fn hash_edge(
    world_seed: u64,
    tag: u64,
    ax: i64,
    ay: i64,
    bx: i64,
    by: i64,
) -> u64 {
    let ((first_x, first_y), (second_x, second_y)) = if (ax, ay) <= (bx, by) {
        ((ax, ay), (bx, by))
    } else {
        ((bx, by), (ax, ay))
    };

    let first = hash_coords(world_seed, tag, first_x, first_y);
    hash_coords(first, tag.rotate_left(17), second_x, second_y)
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

    #[test]
    fn undirected_edge_hash_is_symmetric() {
        let ab = hash_edge(7, 99, -4, 12, -3, 12);
        let ba = hash_edge(7, 99, -3, 12, -4, 12);
        assert_eq!(ab, ba);
    }
}
