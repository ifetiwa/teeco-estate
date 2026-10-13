import 'server-only'

import { notFound } from 'next/navigation'
import { cache } from 'react'

import { actorFromUser, getEstateAccess } from '@/lib/access'
import { requireUser } from '@/lib/auth/current'
import { getEstateForStaff } from '@/lib/estates'
import { ForbiddenError, NotFoundError } from '@/lib/errors'

/** Loads the estate for a staff page; unknown estates and non-staff users get a 404 (no existence leak). */
export const loadStaffEstate = cache(async (estateId: string) => {
    const user = await requireUser()
    const actor = actorFromUser(user)
    try {
        const [estate, access] = await Promise.all([getEstateForStaff(actor, estateId), getEstateAccess(actor, estateId)])
        return { user, actor, estate, access, isAdmin: access.staffRoles.includes('estate_admin') }
    } catch (e) {
        if (e instanceof ForbiddenError || e instanceof NotFoundError) notFound()
        // invalid uuid etc.
        if (e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === '22P02') notFound()
        throw e
    }
})
