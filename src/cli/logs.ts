import fs from 'fs';
import path from 'path';
import { summarizeLogs, McpLogEntry } from '../utils/mcp-logger.js';

export async function logsCommand(
  action: string,
  options: { date?: string; tail?: string; json?: boolean }
): Promise<void> {
  const logDir = path.join(process.env.HOME || '/tmp', '.code-graph', 'logs');

  if (!fs.existsSync(logDir)) {
    console.log('No logs found. Enable logging with CODE_GRAPH_LOG=true');
    console.log('\nTo enable logging, update your Claude Desktop config:');
    console.log(JSON.stringify({
      mcpServers: {
        'code-graph': {
          command: 'code-graph',
          args: ['serve', '--mcp'],
          env: {
            CODE_GRAPH_LOG: 'true',
            CODE_GRAPH_LOG_CONSOLE: 'true'
          }
        }
      }
    }, null, 2));
    return;
  }

  switch (action) {
    case 'list': {
      const files = fs.readdirSync(logDir).filter((f) => f.endsWith('.jsonl'));
      if (files.length === 0) {
        console.log('No log files found.');
        return;
      }
      console.log('Log files:');
      for (const file of files.sort().reverse()) {
        const stats = fs.statSync(path.join(logDir, file));
        const size = (stats.size / 1024).toFixed(1);
        console.log(`  ${file} (${size} KB)`);
      }
      break;
    }

    case 'summary': {
      const date = options.date || new Date().toISOString().split('T')[0];
      const logPath = path.join(logDir, `mcp-${date}.jsonl`);

      if (!fs.existsSync(logPath)) {
        console.log(`No logs found for ${date}`);
        return;
      }

      const summary = summarizeLogs(logPath);

      if (options.json) {
        console.log(JSON.stringify(summary, null, 2));
        return;
      }

      console.log(`\nMCP Log Summary for ${date}`);
      console.log('='.repeat(40));
      console.log(`Total Requests: ${summary.totalRequests}`);
      console.log(`Total Tokens (est): ${summary.totalTokens.toLocaleString()}`);
      console.log(`Errors: ${summary.errors.length}`);

      console.log('\nBy Tool:');
      console.log('-'.repeat(40));
      for (const [tool, stats] of Object.entries(summary.byTool)) {
        console.log(
          `  ${tool}: ${stats.count} calls, ~${stats.tokens.toLocaleString()} tokens, avg ${stats.avgDuration}ms`
        );
      }

      if (summary.errors.length > 0) {
        console.log('\nRecent Errors:');
        console.log('-'.repeat(40));
        for (const error of summary.errors.slice(-5)) {
          console.log(`  [${error.timestamp}] ${error.tool}: ${error.error}`);
        }
      }
      break;
    }

    case 'tail': {
      const date = options.date || new Date().toISOString().split('T')[0];
      const logPath = path.join(logDir, `mcp-${date}.jsonl`);

      if (!fs.existsSync(logPath)) {
        console.log(`No logs found for ${date}`);
        return;
      }

      const content = fs.readFileSync(logPath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      const count = parseInt(options.tail || '10', 10);
      const recentLines = lines.slice(-count);

      for (const line of recentLines) {
        const entry: McpLogEntry = JSON.parse(line);
        const time = entry.timestamp.split('T')[1].split('.')[0];

        if (entry.type === 'request') {
          console.log(`\n[${time}] → ${entry.tool}`);
          if (entry.arguments && Object.keys(entry.arguments).length > 0) {
            console.log(`  Args: ${JSON.stringify(entry.arguments)}`);
          }
        } else {
          const status = entry.error ? `ERROR: ${entry.error}` : 'OK';
          console.log(
            `[${time}] ← ${entry.tool} (${entry.durationMs}ms, ~${entry.tokenEstimate} tokens) ${status}`
          );
        }
      }
      break;
    }

    case 'clear': {
      const files = fs.readdirSync(logDir).filter((f) => f.endsWith('.jsonl'));
      for (const file of files) {
        fs.unlinkSync(path.join(logDir, file));
      }
      console.log(`Cleared ${files.length} log file(s)`);
      break;
    }

    case 'path': {
      const date = options.date || new Date().toISOString().split('T')[0];
      const logPath = path.join(logDir, `mcp-${date}.jsonl`);
      console.log(logPath);
      break;
    }

    default:
      console.log('Usage: code-graph logs <action>');
      console.log('\nActions:');
      console.log('  list              List all log files');
      console.log('  summary           Show summary of today\'s logs');
      console.log('  tail              Show recent log entries');
      console.log('  clear             Delete all log files');
      console.log('  path              Print path to today\'s log file');
      console.log('\nOptions:');
      console.log('  --date <YYYY-MM-DD>  Specify date for summary/tail');
      console.log('  --tail <n>           Number of entries for tail (default: 10)');
      console.log('  --json               Output as JSON (for summary)');
      console.log('\nTo enable logging, set environment variables:');
      console.log('  CODE_GRAPH_LOG=true          Enable logging to file');
      console.log('  CODE_GRAPH_LOG_CONSOLE=true  Also log to stderr');
  }
}
