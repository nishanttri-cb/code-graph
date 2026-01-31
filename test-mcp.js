#!/usr/bin/env node

/**
 * Test script for the code-graph MCP server
 * Sends MCP protocol messages (newline-delimited JSON) and displays responses
 */

const { spawn } = require('child_process');
const readline = require('readline');

const projectPath = process.argv[2] || process.cwd();

console.log(`Testing MCP server with project: ${projectPath}\n`);

// Start the MCP server
const server = spawn('node', [
  require.resolve('./dist/index.js'),
  'serve',
  '--mcp'
], {
  cwd: projectPath,
  stdio: ['pipe', 'pipe', 'pipe']
});

let messageId = 1;

function sendMessage(method, params = {}) {
  const message = {
    jsonrpc: '2.0',
    id: messageId++,
    method,
    params
  };
  // MCP uses newline-delimited JSON
  const json = JSON.stringify(message) + '\n';
  server.stdin.write(json);
  return message.id;
}

// Parse incoming messages (newline-delimited JSON)
const rl = readline.createInterface({
  input: server.stdout,
  crlfDelay: Infinity
});

rl.on('line', (line) => {
  if (!line.trim()) return;
  try {
    const message = JSON.parse(line);
    handleResponse(message);
  } catch (e) {
    console.error('Failed to parse message:', e, 'Line:', line);
  }
});

server.stderr.on('data', (data) => {
  console.error('Server stderr:', data.toString());
});

const pendingRequests = new Map();
let testQueue = [];
let currentTest = 0;

function handleResponse(message) {
  if (message.id && pendingRequests.has(message.id)) {
    const { name, resolve } = pendingRequests.get(message.id);
    pendingRequests.delete(message.id);

    console.log(`\n=== ${name} ===`);
    if (message.error) {
      console.log('Error:', message.error);
    } else {
      console.log(JSON.stringify(message.result, null, 2));
    }

    resolve();
    runNextTest();
  }
}

function runTest(name, method, params) {
  return new Promise((resolve) => {
    const id = sendMessage(method, params);
    pendingRequests.set(id, { name, resolve });
  });
}

function runNextTest() {
  if (currentTest < testQueue.length) {
    const test = testQueue[currentTest++];
    test();
  } else {
    console.log('\n✅ All tests completed!');
    server.kill();
    process.exit(0);
  }
}

// Queue up tests
testQueue = [
  // Initialize
  () => runTest('Initialize', 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '1.0.0' }
  }),

  // List tools
  () => runTest('List Tools', 'tools/list', {}),

  // Test get_graph_stats
  () => runTest('Get Graph Stats', 'tools/call', {
    name: 'get_graph_stats',
    arguments: { project_path: projectPath }
  }),

  // Test search_symbols
  () => runTest('Search Symbols: "serialize"', 'tools/call', {
    name: 'search_symbols',
    arguments: { query: 'serialize', project_path: projectPath }
  }),

  // Test get_file_context
  () => runTest('Get File Context: file-system.ts', 'tools/call', {
    name: 'get_file_context',
    arguments: { file_path: 'src/lib/file-system.ts', project_path: projectPath }
  }),

  // Test get_call_graph
  () => runTest('Get Call Graph: VirtualFileSystem.serialize', 'tools/call', {
    name: 'get_call_graph',
    arguments: { function_name: 'VirtualFileSystem.serialize', project_path: projectPath }
  }),

  // Test get_by_type
  () => runTest('Get By Type: class', 'tools/call', {
    name: 'get_by_type',
    arguments: { node_type: 'class', project_path: projectPath }
  }),

  // Test get_impact_analysis
  () => runTest('Get Impact Analysis: file-system.ts', 'tools/call', {
    name: 'get_impact_analysis',
    arguments: { file_path: 'src/lib/file-system.ts', project_path: projectPath }
  }),
];

// Start tests after a short delay
setTimeout(() => {
  console.log('Starting MCP server tests...\n');
  runNextTest();
}, 500);

// Timeout after 30 seconds
setTimeout(() => {
  console.error('\n❌ Tests timed out');
  server.kill();
  process.exit(1);
}, 30000);
