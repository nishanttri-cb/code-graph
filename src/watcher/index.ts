import fs from 'fs';
import path from 'path';
import chokidar from 'chokidar';
import crypto from 'crypto';
import { GraphDatabase } from '../db/schema.js';
import { ParserManager } from '../parsers/index.js';
import type { ProjectConfig, FileHash } from '../types.js';

export async function watchCommand(options: { quiet?: boolean }): Promise<void> {
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

  // Build watch patterns
  const extensions = parser.getSupportedExtensions();
  const watchPatterns = extensions.map((ext) => `**/*${ext}`);

  log('Starting file watcher...');
  log(`Watching for: ${extensions.join(', ')}`);

  const watcher = chokidar.watch(watchPatterns, {
    cwd: projectRoot,
    ignored: config.exclude,
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 300,
      pollInterval: 100,
    },
  });

  // Debounce updates
  const pendingUpdates = new Map<string, NodeJS.Timeout>();
  const DEBOUNCE_MS = 500;

  const processFile = (filePath: string, eventType: 'add' | 'change' | 'unlink') => {
    const relativePath = path.relative(projectRoot, filePath);
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.join(projectRoot, filePath);

    // Clear pending update for this file
    const existing = pendingUpdates.get(relativePath);
    if (existing) {
      clearTimeout(existing);
    }

    // Debounce the update
    const timeout = setTimeout(() => {
      pendingUpdates.delete(relativePath);

      if (eventType === 'unlink') {
        log(`Removed: ${relativePath}`);
        db.deleteNodesByFile(relativePath);
        db.deleteFileHash(relativePath);
        return;
      }

      if (!fs.existsSync(absolutePath)) {
        return;
      }

      try {
        const content = fs.readFileSync(absolutePath, 'utf-8');
        const hash = crypto.createHash('md5').update(content).digest('hex');
        const stats = fs.statSync(absolutePath);

        // Check if file actually changed
        const storedHash = db.getFileHash(relativePath);
        if (storedHash && storedHash.hash === hash) {
          return; // No change
        }

        // Parse the file
        const result = parser.parse(relativePath, content);
        if (!result) {
          log(`Skipped (unsupported): ${relativePath}`);
          return;
        }

        // Delete existing nodes/edges for this file
        db.deleteNodesByFile(relativePath);

        // Insert new nodes and edges
        db.insertNodes(result.nodes);
        db.insertEdges(result.edges);

        // Update file hash
        const fileHash: FileHash = {
          path: relativePath,
          hash,
          lastModified: stats.mtimeMs,
        };
        db.setFileHash(fileHash);

        log(
          `${eventType === 'add' ? 'Added' : 'Updated'}: ${relativePath} (${result.nodes.length} nodes)`
        );
      } catch (error) {
        console.error(`Error processing ${relativePath}:`, error);
      }
    }, DEBOUNCE_MS);

    pendingUpdates.set(relativePath, timeout);
  };

  watcher
    .on('add', (filePath) => processFile(filePath, 'add'))
    .on('change', (filePath) => processFile(filePath, 'change'))
    .on('unlink', (filePath) => processFile(filePath, 'unlink'))
    .on('error', (error) => console.error('Watcher error:', error))
    .on('ready', () => {
      log('Watcher ready. Listening for changes...');
      log('Press Ctrl+C to stop.');
    });

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    log('\nStopping watcher...');
    watcher.close().then(() => {
      db.close();
      process.exit(0);
    });
  });

  process.on('SIGTERM', () => {
    watcher.close().then(() => {
      db.close();
      process.exit(0);
    });
  });

  // Keep the process running
  await new Promise(() => {});
}
