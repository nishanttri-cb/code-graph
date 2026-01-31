export type NodeType =
  | 'file'
  | 'class'
  | 'interface'
  | 'function'
  | 'method'
  | 'variable'
  | 'import'
  | 'export'
  | 'module'
  // Spring Boot specific
  | 'controller'
  | 'service'
  | 'repository'
  | 'component'
  | 'bean'
  | 'endpoint';

export type EdgeType =
  | 'contains'
  | 'calls'
  | 'imports'
  | 'exports'
  | 'extends'
  | 'implements'
  | 'uses'
  | 'injects'
  | 'returns'
  | 'parameter_of'
  // Spring Boot specific
  | 'maps_to'
  | 'autowires';

export interface GraphNode {
  id: string;
  type: NodeType;
  name: string;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  language: 'typescript' | 'javascript' | 'python' | 'java';
  metadata: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  type: EdgeType;
  metadata: Record<string, unknown>;
}

export interface ParseResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface FileHash {
  path: string;
  hash: string;
  lastModified: number;
}

export interface ProjectConfig {
  languages: ('typescript' | 'javascript' | 'python' | 'java')[];
  include: string[];
  exclude: string[];
  autoSync: boolean;
}

export const DEFAULT_CONFIG: ProjectConfig = {
  languages: ['typescript', 'javascript', 'python', 'java'],
  include: ['src/**', 'lib/**', 'app/**', 'main/**'],
  exclude: [
    'node_modules/**',
    'dist/**',
    'build/**',
    'target/**',
    '.git/**',
    '__pycache__/**',
    '*.test.*',
    '*.spec.*',
    '.venv/**',
    'venv/**',
  ],
  autoSync: true,
};
