export class FileAccessError extends Error {
  constructor(message = "Access denied") {
    super(message);
    this.name = "FileAccessError";
  }
}

export class FileReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileReadError";
  }
}

export class FileNotFoundError extends Error {
  constructor(message = "File not found") {
    super(message);
    this.name = "FileNotFoundError";
  }
}

export class FileTooLargeError extends Error {
  constructor(message = "File too large (max 1MB)") {
    super(message);
    this.name = "FileTooLargeError";
  }
}

export class FilesystemUnavailableError extends Error {
  constructor(message = "Filesystem not available") {
    super(message);
    this.name = "FilesystemUnavailableError";
  }
}

export class FileWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileWriteError";
  }
}

export class FileWriteDisabledError extends Error {
  constructor(message = "Filesystem writes are disabled") {
    super(message);
    this.name = "FileWriteDisabledError";
  }
}

export class FileExistsError extends Error {
  constructor(message = "Destination already exists") {
    super(message);
    this.name = "FileExistsError";
  }
}

export class UnsupportedPlatformError extends Error {
  constructor(message = "Unsupported platform") {
    super(message);
    this.name = "UnsupportedPlatformError";
  }
}
