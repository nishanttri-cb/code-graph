import fs from 'fs';
import path from 'path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { GraphDatabase } from '../db/schema.js';

export async function serveCommand(options: { mcp?: boolean }): Promise<void> {
  if (options.mcp) {
    await startMcpServer();
  } else {
    console.log('Starting MCP server...');
    console.log('Use --mcp flag to start in MCP mode');
    await startMcpServer();
  }
}

async function startMcpServer(): Promise<void> {
  const server = new Server(
    {
      name: 'code-graph',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Track current project database
  let currentDb: GraphDatabase | null = null;
  let currentProject: string | null = null;

  const getDb = (projectPath?: string): GraphDatabase => {
    const targetProject = projectPath || process.cwd();
    const configPath = path.join(targetProject, '.code-graph', 'config.json');

    if (!fs.existsSync(configPath)) {
      throw new Error(
        `Project not initialized at ${targetProject}. Run "code-graph init" first.`
      );
    }

    if (currentProject !== targetProject) {
      if (currentDb) {
        currentDb.close();
      }
      currentDb = new GraphDatabase(targetProject);
      currentProject = targetProject;
    }

    return currentDb!;
  };

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'get_file_context',
          description:
            'Get all symbols, imports, and references for a specific file. Use this before editing a file to understand its dependencies.',
          inputSchema: {
            type: 'object',
            properties: {
              file_path: {
                type: 'string',
                description: 'Path to the file (relative to project root)',
              },
              project_path: {
                type: 'string',
                description: 'Optional: Absolute path to the project root',
              },
            },
            required: ['file_path'],
          },
        },
        {
          name: 'search_symbols',
          description:
            'Search for functions, classes, methods, or variables by name',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Search term (partial match supported)',
              },
              project_path: {
                type: 'string',
                description: 'Optional: Absolute path to the project root',
              },
            },
            required: ['query'],
          },
        },
        {
          name: 'find_references',
          description: 'Find all references to a symbol (where it is used)',
          inputSchema: {
            type: 'object',
            properties: {
              symbol: {
                type: 'string',
                description: 'Name of the symbol to find references for',
              },
              project_path: {
                type: 'string',
                description: 'Optional: Absolute path to the project root',
              },
            },
            required: ['symbol'],
          },
        },
        {
          name: 'get_call_graph',
          description:
            'Get functions that call a specific function (callers) and functions it calls (callees)',
          inputSchema: {
            type: 'object',
            properties: {
              function_name: {
                type: 'string',
                description: 'Name of the function',
              },
              project_path: {
                type: 'string',
                description: 'Optional: Absolute path to the project root',
              },
            },
            required: ['function_name'],
          },
        },
        {
          name: 'get_by_type',
          description:
            'Get all nodes of a specific type (e.g., all controllers, services, endpoints)',
          inputSchema: {
            type: 'object',
            properties: {
              node_type: {
                type: 'string',
                enum: [
                  'class',
                  'interface',
                  'function',
                  'method',
                  'variable',
                  'import',
                  'controller',
                  'service',
                  'repository',
                  'component',
                  'endpoint',
                ],
                description: 'Type of node to retrieve',
              },
              project_path: {
                type: 'string',
                description: 'Optional: Absolute path to the project root',
              },
            },
            required: ['node_type'],
          },
        },
        {
          name: 'get_graph_stats',
          description:
            'Get statistics about the code graph (total nodes, edges, breakdown by type/language)',
          inputSchema: {
            type: 'object',
            properties: {
              project_path: {
                type: 'string',
                description: 'Optional: Absolute path to the project root',
              },
            },
          },
        },
        {
          name: 'get_impact_analysis',
          description:
            'Analyze what might be affected if a file or symbol is changed',
          inputSchema: {
            type: 'object',
            properties: {
              file_path: {
                type: 'string',
                description: 'Path to the file to analyze',
              },
              project_path: {
                type: 'string',
                description: 'Optional: Absolute path to the project root',
              },
            },
            required: ['file_path'],
          },
        },
        {
          name: 'get_source_code',
          description:
            'Retrieve actual source code for a symbol, not just metadata. Use this when you need to see the implementation of a function, class, or method.',
          inputSchema: {
            type: 'object',
            properties: {
              project_path: {
                type: 'string',
                description: 'Absolute path to the project root',
              },
              symbol_name: {
                type: 'string',
                description: 'Name of the symbol to retrieve source code for',
              },
              node_id: {
                type: 'string',
                description: 'Direct lookup by node ID (alternative to symbol_name)',
              },
              context_lines: {
                type: 'number',
                description: 'Number of lines to include before and after the symbol (default: 0)',
              },
            },
            required: ['project_path'],
          },
        },
        {
          name: 'get_usage_examples',
          description:
            'Find examples of how a symbol is used throughout the codebase. Returns code snippets showing actual usage patterns.',
          inputSchema: {
            type: 'object',
            properties: {
              project_path: {
                type: 'string',
                description: 'Absolute path to the project root',
              },
              symbol_name: {
                type: 'string',
                description: 'Name of the symbol to find usages for',
              },
              max_examples: {
                type: 'number',
                description: 'Maximum number of examples to return (default: 5)',
              },
              context_lines: {
                type: 'number',
                description: 'Lines of context around each usage (default: 2)',
              },
            },
            required: ['project_path', 'symbol_name'],
          },
        },
        {
          name: 'get_editing_context',
          description:
            'Gather relevant context for editing a file, optimized for LLM token limits. Returns the file content, imports with their source, dependents, and related types.',
          inputSchema: {
            type: 'object',
            properties: {
              project_path: {
                type: 'string',
                description: 'Absolute path to the project root',
              },
              file_path: {
                type: 'string',
                description: 'Path to the file you want to edit (relative to project root)',
              },
              task: {
                type: 'string',
                description: 'Optional: Description of what you are trying to do. Helps find similar functions as examples.',
              },
              max_tokens: {
                type: 'number',
                description: 'Maximum tokens for context (default: 8000, ~32KB)',
              },
              include_tests: {
                type: 'boolean',
                description: 'Whether to include test files in dependents (default: false)',
              },
            },
            required: ['project_path', 'file_path'],
          },
        },
      ],
    };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      const projectPath = (args as Record<string, string>)?.project_path;

      switch (name) {
        case 'get_file_context': {
          const db = getDb(projectPath);
          const filePath = (args as { file_path: string }).file_path;
          const context = db.getFileContext(filePath);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    file: filePath,
                    symbols: context.nodes.map((n) => ({
                      type: n.type,
                      name: n.name,
                      line: `${n.lineStart}-${n.lineEnd}`,
                      metadata: n.metadata,
                    })),
                    incoming_dependencies: context.incomingEdges.map((e) => ({
                      from: e.sourceId,
                      type: e.type,
                    })),
                    outgoing_dependencies: context.outgoingEdges.map((e) => ({
                      to: e.targetId,
                      type: e.type,
                    })),
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case 'search_symbols': {
          const db = getDb(projectPath);
          const query = (args as { query: string }).query;
          const results = db.searchNodes(query);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  results.map((n) => ({
                    type: n.type,
                    name: n.name,
                    file: n.filePath,
                    line: n.lineStart,
                    language: n.language,
                  })),
                  null,
                  2
                ),
              },
            ],
          };
        }

        case 'find_references': {
          const db = getDb(projectPath);
          const symbol = (args as { symbol: string }).symbol;
          const refs = db.findReferences(symbol);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  refs.map((r) => ({
                    definition: {
                      type: r.node.type,
                      name: r.node.name,
                      file: r.node.filePath,
                      line: r.node.lineStart,
                    },
                    usages: r.edges.map((e) => ({
                      type: e.type,
                      target: e.targetId,
                    })),
                  })),
                  null,
                  2
                ),
              },
            ],
          };
        }

        case 'get_call_graph': {
          const db = getDb(projectPath);
          const funcName = (args as { function_name: string }).function_name;
          const nodes = db.searchNodes(funcName);

          if (nodes.length === 0) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({ error: 'Function not found' }),
                },
              ],
            };
          }

          const callGraph = db.getCallGraph(nodes[0].id);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    function: funcName,
                    location: {
                      file: nodes[0].filePath,
                      line: nodes[0].lineStart,
                    },
                    callers: callGraph.callers.map((n) => ({
                      name: n.name,
                      file: n.filePath,
                      line: n.lineStart,
                    })),
                    callees: callGraph.callees.map((n) => ({
                      name: n.name,
                      file: n.filePath,
                      line: n.lineStart,
                    })),
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case 'get_by_type': {
          const db = getDb(projectPath);
          const nodeType = (args as { node_type: string }).node_type;
          const nodes = db.getNodesByType(nodeType);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  nodes.map((n) => ({
                    name: n.name,
                    file: n.filePath,
                    line: n.lineStart,
                    metadata: n.metadata,
                  })),
                  null,
                  2
                ),
              },
            ],
          };
        }

        case 'get_graph_stats': {
          const db = getDb(projectPath);
          const stats = db.getStats();

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(stats, null, 2),
              },
            ],
          };
        }

        case 'get_impact_analysis': {
          const db = getDb(projectPath);
          const filePath = (args as { file_path: string }).file_path;
          const context = db.getFileContext(filePath);

          // Find all files that depend on this file
          const dependentFiles = new Set<string>();
          for (const edge of context.incomingEdges) {
            // Get the source node to find its file
            const sourceNode = db.getNode(edge.sourceId);
            if (sourceNode && sourceNode.filePath !== filePath) {
              dependentFiles.add(sourceNode.filePath);
            }
          }

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    file: filePath,
                    exports: context.nodes
                      .filter((n) => n.metadata.isExported)
                      .map((n) => n.name),
                    dependent_files: Array.from(dependentFiles),
                    incoming_references: context.incomingEdges.length,
                    risk_level:
                      dependentFiles.size > 10
                        ? 'high'
                        : dependentFiles.size > 3
                          ? 'medium'
                          : 'low',
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case 'get_source_code': {
          const db = getDb(projectPath);
          const typedArgs = args as {
            symbol_name?: string;
            node_id?: string;
            context_lines?: number;
          };

          if (!typedArgs.symbol_name && !typedArgs.node_id) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    error: 'Either symbol_name or node_id is required',
                  }),
                },
              ],
              isError: true,
            };
          }

          const result = db.getSourceCode({
            symbolName: typedArgs.symbol_name,
            nodeId: typedArgs.node_id,
            contextLines: typedArgs.context_lines,
          });

          if (!result) {
            // Try to find similar symbols for helpful error
            const suggestions = typedArgs.symbol_name
              ? db.searchNodes(typedArgs.symbol_name).slice(0, 5)
              : [];

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      error: 'Symbol not found',
                      suggestions: suggestions.map((n) => ({
                        name: n.name,
                        type: n.type,
                        file: n.filePath,
                      })),
                    },
                    null,
                    2
                  ),
                },
              ],
            };
          }

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        }

        case 'get_usage_examples': {
          const db = getDb(projectPath);
          const typedArgs = args as {
            symbol_name: string;
            max_examples?: number;
            context_lines?: number;
          };

          const result = db.getUsageExamples({
            symbolName: typedArgs.symbol_name,
            maxExamples: typedArgs.max_examples,
            contextLines: typedArgs.context_lines,
          });

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        }

        case 'get_editing_context': {
          const db = getDb(projectPath);
          const typedArgs = args as {
            file_path: string;
            task?: string;
            max_tokens?: number;
            include_tests?: boolean;
          };

          const result = db.getEditingContext({
            filePath: typedArgs.file_path,
            task: typedArgs.task,
            maxTokens: typedArgs.max_tokens,
            includeTests: typedArgs.include_tests,
          });

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        }

        default:
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ error: `Unknown tool: ${name}` }),
              },
            ],
            isError: true,
          };
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: error instanceof Error ? error.message : String(error),
            }),
          },
        ],
        isError: true,
      };
    }
  });

  // Start the server
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
