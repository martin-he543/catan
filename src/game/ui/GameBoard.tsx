/**
 * The board for online games: any map (the standard island, 5-8 player
 * boards, Seafarers archipelagos), drawn from the same tile, port and piece
 * art as the board generator, with clickable targets for whatever the player
 * is doing — building, answering a prompt, moving the robber.
 */
import { useMemo, useState, type KeyboardEvent } from 'react'
import { portImage, tileImage } from '../../lib/assets'
import { pips } from '../../lib/analysis'
import { HEX_H, HEX_W, hexPolygon, sideVertices } from '../engine/hexgrid'
import { topo } from '../engine/state'
import type { GameView } from '../engine/view'
import type { GameState, HarborType, PlayerColor, RouteKind } from '../engine/types'
import { Building, KnightPiece, Merchant, MetropolisFlag, Pirate, Road, Robber, ShadowDefs, Ship, Wall } from './pieces'
import { HARBOR_LABEL } from './labels'

export type Ghost = 'settlement' | 'city' | 'road' | 'ship' | 'knight' | 'wall' | 'none'

export interface Targets {
  vertices?: number[]
  edges?: number[]
  hexes?: number[]
  /** What to preview on hover. */
  ghost?: Ghost
  /** Route kind to preview on edges, when it depends on the edge. */
  edgeGhost?: (edge: number) => RouteKind
  color?: PlayerColor
  label?: (kind: 'vertex' | 'edge' | 'hex', index: number) => string
}

interface Props {
  view: GameView
  targets?: Targets | null
  onVertex?: (v: number) => void
  onEdge?: (e: number) => void
  onHex?: (h: number) => void
  /** Pieces to outline, e.g. a knight picked to move. */
  selected?: { vertices?: number[]; hexes?: number[]; edges?: number[] }
}

const TOKEN_R = 0.2
const PORT_W = 0.52
const PORT_H = 0.62

const harborArt = (type: HarborType) => portImage(type === 'any' ? '31' : type)

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

const GHOST = 'opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100'

function NumberToken({ x, y, n, muted }: { x: number; y: number; n: number; muted?: boolean }) {
  const red = n === 6 || n === 8
  const dots = pips(n)
  return (
    <g pointerEvents="none" opacity={muted ? 0.55 : 1}>
      <circle cx={x} cy={y} r={TOKEN_R} fill="#e9d49d" stroke="#ad9d75" strokeWidth={0.025} filter="url(#piece-shadow)" />
      <text
        x={x}
        y={y + 0.045}
        textAnchor="middle"
        fontSize={0.17}
        fontWeight={700}
        fontFamily="Outfit, ui-sans-serif, system-ui"
        fill={red ? '#b91c1c' : '#1c1917'}
      >
        {n}
      </text>
      {Array.from({ length: dots }, (_, i) => (
        <circle key={i} cx={x + (i - (dots - 1) / 2) * 0.034} cy={y + 0.11} r={0.011} fill={red ? '#b91c1c' : '#1c1917'} />
      ))}
    </g>
  )
}

export function GameBoard({ view, targets, onVertex, onEdge, onHex, selected }: Props) {
  const t = useMemo(() => topo(view as unknown as GameState), [view])
  const [hoverHex, setHoverHex] = useState<number | null>(null)
  const colors = view.players.map((p) => p.color)
  const { minX, minY, width, height } = t.bounds

  const vertexTargets = new Set(targets?.vertices ?? [])
  const edgeTargets = new Set(targets?.edges ?? [])
  const hexTargets = new Set(targets?.hexes ?? [])
  const ghostColor = targets?.color ?? 'white'

  // Buildings back to front so nearer ones overlap.
  const order = useMemo(() => t.vertices.map((v, i) => ({ i, y: v.y })).sort((a, b) => a.y - b.y).map((o) => o.i), [t])

  return (
    <svg
      viewBox={`${minX} ${minY} ${width} ${height}`}
      className="h-auto w-full select-none"
      role="img"
      aria-label="Game board"
    >
      <ShadowDefs />

      {/* Tiles */}
      {view.map.hexes.map((h, i) => {
        const c = t.hexes[i]
        const art = h.veil === 'fog' ? 'fog' : h.terrain
        const unknown = h.veil === 'blind' || h.veil === 'terrain'
        return (
          <g key={`hex-${i}`}>
            {unknown ? (
              <polygon points={hexPolygon(c, 1.01)} fill="url(#unknown-land)" stroke="#44403c" strokeWidth={0.01} />
            ) : (
              <image
                href={tileImage(art)}
                x={c.x - (HEX_W * 1.01) / 2}
                y={c.y - (HEX_H * 1.01) / 2}
                width={HEX_W * 1.01}
                height={HEX_H * 1.01}
                preserveAspectRatio="none"
                clipPath="url(#hex-clip)"
                opacity={hoverHex !== null && hoverHex !== i && hexTargets.size ? 0.85 : 1}
              />
            )}
            {h.veil === 'blind' && (
              <text x={c.x} y={c.y + 0.1} textAnchor="middle" fontSize={0.3} fill="#e7e5e4" opacity={0.7} pointerEvents="none">?</text>
            )}
          </g>
        )
      })}

      {/* Harbours, on the water side of their edge */}
      {view.map.harbors.map((hb, i) => {
        const [a, b] = sideVertices(t, hb.hex, hb.side)
        const va = t.vertices[a]
        const vb = t.vertices[b]
        const c = t.hexes[hb.hex]
        const mid = { x: (va.x + vb.x) / 2, y: (va.y + vb.y) / 2 }
        const out = { x: mid.x - c.x, y: mid.y - c.y }
        const len = Math.hypot(out.x, out.y)
        const pos = { x: mid.x + (out.x / len) * 0.42, y: mid.y + (out.y / len) * 0.42 }
        const angle = (Math.atan2(out.y, out.x) * 180) / Math.PI + 90
        return (
          <g key={`harbor-${i}`} pointerEvents="none">
            <line x1={va.x} y1={va.y} x2={pos.x} y2={pos.y} stroke="#8b6b3d" strokeWidth={0.035} strokeLinecap="round" opacity={0.8} />
            <line x1={vb.x} y1={vb.y} x2={pos.x} y2={pos.y} stroke="#8b6b3d" strokeWidth={0.035} strokeLinecap="round" opacity={0.8} />
            <image
              href={harborArt(hb.type)}
              x={-PORT_W / 2}
              y={-PORT_H / 2}
              width={PORT_W}
              height={PORT_H}
              transform={`translate(${pos.x} ${pos.y}) rotate(${angle})`}
              filter="url(#piece-shadow)"
            >
              <title>{HARBOR_LABEL[hb.type]}</title>
            </image>
          </g>
        )
      })}

      {/* Numbers */}
      {view.map.hexes.map((h, i) => {
        const c = t.hexes[i]
        if (h.veil === 'fog' || h.veil === 'blind') return null
        if (h.fishing) {
          return (
            <g key={`fish-${i}`} pointerEvents="none">
              <NumberToken x={c.x} y={c.y} n={h.fishing} />
              <text x={c.x} y={c.y - 0.24} textAnchor="middle" fontSize={0.16}>🐟</text>
            </g>
          )
        }
        if (h.terrain === 'lake') {
          return (
            <text key={`lake-${i}`} x={c.x} y={c.y + 0.05} textAnchor="middle" fontSize={0.13} fontWeight={700} fill="#0c4a6e" pointerEvents="none">
              2·3·11·12
            </text>
          )
        }
        return h.number ? <NumberToken key={`n-${i}`} x={c.x} y={c.y} n={h.number} muted={i === view.robber} /> : null
      })}

      {/* Hex targets */}
      {[...hexTargets].map((i) => {
        const c = t.hexes[i]
        const chosen = selected?.hexes?.includes(i)
        return (
          <g
            key={`hex-target-${i}`}
            {...pressable(targets?.label?.('hex', i) ?? `Tile ${i}`, () => onHex?.(i))}
            onMouseEnter={() => setHoverHex(i)}
            onMouseLeave={() => setHoverHex(null)}
          >
            <polygon
              points={hexPolygon(c, 0.92)}
              fill={chosen ? 'rgba(250, 204, 21, 0.35)' : 'rgba(255,255,255,0.08)'}
              stroke={chosen ? '#facc15' : '#fff'}
              strokeWidth={0.03}
              strokeDasharray={chosen ? undefined : '0.08 0.06'}
              className="transition group-hover:fill-white/25 group-focus-visible:fill-white/25"
            />
          </g>
        )
      })}

      {/* Roads and ships */}
      {view.routes.map((r, e) => {
        if (!r) return null
        const edge = t.edges[e]
        const a = t.vertices[edge.a]
        const b = t.vertices[edge.b]
        const outline = selected?.edges?.includes(e)
        return (
          <g key={`route-${e}`}>
            {outline && <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#facc15" strokeWidth={0.12} strokeLinecap="round" opacity={0.7} />}
            {r.kind === 'ship' ? <Ship a={a} b={b} color={colors[r.owner]} /> : <Road a={a} b={b} color={colors[r.owner]} />}
          </g>
        )
      })}

      {/* Robber, pirate, merchant */}
      {view.robber >= 0 && <Robber at={t.hexes[view.robber]} />}
      {view.pirate >= 0 && <Pirate at={t.hexes[view.pirate]} />}
      {view.merchant && <Merchant at={t.hexes[view.merchant.hex]} color={colors[view.merchant.owner]} />}

      {/* Buildings and knights */}
      {order.map((v) => {
        const b = view.buildings[v]
        const k = view.knights[v]
        const at = t.vertices[v]
        return (
          <g key={`b-${v}`}>
            {b?.wall && <Wall at={at} />}
            {b && <Building at={at} city={b.kind === 'city'} color={colors[b.owner]} />}
            {b?.metropolis && <MetropolisFlag at={at} track={b.metropolis} />}
            {k && <KnightPiece at={at} color={colors[k.owner]} level={k.level} active={k.active} />}
            {selected?.vertices?.includes(v) && (
              <circle cx={at.x} cy={at.y} r={0.17} fill="none" stroke="#facc15" strokeWidth={0.03} pointerEvents="none" />
            )}
          </g>
        )
      })}

      {/* Edge targets */}
      {[...edgeTargets].map((e) => {
        const edge = t.edges[e]
        const a = t.vertices[edge.a]
        const b = t.vertices[edge.b]
        const kind = targets?.edgeGhost?.(e) ?? (targets?.ghost === 'ship' ? 'ship' : 'road')
        const p = (f: number) => ({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f })
        const [s, f] = [p(0.22), p(0.78)]
        return (
          <g key={`edge-target-${e}`} {...pressable(targets?.label?.('edge', e) ?? `Edge ${e}`, () => onEdge?.(e))}>
            <line x1={s.x} y1={s.y} x2={f.x} y2={f.y} stroke="#fff" strokeWidth={0.05} strokeLinecap="round" opacity={0.55}
              className="transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0" />
            {targets?.ghost !== 'none' && (
              kind === 'ship'
                ? <Ship a={a} b={b} color={ghostColor} ghost className={GHOST} />
                : <Road a={a} b={b} color={ghostColor} ghost className={GHOST} />
            )}
            <line x1={s.x} y1={s.y} x2={f.x} y2={f.y} stroke="transparent" strokeWidth={0.18} strokeLinecap="round" />
          </g>
        )
      })}

      {/* Vertex targets */}
      {[...vertexTargets].map((v) => {
        const at = t.vertices[v]
        const occupied = !!view.buildings[v] || !!view.knights[v]
        const ghost = targets?.ghost ?? 'none'
        return (
          <g key={`vertex-target-${v}`} {...pressable(targets?.label?.('vertex', v) ?? `Corner ${v}`, () => onVertex?.(v))}>
            {occupied ? (
              <circle cx={at.x} cy={at.y} r={0.16} fill="rgba(255,255,255,0.12)" stroke="#fff" strokeWidth={0.025}
                strokeDasharray="0.06 0.04" className="transition group-hover:fill-white/30" />
            ) : (
              <circle cx={at.x} cy={at.y} r={0.055} fill="rgba(255,255,255,0.85)" stroke="#0f172a" strokeWidth={0.012}
                className="animate-pulse transition-opacity group-hover:opacity-0" />
            )}
            {!occupied && (ghost === 'settlement' || ghost === 'city') && (
              <Building at={at} city={ghost === 'city'} color={ghostColor} ghost className={GHOST} />
            )}
            {!occupied && ghost === 'knight' && <KnightPiece at={at} color={ghostColor} level={1} active={false} ghost className={GHOST} />}
            <circle cx={at.x} cy={at.y} r={0.14} fill="transparent" />
          </g>
        )
      })}
    </svg>
  )
}
