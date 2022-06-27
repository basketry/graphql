import {
  allMethods,
  Enum,
  getEnumByName,
  getTypeByName,
  Method,
  Parameter,
  Property,
  Range,
  Service,
  Type,
  Violation,
} from 'basketry';
import { camel, pascal, snake } from 'case';
import {
  ForeignKey,
  getEdge,
  getForeignKey,
  getRange,
  isPrimaryKey,
} from './rel';
import { NamespacedGraphQLOptions } from './types';
import { plural } from 'pluralize';
import { resolve } from 'path';

export type Resolvers = {
  properties: WeakMap<Property, Key | EntityResolver>;
  virtual: Set<ConnectionResolver | EdgeResolver>;
};

export type Key = {
  kind: 'key';
  name: string;
};

export type EntityResolver = {
  kind: 'entity';
  name: string;
  entityType: string;
  resolveWith: {
    method: Method;
    param: Parameter;
    entityPayload: string;
  };
  parameters: Parameter[];
};

export type ConnectionResolver = {
  kind: 'connection';
  name: string;
  entityType: string;
  resolveWith: {
    method: Method;
    param: Parameter;
    entityPayload: string;
  };
  parameters: Parameter[];
};

export type EdgeResolver = {
  kind: 'edge';
  name: string;
  entityType: string;
  edgeType: string;
  resolveWith: {
    method: Method;
    param: Parameter;
    entityPayload: string;
    edgePayload: string;
  };
  parameters: Parameter[];
};

export class Engine {
  constructor(
    private readonly service: Service,
    private readonly options: NamespacedGraphQLOptions,
  ) {
    this.allowedPayloadProps = new Set(
      this.options?.graphql?.payload || ['data', 'value', 'values'],
    );
    this.indexMethods();
    this.indexTypes();
    this.indexEnums();
    this.indexResolvers();
    this.indexConnections();
    this.indexEdges();
  }
  private readonly allowedPayloadProps = new Set<string>();
  private readonly methodsCache = new Set<Method>();
  private readonly typesCache = new Set<Type>();
  private readonly enumsCache = new Set<Enum>();
  private readonly resolversCache = new WeakMap<Type, Resolvers>();

  private readonly connections = new Set<Type>();
  private readonly externalTypeCache = new Map<string, [string]>();
  private readonly _violations: Violation[] = [];

  private indexMethods() {
    const getMethods = allMethods(
      this.service,
      this.service.sourcePath,
      this.options,
    ).filter((x) => x.httpMethod?.verb.value === 'get');

    for (const ctx of getMethods) {
      this.methodsCache.add(ctx.method);

      const returnType = getTypeByName(
        this.service,
        ctx.method.returnType?.typeName.value,
      );

      if (!returnType) continue;

      const payload = returnType.properties.find((prop) =>
        this.allowedPayloadProps.has(prop.name.value),
      );
      if (!payload) continue;

      const payloadType = getTypeByName(this.service, payload.typeName.value);
      if (!payloadType) continue;

      if (payload.isArray) this.connections.add(payloadType);
    }
  }

  private indexTypes() {
    const methodReturnTypes = new Set(
      this.methods
        .map((method) => method.returnType?.typeName?.value)
        .filter((n): n is string => typeof n === 'string')
        .map((typeName) => getTypeByName(this.service, typeName))
        .filter((type): type is Type => !!type),
    );

    for (const methodReturnType of methodReturnTypes) {
      for (const type of traverseType(this.service, methodReturnType)) {
        this.typesCache.add(type);
      }
      if (isEnvelope(methodReturnType))
        this.typesCache.delete(methodReturnType);
    }
  }

  /** Finds all of the enums that can be traversed from found types */
  private indexEnums() {
    const types = this.types;

    for (const type of types) {
      for (const prop of type.properties) {
        if (prop.isPrimitive) continue;
        const e = getEnumByName(this.service, prop.typeName.value);
        if (e) this.enumsCache.add(e);
      }
    }
  }

  private indexResolvers() {
    const paging = new Set(['first', 'after', 'last', 'before']);

    for (const type of this.types) {
      const resolvers: Resolvers = {
        properties: new WeakMap(),
        virtual: new Set(),
      };
      this.resolversCache.set(type, resolvers);

      for (const prop of type.properties) {
        if (isPrimaryKey(prop, this.service)) {
          resolvers.properties.set(prop, {
            kind: 'key',
            name: prop.name.value,
          });
        } else {
          const fk = getForeignKey(prop, this.service);
          if (!fk) continue;

          const foreignType = getTypeByName(this.service, fk.type);
          if (!foreignType) {
            this.externalTypeCache.set(pascal(fk.type), [fk.property]);
            continue;
          }

          const resolveWith = this.getMethod(foreignType, fk);
          if (!resolveWith) {
            this._violations.push(
              this.resolverMethodViolation(foreignType, fk, getRange(prop)),
            );
            continue;
          }

          const name = cleanForeignKeyName(prop.name.value, fk.property);
          const parameters = resolveWith.method.parameters.filter(
            (param) =>
              param !== resolveWith.param &&
              !paging.has(snake(param.name.value)),
          );

          resolvers.properties.set(prop, {
            kind: 'entity',
            entityType: foreignType.name.value,
            name,
            resolveWith,
            parameters,
          });
        }
      }
    }
  }

  private indexConnections() {
    for (const type of this.types) {
      for (const prop of type.properties) {
        const fk = getForeignKey(prop, this.service);
        if (!fk?.many) continue;

        const foreignType = getTypeByName(this.service, fk.type);
        if (!foreignType) continue;

        const key = type.properties.find((p) => isPrimaryKey(p, this.service));
        if (!key) continue;

        const resolveWith = this.getMethod(type, fk);
        if (!resolveWith) {
          this._violations.push(
            this.resolverMethodViolation(type, fk, getRange(prop)),
          );
          continue;
        }

        const name = plural(type.name.value);

        this.connections.add(type);

        this.resolversCache.get(foreignType)?.virtual.add({
          kind: 'connection',
          name,
          entityType: type.name.value,
          resolveWith,
          parameters: resolveWith.method.parameters.filter(
            (param) =>
              param !== resolveWith.param &&
              getForeignKey(param, this.service)?.type !== type.name.value,
          ),
        });
      }
    }
  }

  private indexEdges() {
    for (const edgeType of this.service.types) {
      const e = getEdge(edgeType, this.service);
      if (!e) continue;

      const [a, b] = e.types;

      const propA = edgeType.properties.find((prop) => prop.name.value === a);
      const propB = edgeType.properties.find((prop) => prop.name.value === b);
      if (!propA || !propB) continue;

      const fkA = getForeignKey(propA, this.service);
      const fkB = getForeignKey(propB, this.service);
      if (!fkA || !fkB) continue;

      const typeA = getTypeByName(this.service, fkA.type);
      const typeB = getTypeByName(this.service, fkB.type);
      if (!typeA || !typeB) continue;

      const resolveAWith = this.getMethod(typeB, fkA, edgeType);
      const resolveBWith = this.getMethod(typeA, fkB, edgeType);

      if (!resolveAWith?.edgePayload) {
        this._violations.push(
          this.resolverMethodViolation(typeB, fkA, getRange(propA)),
        );
      }

      if (!resolveBWith?.edgePayload) {
        this._violations.push(
          this.resolverMethodViolation(typeA, fkB, getRange(propB)),
        );
      }

      if (!resolveAWith?.edgePayload || !resolveBWith?.edgePayload) continue;

      const nameA = plural(typeB.name.value); // plural form of the other type name
      const nameB = plural(typeA.name.value); // plural form of the other type name

      this.resolversCache.get(typeA)?.virtual.add({
        kind: 'edge',
        name: nameA,
        entityType: typeB.name.value,
        edgeType: edgeType.name.value,
        resolveWith: {
          ...resolveAWith,
          edgePayload: resolveAWith.edgePayload, // Typescript needs this :(
        },
        parameters: resolveAWith.method.parameters.filter(
          (param) =>
            param !== resolveAWith.param &&
            getForeignKey(param, this.service)?.type !== typeB.name.value,
        ),
      });

      this.resolversCache.get(typeB)?.virtual.add({
        kind: 'edge',
        name: nameB,
        entityType: typeA.name.value,
        edgeType: edgeType.name.value,
        resolveWith: {
          ...resolveBWith,
          edgePayload: resolveBWith.edgePayload, // Typescript needs this :(
        },
        parameters: resolveBWith.method.parameters.filter(
          (param) =>
            param !== resolveBWith.param &&
            getForeignKey(param, this.service)?.type !== typeA.name.value,
        ),
      });

      this.typesCache.delete(edgeType);
      this.resolversCache.delete(edgeType);
    }
  }

  private resolverMethodViolation(
    foreignType: Type,
    fk: ForeignKey,
    range: Range,
  ): Violation {
    const type = fk.type;
    const prop = fk.property;

    const summary = `Service must define a method capable of batch-loading ${plural(
      foreignType.name.value,
    )} by "${type}.${prop}".`;

    const parameterClause = `The method must accept an array parameter (eg. ${plural(
      camel(`${type}_${prop}`),
    )}) with an explicit foreign key to "${type}.${prop}".`;

    const returnTypeClause = `Also, the method's return type must define an array of ${plural(
      foreignType.name.value,
    )} in a property named ${oxfordComma(
      Array.from(this.allowedPayloadProps).map((p) => `"${p}"`),
      'or',
    )}.`;

    const msg = [summary, parameterClause, returnTypeClause].join(' ');

    return this.violation('graphql/resolver-method', msg, range);
  }

  private getMethod(
    returns: Type,
    propFK: ForeignKey,
    edgeType?: Type,
  ):
    | {
        method: Method;
        param: Parameter;
        entityPayload: string;
        edgePayload: string | undefined;
      }
    | undefined {
    for (const method of this.methods) {
      const returnType = getTypeByName(
        this.service,
        method.returnType?.typeName.value,
      );
      if (!returnType) continue;

      const param = method.parameters.find((p) => {
        const fk = getForeignKey(p, this.service);
        return propFK.property === fk?.property && propFK.type === fk.type;
      });
      if (!param) continue;

      const edgePayload = returnType.properties.find(
        (prop) =>
          edgeType && snake(prop.typeName.value) === snake(edgeType.name.value),
      );

      for (const prop of returnType.properties) {
        if (
          prop.isArray &&
          this.allowedPayloadProps.has(prop.name.value) &&
          getTypeByName(this.service, prop.typeName.value) === returns
        ) {
          return {
            method,
            param,
            entityPayload: prop.name.value,
            edgePayload: edgePayload?.name.value,
          };
        }
      }
    }
    return undefined;
  }

  /** Gets all of the types that can be traversed from GET methods exluding method response evelopes */
  get types(): Type[] {
    return Array.from(this.typesCache);
  }

  get enums(): Enum[] {
    return Array.from(this.enumsCache);
  }

  get methods(): Method[] {
    return Array.from(this.methodsCache);
  }

  public isKey(type: Type, prop: Property): boolean {
    return this.getResolver(type, prop)?.kind === 'key';
  }

  public hasConnection(type: Type): boolean {
    return this.connections.has(type);
  }

  public getResolver(type: Type, prop: Property) {
    return this.resolversCache.get(type)?.properties.get(prop);
  }

  public getConnections(type: Type) {
    return this.resolversCache.get(type)?.virtual;
  }

  public getResolvers(type: Type): Resolvers {
    return (
      this.resolversCache.get(type) || {
        properties: new WeakMap(),
        virtual: new Set(),
      }
    );
  }

  get externalTypes(): { name: string; keys: string[] }[] {
    return Array.from(this.externalTypeCache).map(([name, keys]) => ({
      name,
      keys,
    }));
  }

  get violations() {
    return [...this._violations];
  }

  private violation(code: string, message: string, range: Range): Violation {
    return {
      code,
      message,
      range,
      severity: 'error',
      sourcePath: resolve(process.cwd(), this.service.sourcePath),
    };
  }
}

function* traverseType(service: Service, type: Type): Iterable<Type> {
  yield type;

  for (const prop of type.properties) {
    if (!prop.isPrimitive) {
      const subtype = getTypeByName(service, prop.typeName.value);
      if (subtype) yield* traverseType(service, subtype);
      // TODO: traverse unions
    }
  }
}

function isEnvelope(type: Type): boolean {
  return type.properties.some(
    (prop) =>
      prop.name.value.toLowerCase() === 'errors' &&
      prop.isArray &&
      !prop.isPrimitive,
  );
}

function cleanForeignKeyName(localName: string, foreignName: string): string {
  const root = snake(localName);
  const suffix = `_${snake(foreignName)}`;

  return camel(
    root.endsWith(suffix)
      ? root.substring(0, root.length - suffix.length)
      : root,
  );
}

function oxfordComma(
  items: string[],
  conjunction: 'and' | 'or' | 'and/or',
): string {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} ${conjunction} ${items[1]}`;

  const [last, ...rest] = [...items].reverse();

  return `${rest.reverse().join(', ')}, ${conjunction} ${last}`;
}
