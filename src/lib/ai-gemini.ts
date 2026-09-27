/** The Gemini half of `ai.ts`. Nothing here but the call itself. */
import { BOARD_SCHEMA, buildPrompt, type ProviderRequest, type RawBoard } from './ai'

export async function callGemini({
  model, apiKey, imageBase64, mediaType, signal,
}: ProviderRequest): Promise<RawBoard> {
  const { GoogleGenAI } = await import('@google/genai')
  const ai = new GoogleGenAI({ apiKey })

  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: mediaType, data: imageBase64 } },
          { text: buildPrompt() },
        ],
      },
    ],
    config: {
      responseMimeType: 'application/json',
      // `responseJsonSchema` takes ordinary JSON Schema, so both providers can
      // be handed the identical definition from `ai.ts`.
      responseJsonSchema: BOARD_SCHEMA,
      abortSignal: signal,
    },
  })

  const text = response.text
  if (!text) throw new Error('Gemini did not return a board.')

  try {
    return JSON.parse(text) as RawBoard
  } catch {
    throw new Error('Gemini returned something that was not JSON.')
  }
}
