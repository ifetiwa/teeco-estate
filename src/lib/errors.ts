/** An error whose message is safe to show to the user. */
export class AppError extends Error {
    constructor (message: string, readonly code: string = 'BAD_REQUEST') {
        super(message)
        this.name = 'AppError'
    }
}

export class ForbiddenError extends AppError {
    constructor (message = 'You do not have permission to do that.') {
        super(message, 'FORBIDDEN')
        this.name = 'ForbiddenError'
    }
}

export class NotFoundError extends AppError {
    constructor (what = 'Item') {
        super(`${what} not found.`, 'NOT_FOUND')
        this.name = 'NotFoundError'
    }
}

export class RateLimitError extends AppError {
    constructor (message = 'Too many attempts. Please wait a few minutes and try again.') {
        super(message, 'RATE_LIMITED')
        this.name = 'RateLimitError'
    }
}

/** Postgres unique violation */
export function isUniqueViolation (e: unknown, constraint?: string): boolean {
    const err = e as { code?: string, constraint?: string, cause?: { code?: string, constraint?: string } }
    const pg = err?.code ? err : err?.cause
    if (pg?.code !== '23505') return false
    return constraint ? pg.constraint === constraint : true
}
