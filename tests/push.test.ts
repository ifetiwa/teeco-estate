import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { withDbContext } from '@/db'
import { pushDevices } from '@/db/schema'
import { insertNotifications } from '@/lib/notifications'
import { type PushMessage, type PushSender, registerPushDevice, sendPush, setPushSender, unregisterPushDevice } from '@/lib/push'
import { addResident } from '@/lib/residents'
import { addStaff } from '@/lib/staff'
import { raiseDistress } from '@/lib/emergency'

import { actorFor, createTestEstate, createUser, nextPhone, ownerDb, resetDb } from './helpers'

class FakeSender implements PushSender {
    sent: Array<{ token: string, m: PushMessage }> = []
    invalid = new Set<string>()
    async send (token: string, m: PushMessage) {
        if (this.invalid.has(token)) return 'invalid-token' as const
        this.sent.push({ token, m })
        return 'sent' as const
    }
}

const TOKEN = (n: number) => `fcm-token-${String(n).padStart(20, '0')}`

let sender: FakeSender
beforeEach(async () => {
    await resetDb()
    sender = new FakeSender()
    setPushSender(sender)
})
afterEach(() => setPushSender(null))

describe('push notifications', () => {
    it('sends to every registered phone of the user, and drops tokens Firebase says are gone', async () => {
        const u = await createUser()
        await registerPushDevice(u, TOKEN(1))
        await registerPushDevice(u, TOKEN(2))
        sender.invalid.add(TOKEN(2))
        await sendPush([{ userId: u.userId, title: 'Hello', body: 'World' }])
        expect(sender.sent.map(s => s.token)).toEqual([TOKEN(1)])
        expect((await ownerDb().select().from(pushDevices)).map(d => d.token)).toEqual([TOKEN(1)])
    })

    it('a phone moves to whoever signs in on it last, and is forgotten on sign-out', async () => {
        const a = await createUser()
        const b = await createUser()
        await registerPushDevice(a, TOKEN(1))
        await registerPushDevice(b, TOKEN(1))
        await sendPush([{ userId: a.userId, title: 'For A', body: '' }, { userId: b.userId, title: 'For B', body: '' }])
        expect(sender.sent.map(s => s.m.title)).toEqual(['For B'])
        await unregisterPushDevice(TOKEN(1))
        expect(await ownerDb().select().from(pushDevices)).toHaveLength(0)
    })

    it('every in-app notification is pushed, but only after the change is saved', async () => {
        const { estate, admin } = await createTestEstate()
        await registerPushDevice(admin, TOKEN(3))
        await expect(withDbContext({ estateId: estate.id }, async (tx) => {
            await insertNotifications(tx, [{ estateId: estate.id, userId: admin.userId, type: 'test', title: 'Rolled back', body: '' }])
            throw new Error('boom')
        })).rejects.toThrow('boom')
        expect(sender.sent).toHaveLength(0)
        await withDbContext({ estateId: estate.id }, tx =>
            insertNotifications(tx, [{ estateId: estate.id, userId: admin.userId, type: 'test', title: 'Saved', body: '', link: '/app' }]))
        expect(sender.sent.map(s => s.m)).toEqual([{ userId: admin.userId, title: 'Saved', body: '', link: '/app', urgent: false }])
    })

    it('an SOS reaches the guard\'s phone as an urgent push with the house', async () => {
        const t = await createTestEstate({ houses: '1-2' })
        const occ = await addResident(t.admin, t.estate.id, { unitId: t.units[0].id, name: 'Ada Obi', phone: nextPhone(), relation: 'owner' })
        const guard = actorFor((await addStaff(t.admin, t.estate.id, { name: 'Sule Guard', phone: nextPhone(), role: 'guard' })).userId)
        await registerPushDevice(guard, TOKEN(4))
        await raiseDistress(actorFor(occ.userId!), t.estate.id, { unitId: t.units[0].id })
        const push = sender.sent.find(s => s.token === TOKEN(4))!
        expect(push.m).toMatchObject({ urgent: true, link: `/security/${t.estate.id}` })
        expect(push.m.title).toContain('EMERGENCY at 1, 1st Avenue')
    })
})
