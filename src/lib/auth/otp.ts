import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm'

import { BRAND } from '@/config/brand'
import { getDb } from '@/db'
import { otpCodes, users } from '@/db/schema'
import { hmac, randomDigits, safeEqual } from '@/lib/crypto'
import { AppError, RateLimitError } from '@/lib/errors'
import { normalizeNigerianPhone, requireNigerianPhone } from '@/lib/phone'
import { getSmsProvider } from '@/lib/sms'

export const OTP_LENGTH = 6
export const OTP_TTL_MINUTES = 10
export const OTP_MAX_ATTEMPTS = 5
export const OTP_MAX_SENDS_PER_WINDOW = 3
export const OTP_SEND_WINDOW_MINUTES = 15

/**
 * Optional fixed test codes for named phones, e.g. TEST_LOGIN_CODES="08031234567:482915,08039876543:771204".
 * For testing before an SMS provider is connected. Set only in the host's secret settings, never in the repo,
 * and remove before real residents use the system. The normal attempt limit still applies.
 */
export function testLoginCodeFor (phone: string, raw: string | undefined = process.env.TEST_LOGIN_CODES): string | null {
    if (!raw) return null
    for (const entry of raw.split(',')) {
        const [p, c] = entry.split(':').map(x => x.trim())
        if (p && c && /^\d{6}$/.test(c) && normalizeNigerianPhone(p) === phone) return c
    }
    return null
}

function hashCode (phone: string, code: string): string {
    return hmac(`otp:${phone}:${code}`)
}

/** Sends a sign-in code by SMS. Returns the normalised phone number. */
export async function requestOtp (rawPhone: string): Promise<{ phone: string }> {
    const phone = requireNigerianPhone(rawPhone)
    const db = getDb()

    const windowStart = new Date(Date.now() - OTP_SEND_WINDOW_MINUTES * 60_000)
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(otpCodes)
        .where(and(eq(otpCodes.phone, phone), gt(otpCodes.createdAt, windowStart)))
    if (count >= OTP_MAX_SENDS_PER_WINDOW) throw new RateLimitError('Too many codes requested. Please wait 15 minutes and try again.')

    // Only the newest code is valid
    await db.update(otpCodes).set({ consumedAt: new Date() }).where(and(eq(otpCodes.phone, phone), isNull(otpCodes.consumedAt)))

    const code = randomDigits(OTP_LENGTH)
    await db.insert(otpCodes).values({
        phone,
        codeHash: hashCode(phone, code),
        expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60_000),
    })
    await getSmsProvider().send({ to: phone, body: `${code} is your ${BRAND.productName} code. It expires in ${OTP_TTL_MINUTES} minutes. Do not share it.` })
    return { phone }
}

/** Checks a code; on success returns the user (created on first sign-in). */
export async function verifyOtp (rawPhone: string, rawCode: string): Promise<{ userId: string, isNewUser: boolean }> {
    const phone = requireNigerianPhone(rawPhone)
    const code = rawCode.replace(/\s/g, '')
    const db = getDb()

    const [otp] = await db.select().from(otpCodes)
        .where(and(eq(otpCodes.phone, phone), isNull(otpCodes.consumedAt), gt(otpCodes.expiresAt, new Date())))
        .orderBy(desc(otpCodes.createdAt)).limit(1)
    if (!otp) throw new AppError('This code has expired. Please request a new one.', 'OTP_EXPIRED')
    if (otp.attempts >= OTP_MAX_ATTEMPTS) throw new RateLimitError('Too many wrong codes. Please request a new one.')

    const testCode = testLoginCodeFor(phone)
    const matches = /^\d+$/.test(code) && (safeEqual(otp.codeHash, hashCode(phone, code)) || (testCode !== null && safeEqual(testCode, code)))
    if (!matches) {
        await db.update(otpCodes).set({ attempts: sql`${otpCodes.attempts} + 1` }).where(eq(otpCodes.id, otp.id))
        throw new AppError('That code is not correct.', 'OTP_WRONG')
    }

    const consumed = await db.update(otpCodes).set({ consumedAt: new Date() })
        .where(and(eq(otpCodes.id, otp.id), isNull(otpCodes.consumedAt))).returning({ id: otpCodes.id })
    if (consumed.length === 0) throw new AppError('This code has already been used.', 'OTP_USED')

    const inserted = await db.insert(users).values({ phone }).onConflictDoNothing({ target: users.phone }).returning({ id: users.id })
    if (inserted.length > 0) return { userId: inserted[0].id, isNewUser: true }
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.phone, phone))
    return { userId: user.id, isNewUser: false }
}
