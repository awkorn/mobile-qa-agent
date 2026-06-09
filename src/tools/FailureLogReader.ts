import { readFile } from "node:fs/promises";

export class FailureLogReader {
  async read(logPath: string): Promise<string> {
    return readFile(logPath, "utf8");
  }
}
