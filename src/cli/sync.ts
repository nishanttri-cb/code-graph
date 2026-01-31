import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { glob } from 'glob';
import { GraphDatabase } from '../db/schema.js';
import { ParserManager } from '../parsers/index.js';
import { ReferenceResolver } from '../resolver/index.js';
import type { ProjectConfig, FileHash } from '../types.js';

export async function syncCommand(options: {
  quiet?: boolean;
  full?: boolean;
  skipResolve?: boolean;
}): Promise<void> {
  const projectRoot = process.cwd();
  const configPath = path.join(projectRoot, '.code-graph', 'config.json');

  if (!fs.existsSync(configPath)) {
    console.error('Project not initialized. Run "code-graph init" first.');
    process.exit(1);
  }

  const config: ProjectConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  const db = new GraphDatabase(projectRoot);
  const parser = new ParserManager();

  const log = options.quiet ? () => {} : console.log;

  log('Scanning project files...');

  // Get all source files
  const files = await getSourceFiles(projectRoot, config, parser);
  log(`Found ${files.length} source files`);

  // Get stored file hashes
  const storedHashes = new Map<string, FileHash>();
  if (!options.full) {
    for (const hash of db.getAllFileHashes()) {
      storedHashes.set(hash.path, hash);
    }
  }

  // Determine which files need updating
  const filesToProcess: string[] = [];
  const currentHashes = new Map<string, FileHash>();

  for (const file of files) {
    const relativePath = path.relative(projectRoot, file);
    const content = fs.readFileSync(file, 'utf-8');
    const hash = crypto.createHash('md5').update(content).digest('hex');
    const stats = fs.statSync(file);

    const fileHash: FileHash = {
      path: relativePath,
      hash,
      lastModified: stats.mtimeMs,
    };
    currentHashes.set(relativePath, fileHash);

    const storedHash = storedHashes.get(relativePath);
    if (!storedHash || storedHash.hash !== hash) {
      filesToProcess.push(file);
    }
  }

  // Find deleted files
  const deletedFiles = Array.from(storedHashes.keys()).filter(
    (p) => !currentHashes.has(p)
  );

  if (deletedFiles.length > 0) {
    log(`Removing ${deletedFiles.length} deleted files from graph...`);
    for (const deletedFile of deletedFiles) {
      db.deleteNodesByFile(deletedFile);
      db.deleteFileHash(deletedFile);
    }
  }

  if (filesToProcess.length === 0) {
    log('Graph is up to date.');
    db.close();
    return;
  }

  log(`Processing ${filesToProcess.length} files...`);

  let processed = 0;
  let errors = 0;

  for (const file of filesToProcess) {
    const relativePath = path.relative(projectRoot, file);

    try {
      const content = fs.readFileSync(file, 'utf-8');
      const result = parser.parse(relativePath, content);

      if (result) {
        // Delete existing nodes/edges for this file
        db.deleteNodesByFile(relativePath);

        // Insert new nodes and edges
        db.insertNodes(result.nodes);
        db.insertEdges(result.edges);

        // Update file hash
        const fileHash = currentHashes.get(relativePath);
        if (fileHash) {
          db.setFileHash(fileHash);
        }

        processed++;
      }
    } catch (error) {
      errors++;
      if (!options.quiet) {
        console.error(`Error processing ${relativePath}:`, error);
      }
    }

    // Progress indicator
    if (!options.quiet && processed % 50 === 0) {
      log(`  Processed ${processed}/${filesToProcess.length} files...`);
    }
  }

  // Phase 2: Resolve cross-file references
  if (!options.skipResolve) {
    log('\nResolving cross-file references...');
    const resolver = new ReferenceResolver(db, !options.quiet);
    const resolutionResult = await resolver.resolve();
    log(`  Resolved: ${resolutionResult.resolved}`);
    log(`  Ambiguous: ${resolutionResult.ambiguous}`);
    log(`  Unresolved: ${resolutionResult.unresolved}`);
  }

  // Print summary
  const stats = db.getStats();
  const resolutionStats = db.getResolutionStats();
  log('\nSync complete!');
  log(`  Files processed: ${processed}`);
  log(`  Errors: ${errors}`);
  log(`  Total nodes: ${stats.totalNodes}`);
  log(`  Total edges: ${stats.totalEdges}`);
  log(`  Resolved edges: ${resolutionStats.resolved}/${resolutionStats.total}`);
  log(`  By language: ${JSON.stringify(stats.nodesByLanguage)}`);

  db.close();
}

async function getSourceFiles(
  projectRoot: string,
  config: ProjectConfig,
  parser: ParserManager
): Promise<string[]> {
  const extensions = parser.getSupportedExtensions();
  const extPatterns = extensions.map((ext) => `**/*${ext}`);

  // Build include patterns
  let patterns: string[];
  if (config.include.length > 0) {
    patterns = [];
    for (const inc of config.include) {
      for (const ext of extensions) {
        // Handle patterns that already have extensions
        if (inc.includes('*')) {
          patterns.push(inc);
        } else {
          patterns.push(path.join(inc, `**/*${ext}`));
        }
      }
    }
  } else {
    patterns = extPatterns;
  }

  // Deduplicate patterns
  patterns = [...new Set(patterns)];

  const allFiles: string[] = [];

  for (const pattern of patterns) {
    const files = await glob(pattern, {
      cwd: projectRoot,
      absolute: true,
      ignore: config.exclude,
      nodir: true,
    });
    allFiles.push(...files);
  }

  // Deduplicate and filter by language
  const uniqueFiles = [...new Set(allFiles)].filter((file) => {
    const lang = parser.getLanguageForFile(file);
    return lang && config.languages.includes(lang);
  });

  return uniqueFiles;
}
