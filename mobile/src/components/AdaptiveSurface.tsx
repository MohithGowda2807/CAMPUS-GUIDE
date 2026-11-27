import React from 'react';
import { View, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { useTheme } from '../context/ThemeContext';

interface AdaptiveSurfaceProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /**
   * 'card' = ordinary content container (always readable solid surface in both modes, with soft border/shadow)
   * 'floating' = floating search bar, map controls, bottom sheet header, floating pills (translucent glass in Glass Experience)
   */
  variant?: 'card' | 'floating';
  intensity?: number;
}

export function AdaptiveSurface({
  children,
  style,
  variant = 'card',
  intensity = 55,
}: AdaptiveSurfaceProps) {
  const { isGlass, theme } = useTheme();

  if (variant === 'floating' && isGlass) {
    return (
      <View
        style={[
          styles.floatingGlassOuter,
          {
            borderColor: theme.colors.surfaceFloatingBorder,
            backgroundColor: theme.colors.surfaceFloating,
          },
          theme.shadows.floating,
          style,
        ]}
      >
        <BlurView intensity={intensity} tint="light" style={StyleSheet.absoluteFill} />
        {children}
      </View>
    );
  }

  return (
    <View
      style={[
        styles.solidSurface,
        {
          backgroundColor: theme.colors.surface,
          borderColor:
            variant === 'floating'
              ? theme.colors.surfaceFloatingBorder
              : theme.colors.borderSubtle,
        },
        variant === 'floating' ? theme.shadows.floating : theme.shadows.card,
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  floatingGlassOuter: {
    overflow: 'hidden',
    borderWidth: 1,
  },
  solidSurface: {
    borderWidth: 1,
  },
});
