use fastnoise_lite::{DomainWarpType, FastNoiseLite, FractalType, NoiseType};

use crate::hash::derive_i32;

const ELEVATION_TAG: u64 = 0x454C_4556_4154_494F; // "ELEVATIO"
const DETAIL_TAG: u64 = 0x4445_5441_494C_3031; // "DETAIL01"
const MOISTURE_TAG: u64 = 0x4D4F_4953_5455_5245; // "MOISTURE"
const WARP_TAG: u64 = 0x5741_5250_3030_3031; // "WARP0001"

pub struct NoiseFields {
    elevation: FastNoiseLite,
    detail: FastNoiseLite,
    moisture: FastNoiseLite,
    warp: FastNoiseLite,
}

impl NoiseFields {
    pub fn new(world_seed: u64) -> Self {
        let mut elevation = FastNoiseLite::with_seed(derive_i32(world_seed, ELEVATION_TAG));
        elevation.set_noise_type(Some(NoiseType::OpenSimplex2));
        elevation.set_frequency(Some(0.00135));
        elevation.set_fractal_type(Some(FractalType::FBm));
        elevation.set_fractal_octaves(Some(4));
        elevation.set_fractal_lacunarity(Some(2.0));
        elevation.set_fractal_gain(Some(0.5));

        let mut detail = FastNoiseLite::with_seed(derive_i32(world_seed, DETAIL_TAG));
        detail.set_noise_type(Some(NoiseType::OpenSimplex2S));
        detail.set_frequency(Some(0.011));
        detail.set_fractal_type(Some(FractalType::FBm));
        detail.set_fractal_octaves(Some(2));
        detail.set_fractal_lacunarity(Some(2.0));
        detail.set_fractal_gain(Some(0.5));

        let mut moisture = FastNoiseLite::with_seed(derive_i32(world_seed, MOISTURE_TAG));
        moisture.set_noise_type(Some(NoiseType::OpenSimplex2));
        moisture.set_frequency(Some(0.0045));
        moisture.set_fractal_type(Some(FractalType::FBm));
        moisture.set_fractal_octaves(Some(3));
        moisture.set_fractal_lacunarity(Some(2.0));
        moisture.set_fractal_gain(Some(0.5));

        let mut warp = FastNoiseLite::with_seed(derive_i32(world_seed, WARP_TAG));
        warp.set_domain_warp_type(Some(DomainWarpType::OpenSimplex2));
        warp.set_frequency(Some(0.0024));
        warp.set_domain_warp_amp(Some(38.0));
        warp.set_fractal_type(Some(FractalType::DomainWarpProgressive));
        warp.set_fractal_octaves(Some(2));
        warp.set_fractal_lacunarity(Some(2.0));
        warp.set_fractal_gain(Some(0.5));

        Self {
            elevation,
            detail,
            moisture,
            warp,
        }
    }

    /// Returns (elevation, moisture), each approximately in [-1, 1].
    pub fn sample(&self, world_x: i64, world_y: i64) -> (f32, f32) {
        let x = world_x as f64;
        let y = world_y as f64;
        let (warped_x, warped_y) = self.warp.domain_warp_2d(x, y);

        let macro_elevation = self.elevation.get_noise_2d(warped_x, warped_y);
        let detail = self.detail.get_noise_2d(x, y);
        let moisture = self.moisture.get_noise_2d(x, y);

        let elevation = macro_elevation * 0.82 + detail * 0.18;
        (elevation, moisture)
    }
}
