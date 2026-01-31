import { GraphDatabase } from '../db/schema.js';
import type { GraphNode, GraphEdge } from '../types.js';

interface SymbolEntry {
  nodeId: string;
  name: string;
  fullName: string;
  type: string;
  filePath: string;
  language: string;
  exportedAs?: string[];
}

interface ImportInfo {
  filePath: string;
  moduleSpecifier: string;
  namedImports: { name: string; alias?: string }[];
  defaultImport?: string;
  namespaceImport?: string;
  isRelative: boolean;
}

interface ResolutionResult {
  resolved: number;
  unresolved: number;
  ambiguous: number;
}

export class ReferenceResolver {
  private db: GraphDatabase;
  private symbolIndex: Map<string, SymbolEntry[]> = new Map();
  private fileImports: Map<string, ImportInfo[]> = new Map();
  private fileExports: Map<string, Set<string>> = new Map();
  private verbose: boolean;

  constructor(db: GraphDatabase, verbose: boolean = false) {
    this.db = db;
    this.verbose = verbose;
  }

  async resolve(): Promise<ResolutionResult> {
    const result: ResolutionResult = { resolved: 0, unresolved: 0, ambiguous: 0 };

    // Phase 1: Build indexes
    this.log('Building symbol index...');
    this.buildSymbolIndex();

    this.log('Building import/export maps...');
    this.buildImportExportMaps();

    // Phase 2: Resolve references
    this.log('Resolving references...');
    const unresolvedEdges = this.db.getUnresolvedEdges();
    this.log(`Found ${unresolvedEdges.length} unresolved edges`);

    for (const edge of unresolvedEdges) {
      const resolution = this.resolveEdge(edge);

      if (resolution.resolved) {
        this.db.updateEdgeTarget(edge.id, resolution.targetId!, false);
        result.resolved++;
      } else if (resolution.ambiguous) {
        // Keep as unresolved but add candidates to metadata
        this.db.updateEdgeMetadata(edge.id, {
          ...edge.metadata,
          ambiguousCandidates: resolution.candidates,
        });
        result.ambiguous++;
      } else {
        result.unresolved++;
      }
    }

    this.log(`Resolution complete: ${result.resolved} resolved, ${result.ambiguous} ambiguous, ${result.unresolved} unresolved`);

    return result;
  }

  private buildSymbolIndex(): void {
    const allNodes = this.db.getAllNodes();

    for (const node of allNodes) {
      // Skip file nodes and imports
      if (node.type === 'file' || node.type === 'import') continue;

      const entry: SymbolEntry = {
        nodeId: node.id,
        name: this.getShortName(node.name),
        fullName: node.name,
        type: node.type,
        filePath: node.filePath,
        language: node.language,
      };

      // Check if this is an exported symbol
      if (node.metadata?.isExported) {
        entry.exportedAs = [entry.name];
      }

      // Index by multiple keys for flexible matching
      this.addToIndex(entry.name, entry);
      this.addToIndex(entry.fullName, entry);

      // For methods, also index by just the method name
      if (node.type === 'method' && entry.fullName.includes('.')) {
        const methodName = entry.fullName.split('.').pop()!;
        this.addToIndex(methodName, entry);
      }

      // For class members, index as ClassName.memberName
      if (node.name.includes('.')) {
        const parts = node.name.split('.');
        if (parts.length === 2) {
          this.addToIndex(`${parts[0]}.${parts[1]}`, entry);
        }
      }
    }

    this.log(`Indexed ${this.symbolIndex.size} unique symbol names`);
  }

  private buildImportExportMaps(): void {
    const importNodes = this.db.getNodesByType('import');
    const exportNodes = this.db.getNodesByType('export');

    // Build imports map
    for (const node of importNodes) {
      const imports = this.fileImports.get(node.filePath) || [];

      const importInfo: ImportInfo = {
        filePath: node.filePath,
        moduleSpecifier: node.name,
        namedImports: [],
        isRelative: node.name.startsWith('.'),
      };

      // Extract named imports from metadata
      if (node.metadata?.namedImports) {
        importInfo.namedImports = node.metadata.namedImports as { name: string; alias?: string }[];
      }
      if (node.metadata?.defaultImport) {
        importInfo.defaultImport = node.metadata.defaultImport as string;
      }

      imports.push(importInfo);
      this.fileImports.set(node.filePath, imports);
    }

    // Build exports map
    for (const node of exportNodes) {
      const exports = this.fileExports.get(node.filePath) || new Set();
      if (node.metadata?.namedExports) {
        for (const exp of node.metadata.namedExports as string[]) {
          exports.add(exp);
        }
      }
      this.fileExports.set(node.filePath, exports);
    }

    this.log(`Tracked imports for ${this.fileImports.size} files`);
  }

  private resolveEdge(edge: GraphEdge): {
    resolved: boolean;
    ambiguous: boolean;
    targetId?: string;
    candidates?: string[];
  } {
    const targetName = edge.metadata?.targetName as string;
    if (!targetName) {
      return { resolved: false, ambiguous: false };
    }

    // Get the source node to understand context
    const sourceNode = this.db.getNode(edge.sourceId);
    if (!sourceNode) {
      return { resolved: false, ambiguous: false };
    }

    // Find candidates
    const candidates = this.findCandidates(targetName, sourceNode, edge.type);

    if (candidates.length === 0) {
      return { resolved: false, ambiguous: false };
    }

    if (candidates.length === 1) {
      return { resolved: true, ambiguous: false, targetId: candidates[0].nodeId };
    }

    // Multiple candidates - try to disambiguate
    const ranked = this.rankCandidates(candidates, sourceNode, targetName);

    if (ranked.length > 0 && ranked[0].score > ranked[1]?.score + 10) {
      // Clear winner (score difference > 10)
      return { resolved: true, ambiguous: false, targetId: ranked[0].entry.nodeId };
    }

    // Still ambiguous
    return {
      resolved: false,
      ambiguous: true,
      candidates: ranked.slice(0, 5).map((r) => `${r.entry.fullName} (${r.entry.filePath})`),
    };
  }

  private findCandidates(
    targetName: string,
    sourceNode: GraphNode,
    edgeType: string
  ): SymbolEntry[] {
    const candidates: SymbolEntry[] = [];

    // Clean up the target name
    const cleanName = this.cleanTargetName(targetName);

    // Direct lookup
    const directMatches = this.symbolIndex.get(cleanName) || [];
    candidates.push(...directMatches);

    // If it's a method call like "this.method" or "obj.method", try just the method name
    if (cleanName.includes('.')) {
      const parts = cleanName.split('.');
      const lastPart = parts[parts.length - 1];

      // Try method name alone
      const methodMatches = this.symbolIndex.get(lastPart) || [];
      for (const match of methodMatches) {
        if (!candidates.some((c) => c.nodeId === match.nodeId)) {
          candidates.push(match);
        }
      }

      // Try ClassName.methodName if we have two parts
      if (parts.length >= 2) {
        const classMethod = `${parts[parts.length - 2]}.${lastPart}`;
        const classMethodMatches = this.symbolIndex.get(classMethod) || [];
        for (const match of classMethodMatches) {
          if (!candidates.some((c) => c.nodeId === match.nodeId)) {
            candidates.push(match);
          }
        }
      }
    }

    // Check imports from the source file
    const fileImports = this.fileImports.get(sourceNode.filePath) || [];
    for (const imp of fileImports) {
      // Check if targetName matches an imported name
      for (const namedImport of imp.namedImports) {
        const importedAs = namedImport.alias || namedImport.name;
        if (cleanName === importedAs || cleanName.startsWith(importedAs + '.')) {
          // Find the actual symbol from the imported module
          const actualName = namedImport.name;
          const importMatches = this.symbolIndex.get(actualName) || [];

          // Filter to matches from the imported module
          for (const match of importMatches) {
            if (this.moduleMatches(match.filePath, imp.moduleSpecifier, sourceNode.filePath)) {
              if (!candidates.some((c) => c.nodeId === match.nodeId)) {
                candidates.push(match);
              }
            }
          }
        }
      }
    }

    // Filter by edge type compatibility
    return candidates.filter((c) => this.isCompatibleType(c.type, edgeType));
  }

  private rankCandidates(
    candidates: SymbolEntry[],
    sourceNode: GraphNode,
    targetName: string
  ): { entry: SymbolEntry; score: number }[] {
    const scored = candidates.map((entry) => ({
      entry,
      score: this.calculateScore(entry, sourceNode, targetName),
    }));

    scored.sort((a, b) => b.score - a.score);
    return scored;
  }

  private calculateScore(
    candidate: SymbolEntry,
    sourceNode: GraphNode,
    targetName: string
  ): number {
    let score = 0;

    // Same file: highest priority
    if (candidate.filePath === sourceNode.filePath) {
      score += 100;
    }

    // Same directory
    const sourceDir = this.getDirectory(sourceNode.filePath);
    const candidateDir = this.getDirectory(candidate.filePath);
    if (sourceDir === candidateDir) {
      score += 50;
    }

    // Same language
    if (candidate.language === sourceNode.language) {
      score += 30;
    }

    // Exact name match
    if (candidate.fullName === targetName || candidate.name === targetName) {
      score += 40;
    }

    // Exported symbols are more likely to be referenced
    if (candidate.exportedAs && candidate.exportedAs.length > 0) {
      score += 20;
    }

    // Check if imported in source file
    const fileImports = this.fileImports.get(sourceNode.filePath) || [];
    for (const imp of fileImports) {
      if (this.moduleMatches(candidate.filePath, imp.moduleSpecifier, sourceNode.filePath)) {
        score += 60;
        break;
      }
    }

    // Prefer class members when calling with dot notation
    if (targetName.includes('.') && candidate.fullName.includes('.')) {
      const targetClass = targetName.split('.')[0];
      const candidateClass = candidate.fullName.split('.')[0];
      if (targetClass.toLowerCase() === candidateClass.toLowerCase()) {
        score += 35;
      }
    }

    return score;
  }

  private cleanTargetName(name: string): string {
    // Remove common prefixes
    let clean = name;

    // Remove 'this.' prefix
    if (clean.startsWith('this.')) {
      clean = clean.substring(5);
    }

    // Remove 'self.' prefix (Python)
    if (clean.startsWith('self.')) {
      clean = clean.substring(5);
    }

    // Remove 'super.' prefix
    if (clean.startsWith('super.')) {
      clean = clean.substring(6);
    }

    return clean;
  }

  private getShortName(fullName: string): string {
    const parts = fullName.split('.');
    return parts[parts.length - 1];
  }

  private getDirectory(filePath: string): string {
    const parts = filePath.split('/');
    parts.pop();
    return parts.join('/');
  }

  private moduleMatches(
    candidateFilePath: string,
    moduleSpecifier: string,
    sourceFilePath: string
  ): boolean {
    if (!moduleSpecifier.startsWith('.')) {
      // Non-relative import - check if the file path contains the module name
      return candidateFilePath.includes(moduleSpecifier.replace(/\//g, '/'));
    }

    // Relative import - resolve the path
    const sourceDir = this.getDirectory(sourceFilePath);
    const resolvedPath = this.resolvePath(sourceDir, moduleSpecifier);

    // Check if candidate path matches (with or without extension)
    const candidateWithoutExt = candidateFilePath.replace(/\.[^/.]+$/, '');
    const resolvedWithoutExt = resolvedPath.replace(/\.[^/.]+$/, '');

    return (
      candidateFilePath === resolvedPath ||
      candidateWithoutExt === resolvedWithoutExt ||
      candidateFilePath.startsWith(resolvedPath + '/') ||
      candidateWithoutExt.startsWith(resolvedWithoutExt + '/')
    );
  }

  private resolvePath(baseDir: string, relativePath: string): string {
    const parts = baseDir.split('/').filter((p) => p);
    const relParts = relativePath.split('/').filter((p) => p);

    for (const part of relParts) {
      if (part === '.') {
        continue;
      } else if (part === '..') {
        parts.pop();
      } else {
        parts.push(part);
      }
    }

    return parts.join('/');
  }

  private isCompatibleType(nodeType: string, edgeType: string): boolean {
    // Define compatibility rules
    const compatibilityMap: Record<string, string[]> = {
      calls: ['function', 'method', 'endpoint'],
      uses: ['variable', 'class', 'interface', 'function', 'method'],
      extends: ['class', 'interface'],
      implements: ['interface'],
      imports: ['module', 'file', 'class', 'function', 'variable'],
      autowires: ['class', 'interface', 'service', 'repository', 'component', 'controller'],
      injects: ['class', 'interface', 'service', 'repository', 'component', 'controller'],
    };

    const compatible = compatibilityMap[edgeType];
    if (!compatible) return true; // Unknown edge type - allow any

    return compatible.includes(nodeType);
  }

  private addToIndex(key: string, entry: SymbolEntry): void {
    const existing = this.symbolIndex.get(key) || [];
    // Avoid duplicates
    if (!existing.some((e) => e.nodeId === entry.nodeId)) {
      existing.push(entry);
      this.symbolIndex.set(key, existing);
    }
  }

  private log(message: string): void {
    if (this.verbose) {
      console.log(`[Resolver] ${message}`);
    }
  }
}
