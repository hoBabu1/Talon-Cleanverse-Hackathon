type Plate = {
  cy: number;
  number: number;
  accent: boolean;
};

const CX = 180;
const HALF_W = 130;
const HALF_H = 42;
const DEPTH = 14;

/** Four isometric plates, layer 1 (foundation) at the bottom → layer 4 on top. */
const PLATES: Plate[] = [4, 3, 2, 1].map((n, k) => ({
  cy: 96 + k * 54,
  number: n,
  accent: n === 4,
}));

function topFace(cy: number) {
  return `${CX},${cy - HALF_H} ${CX + HALF_W},${cy} ${CX},${cy + HALF_H} ${CX - HALF_W},${cy}`;
}

function leftFace(cy: number) {
  return `${CX - HALF_W},${cy} ${CX},${cy + HALF_H} ${CX},${cy + HALF_H + DEPTH} ${CX - HALF_W},${cy + DEPTH}`;
}

function rightFace(cy: number) {
  return `${CX + HALF_W},${cy} ${CX},${cy + HALF_H} ${CX},${cy + HALF_H + DEPTH} ${CX + HALF_W},${cy + DEPTH}`;
}

/**
 * Isometric stacked-layer graphic in the visual language of
 * cleanverse.com/how-it-works — relabelled for Talon's four lifecycle layers.
 * Pure SVG: crisp at every density, themeable, no asset weight.
 */
export default function LayerStack() {
  return (
    <svg
      viewBox="0 0 360 340"
      role="img"
      aria-label="Four stacked layers: 1 Live Cap Table, 2 Corporate Action Declared, 3 Pay-Date Re-Verification, 4 Payout or Escrow"
      className="h-auto w-full max-w-[420px] animate-float"
    >
      <defs>
        <radialGradient id="layer-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#F8651C" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#F8651C" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Ambient glow behind the active (top) layer */}
      <ellipse cx={CX} cy={96} rx={170} ry={78} fill="url(#layer-glow)" />

      {PLATES.map(({ cy, number, accent }) => (
        <g key={number}>
          <polygon
            points={leftFace(cy)}
            fill={accent ? "#3a1c0c" : "#121215"}
            stroke={accent ? "#F8651C" : "#2c2c31"}
            strokeOpacity={accent ? 0.55 : 1}
            strokeWidth={1}
          />
          <polygon
            points={rightFace(cy)}
            fill={accent ? "#4a240f" : "#17171a"}
            stroke={accent ? "#F8651C" : "#2c2c31"}
            strokeOpacity={accent ? 0.55 : 1}
            strokeWidth={1}
          />
          <polygon
            points={topFace(cy)}
            fill={accent ? "rgba(248,101,28,0.16)" : "#1d1d21"}
            stroke={accent ? "#F8651C" : "#2c2c31"}
            strokeWidth={accent ? 1.4 : 1}
          />
          <circle
            cx={CX}
            cy={cy}
            r={13}
            fill={accent ? "#F8651C" : "#232328"}
            stroke={accent ? "none" : "#3a3a41"}
            strokeWidth={1}
          />
          <text
            x={CX}
            y={cy + 4.5}
            textAnchor="middle"
            fontSize={13}
            fontWeight={700}
            fill="#ffffff"
            fontFamily="inherit"
          >
            {number}
          </text>
        </g>
      ))}
    </svg>
  );
}
