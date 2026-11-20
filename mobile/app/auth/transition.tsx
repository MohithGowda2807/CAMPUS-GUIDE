import React, { useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../src/context/AuthContext';
import { Colors } from '../../src/theme/colors';
import { Radius, Spacing } from '../../src/theme/spacing';

export default function AuthTransitionScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ stage?: string }>();
  const { authStage, user } = useAuth();

  const targetStage = params.stage || authStage;

  useEffect(() => {
    const timer = setTimeout(() => {
      if (targetStage === 'AUTHENTICATED' || authStage === 'AUTHENTICATED') {
        router.replace('/(tabs)/profile');
      } else if (targetStage === 'PENDING_APPROVAL' || authStage === 'PENDING_APPROVAL') {
        router.replace('/auth/pending-approval');
      } else if (
        targetStage === 'REJECTED_OR_SUSPENDED' ||
        authStage === 'REJECTED_OR_SUSPENDED'
      ) {
        router.replace('/auth/rejected');
      } else {
        router.replace('/(tabs)/profile');
      }
    }, 650);
    return () => clearTimeout(timer);
  }, [targetStage, authStage, router]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.card}>
        <View style={styles.logoFrame}>
          <Image
            source={require('../../assets/icon.png')}
            style={styles.logo}
            contentFit="contain"
          />
        </View>

        <View style={styles.checkBadge}>
          <Ionicons name="shield-checkmark" size={20} color={Colors.success} />
          <Text style={styles.checkBadgeText}>Identity Verified via OIDC</Text>
        </View>

        <Text style={styles.title}>
          {user?.staff_name || user?.full_name
            ? `Welcome, ${user.staff_name || user.full_name}`
            : 'Completing Institutional Check'}
        </Text>
        <Text style={styles.subtitle}>
          Synchronizing RVCE staff eligibility and role permissions...
        </Text>

        <ActivityIndicator
          size="small"
          color={Colors.primary}
          style={{ marginTop: Spacing.lg }}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
  },
  card: {
    width: '100%',
    backgroundColor: Colors.card,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    alignItems: 'center',
  },
  logoFrame: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  logo: { width: 52, height: 52 },
  checkBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.successBg,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: Radius.full,
    marginBottom: 12,
  },
  checkBadgeText: { fontSize: 12, fontWeight: '700', color: Colors.success },
  title: {
    fontSize: 19,
    fontWeight: '800',
    color: Colors.textPrimary,
    textAlign: 'center',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 19,
  },
});
