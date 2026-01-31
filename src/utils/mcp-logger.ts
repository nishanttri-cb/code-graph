import fs from 'fs';
import path from 'path';

export interface McpLogEntry {
  timestamp: string;
  type: 'request' | 'response';
  tool: string;
  arguments?: Record<string, unknown>;
  result?: unknown;
  tokenEstimate?: number;
  durationMs?: number;
  error?: string;
}

export class McpLogger {
  private logPath: string;
  private enabled: boolean;
  private logToConsole: boolean;

  constructor(options?: { logDir?: string; enabled?: boolean; logToConsole?: boolean }) {
    const logDir = options?.logDir || path.join(process.env.HOME || '/tmp', '.code-graph', 'logs');
    this.enabled = options?.enabled ?? (process.env.CODE_GRAPH_LOG === 'true');
    this.logToConsole = options?.logToConsole ?? (process.env.CODE_GRAPH_LOG_CONSOLE === 'true');

    // Create log directory if it doesn't exist
    if (this.enabled && !fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    // Log file named by date
    const date = new Date().toISOString().split('T')[0];
    this.logPath = path.join(logDir, `mcp-${date}.jsonl`);
  }

  logRequest(tool: string, args: Record<string, unknown>): { startTime: number } {
    const entry: McpLogEntry = {
      timestamp: new Date().toISOString(),
      type: 'request',
      tool,
      arguments: args,
    };

    this.write(entry);
    return { startTime: Date.now() };
  }

  logResponse(
    tool: string,
    result: unknown,
    startTime: number,
    error?: string
  ): void {
    const durationMs = Date.now() - startTime;
    const resultStr = JSON.stringify(result);
    const tokenEstimate = Math.ceil(resultStr.length / 4);

    const entry: McpLogEntry = {
      timestamp: new Date().toISOString(),
      type: 'response',
      tool,
      result: this.truncateResult(result),
      tokenEstimate,
      durationMs,
      error,
    };

    this.write(entry);

    // Also log a summary line
    if (this.logToConsole) {
      const status = error ? `ERROR: ${error}` : 'OK';
      console.error(
        `[MCP] ${tool} | ${durationMs}ms | ~${tokenEstimate} tokens | ${status}`
      );
    }
  }

  private truncateResult(result: unknown, maxLength = 2000): unknown {
    const str = JSON.stringify(result);
    if (str.length <= maxLength) {
      return result;
    }

    // Return a summary instead of the full result
    return {
      _truncated: true,
      _originalLength: str.length,
      _preview: str.slice(0, maxLength) + '...',
    };
  }

  private write(entry: McpLogEntry): void {
    if (!this.enabled) return;

    try {
      const line = JSON.stringify(entry) + '\n';
      fs.appendFileSync(this.logPath, line);
    } catch (err) {
      // Don't crash if logging fails
      console.error('[McpLogger] Failed to write log:', err);
    }
  }

  getLogPath(): string {
    return this.logPath;
  }

  isEnabled(): boolean {
    return this.enabled;
  }
}

/**
 * Parse and summarize MCP logs
 */
export function summarizeLogs(logPath: string): {
  totalRequests: number;
  totalTokens: number;
  byTool: Record<string, { count: number; tokens: number; avgDuration: number }>;
  errors: McpLogEntry[];
} {
  const content = fs.readFileSync(logPath, 'utf-8');
  const lines = content.trim().split('\n').filter(Boolean);
  const entries: McpLogEntry[] = lines.map((line) => JSON.parse(line));

  const responses = entries.filter((e) => e.type === 'response');
  const errors = responses.filter((e) => e.error);

  const byTool: Record<string, { count: number; tokens: number; totalDuration: number }> = {};

  for (const entry of responses) {
    const tool = entry.tool;
    if (!byTool[tool]) {
      byTool[tool] = { count: 0, tokens: 0, totalDuration: 0 };
    }
    byTool[tool].count++;
    byTool[tool].tokens += entry.tokenEstimate || 0;
    byTool[tool].totalDuration += entry.durationMs || 0;
  }

  const byToolSummary: Record<string, { count: number; tokens: number; avgDuration: number }> = {};
  for (const [tool, stats] of Object.entries(byTool)) {
    byToolSummary[tool] = {
      count: stats.count,
      tokens: stats.tokens,
      avgDuration: Math.round(stats.totalDuration / stats.count),
    };
  }

  return {
    totalRequests: responses.length,
    totalTokens: responses.reduce((sum, e) => sum + (e.tokenEstimate || 0), 0),
    byTool: byToolSummary,
    errors,
  };
}
