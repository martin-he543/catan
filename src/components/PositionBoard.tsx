import { useMemo, type KeyboardEvent } from 'react'
import {
  HEX_CENTERS,
  HEX_H,
  HEX_W,
  SEA_CENTERS,
  VERTICES,
  VIEW,
  portsFor,
  type Point,
} from '../lib/geometry'
import { EDGES, HEX_LABELS, VERTEX_LABELS, edgeLabel, type Edge } from '../lib/notation'
import { vertexOwners, type SeatPieces } from '../lib/position'
import { HexTile } from './HexTile'
import { PortMarker } from './PortMarker'
import { pieceImage, robberImage } from '../lib/assets'
import type { PlayerColor, PortType, Tile } from '../lib/types'

export type Tool = 'settlement' | 'city' | 'road' | 'robber' | 'erase'

interface Props {
  tiles: Tile[]
  ports: PortType[]
  portShifts?: number[]
  seats: SeatPieces[]
  colors: readonly PlayerColor[]
  names: readonly string[]
  robber: number
  tool: Tool
  active: number
  onVertex: (vertex: number) => void
  onEdge: (edge: Edge) => void
  onHex: (hex: number) => void
}

/**
 * Piece sizes in layout units (a hex is 1 wide). The artwork is a low-angle
 * photo, so a building's base sits a little below the corner it stands on.
 */
const PIECES = {
  settlement: { w: 0.28, h: 0.28, drop: 0.08 },
  city: { w: 0.37, h: 0.36, drop: 0.09 },
} as const
const ROAD_LENGTH = 0.4
const ROAD_WIDTH = ROAD_LENGTH * (72 / 270)

const GHOST = 'opacity-0 transition-opacity group-hover:opacity-60 group-focus-visible:opacity-60'

/** Points `t` of the way from `a` to `b`, so roads stop short of the corners. */
const along = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
})

const hexPoints = (c: Point) =>
  [
    [0, -HEX_H / 2],
    [HEX_W / 2, -HEX_H / 4],
    [HEX_W / 2, HEX_H / 4],
    [0, HEX_H / 2],
    [-HEX_W / 2, HEX_H / 4],
    [-HEX_W / 2, -HEX_H / 4],
  ]
    .map(([x, y]) => `${c.x + x},${c.y + y}`)
    .join(' ')

function Building({ at, city, color, ghost }: { at: Point; city: boolean; color: PlayerColor; ghost?: boolean }) {
  const { w, h, drop } = PIECES[city ? 'city' : 'settlement']
  return (
    <image
      href={pieceImage(city ? 'city' : 'settlement', color)}
      x={at.x - w / 2}
      y={at.y + drop - h}
      width={w}
      height={h}
      filter="url(#piece-shadow)"
      pointerEvents="none"
      className={ghost ? GHOST : undefined}
    />
  )
}

/** A road lies along its edge, midway between the two corners. */
function Road({ edge, color, ghost }: { edge: Edge; color: PlayerColor; ghost?: boolean }) {
  const a = VERTICES[edge[0]]
  const b = VERTICES[edge[1]]
  const mid = along(a, b, 0.5)
  // The artwork stands upright, so turn it from vertical onto the edge.
  const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI - 90
  return (
    <image
      href={pieceImage('road', color)}
      x={-ROAD_WIDTH / 2}
      y={-ROAD_LENGTH / 2}
      width={ROAD_WIDTH}
      height={ROAD_LENGTH}
      transform={`translate(${mid.x} ${mid.y}) rotate(${angle})`}
      filter="url(#piece-shadow)"
      pointerEvents="none"
      className={ghost ? GHOST : undefined}
    />
  )
}

/** The robber pawn, stood to one side of the tile so the number stays readable. */
const ROBBER_H = 0.52
const ROBBER_W = ROBBER_H * (113 / 256)

function Robber({ at }: { at: Point }) {
  return (
    <>
      <filter id="robber-shadow" x="-50%" y="-50%" width="200%" height="200%">
        <feDropShadow dx="0" dy="0.02" stdDeviation="0.02" floodOpacity="0.6" />
      </filter>
      <image
        href={robberImage}
        x={at.x + 0.27 - ROBBER_W / 2}
        y={at.y + 0.02 - ROBBER_H / 2}
        width={ROBBER_W}
        height={ROBBER_H}
        pointerEvents="none"
        filter="url(#robber-shadow)"
      />
    </>
  )
}

/** Corners top to bottom, so nearer buildings overlap the ones behind. */
const BACK_TO_FRONT = [...VERTICES].sort((a, b) => a.y - b.y)

/** SVG elements act as buttons for the mouse; this makes them work from the keyboard too. */
const pressable = (label: string, onPress: () => void) => ({
  role: 'button',
  tabIndex: 0,
  'aria-label': label,
  onClick: onPress,
  onKeyDown: (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onPress()
    }
  },
  className: 'group cursor-pointer outline-none',
})

/**
 * The board with every player's pieces on it, and invisible hit targets on
 * the corners, edges or tiles the current tool acts on.
 */
export function PositionBoard({
  tiles, ports, portShifts, seats, colors, names, robber, tool, active, onVertex, onEdge, onHex,
}: Props) {
  const owners = useMemo(() => vertexOwners(seats), [seats])
  const edgeOwner = useMemo(() => {
    const map = new Map<string, number>()
    seats.forEach((s, i) => s.roads.forEach(([a, b]) => map.set(`${a}:${b}`, i)))
    return map
  }, [seats])

  const color = colors[active]
  const cornersLive = tool === 'settlement' || tool === 'city' || tool === 'erase'
  const edgesLive = tool === 'road' || tool === 'erase'

  return (
    <div
      className="relative mx-auto w-full max-w-5xl select-none"
      style={{ aspectRatio: `${VIEW.width} / ${VIEW.height}`, containerType: 'inline-size' }}
    >
      {SEA_CENTERS.map((center, i) => (
        <HexTile key={`sea-${i}`} center={center} sea />
      ))}
      {HEX_CENTERS.map((center, i) => (
        <HexTile key={`tile-${i}`} center={center} tile={tiles[i]} />
      ))}
      {portsFor(portShifts).map((port, i) => (
        <PortMarker key={`port-${i}`} port={port} type={ports[i]} />
      ))}

      <svg
        className="absolute inset-0 h-full w-full overflow-visible"
        viewBox={`${VIEW.minX} ${VIEW.minY} ${VIEW.width} ${VIEW.height}`}
      >
        <defs>
          <filter id="piece-shadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0.012" dy="0.018" stdDeviation="0.012" floodOpacity="0.55" />
          </filter>
        </defs>
        {tool === 'robber' &&
          HEX_CENTERS.map((center, i) => (
            <g key={`hex-${i}`} {...pressable(`Move the robber to ${HEX_LABELS[i]}`, () => onHex(i))}>
              <polygon
                points={hexPoints(center)}
                fill="transparent"
                className="transition group-hover:fill-white/15 group-focus-visible:fill-white/15"
              />
            </g>
          ))}

        <Robber at={HEX_CENTERS[robber]} />

        {EDGES.map((edge) => {
          const owner = edgeOwner.get(`${edge[0]}:${edge[1]}`)
          return owner === undefined ? null : <Road key={`road-${edge}`} edge={edge} color={colors[owner]} />
        })}

        {BACK_TO_FRONT.map((v) => {
          const owner = owners[v.index]
          if (owner < 0) return null
          return (
            <Building
              key={`b-${v.index}`}
              at={v}
              city={seats[owner].cities.includes(v.index)}
              color={colors[owner]}
            />
          )
        })}

        {edgesLive &&
          EDGES.map((edge) => {
            const label = edgeLabel(edge[0], edge[1])
            const owner = edgeOwner.get(`${edge[0]}:${edge[1]}`)
            const a = along(VERTICES[edge[0]], VERTICES[edge[1]], 0.25)
            const b = along(VERTICES[edge[0]], VERTICES[edge[1]], 0.75)
            const action =
              tool === 'erase'
                ? `Clear road ${label}`
                : owner === active
                  ? `Pick up ${names[active]}'s road ${label}`
                  : `Road for ${names[active]} at ${label}`
            if (tool === 'erase' && owner === undefined) return null
            return (
              <g key={`edge-${label}`} {...pressable(action, () => onEdge(edge))}>
                {tool === 'road' && owner === undefined && <Road edge={edge} color={color} ghost />}
                {tool === 'erase' && (
                  <line
                    x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                    stroke="#fff" strokeWidth={0.05} strokeLinecap="round"
                    className="opacity-0 transition-opacity group-hover:opacity-70 group-focus-visible:opacity-70"
                  />
                )}
                <line
                  x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                  stroke="transparent" strokeWidth={0.16} strokeLinecap="round"
                />
              </g>
            )
          })}

        {cornersLive &&
          VERTICES.map((v) => {
            const owner = owners[v.index]
            const label = VERTEX_LABELS[v.index]
            if (tool === 'erase' && owner < 0) return null
            const what = tool === 'city' ? 'City' : 'Settlement'
            const action = tool === 'erase' ? `Clear ${label}` : `${what} for ${names[active]} at ${label}`
            return (
              <g key={`hit-${v.index}`} {...pressable(action, () => onVertex(v.index))}>
                {owner < 0 && tool !== 'erase' && (
                  <>
                    <circle cx={v.x} cy={v.y} r={0.045} fill="rgba(255,255,255,0.5)"
                      className="transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0" />
                    <Building at={v} city={tool === 'city'} color={color} ghost />
                  </>
                )}
                {owner >= 0 && (
                  <circle cx={v.x} cy={v.y} r={0.15} fill="none" stroke="#fff" strokeWidth={0.02}
                    className="opacity-0 transition-opacity group-hover:opacity-80 group-focus-visible:opacity-80" />
                )}
                <circle cx={v.x} cy={v.y} r={0.13} fill="transparent" />
              </g>
            )
          })}
      </svg>
    </div>
  )
}
