type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

export interface SwaggerPathInput {
  method: HttpMethod;
  path: string;
  summary: string;
  description?: string;
  tags?: string[];
  security?: Array<Record<string, string[]>>;
  requestBody?: {
    required?: boolean;
    content: Record<string, unknown>;
  };
  parameters?: unknown[];
  responses: Record<string, unknown>;
}

const registry: Record<string, Record<string, Omit<SwaggerPathInput, 'method' | 'path'>>> =
  {};

export function registerPath(input: SwaggerPathInput): void {
  const { method, path, ...rest } = input;
  if (!registry[path]) registry[path] = {};
  registry[path][method] = rest;
}

export function getRegisteredPaths() {
  return registry;
}
