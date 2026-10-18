'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { actorFromUser } from '@/lib/access'

import { type ActionState, formObject, runAction, toActionError } from '@/lib/actions'
import { requireUser } from '@/lib/auth/current'
import { addPoliceStation, setPoliceStationActive } from '@/lib/emergency'
import { createEstate } from '@/lib/estates'
import { grantSupportAccess } from '@/lib/support'

export async function createEstateAction (_: ActionState, formData: FormData): Promise<ActionState> {
    const user = await requireUser()
    return runAction(async () => {
        const estate = await createEstate(actorFromUser(user), formObject(formData) as never)
        revalidatePath('/platform')
        return `${estate.name} created. Join code: ${estate.joinCode}. The estate admin can now sign in with their phone.`
    })
}

export async function openSupportAccessAction (estateId: string, _: ActionState, formData: FormData): Promise<ActionState> {
    const user = await requireUser()
    try {
        await grantSupportAccess(actorFromUser(user), estateId, String(formData.get('reason') ?? ''))
    } catch (e) {
        return toActionError(e)
    }
    redirect(`/estate/${estateId}`)
}

export async function addPoliceStationAction (_: ActionState, formData: FormData): Promise<ActionState> {
    const user = await requireUser()
    return runAction(async () => {
        const s = await addPoliceStation(actorFromUser(user), formObject(formData) as never)
        revalidatePath('/platform')
        return `${s.name} added.`
    })
}

export async function setPoliceStationActiveAction (stationId: string, isActive: boolean, _: ActionState): Promise<ActionState> {
    const user = await requireUser()
    return runAction(async () => {
        await setPoliceStationActive(actorFromUser(user), stationId, isActive)
        revalidatePath('/platform')
        return isActive ? 'Station shown on alerts again.' : 'Station hidden from alerts.'
    })
}
