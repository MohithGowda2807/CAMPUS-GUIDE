import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { useTheme } from '../../src/context/ThemeContext';

export default function TabLayout() {
  const { isGlass, theme } = useTheme();

  const renderIcon = (
    focused: boolean,
    color: string,
    activeName: keyof typeof Ionicons.glyphMap,
    inactiveName: keyof typeof Ionicons.glyphMap
  ) => (
    <View
      style={[
        styles.iconWrap,
        focused && {
          backgroundColor: isGlass ? 'rgba(39, 68, 126, 0.13)' : theme.colors.primarySoft,
        },
      ]}
    >
      <Ionicons name={focused ? activeName : inactiveName} size={20} color={color} />
    </View>
  );

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textMuted,
        tabBarBackground: isGlass
          ? () => (
              <BlurView
                intensity={65}
                tint="light"
                style={[
                  StyleSheet.absoluteFill,
                  { backgroundColor: 'rgba(255, 255, 255, 0.80)' },
                ]}
              />
            )
          : undefined,
        tabBarStyle: {
          backgroundColor: isGlass ? 'rgba(255, 255, 255, 0.78)' : theme.colors.surface,
          borderTopColor: isGlass
            ? 'rgba(255, 255, 255, 0.65)'
            : theme.colors.borderSubtle,
          borderTopWidth: 1,
          height: 64,
          paddingBottom: 9,
          paddingTop: 6,
          elevation: isGlass ? 12 : 8,
          shadowColor: '#0F172A',
          shadowOffset: { width: 0, height: -4 },
          shadowOpacity: isGlass ? 0.09 : 0.05,
          shadowRadius: 12,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
          marginTop: 1,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, focused }) =>
            renderIcon(focused, color as string, 'home', 'home-outline'),
        }}
      />
      <Tabs.Screen
        name="map"
        options={{
          title: 'Explore',
          tabBarIcon: ({ color, focused }) =>
            renderIcon(focused, color as string, 'compass', 'compass-outline'),
        }}
      />
      <Tabs.Screen
        name="directory"
        options={{
          title: 'Faculty',
          tabBarIcon: ({ color, focused }) =>
            renderIcon(focused, color as string, 'people', 'people-outline'),
        }}
      />
      <Tabs.Screen
        name="services"
        options={{
          title: 'Services',
          tabBarIcon: ({ color, focused }) =>
            renderIcon(focused, color as string, 'grid', 'grid-outline'),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Account',
          tabBarIcon: ({ color, focused }) =>
            renderIcon(focused, color as string, 'person', 'person-outline'),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  iconWrap: {
    width: 44,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
