/** Shared without loading the command processor, including during storage setup. */
export class DomainError extends Error {
  constructor(public status: number, public code: string, message: string, public fieldErrors?: { path: string; message: string }[]) { super(message); }
}
