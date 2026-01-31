import fs from 'fs';
import path from 'path';
import { GraphDatabase } from '../db/schema.js';
import { DEFAULT_CONFIG, type ProjectConfig } from '../types.js';

export async function initCommand(options: { force?: boolean }): Promise<void> {
  const projectRoot = process.cwd();
  const codeGraphDir = path.join(projectRoot, '.code-graph');

  // Check if already initialized
  if (fs.existsSync(codeGraphDir) && !options.force) {
    console.log('Project already initialized. Use --force to reinitialize.');
    return;
  }

  console.log('Initializing code-graph...');

  // Create .code-graph directory
  if (!fs.existsSync(codeGraphDir)) {
    fs.mkdirSync(codeGraphDir, { recursive: true });
  }

  // Create config file
  const configPath = path.join(codeGraphDir, 'config.json');
  const config: ProjectConfig = { ...DEFAULT_CONFIG };

  // Auto-detect languages based on project files
  const detectedLanguages = detectLanguages(projectRoot);
  if (detectedLanguages.length > 0) {
    config.languages = detectedLanguages;
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log(`Created config: ${configPath}`);

  // Create .gitignore
  const gitignorePath = path.join(codeGraphDir, '.gitignore');
  fs.writeFileSync(gitignorePath, 'graph.db\ngraph.db-wal\ngraph.db-shm\n');
  console.log(`Created .gitignore: ${gitignorePath}`);

  // Initialize database
  const db = new GraphDatabase(projectRoot);
  db.setConfig(config);
  db.close();
  console.log('Initialized database: .code-graph/graph.db');

  // Install git hooks if in a git repository
  const gitDir = path.join(projectRoot, '.git');
  if (fs.existsSync(gitDir)) {
    installGitHooks(projectRoot);
  }

  // Create Claude Code hooks configuration
  createClaudeHooks(projectRoot);

  console.log('\nInitialization complete!');
  console.log('\nNext steps:');
  console.log('  1. Run "code-graph sync" to build the initial graph');
  console.log('  2. Run "code-graph serve" to start the MCP server');
  console.log('  3. Add the MCP server to your Claude configuration');
}

function detectLanguages(
  projectRoot: string
): ProjectConfig['languages'] {
  const languages: ProjectConfig['languages'] = [];

  // Check for TypeScript/JavaScript
  if (
    fs.existsSync(path.join(projectRoot, 'package.json')) ||
    fs.existsSync(path.join(projectRoot, 'tsconfig.json'))
  ) {
    languages.push('typescript', 'javascript');
  }

  // Check for Python
  if (
    fs.existsSync(path.join(projectRoot, 'requirements.txt')) ||
    fs.existsSync(path.join(projectRoot, 'pyproject.toml')) ||
    fs.existsSync(path.join(projectRoot, 'setup.py'))
  ) {
    languages.push('python');
  }

  // Check for Java/Spring Boot
  if (
    fs.existsSync(path.join(projectRoot, 'pom.xml')) ||
    fs.existsSync(path.join(projectRoot, 'build.gradle')) ||
    fs.existsSync(path.join(projectRoot, 'build.gradle.kts'))
  ) {
    languages.push('java');
  }

  return languages;
}

function installGitHooks(projectRoot: string): void {
  const hooksDir = path.join(projectRoot, '.git', 'hooks');

  // Post-commit hook
  const postCommitPath = path.join(hooksDir, 'post-commit');
  const postCommitScript = `#!/bin/bash
# code-graph: Update graph after commit
if command -v code-graph &> /dev/null; then
  changed_files=$(git diff --name-only HEAD~1 HEAD 2>/dev/null || echo "")
  if [ -n "$changed_files" ]; then
    code-graph update --files "$changed_files" &
  fi
fi
`;

  // Check if hook exists and preserve existing content
  if (fs.existsSync(postCommitPath)) {
    const existing = fs.readFileSync(postCommitPath, 'utf-8');
    if (!existing.includes('code-graph')) {
      fs.appendFileSync(postCommitPath, '\n' + postCommitScript);
      console.log('Updated existing post-commit hook');
    }
  } else {
    fs.writeFileSync(postCommitPath, postCommitScript);
    fs.chmodSync(postCommitPath, '755');
    console.log('Installed post-commit hook');
  }

  // Post-checkout hook
  const postCheckoutPath = path.join(hooksDir, 'post-checkout');
  const postCheckoutScript = `#!/bin/bash
# code-graph: Sync graph after checkout
if command -v code-graph &> /dev/null; then
  code-graph sync --quiet &
fi
`;

  if (fs.existsSync(postCheckoutPath)) {
    const existing = fs.readFileSync(postCheckoutPath, 'utf-8');
    if (!existing.includes('code-graph')) {
      fs.appendFileSync(postCheckoutPath, '\n' + postCheckoutScript);
      console.log('Updated existing post-checkout hook');
    }
  } else {
    fs.writeFileSync(postCheckoutPath, postCheckoutScript);
    fs.chmodSync(postCheckoutPath, '755');
    console.log('Installed post-checkout hook');
  }
}

function createClaudeHooks(projectRoot: string): void {
  const claudeDir = path.join(projectRoot, '.claude');
  const settingsPath = path.join(claudeDir, 'settings.json');

  const claudeHooks = {
    hooks: {
      PostToolUse: [
        {
          matcher: { tool: ['Edit', 'Write'] },
          command: 'code-graph update --file "$CLAUDE_FILE_PATH"',
        },
      ],
    },
  };

  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
  }

  if (fs.existsSync(settingsPath)) {
    // Merge with existing settings
    try {
      const existing = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      if (!existing.hooks) {
        existing.hooks = claudeHooks.hooks;
        fs.writeFileSync(settingsPath, JSON.stringify(existing, null, 2));
        console.log('Updated .claude/settings.json with hooks');
      }
    } catch {
      console.log('Could not update .claude/settings.json');
    }
  } else {
    fs.writeFileSync(settingsPath, JSON.stringify(claudeHooks, null, 2));
    console.log('Created .claude/settings.json with hooks');
  }
}
