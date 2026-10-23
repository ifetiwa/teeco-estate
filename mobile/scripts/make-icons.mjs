// Renders every icon from the MyEstateapp logo: the Android launcher icon and splash screen sources (assets/*.png,
// for @capacitor/assets) and the website's icons (../src/app/icon.svg, ../src/app/apple-icon.png, ../public/icon-*.png).
// Keep the artwork in sync with LogoMark in src/components/Logo.tsx.
import { writeFileSync } from 'node:fs'

import sharp from 'sharp'

const GREEN = '#0f5132'
const background = `<defs><linearGradient id="mea-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#198754"/><stop offset="1" stop-color="#0a3622"/></linearGradient></defs>`
// Two homes (an estate) with a gold door and a gold sun, drawn on a 64×64 grid
const homes = `<path d="M33 27 43 18.5 53 27v22H33z" fill="#8fd1a8"/><path d="M11 33.5 25.5 21 40 33.5V49H11z" fill="#ffffff"/>`
    + `<path d="M21.5 49v-8a4 4 0 0 1 8 0v8z" fill="#d4a017"/><rect x="44" y="34" width="5" height="5" rx="1" fill="${GREEN}" opacity="0.55"/>`
    + `<circle cx="48" cy="12.5" r="3.5" fill="#d4a017"/>`
const mark = (rx) => `${background}<rect width="64" height="64" rx="${rx}" fill="url(#mea-bg)"/>${homes}`
const svg = (size, body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">${body}</svg>`)
// Shrinks the homes towards the centre, for layers that launchers crop to a circle
const centred = (scale) => `<g transform="translate(${32 - 32 * scale} ${32 - 32 * scale}) scale(${scale})">${homes}</g>`

// Android: full square icon (legacy launchers), and the adaptive icon as homes on a transparent layer plus a green layer
await sharp(svg(1024, mark(0))).png().toFile('assets/icon-only.png')
await sharp(svg(1024, centred(0.62))).png().toFile('assets/icon-foreground.png')
await sharp(svg(1024, `${background}<rect width="64" height="64" fill="url(#mea-bg)"/>`)).png().toFile('assets/icon-background.png')
// Splash: rounded logo centred on green
const logo = await sharp(svg(600, mark(16))).png().toBuffer()
for (const name of ['splash.png', 'splash-dark.png']) {
    await sharp({ create: { width: 2732, height: 2732, channels: 4, background: GREEN } })
        .composite([{ input: logo, gravity: 'center' }]).png().toFile(`assets/${name}`)
}

// Website: browser tab icon, iPhone home-screen icon and the install icons in the web app manifest
writeFileSync('../src/app/icon.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${mark(16)}</svg>\n`)
await sharp(svg(180, mark(0))).png().toFile('../src/app/apple-icon.png')
await sharp(svg(192, mark(16))).png().toFile('../public/icon-192.png')
await sharp(svg(512, mark(16))).png().toFile('../public/icon-512.png')
await sharp(svg(512, `${background}<rect width="64" height="64" fill="url(#mea-bg)"/>${centred(0.8)}`)).png().toFile('../public/icon-maskable-512.png')
console.log('icons written to assets/, src/app/ and public/')
