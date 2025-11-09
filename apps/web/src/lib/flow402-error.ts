export type Flow402ErrorCode =
    | "validation_error"
    | "vendor_lookup_failed"
    | "vendor_not_found"
    | "vendor_user_lookup_failed"
    | "vendor_user_not_found"
    | "vendor_user_conflict"
    | "balance_lookup_failed"
    | "insufficient_funds"
    | "mutation_guard_failed"
    | "mutation_failed"
    | "settings_lookup_failed"
    | "settings_upsert_failed";

export interface Flow402ErrorOptions {
    status?: number;
    details?: unknown;
    cause?: unknown;
}

export class Flow402Error extends Error {
    readonly code: Flow402ErrorCode;
    readonly status: number;
    readonly details?: unknown;

    constructor(code: Flow402ErrorCode, message: string, options: Flow402ErrorOptions = {}) {
        super(message);
        this.name = "Flow402Error";
        this.code = code;
        this.status = options.status ?? 400;
        this.details = options.details;
        if (options.cause) {
            // Preserve stack traces when wrapping
            (this as Error).cause = options.cause;
        }
    }
}

export function isFlow402Error(error: unknown): error is Flow402Error {
    return Boolean(error) && error instanceof Flow402Error;
}
