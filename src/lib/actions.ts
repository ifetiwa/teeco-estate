import { ZodError } from 'zod'

import { AppError } from '@/lib/errors'
import { InvalidPhoneError } from '@/lib/phone'

export interface ActionState {
    ok?: boolean
    message?: string
    error?: string
    fieldErrors?: Record<string, string>
    /** Increments on every successful submit so forms can reset themselves. */
    nonce?: number
}

export const initialActionState: ActionState = {}

/** Converts known errors into a form state; unknown errors are logged and shown generically. */
export function toActionError (e: unknown): ActionState {
    if (e instanceof ZodError) {
        const fieldErrors: Record<string, string> = {}
        for (const issue of e.issues) {
            const key = issue.path.join('.') || '_'
            if (!fieldErrors[key]) fieldErrors[key] = issue.message
        }
        return { error: 'Please check the highlighted fields.', fieldErrors }
    }
    if (e instanceof AppError || e instanceof InvalidPhoneError) return { error: e.message }
    // Let Next.js redirects/notFound propagate
    if (e && typeof e === 'object' && 'digest' in e && typeof (e as { digest: unknown }).digest === 'string' && (e as { digest: string }).digest.startsWith('NEXT_')) throw e
    console.error(e)
    return { error: 'Something went wrong. Please try again.' }
}

export function formObject (formData: FormData): Record<string, string> {
    const out: Record<string, string> = {}
    for (const [k, v] of formData.entries()) if (typeof v === 'string' && !k.startsWith('$ACTION')) out[k] = v
    return out
}

/** Wraps a server action body: returns success state or a friendly error. */
export async function runAction (fn: () => Promise<string | void>): Promise<ActionState> {
    try {
        const message = await fn()
        return { ok: true, message: message || undefined, nonce: Date.now() }
    } catch (e) {
        return toActionError(e)
    }
}
