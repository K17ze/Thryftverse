import { TextStyle } from 'react-native';

export const Typography = {
  family: {
    light: 'Inter_300Light',
    regular: 'Inter_400Regular',
    medium: 'Inter_500Medium',
    semibold: 'Inter_600SemiBold',
    bold: 'Inter_700Bold',
    extrabold: 'Inter_800ExtraBold',
  },
  size: {
    micro: 10,
    caption: 12,
    body: 15,
    bodyLarge: 16,
    title: 21,
    heading: 30,
    display: 40,
    hero: 56,
    giant: 72,
  },
  tracking: {
    tight: -0.42,
    normal: 0,
    wide: 0.12,
    caps: 0.82,
  },
} as const;

export const TypeStyles: { [key: string]: TextStyle } = {
  display: {
    fontFamily: Typography.family.extrabold,
    fontSize: Typography.size.display,
    letterSpacing: Typography.tracking.tight,
    lineHeight: 46,
  },
  hero: {
    fontFamily: Typography.family.extrabold,
    fontSize: Typography.size.hero,
    letterSpacing: -1.1,
    lineHeight: 60,
  },
  heroDisplay: {
    fontFamily: Typography.family.extrabold,
    fontSize: Typography.size.hero,
    letterSpacing: -1.4,
    lineHeight: 60,
  },
  giantDisplay: {
    fontFamily: Typography.family.extrabold,
    fontSize: Typography.size.giant,
    letterSpacing: -2,
    lineHeight: 74,
  },
  heading: {
    fontFamily: Typography.family.bold,
    fontSize: Typography.size.heading,
    letterSpacing: Typography.tracking.tight,
    lineHeight: 36,
  },
  title: {
    fontFamily: Typography.family.semibold,
    fontSize: Typography.size.title,
    letterSpacing: Typography.tracking.normal,
    lineHeight: 28,
  },
  body: {
    fontFamily: Typography.family.regular,
    fontSize: Typography.size.body,
    letterSpacing: Typography.tracking.normal,
    lineHeight: 22,
  },
  caption: {
    fontFamily: Typography.family.light,
    fontSize: Typography.size.caption,
    letterSpacing: Typography.tracking.wide,
    lineHeight: 18,
  },
  metadata: {
    fontFamily: Typography.family.light,
    fontSize: Typography.size.caption,
    letterSpacing: 0.4,
    lineHeight: 18,
  },
  overline: {
    fontFamily: Typography.family.medium,
    fontSize: Typography.size.micro,
    letterSpacing: Typography.tracking.caps,
    textTransform: 'uppercase',
    lineHeight: 14,
  },
  button: {
    fontFamily: Typography.family.semibold,
    fontSize: Typography.size.bodyLarge,
    letterSpacing: Typography.tracking.wide,
    lineHeight: 20,
  },
};
