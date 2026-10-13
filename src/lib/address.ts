import { z } from 'zod'

// Nigerian estate-style address: Flat 2, House 14, 5th Avenue, Sunshine Estate, Lokogoma, Abuja, FCT
export const addressSchema = z.object({
    flat: z.string().trim().max(40).optional(),
    houseOrBlock: z.string().trim().min(1).max(40),
    street: z.string().trim().min(1).max(120),
    estate: z.string().trim().min(1).max(120),
    district: z.string().trim().max(80).optional(),
    city: z.string().trim().min(1).max(80).default('Abuja'),
    state: z.string().trim().min(1).max(80).default('FCT'),
})

export type Address = z.infer<typeof addressSchema>

export function formatAddress (a: Address): string {
    const house = /^\d/.test(a.houseOrBlock) ? `House ${a.houseOrBlock}` : a.houseOrBlock
    const flat = a.flat ? (/^\d/.test(a.flat) ? `Flat ${a.flat}` : a.flat) : undefined
    return [flat, house, a.street, a.estate, a.district, a.city, a.state].filter(Boolean).join(', ')
}
