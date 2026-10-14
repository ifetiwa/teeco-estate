import 'server-only'

import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { cache } from 'react'

import { type Capability, actorFromUser } from '@/lib/access'
import { requireUser } from '@/lib/auth/current'
import { getEstateForStaff } from '@/lib/estates'
import { ForbiddenError, NotFoundError } from '@/lib/errors'
import { recordSupportView } from '@/lib/support'

/**
 * Loads the estate for a staff-area page. Unknown estates and users without access get a 404 (no existence leak).
 * Views by Teeco support are written to the estate's audit log.
 */
export const loadStaffEstate = cache(async (estateId: string) => {
    const user = await requireUser()
    const actor = actorFromUser(user)
    let result
    try {
        result = await getEstateForStaff(actor, estateId)
    } catch (e) {
        if (e instanceof ForbiddenError || e instanceof NotFoundError) notFound()
        if (e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === '22P02') notFound() // not a uuid
        throw e
    }
    const { estate, access } = result
    if (access.viaSupport) {
        const page = (await headers()).get('x-pathname') ?? `/estate/${estateId}`
        await recordSupportView(actor, estateId, page)
    }
    const can = (c: Capability) => access.capabilities.has(c)
    return { user, actor, estate, access, can, isAdmin: can('residents.manage') }
})
