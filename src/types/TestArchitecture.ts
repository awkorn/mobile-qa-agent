export type RiskLevel = "high" | "medium" | "low";

export interface SourceFileSummary {
  path: string;
  extension: string;
  imports: string[];
  exports: string[];
  componentNames: string[];
  screenNames: string[];
  routeNames: string[];
  apiEndpoints: string[];
  testIds: string[];
  accessibilityLabels: string[];
  interactiveElementCount: number;
  testIdCount: number;
  accessibilityLabelCount: number;
  lineCount: number;
  signals: string[];
}

export interface RepoValueDetection {
  value: string;
  files: string[];
}

export interface RepoScanDetections {
  components: RepoValueDetection[];
  screens: RepoValueDetection[];
  routeNames: RepoValueDetection[];
  apiEndpoints: RepoValueDetection[];
  testIds: RepoValueDetection[];
  accessibilityLabels: RepoValueDetection[];
}

export interface RepoScanResult {
  repoPath: string;
  scannedAt: string;
  profile: ProjectProfile;
  files: SourceFileSummary[];
  detections: RepoScanDetections;
  totals: {
    filesScanned: number;
    testIds: number;
    accessibilityLabels: number;
    components: number;
    apiLikeFiles: number;
  };
}

export type PackageManager = "npm" | "yarn" | "pnpm" | "bun" | "unknown";
export type ReactNativeFramework = "expo" | "react-native-cli" | "unknown";

export interface ProjectProfile {
  packageName?: string;
  packageManager: PackageManager;
  framework: ReactNativeFramework;
  languages: string[];
  appIds: {
    ios?: string;
    android?: string;
  };
  scripts: {
    test?: string;
    lint?: string;
    typecheck?: string;
    e2e?: string;
    ios?: string;
    android?: string;
    start?: string;
  };
  testFrameworks: string[];
  e2eFrameworks: string[];
  apiTestTools: string[];
  sourceRoots: string[];
  testDirectories: string[];
  e2eDirectories: string[];
  configFiles: string[];
  dependencies: string[];
  recommendations: string[];
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
