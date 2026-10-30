// Derived from @deepseek-ai/dsh-typert-protocol/remote-info (MIT).
// Kept package-local so the persistent Host plugin needs no generated build step.
export function createTypertRemoteInfo(spec, zod) {
  return new RemoteInfo(spec, zod)
}

class RemoteInfo {
  constructor(spec, zod) {
    this.spec = spec
    this.zod = zod
    this.index = undefined
  }

  get package() { return this.spec.package }
  get descriptors() { return this.resolve().descriptors }
  get methods() { return this.resolve().methods }

  resolve() {
    if (this.index !== undefined) return this.index
    const descriptors = []
    const methods = Object.create(null)
    for (const [endpoint, definition] of Object.entries(this.spec.methods)) {
      const separator = endpoint.indexOf('/')
      const namespace = endpoint.slice(0, separator)
      const method = endpoint.slice(separator + 1)
      const parameters = definition.parameters.map(parameter => ({
        ...parameter,
        wire: parameter.wire ?? parameter.name,
      }))
      const descriptor = {
        ...definition,
        id: `${this.spec.package}#${endpoint}`,
        namespace,
        method,
        parameters,
        result: definition.result.description === undefined
          ? definition.result
          : new ResultValue(definition.result),
      }
      if (definition.invocation.kind === 'direct') {
        const inputs = []
        Object.assign(descriptor, {
          input: options => inputs[options?.strict === true ? 1 : 0] ??= new NamedInput(parameters, options?.strict === true, this.zod),
          invoke(remote, input, signal) {
            const values = parameters.map(parameter => input[parameter.wire])
            if (definition.cancellation !== undefined) values.push(signal)
            const receiver = Reflect.get(remote, namespace)
            return Reflect.get(receiver, method).apply(receiver, values)
          },
        })
        methods[endpoint] = descriptor
      }
      descriptors.push(descriptor)
    }
    return this.index = { descriptors, methods }
  }
}

class NamedInput {
  constructor(parameters, strict, zod) {
    this.parameters = parameters
    this.strict = strict
    this.zod = zod
    this.schema = undefined
    this.projection = undefined
  }

  codec(parameter) {
    return this.strict ? parameter.strictCodec : parameter.codec
  }

  create = () => this.schema ??= this.zod.strictObject(Object.fromEntries(this.parameters.map(parameter => {
    const value = this.codec(parameter).create()
    const optional = parameter.source === 'json' && parameter.acceptsUndefined === true
    return [parameter.wire, optional ? value.optional() : value.nonoptional()]
  })))

  get jsonSchema() { return this.project().jsonSchema }
  get jsonSchemaError() { return this.project().jsonSchemaError }

  project() {
    if (this.projection !== undefined) return this.projection
    const unavailable = this.parameters.find(parameter => this.codec(parameter).jsonSchema === undefined)
    if (unavailable !== undefined) {
      return this.projection = {
        jsonSchemaError: this.codec(unavailable).jsonSchemaError ?? `No JSON Schema for parameter ${unavailable.wire}`,
      }
    }
    return this.projection = {
      jsonSchema: {
        type: 'object',
        properties: Object.fromEntries(this.parameters.map(parameter => [parameter.wire, {
          ...this.codec(parameter).jsonSchema,
          ...(parameter.description === undefined ? {} : { description: parameter.description }),
        }])),
        required: this.parameters.filter(parameter => !(parameter.source === 'json' && parameter.acceptsUndefined === true)).map(parameter => parameter.wire),
        additionalProperties: false,
      },
    }
  }
}

class ResultValue {
  constructor(spec) {
    this.spec = spec
    this.projection = undefined
  }

  get mode() { return this.spec.mode }
  get typeSymbol() { return this.spec.typeSymbol }
  get create() { return this.spec.create }
  get decode() { return this.spec.decode }
  get encode() { return this.spec.encode }
  get description() { return this.spec.description }
  get jsonSchemaError() { return this.spec.jsonSchemaError }
  get jsonSchema() {
    if (this.projection === undefined) {
      const schema = this.spec.jsonSchema
      this.projection = { value: schema === undefined ? undefined : { ...schema, description: this.spec.description } }
    }
    return this.projection.value
  }
}
