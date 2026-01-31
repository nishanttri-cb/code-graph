import fs from 'fs';

export interface SourceReadResult {
  code: string;
  contextBefore?: string;
  contextAfter?: string;
  staleWarning?: string;
}

/**
 * Read specific lines from a source file
 * @param filePath - Absolute path to the file
 * @param startLine - 1-based starting line number
 * @param endLine - 1-based ending line number
 * @param contextLinesBefore - Number of lines to include before startLine
 * @param contextLinesAfter - Number of lines to include after endLine
 */
export function readSourceLines(
  filePath: string,
  startLine: number,
  endLine: number,
  contextLinesBefore = 0,
  contextLinesAfter = 0
): SourceReadResult {
  // Check if file exists
  if (!fs.existsSync(filePath)) {
    return {
      code: '',
      staleWarning: `File not found: ${filePath}. It may have been moved or deleted since the last sync.`,
    };
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const totalLines = lines.length;

    // Validate line numbers (1-based)
    if (startLine < 1 || endLine < 1) {
      return {
        code: '',
        staleWarning: 'Invalid line numbers: must be >= 1',
      };
    }

    // Check if lines are within file bounds
    let staleWarning: string | undefined;
    if (startLine > totalLines || endLine > totalLines) {
      staleWarning = `File has ${totalLines} lines but requested lines ${startLine}-${endLine}. File may have changed since last sync.`;
      // Adjust to available lines
      startLine = Math.min(startLine, totalLines);
      endLine = Math.min(endLine, totalLines);
    }

    // Convert to 0-based indices
    const startIdx = startLine - 1;
    const endIdx = endLine - 1;

    // Calculate context ranges
    const contextBeforeStart = Math.max(0, startIdx - contextLinesBefore);
    const contextAfterEnd = Math.min(totalLines - 1, endIdx + contextLinesAfter);

    // Extract code and context
    const code = lines.slice(startIdx, endIdx + 1).join('\n');

    const contextBefore =
      contextLinesBefore > 0 && contextBeforeStart < startIdx
        ? lines.slice(contextBeforeStart, startIdx).join('\n')
        : undefined;

    const contextAfter =
      contextLinesAfter > 0 && contextAfterEnd > endIdx
        ? lines.slice(endIdx + 1, contextAfterEnd + 1).join('\n')
        : undefined;

    return {
      code,
      contextBefore,
      contextAfter,
      staleWarning,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      code: '',
      staleWarning: `Error reading file: ${message}`,
    };
  }
}

/**
 * Read an entire file's content
 */
export function readFileContent(filePath: string): {
  content: string;
  error?: string;
} {
  if (!fs.existsSync(filePath)) {
    return {
      content: '',
      error: `File not found: ${filePath}`,
    };
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return { content };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: '',
      error: `Error reading file: ${message}`,
    };
  }
}

/**
 * Check if a file is a text file (not binary)
 */
export function isTextFile(filePath: string): boolean {
  try {
    const buffer = Buffer.alloc(512);
    const fd = fs.openSync(filePath, 'r');
    const bytesRead = fs.readSync(fd, buffer, 0, 512, 0);
    fs.closeSync(fd);

    // Check for null bytes which indicate binary content
    for (let i = 0; i < bytesRead; i++) {
      if (buffer[i] === 0) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}
