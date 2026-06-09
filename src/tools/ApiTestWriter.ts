import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ApiTestSuggestion } from "../types/TestArchitecture.js";

export class ApiTestWriter {
  async write(outputDir: string, test: ApiTestSuggestion): Promise<string> {
    const outputPath = join(outputDir, test.fileName);

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, test.code, "utf8");

    return outputPath;
  }
}
