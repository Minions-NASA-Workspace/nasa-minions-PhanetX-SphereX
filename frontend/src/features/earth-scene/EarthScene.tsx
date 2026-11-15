import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber'
import { Suspense, useCallback, useEffect, useMemo, useRef, type RefObject } from 'react'
import * as THREE from 'three'
import { mulberry32 } from '../../shared/api/mock/synth'
import {
  EARTH_ORBIT_RADIUS,
  EARTH_START_ANGLE,
  EARTH_YEAR_SECONDS,
  easeInOut,
  layout,
  planetOrbitPosition,
  SOLAR_EXTRA_PLANETS,
  sunlightDirection,
  SUN_POS_EARTH_VIEW,
  SUN_RADIUS,
  TRANSITION_SECONDS,
  type Layout,
  type SolarExtraPlanet,
} from './solarView'
import { isOccluded } from './spherexOrbit'
import { SpherexSatellite, type SceneLive } from './SpherexSatellite'

/**
 * Earth as a textured sphere rotating about its own fixed vertical (Y) axis, the Sun that lights it,
 * and SPHEREx in its sun-synchronous polar orbit along the day–night line
 * (docs/ui-design/WHERE_SPHEREX_ORBIT_PLAN.md). Clicking the Sun switches to a solar view: the Sun
 * moves to the centre, Earth circles it, and SPHEREx keeps circling Earth with its orbit turning to
 * face the Sun. Sizes, distances and speeds are not to scale. No CSS rotation anywhere.
 */

const SECONDS_PER_TURN = 48
const EARTH_RADIUS = 1

export type BodyName =
  | 'sun'
  | 'earth'
  | 'spherex'
  | 'mercury'
  | 'venus'
  | 'mars'
  | 'jupiter'
  | 'saturn'
  | 'uranus'
  | 'neptune'
  | 'pluto'
export type SceneView = 'earth' | 'solar'

const EXTRA_PLANET_RADIUS = new Map<string, number>(SOLAR_EXTRA_PLANETS.map((p) => [p.key, p.bodyRadius]))

interface Props {
  view: SceneView
  paused: boolean
  launching: boolean
  /** Skip the camera/scene transition (reduced motion). */
  instant?: boolean
  onEarthClick: () => void
  onSunClick?: () => void
  onReady?: () => void
  onHover?: (hover: boolean) => void
  labels?: Partial<Record<BodyName, RefObject<HTMLElement | null>>>
}

/** Earth-view sunlight: the direction that draws Earth's day–night line. */
const LIGHT_POS = new THREE.Vector3(SUN_POS_EARTH_VIEW.x, SUN_POS_EARTH_VIEW.y, SUN_POS_EARTH_VIEW.z + 8)
const LIGHT_DIR = LIGHT_POS.clone().normalize()

interface Live extends SceneLive {
  t: number
  eased: number
  earthAngle: number
  layout: Layout
}

function createLive(): Live {
  return {
    t: 0,
    eased: 0,
    earthAngle: EARTH_START_ANGLE,
    layout: layout(0, EARTH_START_ANGLE),
    light: LIGHT_DIR.clone(),
    referenceLight: LIGHT_DIR,
    craftBoost: 1,
  }
}

function Earth({ paused, launching, onEarthClick, onHover, onReady }: Pick<Props, 'paused' | 'launching' | 'onEarthClick' | 'onHover' | 'onReady'>) {
  const mesh = useRef<THREE.Mesh>(null)
  const texture = useLoader(THREE.TextureLoader, '/textures/earth-blue-marble-2048.jpg')
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4

  useEffect(() => {
    onReady?.()
  }, [onReady])

  useFrame((_, dt) => {
    if (!mesh.current) return
    if (!paused && !launching) mesh.current.rotation.y += (Math.PI * 2 * Math.min(dt, 0.1)) / SECONDS_PER_TURN
  })

  return (
    <group>
      <mesh
        ref={mesh}
        rotation={[0, -1.9, 0]}
        onClick={(e) => {
          e.stopPropagation()
          onEarthClick()
        }}
        onPointerOver={() => onHover?.(true)}
        onPointerOut={() => onHover?.(false)}
      >
        <sphereGeometry args={[EARTH_RADIUS, 96, 96]} />
        <meshStandardMaterial map={texture} roughness={0.9} metalness={0} />
      </mesh>
      <mesh scale={1.025}>
        <sphereGeometry args={[EARTH_RADIUS, 64, 64]} />
        <meshBasicMaterial color="#5fb6e8" transparent opacity={0.12} side={THREE.BackSide} />
      </mesh>
    </group>
  )
}

/** Procedural surface so a body's spin is visible: base colour plus seeded blotches and bands. */
function makeSurface(seed: number, base: string, spots: string[], bands = 0): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 128
  const g = c.getContext('2d')!
  const rnd = mulberry32(seed)
  g.fillStyle = base
  g.fillRect(0, 0, 256, 128)
  for (let i = 0; i < bands; i++) {
    g.fillStyle = spots[i % spots.length]
    g.globalAlpha = 0.25 + rnd() * 0.25
    const y = rnd() * 128
    g.fillRect(0, y, 256, 4 + rnd() * 12)
  }
  for (let i = 0; i < 70; i++) {
    g.globalAlpha = 0.18 + rnd() * 0.35
    g.fillStyle = spots[Math.floor(rnd() * spots.length)]
    g.beginPath()
    g.ellipse(rnd() * 256, rnd() * 128, 3 + rnd() * 18, 2 + rnd() * 9, rnd() * Math.PI, 0, Math.PI * 2)
    g.fill()
  }
  g.globalAlpha = 1
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = THREE.RepeatWrapping
  return t
}

function Sun({ paused, onSunClick, onHover }: { paused: boolean; onSunClick?: () => void; onHover?: (hover: boolean) => void }) {
  const mesh = useRef<THREE.Mesh>(null)
  const halo = useRef<THREE.Sprite>(null)
  const surface = useMemo(() => makeSurface(11, '#ffcf5c', ['#ff9f2e', '#fff1a8', '#ffb43c'], 6), [])
  const glow = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = c.height = 256
    const g = c.getContext('2d')!
    const grad = g.createRadialGradient(128, 128, 20, 128, 128, 128)
    grad.addColorStop(0, 'rgba(255,230,150,0.9)')
    grad.addColorStop(0.35, 'rgba(255,190,90,0.35)')
    grad.addColorStop(1, 'rgba(255,160,60,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, 256, 256)
    return new THREE.CanvasTexture(c)
  }, [])
  useEffect(
    () => () => {
      surface.dispose()
      glow.dispose()
    },
    [surface, glow],
  )
  useFrame((state, dt) => {
    if (paused) return
    if (mesh.current) mesh.current.rotation.y += (Math.PI * 2 * Math.min(dt, 0.1)) / 60
    if (halo.current) {
      const s = 2.9 + Math.sin(state.clock.elapsedTime * 1.3) * 0.12
      halo.current.scale.set(s, s, 1)
    }
  })
  return (
    <group>
      <mesh
        ref={mesh}
        onClick={(e) => {
          e.stopPropagation()
          onSunClick?.()
        }}
        onPointerOver={() => onHover?.(true)}
        onPointerOut={() => onHover?.(false)}
      >
        <sphereGeometry args={[SUN_RADIUS, 48, 48]} />
        <meshBasicMaterial map={surface} />
      </mesh>
      <sprite ref={halo} scale={[2.9, 2.9, 1]}>
        <spriteMaterial map={glow} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </sprite>
    </group>
  )
}

/** Faint dashed ring of Earth's yearly path, shown in the solar view. */
function useEarthOrbitLine() {
  const line = useMemo(() => {
    const pts: THREE.Vector3[] = []
    for (let k = 0; k <= 192; k++) {
      const a = (k / 192) * Math.PI * 2
      pts.push(new THREE.Vector3(Math.cos(a) * EARTH_ORBIT_RADIUS, 0, Math.sin(a) * EARTH_ORBIT_RADIUS))
    }
    const material = new THREE.LineDashedMaterial({ color: '#ffd184', dashSize: 0.06, gapSize: 0.05, transparent: true, opacity: 0, depthWrite: false })
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), material)
    l.computeLineDistances()
    l.visible = false
    return l
  }, [])
  useEffect(
    () => () => {
      line.geometry.dispose()
      ;(line.material as THREE.Material).dispose()
    },
    [line],
  )
  return line
}

function SolarLight({ live }: { live: Live }) {
  const lightRef = useRef<THREE.PointLight>(null)
  useFrame(() => {
    if (!lightRef.current) return
    lightRef.current.position.copy(live.layout.sunPos)
    lightRef.current.intensity = 14 * live.layout.solar
  })
  return <pointLight ref={lightRef} position={SUN_POS_EARTH_VIEW} intensity={0} decay={1} distance={35} color="#fff2d6" />
}

function SolarPlanet({
  planet,
  seed,
  live,
  paused,
  registry,
}: {
  planet: SolarExtraPlanet
  seed: number
  live: Live
  paused: boolean
  registry: Map<BodyName, THREE.Object3D>
}) {
  const orbitGroupRef = useRef<THREE.Group>(null)
  const orbitLineRef = useRef<THREE.Line>(null)
  const bodyGroupRef = useRef<THREE.Group>(null)
  const spinMeshRef = useRef<THREE.Mesh>(null)
  const bodyMatRef = useRef<THREE.MeshStandardMaterial>(null)
  const ringMatRef = useRef<THREE.MeshStandardMaterial>(null)
  const angleRef = useRef(planet.startAngle)
  const tmpPos = useMemo(() => new THREE.Vector3(), [])
  const surface = useMemo(
    () => makeSurface(seed, planet.baseColor, planet.spotColors, planet.bands),
    [seed, planet.baseColor, planet.spotColors, planet.bands],
  )
  const orbitLine = useMemo(() => {
    const pts: THREE.Vector3[] = []
    for (let k = 0; k <= 192; k++) {
      const a = (k / 192) * Math.PI * 2
      pts.push(planetOrbitPosition(planet.orbitRadius, a, planet.inclinationRad))
    }
    const material = new THREE.LineDashedMaterial({
      color: planet.baseColor,
      dashSize: 0.07,
      gapSize: 0.06,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    })
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), material)
    line.computeLineDistances()
    return line
  }, [planet.orbitRadius, planet.inclinationRad, planet.baseColor])

  useEffect(
    () => () => {
      surface.dispose()
      orbitLine.geometry.dispose()
      ;(orbitLine.material as THREE.Material).dispose()
    },
    [surface, orbitLine],
  )

  const setBodyGroup = useCallback(
    (g: THREE.Group | null) => {
      bodyGroupRef.current = g
      if (g) registry.set(planet.key, g)
      else registry.delete(planet.key)
    },
    [planet.key, registry],
  )

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1)
    const solar = live.layout.solar
    const visible = solar > 0.01
    if (!paused && live.t > 0) {
      angleRef.current -= ((Math.PI * 2 * dt) / (EARTH_YEAR_SECONDS * planet.periodRatio)) * live.t
    }
    if (orbitGroupRef.current) {
      orbitGroupRef.current.position.copy(live.layout.sunPos)
      orbitGroupRef.current.visible = visible
    }
    if (orbitLineRef.current) {
      ;(orbitLineRef.current.material as THREE.LineDashedMaterial).opacity = 0.28 * solar
    }
    if (bodyGroupRef.current) {
      planetOrbitPosition(planet.orbitRadius, angleRef.current, planet.inclinationRad, tmpPos)
      bodyGroupRef.current.position.copy(live.layout.sunPos).add(tmpPos)
      bodyGroupRef.current.scale.setScalar(0.5 + 0.5 * solar)
      bodyGroupRef.current.visible = visible
    }
    if (spinMeshRef.current && !paused) {
      spinMeshRef.current.rotation.y += dt * 0.4
    }
    if (bodyMatRef.current) bodyMatRef.current.opacity = solar
    if (ringMatRef.current) ringMatRef.current.opacity = 0.72 * solar
  })

  return (
    <>
      <group ref={orbitGroupRef} visible={false}>
        <primitive ref={orbitLineRef} object={orbitLine} />
      </group>
      <group ref={setBodyGroup} visible={false}>
        <mesh ref={spinMeshRef}>
          <sphereGeometry args={[planet.bodyRadius, 36, 36]} />
          <meshStandardMaterial ref={bodyMatRef} map={surface} roughness={0.85} metalness={0} transparent opacity={0} />
        </mesh>
        {planet.hasRing && (
          <mesh rotation={[Math.PI / 2 - 0.36, 0.18, 0]}>
            <ringGeometry args={[planet.bodyRadius * 1.38, planet.bodyRadius * 2.25, 64]} />
            <meshStandardMaterial
              ref={ringMatRef}
              color="#d8c08a"
              roughness={0.8}
              metalness={0}
              side={THREE.DoubleSide}
              transparent
              opacity={0}
            />
          </mesh>
        )}
      </group>
    </>
  )
}

/**
 * Drives everything that depends on the view: transition progress, Earth's position on its orbit,
 * the Sun's position, sunlight direction, camera. Mounted first so it runs before the other frames.
 */
function Director({
  view,
  paused,
  launching,
  instant,
  live,
  sunGroup,
  earthGroup,
  dirLight,
  pointLight,
  orbitLine,
}: {
  view: SceneView
  paused: boolean
  launching: boolean
  instant: boolean
  live: Live
  sunGroup: RefObject<THREE.Group | null>
  earthGroup: RefObject<THREE.Group | null>
  dirLight: RefObject<THREE.DirectionalLight | null>
  pointLight: RefObject<THREE.PointLight | null>
  orbitLine: THREE.Line
}) {
  const { camera } = useThree()
  const launchStart = useRef<number | null>(null)
  const tmp = useMemo(() => new THREE.Vector3(), [])

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1)
    const target = view === 'solar' ? 1 : 0
    if (instant) live.t = target
    else if (live.t !== target) {
      const step = dt / TRANSITION_SECONDS
      live.t = target > live.t ? Math.min(target, live.t + step) : Math.max(target, live.t - step)
    }
    live.eased = easeInOut(live.t)
    if (!paused && !launching && live.t > 0) live.earthAngle -= ((Math.PI * 2 * dt) / EARTH_YEAR_SECONDS) * live.t

    const l = layout(live.eased, live.earthAngle, live.layout)
    sunlightDirection(live.eased, l, LIGHT_DIR, live.light)
    live.craftBoost = l.craftBoost

    sunGroup.current?.position.copy(l.sunPos)
    sunGroup.current?.scale.setScalar(l.sunScale)
    earthGroup.current?.position.copy(l.earthPos)
    earthGroup.current?.scale.setScalar(l.earthScale)
    if (dirLight.current) {
      dirLight.current.position.copy(l.earthPos).addScaledVector(live.light, 10)
      dirLight.current.target.position.copy(l.earthPos)
      dirLight.current.target.updateMatrixWorld()
    }
    pointLight.current?.position.copy(l.sunPos)
    const mat = orbitLine.material as THREE.LineDashedMaterial
    mat.opacity = 0.45 * l.solar
    orbitLine.visible = l.solar > 0.01

    // Camera: blend between the two views; on "Explore", rush towards Earth wherever it is.
    camera.position.copy(l.camera)
    if (launching) {
      if (launchStart.current === null) launchStart.current = state.clock.elapsedTime
      const e = Math.min(1, (state.clock.elapsedTime - launchStart.current) / 0.52) ** 3
      tmp.subVectors(l.camera, l.earthPos).normalize().multiplyScalar(1.3 * l.earthScale).add(l.earthPos)
      camera.position.lerpVectors(l.camera, tmp, e)
      camera.lookAt(l.earthPos)
    } else {
      launchStart.current = null
      camera.lookAt(0, 0, 0)
    }
  })
  return null
}

/** Keeps the DOM name labels next to the projected bodies at any canvas size. */
function LabelTracker({
  labels,
  registry,
  live,
}: {
  labels?: Props['labels']
  registry: Map<BodyName, THREE.Object3D>
  live: Live
}) {
  const { camera, size } = useThree()
  const v = useMemo(() => new THREE.Vector3(), [])
  const world = useMemo(() => new THREE.Vector3(), [])
  const edge = useMemo(() => new THREE.Vector3(), [])
  const up = useMemo(() => new THREE.Vector3(), [])
  const sunR = () => SUN_RADIUS * live.layout.sunScale
  const earthR = () => EARTH_RADIUS * live.layout.earthScale

  useFrame(() => {
    if (!labels) return
    up.set(0, 1, 0).applyQuaternion(camera.quaternion)
    for (const [name, ref] of Object.entries(labels) as [BodyName, RefObject<HTMLElement | null>][]) {
      const el = ref.current
      const obj = registry.get(name)
      if (!el || !obj) continue
      obj.getWorldPosition(world)
      // Hidden while behind Earth or the Sun (e.g. SPHEREx on the far side of its orbit).
      let hidden =
        (name !== 'earth' && isOccluded(camera.position.clone().sub(live.layout.earthPos), world.clone().sub(live.layout.earthPos), earthR() * 1.02)) ||
        (name !== 'sun' && isOccluded(camera.position.clone().sub(live.layout.sunPos), world.clone().sub(live.layout.sunPos), sunR()))
      if (name !== 'sun' && name !== 'spherex' && live.layout.solar < 0.6) hidden = true
      v.copy(world).project(camera)
      let x = ((v.x + 1) / 2) * size.width
      let y = ((1 - v.y) / 2) * size.height
      if (name === 'spherex') {
        x += 12
        y -= 24
      } else {
        // Centred above the body, clear of its projected radius.
        const r = name === 'sun' ? sunR() : name === 'earth' ? earthR() : (EXTRA_PLANET_RADIUS.get(name) ?? 0.12)
        edge.copy(world).addScaledVector(up, r).project(camera)
        const pr = Math.abs(((1 - edge.y) / 2) * size.height - y)
        y -= pr + (name === 'sun' ? 30 : name === 'earth' ? 22 : 16)
      }
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`
      el.style.opacity = v.z < 1 && !hidden ? '1' : '0'
    }
  })
  return null
}

const ARIA: Record<SceneView, string> = {
  earth:
    'Earth turning in sunlight, with the SPHEREx telescope circling it over both poles along the line between day and night. Not to scale.',
  solar:
    'The Sun at the centre with Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus, Neptune, and Pluto orbiting it; SPHEREx keeps circling Earth along the day–night line. Not to scale.',
}

export default function EarthScene(props: Props) {
  const registry = useMemo(() => new Map<BodyName, THREE.Object3D>(), [])
  const live = useMemo(() => createLive(), [])
  const sunGroup = useRef<THREE.Group>(null)
  const earthGroup = useRef<THREE.Group>(null)
  const dirLight = useRef<THREE.DirectionalLight>(null)
  const pointLight = useRef<THREE.PointLight>(null)
  const orbitLine = useEarthOrbitLine()
  const still = props.paused || props.launching

  // Callback refs: Canvas children mount in their own renderer, after this component's effects run.
  const setSunGroup = useCallback(
    (g: THREE.Group | null) => {
      sunGroup.current = g
      if (g) registry.set('sun', g)
      else registry.delete('sun')
    },
    [registry],
  )
  const setEarthGroup = useCallback(
    (g: THREE.Group | null) => {
      earthGroup.current = g
      if (g) registry.set('earth', g)
      else registry.delete('earth')
    },
    [registry],
  )

  return (
    <Canvas
      className="earth-canvas"
      dpr={[1, 2]}
      camera={{ position: [0, 0, 4.6], fov: 32, near: 0.1, far: 100 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'default' }}
      frameloop="always"
      role="img"
      aria-label={ARIA[props.view]}
    >
      <Director
        view={props.view}
        paused={props.paused}
        launching={props.launching}
        instant={!!props.instant}
        live={live}
        sunGroup={sunGroup}
        earthGroup={earthGroup}
        dirLight={dirLight}
        pointLight={pointLight}
        orbitLine={orbitLine}
      />
      <ambientLight intensity={0.5} />
      {/* Sunlight comes from the Sun's direction; the Director keeps it aimed at Earth. */}
      <directionalLight ref={dirLight} position={LIGHT_POS} intensity={2.8} color="#fff6e8" />
      <pointLight ref={pointLight} position={SUN_POS_EARTH_VIEW} intensity={6} distance={30} color="#ffd9a0" />
      <SolarLight live={live} />
      <primitive object={orbitLine} />
      <group ref={setSunGroup} position={SUN_POS_EARTH_VIEW}>
        <Sun paused={still} onSunClick={props.onSunClick} onHover={props.onHover} />
      </group>
      <group ref={setEarthGroup}>
        <Suspense fallback={null}>
          <Earth paused={props.paused} launching={props.launching} onEarthClick={props.onEarthClick} onHover={props.onHover} onReady={props.onReady} />
        </Suspense>
        <SpherexSatellite live={live} paused={still} registry={registry as Map<string, THREE.Object3D>} />
      </group>
      {SOLAR_EXTRA_PLANETS.map((planet, index) => (
        <SolarPlanet key={planet.key} planet={planet} seed={101 + index * 17} live={live} paused={still} registry={registry} />
      ))}
      <LabelTracker labels={props.labels} registry={registry} live={live} />
    </Canvas>
  )
}
