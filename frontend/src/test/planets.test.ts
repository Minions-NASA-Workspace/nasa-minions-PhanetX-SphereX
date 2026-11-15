import { describe, expect, it } from 'vitest'
import { computePlanetPositions, SOLAR_PLANETS } from '../shared/config/planets'

const ALLWISE_MJD = 55396
const SPHEREX_DR1_MJD = 60982

describe('Solar System 9-planet ephemeris', () => {
  it('computes all 9 bodies with valid ICRS coordinates and physical heliocentric distances', () => {
    const positions = computePlanetPositions(SPHEREX_DR1_MJD)
    expect(positions).toHaveLength(9)
    expect(SOLAR_PLANETS.map((p) => p.key)).toEqual([
      'mercury',
      'venus',
      'earth',
      'mars',
      'jupiter',
      'saturn',
      'uranus',
      'neptune',
      'pluto',
    ])

    const byKey = new Map(positions.map((p) => [p.key, p]))
    const earth = byKey.get('earth')!
    expect(earth.isObserver).toBe(true)
    expect(earth.geoAu).toBe(0)
    expect(earth.helioAu).toBeGreaterThan(0.98)
    expect(earth.helioAu).toBeLessThan(1.02)

    expect(byKey.get('mercury')!.helioAu).toBeGreaterThan(0.3)
    expect(byKey.get('mercury')!.helioAu).toBeLessThan(0.48)
    expect(byKey.get('jupiter')!.helioAu).toBeGreaterThan(4.9)
    expect(byKey.get('jupiter')!.helioAu).toBeLessThan(5.5)
    expect(byKey.get('neptune')!.helioAu).toBeGreaterThan(29.5)
    expect(byKey.get('neptune')!.helioAu).toBeLessThan(30.5)
    expect(byKey.get('pluto')!.helioAu).toBeGreaterThan(29)
    expect(byKey.get('pluto')!.helioAu).toBeLessThan(50)

    for (const p of positions) {
      if (p.isObserver) continue
      expect(Number.isFinite(p.ra)).toBe(true)
      expect(Number.isFinite(p.dec)).toBe(true)
      expect(p.ra).toBeGreaterThanOrEqual(0)
      expect(p.ra).toBeLessThan(360)
      expect(p.dec).toBeGreaterThanOrEqual(-90)
      expect(p.dec).toBeLessThanOrEqual(90)
      expect(p.geoAu).toBeGreaterThan(0.2)
      expect(p.lightTimeMin).toBeGreaterThan(1)
      expect(p.elongationDeg).toBeGreaterThanOrEqual(0)
      expect(p.elongationDeg).toBeLessThanOrEqual(180)
    }
  })

  it('shifts apparent sky coordinates between the WISE (2010) and SPHEREx (2025) epochs', () => {
    const wise = new Map(computePlanetPositions(ALLWISE_MJD).map((p) => [p.key, p]))
    const dr1 = new Map(computePlanetPositions(SPHEREX_DR1_MJD).map((p) => [p.key, p]))

    for (const key of ['mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'] as const) {
      const a = wise.get(key)!
      const b = dr1.get(key)!
      const dRa = Math.abs(a.ra - b.ra)
      const dDec = Math.abs(a.dec - b.dec)
      expect(dRa + dDec).toBeGreaterThan(0.5)
    }
  })
})
