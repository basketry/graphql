[![main](https://github.com/basketry/graphql/workflows/build/badge.svg?branch=main&event=push)](https://github.com/basketry/graphql/actions?query=workflow%3Abuild+branch%3Amain+event%3Apush)
[![master](https://img.shields.io/npm/v/@basketry/graphql)](https://www.npmjs.com/package/@basketry/graphql)

# GraphQL support

## Generator

The provided generator creates a GraphQL schema. This package also provides a definition for the `rel` metadata type that defines the relationship between types. This allows the generator to produce a scehma that can be implemented solely by calls to the methods also defined in the service.

Use the `rel` metadata type and the provided rules to ensure that the service design includes the necessary features to support generating a GraphQL schema.f

## Rules

TODO

## Relational Metadata

The `rel` metadata type provides the syntax for defining relationships between types.

### `primaryKey`

Use `primaryKey` to indicate that a property is the primary key of an object. In a generated GraphQL schema, primary key fields are rendered with an `ID!` type.

Usage:

```json
{ "primaryKey": true }
```

### `foreignKey`

Add `foreignKey` to a property define a foreign key relationship to another type's primary key. The GraphQL schema will replace the field with a resolver to the other entity. If the field is _not_ defined in the service, then the GraphQL schema will define an "external entity" to support federation.

Usage:

```json
{
  "type": "user",
  "property": "id"
}
```

To create a connection resolver on the foreign type, use `"many": true`. This will generate the resolver and the appropriate connection and edge types.

```json
{
  "type": "user",
  "property": "id",
  "many": true
}
```

A foreign key may also be added to a parameter to indicate that it refers to a type's primary key. (Note that `many` is has no effect in this context.) Add a foreign key to a method parameter is required to indicate that a method can be used to batch-load a particular type.

### `edge`

Add `edge` to a type to define a many-to-many edge between to types. For example, to define a many-to-many edge between the `product` and `order` types, create a `productOrder` type with a foreign key to both products and orders. Then, add an `edge` rel object that includes both foreign key properties. Doing so will establish the many-to-many relationship.

Usage:

```json
{ "edge": ["productId", "orderId"] }
```

This relationship will generate two connection types—one from products to orders and another going the other way. All properties of the `productOrder` edge type (except for the foreign keys) will be added to the GraphQL edge types.

---

## For contributors:

### Run this project

1.  Install packages: `npm ci`
1.  Build the code: `npm run build`
1.  Run it! `npm start`

Note that the `lint` script is run prior to `build`. Auto-fixable linting or formatting errors may be fixed by running `npm run fix`.

### Create and run tests

1.  Add tests by creating files with the `.test.ts` suffix
1.  Run the tests: `npm t`
1.  Test coverage can be viewed at `/coverage/lcov-report/index.html`

### Publish a new package version

1. Ensure latest code is published on the `main` branch.
1. Create the new version number with `npm version {major|minor|patch}`
1. Push the branch and the version tag: `git push origin main --follow-tags`

The [publish workflow](https://github.com/basketry/graphql/actions/workflows/publish.yml) will build and pack the new version then push the package to NPM. Note that publishing requires write access to the `main` branch.

---

Generated with [generator-ts-console](https://www.npmjs.com/package/generator-ts-console)
