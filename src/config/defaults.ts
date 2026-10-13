import { z } from 'zod'

// Platform-wide defaults. Each estate stores only the keys it overrides (estates.settings),
// and resolveEstateSettings() merges them over these defaults.
export const estateSettingsSchema = z.object({
    locale: z.literal('en-NG'),
    currency: z.literal('NGN'),
    timezone: z.literal('Africa/Lagos'),
    phoneCountryCode: z.literal('+234'),
    visitors: z.object({
        maxPassesPerResidentPerDay: z.number().int().min(1).max(100),
        curfew: z.object({
            enabled: z.boolean(),
            start: z.string().regex(/^\d{2}:\d{2}$/),
            end: z.string().regex(/^\d{2}:\d{2}$/),
        }),
        defaultPassValidityHours: z.number().int().min(1).max(24 * 31),
    }),
    levies: z.object({
        reminderDaysBeforeDue: z.array(z.number().int().min(0).max(60)),
        reminderDaysAfterDue: z.array(z.number().int().min(0).max(180)),
        lateFee: z.object({
            enabled: z.boolean(),
            type: z.enum(['flat', 'percent']),
            value: z.number().min(0),
            graceDays: z.number().int().min(0).max(90),
        }),
    }),
    notifications: z.object({
        quietHours: z.object({
            enabled: z.boolean(),
            start: z.string().regex(/^\d{2}:\d{2}$/),
            end: z.string().regex(/^\d{2}:\d{2}$/),
        }),
    }),
})

export type EstateSettings = z.infer<typeof estateSettingsSchema>

export const PLATFORM_DEFAULTS: EstateSettings = {
    locale: 'en-NG',
    currency: 'NGN',
    timezone: 'Africa/Lagos',
    phoneCountryCode: '+234',
    visitors: {
        maxPassesPerResidentPerDay: 10,
        curfew: { enabled: false, start: '23:00', end: '05:00' },
        defaultPassValidityHours: 12,
    },
    levies: {
        reminderDaysBeforeDue: [7, 1],
        reminderDaysAfterDue: [1, 7, 30],
        lateFee: { enabled: false, type: 'percent', value: 0, graceDays: 14 },
    },
    notifications: {
        quietHours: { enabled: true, start: '22:00', end: '07:00' },
    },
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends Array<unknown> ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K] }
export type EstateSettingsOverrides = DeepPartial<EstateSettings>

function isPlainObject (v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function deepMerge (base: Record<string, unknown>, over: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = { ...base }
    for (const [key, value] of Object.entries(over)) {
        if (value === undefined) continue
        out[key] = isPlainObject(value) && isPlainObject(base[key])
            ? deepMerge(base[key] as Record<string, unknown>, value)
            : value
    }
    return out
}

/** Merges an estate's overrides over platform defaults and validates the result. Throws on invalid overrides. */
export function resolveEstateSettings (overrides: unknown = {}): EstateSettings {
    const over = isPlainObject(overrides) ? overrides : {}
    return estateSettingsSchema.parse(deepMerge(PLATFORM_DEFAULTS as unknown as Record<string, unknown>, over))
}
