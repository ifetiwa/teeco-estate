import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { withDbContext } from '@/db'
import { type Actor, requireCapability } from '@/lib/access'
import { randomToken } from '@/lib/crypto'
import { AppError } from '@/lib/errors'

export interface StorageProvider {
    put (key: string, data: Buffer, contentType: string): Promise<void>
    get (key: string): Promise<{ data: Buffer, contentType: string } | null>
}

const KEY_RE = /^[a-z0-9-]+\/[A-Za-z0-9._-]+$/

/** Local-disk storage for development and single-server installs. Swap for S3-compatible storage in production. */
export class LocalDiskStorage implements StorageProvider {
    constructor (private readonly root: string = path.resolve(/*turbopackIgnore: true*/ process.env.UPLOAD_DIR || 'uploads')) {}

    private resolve (key: string): string {
        if (!KEY_RE.test(key)) throw new Error('Invalid storage key')
        return path.join(this.root, key)
    }

    async put (key: string, data: Buffer, contentType: string) {
        const file = this.resolve(key)
        await mkdir(path.dirname(file), { recursive: true })
        await writeFile(file, data)
        await writeFile(`${file}.type`, contentType)
    }

    async get (key: string) {
        try {
            const file = this.resolve(key)
            const [data, contentType] = await Promise.all([readFile(file), readFile(`${file}.type`, 'utf8')])
            return { data, contentType }
        } catch {
            return null
        }
    }
}

const globalForStorage = globalThis as unknown as { teecoStorage?: StorageProvider }

export function getStorage (): StorageProvider {
    if (!globalForStorage.teecoStorage) globalForStorage.teecoStorage = new LocalDiskStorage()
    return globalForStorage.teecoStorage
}

export function setStorage (s: StorageProvider): void {
    globalForStorage.teecoStorage = s
}

const IMAGE_SIGNATURES: Array<{ type: string, ext: string, test: (b: Buffer) => boolean }> = [
    { type: 'image/png', ext: 'png', test: b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
    { type: 'image/jpeg', ext: 'jpg', test: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
    { type: 'image/webp', ext: 'webp', test: b => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP' },
]

/** Identifies an image by its bytes (not the client-supplied type). */
export function detectImage (data: Buffer): { type: string, ext: string } | null {
    const match = IMAGE_SIGNATURES.find(s => s.test(data))
    return match ? { type: match.type, ext: match.ext } : null
}

export const MAX_LOGO_BYTES = 1024 * 1024

export async function saveEstateLogo (actor: Actor, estateId: string, file: Blob): Promise<string> {
    await withDbContext({ estateId, userId: actor.userId }, tx => requireCapability(tx, actor, estateId, 'estate.manage'))
    if (file.size > MAX_LOGO_BYTES) throw new AppError('The logo must be 1 MB or smaller.')
    const data = Buffer.from(await file.arrayBuffer())
    const image = detectImage(data)
    if (!image) throw new AppError('Upload a PNG, JPEG or WebP image.')
    const key = `logos/${estateId}-${randomToken(8)}.${image.ext}`
    await getStorage().put(key, data, image.type)
    return key
}

/** Keys under these prefixes may be served without a session (estate logos only). */
export function isPublicKey (key: string): boolean {
    return key.startsWith('logos/') && KEY_RE.test(key)
}
