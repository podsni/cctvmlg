/// <reference types="@cloudflare/workers-types" />
/**
 * Pages Function — /api/* catch-all (under functions/api/ so it only matches
 * URLs starting with /api/, leaving /client.js + /style.css to Pages'
 * static asset handler).
 */
import { app } from "../../src/hono-app";
import type { AppEnv } from "../../src/hono-app";

export const onRequest = async (context: {
  request: Request;
  env: AppEnv;
  params: Record<string, string>;
  data: unknown;
  waitUntil: (promise: Promise<unknown>) => void;
  passThroughOnException: () => void;
  next: (input?: Request | string) => Promise<Response>;
  functionPath: string;
}): Promise<Response> => {
  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  return app.fetch(context.request, context.env, context as any);
};
