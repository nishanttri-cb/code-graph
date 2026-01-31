# code-graph

Local code graph builder with MCP integration for AI-assisted development.

## Documentation

- [New Project Setup](docs/NEW_PROJECT.md) - Step-by-step guide for setting up a new project
- [New Machine Setup](docs/NEW_MACHINE.md) - Installing code-graph on a different machine
- [Git Hooks](docs/GIT_HOOKS.md) - Automatic graph updates with git hooks

## Supported Languages

- TypeScript / JavaScript (via ts-morph)
- Python (via tree-sitter-python)
- Java with Spring Boot annotations (via java-parser)

## Features

- **100% Local** - No code leaves your machine. Parsing and graph storage happen entirely locally.
- **Incremental Updates** - Only changed files are re-parsed, making updates fast.
- **MCP Integration** - Expose your code graph to Claude Code via Model Context Protocol.
- **Spring Boot Aware** - Recognizes `@Controller`, `@Service`, `@Repository`, REST endpoints, and dependency injection.
- **Git Hooks** - Automatically updates the graph on commits and checkouts.

## Installation

```bash
# From the code-graph directory
npm install
npm run build
npm link  # Makes 'code-graph' available globally
```

## Quick Start

```bash
# 1. Initialize in your project
cd /path/to/your/project
code-graph init

# 2. Build the initial graph
code-graph sync

# 3. Check the stats
code-graph status

# 4. Start the MCP server (for Claude Code integration)
code-graph serve --mcp
```

## Commands

| Command | Description |
|---------|-------------|
| `code-graph init` | Initialize code-graph in the current project |
| `code-graph sync` | Full sync of the code graph |
| `code-graph update --file <path>` | Update a single file |
| `code-graph watch` | Watch for changes and update in real-time |
| `code-graph serve --mcp` | Start the MCP server |
| `code-graph query <type> [args]` | Query the graph |
| `code-graph status` | Show graph statistics |

### Query Types

```bash
# Get graph statistics
code-graph query stats

# Get context for a file
code-graph query file src/api/UserController.java

# Search for symbols
code-graph query search "processPayment"

# Find references to a symbol
code-graph query refs "UserService"

# Get callers of a function
code-graph query callers "validateUser"

# Get callees of a function
code-graph query callees "handleRequest"

# Get all nodes of a type
code-graph query type controller   # All Spring controllers
code-graph query type endpoint     # All REST endpoints
code-graph query type service      # All services
```

## MCP Integration

### Configure Claude Desktop

Add to `~/.claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "code-graph": {
      "command": "code-graph",
      "args": ["serve", "--mcp"]
    }
  }
}
```

### Available MCP Tools

| Tool | Description |
|------|-------------|
| `get_file_context` | Get all symbols and dependencies for a file |
| `search_symbols` | Search for functions, classes, methods |
| `find_references` | Find where a symbol is used |
| `get_call_graph` | Get callers and callees of a function |
| `get_by_type` | Get all nodes of a type (e.g., all controllers) |
| `get_graph_stats` | Get graph statistics |
| `get_impact_analysis` | Analyze what's affected by changing a file |

## Project Structure

After initialization, your project will have:

```
your-project/
├── .code-graph/
│   ├── config.json      # Project configuration
│   ├── graph.db         # SQLite database
│   └── .gitignore       # Ignores the database
├── .git/hooks/
│   ├── post-commit      # Auto-updates graph on commit
│   └── post-checkout    # Auto-syncs on checkout
└── .claude/
    └── settings.json    # Claude Code hooks (optional)
```

## Configuration

Edit `.code-graph/config.json`:

```json
{
  "languages": ["typescript", "javascript", "python", "java"],
  "include": ["src/**", "lib/**", "app/**"],
  "exclude": [
    "node_modules/**",
    "dist/**",
    "build/**",
    "target/**",
    "**/*.test.*"
  ],
  "autoSync": true
}
```

## Graph Schema

### Node Types

| Type | Description |
|------|-------------|
| `file` | Source file |
| `class` | Class definition |
| `interface` | Interface definition |
| `function` | Standalone function |
| `method` | Class/interface method |
| `variable` | Variable or field |
| `import` | Import statement |
| `controller` | Spring `@Controller` / `@RestController` |
| `service` | Spring `@Service` |
| `repository` | Spring `@Repository` |
| `component` | Spring `@Component` |
| `endpoint` | REST endpoint (`@GetMapping`, etc.) |

### Edge Types

| Type | Description |
|------|-------------|
| `contains` | Parent contains child (file → class → method) |
| `calls` | Function/method calls another |
| `imports` | File imports module |
| `extends` | Class extends another |
| `implements` | Class implements interface |
| `uses` | References a symbol |
| `autowires` | Spring dependency injection |
| `injects` | Constructor injection |

## Examples

### Before Editing a File

Ask Claude: "What does UserController depend on?"

Claude uses `get_file_context` and sees:
- `UserController` class with `@RestController`
- Methods: `getUser`, `createUser`, `updateUser`
- Injects: `UserService`, `AuthService`
- Called by: `ApiGateway`

### Finding Impact of Changes

Ask Claude: "What will break if I change the UserService interface?"

Claude uses `get_impact_analysis` and `find_references` to identify:
- `UserController` - uses `UserService`
- `AdminController` - uses `UserService`
- `UserServiceImpl` - implements `UserService`
- 15 test files reference it

### Discovering Endpoints

Ask Claude: "What REST endpoints does this app have?"

Claude uses `get_by_type endpoint` and returns all endpoints with their HTTP methods and paths.

## Development

```bash
# Watch mode for development
npm run dev

# Build
npm run build

# Test in a project
cd /path/to/test/project
code-graph init
code-graph sync
```

## How It Works

1. **Parsing** - Uses `ts-morph` for TS/JS, `tree-sitter-python` for Python, `java-parser` for Java
2. **Storage** - SQLite database with nodes and edges tables
3. **Updates** - File content hashes detect changes; only changed files are re-parsed
4. **MCP** - Exposes query tools via Model Context Protocol for AI assistants

## License

MIT
