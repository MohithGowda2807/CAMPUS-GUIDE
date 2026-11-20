import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { PortalBrandHeader } from '../../src/components/PortalBrandHeader';
import { useAuth } from '../../src/context/AuthContext';
import { Colors } from '../../src/theme/colors';
import { Radius, Spacing } from '../../src/theme/spacing';

export default function VerifyEmailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();
  const {
    pendingEmail,
    devOtpHint,
    providerConfig,
    confirmEmailVerification,
    resendEmailVerification,
  } = useAuth();

  const targetEmail = (params.email || pendingEmail || '').trim().toLowerCase();
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(30);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  const handleConfirm = async () => {
    if (submitting) return;
    setErrorMsg(null);
    setInfoMsg(null);

    const cleanCode = code.trim();
    if (cleanCode.length < 6) {
      setErrorMsg('Enter the 6-digit verification code sent to your @rvce.edu.in inbox.');
      return;
    }

    setSubmitting(true);
    try {
      const nextStage = await confirmEmailVerification(targetEmail, cleanCode);
      if (nextStage === 'UNAUTHENTICATED') {
        router.replace('/auth/sign-in');
      } else if (nextStage === 'MFA_REQUIRED') {
        router.replace('/auth/mfa-challenge');
      } else {
        router.replace({ pathname: '/auth/transition', params: { stage: nextStage } });
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Invalid or expired verification code.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResend = async () => {
    if (resending || resendCooldown > 0) return;
    setResending(true);
    setErrorMsg(null);
    try {
      await resendEmailVerification(targetEmail);
      setInfoMsg('A fresh 6-digit verification code has been dispatched.');
      setResendCooldown(30);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to resend verification code.');
    } finally {
      setResending(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <PortalBrandHeader
          title="Verify Institutional Email"
          subtitle={`Enter the 6-digit verification code sent to ${targetEmail || 'your @rvce.edu.in email'}.`}
          showBack
        />

        {providerConfig?.provider_mode === 'DEV_OIDC_SANDBOX' && devOtpHint ? (
          <View style={styles.sandboxHintBox}>
            <Ionicons name="flask-outline" size={17} color={Colors.primary} />
            <Text style={styles.sandboxHintText}>
              Local Dev OIDC Sandbox Code: <Text style={styles.codeBold}>{devOtpHint}</Text>
            </Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.label}>6-Digit Email Verification Code</Text>
          <TextInput
            style={styles.otpInput}
            value={code}
            onChangeText={(t) => setCode(t.replace(/[^0-9]/g, '').slice(0, 6))}
            placeholder="000000"
            placeholderTextColor={Colors.textMuted}
            keyboardType="number-pad"
            maxLength={6}
            editable={!submitting}
            accessibilityLabel="6-digit email verification code"
          />

          {errorMsg ? (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={16} color={Colors.danger} />
              <Text style={styles.errorText}>{errorMsg}</Text>
            </View>
          ) : null}

          {infoMsg ? (
            <View style={styles.infoBox}>
              <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
              <Text style={styles.infoText}>{infoMsg}</Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={[styles.primaryBtn, submitting && styles.btnDisabled]}
            onPress={handleConfirm}
            disabled={submitting}
            accessibilityRole="button"
          >
            {submitting ? (
              <ActivityIndicator size="small" color={Colors.textInverse} />
            ) : (
              <Text style={styles.primaryBtnText}>Verify Email Ownership</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.resendBtn}
            onPress={handleResend}
            disabled={resending || resendCooldown > 0}
            accessibilityRole="button"
          >
            <Text style={styles.resendText}>
              {resendCooldown > 0
                ? `Resend code available in ${resendCooldown}s`
                : 'Resend 6-digit verification code'}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.background },
  scrollContent: { padding: Spacing.lg },
  sandboxHintBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.primaryLight,
    borderRadius: Radius.md,
    padding: 12,
    marginBottom: Spacing.md,
  },
  sandboxHintText: { fontSize: 13, color: Colors.primaryDark },
  codeBold: { fontWeight: '800', letterSpacing: 1.5 },
  card: {
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  label: {
    fontSize: 12.5,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 10,
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
  infoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: Spacing.md,
    padding: 11,
    borderRadius: Radius.md,
    backgroundColor: Colors.successBg,
  },
  infoText: { flex: 1, fontSize: 12.5, fontWeight: '600', color: Colors.success },
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
  resendBtn: { marginTop: Spacing.md, alignItems: 'center', paddingVertical: 8 },
  resendText: { fontSize: 13, fontWeight: '600', color: Colors.primary },
});
