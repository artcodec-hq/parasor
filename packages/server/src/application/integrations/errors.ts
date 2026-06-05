export class HookAccessError extends Error {
  constructor(message = "loopback only") {
    super(message);
    this.name = "HookAccessError";
  }
}

export class HookNotFoundError extends Error {
  constructor(message = "unknown session") {
    super(message);
    this.name = "HookNotFoundError";
  }
}

export class HookRateLimitError extends Error {
  constructor(message = "rate limited") {
    super(message);
    this.name = "HookRateLimitError";
  }
}

export class HookValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HookValidationError";
  }
}

export class OpenUrlValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenUrlValidationError";
  }
}
