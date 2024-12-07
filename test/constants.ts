const BASE_GAS_LIMITS = {
  DEPLOY: 3_000_000,
  HIGH: 300_000,
  MED: 200_000,
  LOW: 100_000,
} as const;

// Check for coverage mode using multiple methods
const IS_COVERAGE =
  process.env.COVERAGE === "true" ||
  process.env.COVERAGE === "1" ||
  process.argv.includes("coverage") ||
  process.argv.some(arg => arg.includes("hardhat-coverage"));

// Multiply gas limits by 3 when running coverage
export const GAS_LIMITS = IS_COVERAGE
  ? (Object.fromEntries(
      Object.entries(BASE_GAS_LIMITS).map(([key, value]) => [key, value * 3]),
    ) as typeof BASE_GAS_LIMITS)
  : BASE_GAS_LIMITS;

console.log("Coverage mode:", IS_COVERAGE);
console.log("Exported GAS_LIMITS:", GAS_LIMITS);
