import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Command } from "commander";
import { FailureAnalyzerAgent } from "./agents/FailureAnalyzerAgent.js";
import { TestArchitectAgent } from "./agents/TestArchitectAgent.js";
import { FailureLogReader } from "./tools/FailureLogReader.js";
import { MaestroFlowWriter } from "./tools/MaestroFlowWriter.js";
import { RepoReader } from "./tools/RepoReader.js";
import { TestPlanWriter } from "./tools/TestPlanWriter.js";

const DEFAULT_OUTPUT_DIR = "output";

export function runCli(): void {
  const program = new Command();

  program
    .name("ai-mobile-test-architect")
    .description("AI-ready mobile test architecture CLI for React Native apps")
    .version("0.1.0");

  program
    .command("analyze")
    .description("Analyze a React Native repo and generate a deterministic risk-based test plan")
    .requiredOption("--repo <path>", "Path to the target app repo")
    .requiredOption("--feature <name>", "Feature or product area to analyze")
    .option("--output <dir>", "Output directory", DEFAULT_OUTPUT_DIR)
    .action(async (options: { repo: string; feature: string; output: string }) => {
      try {
        const reader = new RepoReader();
        const agent = new TestArchitectAgent();
        const writer = new TestPlanWriter();
        const repoScan = await reader.scan(options.repo);
        const plan = agent.createPlan(options.feature, repoScan);
        const paths = await writer.write(options.output, plan);

        console.log(`Wrote Markdown test plan: ${paths.markdownPath}`);
        console.log(`Wrote structured test plan: ${paths.jsonPath}`);
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

function handleError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exit(1);
}
