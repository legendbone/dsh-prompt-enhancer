window.__ModuleLoader__.load({
  id: '@local/dsh-prompt-enhancer',
  factory(require) {
    const React = require('react')
    const zod = require('zod')
    const z = zod.z
    const h = React.createElement
    const PACKAGE = '@local/dsh-prompt-enhancer'
    const NS = 'promptEnhancer'

    // Package-local copy of the pure Typert RemoteInfo contract (MIT).
    class RemoteInfo {
      constructor(spec, runtime) {
        this.spec = spec
        this.zod = runtime
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
          const parameters = definition.parameters.map(parameter => ({ ...parameter, wire: parameter.wire ?? parameter.name }))
          const descriptor = {
            ...definition,
            id: `${this.spec.package}#${endpoint}`,
            namespace,
            method,
            parameters,
            result: definition.result.description === undefined ? definition.result : new ResultValue(definition.result),
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
      constructor(parameters, strict, runtime) {
        this.parameters = parameters
        this.strict = strict
        this.zod = runtime
        this.schema = undefined
        this.projection = undefined
      }
      codec(parameter) { return this.strict ? parameter.strictCodec : parameter.codec }
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
          return this.projection = { jsonSchemaError: this.codec(unavailable).jsonSchemaError ?? `No JSON Schema for parameter ${unavailable.wire}` }
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
    const createTypertRemoteInfo = (spec, runtime) => new RemoteInfo(spec, runtime)

    const requestSchema = () => z.object({
      sessionId: z.string().min(1),
      prompt: z.string().min(1),
      provider: z.string().min(1),
      model: z.string().min(1),
      reasoningEffort: z.string().min(1).optional(),
    })
    const strictRequestSchema = () => z.strictObject({
      sessionId: z.string().min(1),
      prompt: z.string().min(1),
      provider: z.string().min(1),
      model: z.string().min(1),
      reasoningEffort: z.string().min(1).optional(),
    })
    const resultSchema = () => z.union([
      z.object({ ok: z.literal(true), text: z.string() }),
      z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) }),
    ])
    const REMOTE = createTypertRemoteInfo({
      package: PACKAGE,
      methods: {
        'promptEnhancer/enhance': {
          service: 'promptEnhancer',
          description: 'Improve one composer draft with the currently selected model.',
          invocation: { kind: 'direct' },
          resources: { session: request => request.sessionId },
          parameters: [{
            name: 'request',
            description: 'Session, original prompt, and selected model route.',
            source: 'json',
            codec: { mode: 'strict', typeSymbol: `${PACKAGE}#EnhanceRequest`, create: requestSchema },
            strictCodec: { mode: 'strict', typeSymbol: `${PACKAGE}#EnhanceRequest`, create: strictRequestSchema },
          }],
          cancellation: { parameter: 'signal' },
          result: { mode: 'strict', typeSymbol: `${PACKAGE}#EnhanceResult`, create: resultSchema },
        },
      },
    }, z)

    const zh = {
      action: '增强提示词',
      pending: '正在增强提示词',
      plainTextOnly: '仅支持增强纯文本提示词',
      success: '已增强提示词',
      draftChanged: '文本已修改，未覆盖当前内容',
      failed: '提示词增强失败',
    }
    const en = {
      action: 'Enhance prompt',
      pending: 'Enhancing prompt',
      plainTextOnly: 'Only plain-text prompts can be enhanced',
      success: 'Prompt enhanced',
      draftChanged: 'Draft changed; your current text was preserved',
      failed: 'Could not enhance prompt',
    }

    const CSS = `
.pe-root{position:relative;display:inline-flex;flex:none}
.pe-button{align-items:center;justify-content:center;display:inline-flex;width:28px;height:28px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.pe-button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.pe-button:disabled{opacity:.35;cursor:default}
.pe-button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.pe-tooltip{position:absolute;right:0;bottom:36px;z-index:30;width:max-content;max-width:220px;padding:6px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;opacity:0;pointer-events:none;transform:translateY(3px);transition:opacity .12s,transform .12s}
.pe-root:hover .pe-tooltip,.pe-root:focus-within .pe-tooltip{opacity:1;transform:translateY(0)}
.pe-notice{position:absolute;right:0;bottom:36px;z-index:31;width:max-content;max-width:260px;padding:7px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;white-space:normal}
.pe-notice[data-tone=success]{color:var(--dsw-alias-state-success-primary)}
.pe-notice[data-tone=warning]{color:var(--dsw-alias-state-warn-primary)}
.pe-notice[data-tone=error]{color:var(--dsw-alias-state-error-primary)}
.pe-spinner{animation:pe-spin .8s linear infinite}
@keyframes pe-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.pe-spinner{animation:none}.pe-tooltip{transition:none}}
`

    function SparkleIcon() {
      return h('svg', { viewBox: '0 0 20 20', width: 18, height: 18, 'aria-hidden': true },
        h('path', {
          d: 'M8.2 1.8l1.65 4.7 4.35 1.5-4.35 1.5L8.2 14.2 6.55 9.5 2.2 8l4.35-1.5 1.65-4.7zm7.3-.3l.85 2.65L19 5l-2.65.85L15.5 8.5l-.85-2.65L12 5l2.65-.85.85-2.65zM14.7 11l1.05 3.05 3.05 1.05-3.05 1.05L14.7 19.2l-1.05-3.05-3.05-1.05 3.05-1.05L14.7 11z',
          fill: 'currentColor',
        }))
    }

    function SpinnerIcon() {
      return h('svg', { className: 'pe-spinner', viewBox: '0 0 20 20', width: 18, height: 18, 'aria-hidden': true },
        h('circle', { cx: 10, cy: 10, r: 7, fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeDasharray: '28 16', strokeLinecap: 'round' }))
    }

    function createButton(remote, t, getModels, resolveDefaultModel) {
      return function PromptEnhancerButton(props) {
        const input = props.useInput(value => value)
        // Resolve the composer's per-session model directory — the same store the native
        // model seat renders from. Its snapshot already falls back to the catalog default,
        // whereas the raw `modelSelection` projection stays empty for a brand-new session
        // until its first message. That gap is why the button used to be disabled in new
        // conversations. Service lookup is lazy + defensive so a missing service only
        // degrades to the projection fallback instead of blocking the plugin.
        const modelDirectory = React.useMemo(() => {
          const models = getModels()
          if (models === undefined) return undefined
          try {
            return models.directoryFor(props.sessionId)
          } catch {
            return undefined
          }
        }, [getModels, props.sessionId])
        const directory = modelDirectory === undefined ? undefined : modelDirectory.store
        const subscribe = React.useCallback(listener => directory === undefined ? () => {} : directory.subscribe(listener), [directory])
        const getSnapshot = React.useCallback(() => directory === undefined ? undefined : directory.getSnapshot(), [directory])
        const modelState = React.useSyncExternalStore(subscribe, getSnapshot)
        const projected = props.useProjection('modelSelection', value => value?.next ?? value?.lastUsed)
        const selection = (modelState === undefined ? undefined : modelState.current) ?? projected
        const reasoningEffort = selection?.reasoningEffort ?? modelState?.retainedEffort
        const [pending, setPending] = React.useState(false)
        const [notice, setNotice] = React.useState(null)
        const abortRef = React.useRef(null)
        const latest = React.useRef({ input, sessionId: props.sessionId })
        latest.current = { input, sessionId: props.sessionId }

        React.useEffect(() => { modelDirectory?.load().catch(() => {}) }, [modelDirectory])
        React.useEffect(() => () => abortRef.current?.abort(), [])
        React.useEffect(() => {
          if (notice === null) return undefined
          const timer = setTimeout(() => setNotice(null), notice.tone === 'success' ? 2000 : 5000)
          return () => clearTimeout(timer)
        }, [notice])

        const hasReferences = (input?.occurrences?.length ?? 0) > 0
        const plain = input?.phase === 'plain' && !hasReferences
        // Keep the button enabled as soon as there is a plain draft. Model resolution is
        // deferred to click time with a catalog-default fallback, so a blank new session
        // (empty modelSelection projection + possibly unavailable directory store) no
        // longer leaves the button permanently greyed out.
        const disabled = pending || !input || input.draft.trim() === ''
        const label = pending ? t('pending') : hasReferences ? t('plainTextOnly') : t('action')

        const onClick = async () => {
          if (disabled) return
          const original = {
            sessionId: props.sessionId,
            draft: input.draft,
            draftRev: input.draftRev,
          }
          const controller = new AbortController()
          abortRef.current = controller
          setPending(true)
          setNotice(null)
          try {
            if (!plain) {
              setNotice({ tone: 'warning', text: t('plainTextOnly') })
              return
            }
            if (!props.inputActions) {
              setNotice({ tone: 'error', text: `${t('failed')}：无法写入输入框` })
              return
            }
            let chosen = selection
            if (chosen === undefined) {
              try { chosen = await resolveDefaultModel() } catch { chosen = undefined }
            }
            if (chosen === undefined || chosen.provider === undefined || chosen.model === undefined) {
              setNotice({ tone: 'error', text: `${t('failed')}：无法确定当前模型，请先在模型选择器中选择模型` })
              return
            }
            const chosenEffort = chosen.reasoningEffort ?? reasoningEffort
            const carried = await remote.enhance({
              sessionId: original.sessionId,
              prompt: original.draft,
              provider: chosen.provider,
              model: chosen.model,
              ...(chosenEffort === undefined ? {} : { reasoningEffort: chosenEffort }),
            }, controller.signal)
            if (controller.signal.aborted) return
            if (!carried.ok) {
              setNotice({ tone: 'error', text: carried.error.message })
              return
            }
            const result = carried.value
            if (!result.ok) {
              setNotice({ tone: 'error', text: `${t('failed')}：${result.error.message}` })
              return
            }
            const current = latest.current
            if (current.sessionId !== original.sessionId) return
            if (current.input?.draftRev !== original.draftRev || current.input?.draft !== original.draft) {
              setNotice({ tone: 'warning', text: t('draftChanged') })
              return
            }
            props.inputActions.setDraft(result.text)
            props.inputActions.focus?.()
            setNotice({ tone: 'success', text: t('success') })
          } catch (error) {
            if (!controller.signal.aborted) {
              setNotice({ tone: 'error', text: `${t('failed')}：${error instanceof Error ? error.message : String(error)}` })
            }
          } finally {
            if (abortRef.current === controller) {
              abortRef.current = null
              if (!controller.signal.aborted) setPending(false)
            }
          }
        }

        return h('span', { className: 'pe-root', 'data-pending': pending ? 'true' : 'false' },
          h('style', null, CSS),
          h('button', {
            type: 'button',
            className: 'pe-button',
            'aria-label': label,
            'aria-busy': pending,
            disabled,
            onMouseDown: event => event.preventDefault(),
            onClick,
          }, pending ? h(SpinnerIcon) : h(SparkleIcon)),
          notice === null
            ? h('span', { className: 'pe-tooltip', role: 'tooltip' }, label)
            : h('span', { className: 'pe-notice', 'data-tone': notice.tone, role: 'status' }, notice.text))
      }
    }

    return {
      inject: ['remote', 'remote.session', 'slots', 'locale'],
      async apply(ctx) {
        const unmount = await ctx.remote.$mount(REMOTE)
        ctx.effect(() => unmount, 'dsh-prompt-enhancer: Remote mount')
        const remote = ctx.get('remote.promptEnhancer')
        if (remote === undefined) throw new Error('dsh-prompt-enhancer: Remote namespace unavailable after mount')
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-prompt-enhancer: dictionaries')
        const t = ctx.locale.bind(NS)
        // Click-time fallback: read the host model catalog's default route when the
        // session's projected selection (and the per-session directory) are unavailable.
        const resolveDefaultModel = async () => {
          const res = await ctx.remote.session.modelCatalog()
          if (res === undefined || res.ok === false) return undefined
          const d = res.value === undefined ? undefined : res.value.default
          if (d === undefined || d.provider === undefined || d.model === undefined) return undefined
          return {
            provider: d.provider,
            model: d.model,
            ...(d.reasoningEffort === undefined ? {} : { reasoningEffort: d.reasoningEffort }),
          }
        }
        const Button = createButton(remote, t, () => ctx.get('modelDirectories'), resolveDefaultModel)
        ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
          name: 'conversation.input.right',
          id: 'dsh-prompt-enhancer',
          order: -10,
          locale: NS,
        }, Button))
      },
    }
  },
})
