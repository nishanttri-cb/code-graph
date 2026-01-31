# Setting Up code-graph on a New Project

This guide walks you through setting up code-graph on a new project from scratch.

## Prerequisites

- Node.js 18+ installed
- code-graph installed globally (see [New Machine Setup](NEW_MACHINE.md) if not installed)

## Step 1: Navigate to Your Project

```bash
cd /path/to/your/project
```

## Step 2: Initialize code-graph

```bash
code-graph init
```

This creates:
```
your-project/
└── .code-graph/
    ├── config.json    # Project configuration
    └── graph.db       # SQLite database (created on first sync)
```

## Step 3: Configure (Optional)

Edit `.code-graph/config.json` to customize:

```json
{
  "languages": ["typescript", "javascript", "python", "java"],
  "include": ["src/**", "lib/**", "app/**"],
  "exclude": [
    "node_modules/**",
    "dist/**",
    "build/**",
    "target/**",
    "**/*.test.*",
    "**/*.spec.*"
  ],
  "autoSync": true
}
```

## Step 4: Build the Initial Graph

```bash
code-graph sync
```

This scans all supported files and builds the graph. You'll see output like:

```
Syncing code graph...
Parsing: src/index.ts
Parsing: src/lib/utils.ts
...
Resolving cross-file references...
✓ Sync complete: 150 nodes, 420 edges
  Resolution: 312/420 edges resolved (74%)
```

## Step 5: Verify the Graph

```bash
# Check statistics
code-graph query stats

# Search for a symbol
code-graph query search "MyClass"

# Get file context
code-graph query file src/index.ts
```

## Step 6: Set Up Automatic Updates (Recommended)

### Option A: Git Hooks (Recommended)

See [Git Hooks Setup](GIT_HOOKS.md) for detailed instructions.

Quick setup:
```bash
# Create post-commit hook
cat > .git/hooks/post-commit << 'EOF'
#!/bin/bash
code-graph update --files "$(git diff --name-only HEAD~1)"
EOF
chmod +x .git/hooks/post-commit
```

### Option B: File Watcher

Run in a terminal while developing:
```bash
code-graph watch
```

## Step 7: Use with Claude

Start Claude Code in your project directory:

```bash
claude
```

Claude now has access to these tools:
- `get_file_context` - Understand a file's dependencies before editing
- `search_symbols` - Find functions, classes, methods
- `get_call_graph` - See what calls a function and what it calls
- `get_impact_analysis` - Understand what might break if you change a file

### Example Prompts

- "What does the UserService class depend on?"
- "Show me all the REST endpoints in this project"
- "What files would be affected if I change the database schema?"
- "Find all functions that call validateInput"

## Step 8: Configure CLAUDE.md (Recommended)

Claude won't automatically use code-graph tools unless you ask for something relevant or explicitly request it. To make Claude use code-graph proactively, add instructions to your project's `CLAUDE.md` file.

Create or update `CLAUDE.md` in your project root:

```markdown
## Code Graph

This project has code-graph initialized. The graph contains the codebase structure,
dependencies, and call relationships.

### When to use code-graph tools

Use these MCP tools proactively when working on this codebase:

- **Before editing a file**: Use `get_file_context` to understand its dependencies,
  imports, and what depends on it
- **Before refactoring**: Use `get_impact_analysis` to see what files would be affected
- **When searching for code**: Use `search_symbols` to find function/class definitions
- **When understanding call flow**: Use `get_call_graph` to see callers and callees

### Available tools

| Tool | When to use |
|------|-------------|
| `get_file_context` | Before editing any file |
| `search_symbols` | Finding where something is defined |
| `get_call_graph` | Understanding function relationships |
| `get_impact_analysis` | Before making breaking changes |
| `get_by_type` | Finding all controllers, services, etc. |
| `find_references` | Finding all usages of a symbol |
| `get_graph_stats` | Overview of codebase structure |

### Project path

When calling code-graph tools, use this project path:
`/absolute/path/to/your/project`
```

Replace `/absolute/path/to/your/project` with your actual project path.

### Why This Helps

- Claude reads `CLAUDE.md` at the start of each session
- The instructions guide Claude to use code-graph tools at appropriate times
- You get better context-aware assistance without having to ask explicitly

## Step 9: Add to .gitignore

Add to your project's `.gitignore`:

```
# code-graph database (rebuild on each machine)
.code-graph/graph.db
```

Commit these files to share with your team:
- `.code-graph/config.json` - Project configuration
- `CLAUDE.md` - Instructions for Claude (if you added code-graph section)

## Troubleshooting

### "Project not initialized" error

Run `code-graph init` in your project root.

### Graph seems outdated

Force a full resync:
```bash
code-graph sync --full
```

### Missing references

Run the resolver manually:
```bash
code-graph resolve
```

### Slow initial sync

For large projects, the initial sync may take a few minutes. Subsequent syncs are incremental and much faster.

## Next Steps

- [Set up Git Hooks](GIT_HOOKS.md) for automatic updates
- Read the [main README](../README.md) for all available commands
