// One error type for every provider. `code` drives the worker:
//   UNREACHABLE, or httpStatus 429 / 5xx  -> transient, retried next tick
//   NO_BALANCE                            -> provider out of credit (admin banner)
//   anything else                         -> the request failed for good
export class EngineError extends Error {
  constructor(message, code = 'ENGINE_ERROR', httpStatus = null, provider = null) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
    this.provider = provider;
  }
}

export const isTransient = (err) => err instanceof EngineError
  && (err.code === 'UNREACHABLE' || err.httpStatus === 429 || (err.httpStatus || 0) >= 500);
