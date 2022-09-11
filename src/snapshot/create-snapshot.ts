import { withGitattributes } from 'basketry';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import generator from '../generator';
import { Engine } from '../engine';

const pkg = require('../../package.json');
const withVersion = `${pkg.name}@${pkg.version}`;
const withoutVersion = `${pkg.name}@{{version}}`;

const service = require('../tools/example-store-v1-ir.json');

// printRelationships(new Engine(service, {}));

const snapshotFiles = generator(service);

for (const file of snapshotFiles) {
  const path = file.path.slice(0, file.path.length - 1);
  const filename = file.path[file.path.length - 1];

  const fullpath = [process.cwd(), 'src', 'snapshot', ...path];

  mkdirSync(join(...fullpath), { recursive: true });
  writeFileSync(
    join(...fullpath, filename),
    file.contents.replace(withVersion, withoutVersion),
  );
}

function printRelationships(engine: Engine) {
  for (const type of engine.types) {
    console.log('type', type.name.value);
    for (const prop of type.properties) {
      const r = engine.getResolver(type, prop);

      if (r) {
        if (r.kind === 'key') {
          console.log(prop.name.value, r);
        } else {
          const {
            kind,
            entityType,
            name,
            resolveWith: { entityPayload, method, param },
            parameters,
          } = r;

          console.log(prop.name.value, {
            kind,
            entityType,
            name,
            resolveWith: {
              entityPayload,
              method: method.name.value,
              param: param.name.value,
            },
            parameters: parameters.map((p) => p.name.value),
          });
        }
      }
    }

    for (const r of engine.getResolvers(type).virtual) {
      if (r.kind === 'connection') {
        const {
          kind,
          entityType,
          name,
          resolveWith: { entityPayload, method, param },
          parameters,
        } = r;

        console.log({
          kind,
          entityType,
          name,
          resolveWith: {
            entityPayload,
            method: method.name.value,
            param: param.name.value,
          },
          parameters: parameters.map((p) => p.name.value),
        });
      } else if (r.kind === 'edge') {
        const {
          kind,
          entityType,
          name,
          resolveWith: { entityPayload, method, param, edgePayload },
          parameters,
        } = r;

        console.log({
          kind,
          entityType,
          name,
          resolveWith: {
            entityPayload,
            method: method.name.value,
            param: param.name.value,
            edgePayload,
          },
          parameters: parameters.map((p) => p.name.value),
        });
      }
    }
    console.log('===================================');
  }
}
