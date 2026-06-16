import type {
  ApiTestSuggestion,
  MaestroFlow,
  RepoScanResult,
  RiskArea,
  SelectorGap,
  TestPlan
} from "../types/TestArchitecture.js";

export interface LlmPlannerConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
}

interface LlmTestPlanSpec {
  summary: string;
  risks: RiskArea[];
  selectorGaps: SelectorGap[];
  maestroFlows: MaestroFlow[];
  apiTestSuggestions: ApiTestSuggestion[];
  recommendedNextSteps: string[];
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
}

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_TIMEOUT_MS = 60_000;

const TEST_PLAN_SPEC_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "risks", "selectorGaps", "maestroFlows", "apiTestSuggestions", "recommendedNextSteps"],
  properties: {
    summary: { type: "string" },
    risks: {
      type: "array",
      minItems: 1,
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "level", "why", "evidence", "recommendedCoverage"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          level: { type: "string", enum: ["high", "medium", "low"] },
          why: { type: "string" },
          evidence: {
            type: "array",
            minItems: 1,
            maxItems: 6,
            items: { type: "string" }
          },
          recommendedCoverage: {
            type: "array",
            minItems: 1,
            maxItems: 6,
            items: { type: "string" }
          }
        }
      }
    },
    selectorGaps: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["file", "issue", "recommendation"],
        properties: {
          file: { type: "string" },
          issue: { type: "string" },
          recommendation: { type: "string" }
        }
      }
    },
    maestroFlows: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "fileName", "yaml"],
        properties: {
          name: { type: "string" },
          fileName: { type: "string" },
          yaml: { type: "string" }
        }
      }
    },
    apiTestSuggestions: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "fileName", "code", "notes"],
        properties: {
          name: { type: "string" },
          fileName: { type: "string" },
          code: { type: "string" },
          notes: {
            type: "array",
            minItems: 1,
            maxItems: 5,
            items: { type: "string" }
          }
        }
      }
    },
    recommendedNextSteps: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: { type: "string" }
    }
  }
} as const;

export class LlmPlannerAgent {
  constructor(private readonly config: LlmPlannerConfig) {}

  async createPlan(feature: string, repoScan: RepoScanResult): Promise<TestPlan> {
    const spec = await this.createSpec(feature, repoScan);

    return {
      feature,
      generatedAt: new Date().toISOString(),
      summary: spec.summary,
      risks: spec.risks,
      selectorGaps: spec.selectorGaps,
      maestroFlows: spec.maestroFlows,
      apiTestSuggestions: spec.apiTestSuggestions,
      recommendedNextSteps: spec.recommendedNextSteps,
      repoScan
    };
  }

  private async createSpec(feature: string, repoScan: RepoScanResult): Promise<LlmTestPlanSpec> {
    const baseUrl = this.config.baseUrl ?? DEFAULT_BASE_URL;
    const timeoutMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify({
          model: this.config.model,
          temperature: 0.2,
          messages: [
            {
              role: "system",
              content:
                "You are an AI mobile test architect. Return only valid JSON that conforms exactly to the provided schema. Do not include Markdown, comments, or extra keys."
            },
            {
              role: "user",
              content: JSON.stringify({
                task:
                  "Create a risk-based mobile QA plan spec for this React Native feature. Favor implementable E2E flows, API contract tests, accessibility checks, selector readiness, and regression coverage.",
                feature,
                repoContext: this.toRepoContext(repoScan)
              })
            }
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "mobile_test_plan_spec",
              strict: true,
              schema: TEST_PLAN_SPEC_JSON_SCHEMA
            }
          }
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`LLM planner request failed with ${response.status}: ${body}`);
      }

      return this.parseAndValidate(await response.json());
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`LLM planner request timed out after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private parseAndValidate(response: ChatCompletionResponse): LlmTestPlanSpec {
    const content = response.choices?.[0]?.message?.content;
    const raw = Array.isArray(content)
      ? content
          .filter((part) => part.type === "text" || part.text)
          .map((part) => part.text ?? "")
          .join("")
      : content;

    if (!raw) {
      throw new Error("LLM planner returned no JSON content");
    }

    const parsed = JSON.parse(raw) as unknown;

    assertPlanSpec(parsed);
    return parsed;
  }

  private toRepoContext(repoScan: RepoScanResult): object {
    const detections = repoScan.detections;

    return {
      repoPath: repoScan.repoPath,
      profile: {
        packageName: repoScan.profile.packageName,
        framework: repoScan.profile.framework,
        packageManager: repoScan.profile.packageManager,
        scripts: repoScan.profile.scripts,
        testFrameworks: repoScan.profile.testFrameworks,
        e2eFrameworks: repoScan.profile.e2eFrameworks,
        apiTestTools: repoScan.profile.apiTestTools,
        appIds: repoScan.profile.appIds,
        sourceRoots: repoScan.profile.sourceRoots,
        testDirectories: repoScan.profile.testDirectories,
        e2eDirectories: repoScan.profile.e2eDirectories
      },
      totals: repoScan.totals,
      detections: {
        screens: toValues(detections.screens, 20),
        routeNames: toValues(detections.routeNames, 20),
        apiEndpoints: toValues(detections.apiEndpoints, 30),
        testIds: toValues(detections.testIds, 40),
        accessibilityLabels: toValues(detections.accessibilityLabels, 40)
      },
      files: repoScan.files.slice(0, 80).map((file) => ({
        path: file.path,
        imports: file.imports.slice(0, 12),
        exports: file.exports.slice(0, 12),
        componentNames: file.componentNames,
        screenNames: file.screenNames,
        routeNames: file.routeNames,
        apiEndpoints: file.apiEndpoints.slice(0, 10),
        testIds: file.testIds.slice(0, 10),
        accessibilityLabels: file.accessibilityLabels.slice(0, 10),
        interactiveElementCount: file.interactiveElementCount,
        testIdCount: file.testIdCount,
        accessibilityLabelCount: file.accessibilityLabelCount,
        signals: file.signals
      }))
    };
  }
}

function toValues(values: Array<{ value: string }>, limit: number): string[] {
  return values.map((value) => value.value).slice(0, limit);
}

function assertPlanSpec(value: unknown): asserts value is LlmTestPlanSpec {
  assertObject(value, "plan");
  assertExactKeys(value, "plan", [
    "summary",
    "risks",
    "selectorGaps",
    "maestroFlows",
    "apiTestSuggestions",
    "recommendedNextSteps"
  ]);
  assertString(value.summary, "summary");
  assertRiskAreas(value.risks);
  assertSelectorGaps(value.selectorGaps);
  assertMaestroFlows(value.maestroFlows);
  assertApiTestSuggestions(value.apiTestSuggestions);
  assertStringArray(value.recommendedNextSteps, "recommendedNextSteps", 1);
}

function assertRiskAreas(value: unknown): asserts value is RiskArea[] {
  assertArray(value, "risks", 1);
  value.forEach((risk, index) => {
    assertObject(risk, `risks[${index}]`);
    assertExactKeys(risk, `risks[${index}]`, ["id", "title", "level", "why", "evidence", "recommendedCoverage"]);
    assertString(risk.id, `risks[${index}].id`);
    assertString(risk.title, `risks[${index}].title`);
    if (risk.level !== "high" && risk.level !== "medium" && risk.level !== "low") {
      throw new Error(`Invalid risks[${index}].level`);
    }
    assertString(risk.why, `risks[${index}].why`);
    assertStringArray(risk.evidence, `risks[${index}].evidence`, 1);
    assertStringArray(risk.recommendedCoverage, `risks[${index}].recommendedCoverage`, 1);
  });
}

function assertSelectorGaps(value: unknown): asserts value is SelectorGap[] {
  assertArray(value, "selectorGaps", 0);
  value.forEach((gap, index) => {
    assertObject(gap, `selectorGaps[${index}]`);
    assertExactKeys(gap, `selectorGaps[${index}]`, ["file", "issue", "recommendation"]);
    assertString(gap.file, `selectorGaps[${index}].file`);
    assertString(gap.issue, `selectorGaps[${index}].issue`);
    assertString(gap.recommendation, `selectorGaps[${index}].recommendation`);
  });
}

function assertMaestroFlows(value: unknown): asserts value is MaestroFlow[] {
  assertArray(value, "maestroFlows", 1);
  value.forEach((flow, index) => {
    assertObject(flow, `maestroFlows[${index}]`);
    assertExactKeys(flow, `maestroFlows[${index}]`, ["name", "fileName", "yaml"]);
    assertString(flow.name, `maestroFlows[${index}].name`);
    assertString(flow.fileName, `maestroFlows[${index}].fileName`);
    assertString(flow.yaml, `maestroFlows[${index}].yaml`);
  });
}

function assertApiTestSuggestions(value: unknown): asserts value is ApiTestSuggestion[] {
  assertArray(value, "apiTestSuggestions", 1);
  value.forEach((test, index) => {
    assertObject(test, `apiTestSuggestions[${index}]`);
    assertExactKeys(test, `apiTestSuggestions[${index}]`, ["name", "fileName", "code", "notes"]);
    assertString(test.name, `apiTestSuggestions[${index}].name`);
    assertString(test.fileName, `apiTestSuggestions[${index}].fileName`);
    assertString(test.code, `apiTestSuggestions[${index}].code`);
    assertStringArray(test.notes, `apiTestSuggestions[${index}].notes`, 1);
  });
}

function assertObject(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected ${path} to be an object`);
  }
}

function assertExactKeys(value: Record<string, unknown>, path: string, expectedKeys: string[]): void {
  const expected = new Set(expectedKeys);
  const actualKeys = Object.keys(value);
  const extraKeys = actualKeys.filter((key) => !expected.has(key));

  if (extraKeys.length) {
    throw new Error(`Unexpected key(s) in ${path}: ${extraKeys.join(", ")}`);
  }
}

function assertArray(value: unknown, path: string, minItems: number): asserts value is unknown[] {
  if (!Array.isArray(value) || value.length < minItems) {
    throw new Error(`Expected ${path} to be an array with at least ${minItems} item(s)`);
  }
}

function assertString(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Expected ${path} to be a non-empty string`);
  }
}

function assertStringArray(value: unknown, path: string, minItems: number): asserts value is string[] {
  assertArray(value, path, minItems);
  value.forEach((item, index) => assertString(item, `${path}[${index}]`));
}
