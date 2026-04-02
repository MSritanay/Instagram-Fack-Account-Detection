interface RiskCylinderProps {
  score: number;
  color: string;
}

export function RiskCylinder({ score, color }: RiskCylinderProps) {
  // Clamp the score between 0 and 100
  const safeScore = Math.min(Math.max(score, 0), 100);
  const fillHeight = (safeScore / 100) * 100;

  return (
    <div className="w-full h-full flex items-center justify-center">
      <svg
        viewBox="0 0 100 200"
        className="w-24 h-full max-h-64"
        style={{ filter: 'drop-shadow(0 10px 20px rgba(0, 0, 0, 0.1))' }}
      >
        {/* Cylinder body - background */}
        <defs>
          <linearGradient id={`cylinderGradient-${safeScore}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="50%" stopColor={color} stopOpacity="0.6" />
            <stop offset="100%" stopColor={color} stopOpacity="0.3" />
          </linearGradient>
          <linearGradient id={`fillGradient-${safeScore}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={color} stopOpacity="0.7" />
            <stop offset="50%" stopColor={color} stopOpacity="1" />
            <stop offset="100%" stopColor={color} stopOpacity="0.7" />
          </linearGradient>
        </defs>

        {/* Cylinder left side */}
        <path
          d="M 25 20 Q 20 30 20 100 L 20 160 Q 20 170 25 175 L 75 175 Q 80 170 80 160 L 80 100 Q 80 30 75 20"
          fill={`url(#cylinderGradient-${safeScore})`}
          stroke={color}
          strokeWidth="1"
          opacity="0.4"
        />

        {/* Cylinder fill - dynamic based on score */}
        <rect
          x="25"
          y={90 + (100 - fillHeight) * 0.7}
          width="50"
          height={fillHeight * 0.7}
          fill={`url(#fillGradient-${safeScore})`}
          opacity="0.9"
          rx="2"
        />

        {/* Cylinder front edge */}
        <ellipse cx="50" cy={90 + (100 - fillHeight) * 0.7} rx="25" ry="8" fill={color} opacity="0.6" />

        {/* Cylinder top edge */}
        <ellipse cx="50" cy="20" rx="25" ry="8" fill={color} opacity="0.3" stroke={color} strokeWidth="1" />

        {/* Shine effect */}
        <ellipse
          cx="35"
          cy={90 + (100 - fillHeight) * 0.35}
          rx="8"
          ry="15"
          fill="white"
          opacity="0.2"
        />
      </svg>
    </div>
  );
}
