/**
 * Custom error types for better error handling and categorization.
 */

export class ApiError extends Error {
    constructor(
        message: string,
        public statusCode: number,
        public isRetryable: boolean = false
    ) {
        super(message);
        this.name = 'ApiError';
    }
}

export class RateLimitError extends ApiError {
    constructor(public retryAfter: number) {
        super(`Rate limited. Retry after ${retryAfter}s`, 429, true);
        this.name = 'RateLimitError';
    }
}

export class ServiceUnavailableError extends ApiError {
    constructor(message: string = 'Service temporarily unavailable') {
        super(message, 503, true);
        this.name = 'ServiceUnavailableError';
    }
}

export class AuthenticationError extends ApiError {
    constructor(message: string = 'Authentication failed') {
        super(message, 401, false);
        this.name = 'AuthenticationError';
    }
}

export class TimeoutError extends Error {
    constructor(message: string = 'Request timeout') {
        super(message);
        this.name = 'TimeoutError';
    }
}

export class ConfigurationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ConfigurationError';
    }
}
