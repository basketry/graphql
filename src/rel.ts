// TODO: decompose this module into its own package

import {
  decodeRange,
  getTypeByName,
  Meta,
  MetaValue,
  Range,
  Service,
  Type,
  Violation,
} from 'basketry';
import { resolve } from 'path';

const REL_TYPE = 'rel/type';
const REL_REFERENCE = 'rel/reference';

const cache = new WeakMap<Service, WeakMap<any, Rel | null>>();

export function parse(obj: { meta?: Meta }, service: Service): Rel | undefined {
  const hit = cache.get(service)?.get(obj);
  if (hit === null) return undefined; // null means we know the rel does not exist, so return undefined
  if (hit === undefined) {
    if (!cache.has(service)) cache.set(service, new WeakMap());
    const rel = uncachedParse(obj, service);
    cache.get(service)!.set(obj, rel ? rel : null);
    return rel;
  }

  return hit;
}

export function isPrimaryKey(obj: { meta?: Meta }, service: Service): boolean {
  return parse(obj, service)?.meta?.kind === 'primaryKey';
}

export function isForeignKey(obj: { meta?: Meta }, service: Service): boolean {
  return parse(obj, service)?.meta?.kind === 'foreignKey';
}

export function isEdgeKey(obj: { meta?: Meta }, service: Service): boolean {
  return parse(obj, service)?.meta?.kind === 'edge';
}

export function getForeignKey(
  obj: { meta?: Meta },
  service: Service,
): ForeignKey | undefined {
  const rel = parse(obj, service)?.meta;

  return rel?.kind === 'foreignKey' ? rel : undefined;
}

export function getEdge(
  obj: { meta?: Meta },
  service: Service,
): Edge | undefined {
  const rel = parse(obj, service)?.meta;

  return rel?.kind === 'edge' ? rel : undefined;
}

export function getRange(obj: { meta?: Meta }): Range {
  const meta = getMeta(obj);
  return decodeRange(meta?.value.loc);
}

function getMeta(obj: { meta?: Meta } | undefined): MetaValue | undefined {
  return obj?.meta?.find((x) => x.key.value === 'rel');
}

function uncachedParse(
  obj: { meta?: Meta },
  service: Service,
): Rel | undefined {
  const violations: Violation[] = [];
  const meta = getMeta(obj);
  if (meta === undefined) return undefined;

  const range = getRange(obj); // decodeRange(meta.value.loc);

  function violation(code: string, message: string): Violation {
    return {
      code,
      message,
      range,
      severity: 'warning',
      sourcePath: resolve(process.cwd(), service.sourcePath),
    };
  }
  function typeViolation(message: string): Violation {
    return violation(REL_TYPE, message);
  }
  function referenceViolation(message: string): Violation {
    return violation(REL_REFERENCE, message);
  }

  const value = meta.value?.value;
  if (!isObject(value)) {
    return {
      meta: undefined,
      violations: [typeViolation('"rel" must be an object if provided.')],
    };
  }

  const { primaryKey, foreignKey, edge, ...relRest } = value;
  if (primaryKey !== undefined && typeof primaryKey !== 'boolean') {
    violations.push(
      typeViolation('"rel/primaryKey" must be a boolean if provided.'),
    );
  }
  if (foreignKey !== undefined) {
    if (isObject(foreignKey)) {
      const { type, property, many, ...foreignKeyRest } = foreignKey;
      if (typeof type !== 'string') {
        violations.push(
          typeViolation('"rel/foreignKey/type" must be a string.'),
        );
      }
      if (typeof property !== 'string') {
        violations.push(
          typeViolation('"rel/foreignKey/property" must be a string.'),
        );
      }
      if (many !== undefined && typeof many !== 'boolean') {
        violations.push(
          typeViolation('"rel/foreignKey/many" must be a boolean if provided.'),
        );
      }
      if (Object.keys(foreignKeyRest).length) {
        violations.push(
          typeViolation(
            '"rel/foreignKey" many only define "type", "property", and "many". Additional properties are prohibited.',
          ),
        );
      }
    } else {
      violations.push(
        typeViolation('"rel/foreignKey" must be an object if provided.'),
      );
    }
  }
  if (edge !== undefined) {
    if (Array.isArray(edge)) {
      if (edge.length !== 2) {
        violations.push(typeViolation('"rel/edge" must have a length of 2.'));
      }
      if (edge.some((e) => typeof e !== 'string')) {
        violations.push(typeViolation('"rel/edge" may only contain strings.'));
      }
    } else {
      violations.push(
        typeViolation('"rel/edge" must be an array if provided.'),
      );
    }
  }
  if (
    [primaryKey, foreignKey, edge].filter((x) => x).length !== 1 ||
    Object.keys(relRest).length
  ) {
    violations.push(
      typeViolation(
        '"rel" must define only one of "primaryKey", "foreignKey", or "edge". Additional properties are prohibited.',
      ),
    );
  }
  if (violations.length) {
    return { meta: undefined, violations };
  }

  if (primaryKey) {
    return { meta: { kind: 'primaryKey' }, violations };
  } else if (foreignKey) {
    const { type, property, many } = foreignKey;
    const foreignType = getTypeByName(service, type);
    if (foreignType) {
      const prop = foreignType.properties.find(
        (p) => p.name.value === property,
      );

      if (!prop) {
        violations.push(
          referenceViolation(
            `Property "${property}" does not exist on type "${type}".`,
          ),
        );
      } else {
        if (uncachedParse(prop, service)?.meta?.kind !== 'primaryKey') {
          violations.push(
            referenceViolation(
              `Property "${property}" on type "${type}" must be a primary key.`,
            ),
          );
        }
      }
    }

    if (violations.length) return { meta: undefined, violations };
    return {
      meta: { kind: 'foreignKey', type, property, many: many || false },
      violations,
    };
  } else if (edge) {
    const type = obj as Type;
    const name = type.name?.value;
    if (name) {
      const a = type.properties?.find((p: any) => p.name?.value === edge[0]);
      const b = type.properties?.find((p: any) => p.name?.value === edge[1]);

      if (!a) {
        violations.push(
          referenceViolation(
            `Property "${edge[0]}" does not exist on type "${name}".`,
          ),
        );
      } else if (!getForeignKey(a, service)) {
        violations.push(
          referenceViolation(
            `Property "${edge[0]}" does not explicitly define a foreign key.`,
          ),
        );
      }

      if (!b) {
        violations.push(
          referenceViolation(
            `Property "${edge[1]}" does not exist on type "${name}".`,
          ),
        );
      } else if (!getForeignKey(b, service)) {
        violations.push(
          referenceViolation(
            `Property "${edge[1]}" does not explicitly define a foreign key.`,
          ),
        );
      }
    }

    if (violations.length) return { meta: undefined, violations };
    return { meta: { kind: 'edge', types: edge }, violations };
  }
  return { meta: undefined, violations };
}

function isObject(obj: any): obj is Record<string, any> {
  return typeof obj === 'object';
}

export type Rel = {
  meta: PrimaryKey | ForeignKey | Edge | undefined;
  violations: Violation[];
};

export type PrimaryKey = { kind: 'primaryKey' };
export type ForeignKey = {
  kind: 'foreignKey';
  type: string;
  property: string;
  many: boolean;
};
export type Edge = { kind: 'edge'; types: [string, string] };
