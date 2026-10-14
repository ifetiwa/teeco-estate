'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'

import { actorFromUser } from '@/lib/access'
import { type ActionState, formObject, runAction, toActionError } from '@/lib/actions'
import { requireUser } from '@/lib/auth/current'
import { randomToken } from '@/lib/crypto'
import { formatDateTime } from '@/lib/format'
import { checkInApprovedWalkIn, checkInWithPass, checkOutVisit, denyPassEntry, logWalkIn, verifyGateCode } from '@/lib/visitors'

const DEVICE_COOKIE = 'teeco_gate_device'

/** Identifies this phone/browser for per-device rate limiting of code attempts. */
async function gateDeviceId (): Promise<string> {
    const store = await cookies()
    let id = store.get(DEVICE_COOKIE)?.value
    if (!id) {
        id = randomToken(16)
        store.set(DEVICE_COOKIE, id, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 * 24 * 365 })
    }
    return id
}

export interface VerifyState extends ActionState {
    hit?: {
        passId: string
        visitorName: string
        visitorPhone: string | null
        vehiclePlate: string | null
        purpose: string
        unitLabel: string
        zoneName: string
        residentName: string | null
        usage: string
        validUntil: string
    }
    miss?: { reason: string, message: string }
}

export async function verifyCodeAction (estateId: string, _: VerifyState, formData: FormData): Promise<VerifyState> {
    const user = await requireUser()
    try {
        const result = await verifyGateCode(actorFromUser(user), estateId, String(formData.get('code') ?? ''), await gateDeviceId())
        if (!result.ok) return { miss: { reason: result.reason, message: result.message }, nonce: Date.now() }
        const p = result.pass
        return {
            ok: true,
            nonce: Date.now(),
            hit: {
                passId: p.id, visitorName: p.visitorName, visitorPhone: p.visitorPhone, vehiclePlate: p.vehiclePlate, purpose: p.purpose,
                unitLabel: result.unitLabel, zoneName: result.zoneName, residentName: result.residentName, usage: p.usage,
                validUntil: formatDateTime(p.validUntil),
            },
        }
    } catch (e) {
        return toActionError(e)
    }
}

async function gateAction (estateId: string, fn: (actor: ReturnType<typeof actorFromUser>) => Promise<string>): Promise<ActionState> {
    const user = await requireUser()
    return runAction(async () => {
        const message = await fn(actorFromUser(user))
        revalidatePath(`/gate/${estateId}`)
        return message
    })
}

export async function admitPassAction (estateId: string, passId: string, _: ActionState, formData: FormData) {
    return gateAction(estateId, async (actor) => {
        const v = await checkInWithPass(actor, estateId, passId, Number(formData.get('gate') ?? 1))
        return `${v.visitorName} checked in. The resident has been told.`
    })
}

export async function denyPassAction (estateId: string, passId: string, _: ActionState, formData: FormData) {
    return gateAction(estateId, async (actor) => {
        const v = await denyPassEntry(actor, estateId, passId, String(formData.get('reason') ?? ''), Number(formData.get('gate') ?? 1))
        return `${v.visitorName} was not admitted. Logged.`
    })
}

export async function walkInAction (estateId: string, _: ActionState, formData: FormData) {
    return gateAction(estateId, async (actor) => {
        const v = await logWalkIn(actor, estateId, formObject(formData) as never)
        return `Asked the resident about ${v.visitorName}. Wait for their answer below.`
    })
}

export async function admitWalkInAction (estateId: string, visitId: string, _: ActionState) {
    return gateAction(estateId, async (actor) => {
        const v = await checkInApprovedWalkIn(actor, estateId, visitId)
        return `${v.visitorName} checked in.`
    })
}

export async function checkOutAction (estateId: string, visitId: string, _: ActionState) {
    return gateAction(estateId, async (actor) => {
        const v = await checkOutVisit(actor, estateId, visitId)
        return `${v.visitorName} checked out.`
    })
}
