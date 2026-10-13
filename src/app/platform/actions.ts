'use server'

import { revalidatePath } from 'next/cache'

import { actorFromUser } from '@/lib/access'
import { type ActionState, formObject, runAction } from '@/lib/actions'
import { requireUser } from '@/lib/auth/current'
import { createEstate } from '@/lib/estates'

export async function createEstateAction (_: ActionState, formData: FormData): Promise<ActionState> {
    const user = await requireUser()
    return runAction(async () => {
        const estate = await createEstate(actorFromUser(user), formObject(formData) as never)
        revalidatePath('/platform')
        return `${estate.name} created. Join code: ${estate.joinCode}. The estate admin can now sign in with their phone.`
    })
}
