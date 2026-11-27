import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import { Platform, ViewStyle } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type AppearanceMode = 'CLEAN_MODERN' | 'GLASS_EXPERIENCE';

const APPEARANCE_STORAGE_KEY = 'rvce_appearance_mode_v1';

export interface ThemeTokens {
  mode: AppearanceMode;
  isGlass: boolean;
  colors: {
    canvas: string;
    canvasSecondary: string;
    surface: string;
    surfaceMuted: string;
    surfaceFloating: string;
    surfaceFloatingBorder: string;
    primary: string;
    primaryLight: string;
    primarySoft: string;
    accent: string;
    accentSoft: string;
    textPrimary: string;
    textSecondary: string;
    textMuted: string;
    borderSubtle: string;
    divider: string;
    success: string;
    successBg: string;
    warning: string;
    warningBg: string;
    danger: string;
    dangerBg: string;
    info: string;
    infoBg: string;
  };
  shadows: {
    card: ViewStyle;
    floating: ViewStyle;
    sheet: ViewStyle;
  };
}

const CLEAN_MODERN_TOKENS: ThemeTokens = {
  mode: 'CLEAN_MODERN',
  isGlass: false,
  colors: {
    canvas: '#F7F8FA',
    canvasSecondary: '#F1F4F9',
    surface: '#FFFFFF',
    surfaceMuted: '#F3F5F8',
    surfaceFloating: '#FFFFFF',
    surfaceFloatingBorder: 'rgba(15, 23, 42, 0.07)',
    primary: '#27447E',
    primaryLight: '#3B63B8',
    primarySoft: '#EDF2FC',
    accent: '#2563EB',
    accentSoft: '#EFF6FF',
    textPrimary: '#111827',
    textSecondary: '#4B5563',
    textMuted: '#6B7280',
    borderSubtle: 'rgba(15, 23, 42, 0.06)',
    divider: 'rgba(15, 23, 42, 0.05)',
    success: '#15803D',
    successBg: '#DCFCE7',
    warning: '#B45309',
    warningBg: '#FEF3C7',
    danger: '#B91C1C',
    dangerBg: '#FEE2E2',
    info: '#1D4ED8',
    infoBg: '#DBEAFE',
  },
  shadows: {
    card: Platform.select({
      ios: {
        shadowColor: '#0F172A',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.05,
        shadowRadius: 14,
      },
      android: {
        elevation: 2,
      },
      default: {},
    }) as ViewStyle,
    floating: Platform.select({
      ios: {
        shadowColor: '#0F172A',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.09,
        shadowRadius: 20,
      },
      android: {
        elevation: 6,
      },
      default: {},
    }) as ViewStyle,
    sheet: Platform.select({
      ios: {
        shadowColor: '#0F172A',
        shadowOffset: { width: 0, height: -6 },
        shadowOpacity: 0.1,
        shadowRadius: 22,
      },
      android: {
        elevation: 14,
      },
      default: {},
    }) as ViewStyle,
  },
};

const GLASS_EXPERIENCE_TOKENS: ThemeTokens = {
  mode: 'GLASS_EXPERIENCE',
  isGlass: true,
  colors: {
    canvas: '#F2F6FC',
    canvasSecondary: '#E8EFFA',
    surface: '#FFFFFF',
    surfaceMuted: '#EFF4FB',
    surfaceFloating: 'rgba(255, 255, 255, 0.78)',
    surfaceFloatingBorder: 'rgba(255, 255, 255, 0.65)',
    primary: '#27447E',
    primaryLight: '#3B63B8',
    primarySoft: 'rgba(39, 68, 126, 0.10)',
    accent: '#2563EB',
    accentSoft: 'rgba(37, 99, 235, 0.11)',
    textPrimary: '#0F172A',
    textSecondary: '#475569',
    textMuted: '#64748B',
    borderSubtle: 'rgba(39, 68, 126, 0.08)',
    divider: 'rgba(15, 23, 42, 0.05)',
    success: '#15803D',
    successBg: '#DCFCE7',
    warning: '#B45309',
    warningBg: '#FEF3C7',
    danger: '#B91C1C',
    dangerBg: '#FEE2E2',
    info: '#1D4ED8',
    infoBg: '#DBEAFE',
  },
  shadows: {
    card: Platform.select({
      ios: {
        shadowColor: '#1E3A8A',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.06,
        shadowRadius: 16,
      },
      android: {
        elevation: 3,
      },
      default: {},
    }) as ViewStyle,
    floating: Platform.select({
      ios: {
        shadowColor: '#1E3A8A',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.12,
        shadowRadius: 24,
      },
      android: {
        elevation: 8,
      },
      default: {},
    }) as ViewStyle,
    sheet: Platform.select({
      ios: {
        shadowColor: '#0F172A',
        shadowOffset: { width: 0, height: -8 },
        shadowOpacity: 0.14,
        shadowRadius: 26,
      },
      android: {
        elevation: 16,
      },
      default: {},
    }) as ViewStyle,
  },
};

interface ThemeContextValue {
  mode: AppearanceMode;
  isGlass: boolean;
  theme: ThemeTokens;
  setAppearanceMode: (mode: AppearanceMode) => Promise<void>;
  toggleAppearanceMode: () => Promise<void>;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: 'CLEAN_MODERN',
  isGlass: false,
  theme: CLEAN_MODERN_TOKENS,
  setAppearanceMode: async () => {},
  toggleAppearanceMode: async () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<AppearanceMode>('CLEAN_MODERN');

  useEffect(() => {
    AsyncStorage.getItem(APPEARANCE_STORAGE_KEY)
      .then((saved) => {
        if (saved === 'CLEAN_MODERN' || saved === 'GLASS_EXPERIENCE') {
          setMode(saved);
        }
      })
      .catch(() => {});
  }, []);

  const setAppearanceMode = async (next: AppearanceMode) => {
    setMode(next);
    try {
      await AsyncStorage.setItem(APPEARANCE_STORAGE_KEY, next);
    } catch {
      // Ignore persistence write failures
    }
  };

  const toggleAppearanceMode = async () => {
    const next: AppearanceMode = mode === 'CLEAN_MODERN' ? 'GLASS_EXPERIENCE' : 'CLEAN_MODERN';
    await setAppearanceMode(next);
  };

  const value = useMemo<ThemeContextValue>(() => {
    const theme = mode === 'GLASS_EXPERIENCE' ? GLASS_EXPERIENCE_TOKENS : CLEAN_MODERN_TOKENS;
    return {
      mode,
      isGlass: mode === 'GLASS_EXPERIENCE',
      theme,
      setAppearanceMode,
      toggleAppearanceMode,
    };
  }, [mode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
