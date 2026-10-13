import { getStorage, isPublicKey } from '@/lib/storage'

export async function GET (_: Request, { params }: { params: Promise<{ key: string[] }> }) {
    const key = (await params).key.join('/')
    if (!isPublicKey(key)) return new Response('Not found', { status: 404 })
    const file = await getStorage().get(key)
    if (!file) return new Response('Not found', { status: 404 })
    return new Response(new Uint8Array(file.data), {
        headers: {
            'Content-Type': file.contentType,
            'Cache-Control': 'public, max-age=31536000, immutable',
            'X-Content-Type-Options': 'nosniff',
        },
    })
}
