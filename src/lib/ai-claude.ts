/** The Claude half of `ai.ts`. Nothing here but the call itself. */
import { BOARD_SCHEMA, buildPrompt, type ProviderRequest, type RawBoard } from './ai'

export async function callClaude({
  model, apiKey, imageBase64, mediaType, signal,
}: ProviderRequest): Promise<RawBoard> {
  const [{ default: Anthropic }, { jsonSchemaOutputFormat }] = await Promise.all([
    import('@anthropic-ai/sdk'),
    import('@anthropic-ai/sdk/helpers/json-schema'),
  ])

  const client = new Anthropic({
    apiKey,
    // The key is the user's own and never leaves their machine except to
    // Anthropic; there is no server here to proxy it through.
    dangerouslyAllowBrowser: true,
  })

  // Streaming, because adaptive thinking on a fiddly photo can run long enough
  // to trip a plain request timeout.
  const stream = client.messages.stream(
    {
      model,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
            { type: 'text', text: buildPrompt() },
          ],
        },
      ],
      output_config: { format: jsonSchemaOutputFormat(BOARD_SCHEMA) },
    },
    { signal },
  )

  const message = await stream.finalMessage()
  if (message.stop_reason === 'refusal') {
    throw new Error('Claude declined to read that image.')
  }
  if (!message.parsed_output) throw new Error('Claude did not return a board.')
  return message.parsed_output as RawBoard
}
