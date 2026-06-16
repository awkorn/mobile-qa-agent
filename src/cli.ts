import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Command } from "commander";
import { FailureAnalyzerAgent } from "./agents/FailureAnalyzerAgent.js";
import { LlmPlannerAgent, type LlmPlannerConfig } from "./agents/LlmPlannerAgent.js";
import { TestArchitectAgent } from "./agents/TestArchitectAgent.js";
import { ApiTestWriter } from "./tools/ApiTestWriter.js";
import { FailureLogReader } from "./tools/FailureLogReader.js";
import { MaestroFlowWriter } from "./tools/MaestroFlowWriter.js";
import { ProjectProfiler } from "./tools/ProjectProfiler.js";
import { ProjectProfileWriter } from "./tools/ProjectProfileWriter.js";
import { RepoReader } from "./tools/RepoReader.js";
import { TestPlanWriter } from "./tools/TestPlanWriter.js";

const DEFAULT_OUTPUT_DIR = "output";
type PlannerMode = "auto" | "deterministic" | "llm";

interface AnalyzeOptions {
  repo: string;
  feature: string;
  output: string;
  planner: string;
  llmModel?: string;
  llmBaseUrl?: string;
  llmTimeoutMs?: string;
}

export function runCli(): void {
  const program = new Command();

  program
    .name("ai-mobile-test-architect")
    .description("AI-ready mobile test architecture CLI for React Native apps")
    .version("0.1.0");

  program
    .command("profile")
    .description("Profile a React Native repo's framework, tooling, scripts, app IDs, and test layout")
    .requiredOption("--repo <path>", "Path to the target app repo")
    .option("--output <dir>", "Output directory", DEFAULT_OUTPUT_DIR)
    .action(async (options: { repo: string; output: string }) => {
      try {
        const profiler = new ProjectProfiler();
        const writer = new ProjectProfileWriter();
        const profile = await profiler.profile(options.repo);
        const paths = await writer.write(options.output, profile);

        console.log(`Wrote Markdown project profile: ${paths.markdownPath}`);
        console.log(`Wrote structured project profile: ${paths.jsonPath}`);
      } catch (error) {
        handleError(error);
      }
    });

  program
    .command("analyze")
    .description("Analyze a React Native repo and generate a risk-based test plan")
    .requiredOption("--repo <path>", "Path to the target app repo")
    .requiredOption("--feature <name>", "Feature or product area to analyze")
    .option("--output <dir>", "Output directory", DEFAULT_OUTPUT_DIR)
    .option(
      "--planner <mode>",
      "Planning mode: auto uses an LLM when configured, deterministic never calls an LLM, llm requires an LLM",
      "auto"
    )
    .option("--llm-model <model>", "LLM model for JSON planning")
    .option("--llm-base-url <url>", "OpenAI-compatible API base URL", process.env.MOBILE_QA_LLM_BASE_URL)
    .option("--llm-timeout-ms <ms>", "LLM request timeout in milliseconds", process.env.MOBILE_QA_LLM_TIMEOUT_MS)
    .action(async (options: AnalyzeOptions) => {
      try {
        const reader = new RepoReader();
        const agent = new TestArchitectAgent();
        const writer = new TestPlanWriter();
        const maestroWriter = new MaestroFlowWriter();
        const apiTestWriter = new ApiTestWriter();
        const repoScan = await reader.scan(options.repo);
        const plannerMode = normalizePlannerMode(options.planner);
        const plan = await createPlan(options, plannerMode, repoScan, agent);
        const paths = await writer.write(options.output, plan);
        const maestroPaths = await Promise.all(
          plan.maestroFlows.map((flow) => maestroWriter.write(options.output, flow))
        );
        const apiTestPaths = await Promise.all(
          plan.apiTestSuggestions.map((test) => apiTestWriter.write(options.output, test))
        );

        console.log(`Wrote Markdown test plan: ${paths.markdownPath}`);
        console.log(`Wrote structured test plan: ${paths.jsonPath}`);
        for (const path of maestroPaths) {
          console.log(`Wrote generated Maestro flow: ${path}`);
        }
        for (const path of apiTestPaths) {
          console.log(`Wrote generated API test: ${path}`);
        }
      } catch (error) {
        handleError(error);
      }
    });

  program
    .command("generate-maestro")
    .description("Generate a deterministic Maestro YAML flow for a mobile feature")
    .requiredOption("--feature <name>", "Feature or product area to generate")
    .option("--output <dir>", "Output directory", DEFAULT_OUTPUT_DIR)
    .action(async (options: { feature: string; output: string }) => {
      try {
        const agent = new TestArchitectAgent();
        const writer = new MaestroFlowWriter();
        const flow = agent.createMaestroFlow(options.feature);
        const outputPath = await writer.write(options.output, flow);

        console.log(`Wrote Maestro flow: ${outputPath}`);
      } catch (error) {
        handleError(error);
      }
    });

  program
    .command("analyze-failure")
    .description("Analyze a Maestro or test failure log and produce a fix-oriented Markdown summary")
    .requiredOption("--log <path>", "Path to the failure log")
    .option("--output <dir>", "Output directory", DEFAULT_OUTPUT_DIR)
    .action(async (options: { log: string; output: string }) => {
      try {
        const reader = new FailureLogReader();
        const agent = new FailureAnalyzerAgent();
        const log = await reader.read(options.log);
        const analysis = agent.analyze(log);
        const outputPath = join(options.output, "failure-analysis.md");

        await mkdir(dirname(outputPath), { recursive: true });
        await writeFile(outputPath, agent.toMarkdown(analysis), "utf8");

        console.log(`Wrote failure analysis: ${outputPath}`);
      } catch (error) {
        handleError(error);
      }
    });

  program.parseAsync(process.argv).catch(handleError);
}

async function createPlan(
  options: AnalyzeOptions,
  plannerMode: PlannerMode,
  repoScan: Awaited<ReturnType<RepoReader["scan"]>>,
  deterministicAgent: TestArchitectAgent
) {
  const llmConfig = resolveLlmConfig(options);

  if (plannerMode === "deterministic") {
    return deterministicAgent.createPlan(options.feature, repoScan);
  }

  if (!llmConfig) {
    if (plannerMode === "llm") {
      throw new Error(
        "LLM planner requires MOBILE_QA_LLM_API_KEY or OPENAI_API_KEY plus --llm-model, MOBILE_QA_LLM_MODEL, or OPENAI_MODEL."
      );
    }

    console.warn("LLM planner is not configured; using deterministic planner.");
    return deterministicAgent.createPlan(options.feature, repoScan);
  }

  try {
    return await new LlmPlannerAgent(llmConfig).createPlan(options.feature, repoScan);
  } catch (error) {
    if (plannerMode === "llm") {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);
    console.warn(`LLM planner failed (${message}); using deterministic planner.`);
    return deterministicAgent.createPlan(options.feature, repoScan);
  }
}

function resolveLlmConfig(options: AnalyzeOptions): LlmPlannerConfig | undefined {
  const apiKey = process.env.MOBILE_QA_LLM_API_KEY ?? process.env.OPENAI_API_KEY;
  const model = options.llmModel ?? process.env.MOBILE_QA_LLM_MODEL ?? process.env.OPENAI_MODEL;

  if (!apiKey || !model) {
    return undefined;
  }

  return {
    apiKey,
    model,
    baseUrl: options.llmBaseUrl ?? process.env.OPENAI_BASE_URL,
    timeoutMs: parseTimeoutMs(options.llmTimeoutMs)
  };
}

function parseTimeoutMs(value: string | undefined): number | undefined {
  if (!value) return undefined;

  const timeoutMs = Number(value);
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`Invalid --llm-timeout-ms value: ${value}`);
  }

  return timeoutMs;
}

function normalizePlannerMode(value: string): PlannerMode {
  if (value === "auto" || value === "deterministic" || value === "llm") {
    return value;
  }

  throw new Error(`Invalid --planner value: ${value}. Expected auto, deterministic, or llm.`);
}

function handleError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exit(1);
}
