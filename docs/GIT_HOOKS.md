# Git Hooks for Automatic Graph Updates

This guide explains how to set up Git hooks to automatically keep your code graph updated.

## Overview

Git hooks can trigger code-graph updates at key points in your workflow:
- **post-commit**: Update graph after each commit
- **post-checkout**: Sync graph when switching branches
- **post-merge**: Update after pulling/merging changes
- **pre-commit**: Validate graph before committing (optional)

## Quick Setup

### Option 1: Automatic Setup (Recommended)

Run this from your project root:

```bash
# Create hooks directory if it doesn't exist
mkdir -p .git/hooks

# Post-commit: Update changed files
cat > .git/hooks/post-commit << 'EOF'
#!/bin/bash
# Update code-graph with files changed in this commit
changed_files=$(git diff --name-only HEAD~1 HEAD 2>/dev/null)
if [ -n "$changed_files" ]; then
    code-graph update --files "$changed_files" 2>/dev/null || true
fi
EOF

# Post-checkout: Full sync when switching branches
cat > .git/hooks/post-checkout << 'EOF'
#!/bin/bash
# Sync code-graph when switching branches
# $3 is 1 for branch checkout, 0 for file checkout
if [ "$3" = "1" ]; then
    code-graph sync --quiet 2>/dev/null || true
fi
EOF

# Post-merge: Update after pulling
cat > .git/hooks/post-merge << 'EOF'
#!/bin/bash
# Sync code-graph after merge/pull
code-graph sync --quiet 2>/dev/null || true
EOF

# Make hooks executable
chmod +x .git/hooks/post-commit
chmod +x .git/hooks/post-checkout
chmod +x .git/hooks/post-merge

echo "Git hooks installed successfully!"
```

### Option 2: Manual Setup

Create each hook file manually in `.git/hooks/`:

#### .git/hooks/post-commit

```bash
#!/bin/bash
# Update code-graph with files changed in this commit

# Get list of changed files
changed_files=$(git diff --name-only HEAD~1 HEAD 2>/dev/null)

if [ -n "$changed_files" ]; then
    echo "Updating code-graph..."
    code-graph update --files "$changed_files"
fi
```

#### .git/hooks/post-checkout

```bash
#!/bin/bash
# Sync code-graph when switching branches
# Arguments: $1=prev HEAD, $2=new HEAD, $3=branch flag

# Only run on branch checkout (not file checkout)
if [ "$3" = "1" ]; then
    echo "Syncing code-graph for new branch..."
    code-graph sync --quiet
fi
```

#### .git/hooks/post-merge

```bash
#!/bin/bash
# Sync code-graph after merge/pull

echo "Syncing code-graph after merge..."
code-graph sync --quiet
```

Make them executable:
```bash
chmod +x .git/hooks/post-commit
chmod +x .git/hooks/post-checkout
chmod +x .git/hooks/post-merge
```

## Advanced Configurations

### Silent Mode

To suppress output from hooks:

```bash
#!/bin/bash
code-graph sync --quiet 2>/dev/null || true
```

### Conditional Execution

Only run if code-graph is initialized:

```bash
#!/bin/bash
if [ -d ".code-graph" ]; then
    code-graph sync --quiet
fi
```

### Background Execution

Run sync in background to not block git operations:

```bash
#!/bin/bash
if [ -d ".code-graph" ]; then
    (code-graph sync --quiet &) 2>/dev/null
fi
```

### Pre-commit Hook (Optional)

Validate the graph before committing:

```bash
#!/bin/bash
# .git/hooks/pre-commit

# Update staged files in the graph
staged_files=$(git diff --cached --name-only)
if [ -n "$staged_files" ]; then
    code-graph update --files "$staged_files"
fi

# Optional: Run checks
# code-graph query stats > /dev/null || exit 1
```

## Sharing Hooks with Your Team

Git hooks aren't committed by default. Here are options to share them:

### Option 1: Use a hooks directory in your repo

1. Create a `hooks/` directory in your project root
2. Add your hook scripts there
3. Add a setup script:

```bash
# setup-hooks.sh
#!/bin/bash
cp hooks/* .git/hooks/
chmod +x .git/hooks/*
echo "Hooks installed!"
```

4. Team members run `./setup-hooks.sh` after cloning

### Option 2: Use git config core.hooksPath

```bash
# In your repo
mkdir -p .githooks
# Add your hooks to .githooks/
git config core.hooksPath .githooks
```

Team members need to run:
```bash
git config core.hooksPath .githooks
```

### Option 3: Use husky (for Node.js projects)

```bash
npm install husky --save-dev
npx husky install
npx husky add .husky/post-commit "code-graph update --files \"\$(git diff --name-only HEAD~1)\""
```

## Troubleshooting

### Hooks not running

1. Check they're executable:
   ```bash
   ls -la .git/hooks/
   chmod +x .git/hooks/*
   ```

2. Check for Windows line endings (use LF, not CRLF):
   ```bash
   file .git/hooks/post-commit
   # Should say "ASCII text executable" or similar
   ```

3. Test manually:
   ```bash
   .git/hooks/post-commit
   ```

### code-graph command not found in hooks

Git hooks run in a minimal environment. Add the full path:

```bash
#!/bin/bash
/usr/local/bin/code-graph sync --quiet
```

Or source your profile:
```bash
#!/bin/bash
source ~/.bashrc  # or ~/.zshrc
code-graph sync --quiet
```

### Hooks are slow

Use background execution or --quiet flag:

```bash
#!/bin/bash
(code-graph sync --quiet &) 2>/dev/null
```

### Hooks failing on first commit

The `HEAD~1` reference doesn't exist on the first commit:

```bash
#!/bin/bash
changed_files=$(git diff --name-only HEAD~1 HEAD 2>/dev/null || git diff --name-only --cached)
```

## Removing Hooks

```bash
rm .git/hooks/post-commit
rm .git/hooks/post-checkout
rm .git/hooks/post-merge
```

## Next Steps

- [Set up a new project](NEW_PROJECT.md)
- [Install on a new machine](NEW_MACHINE.md)
