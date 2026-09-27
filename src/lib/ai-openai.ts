/**
 * The OpenAI-compatible half of `ai.ts` — OpenRouter, Groq and Mistral.
 *
 * All three speak the same `/chat/completions` dialect, so one function serves
 * them and adding a fourth is a table entry rather than a module. No SDK: the
 * request is a dozen lines of `fetch`, and pulling in a client library per
 * provider would cost more than it saves.
 */
import { PROVIDERS, buildPrompt, extractJson, type ProviderRequest, type RawBoard } from './ai'

/** Asked for on top of the prompt, since these models have no schema to bind to. */
const JSON_INSTRUCTION = `
Reply with JSON and nothing else — no prose, no markdown fence. Use exactly this shape:
{"orientation":"...","tiles":[{"cell":"A1","terrain":"brick","number":5,"unsure":false}, ... all 19 ...],
 "ports":[{"berth":"A1-nw","trade":"any"}, ... all 9 ...]}
"terrain" is one of brick, lumber, ore, wheat, sheep, desert.
"number" is 2-12 and never 7; use 0 for the desert or a token you cannot read.
"trade" is one of any, brick, lumber, ore, wheat, sheep.`

interface ChatResponse {
  choices?: Array<{ message?: { content?: string | null } }>
  error?: { message?: string }
}

export async function callOpenAiCompatible({
  provider, model, apiKey, imageBase64, mediaType, signal,
}: ProviderRequest): Promise<RawBoard> {
  const info = PROVIDERS[provider]
  const config = info.openai
  if (!config) throw new Error(`${info.label} is not an OpenAI-compatible provider.`)

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  }
  if (config.referer) {
    // OpenRouter attributes requests to a site with these; both are optional.
    headers['HTTP-Referer'] = window.location.origin
    headers['X-Title'] = 'Catan board import'
  }

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    signal,
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:${mediaType};base64,${imageBase64}` },
            },
            { type: 'text', text: buildPrompt() + JSON_INSTRUCTION },
          ],
        },
      ],
      ...(config.jsonMode ? { response_format: { type: 'json_object' } } : {}),
    }),
  })

  if (!response.ok) throw new Error(await describeFailure(response, info.label))

  const body = (await response.json()) as ChatResponse
  const content = body.choices?.[0]?.message?.content
  if (!content) {
    throw new Error(body.error?.message ?? `${info.label} returned no answer.`)
  }
  return extractJson(content)
}

/** Turn an HTTP failure into something worth showing a user. */
async function describeFailure(response: Response, label: string): Promise<string> {
  let detail = ''
  try {
    const body = (await response.json()) as ChatResponse
    detail = body.error?.message ?? ''
  } catch {
    // A non-JSON error body tells us nothing the status code does not.
  }

  if (response.status === 401 || response.status === 403) {
    return `${label} rejected that key.`
  }
  if (response.status === 429) {
    // The case that started all this: a free key pointed at a paid-only model.
    return `${label} is out of quota for that model. Try a different one — free
            tiers often exclude the larger models.`.replace(/\s+/g, ' ')
  }
  if (response.status === 404) {
    return `${label} has no model by that name.`
  }
  return detail || `${label} failed with HTTP ${response.status}.`
}
