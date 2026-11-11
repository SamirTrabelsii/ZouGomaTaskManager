/**
 * Flat portraits of the crew bots for the 2D interface (dock, panel headers, room pins), drawn from the same character sheets
 * as their 3D figures: white shell, black visor, glowing blue eyes. They scale with the font size like the emoji icons they
 * sit beside.
 */

const EYE = '#3fc4ff';
const VISOR = '#0b0f16';
const SHELL = '#f4efe6';

/** Two happy ∩ eyes on a visor centred at (cx, cy). */
function HappyEyes({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g fill="none" stroke={EYE} strokeWidth={2.2} strokeLinecap="round">
      <path d={`M${cx - 7.5} ${cy + 1.5} q2.5 -4.2 5 0`} />
      <path d={`M${cx + 2.5} ${cy + 1.5} q2.5 -4.2 5 0`} />
    </g>
  );
}

export function ChopperAvatar({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" width="1.2em" height="1.2em" className={className} aria-hidden focusable="false">
      {/* antlers */}
      <g fill="none" stroke="#9b5a2b" strokeWidth={3.2} strokeLinecap="round">
        <path d="M10 15 L4 6 M6.5 9.5 L2.5 10.5 M7 8 L8 3" />
        <path d="M38 15 L44 6 M41.5 9.5 L45.5 10.5 M41 8 L40 3" />
      </g>
      {/* face shell and visor */}
      <ellipse cx="24" cy="34" rx="15.5" ry="12.5" fill={SHELL} />
      <rect x="12" y="28" width="24" height="12" rx="6" fill={VISOR} />
      <HappyEyes cx={24} cy={34} />
      {/* blue hat, pink brim, the doctor's mark */}
      <path d="M10 22 V15 C10 6 38 6 38 15 V22 Z" fill="#2f6fd6" />
      <circle cx="15" cy="12" r="1" fill="#fff" /><circle cx="33" cy="12" r="1" fill="#fff" /><circle cx="24" cy="6.5" r="1" fill="#fff" />
      <rect x="7" y="20" width="34" height="7" rx="3.5" fill="#f06a80" />
      <circle cx="24" cy="14" r="5.2" fill="#f06a80" stroke="#fff" strokeWidth={1.4} />
      <path d="M21.6 11.6 L26.4 16.4 M26.4 11.6 L21.6 16.4" stroke="#fff" strokeWidth={1.6} strokeLinecap="round" />
    </svg>
  );
}

export function NamiAvatar({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" width="1.2em" height="1.2em" className={className} aria-hidden focusable="false">
      {/* long wavy hair behind */}
      <path d="M8 22 C4 30 9 34 5 40 C9 46 15 44 16 40 L32 40 C33 44 39 46 43 40 C39 34 44 30 40 22 C40 8 8 8 8 22 Z" fill="#f27420" />
      {/* face shell and visor */}
      <ellipse cx="24" cy="27" rx="13.5" ry="12" fill={SHELL} />
      <rect x="13.5" y="23" width="21" height="11" rx="5.5" fill={VISOR} />
      <HappyEyes cx={24} cy={28.5} />
      {/* bangs */}
      <path d="M10 22 C11 12 37 12 38 22 C34 18 30 21 26 18 C22 21 17 17 10 22 Z" fill="#f27420" />
      <path d="M11 22 C9 26 10 29 8 32" fill="none" stroke="#d95f12" strokeWidth={2} strokeLinecap="round" />
      <path d="M37 22 C39 26 38 29 40 32" fill="none" stroke="#d95f12" strokeWidth={2} strokeLinecap="round" />
      {/* goggles on top of her head */}
      <path d="M9 12 C16 7 32 7 39 12" fill="none" stroke="#7c4420" strokeWidth={2} />
      <circle cx="18.5" cy="9" r="4.6" fill="#b0702e" /><circle cx="18.5" cy="9" r="3.1" fill="#f0a24a" />
      <circle cx="29.5" cy="9" r="4.6" fill="#b0702e" /><circle cx="29.5" cy="9" r="3.1" fill="#f0a24a" />
      <circle cx="17.3" cy="7.8" r="0.9" fill="#fff" opacity={0.8} /><circle cx="28.3" cy="7.8" r="0.9" fill="#fff" opacity={0.8} />
    </svg>
  );
}
