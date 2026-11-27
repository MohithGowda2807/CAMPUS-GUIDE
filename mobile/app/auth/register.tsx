import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { PortalBrandHeader } from '../../src/components/PortalBrandHeader';
import { KeyboardSafeScrollView } from '../../src/components/KeyboardSafeScrollView';
import { useAuth } from '../../src/context/AuthContext';
import {
  validateRvceInstitutionalEmail,
  validateStrongPassword,
} from '../../src/services/cognitoAuth';
import { Colors } from '../../src/theme/colors';
import { Radius, Spacing } from '../../src/theme/spacing';

export default function StaffRegisterScreen() {
  const router = useRouter();
  const { registerStaffAccount } = useAuth();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const emailStatus = useMemo(() => validateRvceInstitutionalEmail(email), [email]);
  const pwStatus = useMemo(() => validateStrongPassword(password), [password]);

  const handleRegister = async () => {
    if (submitting) return;
    setErrorMsg(null);

    if (fullName.trim().length < 2) {
      setErrorMsg('Please enter your full official name.');
      return;
    }
    if (!emailStatus.valid) {
      setErrorMsg(emailStatus.error || 'Only @rvce.edu.in email addresses are permitted.');
      return;
    }
    if (!pwStatus.valid) {
      setErrorMsg(pwStatus.error || 'Password does not meet institutional security requirements.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg('Password confirmation does not match.');
      return;
    }
    if (!termsAccepted) {
      setErrorMsg('Please accept the RVCE Staff Portal privacy and account terms.');
      return;
    }

    setSubmitting(true);
    try {
      await registerStaffAccount({
        fullName: fullName.trim(),
        email: emailStatus.normalized,
        password,
        termsAccepted: true,
      });
      setPassword('');
      setConfirmPassword('');
      router.replace({
        pathname: '/auth/verify-email',
        params: { email: emailStatus.normalized },
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to submit registration.');
    } finally {
      setSubmitting(false);
    }
  };

  const renderRule = (ok: boolean, text: string) => (
    <View style={styles.ruleItem}>
      <Ionicons
        name={ok ? 'checkmark-circle' : 'ellipse-outline'}
        size={14}
        color={ok ? Colors.success : Colors.textMuted}
      />
      <Text style={[styles.ruleText, ok && styles.ruleTextOk]}>{text}</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <KeyboardSafeScrollView contentContainerStyle={styles.scrollContent}>
          <PortalBrandHeader
            title="Staff Portal Registration"
            subtitle="Register using your official @rvce.edu.in email address. Eligibility and institutional role are verified automatically after email confirmation."
            showBack
          />

          <View style={styles.card}>
            <Text style={styles.label}>Full Official Name</Text>
            <View style={styles.inputShell}>
              <Ionicons name="person-outline" size={18} color={Colors.textMuted} />
              <TextInput
                style={styles.input}
                value={fullName}
                onChangeText={setFullName}
                placeholder="e.g., Dr. Ananya Rao"
                placeholderTextColor={Colors.textMuted}
                autoCapitalize="words"
                editable={!submitting}
                accessibilityLabel="Full official name"
              />
            </View>

            <Text style={[styles.label, { marginTop: Spacing.md }]}>
              Official RVCE Email (@rvce.edu.in)
            </Text>
            <View
              style={[
                styles.inputShell,
                email.length > 3 && !emailStatus.valid && styles.inputShellInvalid,
              ]}
            >
              <Ionicons name="mail-outline" size={18} color={Colors.textMuted} />
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="faculty.name@rvce.edu.in"
                placeholderTextColor={Colors.textMuted}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                editable={!submitting}
                accessibilityLabel="Official rvce.edu.in email address"
              />
              {emailStatus.valid ? (
                <Ionicons name="checkmark-circle" size={18} color={Colors.success} />
              ) : null}
            </View>
            <Text style={styles.helperText}>
              Restricted strictly to @rvce.edu.in. Roles are assigned by backend eligibility verification and cannot be self-selected.
            </Text>

            <Text style={[styles.label, { marginTop: Spacing.md }]}>Password</Text>
            <View style={styles.inputShell}>
              <Ionicons name="lock-closed-outline" size={18} color={Colors.textMuted} />
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder="Create a strong password"
                placeholderTextColor={Colors.textMuted}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                editable={!submitting}
                accessibilityLabel="Create password"
              />
              <TouchableOpacity
                onPress={() => setShowPassword((v) => !v)}
                accessibilityRole="button"
                accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
              >
                <Ionicons
                  name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                  size={20}
                  color={Colors.textSecondary}
                />
              </TouchableOpacity>
            </View>

            <View style={styles.rulesGrid}>
              {renderRule(pwStatus.checks.minLength, '8+ characters')}
              {renderRule(pwStatus.checks.uppercase, 'Uppercase letter')}
              {renderRule(pwStatus.checks.lowercase, 'Lowercase letter')}
              {renderRule(pwStatus.checks.digit, 'Number (0-9)')}
              {renderRule(pwStatus.checks.symbol, 'Special symbol')}
            </View>

            <Text style={[styles.label, { marginTop: Spacing.md }]}>Confirm Password</Text>
            <View style={styles.inputShell}>
              <Ionicons name="shield-outline" size={18} color={Colors.textMuted} />
              <TextInput
                style={styles.input}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                placeholder="Re-enter password"
                placeholderTextColor={Colors.textMuted}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                editable={!submitting}
                accessibilityLabel="Confirm password"
              />
            </View>

            <TouchableOpacity
              style={styles.termsRow}
              onPress={() => setTermsAccepted((v) => !v)}
              activeOpacity={0.8}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: termsAccepted }}
            >
              <Ionicons
                name={termsAccepted ? 'checkbox' : 'square-outline'}
                size={22}
                color={termsAccepted ? Colors.primary : Colors.textMuted}
              />
              <Text style={styles.termsText}>
                I confirm that I am an authorised RVCE faculty or staff member and agree to the institutional account security and data protection policy.
              </Text>
            </TouchableOpacity>

            {errorMsg ? (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={16} color={Colors.danger} />
                <Text style={styles.errorText}>{errorMsg}</Text>
              </View>
            ) : null}

            <TouchableOpacity
              style={[styles.primaryBtn, submitting && styles.btnDisabled]}
              onPress={handleRegister}
              disabled={submitting}
              accessibilityRole="button"
            >
              {submitting ? (
                <ActivityIndicator size="small" color={Colors.textInverse} />
              ) : (
                <>
                  <Text style={styles.primaryBtnText}>Verify Email & Submit Registration</Text>
                  <Ionicons name="arrow-forward" size={17} color={Colors.textInverse} />
                </>
              )}
            </TouchableOpacity>
          </View>
      </KeyboardSafeScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.background },
  scrollContent: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xxxl,
  },
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
    marginBottom: 6,
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
  inputShellInvalid: {
    borderColor: Colors.danger,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: Colors.textPrimary,
  },
  helperText: {
    fontSize: 11.5,
    lineHeight: 16,
    color: Colors.textSecondary,
    marginTop: 6,
  },
  rulesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 10,
  },
  ruleItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  ruleText: {
    fontSize: 11.5,
    color: Colors.textMuted,
  },
  ruleTextOk: {
    color: Colors.success,
    fontWeight: '600',
  },
  termsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: Spacing.lg,
  },
  termsText: {
    flex: 1,
    fontSize: 12.5,
    lineHeight: 18,
    color: Colors.textSecondary,
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
  errorText: {
    flex: 1,
    fontSize: 12.5,
    fontWeight: '600',
    color: Colors.danger,
  },
  primaryBtn: {
    marginTop: Spacing.lg,
    height: 48,
    borderRadius: Radius.md,
    backgroundColor: Colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  btnDisabled: { opacity: 0.65 },
  primaryBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textInverse,
  },
});
