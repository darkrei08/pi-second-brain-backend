export class GatewayError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'GatewayError';
    this.status = status;
    this.code = code;
  }
}

export function errorPayload(error) {
  if (error instanceof GatewayError) {
    return { status: error.status, body: { error: { code: error.code, message: error.message } } };
  }
  // NOTE: an unexpected failure is reported without its message so a driver error cannot leak SQL or paths.
  return { status: 500, body: { error: { code: 'internal_error', message: 'The request failed' } } };
}
