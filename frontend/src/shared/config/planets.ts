/**
 * Shared 9 Solar System bodies metadata and J2000 Keplerian ephemeris (Standish / JPL 1800–2050 AD).
 * Used on both `/the-eyes` (apparent geocentric sky coordinates on the celestial sphere) and
 * `/where-are-you` (3D heliocentric view).
 */

export type PlanetKey =
  | 'mercury'
  | 'venus'
  | 'earth'
  | 'mars'
  | 'jupiter'
  | 'saturn'
  | 'uranus'
  | 'neptune'
  | 'pluto'

export type PlanetCategory =
  | 'Rocky inner planet'
  | 'Home planet (observer)'
  | 'Gas giant'
  | 'Ice giant'
  | 'Kuiper Belt dwarf planet'

export interface PlanetMeta {
  key: PlanetKey
  name: string
  symbol: string
  category: PlanetCategory
  color: string
  semiMajorAxisAu: number
  orbitalPeriodYears: number
  sceneOrbitRadius: number
  sceneBodyRadius: number
  funFact: string
  spherexNote: string
}

export interface PlanetSkyPosition {
  key: PlanetKey
  name: string
  symbol: string
  category: PlanetCategory
  color: string
  isObserver: boolean
  epochMjd: number
  /** Geocentric ICRS right ascension in degrees [0, 360). `0` for Earth (observer). */
  ra: number
  /** Geocentric ICRS declination in degrees [-90, 90]. `-90` for Earth nadir. */
  dec: number
  /** Heliocentric distance r in AU. */
  helioAu: number
  /** Geocentric distance Delta in AU (`0` for Earth). */
  geoAu: number
  /** One-way light travel time from Earth in minutes. */
  lightTimeMin: number
  /** Angular separation from the Sun as seen from Earth in degrees (`0..180`). */
  elongationDeg: number
  /** Heliocentric J2000 ecliptic coordinates [x, y, z] in AU. */
  helioEclipticXyzAu: [number, number, number]
  funFact: string
  spherexNote: string
}

interface OrbitalElements {
  /** Semi-major axis a0 (AU), rate per Julian century */
  a: [number, number]
  /** Eccentricity e0, rate */
  e: [number, number]
  /** Inclination I0 (deg), rate */
  I: [number, number]
  /** Mean longitude L0 (deg), rate */
  L: [number, number]
  /** Longitude of perihelion wBar0 (deg), rate */
  wBar: [number, number]
  /** Longitude of ascending node omega0 (deg), rate */
  omega: [number, number]
}

const ELEMENTS: Record<PlanetKey, OrbitalElements> = {
  mercury: {
    a: [0.38709927, 0.00000037],
    e: [0.20563593, 0.00001906],
    I: [7.00497902, -0.00594749],
    L: [252.2503235, 149472.67411175],
    wBar: [77.45779628, 0.16047689],
    omega: [48.33076593, -0.12534081],
  },
  venus: {
    a: [0.72333566, 0.0000039],
    e: [0.00677672, -0.00004107],
    I: [3.39467605, -0.0007889],
    L: [181.9790995, 58517.81538729],
    wBar: [131.60246718, 0.00268329],
    omega: [76.67984255, -0.27769418],
  },
  earth: {
    a: [1.00000261, 0.00000562],
    e: [0.01671123, -0.00004392],
    I: [-0.00001531, -0.01294668],
    L: [100.46457166, 35999.37244981],
    wBar: [102.93768193, 0.32327364],
    omega: [0.0, 0.0],
  },
  mars: {
    a: [1.52371034, 0.00001847],
    e: [0.0933941, 0.00007882],
    I: [1.84969142, -0.00813131],
    L: [-4.55343205, 19140.30268499],
    wBar: [-23.94362959, 0.44441088],
    omega: [49.55953891, -0.29257343],
  },
  jupiter: {
    a: [5.202887, -0.00011607],
    e: [0.04838624, -0.00013253],
    I: [1.30439695, -0.00183714],
    L: [34.39644051, 3034.74612775],
    wBar: [14.72847983, 0.21252668],
    omega: [100.47390909, 0.20469106],
  },
  saturn: {
    a: [9.53667594, -0.0012506],
    e: [0.05386179, -0.00050991],
    I: [2.48599187, 0.00193609],
    L: [49.95424423, 1222.49362201],
    wBar: [92.59887831, -0.41897216],
    omega: [113.66242448, -0.28867794],
  },
  uranus: {
    a: [19.18916464, -0.00196176],
    e: [0.04725744, -0.00004397],
    I: [0.77263783, -0.00242939],
    L: [313.23810451, 428.48202785],
    wBar: [170.9542763, 0.40805281],
    omega: [74.01692503, 0.04240589],
  },
  neptune: {
    a: [30.06992276, 0.00026291],
    e: [0.00859048, 0.00005105],
    I: [1.77004347, 0.00035372],
    L: [-55.12002969, 218.45945325],
    wBar: [44.96476227, -0.32241464],
    omega: [131.78422574, -0.00508664],
  },
  pluto: {
    a: [39.48211675, -0.00031596],
    e: [0.2488273, 0.0000517],
    I: [17.14001206, 0.00004818],
    L: [238.92903833, 145.20780515],
    wBar: [224.06891629, -0.04062942],
    omega: [110.30393684, -0.01183482],
  },
}

export const SOLAR_PLANETS: readonly PlanetMeta[] = [
  {
    key: 'mercury',
    name: 'Mercury',
    symbol: '☿',
    category: 'Rocky inner planet',
    color: '#c9b8a3',
    semiMajorAxisAu: 0.387,
    orbitalPeriodYears: 0.241,
    sceneOrbitRadius: 1.25,
    sceneBodyRadius: 0.11,
    funFact: 'The closest planet to the Sun whips all the way around it in just 88 Earth days!',
    spherexNote: 'Always inside SPHEREx’s solar-elongation avoidance zone (~89° Sun angle); bright thermal emission would saturate IR detectors.',
  },
  {
    key: 'venus',
    name: 'Venus',
    symbol: '♀',
    category: 'Rocky inner planet',
    color: '#f2d399',
    semiMajorAxisAu: 0.723,
    orbitalPeriodYears: 0.615,
    sceneOrbitRadius: 1.95,
    sceneBodyRadius: 0.16,
    funFact: 'Wrapped in thick sulfuric clouds, Venus is the brightest planet in our night sky after the Moon.',
    spherexNote: 'Usually below the ~90° solar-elongation limit; when outside, extreme IR brightness triggers bright-planet detector masking.',
  },
  {
    key: 'earth',
    name: 'Earth',
    symbol: '⊕',
    category: 'Home planet (observer)',
    color: '#5fb6e8',
    semiMajorAxisAu: 1.0,
    orbitalPeriodYears: 1.0,
    sceneOrbitRadius: 2.75,
    sceneBodyRadius: 0.42,
    funFact: 'You are observing from right above Earth! Toggle "Ground" to picture our home planet below the telescope.',
    spherexNote: 'SPHEREx orbits ~650 km above Earth along the terminator; Earth’s 300 K thermal glow is blocked by three nested photon-shield cones.',
  },
  {
    key: 'mars',
    name: 'Mars',
    symbol: '♂',
    category: 'Rocky inner planet',
    color: '#e07a5f',
    semiMajorAxisAu: 1.524,
    orbitalPeriodYears: 1.881,
    sceneOrbitRadius: 3.45,
    sceneBodyRadius: 0.13,
    funFact: 'Iron oxide dust makes Mars look rusty red, and it takes nearly two Earth years to finish one lap around the Sun.',
    spherexNote: 'Visible near quadrature at ~90° solar elongation; saturates brightest IR channels but illuminates hydrated minerals in reflected near-IR.',
  },
  {
    key: 'jupiter',
    name: 'Jupiter',
    symbol: '♃',
    category: 'Gas giant',
    color: '#e5b887',
    semiMajorAxisAu: 5.203,
    orbitalPeriodYears: 11.86,
    sceneOrbitRadius: 4.35,
    sceneBodyRadius: 0.27,
    funFact: 'The largest planet in the Solar System is big enough to fit over 1,300 Earths inside it!',
    spherexNote: 'A moving bright foreground source whose scattered-light PSF wings and methane 2.3/3.3 μm features appear along the ecliptic.',
  },
  {
    key: 'saturn',
    name: 'Saturn',
    symbol: '♄',
    category: 'Gas giant',
    color: '#edd498',
    semiMajorAxisAu: 9.537,
    orbitalPeriodYears: 29.46,
    sceneOrbitRadius: 5.25,
    sceneBodyRadius: 0.22,
    funFact: 'Saturn’s wide sparkling rings are made of billions of chunks of water ice and rock orbiting the giant planet.',
    spherexNote: 'Water-ice ring reflectance shows strong 1.5 μm, 2.0 μm, and 3.0 μm absorption bands across SPHEREx detectors D2–D4.',
  },
  {
    key: 'uranus',
    name: 'Uranus',
    symbol: '♅',
    category: 'Ice giant',
    color: '#8bd8e8',
    semiMajorAxisAu: 19.189,
    orbitalPeriodYears: 84.01,
    sceneOrbitRadius: 6.05,
    sceneBodyRadius: 0.17,
    funFact: 'Uranus rolls around the Sun tipped onto its side at a 98° tilt, giving it 42-year-long summers and winters.',
    spherexNote: 'Faint enough to probe CH₄ absorption and upper-tropospheric haze spectroscopy across 0.75–5.0 μm.',
  },
  {
    key: 'neptune',
    name: 'Neptune',
    symbol: '♆',
    category: 'Ice giant',
    color: '#5b8cff',
    semiMajorAxisAu: 30.07,
    orbitalPeriodYears: 164.8,
    sceneOrbitRadius: 6.8,
    sceneBodyRadius: 0.17,
    funFact: 'The windiest major planet sits 30× farther from the Sun than Earth, where sunlight takes over 4 hours to arrive.',
    spherexNote: 'High signal-to-noise moving target for SPHEREx 1–5 μm methane and CO ice/gas diagnostics.',
  },
  {
    key: 'pluto',
    name: 'Pluto',
    symbol: '⯓',
    category: 'Kuiper Belt dwarf planet',
    color: '#cbb6a5',
    semiMajorAxisAu: 39.482,
    orbitalPeriodYears: 247.9,
    sceneOrbitRadius: 7.5,
    sceneBodyRadius: 0.095,
    funFact: 'Even though Pluto is far out in the icy Kuiper Belt, it has frozen nitrogen plains shaped like a giant heart.',
    spherexNote: 'SPHEREx spectro-photometry samples outer Solar System volatiles (N₂, CH₄, CO, and H₂O ices) across 0.75–5.0 μm.',
  },
] as const

export const PLANET_BY_KEY = new Map<PlanetKey, PlanetMeta>(SOLAR_PLANETS.map((p) => [p.key, p]))

const DEG2RAD = Math.PI / 180
const RAD2DEG = 180 / Math.PI
/** J2000 obliquity of the ecliptic (degrees). */
const OBLIQUITY_DEG = 23.43928
/** Light travel time across 1 AU (minutes). */
const LIGHT_MINUTES_PER_AU = 499.0047838 / 60

export function currentMjd(now = new Date()): number {
  return now.getTime() / 86_400_000 + 40587.0
}

function normDeg(deg: number): number {
  const m = deg % 360
  return m < 0 ? m + 360 : m
}

function solveEccentricAnomaly(meanAnomalyRad: number, e: number): number {
  let E = meanAnomalyRad + e * Math.sin(meanAnomalyRad)
  for (let i = 0; i < 6; i++) {
    const dM = meanAnomalyRad - (E - e * Math.sin(E))
    const dE = dM / (1 - e * Math.cos(E))
    E += dE
  }
  return E
}

function heliocentricEclipticXyzAu(el: OrbitalElements, centuriesSinceJ2000: number): [number, number, number] {
  const a = el.a[0] + el.a[1] * centuriesSinceJ2000
  const e = el.e[0] + el.e[1] * centuriesSinceJ2000
  const I = (el.I[0] + el.I[1] * centuriesSinceJ2000) * DEG2RAD
  const L = el.L[0] + el.L[1] * centuriesSinceJ2000
  const wBar = el.wBar[0] + el.wBar[1] * centuriesSinceJ2000
  const omega = (el.omega[0] + el.omega[1] * centuriesSinceJ2000) * DEG2RAD
  const w = (wBar - (el.omega[0] + el.omega[1] * centuriesSinceJ2000)) * DEG2RAD
  const M = (normDeg(L - wBar) > 180 ? normDeg(L - wBar) - 360 : normDeg(L - wBar)) * DEG2RAD

  const E = solveEccentricAnomaly(M, e)
  const xp = a * (Math.cos(E) - e)
  const yp = a * Math.sqrt(Math.max(0, 1 - e * e)) * Math.sin(E)

  const cosW = Math.cos(w)
  const sinW = Math.sin(w)
  const cosO = Math.cos(omega)
  const sinO = Math.sin(omega)
  const cosI = Math.cos(I)
  const sinI = Math.sin(I)

  const x = (cosW * cosO - sinW * sinO * cosI) * xp + (-sinW * cosO - cosW * sinO * cosI) * yp
  const y = (cosW * sinO + sinW * cosO * cosI) * xp + (-sinW * sinO + cosW * cosO * cosI) * yp
  const z = sinW * sinI * xp + cosW * sinI * yp
  return [x, y, z]
}

/**
 * Compute heliocentric ecliptic XYZ (AU) and apparent geocentric equatorial (ICRS RA/Dec)
 * positions for all 9 Solar System bodies at Modified Julian Date `mjd`.
 */
export function computePlanetPositions(mjd: number): PlanetSkyPosition[] {
  const jd = mjd + 2400000.5
  const T = (jd - 2451545.0) / 36525.0
  const earthXyz = heliocentricEclipticXyzAu(ELEMENTS.earth, T)
  const cosEps = Math.cos(OBLIQUITY_DEG * DEG2RAD)
  const sinEps = Math.sin(OBLIQUITY_DEG * DEG2RAD)

  return SOLAR_PLANETS.map((meta) => {
    const helio = meta.key === 'earth' ? earthXyz : heliocentricEclipticXyzAu(ELEMENTS[meta.key], T)
    const helioAu = Math.hypot(helio[0], helio[1], helio[2])

    if (meta.key === 'earth') {
      return {
        key: meta.key,
        name: meta.name,
        symbol: meta.symbol,
        category: meta.category,
        color: meta.color,
        isObserver: true,
        epochMjd: mjd,
        ra: 0,
        dec: -90,
        helioAu,
        geoAu: 0,
        lightTimeMin: 0,
        elongationDeg: 0,
        helioEclipticXyzAu: helio,
        funFact: meta.funFact,
        spherexNote: meta.spherexNote,
      }
    }

    const dx = helio[0] - earthXyz[0]
    const dy = helio[1] - earthXyz[1]
    const dz = helio[2] - earthXyz[2]
    const geoAu = Math.hypot(dx, dy, dz)

    // Rotate geocentric ecliptic vector to geocentric equatorial (ICRS).
    const xEq = dx
    const yEq = cosEps * dy - sinEps * dz
    const zEq = sinEps * dy + cosEps * dz

    const ra = normDeg(Math.atan2(yEq, xEq) * RAD2DEG)
    const dec = Math.asin(Math.max(-1, Math.min(1, zEq / (geoAu || 1)))) * RAD2DEG

    // Solar elongation: angle between Earth->Sun (-earthXyz) and Earth->Planet (dx, dy, dz).
    const earthR = Math.hypot(earthXyz[0], earthXyz[1], earthXyz[2]) || 1
    const dotSunPlanet = -(earthXyz[0] * dx + earthXyz[1] * dy + earthXyz[2] * dz)
    const cosElong = Math.max(-1, Math.min(1, dotSunPlanet / (earthR * (geoAu || 1))))
    const elongationDeg = Math.acos(cosElong) * RAD2DEG

    return {
      key: meta.key,
      name: meta.name,
      symbol: meta.symbol,
      category: meta.category,
      color: meta.color,
      isObserver: false,
      epochMjd: mjd,
      ra,
      dec,
      helioAu,
      geoAu,
      lightTimeMin: geoAu * LIGHT_MINUTES_PER_AU,
      elongationDeg,
      helioEclipticXyzAu: helio,
      funFact: meta.funFact,
      spherexNote: meta.spherexNote,
    }
  })
}
