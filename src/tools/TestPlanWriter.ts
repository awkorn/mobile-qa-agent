import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RepoValueDetection, TestPlan } from "../types/TestArchitecture.js";

export class TestPlanWriter {
  async write(outputDir: string, plan: TestPlan): Promise<{ markdownPath: string; jsonPath: string }> {
    const markdownPath = join(outputDir, "test-plan.md");
    const jsonPath = join(outputDir, "test-plan.json");

    await mkdir(dirname(markdownPath), { recursive: true });
    await writeFile(markdownPath, this.toMarkdown(plan), "utf8");
    await writeFile(jsonPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");

    return { markdownPath, jsonPath };
  }

  toMarkdown(plan: TestPlan): string {
    const risks = plan.risks
      .map(
        (risk) => `### ${risk.title} (${risk.level})

${risk.why}

Evidence:
${risk.evidence.map((item) => `- ${item}`).join("\n")}

Recommended coverage:
${risk.recommendedCoverage.map((item) => `- ${item}`).join("\n")}`
      )
      .join("\n\n");

    const gaps = plan.selectorGaps
      .map((gap) => `- **${gap.file}**: ${gap.issue} Recommendation: ${gap.recommendation}`)
      .join("\n");

    const apiTests = plan.apiTestSuggestions
      .map((test) => `- **${test.name}** (${test.fileName}): ${test.notes.join(" ")}`)
      .join("\n");
    const detectedFacts = this.detectedFactsToMarkdown(plan);

    return `# Risk-Based Test Plan: ${plan.feature}

Generated: ${plan.generatedAt}

## Summary

${plan.summary}

## Repo Scan

- Files scanned: ${plan.repoScan.totals.filesScanned}
- React Native component-like files: ${plan.repoScan.totals.components}
- API-like files: ${plan.repoScan.totals.apiLikeFiles}
- testID selectors found: ${plan.repoScan.totals.testIds}
- accessibilityLabel values found: ${plan.repoScan.totals.accessibilityLabels}

## Detected App Facts

${detectedFacts}

## Risk Areas

${risks}

## Missing Selector and Accessibility Gaps

${gaps || "- No high-confidence gaps found from the deterministic scan."}

## Maestro E2E Coverage

${plan.maestroFlows.map((flow) => `- ${flow.name}: \`${flow.fileName}\``).join("\n")}

## API Test Suggestions

${apiTests}

## Recommended Next Steps

${plan.recommendedNextSteps.map((step) => `- ${step}`).join("\n")}
`;
  }

  private detectedFactsToMarkdown(plan: TestPlan): string {
    const detections = plan.repoScan.detections;

    return [
      this.valuesToMarkdown("Screen/component names", [
        ...detections.screens,
        ...detections.components.filter(
          (component) => !detections.screens.some((screen) => screen.value === component.value)
        )
      ]),
      this.valuesToMarkdown("Route names", detections.routeNames),
      this.valuesToMarkdown("API endpoint strings", detections.apiEndpoints),
      this.valuesToMarkdown("Existing testID usage", detections.testIds),
      this.valuesToMarkdown("Existing accessibilityLabel usage", detections.accessibilityLabels)
    ].join("\n\n");
  }

  private valuesToMarkdown(title: string, values: RepoValueDetection[], limit = 12): string {
    const items = values.slice(0, limit);
    const remaining = values.length - items.length;
    const body = items.length
      ? items.map((item) => `- \`${item.value}\` (${item.files.slice(0, 3).join(", ")})`).join("\n")
      : "- None detected.";
    const suffix = remaining > 0 ? `\n- ...and ${remaining} more.` : "";

    return `### ${title}\n\n${body}${suffix}`;
  }
}
