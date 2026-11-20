import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { PortalBrandHeader } from '../../src/components/PortalBrandHeader';
import { useAuth } from '../../src/context/AuthContext';
import { Colors } from '../../src/theme/colors';
import { Radius, Spacing } from '../../src/theme/spacing';

export default function RejectedOrSuspendedScreen() {
  const router = useRouter();
  const { onboardingStatus, statusReason, pendingEmail, logout } = useAuth();

  const handleSignOut = async () => {
    await logout();
    router.replace('/(tabs)/map');
  };

  const titleLabel =
    onboardingStatus === 'SUSPENDED'
      ? 'Account Access Suspended'
      : onboardingStatus === 'REVOKED'
      ? 'Account Access Revoked'
      : 'Staff Eligibility Not Approved';

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <PortalBrandHeader
          title={titleLabel}
          subtitle="This account is not currently authorised to access restricted RVCE Faculty & Staff Portal features."
        />

        <View style={styles.card}>
          <View style={styles.iconCircle}>
            <Ionicons name="close-circle-outline" size={32} color={Colors.danger} />
          </View>

          <Text style={styles.accountText}>{pendingEmail || 'Institutional Account'}</Text>
          <View style={styles.statusChip}>
            <Text style={styles.statusChipText}>{onboardingStatus || 'REJECTED'}</Text>
          </View>

          <Text style={styles.bodyText}>
            {statusReason ||
              'Access to the RVCE Staff Portal is restricted to verified teaching faculty and authorised campus administration personnel.'}
          </Text>

          <View style={styles.helpBox}>
            <Ionicons name="call-outline" size={16} color={Colors.primary} />
            <Text style={styles.helpText}>
              If you believe this is an error, please contact your Department Office or the RVCE Campus Portal Administrator with your official Employee Code.
            </Text>
          </View>

          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => router.replace('/(tabs)/map')}
            accessibilityRole="button"
          >
            <Ionicons name="compass-outline" size={18} color={Colors.textInverse} />
            <Text style={styles.primaryBtnText}>Return to Public Campus Navigation</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut}>
            <Text style={styles.signOutText}>Sign Out & Clear Local Credentials</Text>
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
    alignItems: 'center',
  },
  iconCircle: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: Colors.dangerBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  accountText: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary, marginBottom: 6 },
  statusChip: {
    backgroundColor: Colors.dangerBg,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.full,
    marginBottom: 12,
  },
  statusChipText: { fontSize: 11, fontWeight: '800', color: Colors.danger },
  bodyText: {
    fontSize: 13.5,
    lineHeight: 20,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  helpBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: Colors.primaryLight,
    borderRadius: Radius.md,
    padding: 12,
    marginTop: Spacing.lg,
  },
  helpText: { flex: 1, fontSize: 12.5, lineHeight: 18, color: Colors.primaryDark },
  primaryBtn: {
    marginTop: Spacing.lg,
    width: '100%',
    height: 46,
    borderRadius: Radius.md,
    backgroundColor: Colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryBtnText: { fontSize: 14.5, fontWeight: '700', color: Colors.textInverse },
  signOutBtn: { marginTop: Spacing.md, paddingVertical: 8 },
  signOutText: { fontSize: 13, fontWeight: '700', color: Colors.danger },
});
