import { RiskCylinder } from './RiskCylinder';

interface RiskMeterProps {
  score: number;
  compact?: boolean;
}

export function RiskMeter({ score, compact = false }: RiskMeterProps) {
  // clamp and default
  const safeScore = typeof score === 'number' && isFinite(score) ? Math.min(Math.max(score, 0), 100) : 0;
  // Determine color based on risk score
  let color = "#00ff00";
  let label = "Low";
  
  if (safeScore > 30) {
    color = "#ffa500";
    label = "Medium";
  }
  if (safeScore > 70) {
    color = "#ff0000";
    label = "High";
  }

  if (compact) {
    return (
      <div className="w-full h-24">
        <RiskCylinder score={score} color={color} />
      </div>
    );
  }

  return (
    <div className="w-full h-64 relative">
      <RiskCylinder score={score} color={color} />
      <div className="absolute top-4 right-4 text-right">
        <span className="text-2xl font-bold" style={{ color }}>
          {score}/100
        </span>
        <p className="text-xs text-muted-foreground font-medium">{label} Risk</p>
      </div>
    </div>
  );
}