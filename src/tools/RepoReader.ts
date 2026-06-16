import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import ts from "typescript";
import type { RepoScanDetections, RepoScanResult, SourceFileSummary } from "../types/TestArchitecture.js";
import { ProjectProfiler } from "./ProjectProfiler.js";

const ALLOWED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".json"]);
const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  "ios",
  ".git",
  ".expo",
  ".next",
  "dist",
  "build",
  "coverage",
  "output"
]);
const IGNORED_FILES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml"
]);

export interface RepoReaderOptions {
  maxFiles?: number;
  maxFileBytes?: number;
}

interface AstFileScan {
  imports: string[];
  exports: string[];
  componentNames: string[];
  screenNames: string[];
  routeNames: string[];
  apiEndpoints: string[];
  testIds: string[];
  accessibilityLabels: string[];
  interactiveElementCount: number;
  signals: string[];
}

export class RepoReader {
  constructor(private readonly options: RepoReaderOptions = {}) {}

  async scan(repoPath: string): Promise<RepoScanResult> {
    const profiler = new ProjectProfiler();
    const profile = await profiler.profile(repoPath);
    const files = await this.walk(repoPath);
    const summaries: SourceFileSummary[] = [];
    const maxFiles = this.options.maxFiles ?? 80;

    for (const file of files.slice(0, maxFiles)) {
      summaries.push(await this.summarizeFile(repoPath, file));
    }

    return {
      repoPath,
      scannedAt: new Date().toISOString(),
      profile,
      files: summaries,
      detections: this.aggregateDetections(summaries),
      totals: {
        filesScanned: summaries.length,
        testIds: summaries.reduce((sum, file) => sum + file.testIdCount, 0),
        accessibilityLabels: summaries.reduce(
          (sum, file) => sum + file.accessibilityLabelCount,
          0
        ),
        components: summaries.filter((file) => file.extension === ".tsx" || file.extension === ".jsx").length,
        apiLikeFiles: summaries.filter((file) => file.signals.includes("api-client")).length
      }
    };
  }

  private async walk(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
      const fullPath = join(directory, entry.name);

      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name) || fullPath.includes("android/build")) {
          continue;
        }
        files.push(...(await this.walk(fullPath)));
        continue;
      }

      if (entry.isFile() && ALLOWED_EXTENSIONS.has(extname(entry.name)) && !IGNORED_FILES.has(entry.name)) {
        files.push(fullPath);
      }
    }

    return files.sort();
  }

  private async summarizeFile(repoPath: string, filePath: string): Promise<SourceFileSummary> {
    const fileStats = await stat(filePath);
    const maxFileBytes = this.options.maxFileBytes ?? 60_000;
    const raw = await readFile(filePath, "utf8");
    const content = fileStats.size > maxFileBytes ? raw.slice(0, maxFileBytes) : raw;
    const astScan = this.scanAst(content, repoPath, filePath);

    return {
      path: relative(repoPath, filePath),
      extension: extname(filePath),
      imports: astScan.imports,
      exports: astScan.exports,
      componentNames: astScan.componentNames,
      screenNames: astScan.screenNames,
      routeNames: astScan.routeNames,
      apiEndpoints: astScan.apiEndpoints,
      testIds: astScan.testIds,
      accessibilityLabels: astScan.accessibilityLabels,
      interactiveElementCount: astScan.interactiveElementCount,
      testIdCount: astScan.testIds.length,
      accessibilityLabelCount: astScan.accessibilityLabels.length,
      lineCount: content.split(/\r?\n/).length,
      signals: astScan.signals
    };
  }

  private scanAst(content: string, repoPath: string, filePath: string): AstFileScan {
    const sourceFile = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      true,
      this.scriptKindFor(filePath)
    );
    const imports = new Set<string>();
    const exports = new Set<string>();
    const componentNames = new Set<string>();
    const screenNames = new Set<string>();
    const routeNames = new Set<string>();
    const apiEndpoints = new Set<string>();
    const testIds = new Set<string>();
    const accessibilityLabels = new Set<string>();
    const signals = new Set<string>();
    let interactiveElementCount = 0;
    const fileScreenName = this.screenNameFromFile(filePath);
    const expoRoute = this.detectExpoRouteName(repoPath, filePath);

    if (fileScreenName) screenNames.add(fileScreenName);
    if (expoRoute) routeNames.add(expoRoute);
    if (filePath.includes(".test.") || filePath.includes(".spec.")) signals.add("existing-tests");

    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        imports.add(node.moduleSpecifier.text);
      }

      if (ts.isFunctionDeclaration(node) && node.name) {
        this.recordExportedName(node, node.name.text, exports);
        if (this.isComponentName(node.name.text)) componentNames.add(node.name.text);
      }

      if (ts.isClassDeclaration(node) && node.name) {
        this.recordExportedName(node, node.name.text, exports);
        if (this.isComponentName(node.name.text) && this.classExtendsReactComponent(node, sourceFile)) {
          componentNames.add(node.name.text);
        }
      }

      if ((ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) && node.name) {
        this.recordExportedName(node, node.name.text, exports);
      }

      if (ts.isVariableStatement(node)) {
        const isExported = this.hasModifier(node, ts.SyntaxKind.ExportKeyword);

        for (const declaration of node.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name)) continue;

          if (isExported) exports.add(declaration.name.text);
          if (this.isComponentName(declaration.name.text) && this.isComponentInitializer(declaration.initializer)) {
            componentNames.add(declaration.name.text);
          }
          if (this.isEndpointContainerName(declaration.name.text)) {
            const endpoint = declaration.initializer ? this.literalValue(declaration.initializer, sourceFile) : undefined;

            if (endpoint && this.looksLikeEndpoint(endpoint)) {
              apiEndpoints.add(endpoint);
              signals.add("api-client");
            }
          }
        }
      }

      if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
        const tagName = this.jsxTagNameToText(node.tagName);

        if (this.isInteractiveElement(tagName)) {
          interactiveElementCount += 1;
          signals.add("interactive-ui");
        }
        if (this.isListElement(tagName)) signals.add("list-ui");
        if (tagName.endsWith("Screen")) {
          const routeName = this.readJsxAttributeValue(node.attributes, "name", sourceFile);
          const screenComponent = this.readJsxAttributeValue(node.attributes, "component", sourceFile);

          if (routeName) {
            routeNames.add(routeName);
            signals.add("navigation");
          }
          if (screenComponent && this.isComponentName(screenComponent)) screenNames.add(screenComponent);
        }

        for (const value of this.readJsxAttributeValues(node.attributes, ["testID", "testId"], sourceFile)) {
          testIds.add(value);
        }
        for (const value of this.readJsxAttributeValues(node.attributes, ["accessibilityLabel"], sourceFile)) {
          accessibilityLabels.add(value);
        }
      }

      if (ts.isPropertyAssignment(node)) {
        const propertyName = this.propertyNameToText(node.name);
        const value = this.literalValue(node.initializer, sourceFile);

        if (value && (propertyName === "testID" || propertyName === "testId")) testIds.add(value);
        if (value && propertyName === "accessibilityLabel") accessibilityLabels.add(value);
        if (value && propertyName && this.isEndpointContainerName(propertyName) && this.looksLikeEndpoint(value)) {
          apiEndpoints.add(value);
          signals.add("api-client");
        }
      }

      if (ts.isCallExpression(node)) {
        this.recordCallExpression(node, sourceFile, routeNames, apiEndpoints, signals);
      }

      if (ts.isIdentifier(node)) {
        if (["useNavigation", "createNativeStackNavigator", "NavigationContainer"].includes(node.text)) {
          signals.add("navigation");
        }
        if (["AsyncStorage", "MMKV", "SecureStore"].includes(node.text)) signals.add("local-storage");
        if (["ApolloClient", "createApi", "graphql", "axios", "fetch"].includes(node.text)) signals.add("api-client");
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    for (const name of componentNames) {
      if (/(?:Screen|Page|View)$/.test(name)) screenNames.add(name);
    }

    return {
      imports: this.unique([...imports]),
      exports: this.unique([...exports]),
      componentNames: this.unique([...componentNames]),
      screenNames: this.unique([...screenNames]),
      routeNames: this.unique([...routeNames]),
      apiEndpoints: this.unique([...apiEndpoints].filter((value) => this.looksLikeEndpoint(value))),
      testIds: this.unique([...testIds]),
      accessibilityLabels: this.unique([...accessibilityLabels]),
      interactiveElementCount,
      signals: this.unique([...signals])
    };
  }

  private scriptKindFor(filePath: string): ts.ScriptKind {
    switch (extname(filePath)) {
      case ".tsx":
        return ts.ScriptKind.TSX;
      case ".jsx":
        return ts.ScriptKind.JSX;
      case ".js":
        return ts.ScriptKind.JS;
      case ".json":
        return ts.ScriptKind.JSON;
      default:
        return ts.ScriptKind.TS;
    }
  }

  private recordExportedName(node: ts.Node, name: string, exports: Set<string>): void {
    if (this.hasModifier(node, ts.SyntaxKind.ExportKeyword)) {
      exports.add(name);
    }
  }

  private hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
    return ts.canHaveModifiers(node) ? ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) ?? false : false;
  }

  private isComponentName(value: string): boolean {
    return /^[A-Z][A-Za-z0-9_]*$/.test(value);
  }

  private isComponentInitializer(initializer: ts.Expression | undefined): boolean {
    if (!initializer) return false;
    if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) return true;

    if (ts.isCallExpression(initializer)) {
      const callee = this.expressionName(initializer.expression);
      return callee === "memo" || callee === "React.memo" || callee === "forwardRef" || callee === "React.forwardRef";
    }

    return false;
  }

  private classExtendsReactComponent(node: ts.ClassDeclaration, sourceFile: ts.SourceFile): boolean {
    return Boolean(
      node.heritageClauses?.some((clause) =>
        clause.types.some((typeNode) => /(?:^|\.)PureComponent$|(?:^|\.)Component$/.test(typeNode.expression.getText(sourceFile)))
      )
    );
  }

  private jsxTagNameToText(name: ts.JsxTagNameExpression): string {
    if (ts.isIdentifier(name)) return name.text;
    if (ts.isPropertyAccessExpression(name)) return this.expressionName(name);
    return name.getText();
  }

  private isInteractiveElement(tagName: string): boolean {
    return ["Pressable", "TouchableOpacity", "TouchableHighlight", "TouchableWithoutFeedback", "Button", "TextInput"].includes(
      tagName.split(".").at(-1) ?? tagName
    );
  }

  private isListElement(tagName: string): boolean {
    return ["FlatList", "SectionList", "ScrollView"].includes(tagName.split(".").at(-1) ?? tagName);
  }

  private readJsxAttributeValues(
    attributes: ts.JsxAttributes,
    names: string[],
    sourceFile: ts.SourceFile
  ): string[] {
    const values: string[] = [];

    for (const property of attributes.properties) {
      if (!ts.isJsxAttribute(property) || !names.includes(this.jsxAttributeNameToText(property.name))) continue;

      const value = this.readJsxInitializer(property.initializer, sourceFile);
      if (value) values.push(value);
    }

    return values;
  }

  private readJsxAttributeValue(
    attributes: ts.JsxAttributes,
    name: string,
    sourceFile: ts.SourceFile
  ): string | undefined {
    return this.readJsxAttributeValues(attributes, [name], sourceFile)[0];
  }

  private jsxAttributeNameToText(name: ts.JsxAttributeName): string {
    return ts.isIdentifier(name) ? name.text : name.getText();
  }

  private readJsxInitializer(initializer: ts.JsxAttribute["initializer"], sourceFile: ts.SourceFile): string | undefined {
    if (!initializer) return undefined;
    if (ts.isStringLiteral(initializer)) return initializer.text;
    if (ts.isJsxExpression(initializer) && initializer.expression) {
      if (ts.isIdentifier(initializer.expression)) return initializer.expression.text;
      return this.literalValue(initializer.expression, sourceFile);
    }
    return undefined;
  }

  private propertyNameToText(name: ts.PropertyName): string | undefined {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
    return undefined;
  }

  private recordCallExpression(
    node: ts.CallExpression,
    sourceFile: ts.SourceFile,
    routeNames: Set<string>,
    apiEndpoints: Set<string>,
    signals: Set<string>
  ): void {
    const callee = this.expressionName(node.expression);
    const firstArgValue = node.arguments[0] ? this.literalValue(node.arguments[0], sourceFile) : undefined;

    if (["describe", "it", "test"].includes(callee)) signals.add("existing-tests");
    if (["fetch", "axios", "graphql", "ApolloClient", "createApi"].includes(callee)) signals.add("api-client");

    if (this.isNavigationCall(callee) && firstArgValue) {
      routeNames.add(firstArgValue);
      signals.add("navigation");
    }

    if (firstArgValue && this.isApiCall(callee) && this.looksLikeEndpoint(firstArgValue)) {
      apiEndpoints.add(firstArgValue);
      signals.add("api-client");
    }
  }

  private isNavigationCall(callee: string): boolean {
    if (/^(navigate|replace|jumpTo)$/.test(callee)) return true;
    return /^(navigation|router)\.(navigate|replace|push|jumpTo)$/.test(callee);
  }

  private isApiCall(callee: string): boolean {
    if (callee === "fetch" || callee === "axios") return true;
    return /\.(get|post|put|patch|delete)$/.test(callee) || /^axios\.(get|post|put|patch|delete)$/.test(callee);
  }

  private isEndpointContainerName(name: string): boolean {
    return /(api|url|uri|endpoint|path|route)/i.test(name);
  }

  private expressionName(expression: ts.Expression): string {
    if (ts.isIdentifier(expression)) return expression.text;
    if (ts.isPropertyAccessExpression(expression)) {
      return `${this.expressionName(expression.expression)}.${expression.name.text}`;
    }
    return expression.getText();
  }

  private literalValue(node: ts.Node, sourceFile: ts.SourceFile): string | undefined {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isTemplateExpression(node)) {
      const spans = node.templateSpans
        .map((span) => `\${${span.expression.getText(sourceFile)}}${span.literal.text}`)
        .join("");
      return `${node.head.text}${spans}`;
    }
    if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isParenthesizedExpression(node)) {
      return this.literalValue(node.expression, sourceFile);
    }
    return undefined;
  }

  private screenNameFromFile(filePath: string): string | undefined {
    const fileBase = basename(filePath, extname(filePath));
    return /^[A-Z][A-Za-z0-9_]*(?:Screen|Page|View)$/.test(fileBase) ? fileBase : undefined;
  }

  private aggregateDetections(files: SourceFileSummary[]): RepoScanDetections {
    return {
      components: this.aggregateValues(files, (file) => file.componentNames),
      screens: this.aggregateValues(files, (file) => file.screenNames),
      routeNames: this.aggregateValues(files, (file) => file.routeNames),
      apiEndpoints: this.aggregateValues(files, (file) => file.apiEndpoints),
      testIds: this.aggregateValues(files, (file) => file.testIds),
      accessibilityLabels: this.aggregateValues(files, (file) => file.accessibilityLabels)
    };
  }

  private aggregateValues(
    files: SourceFileSummary[],
    selectValues: (file: SourceFileSummary) => string[]
  ): { value: string; files: string[] }[] {
    const valuesByFile = new Map<string, Set<string>>();

    for (const file of files) {
      for (const value of selectValues(file)) {
        const filesForValue = valuesByFile.get(value) ?? new Set<string>();
        filesForValue.add(file.path);
        valuesByFile.set(value, filesForValue);
      }
    }

    return [...valuesByFile.entries()]
      .map(([value, detectedFiles]) => ({
        value,
        files: [...detectedFiles].sort()
      }))
      .sort((a, b) => a.value.localeCompare(b.value));
  }

  private detectExpoRouteName(repoPath: string, filePath: string): string | undefined {
    const relativePath = relative(repoPath, filePath).replace(/\\/g, "/");
    const appIndex = relativePath.split("/").lastIndexOf("app");

    if (appIndex === -1) return undefined;

    const routePath = relativePath
      .split("/")
      .slice(appIndex + 1)
      .join("/")
      .replace(/\.[jt]sx?$/, "");

    if (!routePath || routePath === "_layout" || routePath.endsWith("/_layout")) return undefined;

    return `/${routePath.replace(/\/index$/, "").replace(/\([^)]*\)\//g, "")}`;
  }

  private looksLikeEndpoint(value: string): boolean {
    return (
      /^https?:\/\//.test(value) ||
      value.startsWith("/api/") ||
      value.startsWith("api/") ||
      /^\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%{}-]+$/.test(value)
    );
  }

  private matchGroup(content: string, pattern: RegExp): string[] {
    return [...content.matchAll(pattern)]
      .map((match) => match.slice(1).find((value) => value !== undefined))
      .filter((value): value is string => Boolean(value))
      .map((value) => value.trim().replace(/\\(["'`])/g, "$1").replace(/\\$/, ""))
      .filter(Boolean);
  }

  private unique(values: string[]): string[] {
    return [...new Set(values)].sort((a, b) => a.localeCompare(b));
  }

  private count(content: string, pattern: RegExp): number {
    return [...content.matchAll(pattern)].length;
  }
}
