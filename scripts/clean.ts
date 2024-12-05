import { rmSync } from "fs";

const paths: string[] = ["node_modules", "yarn.lock", "cache", "artifacts"];

paths.forEach((path: string): void => {
  try {
    console.log(`Removing ${path}...`);
    rmSync(path, { recursive: true, force: true });
    console.log(`Successfully removed ${path}`);
  } catch (error) {
    if (error instanceof Error) {
      console.log(`Failed to remove ${path}: ${error.message}`);
    } else {
      console.log(`Failed to remove ${path}: Unknown error`);
    }
  }
});
