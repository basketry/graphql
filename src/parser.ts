import { Parser } from 'basketry';

const parser: Parser = (sourceContent) => ({
  service: JSON.parse(sourceContent),
  violations: [],
});

export default parser;
