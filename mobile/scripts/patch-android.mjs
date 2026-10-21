// Adjusts the generated Android project (android/ is created by `cap add android` and not committed):
// - location permission, so the emergency button can share the phone's GPS position
// - camera, for scanning visitors' QR codes at the gate
// - vibration, for the alarm on the security dashboard and the emergency button
// - package visibility for the dialer, SMS and WhatsApp links (Android 11+)
// - version code/name from the environment (the CI run number), so each APK installs over the last one
import { readFileSync, writeFileSync } from 'node:fs'

const manifestPath = 'android/app/src/main/AndroidManifest.xml'
let manifest = readFileSync(manifestPath, 'utf8')
const permissions = ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION', 'CAMERA', 'VIBRATE']
    .filter(p => !manifest.includes(`android.permission.${p}"`))
    .map(p => `    <uses-permission android:name="android.permission.${p}" />`)
const queries = `
    <queries>
        <intent><action android:name="android.intent.action.DIAL" /><data android:scheme="tel" /></intent>
        <intent><action android:name="android.intent.action.VIEW" /><data android:scheme="tel" /></intent>
        <intent><action android:name="android.intent.action.SENDTO" /><data android:scheme="sms" /></intent>
        <intent><action android:name="android.intent.action.VIEW" /><data android:scheme="https" /></intent>
    </queries>`
if (!manifest.includes('<queries>')) manifest = manifest.replace('</manifest>', `${queries}\n</manifest>`)
// The camera is optional, so phones without one can still install the app
if (!manifest.includes('android.hardware.camera')) {
    manifest = manifest.replace('</manifest>', '    <uses-feature android:name="android.hardware.camera" android:required="false" />\n</manifest>')
}
manifest = manifest.replace('<uses-permission android:name="android.permission.INTERNET" />',
    ['<uses-permission android:name="android.permission.INTERNET" />', ...permissions].join('\n'))
writeFileSync(manifestPath, manifest)

const gradlePath = 'android/app/build.gradle'
const code = Number(process.env.APP_VERSION_CODE ?? 1)
const name = process.env.APP_VERSION_NAME ?? `1.0.${code}`
const gradle = readFileSync(gradlePath, 'utf8')
    .replace(/versionCode \d+/, `versionCode ${code}`)
    .replace(/versionName "[^"]*"/, `versionName "${name}"`)
writeFileSync(gradlePath, gradle)

console.log(`patched manifest (+${permissions.length} permissions) and set version ${name} (${code})`)
