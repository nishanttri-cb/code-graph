import { parse } from 'java-parser';
import { BaseParser } from './base.js';
import type { ParseResult, GraphNode, GraphEdge, NodeType } from '../types.js';

interface JavaNode {
  name: string;
  children?: Record<string, JavaNode[]>;
  image?: string;
  location?: {
    startLine?: number;
    endLine?: number;
    startOffset?: number;
    endOffset?: number;
  };
}

interface AnnotationInfo {
  name: string;
  value?: string | string[] | Record<string, string>;
  rawValue?: string;
}

export class JavaParser extends BaseParser {
  constructor() {
    super('java');
  }

  getFileExtensions(): string[] {
    return ['.java'];
  }

  parse(filePath: string, content: string): ParseResult {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const lines = content.split('\n');

    // Create file node
    const fileNode = this.createNode(
      filePath,
      'file',
      filePath.split('/').pop() || filePath,
      1,
      lines.length
    );
    nodes.push(fileNode);

    let cst: JavaNode;
    try {
      cst = parse(content) as unknown as JavaNode;
    } catch (error) {
      console.error(`Failed to parse Java file ${filePath}:`, error);
      return { nodes, edges };
    }

    // Parse the CST
    this.parseCompilationUnit(cst, filePath, nodes, edges, fileNode.id);

    return { nodes, edges };
  }

  private parseCompilationUnit(
    cst: JavaNode,
    filePath: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
    fileNodeId: string
  ): void {
    if (!cst.children) return;

    // Handle ordinaryCompilationUnit wrapper from java-parser
    let compilationUnit = cst;
    if (cst.children.ordinaryCompilationUnit) {
      compilationUnit = cst.children.ordinaryCompilationUnit[0];
      if (!compilationUnit?.children) return;
    }

    // Parse package declaration
    const packageDecl = compilationUnit.children?.packageDeclaration?.[0];
    if (packageDecl) {
      const packageName = this.extractPackageName(packageDecl);
      if (packageName) {
        const packageNode = this.createNode(
          filePath,
          'module',
          packageName,
          this.getStartLine(packageDecl),
          this.getEndLine(packageDecl),
          { type: 'package' }
        );
        nodes.push(packageNode);
        edges.push(this.createEdge(fileNodeId, packageNode.id, 'contains'));
      }
    }

    // Parse imports
    const importDecls = compilationUnit.children?.importDeclaration || [];
    for (const importDecl of importDecls) {
      this.parseImport(importDecl, filePath, nodes, edges, fileNodeId);
    }

    // Parse type declarations (classes, interfaces, enums)
    const typeDecls = compilationUnit.children?.typeDeclaration || [];
    for (const typeDecl of typeDecls) {
      this.parseTypeDeclaration(typeDecl, filePath, nodes, edges, fileNodeId);
    }
  }

  private parseImport(
    importDecl: JavaNode,
    filePath: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
    fileNodeId: string
  ): void {
    const importName = this.extractFullyQualifiedName(importDecl);
    if (!importName) return;

    const isStatic = this.hasChild(importDecl, 'Static');
    const isWildcard = importName.endsWith('*');

    const importNode = this.createNode(
      filePath,
      'import',
      importName,
      this.getStartLine(importDecl),
      this.getEndLine(importDecl),
      { isStatic, isWildcard }
    );
    nodes.push(importNode);
    edges.push(this.createEdge(fileNodeId, importNode.id, 'imports'));
  }

  private parseTypeDeclaration(
    typeDecl: JavaNode,
    filePath: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
    parentId: string
  ): void {
    if (!typeDecl.children) return;

    // Check for class declaration
    const classDecl = typeDecl.children.classDeclaration?.[0];
    if (classDecl) {
      this.parseClassDeclaration(classDecl, filePath, nodes, edges, parentId);
      return;
    }

    // Check for interface declaration
    const interfaceDecl = typeDecl.children.interfaceDeclaration?.[0];
    if (interfaceDecl) {
      this.parseInterfaceDeclaration(interfaceDecl, filePath, nodes, edges, parentId);
    }
  }

  private parseClassDeclaration(
    classDecl: JavaNode,
    filePath: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
    parentId: string
  ): void {
    if (!classDecl.children) return;

    const normalClass = classDecl.children.normalClassDeclaration?.[0];
    if (!normalClass?.children) return;

    const className = this.extractIdentifier(normalClass);
    if (!className) return;

    // Extract annotations with values (annotations are on classDecl, not normalClass)
    const annotations = this.extractAnnotations(classDecl);
    const annotationNames = annotations.map((a) => a.name);
    const springAnnotations = this.extractSpringAnnotations(annotationNames);

    // Determine node type based on Spring annotations
    let nodeType: NodeType = 'class';
    if (annotationNames.includes('RestController') || annotationNames.includes('Controller')) {
      nodeType = 'controller';
    } else if (annotationNames.includes('Service')) {
      nodeType = 'service';
    } else if (annotationNames.includes('Repository')) {
      nodeType = 'repository';
    } else if (annotationNames.includes('Component')) {
      nodeType = 'component';
    }

    const modifiers = this.extractModifiers(normalClass);

    // Extract class-level request mapping
    const requestMappingAnnotation = annotations.find(
      (a) => a.name === 'RequestMapping'
    );
    const requestMapping = this.extractMappingPath(requestMappingAnnotation);

    const classNode = this.createNode(
      filePath,
      nodeType,
      className,
      this.getStartLine(normalClass),
      this.getEndLine(normalClass),
      {
        annotations: annotations.map((a) => ({
          name: a.name,
          value: a.value,
        })),
        springAnnotations,
        modifiers,
        isAbstract: modifiers.includes('abstract'),
        isFinal: modifiers.includes('final'),
        requestMapping,
      }
    );
    nodes.push(classNode);
    edges.push(this.createEdge(parentId, classNode.id, 'contains'));

    // Parse superclass
    const superclass = normalClass.children.superclass?.[0];
    if (superclass) {
      const superclassName = this.extractTypeName(superclass);
      if (superclassName) {
        edges.push(
          this.createEdge(classNode.id, `ref:class:${superclassName}`, 'extends', {
            unresolved: true,
            targetName: superclassName,
          })
        );
      }
    }

    // Parse interfaces
    const superinterfaces = normalClass.children.superinterfaces?.[0];
    if (superinterfaces) {
      const interfaceNames = this.extractInterfaceNames(superinterfaces);
      for (const ifaceName of interfaceNames) {
        edges.push(
          this.createEdge(classNode.id, `ref:interface:${ifaceName}`, 'implements', {
            unresolved: true,
            targetName: ifaceName,
          })
        );
      }
    }

    // Parse class body
    const classBody = normalClass.children.classBody?.[0];
    if (classBody?.children) {
      this.parseClassBody(classBody, filePath, nodes, edges, classNode.id, className, requestMapping);
    }
  }

  private parseInterfaceDeclaration(
    interfaceDecl: JavaNode,
    filePath: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
    parentId: string
  ): void {
    if (!interfaceDecl.children) return;

    const normalInterface = interfaceDecl.children.normalInterfaceDeclaration?.[0];
    if (!normalInterface?.children) return;

    const interfaceName = this.extractIdentifier(normalInterface);
    if (!interfaceName) return;

    const annotations = this.extractAnnotations(normalInterface);
    const modifiers = this.extractModifiers(normalInterface);

    const interfaceNode = this.createNode(
      filePath,
      'interface',
      interfaceName,
      this.getStartLine(normalInterface),
      this.getEndLine(normalInterface),
      {
        annotations: annotations.map((a) => ({ name: a.name, value: a.value })),
        modifiers,
      }
    );
    nodes.push(interfaceNode);
    edges.push(this.createEdge(parentId, interfaceNode.id, 'contains'));

    // Parse interface body
    const interfaceBody = normalInterface.children.interfaceBody?.[0];
    if (interfaceBody?.children) {
      this.parseInterfaceBody(
        interfaceBody,
        filePath,
        nodes,
        edges,
        interfaceNode.id,
        interfaceName
      );
    }
  }

  private parseClassBody(
    classBody: JavaNode,
    filePath: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
    classNodeId: string,
    className: string,
    classRequestMapping: string | null
  ): void {
    const bodyDecls = classBody.children?.classBodyDeclaration || [];

    for (const bodyDecl of bodyDecls) {
      if (!bodyDecl.children) continue;

      const memberDecl = bodyDecl.children.classMemberDeclaration?.[0];
      if (!memberDecl?.children) continue;

      // Parse methods
      const methodDecl = memberDecl.children.methodDeclaration?.[0];
      if (methodDecl) {
        this.parseMethodDeclaration(
          methodDecl,
          filePath,
          nodes,
          edges,
          classNodeId,
          className,
          classRequestMapping
        );
        continue;
      }

      // Parse fields
      const fieldDecl = memberDecl.children.fieldDeclaration?.[0];
      if (fieldDecl) {
        this.parseFieldDeclaration(
          fieldDecl,
          filePath,
          nodes,
          edges,
          classNodeId,
          className
        );
      }
    }

    // Parse constructors
    for (const bodyDecl of bodyDecls) {
      const constructorDecl = bodyDecl.children?.constructorDeclaration?.[0];
      if (constructorDecl) {
        this.parseConstructorDeclaration(
          constructorDecl,
          filePath,
          nodes,
          edges,
          classNodeId,
          className
        );
      }
    }
  }

  private parseInterfaceBody(
    interfaceBody: JavaNode,
    filePath: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
    interfaceNodeId: string,
    interfaceName: string
  ): void {
    const memberDecls = interfaceBody.children?.interfaceMemberDeclaration || [];

    for (const memberDecl of memberDecls) {
      if (!memberDecl.children) continue;

      const methodDecl = memberDecl.children.interfaceMethodDeclaration?.[0];
      if (methodDecl) {
        this.parseInterfaceMethodDeclaration(
          methodDecl,
          filePath,
          nodes,
          edges,
          interfaceNodeId,
          interfaceName
        );
      }
    }
  }

  private parseMethodDeclaration(
    methodDecl: JavaNode,
    filePath: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
    classNodeId: string,
    className: string,
    classRequestMapping: string | null
  ): void {
    if (!methodDecl.children) return;

    const header = methodDecl.children.methodHeader?.[0];
    if (!header?.children) return;

    const declarator = header.children.methodDeclarator?.[0];
    const methodName = this.extractIdentifier(declarator);
    if (!methodName) return;

    const annotations = this.extractAnnotations(methodDecl);
    const annotationNames = annotations.map((a) => a.name);
    const springAnnotations = this.extractSpringAnnotations(annotationNames);
    const modifiers = this.extractModifiers(methodDecl);
    const returnType = this.extractReturnType(header);
    const parameters = this.extractParameters(declarator);

    // Determine if this is a REST endpoint and extract HTTP method + path
    let nodeType: NodeType = 'method';
    const httpMappingAnnotation = annotations.find((a) =>
      ['GetMapping', 'PostMapping', 'PutMapping', 'DeleteMapping', 'PatchMapping', 'RequestMapping'].includes(a.name)
    );

    let httpMethod: string | null = null;
    let methodPath: string | null = null;
    let fullPath: string | null = null;

    if (httpMappingAnnotation) {
      nodeType = 'endpoint';
      httpMethod = this.extractHttpMethod(httpMappingAnnotation);
      methodPath = this.extractMappingPath(httpMappingAnnotation);

      // Combine class-level and method-level paths
      if (classRequestMapping && methodPath) {
        fullPath = this.combinePaths(classRequestMapping, methodPath);
      } else if (classRequestMapping) {
        fullPath = classRequestMapping;
      } else if (methodPath) {
        fullPath = methodPath;
      }
    }

    const methodNode = this.createNode(
      filePath,
      nodeType,
      `${className}.${methodName}`,
      this.getStartLine(methodDecl),
      this.getEndLine(methodDecl),
      {
        annotations: annotations.map((a) => ({ name: a.name, value: a.value })),
        springAnnotations,
        modifiers,
        returnType,
        parameters,
        isStatic: modifiers.includes('static'),
        isAbstract: modifiers.includes('abstract'),
        httpMethod,
        path: methodPath,
        fullPath,
      }
    );
    nodes.push(methodNode);
    edges.push(this.createEdge(classNodeId, methodNode.id, 'contains'));

    // Parse method body for calls
    const methodBody = methodDecl.children.methodBody?.[0];
    if (methodBody) {
      this.parseMethodBodyForCalls(methodBody, methodNode.id, edges);
    }

    // Check for @Autowired parameters
    for (const param of parameters) {
      if (param.annotations?.some((a) => ['Autowired', 'Inject'].includes(a.name))) {
        edges.push(
          this.createEdge(methodNode.id, `ref:class:${param.type}`, 'autowires', {
            unresolved: true,
            targetName: param.type,
          })
        );
      }
    }
  }

  private parseInterfaceMethodDeclaration(
    methodDecl: JavaNode,
    filePath: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
    interfaceNodeId: string,
    interfaceName: string
  ): void {
    if (!methodDecl.children) return;

    const header = methodDecl.children.methodHeader?.[0];
    if (!header?.children) return;

    const declarator = header.children.methodDeclarator?.[0];
    const methodName = this.extractIdentifier(declarator);
    if (!methodName) return;

    const annotations = this.extractAnnotations(methodDecl);
    const returnType = this.extractReturnType(header);
    const parameters = this.extractParameters(declarator);

    const methodNode = this.createNode(
      filePath,
      'method',
      `${interfaceName}.${methodName}`,
      this.getStartLine(methodDecl),
      this.getEndLine(methodDecl),
      {
        annotations: annotations.map((a) => ({ name: a.name, value: a.value })),
        returnType,
        parameters,
        isAbstract: true,
      }
    );
    nodes.push(methodNode);
    edges.push(this.createEdge(interfaceNodeId, methodNode.id, 'contains'));
  }

  private parseFieldDeclaration(
    fieldDecl: JavaNode,
    filePath: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
    classNodeId: string,
    className: string
  ): void {
    if (!fieldDecl.children) return;

    const declarators = fieldDecl.children.variableDeclaratorList?.[0]?.children?.variableDeclarator || [];
    const annotations = this.extractAnnotations(fieldDecl);
    const annotationNames = annotations.map((a) => a.name);
    const modifiers = this.extractModifiers(fieldDecl);
    const fieldType = this.extractFieldType(fieldDecl);

    // Extract @Value annotation value
    const valueAnnotation = annotations.find((a) => a.name === 'Value');
    const valueProperty = valueAnnotation?.value;

    for (const declarator of declarators) {
      const fieldName = this.extractIdentifier(declarator);
      if (!fieldName) continue;

      const fieldNode = this.createNode(
        filePath,
        'variable',
        `${className}.${fieldName}`,
        this.getStartLine(declarator),
        this.getEndLine(declarator),
        {
          annotations: annotations.map((a) => ({ name: a.name, value: a.value })),
          modifiers,
          type: fieldType,
          isStatic: modifiers.includes('static'),
          isFinal: modifiers.includes('final'),
          valueProperty,
        }
      );
      nodes.push(fieldNode);
      edges.push(this.createEdge(classNodeId, fieldNode.id, 'contains'));

      // Check for dependency injection annotations
      if (annotationNames.some((a) => ['Autowired', 'Inject', 'Resource'].includes(a))) {
        edges.push(
          this.createEdge(fieldNode.id, `ref:class:${fieldType}`, 'autowires', {
            unresolved: true,
            targetName: fieldType,
          })
        );
      }
    }
  }

  private parseConstructorDeclaration(
    constructorDecl: JavaNode,
    filePath: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
    classNodeId: string,
    className: string
  ): void {
    if (!constructorDecl.children) return;

    const declarator = constructorDecl.children.constructorDeclarator?.[0];
    const annotations = this.extractAnnotations(constructorDecl);
    const modifiers = this.extractModifiers(constructorDecl);
    const parameters = this.extractParameters(declarator);

    const constructorNode = this.createNode(
      filePath,
      'method',
      `${className}.<init>`,
      this.getStartLine(constructorDecl),
      this.getEndLine(constructorDecl),
      {
        isConstructor: true,
        annotations: annotations.map((a) => ({ name: a.name, value: a.value })),
        modifiers,
        parameters,
      }
    );
    nodes.push(constructorNode);
    edges.push(this.createEdge(classNodeId, constructorNode.id, 'contains'));

    // Constructor injection
    for (const param of parameters) {
      if (param.type) {
        edges.push(
          this.createEdge(constructorNode.id, `ref:class:${param.type}`, 'injects', {
            unresolved: true,
            targetName: param.type,
          })
        );
      }
    }
  }

  private parseMethodBodyForCalls(
    methodBody: JavaNode,
    methodNodeId: string,
    edges: GraphEdge[]
  ): void {
    const seenCalls = new Set<string>();

    const traverse = (node: JavaNode): void => {
      if (!node.children) return;

      // Look for method invocations
      if (node.name === 'methodInvocation') {
        const callName = this.extractMethodCallName(node);
        if (callName && !seenCalls.has(callName)) {
          seenCalls.add(callName);
          edges.push(
            this.createEdge(methodNodeId, `ref:method:${callName}`, 'calls', {
              unresolved: true,
              targetName: callName,
            })
          );
        }
      }

      // Recursively traverse
      for (const children of Object.values(node.children)) {
        if (Array.isArray(children)) {
          for (const child of children) {
            traverse(child);
          }
        }
      }
    };

    traverse(methodBody);
  }

  // Helper methods
  private extractPackageName(packageDecl: JavaNode): string | null {
    const identifiers: string[] = [];
    const traverse = (node: JavaNode): void => {
      if (node.image && node.name === 'Identifier') {
        identifiers.push(node.image);
      }
      if (node.children) {
        for (const children of Object.values(node.children)) {
          if (Array.isArray(children)) {
            for (const child of children) {
              traverse(child);
            }
          }
        }
      }
    };
    traverse(packageDecl);
    return identifiers.join('.') || null;
  }

  private extractFullyQualifiedName(node: JavaNode): string | null {
    const parts: string[] = [];
    const traverse = (n: JavaNode): void => {
      if (n.image && n.name === 'Identifier') {
        parts.push(n.image);
      }
      if (n.name === 'Star') {
        parts.push('*');
      }
      if (n.children) {
        for (const children of Object.values(n.children)) {
          if (Array.isArray(children)) {
            for (const child of children) {
              traverse(child);
            }
          }
        }
      }
    };
    traverse(node);
    return parts.join('.') || null;
  }

  private extractIdentifier(node: JavaNode | undefined): string | null {
    if (!node?.children) return null;

    // Check direct Identifier
    const identifier = node.children.Identifier?.[0];
    if (identifier?.image) return identifier.image;

    // Check typeIdentifier (used for class/interface names)
    const typeIdentifier = node.children.typeIdentifier?.[0];
    if (typeIdentifier?.children?.Identifier?.[0]?.image) {
      return typeIdentifier.children.Identifier[0].image;
    }

    // Check variableDeclaratorId (used for variable/parameter names)
    const varDeclId = node.children.variableDeclaratorId?.[0];
    if (varDeclId?.children?.Identifier?.[0]?.image) {
      return varDeclId.children.Identifier[0].image;
    }

    return null;
  }

  private extractAnnotations(node: JavaNode): AnnotationInfo[] {
    const annotations: AnnotationInfo[] = [];

    const processAnnotation = (annotationNode: JavaNode): void => {
      const info = this.extractAnnotationInfo(annotationNode);
      if (info) {
        annotations.push(info);
      }
    };

    const traverse = (n: JavaNode): void => {
      if (n.name === 'annotation') {
        processAnnotation(n);
        return; // Don't traverse into annotation children
      }
      if (n.children) {
        for (const key of Object.keys(n.children)) {
          const children = n.children[key];
          if (Array.isArray(children)) {
            for (const child of children) {
              // Don't traverse into method bodies
              if (key !== 'methodBody' && key !== 'constructorBody') {
                traverse(child);
              }
            }
          }
        }
      }
    };

    const modifierKeys = ['classModifier', 'methodModifier', 'fieldModifier', 'interfaceModifier'];
    for (const key of modifierKeys) {
      if (node.children?.[key]) {
        for (const modifier of node.children[key]) {
          traverse(modifier);
        }
      }
    }

    return annotations;
  }

  private extractAnnotationInfo(annotation: JavaNode): AnnotationInfo | null {
    if (!annotation.children) return null;

    // Get annotation name from typeName child
    let name: string | null = null;
    const typeName = annotation.children.typeName?.[0];
    if (typeName) {
      // typeName contains Identifier
      const identifier = typeName.children?.Identifier?.[0];
      if (identifier?.image) {
        name = identifier.image;
      } else {
        name = this.extractTypeName(typeName);
      }
    }

    if (!name) return null;

    // Get annotation value
    let value: string | string[] | Record<string, string> | undefined;

    // Check for single elementValue (e.g., @GetMapping("/users"))
    const elementValue = annotation.children.elementValue?.[0];
    if (elementValue) {
      value = this.extractElementValue(elementValue);
    }

    // Check for elementValuePairList (e.g., @RequestMapping(value = "/api", method = GET))
    const elementValuePairList = annotation.children.elementValuePairList?.[0];
    if (elementValuePairList?.children?.elementValuePair) {
      const pairs: Record<string, string> = {};
      for (const pair of elementValuePairList.children.elementValuePair) {
        const pairName = pair.children?.Identifier?.[0]?.image;
        const pairValue = pair.children?.elementValue?.[0];
        if (pairName && pairValue) {
          const extracted = this.extractElementValue(pairValue);
          if (extracted !== undefined) {
            pairs[pairName] = extracted;
          }
        }
      }
      if (Object.keys(pairs).length > 0) {
        value = pairs;
      }
    }

    return { name, value };
  }

  private extractElementValue(node: JavaNode): string | undefined {
    // Look for string literals - need to check both node structure styles
    const findStringLiteral = (n: JavaNode): string | undefined => {
      // Check if this node IS a StringLiteral token
      if (n.name === 'StringLiteral' && n.image) {
        return n.image.slice(1, -1); // Remove quotes
      }

      // Check if this node CONTAINS a StringLiteral child
      if (n.children?.StringLiteral?.[0]?.image) {
        return n.children.StringLiteral[0].image.slice(1, -1);
      }

      if (n.name === 'TextBlock' && n.image) {
        return n.image.slice(3, -3).trim();
      }
      if (n.children?.TextBlock?.[0]?.image) {
        return n.children.TextBlock[0].image.slice(3, -3).trim();
      }

      // Handle integer/boolean/etc literals
      if (n.name === 'IntegerLiteral' && n.image) {
        return n.image;
      }
      if (n.children?.IntegerLiteral?.[0]?.image) {
        return n.children.IntegerLiteral[0].image;
      }
      if ((n.name === 'True' || n.name === 'False') && n.image) {
        return n.image;
      }
      // Handle field access (e.g., RequestMethod.GET)
      if (n.name === 'Identifier' && n.image) {
        return n.image;
      }

      if (n.children) {
        for (const children of Object.values(n.children)) {
          if (Array.isArray(children)) {
            for (const child of children) {
              const result = findStringLiteral(child);
              if (result !== undefined) return result;
            }
          }
        }
      }
      return undefined;
    };

    return findStringLiteral(node);
  }

  private extractMappingPath(annotation: AnnotationInfo | undefined): string | null {
    if (!annotation) return null;

    const value = annotation.value;

    // Handle simple string value: @GetMapping("/users")
    if (typeof value === 'string') {
      return value;
    }

    // Handle array value: @GetMapping({"/users", "/api/users"})
    if (Array.isArray(value) && value.length > 0) {
      return value[0]; // Return first path
    }

    // Handle object value: @RequestMapping(value = "/users", method = GET)
    if (typeof value === 'object' && !Array.isArray(value)) {
      const v = value.value || value.path;
      if (v) return v;
    }

    return null;
  }

  private extractHttpMethod(annotation: AnnotationInfo): string | null {
    switch (annotation.name) {
      case 'GetMapping':
        return 'GET';
      case 'PostMapping':
        return 'POST';
      case 'PutMapping':
        return 'PUT';
      case 'DeleteMapping':
        return 'DELETE';
      case 'PatchMapping':
        return 'PATCH';
      case 'RequestMapping':
        // Check for method attribute
        if (typeof annotation.value === 'object' && !Array.isArray(annotation.value)) {
          const method = annotation.value.method;
          if (method) {
            // Handle RequestMethod.GET -> GET
            return method.replace('RequestMethod.', '').toUpperCase();
          }
        }
        return 'GET'; // Default for RequestMapping without method
      default:
        return null;
    }
  }

  private combinePaths(basePath: string, methodPath: string): string {
    const base = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
    const method = methodPath.startsWith('/') ? methodPath : '/' + methodPath;
    return base + method;
  }

  private extractSpringAnnotations(annotations: string[]): string[] {
    const springAnnotations = [
      'RestController',
      'Controller',
      'Service',
      'Repository',
      'Component',
      'Configuration',
      'Bean',
      'Autowired',
      'Inject',
      'Value',
      'RequestMapping',
      'GetMapping',
      'PostMapping',
      'PutMapping',
      'DeleteMapping',
      'PatchMapping',
      'PathVariable',
      'RequestBody',
      'RequestParam',
      'ResponseBody',
      'Transactional',
      'Entity',
      'Table',
      'Id',
      'Column',
      'Query',
      'Param',
      'Scheduled',
      'Async',
      'Cacheable',
      'CacheEvict',
    ];
    return annotations.filter((a) => springAnnotations.includes(a));
  }

  private extractModifiers(node: JavaNode): string[] {
    const modifiers: string[] = [];
    const modifierKeys = [
      'classModifier',
      'methodModifier',
      'fieldModifier',
      'interfaceModifier',
    ];

    for (const key of modifierKeys) {
      const modifierNodes = node.children?.[key] || [];
      for (const modifier of modifierNodes) {
        if (modifier.children) {
          for (const [name, children] of Object.entries(modifier.children)) {
            if (
              ['Public', 'Private', 'Protected', 'Static', 'Final', 'Abstract'].includes(name) &&
              Array.isArray(children) &&
              children.length > 0
            ) {
              modifiers.push(name.toLowerCase());
            }
          }
        }
      }
    }

    return modifiers;
  }

  private extractReturnType(header: JavaNode): string | null {
    const result = header.children?.result?.[0];
    if (!result?.children) return null;

    if (result.children.Void) return 'void';

    return this.extractTypeName(result) || null;
  }

  private extractTypeName(node: JavaNode): string | null {
    const parts: string[] = [];
    const traverse = (n: JavaNode): void => {
      if (n.image && n.name === 'Identifier') {
        parts.push(n.image);
      }
      if (n.children) {
        for (const children of Object.values(n.children)) {
          if (Array.isArray(children)) {
            for (const child of children) {
              traverse(child);
            }
          }
        }
      }
    };
    traverse(node);
    return parts.join('.') || null;
  }

  private extractInterfaceNames(superinterfaces: JavaNode): string[] {
    const names: string[] = [];
    const traverse = (n: JavaNode): void => {
      if (n.name === 'classType' || n.name === 'interfaceType') {
        const name = this.extractTypeName(n);
        if (name) names.push(name);
        return;
      }
      if (n.children) {
        for (const children of Object.values(n.children)) {
          if (Array.isArray(children)) {
            for (const child of children) {
              traverse(child);
            }
          }
        }
      }
    };
    traverse(superinterfaces);
    return names;
  }

  private extractParameters(
    declarator: JavaNode | undefined
  ): { name: string; type: string; annotations?: AnnotationInfo[] }[] {
    if (!declarator?.children) return [];

    const params: { name: string; type: string; annotations?: AnnotationInfo[] }[] = [];
    const formalParams = declarator.children.formalParameterList?.[0];
    if (!formalParams?.children) return params;

    const paramNodes = formalParams.children.formalParameter || [];
    for (const paramNode of paramNodes) {
      if (!paramNode.children) continue;

      const paramName = this.extractIdentifier(
        paramNode.children.variableDeclaratorId?.[0]
      );
      const paramType = this.extractTypeName(paramNode);
      const annotations = this.extractAnnotations(paramNode);

      if (paramName && paramType) {
        params.push({
          name: paramName,
          type: paramType,
          annotations: annotations.length > 0 ? annotations : undefined,
        });
      }
    }

    return params;
  }

  private extractFieldType(fieldDecl: JavaNode): string {
    const unannType = fieldDecl.children?.unannType?.[0];
    if (!unannType) return 'Object';
    return this.extractTypeName(unannType) || 'Object';
  }

  private extractMethodCallName(node: JavaNode): string | null {
    const identifiers: string[] = [];
    const traverse = (n: JavaNode): void => {
      if (n.image && n.name === 'Identifier') {
        identifiers.push(n.image);
      }
      if (n.children) {
        for (const children of Object.values(n.children)) {
          if (Array.isArray(children)) {
            for (const child of children) {
              traverse(child);
            }
          }
        }
      }
    };
    traverse(node);
    return identifiers.join('.') || null;
  }

  private hasChild(node: JavaNode, childName: string): boolean {
    if (!node.children) return false;
    return !!node.children[childName];
  }

  private getStartLine(node: JavaNode): number {
    return node.location?.startLine || 1;
  }

  private getEndLine(node: JavaNode): number {
    return node.location?.endLine || 1;
  }
}
