import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors } from './theme';

// Robin's stroke icon set (matches the design canvas). Decorative by default:
// give the surrounding control an accessibilityLabel instead.
export type IconName =
  | 'home' | 'calendar' | 'chat' | 'image' | 'bell' | 'plus' | 'check' | 'close' | 'clock' | 'pencil'
  | 'chevronLeft' | 'chevronRight' | 'chevronDown' | 'search' | 'lock' | 'person' | 'people' | 'send'
  | 'camera' | 'trash' | 'share' | 'link' | 'pin' | 'alert' | 'refresh' | 'cart' | 'star' | 'meal' | 'medical'
  | 'minus' | 'logout' | 'settings' | 'video' | 'more' | 'eyeOff' | 'checkCircle';

export function Icon({ name, size = 22, color = colors.text, strokeWidth = 2 }: { name: IconName; size?: number; color?: string; strokeWidth?: number }) {
  const p = { fill: 'none', stroke: color, strokeWidth, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const body = (() => {
    switch (name) {
      case 'home': return <Path {...p} d="M4 11l8-6 8 6v8a1 1 0 0 1-1 1h-4v-5h-6v5H5a1 1 0 0 1-1-1z" />;
      case 'calendar': return <><Rect {...p} x={4} y={5} width={16} height={15} rx={2} /><Path {...p} d="M4 10h16M9 3v4M15 3v4" /></>;
      case 'chat': return <Path {...p} d="M5 18l-1 3 4-2h9a3 3 0 0 0 3-3V8a3 3 0 0 0-3-3H7a3 3 0 0 0-3 3v8" />;
      case 'image': return <><Rect {...p} x={4} y={4} width={16} height={16} rx={3} /><Circle {...p} cx={9.5} cy={9.5} r={1.5} /><Path {...p} d="M20 15l-5-5-9 9" /></>;
      case 'bell': return <><Path {...p} d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" /><Path {...p} d="M10 21h4" /></>;
      case 'plus': return <Path {...p} d="M12 5v14M5 12h14" />;
      case 'minus': return <Path {...p} d="M5 12h14" />;
      case 'check': return <Path {...p} d="M5 12l5 5 9-10" />;
      case 'checkCircle': return <><Circle {...p} cx={12} cy={12} r={9} /><Path {...p} d="M8 12l3 3 5-6" /></>;
      case 'close': return <Path {...p} d="M6 6l12 12M18 6L6 18" />;
      case 'clock': return <><Circle {...p} cx={12} cy={12} r={9} /><Path {...p} d="M12 7v5l3 2" /></>;
      case 'pencil': return <Path {...p} d="M4 20h4L19 9l-4-4L4 16z" />;
      case 'chevronLeft': return <Path {...p} d="M15 5l-7 7 7 7" />;
      case 'chevronRight': return <Path {...p} d="M9 5l7 7-7 7" />;
      case 'chevronDown': return <Path {...p} d="M5 9l7 7 7-7" />;
      case 'search': return <><Circle {...p} cx={11} cy={11} r={6.5} /><Path {...p} d="M16 16l4 4" /></>;
      case 'lock': return <><Rect {...p} x={5} y={11} width={14} height={9} rx={2} /><Path {...p} d="M8 11V8a4 4 0 0 1 8 0v3" /></>;
      case 'person': return <><Circle {...p} cx={12} cy={8} r={3.5} /><Path {...p} d="M5 20c1-4 4-6 7-6s6 2 7 6" /></>;
      case 'people': return <><Circle {...p} cx={9} cy={9} r={3} /><Circle {...p} cx={16.5} cy={10} r={2.5} /><Path {...p} d="M3.5 19c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5M14.5 15c2.5-.6 5 .6 6 3.5" /></>;
      case 'send': return <Path {...p} d="M4 12l16-8-6 16-2-7z" />;
      case 'camera': return <><Path {...p} d="M4 8h3l2-3h6l2 3h3v11H4z" /><Circle {...p} cx={12} cy={13} r={3.5} /></>;
      case 'trash': return <Path {...p} d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13" />;
      case 'share': return <Path {...p} d="M12 3v12M7 8l5-5 5 5M5 14v6h14v-6" />;
      case 'link': return <Path {...p} d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1" />;
      case 'pin': return <><Path {...p} d="M12 21s-6-6-6-11a6 6 0 0 1 12 0c0 5-6 11-6 11z" /><Circle {...p} cx={12} cy={10} r={2} /></>;
      case 'alert': return <><Circle {...p} cx={12} cy={12} r={9} /><Path {...p} d="M12 7v6M12 16.5v.5" /></>;
      case 'refresh': return <Path {...p} d="M20 11a8 8 0 1 0-2 6M20 5v6h-6" />;
      case 'cart': return <><Path {...p} d="M5 8h14l-1.5 11h-11z" /><Path {...p} d="M9 8V6a3 3 0 0 1 6 0v2" /></>;
      case 'star': return <Path {...p} d="M12 3l2.5 5.5L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.5-.5z" />;
      case 'meal': return <Path {...p} d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M16 3c-2 2-2 6 0 8v10" />;
      case 'medical': return <><Rect {...p} x={4} y={6} width={16} height={14} rx={2} /><Path {...p} d="M9 6V4h6v2M12 10v6M9 13h6" /></>;
      case 'logout': return <Path {...p} d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10" />;
      case 'settings': return <><Circle {...p} cx={12} cy={12} r={3} /><Path {...p} d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" /></>;
      case 'video': return <><Rect {...p} x={3} y={6} width={13} height={12} rx={2} /><Path {...p} d="M16 10l5-3v10l-5-3z" /></>;
      case 'more': return <><Circle cx={6} cy={12} r={1.6} fill={color} /><Circle cx={12} cy={12} r={1.6} fill={color} /><Circle cx={18} cy={12} r={1.6} fill={color} /></>;
      case 'eyeOff': return <Path {...p} d="M3 3l18 18M10.6 6.1A9.6 9.6 0 0 1 12 6c5 0 9 6 9 6a16 16 0 0 1-3 3.4M6.6 6.6C4.2 8.2 3 12 3 12s4 6 9 6a8.6 8.6 0 0 0 4.4-1.2M9.9 9.9a3 3 0 0 0 4.2 4.2" />;
    }
  })();
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {body}
    </Svg>
  );
}
