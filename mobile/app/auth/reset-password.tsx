import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { PortalBrandHeader } from '../../src/components/PortalBrandHeader';
import { KeyboardSafeScrollView } from '../../src/components/KeyboardSafeScrollView';
import { useAuth } from '../../src/context/AuthContext';
import { validateStrongPassword } from '../../src/services/cognitoAuth';
import { Colors } from '../../src/theme/colors';
import { Radius, Spacing } from '../../src/theme/spacing';

export default function ResetPasswordScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();
  const { pendingEmail, devOtpHint, providerConfig, confirmPasswordReset } = useAuth();

  const targetEmail = (params.email || pendingEmail || '').trim().toLowerCase();
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleReset = async () => {
    if (submitting) return;
    setErrorMsg(null);

    if (code.trim().length < 6) {
      setErrorMsg('Enter the 6-digit recovery code sent to your email.');
      return;
    }
    const pwCheck = validateStrongPassword(newPassword);
    if (!pwCheck.valid) {
      setErrorMsg(pwCheck.error || 'Password does not meet security policy.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMsg('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      await confirmPasswordReset(targetEmail, code.trim(), newPassword);
      setNewPassword('');
      setConfirmPassword('');
      Alert.alert(
        'Password Updated',
        'Your institutional account password has been reset and previous sessions were revoked. Please sign in with your new password.',
        [{ text: 'Sign In', onPress: () => router.replace('/auth/sign-in') }]
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Invalid or expired recovery code.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <KeyboardSafeScrollView contentContainerStyle={styles.scrollContent}>
        <PortalBrandHeader
          title="Set New Password"
          subtitle={`Enter the 6-digit recovery code sent to ${targetEmail || 'your @rvce.edu.in inbox'} and choose a new password.`}
          showBack
        />

        {providerConfig?.provider_mode === 'DEV_OIDC_SANDBOX' && devOtpHint ? (
          <View style={styles.sandboxHintBox}>
            <Ionicons name="flask-outline" size={17} color={Colors.primary} />
            <Text style={styles.sandboxHintText}>
              Local Dev Recovery Code: <Text style={styles.codeBold}>{devOtpHint}</Text>
            </Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.label}>6-Digit Recovery Code</Text>
          <TextInput
            style={styles.otpInput}
            value={code}
            onChangeText={(t) => setCode(t.replace(/[^0-9]/g, '').slice(0, 6))}
            placeholder="000000"
            placeholderTextColor={Colors.textMuted}
            keyboardType="number-pad"
            maxLength={6}
            editable={!submitting}
            accessibilityLabel="6-digit recovery code"
          />

          <Text style={[styles.label, { marginTop: Spacing.md }]}>New Password</Text>
          <View style={styles.inputShell}>
            <Ionicons name="lock-closed-outline" size={18} color={Colors.textMuted} />
            <TextInput
              style={styles.input}
              value={newPassword}
              onChangeText={setNewPassword}
              placeholder="At least 8 chars, upper, lower, digit, symbol"
              placeholderTextColor={Colors.textMuted}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              editable={!submitting}
              accessibilityLabel="New password"
            />
            <TouchableOpacity onPress={() => setShowPassword((v) => !v)}>
              <Ionicons
                name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                size={20}
                color={Colors.textSecondary}
              />
            </TouchableOpacity>
          </View>

          <Text style={[styles.label, { marginTop: Spacing.md }]}>Confirm New Password</Text>
          <View style={styles.inputShell}>
            <Ionicons name="shield-checkmark-outline" size={18} color={Colors.textMuted} />
            <TextInput
              style={styles.input}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="Re-enter new password"
              placeholderTextColor={Colors.textMuted}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              editable={!submitting}
              accessibilityLabel="Confirm new password"
            />
          </View>

          {errorMsg ? (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={16} color={Colors.danger} />
              <Text style={styles.errorText}>{errorMsg}</Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={[styles.primaryBtn, submitting && styles.btnDisabled]}
            onPress={handleReset}
            disabled={submitting}
            accessibilityRole="button"
          >
            {submitting ? (
              <ActivityIndicator size="small" color={Colors.textInverse} />
            ) : (
              <Text style={styles.primaryBtnText}>Reset Password</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardSafeScrollView>
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
  label: { fontSize: 12.5, fontWeight: '700', color: Colors.textPrimary, marginBottom: 6 },
  otpInput: {
    height: 52,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    backgroundColor: Colors.background,
    textAlign: 'center',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 6,
    color: Colors.textPrimary,
  },
  inputShell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: 12,
    height: 48,
    backgroundColor: Colors.background,
  },
  input: { flex: 1, fontSize: 15, color: Colors.textPrimary },
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
