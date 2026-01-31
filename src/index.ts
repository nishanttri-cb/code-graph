#!/usr/bin/env node

import { Command } from 'commander';
import { initCommand } from './cli/init.js';
import { syncCommand } from './cli/sync.js';
import { updateCommand } from './cli/update.js';
import { queryCommand } from './cli/query.js';
import { serveCommand } from './cli/serve.js';
import { watchCommand } from './watcher/index.js';
import { resolveCommand } from './cli/resolve.js';

const program = new Command();

program
  .name('code-graph')
  .description('Local code graph builder with MCP integration')
  .version('1.0.0');

program
  .command('init')
  .description('Initialize code-graph in the current project')
  .option('-f, --force', 'Force reinitialization')
  .action(initCommand);

program
  .command('sync')
  .description('Sync the code graph with the current state of the project')
  .option('-q, --quiet', 'Suppress output')
  .option('--full', 'Force full rescan (ignore file hashes)')
  .option('--skip-resolve', 'Skip the reference resolution phase')
  .action(syncCommand);

program
  .command('update')
  .description('Update specific files in the graph')
  .option('--files <files>', 'Newline-separated list of files to update')
  .option('--file <file>', 'Single file to update')
  .action(updateCommand);

program
  .command('query <type> [args...]')
  .description(
    'Query the code graph (types: stats, file, search, refs, callers, callees, type)'
  )
  .option('--json', 'Output as JSON')
  .action(queryCommand);

program
  .command('serve')
  .description('Start the MCP server')
  .option('--mcp', 'Run in MCP mode (stdio transport)')
  .action(serveCommand);

program
  .command('watch')
  .description('Watch for file changes and update the graph')
  .option('-q, --quiet', 'Suppress output')
  .action(watchCommand);

program
  .command('resolve')
  .description('Resolve cross-file references (run after sync)')
  .option('-q, --quiet', 'Suppress output')
  .action(resolveCommand);

program
  .command('status')
  .description('Show the current graph status')
  .action(async () => {
    await queryCommand('stats', [], { json: false });
  });

program.parse();
