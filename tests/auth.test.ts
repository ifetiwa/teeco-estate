import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { getDb } from '@/db'
import { otpCodes } from '@/db/schema'
import { OTP_MAX_ATTEMPTS, requestOtp, verifyOtp } from '@/lib/auth/otp'
import { createSession, destroySession, getUserBySessionToken } from '@/lib/auth/session'

import { nextPhone, resetDb, useConsoleSms } from './helpers'

function codeFrom (body: string): string {
    return body.match(/^(\d{6})/)![1]
}

describe('phone OTP sign-in', () => {
    let sms: ReturnType<typeof useConsoleSms>
    beforeEach(async () => {
        await resetDb()
        sms = useConsoleSms()
    })

    it('sends a 6-digit code to the normalised number and signs up a new user', async () => {
        const local = '0803 555 0001'
        const { phone } = await requestOtp(local)
        expect(phone).toBe('+2348035550001')
        const msg = sms.lastTo(phone)!
        expect(msg.body).toMatch(/^\d{6} is your Teeco Estate code/)

        const first = await verifyOtp(local, codeFrom(msg.body))
        expect(first.isNewUser).toBe(true)

        await requestOtp(phone)
        const second = await verifyOtp(phone, codeFrom(sms.lastTo(phone)!.body))
        expect(second).toEqual({ userId: first.userId, isNewUser: false })
    })

    it('rejects invalid phone numbers before sending anything', async () => {
        await expect(requestOtp('+14155552671')).rejects.toThrow('not a valid Nigerian mobile number')
        expect(sms.sent).toHaveLength(0)
    })

    it('rejects a wrong code and locks the code after too many attempts', async () => {
        const phone = nextPhone()
        await requestOtp(phone)
        const good = codeFrom(sms.lastTo(phone)!.body)
        const wrong = good === '000000' ? '111111' : '000000'
        for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
            await expect(verifyOtp(phone, wrong)).rejects.toThrow('not correct')
        }
        await expect(verifyOtp(phone, good)).rejects.toThrow('Too many wrong codes')
    })

    it('a code works only once and only the newest code is valid', async () => {
        const phone = nextPhone()
        await requestOtp(phone)
        const old = codeFrom(sms.lastTo(phone)!.body)
        await requestOtp(phone)
        const fresh = codeFrom(sms.lastTo(phone)!.body)
        if (old !== fresh) await expect(verifyOtp(phone, old)).rejects.toThrow()
        await verifyOtp(phone, fresh)
        await expect(verifyOtp(phone, fresh)).rejects.toThrow('expired')
    })

    it('expired codes are refused', async () => {
        const phone = nextPhone()
        await requestOtp(phone)
        await getDb().update(otpCodes).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(otpCodes.phone, phone))
        await expect(verifyOtp(phone, codeFrom(sms.lastTo(phone)!.body))).rejects.toThrow('expired')
    })

    it('limits how many codes can be requested in 15 minutes', async () => {
        const phone = nextPhone()
        await requestOtp(phone)
        await requestOtp(phone)
        await requestOtp(phone)
        await expect(requestOtp(phone)).rejects.toThrow('Too many codes requested')
        expect(sms.sent.filter(m => m.to === phone)).toHaveLength(3)
    })
})

describe('sessions', () => {
    beforeEach(resetDb)

    it('creates, resolves and destroys a session', async () => {
        const sms = useConsoleSms()
        const phone = nextPhone()
        await requestOtp(phone)
        const { userId } = await verifyOtp(phone, codeFrom(sms.lastTo(phone)!.body))
        const { token } = await createSession(userId)
        expect((await getUserBySessionToken(token))?.id).toBe(userId)
        expect(await getUserBySessionToken('not-a-token')).toBeNull()
        await destroySession(token)
        expect(await getUserBySessionToken(token)).toBeNull()
    })
})

describe('fixed test login codes (TEST_LOGIN_CODES)', () => {
    beforeEach(resetDb)

    it('parses only valid entries for the matching phone', async () => {
        const { testLoginCodeFor } = await import('@/lib/auth/otp')
        expect(testLoginCodeFor('+2348031234567', '0803 123 4567:482915, 08039876543:771204')).toBe('482915')
        expect(testLoginCodeFor('+2348039876543', '08031234567:482915,08039876543:771204')).toBe('771204')
        expect(testLoginCodeFor('+2348030000000', '08031234567:482915')).toBeNull()
        expect(testLoginCodeFor('+2348031234567', '08031234567:12ab56')).toBeNull()
        expect(testLoginCodeFor('+2348031234567', undefined)).toBeNull()
    })

    it('accepts the test code for the listed phone only, and the attempt limit still applies', async () => {
        useConsoleSms()
        const listed = nextPhone()
        const other = nextPhone()
        process.env.TEST_LOGIN_CODES = `${listed}:482915`
        try {
            await requestOtp(listed)
            expect((await verifyOtp(listed, '482915')).isNewUser).toBe(true)

            await requestOtp(other)
            await expect(verifyOtp(other, '482915')).rejects.toThrow('not correct')

            await requestOtp(listed)
            for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) await expect(verifyOtp(listed, '000001')).rejects.toThrow('not correct')
            await expect(verifyOtp(listed, '482915')).rejects.toThrow('Too many wrong codes')
        } finally {
            delete process.env.TEST_LOGIN_CODES
        }
    })
})
