
/**
 * Land Coordinate Utilities
 * 
 * Implements the spiral coordinate system logic used by the smart contract
 * to deterministically map Token IDs to (x, y) coordinates.
 * 
 * Mental Model:
 * - Token ID 0: (0, 0) reserved/special deployer token
 * - Token ID 1: (0, 1)
 * - Token ID 2: (1, 1)
 * - Token ID 3: (1, 0)
 * - ... spiraling outwards in the same order as LibLand.sol
 */

export interface Coordinate {
  x: number;
  y: number;
}

// Maximum bounds from contract logic
export const MAX_COORDINATE = 112;
export const MIN_COORDINATE = -112;

/**
 * Calculates the (x, y) coordinate for a given Token ID based on a square spiral.
 * Matches the logic in LibLand.sol's landCalculateCoordinatesQuadrantSpiral.
 */
export function getCoordinateFromTokenId(tokenId: number): Coordinate {
  if (tokenId <= 0) return { x: 0, y: 0 };

  const k = Math.ceil((Math.sqrt(tokenId + 1) - 1) / 2);
  const sideLength = 2 * k;
  const ringStart = Math.pow(2 * k - 1, 2);
  const offset = tokenId - ringStart;

  if (offset < sideLength) {
    return { x: -(k - 1) + offset, y: k };
  }

  if (offset < sideLength * 2) {
    return { x: k, y: k - 1 - (offset - sideLength) };
  }

  if (offset < sideLength * 3) {
    return { x: k - 1 - (offset - sideLength * 2), y: -k };
  }

  return { x: -k, y: -k + 1 + (offset - sideLength * 3) };
}

/**
 * Inverse operation: Get Token ID from (x, y) coordinate.
 * Useful for finding which token is at a specific grid location.
 */
export function getTokenIdFromCoordinate(x: number, y: number): number {
  if (x === 0 && y === 0) return 0;

  // Determine the ring 'k'
  // k is the maximum absolute value of x or y
  const k = Math.max(Math.abs(x), Math.abs(y));
  const sideLength = 2 * k;
  const ringStart = Math.pow(2 * k - 1, 2);

  if (y === k && x > -k && x <= k) {
    return ringStart + (x + k - 1);
  }

  if (x === k && y >= -k && y < k) {
    return ringStart + sideLength + (k - 1 - y);
  }

  if (y === -k && x >= -k && x < k) {
    return ringStart + sideLength * 2 + (k - 1 - x);
  }

  return ringStart + sideLength * 3 + (y + k - 1);
}

/**
 * Get neighbor coordinates for a given position
 */
export function getNeighbors(x: number, y: number): Coordinate[] {
  return [
    { x: x, y: y + 1 },   // N
    { x: x + 1, y: y },   // E
    { x: x, y: y - 1 },   // S
    { x: x - 1, y: y },   // W
  ];
}

/**
 * Generate a noise-like value for terrain generation based on coordinates
 * Returns a value between 0 and 1
 */
export function getTerrainNoise(x: number, y: number): number {
  // Classic sin-based pseudo-random function for 2D noise (common in shaders)
  // Much more reliable distribution for small integers in JS than bitwise hacks
  const val = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return val - Math.floor(val);
}

// --- Visual Mapping System ---

/**
 * Converts a Contract Coordinate (Logic) to a Visual Coordinate (Display).
 * Uses a quadratic expansion model to create a "City Center" effect:
 * - Center (0,0) is dense.
 * - As you move outwards, spacing increases (Suburbs/Rural).
 * 
 * Formula: v = c + sign(c) * floor(c^2 / SPARSITY_FACTOR)
 */
const SPARSITY_FACTOR = 16; // Higher = denser center, lower = spreads faster

export function contractToVisual(c: number): number {
  // Quadratic expansion
  // c=0 -> v=0
  // c=4 -> v=4 + floor(16/16) = 5 (Gap starts)
  // c=8 -> v=8 + floor(64/16) = 12 (Gap of 4 total)
  
  const sign = Math.sign(c);
  const abs = Math.abs(c);
  const gap = Math.floor((abs * abs) / SPARSITY_FACTOR);
  
  return c + sign * gap;
}

/**
 * Converts a Visual Coordinate back to a Contract Coordinate.
 * Returns null if the coordinate falls in a gap (Water/Forest).
 */
export function visualToContract(v: number): number | null {
  // Since the function is monotonic increasing: v(c+1) >= v(c)
  // And coordinates are bounded (-150 to 150 covers visual range easily)
  // We can just scan or binary search. Given the range is small,
  // a smart local search from an estimate is efficient.
  
  // Estimate: c approx v (for small v) or sqrt(v) kind of relationship
  // Let's just iterate because the max coordinate is small (112).
  // Visual max will be approx 112 + 112^2/16 = 112 + 784 = ~900.
  
  // Simple brute force inverse check is robust enough for <1000 range
  // Optimization: Use direction of v to limit search
  
  const sign = Math.sign(v);
  const absV = Math.abs(v);
  
  // We know |v| >= |c| + floor(c^2/K) >= |c|
  // So |c| <= |v|
  // Also v is monotonic with c
  
  // Scan from 0 up to absV
  for (let c = 0; c <= absV; c++) {
     const testC = c * sign;
     const testV = contractToVisual(testC);
     
     if (testV === v) return testC;
     if (Math.abs(testV) > absV) return null; // Overshot, so v is in a gap
  }
  
  return null;
}

/**
 * Get the terrain type for a Visual Coordinate gap.
 * Returns 'none' if it's actually a valid land slot.
 */
export function getVisualTerrainType(vx: number, vy: number): 'water' | 'forest' | 'mountain' | 'none' {
  const cx = visualToContract(vx);
  const cy = visualToContract(vy);
  
  if (cx !== null && cy !== null) return 'none'; // It's a land slot
  
  // Use noise to determine terrain type
  const noise = getTerrainNoise(vx, vy);
  
  // Adjusted distribution to be less water-heavy
  if (noise < 0.25) return 'water'; // 25% Water
  if (noise < 0.65) return 'forest'; // 40% Forest
  return 'mountain'; // 35% Mountain
}
