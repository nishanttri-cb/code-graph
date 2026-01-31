import fs from 'fs';
import path from 'path';
import { GraphDatabase } from '../db/schema.js';

export async function queryCommand(
  queryType: string,
  args: string[],
  options: { json?: boolean }
): Promise<void> {
  const projectRoot = process.cwd();
  const configPath = path.join(projectRoot, '.code-graph', 'config.json');

  if (!fs.existsSync(configPath)) {
    console.error('Project not initialized. Run "code-graph init" first.');
    process.exit(1);
  }

  const db = new GraphDatabase(projectRoot);

  const output = (data: unknown) => {
    if (options.json) {
      console.log(JSON.stringify(data, null, 2));
    } else {
      console.log(data);
    }
  };

  try {
    switch (queryType) {
      case 'stats': {
        const stats = db.getStats();
        const resolutionStats = db.getResolutionStats();
        output({
          ...stats,
          resolution: resolutionStats,
        });
        break;
      }

      case 'file': {
        const filePath = args[0];
        if (!filePath) {
          console.error('Usage: code-graph query file <path>');
          process.exit(1);
        }
        const context = db.getFileContext(filePath);
        output({
          file: filePath,
          nodes: context.nodes.map((n) => ({
            type: n.type,
            name: n.name,
            line: n.lineStart,
          })),
          incomingReferences: context.incomingEdges.length,
          outgoingReferences: context.outgoingEdges.length,
        });
        break;
      }

      case 'search': {
        const searchTerm = args[0];
        if (!searchTerm) {
          console.error('Usage: code-graph query search <term>');
          process.exit(1);
        }
        const results = db.searchNodes(searchTerm);
        output(
          results.map((n) => ({
            type: n.type,
            name: n.name,
            file: n.filePath,
            line: n.lineStart,
          }))
        );
        break;
      }

      case 'refs': {
        const symbolName = args[0];
        if (!symbolName) {
          console.error('Usage: code-graph query refs <symbol>');
          process.exit(1);
        }
        const refs = db.findReferences(symbolName);
        output(
          refs.map((r) => ({
            name: r.node.name,
            type: r.node.type,
            file: r.node.filePath,
            line: r.node.lineStart,
            references: r.edges.length,
          }))
        );
        break;
      }

      case 'callers': {
        const funcName = args[0];
        if (!funcName) {
          console.error('Usage: code-graph query callers <function>');
          process.exit(1);
        }
        const nodes = db.searchNodes(funcName);
        if (nodes.length === 0) {
          output({ message: 'Function not found', callers: [] });
          break;
        }
        // Use resolved callers
        const callers = db.getResolvedCallersOf(nodes[0].id);
        output({
          function: funcName,
          location: {
            file: nodes[0].filePath,
            line: nodes[0].lineStart,
          },
          callers: callers.map((n) => ({
            name: n.name,
            file: n.filePath,
            line: n.lineStart,
          })),
        });
        break;
      }

      case 'callees': {
        const funcName = args[0];
        if (!funcName) {
          console.error('Usage: code-graph query callees <function>');
          process.exit(1);
        }
        const nodes = db.searchNodes(funcName);
        if (nodes.length === 0) {
          output({ message: 'Function not found', callees: [] });
          break;
        }
        // Use resolved callees
        const callees = db.getResolvedCalleesOf(nodes[0].id);
        output({
          function: funcName,
          location: {
            file: nodes[0].filePath,
            line: nodes[0].lineStart,
          },
          callees: callees.map((n) => ({
            name: n.name,
            file: n.filePath,
            line: n.lineStart,
          })),
        });
        break;
      }

      case 'type': {
        const nodeType = args[0];
        if (!nodeType) {
          console.error('Usage: code-graph query type <type>');
          console.error(
            'Types: file, class, interface, function, method, variable, import, controller, service, repository, endpoint'
          );
          process.exit(1);
        }
        const nodes = db.getNodesByType(nodeType);
        output(
          nodes.map((n) => ({
            name: n.name,
            file: n.filePath,
            line: n.lineStart,
            metadata: n.metadata,
          }))
        );
        break;
      }

      default:
        console.error(`Unknown query type: ${queryType}`);
        console.error('Available queries: stats, file, search, refs, callers, callees, type');
        process.exit(1);
    }
  } finally {
    db.close();
  }
}
