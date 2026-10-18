'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { actorFromUser } from '@/lib/access'
import { type ActionState, formObject, runAction, toActionError } from '@/lib/actions'
import { requireUser } from '@/lib/auth/current'
import { cancelDistress, raiseDistress } from '@/lib/emergency'
import { addHelper, addVehicle, getMyHome, removeHelper, removeVehicle } from '@/lib/residents'
import { cancelPass, createPass, decideWalkIn } from '@/lib/visitors'

async function forMyHome (occupancyId: string, fn: (ctx: { actor: ReturnType<typeof actorFromUser>, estateId: string, unitId: string }) => Promise<string>) {
    const user = await requireUser()
    return runAction(async () => {
        const actor = actorFromUser(user)
        const home = await getMyHome(actor, occupancyId)
        const message = await fn({ actor, estateId: home.occupancy.estateId, unitId: home.unit.id })
        revalidatePath(`/home/${occupancyId}`)
        return message
    })
}

export async function addMyVehicleAction (occupancyId: string, _: ActionState, formData: FormData) {
    return forMyHome(occupancyId, async ({ actor, estateId, unitId }) => {
        const v = await addVehicle(actor, estateId, { ...formObject(formData), unitId } as never)
        return `${v.plate} added.`
    })
}

export async function removeMyVehicleAction (occupancyId: string, vehicleId: string, _: ActionState) {
    return forMyHome(occupancyId, async ({ actor, estateId }) => {
        await removeVehicle(actor, estateId, vehicleId)
        return 'Vehicle removed.'
    })
}

export async function addMyHelperAction (occupancyId: string, _: ActionState, formData: FormData) {
    return forMyHome(occupancyId, async ({ actor, estateId, unitId }) => {
        const h = await addHelper(actor, estateId, { ...formObject(formData), unitId } as never)
        return `${h.name} added.`
    })
}

export async function removeMyHelperAction (occupancyId: string, helperId: string, _: ActionState) {
    return forMyHome(occupancyId, async ({ actor, estateId }) => {
        await removeHelper(actor, estateId, helperId)
        return 'Removed.'
    })
}

export async function createPassAction (occupancyId: string, _: ActionState, formData: FormData): Promise<ActionState> {
    const user = await requireUser()
    let passId: string
    try {
        const actor = actorFromUser(user)
        const home = await getMyHome(actor, occupancyId)
        const pass = await createPass(actor, home.occupancy.estateId, { ...formObject(formData), unitId: home.unit.id } as never)
        passId = pass.id
    } catch (e) {
        return toActionError(e)
    }
    redirect(`/home/${occupancyId}/passes/${passId}`)
}

export async function cancelPassAction (occupancyId: string, passId: string, _: ActionState) {
    return forMyHome(occupancyId, async ({ actor, estateId }) => {
        await cancelPass(actor, estateId, passId)
        revalidatePath(`/home/${occupancyId}/passes`)
        return 'Pass cancelled.'
    })
}

export async function decideWalkInAction (occupancyId: string, visitId: string, approve: boolean, _: ActionState) {
    return forMyHome(occupancyId, async ({ actor, estateId }) => {
        await decideWalkIn(actor, estateId, visitId, approve)
        revalidatePath('/app')
        return approve ? 'Approved. The guard will let them in.' : 'Declined. The guard has been told.'
    })
}

/**
 * The emergency button. Called directly from the client (not a form) with whatever GPS fix the phone gave.
 * Returns where to go next so the client can open the alert screen straight away.
 */
export async function raiseDistressAction (occupancyId: string, position: { latitude?: number, longitude?: number, accuracy?: number } | null): Promise<{ href?: string, error?: string }> {
    const user = await requireUser()
    try {
        const actor = actorFromUser(user)
        const home = await getMyHome(actor, occupancyId)
        const { alert } = await raiseDistress(actor, home.occupancy.estateId, { unitId: home.unit.id, ...(position ?? {}) })
        revalidatePath('/app')
        return { href: `/home/${occupancyId}/emergency/${alert.id}` }
    } catch (e) {
        return { error: toActionError(e).error }
    }
}

export async function cancelDistressAction (occupancyId: string, alertId: string, _: ActionState) {
    return forMyHome(occupancyId, async ({ actor, estateId }) => {
        await cancelDistress(actor, estateId, alertId)
        revalidatePath(`/home/${occupancyId}/emergency/${alertId}`)
        return 'Alert cancelled. Security has been told it was a false alarm.'
    })
}
