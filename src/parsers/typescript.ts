import { Project, SourceFile, SyntaxKind, Node } from 'ts-morph';
import { BaseParser } from './base.js';
import type { ParseResult, GraphNode, GraphEdge } from '../types.js';

export class TypeScriptParser extends BaseParser {
  private project: Project;

  constructor() {
    super('typescript');
    this.project = new Project({
      compilerOptions: {
        allowJs: true,
        checkJs: false,
      },
      skipAddingFilesFromTsConfig: true,
      skipFileDependencyResolution: true,
    });
  }

  getFileExtensions(): string[] {
    return ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
  }

  parse(filePath: string, content: string): ParseResult {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    // Determine if it's JavaScript
    const isJS =
      filePath.endsWith('.js') ||
      filePath.endsWith('.jsx') ||
      filePath.endsWith('.mjs') ||
      filePath.endsWith('.cjs');
    const language = isJS ? 'javascript' : 'typescript';

    let sourceFile: SourceFile;
    try {
      // Remove existing file if it exists
      const existing = this.project.getSourceFile(filePath);
      if (existing) {
        this.project.removeSourceFile(existing);
      }
      sourceFile = this.project.createSourceFile(filePath, content, {
        overwrite: true,
      });
    } catch {
      console.error(`Failed to parse ${filePath}`);
      return { nodes: [], edges: [] };
    }

    // Create file node
    const fileNode = this.createNode(
      filePath,
      'file',
      filePath.split('/').pop() || filePath,
      1,
      sourceFile.getEndLineNumber(),
      { language }
    );
    // Override language for JS files
    if (isJS) {
      (fileNode as { language: string }).language = 'javascript';
    }
    nodes.push(fileNode);

    // Parse imports
    for (const importDecl of sourceFile.getImportDeclarations()) {
      const moduleSpecifier = importDecl.getModuleSpecifierValue();
      const importNode = this.createNode(
        filePath,
        'import',
        moduleSpecifier,
        importDecl.getStartLineNumber(),
        importDecl.getEndLineNumber(),
        {
          moduleSpecifier,
          namedImports: importDecl
            .getNamedImports()
            .map((n) => n.getName()),
          defaultImport: importDecl.getDefaultImport()?.getText(),
        }
      );
      if (isJS) {
        (importNode as { language: string }).language = 'javascript';
      }
      nodes.push(importNode);
      edges.push(this.createEdge(fileNode.id, importNode.id, 'contains'));
    }

    // Parse exports
    for (const exportDecl of sourceFile.getExportDeclarations()) {
      const moduleSpecifier = exportDecl.getModuleSpecifierValue();
      const exportNode = this.createNode(
        filePath,
        'export',
        moduleSpecifier || 'default',
        exportDecl.getStartLineNumber(),
        exportDecl.getEndLineNumber(),
        {
          namedExports: exportDecl
            .getNamedExports()
            .map((n) => n.getName()),
        }
      );
      if (isJS) {
        (exportNode as { language: string }).language = 'javascript';
      }
      nodes.push(exportNode);
      edges.push(this.createEdge(fileNode.id, exportNode.id, 'contains'));
    }

    // Parse classes
    for (const classDecl of sourceFile.getClasses()) {
      const className = classDecl.getName() || 'AnonymousClass';
      const classNode = this.createNode(
        filePath,
        'class',
        className,
        classDecl.getStartLineNumber(),
        classDecl.getEndLineNumber(),
        {
          isExported: classDecl.isExported(),
          isAbstract: classDecl.isAbstract(),
          decorators: classDecl.getDecorators().map((d) => d.getName()),
        }
      );
      if (isJS) {
        (classNode as { language: string }).language = 'javascript';
      }
      nodes.push(classNode);
      edges.push(this.createEdge(fileNode.id, classNode.id, 'contains'));

      // Handle extends
      const baseClass = classDecl.getExtends();
      if (baseClass) {
        const baseName = baseClass.getText();
        // Create a reference edge (will be resolved later)
        edges.push(
          this.createEdge(classNode.id, `ref:class:${baseName}`, 'extends', {
            unresolved: true,
            targetName: baseName,
          })
        );
      }

      // Handle implements
      for (const impl of classDecl.getImplements()) {
        const implName = impl.getText();
        edges.push(
          this.createEdge(
            classNode.id,
            `ref:interface:${implName}`,
            'implements',
            { unresolved: true, targetName: implName }
          )
        );
      }

      // Parse methods
      for (const method of classDecl.getMethods()) {
        const methodName = method.getName();
        const methodNode = this.createNode(
          filePath,
          'method',
          `${className}.${methodName}`,
          method.getStartLineNumber(),
          method.getEndLineNumber(),
          {
            isStatic: method.isStatic(),
            isAsync: method.isAsync(),
            visibility: method.getScope(),
            parameters: method.getParameters().map((p) => ({
              name: p.getName(),
              type: p.getType().getText(),
            })),
            returnType: method.getReturnType().getText(),
            decorators: method.getDecorators().map((d) => d.getName()),
          }
        );
        if (isJS) {
          (methodNode as { language: string }).language = 'javascript';
        }
        nodes.push(methodNode);
        edges.push(this.createEdge(classNode.id, methodNode.id, 'contains'));

        // Parse function calls within method
        this.parseCallExpressions(method, methodNode.id, edges, filePath, isJS);
      }

      // Parse properties
      for (const prop of classDecl.getProperties()) {
        const propName = prop.getName();
        const propNode = this.createNode(
          filePath,
          'variable',
          `${className}.${propName}`,
          prop.getStartLineNumber(),
          prop.getEndLineNumber(),
          {
            isStatic: prop.isStatic(),
            visibility: prop.getScope(),
            type: prop.getType().getText(),
            decorators: prop.getDecorators().map((d) => d.getName()),
          }
        );
        if (isJS) {
          (propNode as { language: string }).language = 'javascript';
        }
        nodes.push(propNode);
        edges.push(this.createEdge(classNode.id, propNode.id, 'contains'));
      }
    }

    // Parse interfaces
    for (const interfaceDecl of sourceFile.getInterfaces()) {
      const interfaceName = interfaceDecl.getName();
      const interfaceNode = this.createNode(
        filePath,
        'interface',
        interfaceName,
        interfaceDecl.getStartLineNumber(),
        interfaceDecl.getEndLineNumber(),
        {
          isExported: interfaceDecl.isExported(),
          properties: interfaceDecl.getProperties().map((p) => p.getName()),
          methods: interfaceDecl.getMethods().map((m) => m.getName()),
        }
      );
      if (isJS) {
        (interfaceNode as { language: string }).language = 'javascript';
      }
      nodes.push(interfaceNode);
      edges.push(this.createEdge(fileNode.id, interfaceNode.id, 'contains'));

      // Handle extends
      for (const ext of interfaceDecl.getExtends()) {
        const extName = ext.getText();
        edges.push(
          this.createEdge(
            interfaceNode.id,
            `ref:interface:${extName}`,
            'extends',
            { unresolved: true, targetName: extName }
          )
        );
      }
    }

    // Parse standalone functions
    for (const funcDecl of sourceFile.getFunctions()) {
      const funcName = funcDecl.getName() || 'anonymous';
      const funcNode = this.createNode(
        filePath,
        'function',
        funcName,
        funcDecl.getStartLineNumber(),
        funcDecl.getEndLineNumber(),
        {
          isExported: funcDecl.isExported(),
          isAsync: funcDecl.isAsync(),
          isGenerator: funcDecl.isGenerator(),
          parameters: funcDecl.getParameters().map((p) => ({
            name: p.getName(),
            type: p.getType().getText(),
          })),
          returnType: funcDecl.getReturnType().getText(),
        }
      );
      if (isJS) {
        (funcNode as { language: string }).language = 'javascript';
      }
      nodes.push(funcNode);
      edges.push(this.createEdge(fileNode.id, funcNode.id, 'contains'));

      // Parse function calls
      this.parseCallExpressions(funcDecl, funcNode.id, edges, filePath, isJS);
    }

    // Parse variable declarations with arrow functions
    for (const varStmt of sourceFile.getVariableStatements()) {
      for (const decl of varStmt.getDeclarations()) {
        const initializer = decl.getInitializer();
        if (
          initializer &&
          (Node.isArrowFunction(initializer) ||
            Node.isFunctionExpression(initializer))
        ) {
          const funcName = decl.getName();
          const funcNode = this.createNode(
            filePath,
            'function',
            funcName,
            decl.getStartLineNumber(),
            decl.getEndLineNumber(),
            {
              isExported: varStmt.isExported(),
              isArrowFunction: Node.isArrowFunction(initializer),
              isAsync: initializer.isAsync(),
            }
          );
          if (isJS) {
            (funcNode as { language: string }).language = 'javascript';
          }
          nodes.push(funcNode);
          edges.push(this.createEdge(fileNode.id, funcNode.id, 'contains'));

          // Parse function calls
          this.parseCallExpressions(
            initializer,
            funcNode.id,
            edges,
            filePath,
            isJS
          );
        }
      }
    }

    // Clean up
    this.project.removeSourceFile(sourceFile);

    return { nodes, edges };
  }

  private parseCallExpressions(
    node: Node,
    parentId: string,
    edges: GraphEdge[],
    _filePath: string,
    _isJS: boolean
  ): void {
    const callExpressions = node.getDescendantsOfKind(
      SyntaxKind.CallExpression
    );
    const seenCalls = new Set<string>();

    for (const call of callExpressions) {
      const expression = call.getExpression();
      let callName: string;

      if (Node.isIdentifier(expression)) {
        callName = expression.getText();
      } else if (Node.isPropertyAccessExpression(expression)) {
        callName = expression.getText();
      } else {
        continue;
      }

      // Avoid duplicate edges
      if (seenCalls.has(callName)) continue;
      seenCalls.add(callName);

      edges.push(
        this.createEdge(parentId, `ref:function:${callName}`, 'calls', {
          unresolved: true,
          targetName: callName,
          line: call.getStartLineNumber(),
        })
      );
    }
  }
}
