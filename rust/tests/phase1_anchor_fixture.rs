const SEED: u64 = 20_260_809;
const EXPECTED_GENERATOR_VERSION: u32 = 3;
const TERRAIN_FIXTURE: &str = include_str!("../../web/tests/fixtures/phase1-anchor-terrain.tsv");

fn fnv1a64(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf2_9ce4_8422_2325_u64, |hash, byte| {
        (hash ^ u64::from(*byte)).wrapping_mul(0x0000_0100_0000_01b3)
    })
}

#[test]
fn native_generator_matches_every_chunk_accessed_by_gate_b() {
    assert_eq!(terrain_wasm::GENERATOR_VERSION, EXPECTED_GENERATOR_VERSION);

    let mut checked = 0_u32;
    for line in TERRAIN_FIXTURE.lines().filter(|line| !line.starts_with('#') && !line.is_empty()) {
        let mut fields = line.split('\t');
        let chunk_x = fields.next().expect("chunk_x").parse::<i64>().expect("valid chunk_x");
        let chunk_y = fields.next().expect("chunk_y").parse::<i64>().expect("valid chunk_y");
        let expected = u64::from_str_radix(fields.next().expect("checksum"), 16).expect("valid checksum");
        assert!(fields.next().is_none(), "fixture row must contain exactly three fields");

        let generated = terrain_wasm::generate_chunk(SEED, chunk_x, chunk_y);
        assert_eq!(generated.len(), 8192, "chunk {chunk_x},{chunk_y} byte length");
        assert_eq!(fnv1a64(&generated), expected, "chunk {chunk_x},{chunk_y} checksum");
        checked += 1;
    }
    assert_eq!(checked, 9, "Gate B must cover the exact 3x3 chunk neighborhood it accessed");
}
