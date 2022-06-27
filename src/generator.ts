import {
  Enum,
  Generator,
  getTypeByName,
  isRequired,
  Literal,
  Method,
  Parameter,
  Property,
  Service,
  Type,
} from 'basketry';
import { camel, constant, kebab, pascal, snake } from 'case';

import {
  buildPropertyName,
  buildSchemaEnumName,
  buildSchemaTypeName,
  buildTypedValueName,
} from './name-factory';
import { NamespacedGraphQLOptions } from './types';
import { block } from './utils';
import { getForeignKey, isPrimaryKey } from './rel';
import { EdgeResolver, Engine } from './engine';

const generator: Generator = (service, options) => [
  {
    path: [`${kebab(service.title.value)}.graphql`],
    contents: new SchemaFactory(service, options).build(),
  },
];

export default generator;

class SchemaFactory {
  constructor(
    private readonly service: Service,
    private readonly options: NamespacedGraphQLOptions,
  ) {
    this.engine = new Engine(service, options);
  }

  private readonly engine: Engine;

  build(): string {
    return Array.from(this.buildSchema()).join('\n');
  }

  private *buildSchema(): Iterable<string> {
    yield* this.buildQueryType();

    for (const type of this.engine.types.sort(byName)) {
      yield* this.buildType(type);
    }

    for (const e of this.engine.enums.sort(byName)) {
      yield* this.buildEnum(e);
    }

    yield* this.buildExternalTypes();
  }

  private *buildType(type: Type): Iterable<string> {
    const self = this;
    yield* this.buildDescription(type.description);

    const keys = type.properties.filter((p) => this.engine.isKey(type, p));

    const keysDirective = keys.length
      ? ` @key(fields: ${keys
          .map((prop) => `"${camel(prop.name.value)}"`)
          .join(', ')})`
      : '';

    const connections = new Set<EdgeResolver>();

    yield* block(
      `type ${buildSchemaTypeName(type)}${keysDirective}`,
      function* () {
        for (const prop of type.properties) {
          yield* self.buildProperty(type, prop);
        }

        for (const connection of self.engine.getConnections(type) || []) {
          if (connection.kind === 'connection') {
            yield `${camel(connection.name)}${self.buildParameters(
              connection.parameters,
            )}: ${pascal(connection.entityType)}Connection!`;
          } else if (connection.kind === 'edge') {
            connections.add(connection);
            yield `${camel(connection.name)}${self.buildParameters(
              connection.parameters,
            )}: ${pascal(
              `${type.name.value}_${connection.entityType}`,
            )}Connection!`;
          }
        }
      },
    );

    if (this.engine.hasConnection(type)) {
      yield* this.buildConnection(type);
    }

    for (const connection of connections) {
      yield* this.buildDirectionalConnection(type, connection);
    }
  }

  private buildParameters(parameters: Parameter[]): string {
    if (!parameters.length) return '';

    const params = parameters
      .map(
        (param) =>
          `${camel(param.name.value)}: ${buildTypedValueName(
            param,
            false,
            this.service,
            this.options,
            false,
          )}`,
      )
      .join(', ');

    return `(${params})`;
  }

  private *buildExternalTypes(): Iterable<string> {
    for (const { name, keys } of this.engine.externalTypes.sort(byName)) {
      yield* block(
        `type ${name} @key(fields: ${keys
          .map((key) => `"${key}"`)
          .join(', ')}, resolvable: false)`,
        function* () {
          for (const key of keys) {
            yield `${camel(key)}: ID!`;
          }
        },
      );
    }
  }

  private *buildProperty(type: Type, prop: Property): Iterable<string> {
    const resolver = this.engine.getResolver(type, prop);

    yield* this.buildDescription(prop.description);

    if (resolver?.kind === 'key') {
      yield `${prop.name.value}: ID!`;
    } else if (resolver?.kind === 'entity') {
      yield `${camel(resolver.name)}: ${pascal(resolver.entityType)}${
        isRequired(prop) ? '!' : ''
      }`;
    } else {
      yield `${buildPropertyName(prop)}: ${buildTypedValueName(
        prop,
        isPrimaryKey(prop, this.service),
        this.service,
        this.options,
        false,
      )}`;
    }
  }

  private *buildEnum(e: Enum): Iterable<string> {
    yield* block(`enum ${buildSchemaEnumName(e)}`, function* () {
      for (const value of e.values) {
        yield constant(value.value);
      }
    });
  }

  private *buildConnection(type: Type): Iterable<string> {
    const name = buildSchemaTypeName(type);
    yield* block(`type ${name}Edge`, function* () {
      yield `node: ${name}!`;
      yield `cursor: String!`;
    });
    yield* block(`type ${name}Connection`, function* () {
      yield `nodes: [${name}!]!`;
      yield `edges: [${name}Edge!]!`;
      yield `pageInfo: PageInfo!`;
    });
  }

  private *buildDirectionalConnection(
    fromType: Type,
    connection: EdgeResolver,
  ): Iterable<string> {
    const self = this;
    const edge = getTypeByName(this.service, connection.edgeType);
    const from = pascal(fromType.name.value);
    const to = pascal(connection.entityType);
    const fromTo = `${from}${to}`;
    yield* block(`type ${fromTo}Edge`, function* () {
      yield `node: ${to}!`;
      yield `cursor: String!`;
      for (const prop of edge?.properties || []) {
        const fk = getForeignKey(prop, self.service);
        if (
          !edge ||
          fk?.type === fromType.name.value ||
          fk?.type === connection.entityType
        ) {
          continue;
        }
        yield* self.buildProperty(edge, prop);
      }
    });
    yield* block(`type ${fromTo}Connection`, function* () {
      yield `nodes: [${to}!]!`;
      yield `edges: [${fromTo}Edge!]!`;
      yield `pageInfo: PageInfo!`;
    });
  }

  private *buildQueryType(): Iterable<string> {
    const self = this;

    const methods = this.engine.methods.sort((a, b) =>
      cleanGetMethodName(a.name.value).localeCompare(
        cleanGetMethodName(b.name.value),
      ),
    );

    yield* block('type Query', function* () {
      for (const method of methods) {
        yield self.buildQueryMethod(method);
      }
    });
  }

  private buildQueryMethod(method: Method): string {
    const name = cleanGetMethodName(method.name.value);
    const params = method.parameters
      .map(
        (param) =>
          `${camel(param.name.value)}: ${buildTypedValueName(
            param,
            false,
            this.service,
            this.options,
            false,
          )}`,
      )
      .join(', ');
    const returnType = this.buildResolverType(method);

    return `${name}(${params}): ${returnType}`;
  }

  private *buildDescription(
    description: Literal<string> | Literal<string>[] | undefined,
  ): Iterable<string> {
    if (description) {
      yield '"""';
      if (Array.isArray(description)) {
        for (const line of description) {
          yield line.value;
        }
      } else {
        yield description.value;
      }
      yield '"""';
    }
  }

  private buildResolverType(method: Method) {
    const type = getTypeByName(this.service, method.returnType?.typeName.value);
    if (!type) return 'Unknown';

    const set = new Set(['data', 'value', 'values']);
    const payload = type.properties.find((prop) =>
      set.has(snake(prop.name.value)),
    );

    if (payload && isEnvelope(type)) {
      if (isConnection(method, this.service)) {
        const name = buildTypedValueName(
          payload,
          false,
          this.service,
          this.options,
          true,
        );
        return `${name}Connection!`;
      }
      return buildTypedValueName(
        payload,
        false,
        this.service,
        this.options,
        false,
      );
    }

    return buildSchemaTypeName(type);
  }
}

function cleanGetMethodName(name: string): string {
  const [first, ...rest] = snake(name).split('_');

  return first === 'get' || first === 'fetch'
    ? camel(rest.join('_'))
    : camel(name);
}

function isConnection(method: Method, service: Service): boolean {
  const returnType = getTypeByName(service, method.returnType?.typeName.value);
  if (!returnType) return false;

  if (
    !returnType.properties.some((prop) =>
      isPageInfo(getTypeByName(service, prop.typeName.value)),
    )
  ) {
    return false;
  }

  if (
    !method.parameters.some(
      (param) =>
        snake(param.name.value) === 'first' &&
        !param.isArray &&
        param.isPrimitive &&
        param.typeName.value === 'integer' &&
        !isRequired(param),
    )
  ) {
    return false;
  }

  if (
    !method.parameters.some(
      (param) =>
        snake(param.name.value) === 'after' &&
        !param.isArray &&
        param.isPrimitive &&
        param.typeName.value === 'string' &&
        !isRequired(param),
    )
  ) {
    return false;
  }

  if (
    !method.parameters.some(
      (param) =>
        snake(param.name.value) === 'last' &&
        !param.isArray &&
        param.isPrimitive &&
        param.typeName.value === 'integer' &&
        !isRequired(param),
    )
  ) {
    return false;
  }

  if (
    !method.parameters.some(
      (param) =>
        snake(param.name.value) === 'before' &&
        !param.isArray &&
        param.isPrimitive &&
        param.typeName.value === 'string' &&
        !isRequired(param),
    )
  ) {
    return false;
  }

  return true;
}

function isPageInfo(type: Type | undefined): boolean {
  if (!type) return false;

  if (snake(type.name.value) !== 'page_info') return false;

  if (
    !type.properties.some(
      (prop) =>
        snake(prop.name.value) === 'has_previous_page' &&
        !prop.isArray &&
        prop.isPrimitive &&
        prop.typeName.value === 'boolean' &&
        isRequired(prop),
    )
  ) {
    return false;
  }

  if (
    !type.properties.some(
      (prop) =>
        snake(prop.name.value) === 'has_next_page' &&
        !prop.isArray &&
        prop.isPrimitive &&
        prop.typeName.value === 'boolean' &&
        isRequired(prop),
    )
  ) {
    return false;
  }

  if (
    !type.properties.some(
      (prop) =>
        snake(prop.name.value) === 'start_cursor' &&
        !prop.isArray &&
        prop.isPrimitive &&
        prop.typeName.value === 'string',
    )
  ) {
    return false;
  }

  if (
    !type.properties.some(
      (prop) =>
        snake(prop.name.value) === 'end_cursor' &&
        !prop.isArray &&
        prop.isPrimitive &&
        prop.typeName.value === 'string',
    )
  ) {
    return false;
  }

  return true;
}

function isEnvelope(type: Type): boolean {
  return type.properties.some(
    (prop) =>
      prop.name.value.toLowerCase() === 'errors' &&
      prop.isArray &&
      !prop.isPrimitive,
  );
}

function byName(
  a: { name: string | Literal<string> },
  b: { name: string | Literal<string> },
): number {
  const aa = isLiteral(a.name) ? a.name.value : a.name;
  const bb = isLiteral(b.name) ? b.name.value : b.name;

  return aa.localeCompare(bb);
}

function isLiteral<T extends string | number | boolean | null>(
  value: T | Literal<T>,
): value is Literal<T> {
  return typeof value === 'object';
}
