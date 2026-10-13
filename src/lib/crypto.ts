import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'

function secret (): string {
    const s = process.env.SESSION_SECRET
    if (!s || s.length < 32) throw new Error('SESSION_SECRET must be set to at least 32 characters')
    return s
}

export function hmac (value: string): string {
    return createHmac('sha256', secret()).update(value).digest('hex')
}

export function sha256 (value: string): string {
    return createHash('sha256').update(value).digest('hex')
}

export function randomToken (bytes = 32): string {
    return randomBytes(bytes).toString('base64url')
}

export function randomDigits (length: number): string {
    let out = ''
    for (let i = 0; i < length; i++) out += randomInt(0, 10).toString()
    return out
}

// No 0/O, 1/I/L to avoid misreading codes said aloud or typed on a phone
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export function randomCode (length: number): string {
    let out = ''
    for (let i = 0; i < length; i++) out += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)]
    return out
}

export function safeEqual (a: string, b: string): boolean {
    const ab = Buffer.from(a)
    const bb = Buffer.from(b)
    return ab.length === bb.length && timingSafeEqual(ab, bb)
}
