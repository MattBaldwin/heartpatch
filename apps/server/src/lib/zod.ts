import type {
  FastifySchemaCompiler,
  FastifySerializerCompiler,
  FastifyTypeProvider,
} from 'fastify';
import type { z } from 'zod';

/**
 * Lets routes declare zod schemas for params, query, body and responses.
 * Handlers get request types inferred from the schemas, and responses are
 * checked against them on the way out. A small in-house version so we don't
 * pull in Swagger, which the published adapter requires.
 */
export interface ZodTypeProvider extends FastifyTypeProvider {
  validator: this['schema'] extends z.ZodType ? z.output<this['schema']> : unknown;
  serializer: this['schema'] extends z.ZodType ? z.input<this['schema']> : unknown;
}

/** Thrown when a request fails its route schema; mapped to VALIDATION_FAILED. */
export class RequestValidationError extends Error {
  readonly issues: z.core.$ZodIssue[];

  constructor(issues: z.core.$ZodIssue[]) {
    super('Request validation failed');
    this.name = 'RequestValidationError';
    this.issues = issues;
  }
}

export const validatorCompiler: FastifySchemaCompiler<z.ZodType> = ({ schema }) => {
  return (data) => {
    const result = schema.safeParse(data);
    return result.success
      ? { value: result.data }
      : { error: new RequestValidationError(result.error.issues) };
  };
};

export const serializerCompiler: FastifySerializerCompiler<z.ZodType> = ({ schema }) => {
  return (data) => JSON.stringify(schema.parse(data));
};
