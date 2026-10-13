/**
 * Minimal inline-SVG icon set — no icon package dependency. Outline style,
 * 20x20 viewBox, stroke=currentColor so icons inherit the sidebar's text color.
 */
import { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base(paths: React.ReactNode) {
  return function IconComponent({ size = 18, ...props }: IconProps) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" {...props}>
        {paths}
      </svg>
    );
  };
}

export const DashboardIcon = base(
  <>
    <rect x="3" y="3" width="7" height="9" rx="1.5" />
    <rect x="14" y="3" width="7" height="5" rx="1.5" />
    <rect x="14" y="12" width="7" height="9" rx="1.5" />
    <rect x="3" y="16" width="7" height="5" rx="1.5" />
  </>,
);
export const BoltIcon = base(<path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" />);
export const GridIcon = base(
  <>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </>,
);
export const DocIcon = base(
  <>
    <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
    <path d="M14 3v5h5" />
    <path d="M9 13h6M9 17h6" />
  </>,
);
export const CheckSquareIcon = base(
  <>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M8 12l3 3 5-6" />
  </>,
);
export const PuzzleIcon = base(
  <path d="M9 3h4a1 1 0 0 1 1 1v2.1a2 2 0 1 0 0 3.8V12a1 1 0 0 1-1 1h-2.1a2 2 0 1 1-3.8 0H5a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h2.1a2 2 0 1 0 3.8 0V4a1 1 0 0 1-1-1z" />,
);
export const ChartIcon = base(
  <>
    <path d="M4 20V10M12 20V4M20 20v-7" />
  </>,
);
export const UsersIcon = base(
  <>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
    <circle cx="17" cy="9" r="2.5" />
    <path d="M15.5 14.2c2.6.5 4.5 2.4 4.5 5.8" />
  </>,
);
export const GearIcon = base(
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 13a7.97 7.97 0 0 0 0-2l2.1-1.6-2-3.4-2.5 1a8.1 8.1 0 0 0-1.7-1L15 3h-6l-.3 2.5a8.1 8.1 0 0 0-1.7 1l-2.5-1-2 3.4L4.6 11a7.97 7.97 0 0 0 0 2l-2.1 1.6 2 3.4 2.5-1a8.1 8.1 0 0 0 1.7 1L9 21h6l.3-2.5a8.1 8.1 0 0 0 1.7-1l2.5 1 2-3.4z" />
  </>,
);
export const WhatsAppIcon = base(
  <>
    <path d="M4 20l1.4-4.1A8 8 0 1 1 9 18.9z" />
    <path d="M8.5 9.5c.3 2.6 2.4 4.7 5 5" />
  </>,
);
export const LayersIcon = base(
  <>
    <path d="M12 2l9 5-9 5-9-5z" />
    <path d="M3 12l9 5 9-5M3 16l9 5 9-5" />
  </>,
);
export const VideoIcon = base(
  <>
    <rect x="2" y="5" width="14" height="14" rx="2" />
    <path d="M16 10l6-3v10l-6-3z" />
  </>,
);
export const CarouselIcon = base(
  <>
    <rect x="2" y="6" width="6" height="12" rx="1.5" />
    <rect x="9" y="4" width="6" height="16" rx="1.5" />
    <rect x="16" y="6" width="6" height="12" rx="1.5" />
  </>,
);
export const BookIcon = base(
  <>
    <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5z" />
    <path d="M4 4.5v17" />
  </>,
);
export const SearchIcon = base(
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
  </>,
);
export const BellIcon = base(
  <>
    <path d="M6 9a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 13 6 9z" />
    <path d="M10 19a2 2 0 0 0 4 0" />
  </>,
);
export const ChevronDownIcon = base(<path d="M6 9l6 6 6-6" />);
export const PlayIcon = base(
  <>
    <circle cx="12" cy="12" r="10" />
    <path d="M10 8l6 4-6 4z" />
  </>,
);
export const SignOutIcon = base(
  <>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="M16 17l5-5-5-5M21 12H9" />
  </>,
);
export const ArrowUpIcon = base(<path d="M12 19V5M5 12l7-7 7 7" />);
export const CalendarIcon = base(
  <>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </>,
);
export const SparkleIcon = base(
  <path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8z" />,
);
