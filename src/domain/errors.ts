/** Base class so the API layer can map domain failures to HTTP codes without knowing each type's internals. */
export abstract class DomainError extends Error {
  abstract readonly code: string;
}

export class NotFoundError extends DomainError {
  readonly code = "NOT_FOUND";
  constructor(entity: string, id: string) {
    super(`${entity} '${id}' not found`);
  }
}
