'use client'

// Access to the Android app's native features from the web pages it shows. The app (mobile/) is a Capacitor shell
// around this site, so its plugins appear on window.Capacitor. In an ordinary browser none of this exists and every
// helper returns null/false.

interface Listener { remove (): Promise<void> }

export interface PushPlugin {
    checkPermissions (): Promise<{ receive: string }>
    requestPermissions (): Promise<{ receive: string }>
    register (): Promise<void>
    createChannel (c: { id: string, name: string, description?: string, importance: 1 | 2 | 3 | 4 | 5, sound?: string, vibration?: boolean, visibility?: number }): Promise<void>
    addListener (event: 'registration', fn: (t: { value: string }) => void): Promise<Listener>
    addListener (event: 'pushNotificationActionPerformed', fn: (a: { notification: { data?: Record<string, string> } }) => void): Promise<Listener>
}

export interface BiometricPlugin {
    isAvailable (): Promise<{ isAvailable: boolean }>
    verifyIdentity (o: { reason?: string, title?: string, subtitle?: string, description?: string, negativeButtonText?: string, maxAttempts?: number, useFallback?: boolean }): Promise<void>
}

type CapWindow = Window & { Capacitor?: { isNativePlatform?: () => boolean, Plugins?: Record<string, unknown> } }

export function isNativeApp (): boolean {
    return typeof window !== 'undefined' && Boolean((window as CapWindow).Capacitor?.isNativePlatform?.())
}

function plugin<T> (name: string): T | null {
    if (!isNativeApp()) return null
    return ((window as CapWindow).Capacitor?.Plugins?.[name] as T | undefined) ?? null
}

/**
 * The push plugin, only in builds that include Firebase (the build adds "MyEstateappPush" to the user agent);
 * calling it in a build without Firebase would crash the app.
 */
export function pushPlugin (): PushPlugin | null {
    return typeof navigator !== 'undefined' && navigator.userAgent.includes('MyEstateappPush') ? plugin<PushPlugin>('PushNotifications') : null
}

export function biometricPlugin (): BiometricPlugin | null {
    return plugin<BiometricPlugin>('NativeBiometric')
}

const PUSH_TOKEN_KEY = 'myestate:pushToken'
const LOCK_KEY = 'myestate:appLock'

export const storage = {
    get pushToken () { try { return localStorage.getItem(PUSH_TOKEN_KEY) } catch { return null } },
    set pushToken (v: string | null) { try { if (v) localStorage.setItem(PUSH_TOKEN_KEY, v); else localStorage.removeItem(PUSH_TOKEN_KEY) } catch { /* unavailable */ } },
    get appLock () { try { return localStorage.getItem(LOCK_KEY) === 'on' } catch { return false } },
    set appLock (on: boolean) { try { localStorage.setItem(LOCK_KEY, on ? 'on' : 'off') } catch { /* unavailable */ } },
}
