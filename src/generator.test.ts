import { withGitattributes } from 'basketry';
import { readFileSync } from 'fs';
import { join } from 'path';
import generator from './generator';

const pkg = require('../package.json');
const withVersion = `${pkg.name}@${pkg.version}`;
const withoutVersion = `${pkg.name}@{{version}}`;

describe('parser', () => {
  it('recreates a valid snapshot', () => {
    // ARRANGE
    const service = require('./tools/example-store-v1-ir.json');

    // ACT
    const snapshotFiles = generator(service);

    // ASSERT
    for (const file of snapshotFiles) {
      const path = join('src', 'snapshot', ...file.path);
      const snapshot = readFileSync(path)
        .toString()
        .replace(withoutVersion, withVersion);
      expect(file.contents).toStrictEqual(snapshot);
    }
  });
});
