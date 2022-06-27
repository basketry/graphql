import { allParameters, allTypes, Rule, Violation } from 'basketry';
import { resolve } from 'path';
import { parse } from './rel';
import { Engine } from './engine';

const rules: Rule = (service, sourcePath, options) => {
  const path = resolve(process.cwd(), sourcePath);

  const violations: Violation[] = [];
  for (const { type } of allTypes(service, path, options)) {
    const typeRel = parse(type, service);
    if (typeRel?.violations.length) violations.push(...typeRel.violations);

    for (const prop of type.properties) {
      const propRel = parse(prop, service);
      if (propRel?.violations.length) violations.push(...propRel.violations);
    }
  }

  for (const { parameter } of allParameters(service, path, options)) {
    const paramRel = parse(parameter, service);
    if (paramRel?.violations.length) violations.push(...paramRel.violations);
  }

  const engine = new Engine(service, options);

  violations.push(...engine.violations);

  return violations;
};

export default rules;
