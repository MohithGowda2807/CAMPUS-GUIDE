import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { PortalBrandHeader } from '../../src/components/PortalBrandHeader';
import { useAuth } from '../../src/context/AuthContext';
import { Colors } from '../../src/theme/colors';
import { Radius, Spacing } from '../../src/theme/spacing';

export default function PendingApprovalScreen() {
  const router = useRouter();
  const { pendingEmail, refreshSessionState, logout } = useAuth();
  const [checking, setChecking] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const handleCheckStatus = async () => {
    if (checking) return;
    setChecking(true);
    setFeedback(null);
    try {
      const stage = await refreshSessionState();
      if (stage === 'AUTHENTICATED') {
        router.replace('/(tabs)/profile');
      } else if (stage === 'REJECTED_OR_SUSPENDED') {
        router.replace('/auth/rejected');
      } else {
        setFeedback('Your registration is still awaiting institutional administrator review.');
      }
    } catch {
      setFeedback('Unable to check status right now. Please try again shortly.');
    } finally {
      setChecking(false);
    }
  };

  const handleSignOut = async () => {
    await logout();
    router.replace('/(tabs)/map');
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <PortalBrandHeader
          title="Pending Eligibility Approval"
          subtitle="Your @rvce.edu.in email ownership has been verified. Institutional staff access requires administrator eligibility confirmation."
        />

        <View style={styles.card}>
          <View style={styles.statusIconCircle}>
            <Ionicons name="hourglass-outline" size={30} color={Colors.warning} />
          </View>

          <Text style={styles.cardTitle}>Verification Under Review</Text>
          <Text style={styles.cardBody}>
            Account <Text style={styles.bold}>{pendingEmail || '@rvce.edu.in'}</Text> is currently held in{' '}
            <Text style={styles.bold}>PENDING APPROVAL</Text>. Because owning an institutional email address alone does not grant faculty portal privileges, an RVCE Portal Administrator must link your identity to an authorised staff roster entry.
          </Text>

          <View style={styles.stepBox}>
            <View style={styles.stepRow}>
              <Ionicons name="checkmark-circle" size={17} color={Colors.success} />
              <Text style={styles.stepText}>1. @rvce.edu.in email ownership verified</Text>
            </View>
            <View style={styles.stepRow}>
              <Ionicons name="time" size={17} color={Colors.warning} />
              <Text style={styles.stepText}>
                2. Awaiting RVCE Administrator roster & role verification
              </Text>
            </View>
          </View>

          {feedback ? <Text style={styles.feedbackText}>{feedback}</Text> : null}

          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={handleCheckStatus}
            disabled={checking}
            accessibilityRole="button"
          >
            {checking ? (
              <ActivityIndicator size="small" color={Colors.textInverse} />
            ) : (
              <>
                <Ionicons name="refresh" size={17} color={Colors.textInverse} />
                <Text style={styles.primaryBtnText}>Refresh Approval Status</Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => router.replace('/(tabs)/map')}
            accessibilityRole="button"
          >
            <Ionicons name="map-outline" size={17} color={Colors.primary} />
            <Text style={styles.secondaryBtnText}>Continue Using Public Campus Map</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut}>
            <Text style={styles.signOutText}>Sign Out of Pending Account</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.background },
  scrollContent: { padding: Spacing.lg },
  card: {
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  statusIconCircle: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: Colors.warningBg,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: Spacing.md,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.textPrimary,
    textAlign: 'center',
    marginBottom: 8,
  },
  cardBody: {
    fontSize: 13.5,
    lineHeight: 20,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  bold: { fontWeight: '700', color: Colors.textPrimary },
  stepBox: {
    backgroundColor: Colors.background,
    borderRadius: Radius.md,
    padding: 12,
    gap: 8,
    marginTop: Spacing.lg,
  },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepText: { fontSize: 12.5, fontWeight: '600', color: Colors.textPrimary },
  feedbackText: {
    marginTop: Spacing.md,
    fontSize: 12.5,
    fontWeight: '600',
    color: Colors.primary,
    textAlign: 'center',
  },
  primaryBtn: {
    marginTop: Spacing.lg,
    height: 46,
    borderRadius: Radius.md,
    backgroundColor: Colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryBtnText: { fontSize: 14.5, fontWeight: '700', color: Colors.textInverse },
  secondaryBtn: {
    marginTop: 10,
    height: 46,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  secondaryBtnText: { fontSize: 14, fontWeight: '700', color: Colors.primary },
  signOutBtn: { marginTop: Spacing.md, alignItems: 'center', paddingVertical: 8 },
  signOutText: { fontSize: 13, fontWeight: '600', color: Colors.danger },
});
