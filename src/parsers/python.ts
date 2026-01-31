import Parser from 'tree-sitter';
import Python from 'tree-sitter-python';
import { BaseParser } from './base.js';
import type { ParseResult, GraphNode, GraphEdge } from '../types.js';

export class PythonParser extends BaseParser {
  private parser: Parser;

  constructor() {
    super('python');
    this.parser = new Parser();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.parser.setLanguage(Python as any);
  }

  getFileExtensions(): string[] {
    return ['.py'];
  }

  parse(filePath: string, content: string): ParseResult {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    const tree = this.parser.parse(content);
    const rootNode = tree.rootNode;

    // Create file node
    const fileNode = this.createNode(
      filePath,
      'file',
      filePath.split('/').pop() || filePath,
      1,
      rootNode.endPosition.row + 1
    );
    nodes.push(fileNode);

    // Parse the AST
    this.parseNode(rootNode, filePath, nodes, edges, fileNode.id, null);

    return { nodes, edges };
  }

  private parseNode(
    node: Parser.SyntaxNode,
    filePath: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
    parentId: string,
    currentClass: { name: string; nodeId: string } | null
  ): void {
    switch (node.type) {
      case 'import_statement':
        this.parseImport(node, filePath, nodes, edges, parentId);
        break;

      case 'import_from_statement':
        this.parseFromImport(node, filePath, nodes, edges, parentId);
        break;

      case 'class_definition':
        this.parseClass(node, filePath, nodes, edges, parentId);
        break;

      case 'function_definition':
        this.parseFunction(node, filePath, nodes, edges, parentId, currentClass);
        break;

      case 'decorated_definition':
        this.parseDecoratedDefinition(node, filePath, nodes, edges, parentId, currentClass);
        break;

      case 'assignment':
        // Only capture top-level constant assignments
        if (node.parent?.type === 'module') {
          this.parseAssignment(node, filePath, nodes, edges, parentId);
        }
        break;

      default:
        // Recursively process children
        for (const child of node.children) {
          this.parseNode(child, filePath, nodes, edges, parentId, currentClass);
        }
    }
  }

  private parseImport(
    node: Parser.SyntaxNode,
    filePath: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
    parentId: string
  ): void {
    // import module / import module as alias
    const names: { name: string; alias?: string }[] = [];

    for (const child of node.children) {
      if (child.type === 'dotted_name') {
        names.push({ name: child.text });
      } else if (child.type === 'aliased_import') {
        const nameNode = child.childForFieldName('name');
        const aliasNode = child.childForFieldName('alias');
        if (nameNode) {
          names.push({
            name: nameNode.text,
            alias: aliasNode?.text,
          });
        }
      }
    }

    for (const imported of names) {
      const importNode = this.createNode(
        filePath,
        'import',
        imported.name,
        node.startPosition.row + 1,
        node.endPosition.row + 1,
        {
          type: 'module',
          alias: imported.alias,
        }
      );
      nodes.push(importNode);
      edges.push(this.createEdge(parentId, importNode.id, 'imports'));
    }
  }

  private parseFromImport(
    node: Parser.SyntaxNode,
    filePath: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
    parentId: string
  ): void {
    // from module import ...
    const moduleNode = node.childForFieldName('module_name');
    const moduleName = moduleNode?.text || '';

    const namedImports: { name: string; alias?: string }[] = [];

    // Find import list
    for (const child of node.children) {
      if (child.type === 'dotted_name' && child !== moduleNode) {
        namedImports.push({ name: child.text });
      } else if (child.type === 'aliased_import') {
        const nameNode = child.childForFieldName('name');
        const aliasNode = child.childForFieldName('alias');
        if (nameNode) {
          namedImports.push({
            name: nameNode.text,
            alias: aliasNode?.text,
          });
        }
      } else if (child.type === 'import_prefix') {
        // Handle relative imports like 'from . import x'
        continue;
      } else if (child.type === 'wildcard_import') {
        namedImports.push({ name: '*' });
      }
    }

    // Also check for names directly in children (tree-sitter structure varies)
    const importList = node.children.find((c) => c.type === 'import_list');
    if (importList) {
      for (const child of importList.children) {
        if (child.type === 'dotted_name' || child.type === 'identifier') {
          namedImports.push({ name: child.text });
        } else if (child.type === 'aliased_import') {
          const nameNode = child.childForFieldName('name');
          const aliasNode = child.childForFieldName('alias');
          if (nameNode) {
            namedImports.push({
              name: nameNode.text,
              alias: aliasNode?.text,
            });
          }
        }
      }
    }

    const importNode = this.createNode(
      filePath,
      'import',
      moduleName || '.',
      node.startPosition.row + 1,
      node.endPosition.row + 1,
      {
        type: 'from',
        namedImports,
        isRelative: moduleName.startsWith('.') || !moduleNode,
      }
    );
    nodes.push(importNode);
    edges.push(this.createEdge(parentId, importNode.id, 'imports'));
  }

  private parseClass(
    node: Parser.SyntaxNode,
    filePath: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
    parentId: string,
    decorators: string[] = []
  ): void {
    const nameNode = node.childForFieldName('name');
    const className = nameNode?.text || 'AnonymousClass';

    // Extract base classes
    const bases: string[] = [];
    const argumentList = node.childForFieldName('superclasses');
    if (argumentList) {
      for (const child of argumentList.children) {
        if (child.type === 'identifier' || child.type === 'attribute') {
          bases.push(child.text);
        } else if (child.type === 'argument_list') {
          for (const arg of child.children) {
            if (arg.type === 'identifier' || arg.type === 'attribute') {
              bases.push(arg.text);
            }
          }
        }
      }
    }

    const classNode = this.createNode(
      filePath,
      'class',
      className,
      node.startPosition.row + 1,
      node.endPosition.row + 1,
      {
        bases,
        decorators,
        isAbstract:
          decorators.includes('abstractmethod') ||
          decorators.includes('ABC') ||
          bases.includes('ABC') ||
          bases.includes('abc.ABC'),
        docstring: this.extractDocstring(node),
      }
    );
    nodes.push(classNode);
    edges.push(this.createEdge(parentId, classNode.id, 'contains'));

    // Add inheritance edges
    for (const base of bases) {
      if (base && base !== 'object') {
        edges.push(
          this.createEdge(classNode.id, `ref:class:${base}`, 'extends', {
            unresolved: true,
            targetName: base,
          })
        );
      }
    }

    // Parse class body
    const body = node.childForFieldName('body');
    if (body) {
      for (const child of body.children) {
        this.parseNode(child, filePath, nodes, edges, classNode.id, {
          name: className,
          nodeId: classNode.id,
        });
      }
    }
  }

  private parseFunction(
    node: Parser.SyntaxNode,
    filePath: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
    parentId: string,
    currentClass: { name: string; nodeId: string } | null,
    decorators: string[] = []
  ): void {
    const nameNode = node.childForFieldName('name');
    const funcName = nameNode?.text || 'anonymous';

    // Parse parameters
    const parameters = this.parseParameters(node);

    // Parse return type annotation
    const returnTypeNode = node.childForFieldName('return_type');
    const returnType = returnTypeNode?.text;

    // Determine if it's a method
    const isMethod = currentClass !== null;
    const nodeType = isMethod ? 'method' : 'function';
    const nodeName = isMethod ? `${currentClass!.name}.${funcName}` : funcName;

    // Check for async
    const isAsync = node.children.some((c) => c.type === 'async');

    const funcNode = this.createNode(filePath, nodeType, nodeName, node.startPosition.row + 1, node.endPosition.row + 1, {
      isAsync,
      parameters,
      returnType,
      decorators,
      isStatic: decorators.includes('staticmethod'),
      isClassMethod: decorators.includes('classmethod'),
      isProperty: decorators.includes('property'),
      isPrivate: funcName.startsWith('_') && !funcName.startsWith('__'),
      isDunder: funcName.startsWith('__') && funcName.endsWith('__'),
      isAbstract: decorators.includes('abstractmethod'),
      docstring: this.extractDocstring(node),
    });
    nodes.push(funcNode);

    if (isMethod && currentClass) {
      edges.push(this.createEdge(currentClass.nodeId, funcNode.id, 'contains'));
    } else {
      edges.push(this.createEdge(parentId, funcNode.id, 'contains'));
    }

    // Parse function body for calls
    const body = node.childForFieldName('body');
    if (body) {
      this.parseFunctionCalls(body, funcNode.id, edges);
    }
  }

  private parseDecoratedDefinition(
    node: Parser.SyntaxNode,
    filePath: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
    parentId: string,
    currentClass: { name: string; nodeId: string } | null
  ): void {
    // Extract decorators
    const decorators: string[] = [];
    for (const child of node.children) {
      if (child.type === 'decorator') {
        const decoratorName = this.extractDecoratorName(child);
        if (decoratorName) {
          decorators.push(decoratorName);
        }
      }
    }

    // Find the actual definition
    const definition = node.childForFieldName('definition');
    if (definition) {
      if (definition.type === 'function_definition') {
        this.parseFunction(definition, filePath, nodes, edges, parentId, currentClass, decorators);
      } else if (definition.type === 'class_definition') {
        this.parseClass(definition, filePath, nodes, edges, parentId, decorators);
      }
    }
  }

  private parseAssignment(
    node: Parser.SyntaxNode,
    filePath: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
    parentId: string
  ): void {
    const leftNode = node.childForFieldName('left');
    if (!leftNode || leftNode.type !== 'identifier') return;

    const varName = leftNode.text;

    // Only capture UPPER_CASE constants
    if (!/^[A-Z][A-Z0-9_]*$/.test(varName)) return;

    // Get type annotation if present
    const typeNode = node.childForFieldName('type');
    const varType = typeNode?.text;

    const varNode = this.createNode(
      filePath,
      'variable',
      varName,
      node.startPosition.row + 1,
      node.endPosition.row + 1,
      {
        isConstant: true,
        type: varType,
      }
    );
    nodes.push(varNode);
    edges.push(this.createEdge(parentId, varNode.id, 'contains'));
  }

  private parseParameters(
    funcNode: Parser.SyntaxNode
  ): { name: string; type?: string; default?: string }[] {
    const params: { name: string; type?: string; default?: string }[] = [];
    const parameters = funcNode.childForFieldName('parameters');
    if (!parameters) return params;

    for (const child of parameters.children) {
      if (child.type === 'identifier') {
        const name = child.text;
        if (name !== 'self' && name !== 'cls') {
          params.push({ name });
        }
      } else if (child.type === 'typed_parameter') {
        const nameNode = child.children.find((c) => c.type === 'identifier');
        const typeNode = child.childForFieldName('type');
        const name = nameNode?.text;
        if (name && name !== 'self' && name !== 'cls') {
          params.push({
            name,
            type: typeNode?.text,
          });
        }
      } else if (child.type === 'default_parameter') {
        const nameNode = child.childForFieldName('name');
        const valueNode = child.childForFieldName('value');
        const name = nameNode?.text;
        if (name && name !== 'self' && name !== 'cls') {
          params.push({
            name,
            default: valueNode?.text,
          });
        }
      } else if (child.type === 'typed_default_parameter') {
        const nameNode = child.childForFieldName('name');
        const typeNode = child.childForFieldName('type');
        const valueNode = child.childForFieldName('value');
        const name = nameNode?.text;
        if (name && name !== 'self' && name !== 'cls') {
          params.push({
            name,
            type: typeNode?.text,
            default: valueNode?.text,
          });
        }
      } else if (child.type === 'list_splat_pattern' || child.type === 'dictionary_splat_pattern') {
        const nameNode = child.children.find((c) => c.type === 'identifier');
        if (nameNode) {
          const prefix = child.type === 'list_splat_pattern' ? '*' : '**';
          params.push({ name: prefix + nameNode.text });
        }
      }
    }

    return params;
  }

  private parseFunctionCalls(
    node: Parser.SyntaxNode,
    funcNodeId: string,
    edges: GraphEdge[]
  ): void {
    const seenCalls = new Set<string>();

    const traverse = (n: Parser.SyntaxNode): void => {
      if (n.type === 'call') {
        const funcPart = n.childForFieldName('function');
        if (funcPart) {
          let callName: string;
          if (funcPart.type === 'identifier') {
            callName = funcPart.text;
          } else if (funcPart.type === 'attribute') {
            callName = funcPart.text;
          } else {
            callName = funcPart.text;
          }

          // Skip built-ins and common patterns
          const builtins = [
            'print', 'len', 'range', 'str', 'int', 'float', 'list', 'dict',
            'set', 'tuple', 'type', 'isinstance', 'hasattr', 'getattr',
            'setattr', 'open', 'super', 'enumerate', 'zip', 'map', 'filter',
            'sorted', 'reversed', 'any', 'all', 'min', 'max', 'sum', 'abs',
            'round', 'format', 'repr', 'id', 'hash', 'callable', 'dir',
            'vars', 'globals', 'locals', 'input', 'eval', 'exec', 'compile',
          ];

          const baseName = callName.split('.')[0];
          if (!builtins.includes(baseName) && !seenCalls.has(callName)) {
            seenCalls.add(callName);
            edges.push(
              this.createEdge(funcNodeId, `ref:function:${callName}`, 'calls', {
                unresolved: true,
                targetName: callName,
                line: n.startPosition.row + 1,
              })
            );
          }
        }
      }

      // Don't descend into nested function definitions
      if (n.type !== 'function_definition' && n.type !== 'class_definition') {
        for (const child of n.children) {
          traverse(child);
        }
      }
    };

    traverse(node);
  }

  private extractDecoratorName(decorator: Parser.SyntaxNode): string | null {
    for (const child of decorator.children) {
      if (child.type === 'identifier') {
        return child.text;
      } else if (child.type === 'attribute') {
        // Return just the final attribute name for simplicity
        const parts = child.text.split('.');
        return parts[parts.length - 1];
      } else if (child.type === 'call') {
        const funcNode = child.childForFieldName('function');
        if (funcNode?.type === 'identifier') {
          return funcNode.text;
        } else if (funcNode?.type === 'attribute') {
          const parts = funcNode.text.split('.');
          return parts[parts.length - 1];
        }
      }
    }
    return null;
  }

  private extractDocstring(node: Parser.SyntaxNode): string | null {
    const body = node.childForFieldName('body');
    if (!body) return null;

    // First statement in body
    const firstChild = body.children.find(
      (c) => c.type === 'expression_statement'
    );
    if (!firstChild) return null;

    const stringNode = firstChild.children.find((c) => c.type === 'string');
    if (!stringNode) return null;

    // Clean up the docstring
    let docstring = stringNode.text;
    // Remove quotes
    if (docstring.startsWith('"""') || docstring.startsWith("'''")) {
      docstring = docstring.slice(3, -3);
    } else if (docstring.startsWith('"') || docstring.startsWith("'")) {
      docstring = docstring.slice(1, -1);
    }

    return docstring.trim();
  }
}
