import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { MaestroFlow } from "../types/TestArchitecture.js";

export class MaestroFlowWriter {
  async write(outputDir: string, flow: MaestroFlow): Promise<string> {
    const outputPath = join(outputDir, flow.fileName);

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, flow.yaml, "utf8");

    return outputPath;
  }
}
