import { pctH, pctW, toPercent, type Port } from '../lib/geometry'
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
