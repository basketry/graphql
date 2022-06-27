import {
  Enum,
  isRequired,
  Literal,
  Property,
  Service,
  Type,
  TypedValue,
  ValidationRule,
} from 'basketry';
import { camel, pascal } from 'case';
import { NamespacedGraphQLOptions } from './types';

export function buildPropertyName(prop: Property) {
  return camel(prop.name.value);
}

/** Name of a type that appears in the schema */
export function buildSchemaTypeName(type: Type) {
  return pascal(type.name.value);
}

/** Name of an enum that appears in the schema */
export function buildSchemaEnumName(e: Enum) {
  return pascal(e.name.value);
}

/** Name of a type that appears in the schema */
export function buildTypedValueName(
  type: { name: Literal<string>; rules?: ValidationRule[] } & TypedValue,
  id: boolean,
  service: Service,
  options: NamespacedGraphQLOptions | undefined,
  raw: boolean = false,
) {
  const render = (n: string) => {
    if (raw) return n;
    const x = type.isArray ? `[${n}!]` : n;
    return isRequired(type) ? `${x}!` : x;
  };

  if (id) return render('ID');

  if (type.isPrimitive) {
    const override = options?.graphql?.types?.[type.typeName.value];
    if (override) {
      return render(override);
    }

    switch (type.typeName.value) {
      case 'boolean':
        return render('Boolean');
      case 'double':
      case 'float':
      case 'number':
        return render('Float');
      case 'integer':
      case 'long':
        return render('Int');
      case 'date':
      case 'date-time':
      case 'string':
      case 'null':
      case 'untyped':
        return render('String');
    }
  }
  return render(pascal(type.typeName.value));
}
