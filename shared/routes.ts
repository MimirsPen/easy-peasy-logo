import { z } from 'zod';
import { insertUserSchema, users } from './schema';

export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
};

export const api = {
  health: {
    method: 'GET' as const,
    path: '/api/health' as const,
    responses: {
      200: z.object({ status: z.literal("ok") }),
    },
  },
  deleteAccount: {
    method: 'POST' as const,
    path: '/api/delete-account' as const,
    responses: {
      200: z.object({ success: z.literal(true) }),
      400: errorSchemas.validation,
      500: errorSchemas.internal,
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
