import type {
  ApiTestSuggestion,
  MaestroFlow,
  RepoScanResult,
  RiskArea,
  SelectorGap,
  TestPlan
} from "../types/TestArchitecture.js";

export class TestArchitectAgent {
  createPlan(feature: string, repoScan: RepoScanResult): TestPlan {
    const risks = this.identifyRisks(feature, repoScan);
    const selectorGaps = this.findSelectorGaps(repoScan);
    const maestroFlow = this.createMaestroFlow(feature);
    const apiTest = this.createApiTestSuggestion(feature);

    return {
      feature,
      generatedAt: new Date().toISOString(),
      summary: `Deterministic MVP analysis for "${feature}" found ${repoScan.totals.filesScanned} relevant source files and prioritized user journey, API contract, selector, and regression risks.`,
      risks,
      selectorGaps,
      maestroFlows: [maestroFlow],
      apiTestSuggestions: [apiTest],
      recommendedNextSteps: [
        "Review high-risk flows with product and QA before automating.",
        "Add stable testID values to primary interaction targets used by Maestro.",
        "Add accessibilityLabel values to interactive controls that are read by screen readers.",
        "Promote generated API test suggestions into the app repo once endpoint paths are confirmed.",
        "Wire a real LLM provider behind TestArchitectAgent after evals are stable."
      ],
      repoScan
    };
  }

  createMaestroFlow(feature: string): MaestroFlow {
    const slug = this.slugify(feature);
    const title = this.titleCase(feature);

    return {
      name: `${title} happy path`,
      fileName: `${slug}-flow.yaml`,
      yaml: `appId: com.dishlist.app
---
- launchApp
- assertVisible: "DishList"
- tapOn:
    id: "create-dish-button"
- assertVisible: "Create Dish"
- tapOn:
    id: "dish-name-input"
- inputText: "Lemon Herb Pasta"
- tapOn:
    id: "dish-description-input"
- inputText: "Bright weeknight pasta with herbs"
- tapOn:
    id: "save-dish-button"
- assertVisible: "Lemon Herb Pasta"
- tapOn:
    id: "dish-card-lemon-herb-pasta"
- assertVisible: "Bright weeknight pasta with herbs"
`
    };
  }

  createApiTestSuggestion(feature: string): ApiTestSuggestion {
    const title = this.titleCase(feature);

    return {
      name: `${title} API contract suggestion`,
      fileName: "generated-api-test.ts",
      notes: [
        "Uses Supertest-style assertions for create/list behavior.",
        "Assumes an Express-compatible app export and JSON API routes."
      ],
      code: `import request from "supertest";
import { app } from "../src/server";

describe("${title} API", () => {
  it("creates a dish and returns it in the list response", async () => {
    const createResponse = await request(app)
      .post("/api/dishes")
      .send({
        name: "Lemon Herb Pasta",
        description: "Bright weeknight pasta with herbs",
        visibility: "private"
      })
      .expect(201);

    expect(createResponse.body).toMatchObject({
      id: expect.any(String),
      name: "Lemon Herb Pasta",
      visibility: "private"
    });

    const listResponse = await request(app)
      .get("/api/dishes")
      .expect(200);

    expect(listResponse.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: createResponse.body.id })
      ])
    );
  });

  it("rejects invalid dish payloads with validation details", async () => {
    const response = await request(app)
      .post("/api/dishes")
      .send({ name: "" })
      .expect(400);

    expect(response.body.error).toContain("name");
  });
});
`
    };
  }

  private identifyRisks(feature: string, repoScan: RepoScanResult): RiskArea[] {
    const navigationFiles = repoScan.files.filter((file) => file.signals.includes("navigation"));
    const apiFiles = repoScan.files.filter((file) => file.signals.includes("api-client"));
    const listFiles = repoScan.files.filter((file) => file.signals.includes("list-ui"));

    return [
      {
        id: "journey-happy-path",
        title: `${this.titleCase(feature)} happy path`,
        level: "high",
        why: "The primary workflow must be stable before lower-value edge cases are automated.",
        evidence: [
          `${listFiles.length} list-oriented files suggest the feature depends on rendered collection state.`,
          `${navigationFiles.length} navigation files suggest screen transitions are part of the journey.`
        ],
        recommendedCoverage: [
          "Maestro flow for launch, create, save, and verify persisted UI state.",
          "A negative-path E2E check for empty required fields.",
          "Smoke coverage on a fresh install with no pre-existing local data."
        ]
      },
      {
        id: "api-contract",
        title: "API contract and validation",
        level: apiFiles.length > 0 ? "high" : "medium",
        why: "Mobile UI failures often come from backend payload shape drift or validation mismatches.",
        evidence: [
          `${apiFiles.length} API-like files found.`,
          "Generated tests assume create/list endpoints until a real repo reader extracts route metadata."
        ],
        recommendedCoverage: [
          "Supertest create/list contract tests.",
          "Validation tests for required fields and malformed payloads.",
          "Error shape assertions that match UI error rendering."
        ]
      },
      {
        id: "selector-accessibility",
        title: "Selector and accessibility readiness",
        level: repoScan.totals.testIds < 5 || repoScan.totals.accessibilityLabels < 5 ? "high" : "medium",
        why: "Stable automation and accessible UI both depend on intentional identifiers and labels.",
        evidence: [
          `${repoScan.totals.testIds} testID selectors found.`,
          `${repoScan.totals.accessibilityLabels} accessibility labels found.`
        ],
        recommendedCoverage: [
          "Add testID to create, save, input, list, and card elements.",
          "Add accessibilityLabel to touch targets that do not have clear visible text.",
          "Prefer semantic visible text assertions where it is stable."
        ]
      }
    ];
  }

  private findSelectorGaps(repoScan: RepoScanResult): SelectorGap[] {
    return repoScan.files
      .filter(
        (file) =>
          file.signals.includes("interactive-ui") &&
          (file.testIdCount < file.interactiveElementCount || file.accessibilityLabelCount < file.interactiveElementCount)
      )
      .slice(0, 8)
      .map((file) => ({
        file: file.path,
        issue: `Interactive UI detected with ${file.interactiveElementCount} controls, ${file.testIdCount} testID values, and ${file.accessibilityLabelCount} accessibilityLabel values.`,
        recommendation: "Add stable testID values for automation and accessibilityLabel values for non-text controls."
      }));
  }

  private titleCase(value: string): string {
    return value
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }

  private slugify(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
  }
}
