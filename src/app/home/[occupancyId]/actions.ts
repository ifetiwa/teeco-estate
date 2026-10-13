'use server'

import { revalidatePath } from 'next/cache'

import { actorFromUser } from '@/lib/access'
import { type ActionState, formObject, runAction } from '@/lib/actions'
import { requireUser } from '@/lib/auth/current'
import { addHelper, addVehicle, getMyHome, removeHelper, removeVehicle } from '@/lib/residents'

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
