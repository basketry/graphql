import { Primitive } from 'basketry';

export type GraphQLOptions = {
  payload?: string[];
  types?: Record<Primitive, string>;
};

export type NamespacedGraphQLOptions = {
  graphql?: GraphQLOptions;
};
