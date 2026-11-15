import { useReducedMotion } from 'motion/react'
import { ArrowRight, Globe2, Pause, Play, Sun } from 'lucide-react'
import { lazy, Suspense, useCallback, useRef, useState, type RefObject } from 'react'
import { PATHS } from '../app/config'
import { useRouteTransition } from '../features/route-transition/TransitionHost'
import { webglAvailable } from '../features/earth-scene/webgl'
import { StarfieldCanvas } from '../features/artwork/StarfieldCanvas'
import type { BodyName, SceneView } from '../features/earth-scene/EarthScene'
import { NavDrawer, SiteFooter, SiteHeader } from '../shared/layout/Shell'
import './where/where.css'

const EarthScene = lazy(() => import('../features/earth-scene/EarthScene'))

export default function WhereAreYouPage() {
  const reduce = useReducedMotion()
  const [userPaused, setUserPaused] = useState(false)
  const [hover, setHover] = useState(false)
  const [earthReady, setEarthReady] = useState(false)
  const [view, setView] = useState<SceneView>('earth')
  const onReady = useCallback(() => setEarthReady(true), [])
  const sunRef = useRef<HTMLSpanElement>(null)
  const earthRef = useRef<HTMLSpanElement>(null)
  const spherexRef = useRef<HTMLSpanElement>(null)
  const mercuryRef = useRef<HTMLSpanElement>(null)
  const venusRef = useRef<HTMLSpanElement>(null)
  const marsRef = useRef<HTMLSpanElement>(null)
  const jupiterRef = useRef<HTMLSpanElement>(null)
  const saturnRef = useRef<HTMLSpanElement>(null)
  const uranusRef = useRef<HTMLSpanElement>(null)
  const neptuneRef = useRef<HTMLSpanElement>(null)
  const plutoRef = useRef<HTMLSpanElement>(null)
  const labels: Partial<Record<BodyName, RefObject<HTMLSpanElement | null>>> = {
    sun: sunRef,
    earth: earthRef,
    spherex: spherexRef,
    mercury: mercuryRef,
    venus: venusRef,
    mars: marsRef,
    jupiter: jupiterRef,
    saturn: saturnRef,
    uranus: uranusRef,
    neptune: neptuneRef,
    pluto: plutoRef,
  }
  const [gl] = useState(webglAvailable)
  const { phase, launch } = useRouteTransition()
  const launching = phase === 'launching'
  const paused = userPaused || !!reduce
  const solar = view === 'solar'

  const explore = useCallback(() => launch(PATHS.explorer), [launch])
  const toggleView = useCallback(() => setView((v) => (v === 'solar' ? 'earth' : 'solar')), [])
  // In the solar view, clicking Earth brings it back to the centre; in the Earth view it explores.
  const onEarthClick = useCallback(() => (solar ? setView('earth') : explore()), [solar, explore])

  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <SiteHeader />
      <NavDrawer />
      <main id="main" className={`where${launching && !reduce ? ' is-launching' : ''}${solar ? ' is-solar' : ''}`}>
        <StarfieldCanvas className="where__stars" density={1.1} shootingEverySec={2.2} drift={false} />
        <div className="where__scene">
          <h1 className="where__title">Where are you</h1>

          <div className={`where__earth${hover ? ' is-hover' : ''}`}>
            {gl ? (
              <>
                {!earthReady && <img className="where__static" src="/textures/earth-static.png" alt="" width={392} height={392} />}
                <Suspense fallback={null}>
                  <EarthScene
                    view={view}
                    instant={!!reduce}
                    paused={paused}
                    launching={launching && !reduce}
                    onEarthClick={onEarthClick}
                    onSunClick={toggleView}
                    onHover={setHover}
                    onReady={onReady}
                    labels={labels}
                  />
                </Suspense>
                <span ref={sunRef} className="where__label where__label--center" aria-hidden>
                  Sun
                </span>
                <span ref={earthRef} className="where__label where__label--center" aria-hidden>
                  Earth
                </span>
                <span ref={spherexRef} className="where__label where__label--craft" aria-hidden translate="no">
                  SPHEREx
                </span>
                <span ref={mercuryRef} className="where__label where__label--center where__label--planet" aria-hidden>
                  Mercury
                </span>
                <span ref={venusRef} className="where__label where__label--center where__label--planet" aria-hidden>
                  Venus
                </span>
                <span ref={marsRef} className="where__label where__label--center where__label--planet" aria-hidden>
                  Mars
                </span>
                <span ref={jupiterRef} className="where__label where__label--center where__label--planet" aria-hidden>
                  Jupiter
                </span>
                <span ref={saturnRef} className="where__label where__label--center where__label--planet" aria-hidden>
                  Saturn
                </span>
                <span ref={uranusRef} className="where__label where__label--center where__label--planet" aria-hidden>
                  Uranus
                </span>
                <span ref={neptuneRef} className="where__label where__label--center where__label--planet" aria-hidden>
                  Neptune
                </span>
                <span ref={plutoRef} className="where__label where__label--center where__label--planet" aria-hidden>
                  Pluto
                </span>
              </>
            ) : (
              <button type="button" className="where__static-btn" onClick={explore} aria-label="Explore the sky from Earth">
                <img className="where__static" src="/textures/earth-static.png" alt="Earth, still image" width={392} height={392} />
              </button>
            )}
          </div>

          <p className="where__hint" aria-hidden>
            <span>Click to explore</span>
            <svg viewBox="0 0 120 40" width="96" height="32" className="where__arrow">
              <path d="M2 30 C 40 34, 80 26, 112 12" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M104 8 L 114 11 L 108 20" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </p>

          <div className="where__actions">
            <button type="button" className="btn btn-primary btn-lg" onClick={explore}>
              Explore the sky <ArrowRight aria-hidden />
            </button>
            {gl && (
              <button type="button" className="btn btn-secondary" onClick={toggleView} aria-pressed={solar}>
                {solar ? <Globe2 aria-hidden /> : <Sun aria-hidden />}
                {solar ? 'Back to Earth' : 'View from the Sun'}
              </button>
            )}
            {gl && (
              <button type="button" className="btn btn-secondary" onClick={() => setUserPaused((p) => !p)} aria-pressed={paused} disabled={!!reduce}>
                {paused ? <Play aria-hidden /> : <Pause aria-hidden />}
                {reduce ? 'Motion off (reduced motion)' : paused ? 'Resume motion' : 'Pause motion'}
              </button>
            )}
          </div>

          {gl && (
            <p className="where__fact" aria-live="polite">
              <span className="where__fact-dot" aria-hidden />
              {solar ? (
                <span>
                  All nine Solar System worlds orbit the Sun at their own pace while Earth carries <strong translate="no">SPHEREx</strong>{' '}
                  around once a year. Its orbit turns a little every day so it always rides the line between day and night — that is what a
                  sun-synchronous orbit means.
                </span>
              ) : (
                <span>
                  <strong translate="no">SPHEREx</strong> circles Earth about 14.5 times a day, roughly 650 km up, passing over both poles
                  along the line between day and night. On every orbit it scans a full ring of sky. Click the Sun to see Earth’s yearly path.
                </span>
              )}
            </p>
          )}
          <p className="caption where__caption">
            Illustrative scene — sizes, distances and speeds not to scale; SPHEREx is shown much larger and slower than it is.
            {!gl && ' 3D view unavailable on this device; showing a still image.'}
          </p>
        </div>
      </main>
      <SiteFooter />
    </>
  )
}
