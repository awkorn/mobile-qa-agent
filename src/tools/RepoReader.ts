import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import type { RepoScanResult, SourceFileSummary } from "../types/TestArchitecture.js";

const ALLOWED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".json"]);
const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  "ios",
  ".git",
  "dist",
  "build",
  "coverage"
]);

export interface RepoReaderOptions {
  maxFiles?: number;
  maxFileBytes?: number;
}

export class RepoReader {
  constructor(private readonly options: RepoReaderOptions = {}) {}

  async scan(repoPath: string): Promise<RepoScanResult> {
    const files = await this.walk(repoPath);
    const summaries: SourceFileSummary[] = [];
    const maxFiles = this.options.maxFiles ?? 80;

    for (const file of files.slice(0, maxFiles)) {
      summaries.push(await this.summarizeFile(repoPath, file));
    }

    return {
      repoPath,
      scannedAt: new Date().toISOString(),
      files: summaries,
      totals: {
        filesScanned: summaries.length,
        testIds: summaries.reduce((sum, file) => sum + file.testIdCount, 0),
        accessibilityLabels: summaries.reduce(
          (sum, file) => sum + file.accessibilityLabelCount,
          0
        ),
        components: summaries.filter((file) => file.extension === ".tsx" || file.extension === ".jsx").length,
        apiLikeFiles: summaries.filter((file) => file.signals.includes("api-client")).length
      }
    };
  }

  private async walk(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
      const fullPath = join(directory, entry.name);

      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name) || fullPath.includes("android/build")) {
          continue;
        }
        files.push(...(await this.walk(fullPath)));
        continue;
      }

      if (entry.isFile() && ALLOWED_EXTENSIONS.has(extname(entry.name))) {
        files.push(fullPath);
      }
    }

    return files.sort();
  }

  private async summarizeFile(repoPath: string, filePath: string): Promise<SourceFileSummary> {
    const fileStats = await stat(filePath);
    const maxFileBytes = this.options.maxFileBytes ?? 60_000;
    const raw = await readFile(filePath, "utf8");
    const content = fileStats.size > maxFileBytes ? raw.slice(0, maxFileBytes) : raw;
    const imports = [...content.matchAll(/import\s+.*?\s+from\s+["'](.+?)["']/g)].map((match) => match[1]);
    const exports = [...content.matchAll(/export\s+(?:default\s+)?(?:function|const|class|interface|type)\s+(\w+)/g)].map(
      (match) => match[1]
    );
    const testIdCount = this.count(content, /testID\s*=/g) + this.count(content, /testId\s*:/g);
    const accessibilityLabelCount =
      this.count(content, /accessibilityLabel\s*=/g) + this.count(content, /accessibilityLabel\s*:/g);
    const interactiveElementCount =
      this.count(content, /<Pressable\b/g) +
      this.count(content, /<TouchableOpacity\b/g) +
      this.count(content, /<Button\b/g) +
      this.count(content, /<TextInput\b/g);

    return {
      path: relative(repoPath, filePath),
      extension: extname(filePath),
      imports,
      exports,
      interactiveElementCount,
      testIdCount,
      accessibilityLabelCount,
      lineCount: content.split(/\r?\n/).length,
      signals: this.detectSignals(content, filePath)
    };
  }

  private detectSignals(content: string, filePath: string): string[] {
    const signals = new Set<string>();

    if (/fetch\(|axios|graphql|ApolloClient|createApi/.test(content)) signals.add("api-client");
    if (/navigation|useNavigation|createNativeStackNavigator/.test(content)) signals.add("navigation");
    if (/FlatList|SectionList|ScrollView/.test(content)) signals.add("list-ui");
    if (/Pressable|TouchableOpacity|Button/.test(content)) signals.add("interactive-ui");
    if (/AsyncStorage|MMKV|SecureStore/.test(content)) signals.add("local-storage");
    if (/describe\(|it\(|test\(/.test(content) || filePath.includes(".test.")) signals.add("existing-tests");

    return [...signals];
  }

  private count(content: string, pattern: RegExp): number {
    return [...content.matchAll(pattern)].length;
  }
}
