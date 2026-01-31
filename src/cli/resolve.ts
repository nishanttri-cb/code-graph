import fs from 'fs';
import path from 'path';
import { GraphDatabase } from '../db/schema.js';
import { ReferenceResolver } from '../resolver/index.js';

export async function resolveCommand(options: {
  quiet?: boolean;
}): Promise<void> {
  const projectRoot = process.cwd();
  const configPath = path.join(projectRoot, '.code-graph', 'config.json');

  if (!fs.existsSync(configPath)) {
    console.error('Project not initialized. Run "code-graph init" first.');
    process.exit(1);
  }

  const db = new GraphDatabase(projectRoot);
  const log = options.quiet ? () => {} : console.log;

  // Get stats before resolution
  const beforeStats = db.getResolutionStats();
  log(`Before resolution: ${beforeStats.resolved}/${beforeStats.total} edges resolved`);

  // Run resolution
  log('\nResolving cross-file references...');
  const resolver = new ReferenceResolver(db, !options.quiet);
  const result = await resolver.resolve();

  // Get stats after resolution
  const afterStats = db.getResolutionStats();

  log('\nResolution complete!');
  log(`  Newly resolved: ${result.resolved}`);
  log(`  Ambiguous: ${result.ambiguous}`);
  log(`  Still unresolved: ${result.unresolved}`);
  log(`  Total resolved edges: ${afterStats.resolved}/${afterStats.total}`);

  db.close();
}
