type CarType = 'sedan' | 'hatchback' | 'kei' | 'suv' | 'van';

function detectType(brand: string, model: string): CarType {
  const s = `${brand} ${model}`.toLowerCase();
  if (/wagon.?r|dayz|alto|move|spacia|every/.test(s)) return 'kei';
  if (/fit|vitz|swift|note|yaris|march|demio|belta/.test(s)) return 'hatchback';
  if (/vezel|hr.?v|rav4|rush|x.trail|dualis|cr.?v|outlander/.test(s)) return 'suv';
  if (/hiace|kdh|caravan|townace|liteace/.test(s)) return 'van';
  return 'sedan';
}

function Wheel({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={17} fill="#1A202C" />
      <circle cx={cx} cy={cy} r={9} fill="#4A5568" />
      <circle cx={cx} cy={cy} r={3.5} fill="#A0AEC0" />
      {[0, 60, 120, 180, 240, 300].map((deg) => {
        const r = (deg * Math.PI) / 180;
        return (
          <line key={deg}
            x1={cx + 3.5 * Math.cos(r)} y1={cy + 3.5 * Math.sin(r)}
            x2={cx + 8.5 * Math.cos(r)} y2={cy + 8.5 * Math.sin(r)}
            stroke="#2D3748" strokeWidth={1.5}
          />
        );
      })}
    </g>
  );
}

interface Props {
  brand: string;
  model: string;
  bodyColor?: string;
  className?: string;
}

export default function CarSVG({ brand, model, bodyColor = '#FFFFFF', className = '' }: Props) {
  const type = detectType(brand, model);
  const wc = 'rgba(184,212,240,0.85)';

  if (type === 'sedan') {
    return (
      <svg viewBox="0 0 260 92" className={className} xmlns="http://www.w3.org/2000/svg">
        <ellipse cx="130" cy="89" rx="108" ry="4" fill="rgba(0,0,0,0.18)" />
        <path d="M22 82 L22 65 Q25 53 45 51 L72 49 Q82 26 95 23 L170 23 Q185 25 198 49 L220 51 Q235 54 237 65 L237 82 Z" fill={bodyColor} />
        <path d="M88 49 Q96 27 100 25 L167 25 Q180 27 192 49 Z" fill={wc} />
        <line x1="140" y1="25" x2="140" y2="49" stroke="rgba(0,0,0,0.12)" strokeWidth="1.5" />
        <rect x="232" y="59" width="7" height="13" rx="2.5" fill="#FFF176" opacity={0.95} />
        <rect x="21" y="59" width="7" height="13" rx="2.5" fill="#EF9A9A" opacity={0.95} />
        <Wheel cx={63} cy={82} />
        <Wheel cx={197} cy={82} />
      </svg>
    );
  }

  if (type === 'hatchback') {
    return (
      <svg viewBox="0 0 250 92" className={className} xmlns="http://www.w3.org/2000/svg">
        <ellipse cx="125" cy="89" rx="100" ry="4" fill="rgba(0,0,0,0.18)" />
        <path d="M25 82 L25 65 Q27 55 42 53 L55 50 Q65 30 80 24 L172 24 Q192 28 202 50 Q208 57 210 65 L210 82 Z" fill={bodyColor} />
        <path d="M74 50 Q82 30 87 26 L170 26 Q186 30 196 50 Z" fill={wc} />
        <line x1="133" y1="26" x2="133" y2="50" stroke="rgba(0,0,0,0.12)" strokeWidth="1.5" />
        <rect x="205" y="59" width="7" height="13" rx="2.5" fill="#FFF176" opacity={0.95} />
        <rect x="23" y="59" width="7" height="13" rx="2.5" fill="#EF9A9A" opacity={0.95} />
        <Wheel cx={63} cy={82} />
        <Wheel cx={172} cy={82} />
      </svg>
    );
  }

  if (type === 'kei') {
    return (
      <svg viewBox="0 0 235 92" className={className} xmlns="http://www.w3.org/2000/svg">
        <ellipse cx="117" cy="89" rx="90" ry="4" fill="rgba(0,0,0,0.18)" />
        <path d="M28 82 L28 67 Q30 57 42 55 L50 52 Q57 22 72 18 L165 18 Q180 22 184 52 L192 55 Q200 60 202 67 L202 82 Z" fill={bodyColor} />
        <path d="M62 50 Q67 22 74 20 L163 20 Q174 22 178 50 Z" fill={wc} />
        <line x1="120" y1="20" x2="120" y2="50" stroke="rgba(0,0,0,0.12)" strokeWidth="1.5" />
        <rect x="197" y="57" width="7" height="14" rx="2.5" fill="#FFF176" opacity={0.95} />
        <rect x="26" y="57" width="7" height="14" rx="2.5" fill="#EF9A9A" opacity={0.95} />
        <Wheel cx={63} cy={82} />
        <Wheel cx={163} cy={82} />
      </svg>
    );
  }

  if (type === 'suv') {
    return (
      <svg viewBox="0 0 270 92" className={className} xmlns="http://www.w3.org/2000/svg">
        <ellipse cx="132" cy="89" rx="112" ry="4" fill="rgba(0,0,0,0.18)" />
        <path d="M22 82 L22 62 Q24 50 40 48 L55 44 Q68 28 88 24 L175 24 Q192 28 210 45 L225 48 Q235 52 238 62 L238 82 Z" fill={bodyColor} />
        <path d="M82 44 Q90 28 96 26 L170 26 Q188 28 202 44 Z" fill={wc} />
        <line x1="135" y1="26" x2="135" y2="44" stroke="rgba(0,0,0,0.12)" strokeWidth="1.5" />
        <rect x="233" y="56" width="7" height="14" rx="2.5" fill="#FFF176" opacity={0.95} />
        <rect x="21" y="56" width="7" height="14" rx="2.5" fill="#EF9A9A" opacity={0.95} />
        <Wheel cx={67} cy={82} />
        <Wheel cx={200} cy={82} />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 280 92" className={className} xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="140" cy="89" rx="120" ry="4" fill="rgba(0,0,0,0.18)" />
      <path d="M30 82 L30 62 Q32 48 48 44 L60 42 Q66 20 82 18 L205 18 Q218 22 220 44 L228 44 Q232 50 232 62 L232 82 Z" fill={bodyColor} />
      <path d="M68 42 Q72 22 84 20 L200 20 Q213 22 215 42 Z" fill={wc} />
      <line x1="127" y1="20" x2="127" y2="42" stroke="rgba(0,0,0,0.12)" strokeWidth="1.5" />
      <line x1="158" y1="20" x2="158" y2="42" stroke="rgba(0,0,0,0.12)" strokeWidth="1.5" />
      <rect x="227" y="54" width="7" height="16" rx="2.5" fill="#FFF176" opacity={0.95} />
      <rect x="28" y="54" width="7" height="16" rx="2.5" fill="#EF9A9A" opacity={0.95} />
      <Wheel cx={73} cy={82} />
      <Wheel cx={195} cy={82} />
    </svg>
  );
}

export function vehicleBodyColor(colorName?: string): string {
  const map: Record<string, string> = {
    silver: '#C8C8C8', white: '#F0F0F0', blue: '#2563EB', red: '#DC2626',
    'pearl white': '#F5F5F0', black: '#1A1A2E', grey: '#9CA3AF', gray: '#9CA3AF',
    green: '#16A34A', yellow: '#CA8A04', orange: '#EA580C', brown: '#92400E',
  };
  return map[(colorName ?? '').toLowerCase()] ?? '#C8C8C8';
}
