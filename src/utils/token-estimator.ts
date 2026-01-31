/**
 * Estimate the number of tokens in a text string.
 * Uses a simple approximation of ~4 characters per token.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Fit items within a token limit, using a priority function to determine order.
 *
 * @param items - Array of items to potentially include
 * @param maxTokens - Maximum tokens allowed
 * @param getContent - Function to extract text content from an item
 * @param getPriority - Function to get priority (higher = more important, included first)
 * @returns Subset of items that fit within the token limit
 */
export function fitWithinLimit<T>(
  items: T[],
  maxTokens: number,
  getContent: (item: T) => string,
  getPriority?: (item: T) => number
): T[] {
  // Sort by priority if provided (higher priority first)
  const sorted = getPriority
    ? [...items].sort((a, b) => getPriority(b) - getPriority(a))
    : items;

  const result: T[] = [];
  let currentTokens = 0;

  for (const item of sorted) {
    const content = getContent(item);
    const itemTokens = estimateTokens(content);

    if (currentTokens + itemTokens <= maxTokens) {
      result.push(item);
      currentTokens += itemTokens;
    }
  }

  return result;
}

/**
 * Truncate text to fit within a token limit, adding an indicator if truncated.
 */
export function truncateToTokenLimit(
  text: string,
  maxTokens: number,
  truncationIndicator = '\n... [truncated]'
): { text: string; wasTruncated: boolean } {
  const estimatedTokens = estimateTokens(text);

  if (estimatedTokens <= maxTokens) {
    return { text, wasTruncated: false };
  }

  // Calculate approximate character limit
  const indicatorTokens = estimateTokens(truncationIndicator);
  const availableTokens = maxTokens - indicatorTokens;
  const charLimit = availableTokens * 4;

  // Try to truncate at a line boundary
  let truncatedText = text.slice(0, charLimit);
  const lastNewline = truncatedText.lastIndexOf('\n');

  if (lastNewline > charLimit * 0.8) {
    truncatedText = truncatedText.slice(0, lastNewline);
  }

  return {
    text: truncatedText + truncationIndicator,
    wasTruncated: true,
  };
}
