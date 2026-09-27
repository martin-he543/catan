import { useCallback, useRef, useState } from 'react'
import { ANCHOR_TILES, hexOutlines, type Point } from '../lib/vision'
import { HEX_LABELS } from '../lib/notation'

interface Props {
  src: string
  /** Natural pixel size of the photo; the overlay shares its coordinate space. */
  width: number
  height: number
  anchors: [Point, Point]
  onChange: (anchors: [Point, Point]) => void
}

const HANDLE_LABELS = ANCHOR_TILES.map((tile) => HEX_LABELS[tile])

/**
 * The photo with a draggable hex grid laid over it.
 *
 * The grid is rigid — only its position, scale and rotation move — so lining up
 * two opposite tiles lines up all nineteen. The SVG shares the photo's own pixel
 * coordinates, which keeps the overlay glued to the image at any display size.
 */
export function ImageCalibrator({ src, width, height, anchors, onChange }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [dragging, setDragging] = useState<number | null>(null)

  const outlines = hexOutlines(anchors[0], anchors[1])
  // Scale the overlay's furniture with the photo so it reads at any resolution.
  const unit = Math.max(width, height) / 100

  const toImage = useCallback((clientX: number, clientY: number): Point | null => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return null
    return {
      x: ((clientX - rect.left) / rect.width) * width,
      y: ((clientY - rect.top) / rect.height) * height,
    }
  }, [width, height])

  const moveHandle = useCallback(
    (index: number, to: Point) => {
      const next: [Point, Point] = [anchors[0], anchors[1]]
      next[index] = to
      onChange(next)
    },
    [anchors, onChange],
  )

  const onPointerDown = (index: number) => (event: React.PointerEvent<SVGGElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(index)
  }

  const onPointerMove = (index: number) => (event: React.PointerEvent<SVGGElement>) => {
    if (dragging !== index) return
    const point = toImage(event.clientX, event.clientY)
    if (point) moveHandle(index, point)
  }

  const onKeyDown = (index: number) => (event: React.KeyboardEvent<SVGGElement>) => {
    const step = event.shiftKey ? unit * 4 : unit
    const nudge: Record<string, Point> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    }
    const delta = nudge[event.key]
    if (!delta) return
    event.preventDefault()
    moveHandle(index, { x: anchors[index].x + delta.x, y: anchors[index].y + delta.y })
  }

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black/30">
      <img src={src} alt="The board you uploaded" className="block w-full select-none" draggable={false} />

      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="absolute inset-0 h-full w-full touch-none"
        aria-label="Hex grid overlay. Drag the two handles onto the matching tiles."
      >
        {outlines.map((corners, i) => (
          <polygon
            key={i}
            points={corners.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke="#34b3e4"
            strokeWidth={unit * 0.22}
            strokeLinejoin="round"
            opacity={0.85}
            // A dark companion stroke keeps the grid legible on pale tiles.
            style={{ paintOrder: 'stroke' }}
          />
        ))}

        {anchors.map((anchor, index) => (
          <g
            key={index}
            tabIndex={0}
            role="button"
            aria-label={`Handle for tile ${HANDLE_LABELS[index]}. Drag it onto that tile, or nudge with the arrow keys.`}
            className="cursor-grab focus:outline-none"
            onPointerDown={onPointerDown(index)}
            onPointerMove={onPointerMove(index)}
            onPointerUp={() => setDragging(null)}
            onPointerCancel={() => setDragging(null)}
            onKeyDown={onKeyDown(index)}
          >
            <circle
              cx={anchor.x}
              cy={anchor.y}
              r={unit * (dragging === index ? 3.4 : 2.8)}
              fill="rgba(4,29,43,0.75)"
              stroke="#ffd60a"
              strokeWidth={unit * 0.35}
            />
            <text
              x={anchor.x}
              y={anchor.y}
              textAnchor="middle"
              dominantBaseline="central"
              fill="#ffd60a"
              fontSize={unit * 2.4}
              fontWeight="700"
              className="pointer-events-none select-none"
            >
              {HANDLE_LABELS[index]}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}
