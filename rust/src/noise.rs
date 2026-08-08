use fastnoise_lite::{DomainWarpType, FastNoiseLite, FractalType, NoiseType};

use crate::hash::derive_i32;

const MACRO_ELEVATION_TAG: u64 = 0x4D41_4352_4F45_4C56; // MACROELV
const MACRO_DETAIL_TAG: u64 = 0x4D41_4352_4F44_544C; // MACRODTL
const MACRO_MOISTURE_TAG: u64 = 0x4D41_4352_4F4D_4F49; // MACROMOI
const MACRO_WARP_TAG: u64 = 0x4D41_4352_4F57_4152; // MACROWAR
const LOCAL_ELEVATION_TAG: u64 = 0x4C4F_4341_4C45_4C56; // LOCALELV
const LOCAL_MOISTURE_TAG: u64 = 0x4C4F_4341_4C4D_4F49; // LOCALMOI

pub struct NoiseFields {
    macro_elevation: FastNoiseLite,
    macro_detail: FastNoiseLite,
    macro_moisture: FastNoiseLite,
    macro_warp: FastNoiseLite,
    local_elevation: FastNoiseLite,
    local_moisture: FastNoiseLite,
}

impl NoiseFields {
    pub fn new(world_seed: u64) -> Self {
        let mut macro_elevation =
            FastNoiseLite::with_seed(derive_i32(world_seed, MACRO_ELEVATION_TAG));
        macro_elevation.set_noise_type(Some(NoiseType::OpenSimplex2));
        macro_elevation.set_frequency(Some(0.065));
        macro_elevation.set_fractal_type(Some(FractalType::FBm));
        macro_elevation.set_fractal_octaves(Some(4));
        macro_elevation.set_fractal_lacunarity(Some(2.0));
        macro_elevation.set_fractal_gain(Some(0.5));

        let mut macro_detail = FastNoiseLite::with_seed(derive_i32(world_seed, MACRO_DETAIL_TAG));
        macro_detail.set_noise_type(Some(NoiseType::OpenSimplex2S));
        macro_detail.set_frequency(Some(0.22));
        macro_detail.set_fractal_type(Some(FractalType::FBm));
        macro_detail.set_fractal_octaves(Some(2));
        macro_detail.set_fractal_lacunarity(Some(2.0));
        macro_detail.set_fractal_gain(Some(0.5));

        let mut macro_moisture =
            FastNoiseLite::with_seed(derive_i32(world_seed, MACRO_MOISTURE_TAG));
        macro_moisture.set_noise_type(Some(NoiseType::OpenSimplex2));
        macro_moisture.set_frequency(Some(0.085));
        macro_moisture.set_fractal_type(Some(FractalType::FBm));
        macro_moisture.set_fractal_octaves(Some(3));
        macro_moisture.set_fractal_lacunarity(Some(2.0));
        macro_moisture.set_fractal_gain(Some(0.5));

        let mut macro_warp = FastNoiseLite::with_seed(derive_i32(world_seed, MACRO_WARP_TAG));
        macro_warp.set_domain_warp_type(Some(DomainWarpType::OpenSimplex2));
        macro_warp.set_frequency(Some(0.055));
        macro_warp.set_domain_warp_amp(Some(1.8));
        macro_warp.set_fractal_type(Some(FractalType::DomainWarpProgressive));
        macro_warp.set_fractal_octaves(Some(2));
        macro_warp.set_fractal_lacunarity(Some(2.0));
        macro_warp.set_fractal_gain(Some(0.5));

        let mut local_elevation =
            FastNoiseLite::with_seed(derive_i32(world_seed, LOCAL_ELEVATION_TAG));
        local_elevation.set_noise_type(Some(NoiseType::OpenSimplex2S));
        local_elevation.set_frequency(Some(0.028));
        local_elevation.set_fractal_type(Some(FractalType::FBm));
        local_elevation.set_fractal_octaves(Some(3));
        local_elevation.set_fractal_lacunarity(Some(2.0));
        local_elevation.set_fractal_gain(Some(0.5));

        let mut local_moisture =
            FastNoiseLite::with_seed(derive_i32(world_seed, LOCAL_MOISTURE_TAG));
        local_moisture.set_noise_type(Some(NoiseType::OpenSimplex2));
        local_moisture.set_frequency(Some(0.018));
        local_moisture.set_fractal_type(Some(FractalType::FBm));
        local_moisture.set_fractal_octaves(Some(2));
        local_moisture.set_fractal_lacunarity(Some(2.0));
        local_moisture.set_fractal_gain(Some(0.5));

        Self {
            macro_elevation,
            macro_detail,
            macro_moisture,
            macro_warp,
            local_elevation,
            local_moisture,
        }
    }

    /// Sample one macro-map pixel at the center of its logical cell.
    pub fn sample_macro(&self, macro_x: i64, macro_y: i64) -> (f32, f32) {
        let x = macro_x as f64 + 0.5;
        let y = macro_y as f64 + 0.5;
        let (warped_x, warped_y) = self.macro_warp.domain_warp_2d(x, y);

        let elevation = self.macro_elevation.get_noise_2d(warped_x, warped_y) * 0.88
            + self.macro_detail.get_noise_2d(x, y) * 0.12;
        let moisture = self.macro_moisture.get_noise_2d(x, y);
        (elevation, moisture)
    }

    /// Local playable-space variation. Inputs are absolute world tile coordinates.
    pub fn sample_local(&self, world_x: i64, world_y: i64) -> (f32, f32) {
        let x = world_x as f64;
        let y = world_y as f64;
        (
            self.local_elevation.get_noise_2d(x, y),
            self.local_moisture.get_noise_2d(x, y),
        )
    }
}
