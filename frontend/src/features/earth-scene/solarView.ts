/**
 * Two views of the Where-are-you scene and the transition between them (pure maths, no rendering):
 * - Earth view (t = 0): Earth at the centre, the Sun up and to the left, as before.
 * - Solar view (t = 1): the Sun at the centre, Earth on its yearly orbit, SPHEREx still around Earth.
 * Sizes, distances and speeds are illustrative.
 */
import * as THREE from 'three'

export const SUN_POS_EARTH_VIEW = new THREE.Vector3(-3.7, 1.5, -5)
export const SUN_RADIUS = 0.62
/** Earth's orbit in the solar view (ecliptic = scene XZ plane). */
export const EARTH_ORBIT_RADIUS = 2.75
/** Illustrative: one year in 40 s (Earth view day = 48 s, SPHEREx orbit = 24 s; none to scale). */
export const EARTH_YEAR_SECONDS = 40
export const TRANSITION_SECONDS = 1.6
/** Where Earth joins its orbit: right of the Sun, slightly towards the camera. */
export const EARTH_START_ANGLE = 0.35

const CAMERA_EARTH = new THREE.Vector3(0, 0, 4.6)
const CAMERA_SOLAR = new THREE.Vector3(0, 4.9, 13.0)

export interface SolarExtraPlanet {
  key: 'mercury' | 'venus' | 'mars' | 'jupiter' | 'saturn' | 'uranus' | 'neptune' | 'pluto'
  name: string
  orbitRadius: number
  bodyRadius: number
  startAngle: number
  /** Orbital period relative to Earth's year (inner planets orbit faster, outer planets slower). */
  periodRatio: number
  inclinationRad: number
  baseColor: string
  spotColors: string[]
  bands: number
  hasRing?: boolean
}

export const SOLAR_EXTRA_PLANETS: readonly SolarExtraPlanet[] = [
  {
    key: 'mercury',
    name: 'Mercury',
    orbitRadius: 1.55,
    bodyRadius: 0.08,
    startAngle: 3.05,
    periodRatio: 0.241,
    inclinationRad: 0.04,
    baseColor: '#a69c92',
    spotColors: ['#7d746b', '#c4bbb1', '#8f867c'],
    bands: 0,
  },
  {
    key: 'venus',
    name: 'Venus',
    orbitRadius: 2.1,
    bodyRadius: 0.12,
    startAngle: 5.95,
    periodRatio: 0.615,
    inclinationRad: 0.02,
    baseColor: '#e6c589',
    spotColors: ['#cfa35e', '#f5dfa9', '#b88844'],
    bands: 4,
  },
  {
    key: 'mars',
    name: 'Mars',
    orbitRadius: 3.35,
    bodyRadius: 0.1,
    startAngle: 2.45,
    periodRatio: 1.881,
    inclinationRad: 0.02,
    baseColor: '#c95e3f',
    spotColors: ['#963c24', '#e48562', '#6e2e1d'],
    bands: 0,
  },
  {
    key: 'jupiter',
    name: 'Jupiter',
    orbitRadius: 4.1,
    bodyRadius: 0.22,
    startAngle: 3.65,
    periodRatio: 11.86,
    inclinationRad: 0.015,
    baseColor: '#d9b084',
    spotColors: ['#a46c43', '#f2dfc2', '#c88c5d'],
    bands: 9,
  },
  {
    key: 'saturn',
    name: 'Saturn',
    orbitRadius: 4.85,
    bodyRadius: 0.18,
    startAngle: 0.42,
    periodRatio: 29.46,
    inclinationRad: 0.03,
    baseColor: '#e6cd93',
    spotColors: ['#c2a467', '#f5e6bb', '#b49252'],
    bands: 6,
    hasRing: true,
  },
  {
    key: 'uranus',
    name: 'Uranus',
    orbitRadius: 5.45,
    bodyRadius: 0.14,
    startAngle: 2.88,
    periodRatio: 84.01,
    inclinationRad: 0.015,
    baseColor: '#86d2e0',
    spotColors: ['#6cb8c8', '#b0e8f2', '#5ea6b8'],
    bands: 3,
  },
  {
    key: 'neptune',
    name: 'Neptune',
    orbitRadius: 5.95,
    bodyRadius: 0.14,
    startAngle: 5.75,
    periodRatio: 164.8,
    inclinationRad: 0.02,
    baseColor: '#4a7ae6',
    spotColors: ['#3158b8', '#7ba4ff', '#27469a'],
    bands: 4,
  },
  {
    key: 'pluto',
    name: 'Pluto',
    orbitRadius: 6.4,
    bodyRadius: 0.075,
    startAngle: 2.25,
    periodRatio: 247.9,
    inclinationRad: 0.11,
    baseColor: '#bfa997',
    spotColors: ['#8c7564', '#e5d5c6', '#a48d7b'],
    bands: 0,
  },
] as const

export function planetOrbitPosition(orbitRadius: number, angle: number, inclinationRad = 0, out = new THREE.Vector3()): THREE.Vector3 {
  const x = Math.cos(angle) * orbitRadius
  const z0 = Math.sin(angle) * orbitRadius
  return out.set(x, Math.sin(inclinationRad) * z0, Math.cos(inclinationRad) * z0)
}

export interface Layout {
  sunPos: THREE.Vector3
  sunScale: number
  earthPos: THREE.Vector3
  earthScale: number
  /** Extra size for the SPHEREx model so it stays visible when Earth is drawn small. */
  craftBoost: number
  camera: THREE.Vector3
  /** 0 → 1: how visible Earth's orbit path and the solar-view labels are. */
  solar: number
}

export function easeInOut(t: number): number {
  const x = Math.min(1, Math.max(0, t))
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}

export function earthOrbitPosition(angle: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(Math.cos(angle) * EARTH_ORBIT_RADIUS, 0, Math.sin(angle) * EARTH_ORBIT_RADIUS)
}

/**
 * @param t transition progress 0 (Earth view) … 1 (solar view), already eased
 * @param earthAngle Earth's angle on its orbit around the Sun
 */
export function layout(t: number, earthAngle: number, out?: Layout): Layout {
  const o: Layout = out ?? {
    sunPos: new THREE.Vector3(),
    sunScale: 1,
    earthPos: new THREE.Vector3(),
    earthScale: 1,
    craftBoost: 1,
    camera: new THREE.Vector3(),
    solar: 0,
  }
  o.sunPos.copy(SUN_POS_EARTH_VIEW).multiplyScalar(1 - t)
  o.sunScale = 1 + 0.6 * t
  earthOrbitPosition(earthAngle, o.earthPos).multiplyScalar(t)
  o.earthScale = 1 - 0.58 * t
  o.craftBoost = 1 + 1.3 * t
  o.camera.lerpVectors(CAMERA_EARTH, CAMERA_SOLAR, t)
  o.solar = t
  return o
}

/** Direction of sunlight as seen from Earth: the fixed scene light in Earth view, the real Sun otherwise. */
export function sunlightDirection(t: number, l: Layout, earthViewLight: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
  const toSun = new THREE.Vector3().subVectors(l.sunPos, l.earthPos)
  if (toSun.lengthSq() < 1e-9) return out.copy(earthViewLight)
  toSun.normalize()
  return out.lerpVectors(earthViewLight, toSun, t).normalize()
}
