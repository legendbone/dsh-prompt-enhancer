import { z } from 'zod'
import { createTypertRemoteInfo } from './remote-info.js'

const PACKAGE = '@local/prompt-enhancer'
const SYSTEM_PROMPT = `你是一名提示词优化助手。请优化用户提供的提示词，使其更清晰、具体、可执行，同时严格遵守以下规则：
1. 保留原始意图、语言、业务含义和已有约束，不改变任务目标。
2. 不虚构背景、需求、限制、示例或验收标准；缺少的信息不要擅自补全。
3. 优先消除歧义，梳理目标、上下文、约束、步骤和期望输出；只在原文确有对应信息时组织这些结构。
4. 删除冗余表达，保持简洁，不为了显得专业而堆砌术语。
5. 只输出优化后的提示词正文，不要解释、评价、添加标题或前后缀，不要使用 Markdown 代码围栏。`

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
  z.object({
    ok: z.literal(false),
    error: z.object({ code: z.string(), message: z.string() }),
  }),
])

const remote = createTypertRemoteInfo({
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
        codec: {
          mode: 'strict',
          typeSymbol: `${PACKAGE}#EnhanceRequest`,
          create: requestSchema,
        },
        strictCodec: {
          mode: 'strict',
          typeSymbol: `${PACKAGE}#EnhanceRequest`,
          create: strictRequestSchema,
        },
      }],
      cancellation: { parameter: 'signal' },
      result: {
        mode: 'strict',
        typeSymbol: `${PACKAGE}#EnhanceResult`,
        create: resultSchema,
      },
    },
  },
}, z)

const TYPERT = {
  package: PACKAGE,
  face: 'host',
  schemas: [],
  get invocations() { return remote.descriptors },
  model: { services: [], events: [], objects: [] },
}

function failure(code, message) {
  return { ok: false, error: { code, message } }
}

function normalizeOutput(text) {
  const trimmed = text.trim()
  const fenced = /^```[^\n]*\n([\s\S]*?)\n```$/.exec(trimmed)
  return (fenced ? fenced[1] : trimmed).trim()
}

async function enhance(ctx, request, signal) {
  try {
    const config = {
      provider: request.provider,
      model: request.model,
      maxTokens: 2048,
      ...(request.reasoningEffort === undefined ? {} : { reasoningEffort: request.reasoningEffort }),
    }
    const prepared = await ctx.llm.prepareCall(config, signal)
    let text = ''
    for await (const chunk of prepared.stream({
      ...prepared.config,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: [{ type: 'text', text: request.prompt }],
      }],
      sessionId: request.sessionId,
      signal,
    })) {
      if (chunk.type === 'text-delta') {
        text += chunk.text
        continue
      }
      if (chunk.type !== 'finish') continue
      if (chunk.reason.kind === 'stop') break
      if (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted') {
        return failure(chunk.reason.failure.code, chunk.reason.failure.message)
      }
      if (chunk.reason.kind === 'max-tokens') {
        return failure('max-tokens', 'The enhanced prompt reached the output token limit.')
      }
      return failure('unexpected-finish', `The model finished with ${chunk.reason.kind}.`)
    }
    const enhanced = normalizeOutput(text)
    if (enhanced === '') return failure('empty-result', 'The model returned an empty prompt.')
    return { ok: true, text: enhanced }
  } catch (error) {
    return failure('request-failed', error instanceof Error ? error.message : String(error))
  }
}

export const inject = ['llm', 'typert']

const SERVICE_KEY = 'promptEnhancer'

/**
 * Build the Host Service and attach its visible Typert Gateway binding.
 *
 * The Gateway resolves the live receiver with `ctx.get(serviceKey)` and then
 * requires an inspectable `typertRemote` binding whose `service` identity is
 * that same provided object (`gateway/binding-invalid` otherwise). A plain
 * `ctx.provide()` value carries no such binding, so we declare one explicitly,
 * mirroring `bindTypertRemote(service, serviceKey)` from the Typert protocol.
 */
function createService(ctx) {
  const service = {
    enhance: (request, signal) => enhance(ctx, request, signal),
  }
  Object.defineProperty(service, 'typertRemote', {
    value: Object.freeze({
      service,
      serviceKey: SERVICE_KEY,
      namespace: SERVICE_KEY,
    }),
    enumerable: true,
    writable: false,
    configurable: false,
  })
  return service
}

export function apply(ctx) {
  ctx.provide(SERVICE_KEY, createService(ctx))
  ctx.effect(() => ctx.typert.register(TYPERT), 'prompt-enhancer: Remote descriptors')
}
