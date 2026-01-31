import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import type { GraphNode, GraphEdge, FileHash, ProjectConfig } from '../types.js';

export class GraphDatabase {
  private db: Database.Database;
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    const dbPath = path.join(projectRoot, '.code-graph', 'graph.db');

    // Ensure directory exists
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    // Disable foreign key constraints to allow unresolved references
    this.db.pragma('foreign_keys = OFF');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS nodes (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        line_start INTEGER NOT NULL,
        line_end INTEGER NOT NULL,
        language TEXT NOT NULL,
        metadata TEXT DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS edges (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        type TEXT NOT NULL,
        metadata TEXT DEFAULT '{}',
        FOREIGN KEY (source_id) REFERENCES nodes(id) ON DELETE CASCADE,
        FOREIGN KEY (target_id) REFERENCES nodes(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS file_hashes (
        path TEXT PRIMARY KEY,
        hash TEXT NOT NULL,
        last_modified INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_nodes_file ON nodes(file_path);
      CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);
      CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name);
      CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
      CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);
      CREATE INDEX IF NOT EXISTS idx_edges_type ON edges(type);
    `);
  }

  // Node operations
  insertNode(node: GraphNode): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO nodes (id, type, name, file_path, line_start, line_end, language, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      node.id,
      node.type,
      node.name,
      node.filePath,
      node.lineStart,
      node.lineEnd,
      node.language,
      JSON.stringify(node.metadata)
    );
  }

  insertNodes(nodes: GraphNode[]): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO nodes (id, type, name, file_path, line_start, line_end, language, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertMany = this.db.transaction((nodes: GraphNode[]) => {
      for (const node of nodes) {
        stmt.run(
          node.id,
          node.type,
          node.name,
          node.filePath,
          node.lineStart,
          node.lineEnd,
          node.language,
          JSON.stringify(node.metadata)
        );
      }
    });
    insertMany(nodes);
  }

  getNode(id: string): GraphNode | null {
    const stmt = this.db.prepare('SELECT * FROM nodes WHERE id = ?');
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToNode(row) : null;
  }

  getNodesByFile(filePath: string): GraphNode[] {
    const stmt = this.db.prepare('SELECT * FROM nodes WHERE file_path = ?');
    const rows = stmt.all(filePath) as Record<string, unknown>[];
    return rows.map((row) => this.rowToNode(row));
  }

  getNodesByType(type: string): GraphNode[] {
    const stmt = this.db.prepare('SELECT * FROM nodes WHERE type = ?');
    const rows = stmt.all(type) as Record<string, unknown>[];
    return rows.map((row) => this.rowToNode(row));
  }

  searchNodes(query: string): GraphNode[] {
    const stmt = this.db.prepare(
      'SELECT * FROM nodes WHERE name LIKE ? ORDER BY name LIMIT 100'
    );
    const rows = stmt.all(`%${query}%`) as Record<string, unknown>[];
    return rows.map((row) => this.rowToNode(row));
  }

  deleteNodesByFile(filePath: string): void {
    // First delete edges connected to nodes in this file
    const nodeIds = this.db
      .prepare('SELECT id FROM nodes WHERE file_path = ?')
      .all(filePath) as { id: string }[];

    if (nodeIds.length > 0) {
      const ids = nodeIds.map((n) => n.id);
      const placeholders = ids.map(() => '?').join(',');
      this.db
        .prepare(
          `DELETE FROM edges WHERE source_id IN (${placeholders}) OR target_id IN (${placeholders})`
        )
        .run(...ids, ...ids);
    }

    // Then delete nodes
    this.db.prepare('DELETE FROM nodes WHERE file_path = ?').run(filePath);
  }

  // Edge operations
  insertEdge(edge: GraphEdge): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO edges (id, source_id, target_id, type, metadata)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(
      edge.id,
      edge.sourceId,
      edge.targetId,
      edge.type,
      JSON.stringify(edge.metadata)
    );
  }

  insertEdges(edges: GraphEdge[]): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO edges (id, source_id, target_id, type, metadata)
      VALUES (?, ?, ?, ?, ?)
    `);
    const insertMany = this.db.transaction((edges: GraphEdge[]) => {
      for (const edge of edges) {
        stmt.run(
          edge.id,
          edge.sourceId,
          edge.targetId,
          edge.type,
          JSON.stringify(edge.metadata)
        );
      }
    });
    insertMany(edges);
  }

  getEdgesFrom(nodeId: string): GraphEdge[] {
    const stmt = this.db.prepare('SELECT * FROM edges WHERE source_id = ?');
    const rows = stmt.all(nodeId) as Record<string, unknown>[];
    return rows.map((row) => this.rowToEdge(row));
  }

  getEdgesTo(nodeId: string): GraphEdge[] {
    const stmt = this.db.prepare('SELECT * FROM edges WHERE target_id = ?');
    const rows = stmt.all(nodeId) as Record<string, unknown>[];
    return rows.map((row) => this.rowToEdge(row));
  }

  // Methods for reference resolution
  getAllNodes(): GraphNode[] {
    const stmt = this.db.prepare('SELECT * FROM nodes');
    const rows = stmt.all() as Record<string, unknown>[];
    return rows.map((row) => this.rowToNode(row));
  }

  getUnresolvedEdges(): GraphEdge[] {
    const stmt = this.db.prepare(
      "SELECT * FROM edges WHERE target_id LIKE 'ref:%' OR json_extract(metadata, '$.unresolved') = true"
    );
    const rows = stmt.all() as Record<string, unknown>[];
    return rows.map((row) => this.rowToEdge(row));
  }

  updateEdgeTarget(edgeId: string, newTargetId: string, unresolved: boolean): void {
    const edge = this.db.prepare('SELECT * FROM edges WHERE id = ?').get(edgeId) as Record<string, unknown> | undefined;
    if (!edge) return;

    const metadata = JSON.parse((edge.metadata as string) || '{}');
    metadata.unresolved = unresolved;
    if (!unresolved) {
      metadata.resolvedFrom = edge.target_id; // Keep original for reference
    }

    this.db.prepare(
      'UPDATE edges SET target_id = ?, metadata = ? WHERE id = ?'
    ).run(newTargetId, JSON.stringify(metadata), edgeId);
  }

  updateEdgeMetadata(edgeId: string, metadata: Record<string, unknown>): void {
    this.db.prepare(
      'UPDATE edges SET metadata = ? WHERE id = ?'
    ).run(JSON.stringify(metadata), edgeId);
  }

  getResolvedCallersOf(nodeId: string): GraphNode[] {
    // Get edges where this node is the resolved target and edge type is 'calls'
    const stmt = this.db.prepare(`
      SELECT DISTINCT n.* FROM nodes n
      INNER JOIN edges e ON n.id = e.source_id
      WHERE e.target_id = ? AND e.type = 'calls'
    `);
    const rows = stmt.all(nodeId) as Record<string, unknown>[];
    return rows.map((row) => this.rowToNode(row));
  }

  getResolvedCalleesOf(nodeId: string): GraphNode[] {
    // Get edges where this node is the source and target is resolved
    const stmt = this.db.prepare(`
      SELECT DISTINCT n.* FROM nodes n
      INNER JOIN edges e ON n.id = e.target_id
      WHERE e.source_id = ? AND e.type = 'calls' AND e.target_id NOT LIKE 'ref:%'
    `);
    const rows = stmt.all(nodeId) as Record<string, unknown>[];
    return rows.map((row) => this.rowToNode(row));
  }

  getResolutionStats(): { total: number; resolved: number; unresolved: number } {
    const total = (this.db.prepare('SELECT COUNT(*) as count FROM edges').get() as { count: number }).count;
    const unresolved = (this.db.prepare(
      "SELECT COUNT(*) as count FROM edges WHERE target_id LIKE 'ref:%'"
    ).get() as { count: number }).count;

    return {
      total,
      resolved: total - unresolved,
      unresolved,
    };
  }

  // File hash operations
  getFileHash(path: string): FileHash | null {
    const stmt = this.db.prepare('SELECT * FROM file_hashes WHERE path = ?');
    const row = stmt.get(path) as Record<string, unknown> | undefined;
    return row
      ? {
          path: row.path as string,
          hash: row.hash as string,
          lastModified: row.last_modified as number,
        }
      : null;
  }

  setFileHash(fileHash: FileHash): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO file_hashes (path, hash, last_modified)
      VALUES (?, ?, ?)
    `);
    stmt.run(fileHash.path, fileHash.hash, fileHash.lastModified);
  }

  deleteFileHash(path: string): void {
    this.db.prepare('DELETE FROM file_hashes WHERE path = ?').run(path);
  }

  getAllFileHashes(): FileHash[] {
    const rows = this.db
      .prepare('SELECT * FROM file_hashes')
      .all() as Record<string, unknown>[];
    return rows.map((row) => ({
      path: row.path as string,
      hash: row.hash as string,
      lastModified: row.last_modified as number,
    }));
  }

  // Config operations
  getConfig(): ProjectConfig | null {
    const stmt = this.db.prepare("SELECT value FROM config WHERE key = 'project'");
    const row = stmt.get() as { value: string } | undefined;
    return row ? JSON.parse(row.value) : null;
  }

  setConfig(config: ProjectConfig): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO config (key, value) VALUES ('project', ?)
    `);
    stmt.run(JSON.stringify(config));
  }

  // Query operations
  getFileContext(filePath: string): {
    nodes: GraphNode[];
    incomingEdges: GraphEdge[];
    outgoingEdges: GraphEdge[];
  } {
    const nodes = this.getNodesByFile(filePath);
    const nodeIds = nodes.map((n) => n.id);

    if (nodeIds.length === 0) {
      return { nodes: [], incomingEdges: [], outgoingEdges: [] };
    }

    const placeholders = nodeIds.map(() => '?').join(',');

    const incomingEdges = this.db
      .prepare(
        `SELECT * FROM edges WHERE target_id IN (${placeholders}) AND source_id NOT IN (${placeholders})`
      )
      .all(...nodeIds, ...nodeIds) as Record<string, unknown>[];

    const outgoingEdges = this.db
      .prepare(
        `SELECT * FROM edges WHERE source_id IN (${placeholders}) AND target_id NOT IN (${placeholders})`
      )
      .all(...nodeIds, ...nodeIds) as Record<string, unknown>[];

    return {
      nodes,
      incomingEdges: incomingEdges.map((row) => this.rowToEdge(row)),
      outgoingEdges: outgoingEdges.map((row) => this.rowToEdge(row)),
    };
  }

  findReferences(symbolName: string): { node: GraphNode; edges: GraphEdge[] }[] {
    const nodes = this.searchNodes(symbolName);
    return nodes.map((node) => ({
      node,
      edges: [...this.getEdgesFrom(node.id), ...this.getEdgesTo(node.id)],
    }));
  }

  getCallGraph(
    functionId: string
  ): { callers: GraphNode[]; callees: GraphNode[] } {
    const callersEdges = this.db
      .prepare(
        "SELECT * FROM edges WHERE target_id = ? AND type IN ('calls', 'uses')"
      )
      .all(functionId) as Record<string, unknown>[];

    const calleesEdges = this.db
      .prepare(
        "SELECT * FROM edges WHERE source_id = ? AND type IN ('calls', 'uses')"
      )
      .all(functionId) as Record<string, unknown>[];

    const callerIds = callersEdges.map(
      (e) => (e as Record<string, string>).source_id
    );
    const calleeIds = calleesEdges.map(
      (e) => (e as Record<string, string>).target_id
    );

    const callers =
      callerIds.length > 0
        ? (this.db
            .prepare(
              `SELECT * FROM nodes WHERE id IN (${callerIds.map(() => '?').join(',')})`
            )
            .all(...callerIds) as Record<string, unknown>[])
        : [];

    const callees =
      calleeIds.length > 0
        ? (this.db
            .prepare(
              `SELECT * FROM nodes WHERE id IN (${calleeIds.map(() => '?').join(',')})`
            )
            .all(...calleeIds) as Record<string, unknown>[])
        : [];

    return {
      callers: callers.map((row) => this.rowToNode(row)),
      callees: callees.map((row) => this.rowToNode(row)),
    };
  }

  getStats(): {
    totalNodes: number;
    totalEdges: number;
    nodesByType: Record<string, number>;
    nodesByLanguage: Record<string, number>;
  } {
    const totalNodes = (
      this.db.prepare('SELECT COUNT(*) as count FROM nodes').get() as {
        count: number;
      }
    ).count;

    const totalEdges = (
      this.db.prepare('SELECT COUNT(*) as count FROM edges').get() as {
        count: number;
      }
    ).count;

    const nodesByType: Record<string, number> = {};
    const typeRows = this.db
      .prepare('SELECT type, COUNT(*) as count FROM nodes GROUP BY type')
      .all() as { type: string; count: number }[];
    for (const row of typeRows) {
      nodesByType[row.type] = row.count;
    }

    const nodesByLanguage: Record<string, number> = {};
    const langRows = this.db
      .prepare('SELECT language, COUNT(*) as count FROM nodes GROUP BY language')
      .all() as { language: string; count: number }[];
    for (const row of langRows) {
      nodesByLanguage[row.language] = row.count;
    }

    return { totalNodes, totalEdges, nodesByType, nodesByLanguage };
  }

  // Helper methods
  private rowToNode(row: Record<string, unknown>): GraphNode {
    return {
      id: row.id as string,
      type: row.type as GraphNode['type'],
      name: row.name as string,
      filePath: row.file_path as string,
      lineStart: row.line_start as number,
      lineEnd: row.line_end as number,
      language: row.language as GraphNode['language'],
      metadata: JSON.parse((row.metadata as string) || '{}'),
    };
  }

  private rowToEdge(row: Record<string, unknown>): GraphEdge {
    return {
      id: row.id as string,
      sourceId: row.source_id as string,
      targetId: row.target_id as string,
      type: row.type as GraphEdge['type'],
      metadata: JSON.parse((row.metadata as string) || '{}'),
    };
  }

  close(): void {
    this.db.close();
  }
}
