import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Linking,
  Share,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { PortalBrandHeader } from '../../src/components/PortalBrandHeader';
import { KeyboardSafeScrollView } from '../../src/components/KeyboardSafeScrollView';
import { useAuth } from '../../src/context/AuthContext';
import { Colors } from '../../src/theme/colors';
import { Radius, Spacing } from '../../src/theme/spacing';

export default function MfaChallengeScreen() {
  const router = useRouter();
  const { verifyMfaCode, pendingEmail, mfaChallengeType, mfaSetupDetails } = useAuth();

  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isFirstTimeSetup = mfaChallengeType === 'MFA_SETUP' && Boolean(mfaSetupDetails?.secretCode);

  const formattedSecret = useMemo(() => {
    const raw = mfaSetupDetails?.secretCode || '';
    return raw.replace(/(.{4})/g, '$1 ').trim();
  }, [mfaSetupDetails?.secretCode]);

  const handleOpenAuthenticatorApp = async () => {
    const uri = mfaSetupDetails?.otpauthUri;
    if (!uri) return;
    try {
      const supported = await Linking.canOpenURL(uri);
      if (supported) {
        await Linking.openURL(uri);
      } else {
        Alert.alert(
          'Manual Key Entry',
          'Open Google Authenticator, Microsoft Authenticator, or Authy, tap "+" -> "Enter a setup key", and paste the Setup Key shown on screen.'
        );
      }
    } catch {
      Alert.alert(
        'Manual Key Entry',
        'Open your Authenticator app, tap "+" -> "Enter a setup key", and enter the Setup Key shown below.'
      );
    }
  };

  const handleShareOrCopySecret = async () => {
    if (!mfaSetupDetails?.secretCode) return;
    try {
      await Share.share({
        message: mfaSetupDetails.secretCode,
        title: 'RVCE Authenticator Setup Key',
      });
    } catch {
      // Ignore share cancellation
    }
  };

  const handleVerifyMfa = async () => {
    if (submitting) return;
    setErrorMsg(null);

    if (code.trim().length !== 6) {
      setErrorMsg('Enter the 6-digit code from your authenticator app.');
      return;
    }

    setSubmitting(true);
    try {
      const stage = await verifyMfaCode(code.trim());
      router.replace({ pathname: '/auth/transition', params: { stage } });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Invalid authenticator code.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <KeyboardSafeScrollView contentContainerStyle={styles.scrollContent}>
        <PortalBrandHeader
          title={
            isFirstTimeSetup
              ? 'Configure Authenticator (1st Login)'
              : 'Authenticator Verification'
          }
          subtitle={
            isFirstTimeSetup
              ? `Mandatory RVCE Security: Set up Google Authenticator, Microsoft Authenticator, or Authy for ${pendingEmail || 'your @rvce.edu.in account'} to complete your first sign-in.`
              : `Open your Authenticator app for ${pendingEmail || 'your @rvce.edu.in account'} and enter the current 6-digit verification code.`
          }
          showBack
        />

        {isFirstTimeSetup && mfaSetupDetails ? (
          <View style={styles.setupCard}>
            <View style={styles.stepHeaderRow}>
              <View style={styles.stepBadge}>
                <Text style={styles.stepBadgeText}>STEP 1</Text>
              </View>
              <Text style={styles.stepTitle}>Add to Your Authenticator App</Text>
            </View>

            <Text style={styles.setupDesc}>
              Tap the button below to add this account automatically, or copy the Setup Key into
              Google Authenticator / Microsoft Authenticator (choose{' '}
              <Text style={styles.boldText}>Time-based / TOTP</Text>):
            </Text>

            <TouchableOpacity
              style={styles.openAppBtn}
              onPress={handleOpenAuthenticatorApp}
              activeOpacity={0.82}
              accessibilityRole="button"
              accessibilityLabel="Open Authenticator app automatically"
            >
              <Ionicons name="open-outline" size={18} color={Colors.primary} />
              <Text style={styles.openAppBtnText}>Open in Authenticator App (1-Tap)</Text>
            </TouchableOpacity>

            <Text style={styles.keyLabel}>Manual Setup Key (Long-press or tap Copy):</Text>
            <View style={styles.secretBox}>
              <Text style={styles.secretText} selectable>
                {formattedSecret}
              </Text>
              <TouchableOpacity
                style={styles.copyChip}
                onPress={handleShareOrCopySecret}
                accessibilityRole="button"
                accessibilityLabel="Copy or share setup key"
              >
                <Ionicons name="copy-outline" size={15} color={Colors.primary} />
                <Text style={styles.copyChipText}>Copy Key</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.metaHintRow}>
              <Ionicons name="information-circle-outline" size={15} color={Colors.textSecondary} />
              <Text style={styles.metaHintText}>
                Account: {pendingEmail || 'staff@rvce.edu.in'} • 6 digits • 30s interval
              </Text>
            </View>
          </View>
        ) : null}

        <View style={styles.card}>
          {isFirstTimeSetup ? (
            <View style={styles.stepHeaderRow}>
              <View style={styles.stepBadge}>
                <Text style={styles.stepBadgeText}>STEP 2</Text>
              </View>
              <Text style={styles.stepTitle}>Verify 6-Digit Authenticator Code</Text>
            </View>
          ) : (
            <View style={styles.iconWrap}>
              <Ionicons name="shield-checkmark" size={28} color={Colors.primary} />
            </View>
          )}

          <Text style={styles.label}>
            {isFirstTimeSetup
              ? 'Enter the 6-digit code shown in your Authenticator app'
              : 'Authenticator App 6-Digit Code'}
          </Text>
          <TextInput
            style={styles.otpInput}
            value={code}
            onChangeText={(t) => setCode(t.replace(/[^0-9]/g, '').slice(0, 6))}
            placeholder="000000"
            placeholderTextColor={Colors.textMuted}
            keyboardType="number-pad"
            maxLength={6}
            editable={!submitting}
            accessibilityLabel="6-digit TOTP MFA verification code"
          />

          {errorMsg ? (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={16} color={Colors.danger} />
              <Text style={styles.errorText}>{errorMsg}</Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={[styles.primaryBtn, submitting && styles.btnDisabled]}
            onPress={handleVerifyMfa}
            disabled={submitting}
            accessibilityRole="button"
          >
            {submitting ? (
              <ActivityIndicator size="small" color={Colors.textInverse} />
            ) : (
              <Text style={styles.primaryBtnText}>
                {isFirstTimeSetup ? 'Activate Authenticator & Sign In' : 'Verify & Sign In'}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardSafeScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.background },
  scrollContent: { padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  setupCard: {
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.md,
  },
  stepHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  stepBadge: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.sm,
  },
  stepBadgeText: {
    color: '#FFFFFF',
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  stepTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  setupDesc: {
    fontSize: 13,
    lineHeight: 19,
    color: Colors.textSecondary,
    marginBottom: 12,
  },
  boldText: {
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  openAppBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primaryLight,
    borderWidth: 1,
    borderColor: '#BFDBFE',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: Radius.md,
    marginBottom: 14,
  },
  openAppBtnText: {
    fontSize: 13.5,
    fontWeight: '800',
    color: Colors.primary,
  },
  keyLabel: {
    fontSize: 11.5,
    fontWeight: '700',
    color: Colors.textSecondary,
    marginBottom: 6,
  },
  secretBox: {
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Colors.primary,
    borderRadius: Radius.md,
    padding: 12,
    alignItems: 'center',
    gap: 10,
  },
  secretText: {
    fontSize: 15,
    fontWeight: '800',
    color: Colors.primaryDark,
    letterSpacing: 1.5,
    textAlign: 'center',
  },
  copyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.full,
  },
  copyChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.primary,
  },
  metaHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
  },
  metaHintText: {
    fontSize: 11.5,
    color: Colors.textSecondary,
  },
  card: {
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: Spacing.md,
  },
  label: {
    fontSize: 12.5,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 10,
    textAlign: 'center',
  },
  otpInput: {
    height: 56,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    backgroundColor: Colors.background,
    textAlign: 'center',
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: 8,
    color: Colors.textPrimary,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: Spacing.md,
    padding: 11,
    borderRadius: Radius.md,
    backgroundColor: Colors.dangerBg,
  },
  errorText: { flex: 1, fontSize: 12.5, fontWeight: '600', color: Colors.danger },
  primaryBtn: {
    marginTop: Spacing.lg,
    height: 48,
    borderRadius: Radius.md,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnDisabled: { opacity: 0.65 },
  primaryBtnText: { fontSize: 15, fontWeight: '700', color: Colors.textInverse },
});
