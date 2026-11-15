import { useQuery } from '@tanstack/react-query'
import { useReducedMotion } from 'motion/react'
import { AlertTriangle, Eye, Globe2, Grid3x3, HelpCircle, Layers, LocateFixed, Maximize2, Minimize2, Minus, Mountain, Orbit, Plus, Sparkles, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router'
import { config, PATHS } from '../app/config'
import { api } from '../shared/api'
import { describeError } from '../shared/api/errors'
import { TARGET_BY_KEY, isTargetKey, type TargetKey } from '../shared/config/targets'
import { CompactFooter, NavDrawer, SiteHeader } from '../shared/layout/Shell'
import { useOverlay } from '../shared/layout/overlay'
import { formatDecDms, formatRaHms } from '../features/target-search/coordinates'
import { usePlayer } from '../features/blink/player'
import { useFrameSession } from '../features/blink/useFrameSession'
import { readExperienceMode, writeExperienceMode, type ExperienceMode } from '../features/experience-mode/mode'
import { AladinMap, SURVEY, type GaiaStatusInfo, type SelectedGaiaSource, type SkyMapHandle, type SurveyInfo } from '../features/sky-map/AladinMap'
import { DR1_MAP_MJD, mapPosition } from '../shared/config/epoch'
import { computePlanetPositions, currentMjd, type PlanetKey, type PlanetSkyPosition } from '../shared/config/planets'
import { TargetPopup } from '../features/target-details/TargetPopup'
import type { ViewerToggles } from '../features/target-details/ObservationViewer'
import { TargetSearch } from '../features/target-search/TargetSearch'
import { parseSelection, resolveQuery, serializeSelection, type Selection } from '../features/target-search/explorer-url'
import { HelpDialog, Tutorial } from './eyes/Help'
import { Horizon } from '../features/sky-map/Horizon'
import './eyes/eyes.css'

const DEFAULT_TOGGLES: ViewerToggles = { mode: 'original', crosshair: true, flags: false, trail: false, pick: true, gaiaOverlays: true }
const COMBINED_TARGETS = new Set<TargetKey>(['wise0855', 'epsindib', 'barnard', 'rwaur', 'rdra'])
const DEFAULT_MAP_FOV_DEG = 90
const zoomFormat = new Intl.NumberFormat('en', { style: 'percent', maximumFractionDigits: 0 })

function isTyping(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
}

function isInteractiveTarget(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null
  return !!t && !!t.closest('button, a, summary, [role="tab"], input, textarea, select')
}

function formatLightTime(minutes: number): string {
  if (minutes < 0.05) return '0 min'
  if (minutes < 60) return `${minutes.toFixed(1)} min light-time`
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return `${h}h ${m}m light-time`
}

export default function TheEyesPage() {
  const location = useLocation()
  const [, setSearchParams] = useSearchParams()
  const sel = useMemo(() => parseSelection(location.search), [location.search])
  const embed = new URLSearchParams(location.search).get('embed') === '1'
  const rq = useMemo(() => resolveQuery(sel.q), [sel.q])
  const { overlay, open, close } = useOverlay()
  const reduceMotion = useReducedMotion()
  const mapRef = useRef<SkyMapHandle>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [mapStatus, setMapStatus] = useState<{ s: 'loading' | 'ready' | 'error'; msg?: string }>({ s: 'loading' })
  const [mapFovDeg, setMapFovDeg] = useState<number | null>(null)
  const [grid, setGrid] = useState(false)
  const [ground, setGround] = useState(false)
  const [skyMotion, setSkyMotion] = useState(false)
  const [gaia, setGaia] = useState(false)
  const [gaiaStatus, setGaiaStatus] = useState<GaiaStatusInfo>({ status: 'idle' })
  const [planets, setPlanets] = useState(true)
  const [planetEpochMode, setPlanetEpochMode] = useState<'survey' | 'now'>('survey')
  const [selectedPlanetKey, setSelectedPlanetKey] = useState<PlanetKey | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [help, setHelp] = useState(false)
  const [source, setSource] = useState<SelectedGaiaSource | null>(null)
  const [backgroundMode, setBackgroundMode] = useState<'spherex' | 'wise'>('spherex')
  const [survey, setSurvey] = useState<SurveyInfo>(SURVEY)
  const [experienceMode, setExperienceModeState] = useState<ExperienceMode>(() => readExperienceMode(location.search))
  const setExperienceMode = useCallback((next: ExperienceMode) => {
    setExperienceModeState(next)
    writeExperienceMode(next)
  }, [])
  const [toggles, setTogglesState] = useState<ViewerToggles>(() => ({
    ...DEFAULT_TOGGLES,
    crosshair: sel.pred !== undefined ? sel.pred : !(sel.compare || (rq.kind === 'target' && rq.key === 'wise0855')),
    gaiaOverlays: sel.gaia !== undefined ? sel.gaia : true,
  }))

  // One health check per visit for build/mode diagnostics; never blocks frame requests.
  const health = useQuery({ queryKey: ['health', config.apiBaseUrl], queryFn: ({ signal }) => api.health(signal), enabled: !config.useMock, staleTime: Infinity })

  // Name resolution only for free-text names; coordinates and presets bypass it.
  const resolved = useQuery({
    queryKey: ['resolve', config.useMock, rq.kind === 'name' ? rq.name.toLowerCase() : null],
    queryFn: ({ signal }) => api.resolve((rq as { name: string }).name, signal),
    enabled: rq.kind === 'name',
    staleTime: Infinity,
  })

  const target = useMemo(() => {
    if (rq.kind === 'target') return TARGET_BY_KEY.get(rq.key) ?? null
    if (rq.kind === 'name' && isTargetKey(resolved.data?.target_key)) return TARGET_BY_KEY.get(resolved.data!.target_key as TargetKey) ?? null
    return null
  }, [rq, resolved.data])

  const coords = useMemo(() => {
    if (target) return { ra: target.raDeg, dec: target.decDeg }
    if (rq.kind === 'coords') return rq.coords
    if (rq.kind === 'name' && resolved.data) return { ra: resolved.data.ra, dec: resolved.data.dec }
    return null
  }, [target, rq, resolved.data])

  // The map shows the active sky survey epoch (SPHEREx DR1 or AllWISE), so centre it where the target is in that epoch.
  // The frames request keeps J2000 coordinates: the backend moves the star to each observation date itself.
  const mapCoords = useMemo(
    () => (target ? mapPosition(target, survey.epochMjd ?? DR1_MAP_MJD) : coords),
    [target, coords, survey.epochMjd],
  )

  const title = target?.name ?? (rq.kind === 'name' && resolved.data ? resolved.data.name : coords ? 'Custom position' : '')
  const detector = sel.detector || target?.recommendedDetector || 6
  const spherexOnly = sel.seq === 'spherex'
  const canCombine = target != null && COMBINED_TARGETS.has(target.key) && detector === 6
  const timeline = canCombine && !spherexOnly ? 'combined' as const : undefined

  const framesParams = useMemo(
    () =>
      coords
        ? { ra: coords.ra, dec: coords.dec, detector, size: config.cutoutSizeDeg, maxFrames: timeline ? config.combinedMaxFrames : config.maxFrames, targetKey: target?.key, timeline }
        : null,
    [coords, detector, target?.key, timeline],
  )
  const session = useFrameSession(framesParams)
  const { state: player, dispatch, reset } = usePlayer()

  // New sequence → reset the single player clock.
  useEffect(() => {
    reset(session.data?.frames.length ?? 0)
  }, [session.data, reset])

  // Selection change → back to the original image, no stale tool state.
  useEffect(() => {
    setTogglesState((t) => ({ ...DEFAULT_TOGGLES, crosshair: t.crosshair, gaiaOverlays: t.gaiaOverlays }))
  }, [framesParams])

  // Open details for a selection that arrives from the URL (deep link / Back).
  const lastQ = useRef<string | null>(null)
  useEffect(() => {
    if (!coords || lastQ.current === sel.q) return
    lastQ.current = sel.q
    setSkyMotion(false)
    setTogglesState({
      ...DEFAULT_TOGGLES,
      crosshair: sel.pred !== undefined ? sel.pred : !(sel.compare || target?.key === 'wise0855'),
      gaiaOverlays: sel.gaia !== undefined ? sel.gaia : true,
    })
    open('target')
    if (mapCoords) mapRef.current?.focus(mapCoords.ra, mapCoords.dec, 0.6)
  }, [coords, mapCoords, sel.q, sel.compare, sel.pred, sel.gaia, target?.key, open])

  const commit = useCallback(
    (next: Partial<Selection>, replace = false) => {
      const merged: Selection = { ...sel, ...next }
      setSearchParams(serializeSelection(merged).replace(/^\?/, '') + (embed ? '&embed=1' : ''), { replace })
    },
    [sel, setSearchParams, embed],
  )

  const setToggles = useCallback(
    (patch: Partial<ViewerToggles>) => {
      setTogglesState((t) => ({ ...t, ...patch }))
      const urlPatch: Partial<Selection> = {}
      if (patch.gaiaOverlays !== undefined) urlPatch.gaia = patch.gaiaOverlays
      if (patch.crosshair !== undefined) urlPatch.pred = patch.crosshair
      if (Object.keys(urlPatch).length > 0 && (sel.compare || target?.key === 'wise0855' || sel.frameA || sel.frameB || sel.markA || sel.markB)) {
        commit(urlPatch, true)
      }
    },
    [commit, sel.compare, sel.frameA, sel.frameB, sel.markA, sel.markB, target?.key],
  )

  const compareSelection = useMemo(
    () => ({
      queryText: sel.q,
      frameAId: sel.frameA,
      frameBId: sel.frameB,
      markA: sel.markA ?? null,
      markB: sel.markB ?? null,
      onFramePairChange: (frameAId: string, frameBId: string) =>
        commit(
          {
            compare: true,
            frameA: frameAId,
            frameB: frameBId,
            markA: frameAId === sel.frameA ? sel.markA : undefined,
            markB: frameBId === sel.frameB ? sel.markB : undefined,
          },
          true,
        ),
      onMarkChange: (slot: 'A' | 'B', px: [number, number] | null) =>
        commit(slot === 'A' ? { compare: true, markA: px ?? undefined } : { compare: true, markB: px ?? undefined }, true),
      onClearAllMarks: () => commit({ markA: undefined, markB: undefined }, true),
      onResetFrames: () => commit({ frameA: undefined, frameB: undefined, markA: undefined, markB: undefined }, true),
    }),
    [commit, sel.q, sel.frameA, sel.frameB, sel.markA, sel.markB],
  )

  const selectTarget = useCallback(
    (key: TargetKey) => {
      const t = TARGET_BY_KEY.get(key)!
      if (sel.q === key) {
        open('target')
        const p = mapPosition(t)
        mapRef.current?.focus(p.ra, p.dec, 0.6)
        return
      }
      commit(
        {
          q: key,
          detector: 0,
          fovArcmin: null,
          compare: undefined,
          seq: undefined,
          band: undefined,
          frameA: undefined,
          frameB: undefined,
          markA: undefined,
          markB: undefined,
          gaia: undefined,
          pred: undefined,
        },
      )
    },
    [commit, open, sel.q],
  )

  const submitQuery = useCallback(
    (q: string) =>
      commit({
        q,
        detector: 0,
        fovArcmin: null,
        compare: undefined,
        seq: undefined,
        band: undefined,
        frameA: undefined,
        frameB: undefined,
        markA: undefined,
        markB: undefined,
        gaia: undefined,
        pred: undefined,
      }),
    [commit],
  )

  // FOV of the image viewer is display-only; record it in the URL lazily.
  const fovTimer = useRef<number | undefined>(undefined)
  const onFovChange = useCallback(
    (a: number, byUser: boolean) => {
      if (!byUser) return
      window.clearTimeout(fovTimer.current)
      fovTimer.current = window.setTimeout(() => {
        const rounded = Math.min(10, Math.max(1, +a.toFixed(1)))
        if (rounded !== sel.fovArcmin) commit({ fovArcmin: rounded }, true)
      }, 600)
    },
    [commit, sel.fovArcmin],
  )
  useEffect(() => () => window.clearTimeout(fovTimer.current), [])

  const [liveMjd, setLiveMjd] = useState(() => currentMjd())
  const activePlanetEpochMjd = planetEpochMode === 'now' ? liveMjd : (survey.epochMjd ?? DR1_MAP_MJD)
  const planetPositions = useMemo(() => computePlanetPositions(activePlanetEpochMjd), [activePlanetEpochMjd])
  const selectedPlanet = useMemo(
    () => (selectedPlanetKey ? (planetPositions.find((p) => p.key === selectedPlanetKey) ?? null) : null),
    [planetPositions, selectedPlanetKey],
  )

  useEffect(() => {
    if (mapStatus.s === 'ready') mapRef.current?.setGridVisible(grid)
  }, [grid, mapStatus.s])

  useEffect(() => {
    if (mapStatus.s === 'ready') mapRef.current?.setSkyMotion(skyMotion && !reduceMotion)
  }, [skyMotion, mapStatus.s, reduceMotion])

  useEffect(() => {
    if (mapStatus.s !== 'ready') return
    mapRef.current?.setGaiaVisible(gaia, mapCoords ?? undefined, target?.key ?? null)
    if (!gaia) setGaiaStatus({ status: 'idle' })
  }, [gaia, mapCoords, target?.key, mapStatus.s])

  useEffect(() => {
    if (mapStatus.s !== 'ready') return
    mapRef.current?.setPlanetsVisible(planets, activePlanetEpochMjd)
  }, [planets, activePlanetEpochMjd, mapStatus.s])

  const focusPlanet = useCallback((p: PlanetSkyPosition) => {
    setSource(null)
    setSelectedPlanetKey(p.key)
    setSkyMotion(false)
    if (p.isObserver) {
      setGround(true)
      return
    }
    if (!planets) setPlanets(true)
    mapRef.current?.focus(p.ra, p.dec, 28)
  }, [planets])

  useEffect(() => {
    const onFs = () => setFullscreen(document.fullscreenElement === stageRef.current)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void stageRef.current?.requestFullscreen?.()
  }

  const center = useCallback(() => {
    setSkyMotion(false)
    if (mapCoords) mapRef.current?.focus(mapCoords.ra, mapCoords.dec, 0.6)
  }, [mapCoords])

  const popupOpen = overlay === 'target' && !!coords

  // Page shortcuts; never while typing, and the image canvas handles its own keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey || help) return
      if (document.querySelector('.modal-backdrop')) return
      switch (e.key) {
        case ' ':
          if (!popupOpen || isInteractiveTarget(e.target)) return
          e.preventDefault()
          dispatch({ type: 'toggle' })
          break
        case 'ArrowRight':
          if (popupOpen) dispatch({ type: 'next' })
          break
        case 'ArrowLeft':
          if (popupOpen) dispatch({ type: 'prev' })
          break
        case 'g':
        case 'G':
          setGrid((g) => !g)
          break
        case 'm':
        case 'M':
          if (!reduceMotion) setSkyMotion((m) => !m)
          break
        case 'c':
        case 'C':
          center()
          break
        case 'd':
        case 'D':
          if (popupOpen && !timeline && session.total >= 2) setToggles({ mode: toggles.mode === 'original' ? 'difference' : 'original' })
          break
        case 'Escape':
          if (overlay === 'target') close('target')
          break
        case '?':
          setHelp(true)
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [popupOpen, help, dispatch, center, session.total, toggles.mode, setToggles, overlay, close, reduceMotion, timeline])

  const shareUrl = typeof window !== 'undefined' ? `${window.location.origin}${PATHS.explorer}${serializeSelection(sel)}` : ''
  const embedUrl = `${shareUrl}${shareUrl.includes('?') ? '&' : '?'}embed=1`
  const isMock = config.useMock || session.data?.mode === 'mock'
  const dataLabel = isMock ? 'Observation data: Illustrative demo (generated)' : timeline ? 'Observation data: unWISE and SPHEREx' : 'Observation data: NASA/IPAC IRSA, SPHEREx'
  // In the TAN projection, scale is proportional to the inverse tangent of half the field of view.
  const zoomLabel = mapFovDeg === null ? '—' : zoomFormat.format(
    Math.tan(DEFAULT_MAP_FOV_DEG * Math.PI / 360) / Math.tan(mapFovDeg * Math.PI / 360),
  )

  return (
    <div className={`eyes${embed ? ' eyes--embed' : ''}`}>
      <a href="#sky" className="skip-link">
        Skip to sky map
      </a>
      {embed ? (
        <header className="eyes-embed-head">
          <Link to={`${PATHS.explorer}${serializeSelection(sel)}`} target="_blank" className="wordmark">
            SPHEREx Explorer
          </Link>
        </header>
      ) : (
        <>
          <SiteHeader variant="eyes">
            <TargetSearch
              key={sel.q}
              value={rq.kind === 'target' ? '' : sel.q}
              selectedKey={target?.key ?? null}
              busy={resolved.isFetching}
              onSubmit={submitQuery}
              onPreset={selectTarget}
            />
          </SiteHeader>
          <NavDrawer />
        </>
      )}

      <main id="sky" className="eyes__stage" ref={stageRef}>
        <AladinMap
          ref={mapRef}
          initial={mapCoords ? { ra: mapCoords.ra, dec: mapCoords.dec, fovDeg: 0.6 } : { ra: 266.4, dec: -12, fovDeg: DEFAULT_MAP_FOV_DEG }}
          selectedKey={target?.key ?? null}
          onTargetSelected={selectTarget}
          onFovChanged={setMapFovDeg}
          onStatus={(s, msg) => setMapStatus({ s, msg })}
          onGaiaStatus={setGaiaStatus}
          onSourceSelected={(s) => {
            close('navigation')
            setSelectedPlanetKey(null)
            setSource(s)
          }}
          onPlanetSelected={(p) => {
            close('navigation')
            setSource(null)
            setSelectedPlanetKey(p.key)
          }}
          detector={detector}
          backgroundMode={backgroundMode}
          onSurvey={setSurvey}
        />

        {mapStatus.s !== 'ready' && (
          <div className={`map-status${mapStatus.s === 'error' ? ' is-error' : ''}`} role={mapStatus.s === 'error' ? 'alert' : 'status'}>
            {mapStatus.s === 'loading' ? 'Loading the sky map…' : `The sky map could not start. ${mapStatus.msg ?? ''} The SPHEREx observations still work from the search.`}
          </div>
        )}

        {mapStatus.s === 'ready' && survey.key === 'dss2' && (
          <div className="map-epoch-warn notice notice--warn" role="status">
            <AlertTriangle aria-hidden />
            <span>
              <strong>DSS2 fallback (1950s–1990s optical plates):</strong> target markers (DR1 MJD {DR1_MAP_MJD}) and Gaia DR3 stars (J2016.0) are not aligned to the DSS2 plate epoch.
            </span>
          </div>
        )}

        {ground && <Horizon />}
        {skyMotion && (
          <p className="sky-motion-note" role="status">
            Sky motion on: the view turns the way the sky does as Earth rotates, sped up about 700 times. This is a visualisation,
            not SPHEREx data.
          </p>
        )}

        {!popupOpen && coords && title && (
          <button type="button" className="reopen" onClick={() => open('target')}>
            <Eye aria-hidden /> Show {title}
          </button>
        )}

        {rq.kind === 'name' && resolved.isError && (
          <div className="map-toast notice notice--warn" role="alert">
            <span>
              <strong>{describeError(resolved.error).title}.</strong> {describeError(resolved.error).body}
            </span>
            <button type="button" className="icon-btn icon-btn--sm" aria-label="Dismiss" onClick={() => commit({ q: '' }, true)}>
              <X aria-hidden />
            </button>
          </div>
        )}

        {!popupOpen && !selectedPlanet && !embed && planets && mapStatus.s === 'ready' && (
          <nav className="planet-strip" aria-label="Solar System planets">
            {planetPositions.map((p) => (
              <button
                key={p.key}
                type="button"
                className={`planet-chip${selectedPlanetKey === p.key ? ' is-selected' : ''}`}
                aria-pressed={selectedPlanetKey === p.key}
                title={p.isObserver ? 'Earth (observer beneath low-Earth orbit)' : `${p.name} · ${p.geoAu.toFixed(2)} AU from Earth`}
                onClick={() => focusPlanet(p)}
              >
                <span className="planet-chip__sym" style={{ color: p.color }} aria-hidden>
                  {p.symbol}
                </span>
                <span>{p.name}</span>
              </button>
            ))}
          </nav>
        )}

        {selectedPlanet && (
          <section className="source-card planet-card" aria-label="Solar System planet">
            <div className="source-card__head">
              <h2 className="source-card__title">
                <span style={{ color: selectedPlanet.color }} aria-hidden>
                  {selectedPlanet.symbol}{' '}
                </span>
                {selectedPlanet.name}
              </h2>
              <button type="button" className="icon-btn icon-btn--sm" aria-label="Close planet details" onClick={() => setSelectedPlanetKey(null)}>
                <X aria-hidden />
              </button>
            </div>
            <div className="planet-card__meta">
              <span className="pill">{selectedPlanet.category}</span>
              {!selectedPlanet.isObserver && (
                <div className="planet-card__epoch" role="group" aria-label="Planet position epoch">
                  <button
                    type="button"
                    className={`planet-epoch-btn${planetEpochMode === 'survey' ? ' is-on' : ''}`}
                    aria-pressed={planetEpochMode === 'survey'}
                    onClick={() => setPlanetEpochMode('survey')}
                  >
                    {survey.epochLabel ?? 'Survey'}
                  </button>
                  <button
                    type="button"
                    className={`planet-epoch-btn${planetEpochMode === 'now' ? ' is-on' : ''}`}
                    aria-pressed={planetEpochMode === 'now'}
                    onClick={() => {
                      setLiveMjd(currentMjd())
                      setPlanetEpochMode('now')
                    }}
                  >
                    Today
                  </button>
                </div>
              )}
            </div>

            {experienceMode === 'explore' ? (
              <>
                <dl className="facts">
                  <div>
                    <dt>Distance from Earth</dt>
                    <dd className="num">
                      {selectedPlanet.isObserver
                        ? '0 AU — SPHEREx flies ~650 km overhead'
                        : `${selectedPlanet.geoAu.toFixed(2)} AU (${formatLightTime(selectedPlanet.lightTimeMin)})`}
                    </dd>
                  </div>
                  <div>
                    <dt>Distance from the Sun</dt>
                    <dd className="num">{selectedPlanet.helioAu.toFixed(2)} AU</dd>
                  </div>
                </dl>
                <p className="caption planet-card__fact">{selectedPlanet.funFact}</p>
              </>
            ) : (
              <>
                <dl className="facts">
                  {selectedPlanet.isObserver ? (
                    <>
                      <div>
                        <dt>Orbital radius (r)</dt>
                        <dd className="num">{selectedPlanet.helioAu.toFixed(4)} AU</dd>
                      </div>
                      <div>
                        <dt>Observer orbit</dt>
                        <dd>~650 km Sun-synchronous LEO along the terminator</dd>
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <dt>
                          Apparent ICRS ({planetEpochMode === 'now' ? 'Live today' : (survey.epochLabel ?? `MJD ${DR1_MAP_MJD}`)})
                        </dt>
                        <dd className="num">
                          {formatRaHms(selectedPlanet.ra)} {formatDecDms(selectedPlanet.dec)}
                        </dd>
                      </div>
                      <div>
                        <dt>Heliocentric r / Geocentric Δ</dt>
                        <dd className="num">
                          {selectedPlanet.helioAu.toFixed(3)} AU / {selectedPlanet.geoAu.toFixed(3)} AU
                        </dd>
                      </div>
                      <div>
                        <dt>Solar elongation · Light time</dt>
                        <dd className="num">
                          {selectedPlanet.elongationDeg.toFixed(1)}° · {formatLightTime(selectedPlanet.lightTimeMin)}
                        </dd>
                      </div>
                    </>
                  )}
                </dl>
                <p className="caption planet-card__fact">{selectedPlanet.spherexNote}</p>
              </>
            )}

            <div className="planet-card__actions">
              {selectedPlanet.isObserver ? (
                <button type="button" className="btn btn-secondary" onClick={() => setGround((g) => !g)}>
                  <Mountain aria-hidden /> {ground ? 'Hide Earth horizon' : 'Show Earth horizon'}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    if (!planets) setPlanets(true)
                    mapRef.current?.focus(selectedPlanet.ra, selectedPlanet.dec, 28)
                  }}
                >
                  <LocateFixed aria-hidden /> Center on {selectedPlanet.name}
                </button>
              )}
              <div className="planet-card__jumper" aria-label="Jump to another planet">
                {planetPositions.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    className={`planet-jump-btn${p.key === selectedPlanet.key ? ' is-selected' : ''}`}
                    title={p.name}
                    aria-label={p.name}
                    onClick={() => focusPlanet(p)}
                  >
                    <span style={{ color: p.color }}>{p.symbol}</span>
                  </button>
                ))}
              </div>
            </div>
          </section>
        )}

        {source && (
          <section className="source-card" aria-label="Gaia DR3 star">
            <div className="source-card__head">
              <h2 className="source-card__title">Gaia DR3 star</h2>
              <button type="button" className="icon-btn icon-btn--sm" aria-label="Close star details" onClick={() => setSource(null)}>
                <X aria-hidden />
              </button>
            </div>
            <dl className="facts">
              {source.sourceId && (
                <div>
                  <dt>Source ID</dt>
                  <dd className="num">{source.sourceId}</dd>
                </div>
              )}
              <div>
                <dt>RA / Dec (ICRS, catalog epoch J2016.0)</dt>
                <dd className="num">
                  {formatRaHms(source.catalogRa)} {formatDecDms(source.catalogDec)}
                </dd>
              </div>
              {source.propagated && (
                <div>
                  <dt>Map position ({source.epochLabel})</dt>
                  <dd className="num">
                    {formatRaHms(source.ra)} {formatDecDms(source.dec)}
                  </dd>
                </div>
              )}
              <div>
                <dt>Brightness</dt>
                <dd className="num">{source.gmag != null ? `G = ${source.gmag.toFixed(2)} mag` : 'Not available'}</dd>
              </div>
            </dl>
            <p className="caption">
              Source: ESA Gaia DR3 via {source.catalogSource === 'sky_archive' ? 'Supabase sky_archive' : 'VizieR'}
              {source.propagated ? ' (propagated with angular_proper_motion_only)' : ' (pmRA/pmDE absent or DSS2 fallback: kept at J2016.0)'}. Not a SPHEREx measurement.
            </p>
            <button type="button" className="btn btn-secondary" onClick={() => { submitQuery(`${source.catalogRa.toFixed(6)} ${source.catalogDec >= 0 ? '+' : ''}${source.catalogDec.toFixed(6)}`); setSource(null) }}>
              View SPHEREx observations here
            </button>
          </section>
        )}

        {!embed && <Tutorial hidden={overlay !== 'none'} />}

        {popupOpen && coords && (
            <TargetPopup
              timelineControl={
                canCombine
                  ? {
                      combined: !spherexOnly,
                      setCombined: (value) =>
                        commit(
                          {
                            seq: value ? 'combined' : 'spherex',
                            frameA: undefined,
                            frameB: undefined,
                            markA: undefined,
                            markB: undefined,
                          },
                          true,
                        ),
                    }
                  : undefined
              }
              initialCompare={Boolean(sel.compare || target?.key === 'wise0855')}
              compareSelection={compareSelection}
              key={`${coords.ra}:${coords.dec}`}
              target={target}
              title={title}
              coords={coords}
              detector={detector}
              onDetector={(d) => commit({ detector: d, frameA: undefined, frameB: undefined, markA: undefined, markB: undefined })}
              session={session}
              player={player}
              dispatch={dispatch}
              toggles={toggles}
              setToggles={setToggles}
              fovArcmin={sel.fovArcmin}
              onFovChange={onFovChange}
              onClose={() => close('target')}
              onCenter={center}
              gaia={gaia}
              setGaia={setGaia}
              gaiaStatus={gaiaStatus}
              survey={survey}
              shareUrl={shareUrl}
              embedUrl={embedUrl}
              experienceMode={experienceMode}
              onExperienceModeChange={setExperienceMode}
            />
          )}
        <div className="dock" role="toolbar" aria-label="Sky tools">
          <div className="dock__switch" role="group" aria-label="Experience mode">
            <button
              type="button"
              className="dock__btn"
              aria-pressed={experienceMode === 'explore'}
              title="Explore mode for beginners & students"
              onClick={() => setExperienceMode('explore')}
            >
              <span>Explore</span>
            </button>
            <button
              type="button"
              className="dock__btn"
              aria-pressed={experienceMode === 'science'}
              title="Science mode for citizen scientists & researchers"
              onClick={() => setExperienceMode('science')}
            >
              <span>Science</span>
            </button>
          </div>
          <span className="dock__sep" aria-hidden />
          <button type="button" className="dock__btn" aria-pressed={grid} title="RA/Dec grid (G)" onClick={() => setGrid((g) => !g)}>
            <Grid3x3 aria-hidden /> <span>RA/Dec</span>
          </button>
          <button
            type="button"
            className="dock__btn"
            aria-pressed={skyMotion}
            title={reduceMotion ? 'Turned off because reduced motion is on' : 'Turn the whole sky as Earth rotates (M)'}
            disabled={!!reduceMotion || mapStatus.s !== 'ready'}
            onClick={() => setSkyMotion((m) => !m)}
          >
            <Orbit aria-hidden /> <span>Sky motion</span>
          </button>
          <button type="button" className="dock__btn" aria-pressed={ground} title="Show the ground and horizon" onClick={() => setGround((g) => !g)}>
            <Mountain aria-hidden /> <span>Ground</span>
          </button>
          <button type="button" className="dock__btn" aria-pressed={gaia} title="Gaia DR3 stars around the target" disabled={!coords} onClick={() => setGaia((g) => !g)}>
            <Sparkles aria-hidden /> <span>Gaia stars</span>
          </button>
          <button
            type="button"
            className="dock__btn"
            aria-pressed={planets}
            title={
              experienceMode === 'explore'
                ? 'Show or hide the 9 Solar System planets along the sky'
                : 'Overlay Solar System planets along the ecliptic at the active epoch'
            }
            disabled={mapStatus.s !== 'ready'}
            onClick={() => setPlanets((p) => !p)}
          >
            <Globe2 aria-hidden /> <span>Planets</span>
          </button>
          <span className="dock__sep" aria-hidden />
          <div className="dock__switch" role="group" aria-label="Sky background survey">
            <button
              type="button"
              className="dock__btn"
              aria-pressed={backgroundMode === 'spherex'}
              title="SPHEREx DR1 all-sky infrared cube (Nov 2025)"
              disabled={mapStatus.s !== 'ready'}
              onClick={() => setBackgroundMode('spherex')}
            >
              <Layers aria-hidden /> <span>SPHEREx DR1</span>
            </button>
            <button
              type="button"
              className="dock__btn"
              aria-pressed={backgroundMode === 'wise'}
              title="WISE / AllWISE infrared sky (2010)"
              disabled={mapStatus.s !== 'ready'}
              onClick={() => setBackgroundMode('wise')}
            >
              <span>WISE</span>
            </button>
          </div>
          <span className="dock__sep" aria-hidden />
          <button type="button" className="dock__btn" title="Center on the selected target (C)" disabled={!coords} onClick={center}>
            <LocateFixed aria-hidden /> <span>Center</span>
          </button>
          <button type="button" className="dock__icon" aria-label="Zoom out map" title="Zoom out map" onClick={() => mapRef.current?.zoomOut()}>
            <Minus aria-hidden />
          </button>
          <span className="dock__zoom" aria-label={`Map zoom ${mapFovDeg === null ? 'unavailable' : zoomLabel}`} title="Zoom relative to the default sky view">
            {zoomLabel}
          </span>
          <button type="button" className="dock__icon" aria-label="Zoom in map" title="Zoom in map" onClick={() => mapRef.current?.zoomIn()}>
            <Plus aria-hidden />
          </button>
          <span className="dock__sep" aria-hidden />
          <button type="button" className="dock__icon" aria-label="Help and shortcuts" title="Help (?)" onClick={() => setHelp(true)}>
            <HelpCircle aria-hidden />
          </button>
          <button type="button" className="dock__icon" aria-label={fullscreen ? 'Exit full screen' : 'Full screen'} title="Full screen" onClick={toggleFullscreen}>
            {fullscreen ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />}
          </button>
        </div>
      </main>

      <CompactFooter>
        <span className="sep">·</span>
        <span>
          Sky survey: {survey.label}
          {survey.cube ? `, detector D${detector}` : ''}
          {survey.epochLabel ? ` · ${survey.epochLabel}` : ''} ({survey.credit})
          {survey.fromArchive ? ' · sky_archive' : ''}
        </span>
        <span className="sep">·</span>
        <span className={isMock ? 'demo-tag' : undefined}>{dataLabel}</span>
        {!config.useMock && (
          <>
            <span className="sep">·</span>
            <span>
              Service: {health.data ? `${health.data.mode} mode${health.data.git_sha && health.data.git_sha !== 'unknown' ? ` · ${health.data.git_sha.slice(0, 7)}` : ''}` : health.isError ? 'unreachable' : 'checking…'}
            </span>
          </>
        )}
      </CompactFooter>

      {help && <HelpDialog onClose={() => setHelp(false)} />}
    </div>
  )
}
