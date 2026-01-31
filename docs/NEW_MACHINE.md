# Installing code-graph on a New Machine

This guide covers how to install and configure code-graph on a new machine.

## Prerequisites

- Node.js 18+ installed
- npm or yarn
- Git (optional, for cloning)

## Step 1: Get the code-graph Source

### Option A: Clone from GitHub

```bash
git clone https://github.com/aspect-apps/code-graph.git
cd code-graph
```

### Option B: Copy from Another Machine

```bash
# From the source machine
scp -r user@source:/path/to/code-graph ./code-graph

# Or using rsync
rsync -av user@source:/path/to/code-graph ./code-graph
```

## Step 2: Install Dependencies

```bash
cd code-graph
npm install
```

## Step 3: Build the Project

```bash
npm run build
```

## Step 4: Install Globally

```bash
npm link
```

This makes `code-graph` available as a command anywhere on your system.

Verify installation:
```bash
code-graph --version
# Should output: 1.0.0
```

## Step 5: Configure MCP for Claude Code

Create or edit `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "code-graph": {
      "command": "node",
      "args": ["/absolute/path/to/code-graph/dist/index.js", "serve", "--mcp"]
    }
  }
}
```

Replace `/absolute/path/to/code-graph` with the actual path where you installed code-graph.

### Finding Your Installation Path

```bash
# If you used npm link
npm root -g
# Output: /usr/local/lib/node_modules or similar

# Or use the direct path
which code-graph
# Then check where it points to
```

## Step 6: Configure MCP for Claude Desktop (Optional)

### Linux
Edit `~/.config/claude-desktop/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "code-graph": {
      "command": "node",
      "args": ["/absolute/path/to/code-graph/dist/index.js", "serve", "--mcp"]
    }
  }
}
```

### macOS
Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "code-graph": {
      "command": "node",
      "args": ["/absolute/path/to/code-graph/dist/index.js", "serve", "--mcp"]
    }
  }
}
```

### Windows
Edit `%APPDATA%\Claude\claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "code-graph": {
      "command": "node",
      "args": ["C:\\path\\to\\code-graph\\dist\\index.js", "serve", "--mcp"]
    }
  }
}
```

## Step 7: Restart Claude

After configuring MCP:
- **Claude Code**: Exit and start a new session
- **Claude Desktop**: Restart the application

## Step 8: Initialize Your Projects

For each project you want to use with code-graph:

```bash
cd /path/to/your/project
code-graph init
code-graph sync
```

## Verification

Test that everything works:

```bash
# Check CLI
code-graph --help

# Test on a project
cd /path/to/your/project
code-graph query stats

# Test MCP server
node /path/to/code-graph/test-mcp.js /path/to/your/project
```

## Updating code-graph

```bash
cd /path/to/code-graph

# If using git
git pull
npm install
npm run build

# If manually copied, replace files then:
npm install
npm run build
```

## Troubleshooting

### "command not found: code-graph"

The npm link didn't work. Try:
```bash
# Check if it's linked
npm list -g code-graph

# Re-link
cd /path/to/code-graph
npm unlink
npm link
```

Or add to your PATH manually:
```bash
export PATH="/path/to/code-graph/node_modules/.bin:$PATH"
```

### MCP server not connecting

1. Check the path in your settings.json is correct
2. Verify the dist folder exists: `ls /path/to/code-graph/dist/`
3. Test the server manually:
   ```bash
   node /path/to/code-graph/dist/index.js serve --mcp
   ```

### Permission errors on Linux/macOS

```bash
# If npm link fails
sudo npm link

# Or use a local npm prefix
npm config set prefix ~/.npm-global
export PATH=~/.npm-global/bin:$PATH
npm link
```

## Next Steps

- [Set up a new project](NEW_PROJECT.md)
- [Configure Git hooks](GIT_HOOKS.md)
