import { appendFileSync } from 'node:fs'

export interface SmsMessage {
    to: string // E.164
    body: string
}

export interface SmsResult {
    id: string
    /** Provider-reported cost in kobo, when known (used for per-estate SMS billing). */
    costKobo?: number
}

export interface SmsProvider {
    readonly name: string
    send (message: SmsMessage): Promise<SmsResult>
}

/** Development provider: keeps messages in memory and logs them instead of sending. */
export class ConsoleSmsProvider implements SmsProvider {
    readonly name = 'console'
    readonly sent: SmsMessage[] = []

    async send (message: SmsMessage) {
        this.sent.push(message)
        if (process.env.NODE_ENV !== 'test') console.log(`[sms] to=${message.to} body="${message.body}"`)
        // Local development/e2e only (never set DEV_SMS_OUTBOX in production): append to an outbox file so tests can read codes
        if (process.env.DEV_SMS_OUTBOX) appendFileSync(process.env.DEV_SMS_OUTBOX, JSON.stringify(message) + '\n')
        return { id: `console-${this.sent.length}`, costKobo: 0 }
    }

    lastTo (phone: string): SmsMessage | undefined {
        return [...this.sent].reverse().find(m => m.to === phone)
    }
}

export class SmsSendError extends Error {
    constructor (message: string, readonly status?: number) {
        super(message)
        this.name = 'SmsSendError'
    }
}

export interface TermiiConfig {
    apiKey: string
    /** Approved sender ID (alphanumeric, up to 11 characters), e.g. "MyEstate" */
    senderId: string
    /** "dnd" reaches numbers on Do-Not-Disturb (needed for sign-in codes); "generic" is cheaper but blocked for DND numbers */
    channel: 'dnd' | 'generic' | 'whatsapp'
    /** Account base URL from the Termii dashboard, e.g. https://api.ng.termii.com or https://v3.api.termii.com */
    baseUrl: string
}

/**
 * Termii (https://termii.com), a Nigerian SMS gateway. Sends one message per call to the /api/sms/send endpoint.
 * Throws SmsSendError when Termii rejects the message or doesn't answer in time.
 */
export class TermiiSmsProvider implements SmsProvider {
    readonly name = 'termii'

    constructor (private readonly config: TermiiConfig, private readonly fetchFn: typeof fetch = fetch) {}

    async send (message: SmsMessage): Promise<SmsResult> {
        const res = await this.fetchFn(`${this.config.baseUrl.replace(/\/+$/, '')}/api/sms/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                api_key: this.config.apiKey,
                to: message.to.replace(/^\+/, ''), // Termii takes 2348031234567
                from: this.config.senderId,
                sms: message.body,
                type: 'plain',
                channel: this.config.channel,
            }),
            signal: AbortSignal.timeout(15_000),
        }).catch((e: unknown) => { throw new SmsSendError(`Termii request failed: ${(e as Error).message}`) })
        const data = await res.json().catch(() => ({})) as { message_id?: string | number, message?: string, code?: string }
        if (!res.ok || !data.message_id) throw new SmsSendError(`Termii rejected the message: ${data.message ?? res.statusText}`, res.status)
        return { id: String(data.message_id) }
    }
}

/** The provider configured by environment variables: Termii when SMS_PROVIDER=termii and its settings are present. */
export function smsProviderFromEnv (env: Record<string, string | undefined> = process.env): SmsProvider {
    if (env.SMS_PROVIDER === 'termii') {
        if (!env.TERMII_API_KEY || !env.TERMII_SENDER_ID) throw new Error('SMS_PROVIDER=termii needs TERMII_API_KEY and TERMII_SENDER_ID')
        const channel = (env.TERMII_CHANNEL ?? 'dnd') as TermiiConfig['channel']
        return new TermiiSmsProvider({ apiKey: env.TERMII_API_KEY, senderId: env.TERMII_SENDER_ID, channel, baseUrl: env.TERMII_BASE_URL ?? 'https://api.ng.termii.com' })
    }
    return new ConsoleSmsProvider()
}

const globalForSms = globalThis as unknown as { teecoSms?: SmsProvider }

export function getSmsProvider (): SmsProvider {
    if (!globalForSms.teecoSms) globalForSms.teecoSms = smsProviderFromEnv()
    return globalForSms.teecoSms
}

export function setSmsProvider (p: SmsProvider): void {
    globalForSms.teecoSms = p
}
