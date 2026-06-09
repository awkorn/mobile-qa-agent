export type RiskLevel = "high" | "medium" | "low";

export interface SourceFileSummary {
  path: string;
  extension: string;
  imports: string[];
  exports: string[];
  interactiveElementCount: number;
  testIdCount: number;
  accessibilityLabelCount: number;
  lineCount: number;
  signals: string[];
}

export interface RepoScanResult {
  repoPath: string;
  scannedAt: string;
  files: SourceFileSummary[];
  totals: {
    filesScanned: number;
    testIds: number;
    accessibilityLabels: number;
    components: number;
    apiLikeFiles: number;
  };
}

export interface RiskArea {
  id: string;
  title: string;
  level: RiskLevel;
  why: string;
  evidence: string[];
  recommendedCoverage: string[];
}

export interface SelectorGap {
  file: string;
  issue: string;
  recommendation: string;
}

export interface MaestroFlow {
  name: string;
  fileName: string;
  yaml: string;
}

export interface ApiTestSuggestion {
  name: string;
  fileName: string;
  code: string;
  notes: string[];
}

export interface TestPlan {
  feature: string;
  generatedAt: string;
  summary: string;
  risks: RiskArea[];
  selectorGaps: SelectorGap[];
  maestroFlows: MaestroFlow[];
  apiTestSuggestions: ApiTestSuggestion[];
  recommendedNextSteps: string[];
  repoScan: RepoScanResult;
}

export interface FailureAnalysis {
  generatedAt: string;
  likelyCause: string;
  confidence: RiskLevel;
  evidence: string[];
  recommendedFixes: string[];
  regressionTests: string[];
}
