import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import type { RepoScanDetections, RepoScanResult, SourceFileSummary } from "../types/TestArchitecture.js";

const ALLOWED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".json"]);
const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  "ios",
  ".git",
  ".expo",
  ".next",
  "dist",
  "build",
  "coverage",
  "output"
]);
const IGNORED_FILES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml"
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
      detections: this.aggregateDetections(summaries),
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

      if (entry.isFile() && ALLOWED_EXTENSIONS.has(extname(entry.name)) && !IGNORED_FILES.has(entry.name)) {
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
    const componentNames = this.detectComponentNames(content);
    const routeNames = this.detectRouteNames(content, repoPath, filePath);
    const screenNames = this.detectScreenNames(content, filePath, componentNames);
    const apiEndpoints = this.detectApiEndpoints(content);
    const testIds = this.detectPropStringValues(content, "testID", "testId");
    const accessibilityLabels = this.detectPropStringValues(content, "accessibilityLabel");
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
      componentNames,
      screenNames,
      routeNames,
      apiEndpoints,
      testIds,
      accessibilityLabels,
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

  private detectComponentNames(content: string): string[] {
    const names = [
      ...this.matchGroup(content, /\b(?:export\s+default\s+)?function\s+([A-Z][A-Za-z0-9_]*)\s*\(/g),
      ...this.matchGroup(content, /\b(?:export\s+)?const\s+([A-Z][A-Za-z0-9_]*)\s*(?::\s*React\.FC[^=]*)?=\s*(?:\([^)]*\)|[^=]+?)\s*=>/g),
      ...this.matchGroup(content, /\b(?:export\s+)?const\s+([A-Z][A-Za-z0-9_]*)\s*=\s*(?:memo|forwardRef)\s*\(/g),
      ...this.matchGroup(content, /\b(?:export\s+default\s+)?class\s+([A-Z][A-Za-z0-9_]*)\s+extends\s+(?:React\.)?(?:Pure)?Component\b/g)
    ];

    return this.unique(names);
  }

  private detectScreenNames(content: string, filePath: string, componentNames: string[]): string[] {
    const navigatorComponents = this.matchGroup(
      content,
      /<[A-Za-z0-9_.]*Screen\b[^>]*\bcomponent=\{([A-Z][A-Za-z0-9_]*)\}/g
    );
    const fileBase = basename(filePath, extname(filePath));
    const fileScreen = /^[A-Z][A-Za-z0-9_]*(?:Screen|Page|View)$/.test(fileBase) ? [fileBase] : [];
    const namedScreens = componentNames.filter((name) => /(?:Screen|Page|View)$/.test(name));

    return this.unique([...navigatorComponents, ...fileScreen, ...namedScreens]);
  }

  private detectRouteNames(content: string, repoPath: string, filePath: string): string[] {
    const routes = [
      ...this.matchGroup(content, /<[A-Za-z0-9_.]*Screen\b[^>]*\bname=(?:"([^"]+)"|'([^']+)'|\{\s*["']([^"']+)["']\s*\})/g),
      ...this.matchGroup(content, /\b(?:navigate|replace|jumpTo)\s*\(\s*["']([^"']+)["']/g),
      ...this.matchGroup(content, /\b(?:navigation|router)\.(?:navigate|replace|push|jumpTo)\s*\(\s*["']([^"']+)["']/g)
    ];
    const expoRoute = this.detectExpoRouteName(repoPath, filePath);

    return this.unique(expoRoute ? [...routes, expoRoute] : routes);
  }

  private detectApiEndpoints(content: string): string[] {
    const callTargets = [
      ...this.matchGroup(content, /\bfetch\s*\(\s*(?:"([^"]+)"|'([^']+)'|`([^`]+)`)/g),
      ...this.matchGroup(
        content,
        /\b(?:axios(?:\.\w+)?|[A-Za-z0-9_$.]+\.(?:get|post|put|patch|delete))\s*\(\s*(?:"([^"]+)"|'([^']+)'|`([^`]+)`)/g
      )
    ];
    const literalEndpoints = this.matchGroup(
      content,
      /(?:"([^"]*(?:\/api\/|https?:\/\/)[^"]*)"|'([^']*(?:\/api\/|https?:\/\/)[^']*)'|`([^`]*(?:\/api\/|https?:\/\/)[^`]*)`)/g
    );

    return this.unique([...callTargets, ...literalEndpoints].filter((value) => this.looksLikeEndpoint(value)));
  }

  private detectPropStringValues(content: string, ...propNames: string[]): string[] {
    const values: string[] = [];

    for (const propName of propNames) {
      values.push(
        ...this.matchGroup(
          content,
          new RegExp(`\\b${propName}\\s*=\\s*(?:"([^"]+)"|'([^']+)'|\\{\\s*["']([^"']+)["']\\s*\\})`, "g")
        ),
        ...this.matchGroup(content, new RegExp(`\\b${propName}\\s*:\\s*["']([^"']+)["']`, "g"))
      );
    }

    return this.unique(values);
  }

  private aggregateDetections(files: SourceFileSummary[]): RepoScanDetections {
    return {
      components: this.aggregateValues(files, (file) => file.componentNames),
      screens: this.aggregateValues(files, (file) => file.screenNames),
      routeNames: this.aggregateValues(files, (file) => file.routeNames),
      apiEndpoints: this.aggregateValues(files, (file) => file.apiEndpoints),
      testIds: this.aggregateValues(files, (file) => file.testIds),
      accessibilityLabels: this.aggregateValues(files, (file) => file.accessibilityLabels)
    };
  }

  private aggregateValues(
    files: SourceFileSummary[],
    selectValues: (file: SourceFileSummary) => string[]
  ): { value: string; files: string[] }[] {
    const valuesByFile = new Map<string, Set<string>>();

    for (const file of files) {
      for (const value of selectValues(file)) {
        const filesForValue = valuesByFile.get(value) ?? new Set<string>();
        filesForValue.add(file.path);
        valuesByFile.set(value, filesForValue);
      }
    }

    return [...valuesByFile.entries()]
      .map(([value, detectedFiles]) => ({
        value,
        files: [...detectedFiles].sort()
      }))
      .sort((a, b) => a.value.localeCompare(b.value));
  }

  private detectExpoRouteName(repoPath: string, filePath: string): string | undefined {
    const relativePath = relative(repoPath, filePath).replace(/\\/g, "/");
    const appIndex = relativePath.split("/").lastIndexOf("app");

    if (appIndex === -1) return undefined;

    const routePath = relativePath
      .split("/")
      .slice(appIndex + 1)
      .join("/")
      .replace(/\.[jt]sx?$/, "");

    if (!routePath || routePath === "_layout" || routePath.endsWith("/_layout")) return undefined;

    return `/${routePath.replace(/\/index$/, "").replace(/\([^)]*\)\//g, "")}`;
  }

  private looksLikeEndpoint(value: string): boolean {
    return (
      /^https?:\/\//.test(value) ||
      value.startsWith("/api/") ||
      value.startsWith("api/") ||
      /^\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%{}-]+$/.test(value)
    );
  }

  private matchGroup(content: string, pattern: RegExp): string[] {
    return [...content.matchAll(pattern)]
      .map((match) => match.slice(1).find((value) => value !== undefined))
      .filter((value): value is string => Boolean(value))
      .map((value) => value.trim().replace(/\\(["'`])/g, "$1").replace(/\\$/, ""))
      .filter(Boolean);
  }

  private unique(values: string[]): string[] {
    return [...new Set(values)].sort((a, b) => a.localeCompare(b));
  }

  private count(content: string, pattern: RegExp): number {
    return [...content.matchAll(pattern)].length;
  }
}
