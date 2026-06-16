import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type {
  PackageManager,
  ProjectProfile,
  ReactNativeFramework
} from "../types/TestArchitecture.js";

type PackageJson = {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const COMMON_CONFIG_FILES = [
  "app.json",
  "app.config.js",
  "app.config.ts",
  "babel.config.js",
  "metro.config.js",
  "jest.config.js",
  "jest.config.ts",
  "vitest.config.ts",
  "detox.config.js",
  "detox.config.ts",
  ".maestro/config.yaml",
  "tsconfig.json"
];

export class ProjectProfiler {
  async profile(repoPath: string): Promise<ProjectProfile> {
    const packageJson = await this.readPackageJson(repoPath);
    const scripts = packageJson.scripts ?? {};
    const dependencies = this.listDependencies(packageJson);
    const configFiles = await this.detectExistingPaths(repoPath, COMMON_CONFIG_FILES);
    const directories = await this.detectDirectories(repoPath);
    const appJson = await this.readJsonFile(join(repoPath, "app.json"));
    const androidAppId = await this.detectAndroidAppId(repoPath);
    const iosAppId = await this.detectIosAppId(repoPath);
    const appIds = {
      ios: this.asString(appJson?.expo?.ios?.bundleIdentifier) ?? iosAppId,
      android: this.asString(appJson?.expo?.android?.package) ?? androidAppId
    };
    const framework = this.detectFramework(dependencies, appJson);
    const testFrameworks = this.detectTestFrameworks(dependencies, configFiles);
    const e2eFrameworks = this.detectE2eFrameworks(dependencies, configFiles, directories.e2eDirectories);
    const apiTestTools = this.detectApiTestTools(dependencies);

    return {
      packageName: packageJson.name,
      packageManager: await this.detectPackageManager(repoPath),
      framework,
      languages: this.detectLanguages(configFiles, dependencies),
      appIds,
      scripts: this.selectScripts(scripts),
      testFrameworks,
      e2eFrameworks,
      apiTestTools,
      sourceRoots: directories.sourceRoots,
      testDirectories: directories.testDirectories,
      e2eDirectories: directories.e2eDirectories,
      configFiles,
      dependencies,
      recommendations: this.buildRecommendations({
        framework,
        appIds,
        testFrameworks,
        e2eFrameworks,
        apiTestTools,
        scripts: this.selectScripts(scripts)
      })
    };
  }

  private async readPackageJson(repoPath: string): Promise<PackageJson> {
    return (await this.readJsonFile(join(repoPath, "package.json"))) ?? {};
  }

  private async readJsonFile(filePath: string): Promise<any | undefined> {
    try {
      return JSON.parse(await readFile(filePath, "utf8"));
    } catch {
      return undefined;
    }
  }

  private listDependencies(packageJson: PackageJson): string[] {
    return [
      ...Object.keys(packageJson.dependencies ?? {}),
      ...Object.keys(packageJson.devDependencies ?? {})
    ].sort((a, b) => a.localeCompare(b));
  }

  private async detectPackageManager(repoPath: string): Promise<PackageManager> {
    if (await this.exists(join(repoPath, "pnpm-lock.yaml"))) return "pnpm";
    if (await this.exists(join(repoPath, "yarn.lock"))) return "yarn";
    if (await this.exists(join(repoPath, "bun.lockb"))) return "bun";
    if (await this.exists(join(repoPath, "package-lock.json"))) return "npm";
    return "unknown";
  }

  private detectFramework(dependencies: string[], appJson: any | undefined): ReactNativeFramework {
    if (dependencies.includes("expo") || appJson?.expo) return "expo";
    if (dependencies.includes("react-native")) return "react-native-cli";
    return "unknown";
  }

  private detectLanguages(configFiles: string[], dependencies: string[]): string[] {
    const languages = new Set<string>();

    if (configFiles.includes("tsconfig.json") || dependencies.includes("typescript")) {
      languages.add("typescript");
    }
    languages.add("javascript");

    return [...languages];
  }

  private detectTestFrameworks(dependencies: string[], configFiles: string[]): string[] {
    const tools = new Set<string>();

    if (dependencies.includes("jest") || configFiles.some((file) => file.startsWith("jest.config"))) tools.add("jest");
    if (dependencies.includes("vitest") || configFiles.some((file) => file.startsWith("vitest.config"))) tools.add("vitest");
    if (dependencies.includes("@testing-library/react-native")) tools.add("react-native-testing-library");
    if (dependencies.includes("react-test-renderer")) tools.add("react-test-renderer");

    return [...tools].sort();
  }

  private detectE2eFrameworks(
    dependencies: string[],
    configFiles: string[],
    e2eDirectories: string[]
  ): string[] {
    const tools = new Set<string>();

    if (dependencies.includes("detox") || configFiles.some((file) => file.startsWith("detox.config"))) tools.add("detox");
    if (e2eDirectories.some((directory) => directory.includes("maestro") || directory === ".maestro")) tools.add("maestro");
    if (dependencies.includes("appium") || dependencies.includes("webdriverio")) tools.add("appium");
    if (dependencies.includes("@playwright/test")) tools.add("playwright");

    return [...tools].sort();
  }

  private detectApiTestTools(dependencies: string[]): string[] {
    return ["supertest", "msw", "nock", "axios-mock-adapter"]
      .filter((tool) => dependencies.includes(tool))
      .sort();
  }

  private selectScripts(scripts: Record<string, string>): ProjectProfile["scripts"] {
    return {
      test: this.findScript(scripts, ["test"]),
      lint: this.findScript(scripts, ["lint"]),
      typecheck: this.findScript(scripts, ["typecheck", "tsc"]),
      e2e: this.findScript(scripts, ["e2e", "detox", "maestro"]),
      ios: this.findScript(scripts, ["ios"]),
      android: this.findScript(scripts, ["android"]),
      start: this.findScript(scripts, ["start"])
    };
  }

  private findScript(scripts: Record<string, string>, needles: string[]): string | undefined {
    const match = Object.entries(scripts).find(([name, command]) =>
      needles.some((needle) => name.toLowerCase().includes(needle) || command.toLowerCase().includes(needle))
    );

    return match ? `${match[0]}: ${match[1]}` : undefined;
  }

  private async detectDirectories(repoPath: string): Promise<{
    sourceRoots: string[];
    testDirectories: string[];
    e2eDirectories: string[];
  }> {
    const candidates = await this.detectExistingPaths(repoPath, [
      "app",
      "src",
      "screens",
      "components",
      "__tests__",
      "tests",
      "test",
      "src/__tests__",
      "e2e",
      "maestro",
      ".maestro"
    ]);

    return {
      sourceRoots: candidates.filter((path) => ["app", "src", "screens", "components"].includes(path)),
      testDirectories: candidates.filter((path) => path.includes("test") || path === "__tests__"),
      e2eDirectories: candidates.filter((path) => ["e2e", "maestro", ".maestro"].includes(path))
    };
  }

  private async detectExistingPaths(repoPath: string, paths: string[]): Promise<string[]> {
    const existing: string[] = [];

    for (const path of paths) {
      if (await this.exists(join(repoPath, path))) {
        existing.push(path);
      }
    }

    return existing;
  }

  private async detectAndroidAppId(repoPath: string): Promise<string | undefined> {
    const candidates = ["android/app/build.gradle", "android/app/build.gradle.kts"];

    for (const candidate of candidates) {
      try {
        const content = await readFile(join(repoPath, candidate), "utf8");
        const match = content.match(/\bapplicationId\s*[= ]\s*["']([^"']+)["']/);
        if (match?.[1]) return match[1];
      } catch {
        continue;
      }
    }

    return undefined;
  }

  private async detectIosAppId(repoPath: string): Promise<string | undefined> {
    try {
      const projectFiles = await this.walk(join(repoPath, "ios"), (path) => path.endsWith("project.pbxproj"), 20);

      for (const file of projectFiles) {
        const content = await readFile(file, "utf8");
        const match = content.match(/PRODUCT_BUNDLE_IDENTIFIER\s*=\s*([^;\s]+)\s*;/);
        if (match?.[1]) return match[1].replace(/"/g, "");
      }
    } catch {
      return undefined;
    }

    return undefined;
  }

  private buildRecommendations(input: {
    framework: ReactNativeFramework;
    appIds: ProjectProfile["appIds"];
    testFrameworks: string[];
    e2eFrameworks: string[];
    apiTestTools: string[];
    scripts: ProjectProfile["scripts"];
  }): string[] {
    const recommendations: string[] = [];

    if (input.framework === "unknown") {
      recommendations.push("Confirm whether the target uses Expo or React Native CLI before generating runnable E2E setup.");
    }
    if (!input.appIds.ios && !input.appIds.android) {
      recommendations.push("Add appId configuration so generated Maestro flows can run without manual replacement.");
    }
    if (!input.e2eFrameworks.length) {
      recommendations.push("Choose an E2E runner, with Maestro as the default lightweight option for this agent.");
    }
    if (!input.testFrameworks.length) {
      recommendations.push("Add or identify the unit/component test runner before generating React Native Testing Library tests.");
    }
    if (!input.apiTestTools.length) {
      recommendations.push("Add API mocking or contract-test tooling if generated API tests should run in-process.");
    }
    if (!input.scripts.test) {
      recommendations.push("Add a package script for the main test command so the agent can run verification automatically.");
    }

    return recommendations;
  }

  private async walk(directory: string, predicate: (path: string) => boolean, maxFiles: number): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    const matches: string[] = [];

    for (const entry of entries) {
      const fullPath = join(directory, entry.name);

      if (entry.isDirectory()) {
        matches.push(...(await this.walk(fullPath, predicate, maxFiles - matches.length)));
      } else if (entry.isFile() && predicate(fullPath)) {
        matches.push(fullPath);
      }

      if (matches.length >= maxFiles) break;
    }

    return matches;
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  }

  private asString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value : undefined;
  }
}
