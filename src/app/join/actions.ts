'use server'

import { redirect } from 'next/navigation'

import { actorFromUser } from '@/lib/access'
import { type ActionState, formObject, toActionError } from '@/lib/actions'
import { requireUser } from '@/lib/auth/current'
import { findEstateByJoinCode } from '@/lib/estates'
import { registerAsResident } from '@/lib/residents'

export async function lookupJoinCodeAction (_: ActionState, formData: FormData): Promise<ActionState> {
    await requireUser()
    const code = String(formData.get('joinCode') ?? '').trim().toUpperCase().replace(/[\s-]/g, '')
    try {
        await findEstateByJoinCode(code)
    } catch (e) {
        return toActionError(e)
    }
    redirect(`/join?code=${encodeURIComponent(code)}`)
}

export async function registerAction (_: ActionState, formData: FormData): Promise<ActionState> {
    const user = await requireUser()
    try {
        await registerAsResident(actorFromUser(user), formObject(formData) as never)
    } catch (e) {
        return toActionError(e)
    }
    redirect('/app')
}
