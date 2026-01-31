import type { ParseResult, GraphNode, GraphEdge } from '../types.js';
import crypto from 'crypto';

export abstract class BaseParser {
  protected language: GraphNode['language'];

  constructor(language: GraphNode['language']) {
    this.language = language;
  }

  abstract parse(filePath: string, content: string): ParseResult;

  abstract getFileExtensions(): string[];

  protected generateNodeId(
    filePath: string,
    type: string,
    name: string,
    line: number
  ): string {
    const hash = crypto
      .createHash('md5')
      .update(`${filePath}:${type}:${name}:${line}`)
      .digest('hex')
      .substring(0, 12);
    return `${type}_${hash}`;
  }

  protected generateEdgeId(
    sourceId: string,
    targetId: string,
    type: string
  ): string {
    const hash = crypto
      .createHash('md5')
      .update(`${sourceId}:${targetId}:${type}`)
      .digest('hex')
      .substring(0, 12);
    return `edge_${hash}`;
  }

  protected createNode(
    filePath: string,
    type: GraphNode['type'],
    name: string,
    lineStart: number,
    lineEnd: number,
    metadata: Record<string, unknown> = {}
  ): GraphNode {
    return {
      id: this.generateNodeId(filePath, type, name, lineStart),
      type,
      name,
      filePath,
      lineStart,
      lineEnd,
      language: this.language,
      metadata,
    };
  }

  protected createEdge(
    sourceId: string,
    targetId: string,
    type: GraphEdge['type'],
    metadata: Record<string, unknown> = {}
  ): GraphEdge {
    return {
      id: this.generateEdgeId(sourceId, targetId, type),
      sourceId,
      targetId,
      type,
      metadata,
    };
  }
}
