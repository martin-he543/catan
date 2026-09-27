import { useMemo } from 'react'
import { HEX_CENTERS, SEA_CENTERS, VERTICES, VIEW, portsFor } from '../lib/geometry'
import { legalVertices, type VertexReport } from '../lib/analysis'
import { HexTile } from './HexTile'
import { PortMarker } from './PortMarker'
import { SettlementSpot } from './SettlementSpot'
import { PLACEMENT_ORDER, type Game } from '../lib/types'

interface Props {
  game: Game
  reports: VertexReport[]
  showRatings: boolean
  hovered: number | null
  onHover: (index: number | null) => void
  onSelect: (index: number) => void
}

export function Board({ game, reports, showRatings, hovered, onHover, onSelect }: Props) {
  const ports = portsFor(game.portShifts)
  const legal = useMemo(() => legalVertices(game.locs), [game.locs])
  const placingDone = game.locs.length >= PLACEMENT_ORDER.length

  // Hovering a corner spotlights the tiles and port it would feed from.
  const focusTiles = useMemo(
    () => (hovered === null ? null : new Set(VERTICES[hovered].tiles)),
    [hovered],
  )
  const focusPorts = useMemo(
    () =>
      hovered === null
        ? null
        : new Set(
            ports.flatMap((p, i) => (p.vertices.includes(hovered) ? [i] : [])),
          ),
    [hovered, ports],
  )

  return (
    <div
      className="relative mx-auto w-full max-w-5xl select-none"
      style={{ aspectRatio: `${VIEW.width} / ${VIEW.height}`, containerType: 'inline-size' }}
    >
      {SEA_CENTERS.map((center, i) => (
        <HexTile key={`sea-${i}`} center={center} sea />
      ))}

      {HEX_CENTERS.map((center, i) => (
        <HexTile
          key={`tile-${i}`}
          center={center}
          tile={game.tiles[i]}
          dimmed={focusTiles ? !focusTiles.has(i) : false}
          highlighted={focusTiles?.has(i)}
        />
      ))}

      {ports.map((port, i) => (
        <PortMarker
          key={`port-${i}`}
          port={port}
          type={game.ports[i]}
          highlighted={focusPorts?.has(i)}
        />
      ))}

      {VERTICES.map((vertex) => {
        const placedAt = game.locs.indexOf(vertex.index)
        return (
          <SettlementSpot
            key={vertex.index}
            index={vertex.index}
            owner={placedAt >= 0 ? PLACEMENT_ORDER[placedAt] : undefined}
            isFirstRound={placedAt >= 0 && placedAt < 4}
            clickable={!placingDone && legal.has(vertex.index)}
            blocked={placedAt < 0 && !legal.has(vertex.index)}
            report={reports[vertex.index]}
            showRatings={showRatings}
            onSelect={onSelect}
            onHover={onHover}
          />
        )
      })}
    </div>
  )
}
