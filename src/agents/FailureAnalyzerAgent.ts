import type { FailureAnalysis } from "../types/TestArchitecture.js";

export class FailureAnalyzerAgent {
  analyze(log: string): FailureAnalysis {
    const normalized = log.toLowerCase();
    const evidence = this.extractEvidence(log);

    if (normalized.includes("element not found") || normalized.includes("no views in hierarchy")) {
      return {
        generatedAt: new Date().toISOString(),
        likelyCause: "The E2E selector does not match the rendered UI, or the test is tapping before the screen finishes loading.",
        confidence: "high",
        evidence,
        recommendedFixes: [
          "Confirm the target component has a stable testID matching the Maestro flow.",
          "Add an assertVisible step before tapOn so the flow waits for the element.",
          "Check whether navigation or loading state changed after the feature update."
        ],
        regressionTests: [
          "Add a Maestro smoke flow that asserts the create button is visible after launch.",
          "Add a component test that renders the screen and verifies the expected testID exists."
        ]
      };
    }

    if (normalized.includes("timeout")) {
      return {
        generatedAt: new Date().toISOString(),
        likelyCause: "The test likely depends on asynchronous app state that is slower than the current timeout.",
        confidence: "medium",
        evidence,
        recommendedFixes: [
          "Wait on a user-visible state instead of a fixed delay.",
          "Mock or seed network state for deterministic test setup.",
          "Inspect API latency or local storage hydration in the failing screen."
        ],
        regressionTests: [
          "Add a flow that starts from a known fixture state.",
          "Add API contract tests for the data needed by the screen."
        ]
      };
    }

    return {
      generatedAt: new Date().toISOString(),
      likelyCause: "The deterministic analyzer did not find a specific signature. Treat this as an unknown failure that needs log enrichment.",
      confidence: "low",
      evidence,
      recommendedFixes: [
        "Capture screenshots, view hierarchy, device logs, and network state with the failing run.",
        "Compare the failing commit against the last passing run.",
        "Group failures by screen, selector, and API endpoint before assigning ownership."
      ],
      regressionTests: [
        "Add the failing scenario as a focused smoke test once the root cause is confirmed."
      ]
    };
  }

  toMarkdown(analysis: FailureAnalysis): string {
    return `# Failure Analysis

Generated: ${analysis.generatedAt}

## Likely Cause

${analysis.likelyCause}

Confidence: ${analysis.confidence}

## Evidence

${analysis.evidence.map((item) => `- ${item}`).join("\n")}

## Recommended Fix

${analysis.recommendedFixes.map((item) => `- ${item}`).join("\n")}

## Regression Coverage

${analysis.regressionTests.map((item) => `- ${item}`).join("\n")}
`;
  }

  private extractEvidence(log: string): string[] {
    const lines = log
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const interesting = lines.filter((line) =>
      /error|failed|element|timeout|assert|expected|actual|stack/i.test(line)
    );

    return (interesting.length > 0 ? interesting : lines).slice(0, 8);
  }
}
