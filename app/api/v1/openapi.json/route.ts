const errorSchema = {
  type: 'object',
  properties: {
    error: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        type: { type: 'string' },
        code: { type: 'string' },
      },
      required: ['message', 'type', 'code'],
    },
  },
  required: ['error'],
} as const

export async function GET(request: Request) {
  const origin = new URL(request.url).origin

  return Response.json(
    {
      openapi: '3.1.0',
      info: {
        title: 'CTECH AI Chat API',
        version: '1.0.0',
        description: 'OpenAI-compatible non-streaming chat completions using the CTECH AI API.',
      },
      servers: [{ url: origin }],
      security: [{ CtechBearerAuth: [] }],
      paths: {
        '/api/v1/chat': {
          post: {
            operationId: 'createChatCompletion',
            summary: 'Create a CTECH AI chat completion',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      model: { type: 'string', enum: ['ctech-chat'] },
                      messages: {
                        type: 'array',
                        description: 'Up to 40 messages; combined message content must not exceed 60,000 characters.',
                        minItems: 1,
                        maxItems: 40,
                        items: {
                          type: 'object',
                          additionalProperties: false,
                          properties: {
                            role: { type: 'string', enum: ['user', 'assistant'] },
                            content: { type: 'string', minLength: 1, maxLength: 20_000 },
                          },
                          required: ['role', 'content'],
                        },
                      },
                      max_tokens: { type: 'integer', minimum: 1, maximum: 4096 },
                    },
                    required: ['messages'],
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'Chat completion created.',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        object: { const: 'chat.completion' },
                        created: { type: 'integer' },
                        model: { const: 'ctech-chat' },
                        choices: {
                          type: 'array',
                          items: {
                            type: 'object',
                            properties: {
                              index: { type: 'integer' },
                              message: {
                                type: 'object',
                                properties: {
                                  role: { const: 'assistant' },
                                  content: { type: 'string' },
                                },
                                required: ['role', 'content'],
                              },
                              finish_reason: { type: 'string' },
                            },
                            required: ['index', 'message', 'finish_reason'],
                          },
                        },
                      },
                      required: ['id', 'object', 'created', 'model', 'choices'],
                    },
                  },
                },
              },
              '400': { description: 'Invalid JSON or unsupported request fields.', content: { 'application/json': { schema: errorSchema } } },
              '401': { description: 'Missing, invalid, or revoked API key.', content: { 'application/json': { schema: errorSchema } } },
              '429': { description: 'The account has reached its current request allowance.', content: { 'application/json': { schema: errorSchema } } },
              '502': { description: 'The upstream model service failed.', content: { 'application/json': { schema: errorSchema } } },
              '503': { description: 'The API service is temporarily unavailable.', content: { 'application/json': { schema: errorSchema } } },
              '504': { description: 'The model response timed out.', content: { 'application/json': { schema: errorSchema } } },
            },
          },
        },
      },
      components: {
        securitySchemes: {
          CtechBearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'CTECH API key',
          },
        },
      },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
