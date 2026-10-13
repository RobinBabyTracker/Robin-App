// Robin design tokens (from the approved design direction).
// Brand fonts: Ethic Serif (headings), Questa (Robin's voice), Roboto (UI).
// Ethic Serif and Questa need app-embedding licences; until those files are
// added (see README), DM Serif Display and Source Serif 4 stand in.

export const colors = {
  background: '#FFD2D9', // pale pink: app background
  surface: '#FFFFFF', // cards
  cream: '#FFF4E8', // Robin's notes, quiet tiles
  pink: '#FF88BE', // celebrations only
  oliveYellow: '#B9AC39', // decoration only, never text
  text: '#3C3813', // deep olive
  textSecondary: '#5E5829', // 5.3:1 on pale pink
  primary: '#741D28', // burgundy: primary actions, selected, focus
  onPrimary: '#FFFFFF',
  border: '#E7D8C6',
  divider: '#F0E4D6',
  disabledBg: '#F6EEE4',
  disabledText: '#5E5829',
  danger: '#741D28',
  success: '#3C3813',
  scrim: 'rgba(60,56,19,0.45)',
} as const;

export const fonts = {
  heading: 'Heading', // Ethic Serif (stand-in: DM Serif Display)
  voice: 'Voice', // Questa (stand-in: Source Serif 4)
  body: 'Body', // Roboto 400
  medium: 'BodyMedium', // Roboto 500
  bold: 'BodyBold', // Roboto 700
} as const;

export const type = {
  display: { fontFamily: fonts.heading, fontSize: 32, lineHeight: 38 },
  title: { fontFamily: fonts.heading, fontSize: 24, lineHeight: 30 },
  heading: { fontFamily: fonts.heading, fontSize: 20, lineHeight: 26 },
  body: { fontFamily: fonts.body, fontSize: 17, lineHeight: 24 },
  bodyStrong: { fontFamily: fonts.bold, fontSize: 17, lineHeight: 24 },
  label: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 20 },
  caption: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18 },
  overline: { fontFamily: fonts.bold, fontSize: 13, lineHeight: 18, letterSpacing: 0.8, textTransform: 'uppercase' as const },
  voice: { fontFamily: fonts.voice, fontSize: 17, lineHeight: 25 },
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 12, md: 16, lg: 20, pill: 999 } as const;
export const touch = 48; // minimum touch target
