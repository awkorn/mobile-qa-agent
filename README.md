# ai-mobile-test-architect

`ai-mobile-test-architect` is a TypeScript CLI skeleton for an AI-powered mobile test architecture agent. It is designed for React Native teams that want faster SDET planning loops: scan a repo, identify product and automation risks, generate a risk-based test plan, draft Maestro E2E flows, suggest Jest/Supertest API tests, and summarize failure logs.

The MVP uses deterministic mock logic so it is useful without API keys. The architecture is intentionally ready for a future LLM provider.

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

The generated plan includes:

- High, medium, and low risk areas
- Evidence from scanned source files
- Detected React Native screen/component names and route names
- Detected API endpoint strings
- Existing `testID` and `accessibilityLabel` usage
- Missing selector and accessibility recommendations
- Maestro flow suggestions
- Jest/Supertest API test suggestions
- Recommended next steps for an SDET or mobile engineer

The `generate-maestro` command writes a flow like:

```yaml
appId: com.dishlist.app
---
- launchApp
- assertVisible: "DishList"
- tapOn:
    id: "create-dish-button"
- assertVisible: "Create Dish"
```

The `analyze-failure` command writes `output/failure-analysis.md` with likely cause, evidence, recommended fixes, and regression coverage.

## Architecture

```text
CLI commands
  |
  +-- analyze
  |     |
  |     +-- RepoReader
  |     +-- TestArchitectAgent
  |     +-- TestPlanWriter
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
  +-- can replace deterministic logic inside agents
  +-- can reuse prompt files under src/prompts
```

## Repo Scanning Rules

The repo reader scans only `.ts`, `.tsx`, `.js`, `.jsx`, and `.json` files. It ignores `node_modules`, `ios`, `android/build`, `.git`, `.expo`, `.next`, `dist`, `build`, `coverage`, `output`, and package lockfiles.

The scan extracts deterministic app facts from source files, including React Native screen/component names, React Navigation and Expo Router route names, API endpoint strings, and literal `testID`/`accessibilityLabel` values. These facts are written into both `test-plan.md` and `test-plan.json`.

## Roadmap

- Add OpenAI/Claude provider
- Add MCP GitHub repo reader
- Add Playwright/Maestro MCP test execution
- Add PR risk analysis
- Add CI log ingestion
- Add evals for generated test quality

## Resume Bullet

“Built an AI-powered mobile test architecture agent that analyzes React Native source code, generates risk-based test plans, creates Maestro E2E flows and API test suggestions, and summarizes failures.”
