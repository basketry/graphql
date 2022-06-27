## Relation meta requirements

1. define relatiionships between JSON Schema objects.
1. support generation of resolved types in GraphQL
1. support enforcemnet of "RESTful" URIs

Relation data is contained in a `rel` meta object

```json
{
  "key": "rel",
  "value": {
    // Rel data goes here
  }
}
```

### Primary key

Attached to a type's property. Indicates that the property is the type's primary key.

```json
{ "key": true }
```

Implications (type: `user`, prop: `id`):

1.  The API should define a `/user` route with an optional `ids` (plural) query param.
1.  The API should define a `/user/:id` route
1.  GraphQL type `User` property `id` is of type `ID`

### Foreign key

Attached to a type's property. Describes a relationship to another type and property defined in this service

```json
{
  "foreignKey": {
    "type": "order",
    "property": "id"
  }
}
```

Implications (local type `user`):

1. Local property name should end with `id` (fk property) such as `lastOrderId`
1. GraphQL type `User` definition should be defined with a `@key(fields: "id")` directive
1. GraphQL field should be named `lastOrder` (strip property name) and resolve an `Order` GraphQL type
1. API route `/users` should define an `orderIds` (plual fk type + fk property) query parameter
1. API should define a `users/:id/lastOrder` route that returns an `order` (type or envelope)

### "External" Foreign key

Attached to a type's property. Describes a relationship to another type and property defined somewhere else

```json
{
  "foreignKey": {
    "type": "widget",
    "property": "id",
    "external": true
  }
}
```

Implications (local type `user`):

1. Local property name should end with `id` (fk property) such as `widgetId`
1. GraphQL field on `User` should be named `widget` (strip fk property name) and resolve an `Widget` GraphQL type
1. GraphQL schema should define an empty type: `type Widget @key(fields: "id", resolvable: false) { id: ID! }`
1. API route `/users` should define an `widgetIds` (plual fk type + fk property) query parameter

### many-many

Attached to a type.

```json
{
  "has_many": [
    {
      "name": "widgets",
      "type": "widget",
      "property": "id",
      "edge": "userWidget",
      "external": true
    }
  ]
}
```

Implications (local type `user`):

1. `UserWidgetEdge` contains `node`, `cursor`, and all properties from `userWidget`
