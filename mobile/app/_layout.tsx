import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import { CampusDataProvider } from '../src/context/CampusDataContext';
import { AuthProvider } from '../src/context/AuthContext';
import { ThemeProvider } from '../src/context/ThemeContext';
import { Colors } from '../src/theme/colors';

// Prevent splash screen from auto-hiding until ready
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  useEffect(() => {
    // Hide splash screen smoothly after mount
    const timer = setTimeout(() => {
      SplashScreen.hideAsync().catch(() => {});
    }, 600);
    return () => clearTimeout(timer);
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: Colors.background }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <AuthProvider>
            <CampusDataProvider>
              <StatusBar style="dark" />
            <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="auth/sign-in" options={{ headerShown: false }} />
              <Stack.Screen name="auth/register" options={{ headerShown: false }} />
              <Stack.Screen name="auth/verify-email" options={{ headerShown: false }} />
              <Stack.Screen name="auth/forgot-password" options={{ headerShown: false }} />
              <Stack.Screen name="auth/reset-password" options={{ headerShown: false }} />
              <Stack.Screen name="auth/mfa-challenge" options={{ headerShown: false }} />
              <Stack.Screen name="auth/pending-approval" options={{ headerShown: false }} />
              <Stack.Screen name="auth/rejected" options={{ headerShown: false }} />
              <Stack.Screen
                name="auth/transition"
                options={{ headerShown: false, animation: 'fade' }}
              />
              <Stack.Screen name="staff/profile-edit" options={{ headerShown: false }} />
              <Stack.Screen name="staff/availability" options={{ headerShown: false }} />
              <Stack.Screen name="staff/security" options={{ headerShown: false }} />
              <Stack.Screen name="staff/admin-approvals" options={{ headerShown: false }} />
              <Stack.Screen
                name="modal/server-settings"
                options={{
                  presentation: 'modal',
                  animation: 'slide_from_bottom',
                }}
              />
              </Stack>
            </CampusDataProvider>
          </AuthProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
