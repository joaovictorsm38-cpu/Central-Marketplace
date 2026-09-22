export class DomainError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 400) { super(message); }
}
export class ForbiddenError extends DomainError {
  constructor(message = "Acesso negado") { super("FORBIDDEN", message, 403); }
}
export class NotFoundError extends DomainError {
  constructor(message = "Recurso não encontrado") { super("NOT_FOUND", message, 404); }
}
