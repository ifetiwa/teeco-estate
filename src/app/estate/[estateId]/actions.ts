'use server'

import { revalidatePath } from 'next/cache'

import { type Actor, actorFromUser } from '@/lib/access'
import { type ActionState, formObject, runAction } from '@/lib/actions'
import { requireUser } from '@/lib/auth/current'
import { regenerateJoinCode, setEstateLogo, updateEstateDetails } from '@/lib/estates'
import {
    addHelper, addResident, addVehicle, approveResident, moveOutResident, rejectResident, removeHelper, removeVehicle, setPrimaryContact,
} from '@/lib/residents'
import { addStaff, removeStaff } from '@/lib/staff'
import { saveEstateLogo } from '@/lib/storage'
import { addUnits, createZone, setUnitActive } from '@/lib/structure'

async function withActor (estateId: string, fn: (actor: Actor) => Promise<string | void>): Promise<ActionState> {
    const user = await requireUser()
    return runAction(async () => {
        const message = await fn(actorFromUser(user))
        revalidatePath(`/estate/${estateId}`, 'layout')
        return message
    })
}

export async function createZoneAction (estateId: string, _: ActionState, formData: FormData) {
    return withActor(estateId, async (actor) => {
        const zone = await createZone(actor, estateId, formObject(formData) as never)
        return `${zone.name} added.`
    })
}

export async function addUnitsAction (estateId: string, _: ActionState, formData: FormData) {
    return withActor(estateId, async (actor) => {
        const { created, skipped } = await addUnits(actor, estateId, formObject(formData) as never)
        return `${created.length} unit${created.length === 1 ? '' : 's'} added.${skipped.length ? ` Already existed: ${skipped.join(', ')}.` : ''}`
    })
}

export async function setUnitActiveAction (estateId: string, unitId: string, isActive: boolean, _: ActionState) {
    return withActor(estateId, async (actor) => {
        await setUnitActive(actor, estateId, unitId, isActive)
        return isActive ? 'Unit reactivated.' : 'Unit deactivated.'
    })
}

export async function addResidentAction (estateId: string, _: ActionState, formData: FormData) {
    return withActor(estateId, async (actor) => {
        const data = formObject(formData)
        const r = await addResident(actor, estateId, { ...data, isPrimary: data.isPrimary === 'on' } as never)
        return `${r.name} added.`
    })
}

export async function approveResidentAction (estateId: string, occupancyId: string, _: ActionState) {
    return withActor(estateId, async (actor) => {
        const r = await approveResident(actor, estateId, occupancyId)
        return `${r.name} approved.`
    })
}

export async function rejectResidentAction (estateId: string, occupancyId: string, _: ActionState, formData: FormData) {
    return withActor(estateId, async (actor) => {
        const r = await rejectResident(actor, estateId, occupancyId, String(formData.get('reason') ?? ''))
        return `${r.name}'s request was declined.`
    })
}

export async function setPrimaryAction (estateId: string, occupancyId: string, _: ActionState) {
    return withActor(estateId, async (actor) => {
        await setPrimaryContact(actor, estateId, occupancyId)
        return 'Primary contact updated.'
    })
}

export async function moveOutAction (estateId: string, occupancyId: string, _: ActionState, formData: FormData) {
    return withActor(estateId, async (actor) => {
        const r = await moveOutResident(actor, estateId, occupancyId, String(formData.get('moveOutDate') ?? '') || undefined)
        return `${r.name} moved out. Their access has ended; history is kept.`
    })
}

export async function addVehicleAction (estateId: string, _: ActionState, formData: FormData) {
    return withActor(estateId, async (actor) => {
        const v = await addVehicle(actor, estateId, formObject(formData) as never)
        return `${v.plate} added.`
    })
}

export async function removeVehicleAction (estateId: string, vehicleId: string, _: ActionState) {
    return withActor(estateId, async (actor) => {
        await removeVehicle(actor, estateId, vehicleId)
        return 'Vehicle removed.'
    })
}

export async function addHelperAction (estateId: string, _: ActionState, formData: FormData) {
    return withActor(estateId, async (actor) => {
        const h = await addHelper(actor, estateId, formObject(formData) as never)
        return `${h.name} added.`
    })
}

export async function removeHelperAction (estateId: string, helperId: string, _: ActionState) {
    return withActor(estateId, async (actor) => {
        await removeHelper(actor, estateId, helperId)
        return 'Removed.'
    })
}

export async function updateEstateAction (estateId: string, _: ActionState, formData: FormData) {
    return withActor(estateId, async (actor) => {
        await updateEstateDetails(actor, estateId, formObject(formData) as never)
        return 'Estate details saved.'
    })
}

export async function uploadLogoAction (estateId: string, _: ActionState, formData: FormData) {
    return withActor(estateId, async (actor) => {
        const file = formData.get('logo')
        if (!(file instanceof File) || file.size === 0) return 'Choose an image first.'
        const path = await saveEstateLogo(actor, estateId, file)
        await setEstateLogo(actor, estateId, path)
        return 'Logo updated.'
    })
}

export async function regenerateJoinCodeAction (estateId: string, _: ActionState) {
    return withActor(estateId, async (actor) => {
        const code = await regenerateJoinCode(actor, estateId)
        return `New join code: ${code}. The old code no longer works.`
    })
}

export async function addStaffAction (estateId: string, _: ActionState, formData: FormData) {
    return withActor(estateId, async (actor) => {
        const m = await addStaff(actor, estateId, formObject(formData) as never)
        return `${m.role.replace('_', ' ')} role added.`
    })
}

export async function removeStaffAction (estateId: string, membershipId: string, _: ActionState) {
    return withActor(estateId, async (actor) => {
        await removeStaff(actor, estateId, membershipId)
        return 'Role removed.'
    })
}
