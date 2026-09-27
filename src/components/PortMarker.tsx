import { canRotatePorts, hasPortShifts, pctH, pctW, rotatePorts, toPercent, type Port } from '../lib/geometry'
import { portImage } from '../lib/assets'
import { PORT_LABELS, type PortType } from '../lib/types'

const SIZE = 0.62

interface Props {
  port: Port
  type: PortType
  highlighted?: boolean
}

export function PortMarker({ port, type, highlighted }: Props) {
  const { left, top } = toPercent(port.pos)

  return (
    <div
      className="absolute -translate-x-1/2 -translate-y-1/2 transition-transform duration-300"
      style={{
        left: `${left}%`,
        top: `${top}%`,
        width: `${pctW(SIZE)}%`,
        height: `${pctH(SIZE)}%`,
        scale: highlighted ? '1.18' : '1',
      }}
      title={PORT_LABELS[type]}
    >
      <img
        src={portImage(type)}
        alt={PORT_LABELS[type]}
        draggable={false}
        className="h-full w-full object-contain select-none
                   drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]"
        style={{ rotate: `${port.angle}deg` }}
      />
    </div>
  )
}

interface ShifterProps {
  shifts: readonly number[] | undefined
  onShift: (shifts: number[] | undefined) => void
}

/**
 * Slides every port one shoreline edge left (anticlockwise) or right
 * (clockwise) — for printed boards whose harbours sit one edge along from ours.
 */
export function PortShifter({ shifts, onShift }: ShifterProps) {
  const button = (delta: number, label: string, arrow: string) => (
    <button
      type="button"
      disabled={!canRotatePorts(shifts, delta)}
      onClick={() => onShift(rotatePorts(shifts, delta))}
      title={`Move every port one edge ${delta > 0 ? 'clockwise' : 'anticlockwise'}`}
      className="rounded-md px-2.5 py-1 transition hover:bg-white/15 disabled:opacity-30"
    >
      {delta < 0 && <span aria-hidden>{arrow} </span>}
      {label}
      {delta > 0 && <span aria-hidden> {arrow}</span>}
    </button>
  )

  return (
    <div className="panel flex items-center gap-1 p-1 text-sm" role="group" aria-label="Move ports">
      <span className="px-2 text-sea-200">Ports</span>
      {button(-1, 'Left', '↺')}
      {button(1, 'Right', '↻')}
      {hasPortShifts(shifts) && (
        <button
          type="button"
          onClick={() => onShift(undefined)}
          title="Put the ports back in their standard spots"
          className="rounded-md px-2.5 py-1 text-sea-200 transition hover:bg-white/15"
        >
          Reset
        </button>
      )}
    </div>
  )
}
