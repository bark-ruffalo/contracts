import { Command } from "commander";
import chalk from "chalk";

const YEAR_IN_SECONDS = 365.2425 * 24 * 60 * 60;

function calculateRates(targetSIRs: number[], periods: number[]): number[] {
  return targetSIRs.map((sir, index) => {
    const period = periods[index];
    return Math.round((sir / 100) * (period / YEAR_IN_SECONDS) * 10000);
  });
}

function displayResults(targetSIRs: number[], calculatedRates: number[], periods: number[]) {
  console.log(chalk.cyan("\n📊 Staking Rate Calculations:"));
  console.log(chalk.yellow("Target SIRs:", targetSIRs.map(sir => `${sir}%`).join(", ")));
  console.log(chalk.yellow("Calculated Rates:", calculatedRates.join(", ")));

  console.log(chalk.cyan("\nDetailed Breakdown:"));
  periods.forEach((period, index) => {
    const daysInPeriod = period / (24 * 60 * 60);
    const rate = calculatedRates[index];
    const periodRate = rate / 10000;
    const periodsPerYear = YEAR_IN_SECONDS / period;
    const actualSIR = periodRate * periodsPerYear * 100;

    console.log(chalk.green(`\n${daysInPeriod} days lock:`));
    console.log(`  Target SIR: ${targetSIRs[index]}%`);
    console.log(`  Rate to use in contract: ${rate}`);
    console.log(`  Actual SIR: ${actualSIR.toFixed(2)}%`);
    console.log(`  Rate per period: ${(rate / 100).toFixed(2)}%`);
  });
}

const program = new Command();

program
  .name("calculate-staking-rates")
  .description("Calculate staking rates based on target Simple Interest Rates (SIR)")
  .argument("<sirs...>", "Target SIRs in percentage")
  .option("-p, --periods <days>", "Lock periods in days (comma-separated)")
  .action((sirs: string[], options) => {
    const targetSIRs = sirs.map(sir => parseFloat(sir));

    console.log("Raw periods option:", options.periods);
    const periods = options.periods
      ? options.periods.split(/[\s,]+/).map((days: string) => {
          console.log("Processing day:", days);
          return parseInt(days.trim()) * 24 * 60 * 60;
        })
      : [50, 100, 200, 400].map(days => days * 24 * 60 * 60);
    console.log("Processed periods:", periods);

    if (targetSIRs.some(sir => isNaN(sir) || sir < 0)) {
      console.error(chalk.red("Error: All SIR values must be valid positive numbers"));
      process.exit(1);
    }

    if (periods.some((period: number) => isNaN(period) || period <= 0)) {
      console.error(chalk.red("Error: All periods must be valid positive numbers"));
      process.exit(1);
    }

    if (targetSIRs.length !== periods.length) {
      console.error(
        chalk.red(`Error: Number of SIRs (${targetSIRs.length}) must match number of periods (${periods.length})`),
      );
      process.exit(1);
    }

    const calculatedRates = calculateRates(targetSIRs, periods);
    displayResults(targetSIRs, calculatedRates, periods);
  });

program.parse();
