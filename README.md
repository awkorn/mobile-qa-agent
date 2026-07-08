# ai-mobile-test-architect

`ai-mobile-test-architect` is a TypeScript CLI skeleton for an AI-powered mobile test architecture agent. It is designed for React Native teams that want faster SDET planning loops: scan a repo, identify product and automation risks, generate a risk-based test plan, draft Maestro E2E flows, suggest Jest/Supertest API tests, and summarize failure logs.

The MVP keeps deterministic planning available so it is useful without API keys, and also supports an OpenAI-compatible LLM planner that emits strict JSON plan specs.

## Why It Exists

Mobile teams often know they need better E2E, API, accessibility, and selector coverage, but turning feature context into an actionable test plan takes time. This tool prototypes the workflow an internal AI engineering productivity tool could support: quick repo analysis, practical test generation, and fix-oriented failure summaries.

## Quick Start

```bash
npm install
npm run build
```

Analyze a target app repo:

```bash
npm run dev -- analyze --repo ../dishlist --feature "Recipe sharing"
```

Use the LLM planner for strict JSON planning:

```bash
export MOBILE_QA_LLM_API_KEY="..."
export MOBILE_QA_LLM_MODEL="..."
npm run dev -- analyze --repo ../dishlist --feature "Recipe sharing" --planner llm
```

The `analyze` command supports three planner modes:

- `--planner auto` uses the LLM planner when `MOBILE_QA_LLM_API_KEY` or `OPENAI_API_KEY` and a model are configured, then falls back to deterministic planning if not configured.
- `--planner llm` requires an LLM response that conforms to the strict JSON schema.
- `--planner deterministic` never calls an LLM.

LLM configuration can be supplied with environment variables or flags:

- `MOBILE_QA_LLM_API_KEY` or `OPENAI_API_KEY`
- `MOBILE_QA_LLM_MODEL`, `OPENAI_MODEL`, or `--llm-model`
- `MOBILE_QA_LLM_BASE_URL`, `OPENAI_BASE_URL`, or `--llm-base-url` for OpenAI-compatible providers
- `MOBILE_QA_LLM_TIMEOUT_MS` or `--llm-timeout-ms`

Profile a target app repo before generating tests:

```bash
npm run dev -- profile --repo ../dishlist
```

Generate a Maestro flow:

```bash
npm run dev -- generate-maestro --feature "Create DishList"
```

Analyze a failure log:

```bash
npm run dev -- analyze-failure --log ../dishlist/artifacts/latest-failure.log
```

## Example Output

The `analyze` command writes:

- `output/test-plan.md`
- `output/test-plan.json`
- `output/maestro/<feature>-generated-flow.yaml`
- `output/api/<feature>-api-contract.generated.test.ts`

The generated plan includes:

- A project profile with framework, package manager, scripts, app IDs, test tools, and test directories
- High, medium, and low risk areas
- Evidence from scanned source files
- Detected React Native screen/component names and route names
- Detected API endpoint strings
- Existing `testID` and `accessibilityLabel` usage
- Missing selector and accessibility recommendations
- Generated Maestro flow files seeded from detected selectors and labels
- Generated fetch-based API contract smoke tests seeded from detected endpoints
- Recommended next steps for an SDET or mobile engineer

The generated Maestro flow starts as a repo-specific draft like:

```yaml
appId: REPLACE_WITH_APP_ID
---
- launchApp
- assertVisible: "Recipe name"
- tapOn:
    id: "recipe-name-input"
- inputText: "Generated QA test"
- tapOn:
    id: "save-recipe-button"
```

Replace the `appId` and any sample input values before committing the generated flow into the target app.

The `analyze-failure` command writes `output/failure-analysis.md` with likely cause, evidence, recommended fixes, and regression coverage.

The `profile` command writes:

- `output/project-profile.md`
- `output/project-profile.json`

Use this as step one before turning the CLI into a fuller agent. It tells the generator whether the target app is Expo or React Native CLI, which package manager and scripts to use, which test frameworks already exist, whether Maestro/Detox folders are present, where source and test files live, and whether iOS/Android app IDs can be detected.

## Architecture

```text
CLI commands
  |
  +-- profile
  |     |
  |     +-- ProjectProfiler
  |     +-- ProjectProfileWriter
  |
  +-- analyze
  |     |
  |     +-- ProjectProfiler
  |     +-- RepoReader
  |     +-- TestArchitectAgent
  |     +-- TestPlanWriter
  |     +-- MaestroFlowWriter
  |     +-- ApiTestWriter
  |
  +-- generate-maestro
  |     |
  |     +-- TestArchitectAgent
  |     +-- MaestroFlowWriter
  |
  +-- analyze-failure
        |
        +-- FailureLogReader
        +-- FailureAnalyzerAgent
        +-- Markdown writer

Future LLMProvider
  |
  +-- LlmPlannerAgent emits a strict JSON plan spec
  +-- TestArchitectAgent remains the deterministic fallback
  +-- can reuse prompt files under src/prompts
```

## Repo Scanning Rules

The repo reader scans only `.ts`, `.tsx`, `.js`, `.jsx`, and `.json` files. It ignores `node_modules`, `ios`, `android/build`, `.git`, `.expo`, `.next`, `dist`, `build`, `coverage`, `output`, and package lockfiles.

The scan parses `.ts`, `.tsx`, `.js`, and `.jsx` files with the TypeScript compiler API to extract deterministic app facts, including React Native screen/component names, React Navigation and Expo Router route names, API endpoint strings, imports/exports, interactive UI signals, and literal `testID`/`accessibilityLabel` values. These facts are written into both `test-plan.md` and `test-plan.json`.

## Roadmap

- Add MCP GitHub repo reader
- Add Playwright/Maestro MCP test execution
- Add PR risk analysis
- Add CI log ingestion
- Add evals for generated test quality
