use crate::hash::hash_edge;
use crate::noise::NoiseFields;
use crate::terrain::Terrain;

pub const MACRO_CELL_TILES: i64 = 64;
const EDGE_TAG: u64 = 0x4544_4745_434F_4E54; // EDGECONT

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MacroCell {
    pub x: i64,
    pub y: i64,
    pub elevation: f32,
    pub moisture: f32,
    pub biome: Terrain,
}

impl MacroCell {
    fn generate(fields: &NoiseFields, x: i64, y: i64) -> Self {
        let (elevation, moisture) = fields.sample_macro(x, y);
        Self {
            x,
            y,
            elevation,
            moisture,
            biome: Terrain::classify(elevation, moisture),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EdgeDirection {
    North,
    East,
    South,
    West,
}

impl EdgeDirection {
    pub fn from_u8(value: u8) -> Option<Self> {
        match value {
            0 => Some(Self::North),
            1 => Some(Self::East),
            2 => Some(Self::South),
            3 => Some(Self::West),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EdgeContract {
    /// Stable shared signature for a pair of adjacent macro cells.
    /// Future rivers/roads can derive their shared boundary exits from this value.
    pub signature: u64,
}

pub fn edge_contract(
    world_seed: u64,
    macro_x: i64,
    macro_y: i64,
    direction: EdgeDirection,
) -> EdgeContract {
    let (neighbor_x, neighbor_y) = match direction {
        EdgeDirection::North => (macro_x, macro_y - 1),
        EdgeDirection::East => (macro_x + 1, macro_y),
        EdgeDirection::South => (macro_x, macro_y + 1),
        EdgeDirection::West => (macro_x - 1, macro_y),
    };

    EdgeContract {
        signature: hash_edge(
            world_seed,
            EDGE_TAG,
            macro_x,
            macro_y,
            neighbor_x,
            neighbor_y,
        ),
    }
}

pub struct MacroNeighborhood {
    center_x: i64,
    center_y: i64,
    cells: [MacroCell; 9],
}

impl MacroNeighborhood {
    pub fn new(center_x: i64, center_y: i64, fields: &NoiseFields) -> Self {
        let mut cells = [MacroCell::generate(fields, center_x, center_y); 9];
        let mut index = 0usize;
        for dy in -1..=1 {
            for dx in -1..=1 {
                cells[index] = MacroCell::generate(fields, center_x + dx, center_y + dy);
                index += 1;
            }
        }

        Self {
            center_x,
            center_y,
            cells,
        }
    }

    /// Blend the macro 3×3 neighborhood at an absolute playable tile position.
    /// Macro descriptors live at cell centers; a smoothstep interpolation between
    /// neighboring centers guarantees both adjacent chunks evaluate the same field.
    pub fn sample_tile(&self, world_tile_x: i64, world_tile_y: i64) -> (f32, f32) {
        let macro_x = (world_tile_x as f64 + 0.5) / MACRO_CELL_TILES as f64;
        let macro_y = (world_tile_y as f64 + 0.5) / MACRO_CELL_TILES as f64;
        self.sample_macro_position(macro_x, macro_y)
    }

    fn sample_macro_position(&self, macro_x: f64, macro_y: f64) -> (f32, f32) {
        let left_x = (macro_x - 0.5).floor() as i64;
        let top_y = (macro_y - 0.5).floor() as i64;
        let tx = smoothstep((macro_x - (left_x as f64 + 0.5)) as f32);
        let ty = smoothstep((macro_y - (top_y as f64 + 0.5)) as f32);

        let nw = self.cell_absolute(left_x, top_y);
        let ne = self.cell_absolute(left_x + 1, top_y);
        let sw = self.cell_absolute(left_x, top_y + 1);
        let se = self.cell_absolute(left_x + 1, top_y + 1);

        let elevation_top = lerp(nw.elevation, ne.elevation, tx);
        let elevation_bottom = lerp(sw.elevation, se.elevation, tx);
        let moisture_top = lerp(nw.moisture, ne.moisture, tx);
        let moisture_bottom = lerp(sw.moisture, se.moisture, tx);

        (
            lerp(elevation_top, elevation_bottom, ty),
            lerp(moisture_top, moisture_bottom, ty),
        )
    }

    fn cell_absolute(&self, x: i64, y: i64) -> MacroCell {
        let dx = x - self.center_x;
        let dy = y - self.center_y;
        assert!(
            (-1..=1).contains(&dx) && (-1..=1).contains(&dy),
            "sample escaped the 3x3 macro neighborhood"
        );
        let index = ((dy + 1) * 3 + (dx + 1)) as usize;
        self.cells[index]
    }
}

fn smoothstep(value: f32) -> f32 {
    let t = value.clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn neighborhood_center_matches_macro_sample() {
        let fields = NoiseFields::new(42);
        let neighborhood = MacroNeighborhood::new(-3, 9, &fields);
        let expected = fields.sample_macro(-3, 9);
        assert_eq!(neighborhood.sample_macro_position(-2.5, 9.5), expected);
    }

    #[test]
    fn adjacent_neighborhoods_agree_on_shared_boundary_field() {
        let fields = NoiseFields::new(1234);
        let left = MacroNeighborhood::new(0, 0, &fields);
        let right = MacroNeighborhood::new(1, 0, &fields);

        for step in 0..=16 {
            let y = step as f64 / 16.0;
            assert_eq!(
                left.sample_macro_position(1.0, y),
                right.sample_macro_position(1.0, y)
            );
        }
    }

    #[test]
    fn edge_contract_is_shared_by_both_sides() {
        assert_eq!(
            edge_contract(99, -1, 2, EdgeDirection::East),
            edge_contract(99, 0, 2, EdgeDirection::West)
        );
    }
}
