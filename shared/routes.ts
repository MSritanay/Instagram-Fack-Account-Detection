import { z } from 'zod';
import { analyses, analyzeRequestSchema } from './schema';

export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
  unauthorized: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
};

export const api = {
  analysis: {
    analyze: {
      method: 'POST' as const,
      path: '/api/analyze',
      input: analyzeRequestSchema,
      responses: {
        201: z.custom<typeof analyses.$inferSelect>(),
        400: errorSchemas.validation,
        401: errorSchemas.unauthorized,
      },
    },
    list: {
      method: 'GET' as const,
      path: '/api/analyses',
      responses: {
        200: z.array(z.custom<typeof analyses.$inferSelect>()),
        401: errorSchemas.unauthorized,
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/analyses/:id',
      responses: {
        200: z.custom<typeof analyses.$inferSelect>(),
        404: errorSchemas.notFound,
        401: errorSchemas.unauthorized,
      },
    },
  },
  admin: {
    users: {
      method: 'GET' as const,
      path: '/api/admin/users',
      responses: {
        200: z.array(z.object({
          id: z.string(),
          email: z.string().nullable(),
          firstName: z.string().nullable(),
          lastName: z.string().nullable(),
          profileImageUrl: z.string().nullable(),
          isAdmin: z.boolean().nullable(),
          createdAt: z.date().nullable(),
        })),
        401: errorSchemas.unauthorized,
        403: z.object({ message: z.string() }),
      },
    },
    allAnalyses: {
      method: 'GET' as const,
      path: '/api/admin/analyses',
      responses: {
        200: z.array(z.custom<typeof analyses.$inferSelect>()),
        401: errorSchemas.unauthorized,
        403: z.object({ message: z.string() }),
      },
    },
    stats: {
      method: 'GET' as const,
      path: '/api/admin/stats',
      responses: {
        200: z.object({
          totalUsers: z.number(),
          totalAnalyses: z.number(),
          highRiskCount: z.number(),
          avgRiskScore: z.number(),
        }),
        401: errorSchemas.unauthorized,
        403: z.object({ message: z.string() }),
      },
    },
  },
  ai: {
    audio: {
      speech: {
        method: 'POST' as const,
        path: '/api/ai/audio/speech',
        input: z.object({
          text: z.string(),
          voice: z.enum(['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']),
          format: z.enum(['mp3', 'pcm16']),
        }),
        responses: {
          200: z.any(),
          400: errorSchemas.validation,
          500: errorSchemas.internal,
        },
      },
    },
  },
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}