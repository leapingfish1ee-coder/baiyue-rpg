use std::time::Instant;

fn main() {
    let seed = 20_260_808_u64;
    let count = 1_000_i64;
    let start = Instant::now();
    let mut checksum = 0_u64;

    for i in 0..count {
        let chunk = terrain_wasm::generate_chunk(seed, i - 500, (i * 17) % 251 - 125);
        checksum = chunk
            .iter()
            .fold(checksum, |acc, &value| acc.wrapping_mul(131).wrapping_add(value as u64));
    }

    let elapsed = start.elapsed();
    println!("generated {count} chunks in {elapsed:?}; checksum={checksum}");
    println!("average per chunk: {:?}", elapsed / count as u32);
}
