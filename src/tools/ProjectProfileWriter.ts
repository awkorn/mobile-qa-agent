import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ProjectProfile } from "../types/TestArchitecture.js";

export class ProjectProfileWriter {
  async write(outputDir: string, profile: ProjectProfile): Promise<{ markdownPath: string; jsonPath: string }> {
    const markdownPath = join(outputDir, "project-profile.md");
    const jsonPath = join(outputDir, "project-profile.json");

    await mkdir(dirname(markdownPath), { recursive: true });
    await writeFile(markdownPath, this.toMarkdown(profile), "utf8");
    await writeFile(jsonPath, `${JSON.stringify(profile, null, 2)}\n`, "utf8");

    return { markdownPath, jsonPath };
  }

  toMarkdown(profile: ProjectProfile): string {
    const scripts = Object.entries(profile.scripts)
      .filter((entry): entry is [string, string] => Boolean(entry[1]))
      .map(([name, command]) => `- ${name}: \`${command}\``)
      .join("\n");

    return `# Project Profile: ${profile.packageName ?? "unknown"}

## Runtime

- Package manager: ${profile.packageManager}
- Framework: ${profile.framework}
- Languages: ${this.joinOrNone(profile.languages)}
- iOS appId: ${profile.appIds.ios ?? "not detected"}
- Android appId: ${profile.appIds.android ?? "not detected"}

## Testing

- Test frameworks: ${this.joinOrNone(profile.testFrameworks)}
- E2E frameworks: ${this.joinOrNone(profile.e2eFrameworks)}
- API test tools: ${this.joinOrNone(profile.apiTestTools)}

## Layout

- Source roots: ${this.joinOrNone(profile.sourceRoots)}
- Test directories: ${this.joinOrNone(profile.testDirectories)}
- E2E directories: ${this.joinOrNone(profile.e2eDirectories)}
- Config files: ${this.joinOrNone(profile.configFiles)}

## Scripts

${scripts || "- None detected."}

## Recommendations

${profile.recommendations.map((recommendation) => `- ${recommendation}`).join("\n") || "- No setup gaps detected."}
`;
  }

  private joinOrNone(values: string[]): string {
    return values.length ? values.join(", ") : "none detected";
  }
}
