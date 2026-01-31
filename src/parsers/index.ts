import { BaseParser } from './base.js';
import { TypeScriptParser } from './typescript.js';
import { PythonParser } from './python.js';
import { JavaParser } from './java.js';
import type { ParseResult, GraphNode } from '../types.js';

export class ParserManager {
  private parsers: BaseParser[];
  private extensionMap: Map<string, BaseParser>;

  constructor() {
    this.parsers = [
      new TypeScriptParser(),
      new PythonParser(),
      new JavaParser(),
    ];

    this.extensionMap = new Map();
    for (const parser of this.parsers) {
      for (const ext of parser.getFileExtensions()) {
        this.extensionMap.set(ext, parser);
      }
    }
  }

  getParserForFile(filePath: string): BaseParser | null {
    const ext = this.getFileExtension(filePath);
    return this.extensionMap.get(ext) || null;
  }

  parse(filePath: string, content: string): ParseResult | null {
    const parser = this.getParserForFile(filePath);
    if (!parser) return null;

    try {
      return parser.parse(filePath, content);
    } catch (error) {
      console.error(`Error parsing ${filePath}:`, error);
      return null;
    }
  }

  getSupportedExtensions(): string[] {
    return Array.from(this.extensionMap.keys());
  }

  canParse(filePath: string): boolean {
    return this.getParserForFile(filePath) !== null;
  }

  getLanguageForFile(filePath: string): GraphNode['language'] | null {
    const ext = this.getFileExtension(filePath);

    if (['.ts', '.tsx'].includes(ext)) return 'typescript';
    if (['.js', '.jsx', '.mjs', '.cjs'].includes(ext)) return 'javascript';
    if (ext === '.py') return 'python';
    if (ext === '.java') return 'java';

    return null;
  }

  private getFileExtension(filePath: string): string {
    const match = filePath.match(/\.[^.]+$/);
    return match ? match[0] : '';
  }
}

export { BaseParser } from './base.js';
export { TypeScriptParser } from './typescript.js';
export { PythonParser } from './python.js';
export { JavaParser } from './java.js';
