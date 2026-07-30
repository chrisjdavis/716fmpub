const INVALID_USERNAME = "LASTFM_INVALID_USERNAME" as const;
const API_ERROR = "LASTFM_PROVIDER_API_ERROR" as const;
const VALIDATION = "LASTFM_PROVIDER_VALIDATION_ERROR" as const;

export class LastfmUsernameNotFoundError extends Error {
  readonly code = INVALID_USERNAME;

  constructor(message: string) {
    super(message);
    this.name = "LastfmUsernameNotFoundError";
  }
}

export class LastfmProviderApiError extends Error {
  readonly code = API_ERROR;
  readonly httpStatus?: number;
  readonly lastfmError?: number;

  constructor(
    message: string,
    init?: Readonly<{ httpStatus?: number; lastfmError?: number; cause?: unknown }>,
  ) {
    super(message, init?.cause !== undefined ? { cause: init.cause } : undefined);
    this.name = "LastfmProviderApiError";
    this.httpStatus = init?.httpStatus;
    this.lastfmError = init?.lastfmError;
  }
}

export class LastfmProviderValidationError extends Error {
  readonly code = VALIDATION;

  constructor(message: string) {
    super(message);
    this.name = "LastfmProviderValidationError";
  }
}
