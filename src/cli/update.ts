import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { GraphDatabase } from '../db/schema.js';
import { ParserManager } from '../parsers/index.js';
import type { FileHash } from '../types.js';

export async function updateCommand(options: {
  files?: string;
  file?: string;
}): Promise<void> {
  const projectRoot = process.cwd();
  const configPath = path.join(projectRoot, '.code-graph', 'config.json');

  if (!fs.existsSync(configPath)) {
    // Silently exit if not initialized (for hooks)
    return;
  }

  const db = new GraphDatabase(projectRoot);
  const parser = new ParserManager();

  // Collect files to update
  let filesToUpdate: string[] = [];

  if (options.file) {
    filesToUpdate = [options.file];
  } else if (options.files) {
    filesToUpdate = options.files
      .split('\n')
      .map((f) => f.trim())
      .filter((f) => f);
  }

  // Filter to only parseable files
  filesToUpdate = filesToUpdate.filter((f) => {
    const absPath = path.isAbsolute(f) ? f : path.join(projectRoot, f);
    return parser.canParse(absPath);
  });

  if (filesToUpdate.length === 0) {
    db.close();
    return;
  }

  let updated = 0;
  let deleted = 0;

  for (const file of filesToUpdate) {
    const relativePath = path.isAbsolute(file)
      ? path.relative(projectRoot, file)
      : file;
    const absolutePath = path.isAbsolute(file)
      ? file
      : path.join(projectRoot, file);

    // Check if file was deleted
    if (!fs.existsSync(absolutePath)) {
      db.deleteNodesByFile(relativePath);
      db.deleteFileHash(relativePath);
      deleted++;
      continue;
    }

    try {
      const content = fs.readFileSync(absolutePath, 'utf-8');
      const hash = crypto.createHash('md5').update(content).digest('hex');
      const stats = fs.statSync(absolutePath);

      // Check if file actually changed
      const storedHash = db.getFileHash(relativePath);
      if (storedHash && storedHash.hash === hash) {
        continue; // No change
      }

      // Parse the file
      const result = parser.parse(relativePath, content);
      if (!result) continue;

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

      updated++;
    } catch (error) {
      console.error(`Error updating ${relativePath}:`, error);
    }
  }

  if (updated > 0 || deleted > 0) {
    console.log(`Updated: ${updated}, Deleted: ${deleted}`);
  }

  db.close();
}
