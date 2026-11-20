import React, { useEffect, useState } from 'react';
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
import { useAuth, type AuthStage } from '../../src/context/AuthContext';
import { validateRvceInstitutionalEmail } from '../../src/services/cognitoAuth';
import { Colors } from '../../src/theme/colors';
import { Radius, Spacing } from '../../src/theme/spacing';

export default function StaffSignInScreen() {
  const router = useRouter();
  const {
    signInWithPassword,
    signInWithOidcPkce,
    pendingEmail,
    sessionExpiredNotice,
    clearNotices,
    providerConfig,
  } = useAuth();

  const [email, setEmail] = useState(pendingEmail || '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [ssoSubmitting, setSsoSubmitting] = useState(false);
  const [cooldownSec, setCooldownSec] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (cooldownSec <= 0) return;
    const t = setTimeout(() => setCooldownSec((c) => Math.max(0, c - 1)), 1000);
    return () => clearTimeout(t);
  }, [cooldownSec]);

  const routeForStage = (stage: AuthStage, usedEmail: string) => {
    if (stage === 'EMAIL_VERIFICATION_REQUIRED') {
      router.push({ pathname: '/auth/verify-email', params: { email: usedEmail } });
    } else if (stage === 'MFA_REQUIRED') {
      router.push('/auth/mfa-challenge');
    } else {
      router.replace({ pathname: '/auth/transition', params: { stage } });
    }
  };

  const handlePasswordSignIn = async () => {
    if (submitting || cooldownSec > 0) return;
    clearNotices();
    setErrorMsg(null);

    const emailCheck = validateRvceInstitutionalEmail(email);
    if (!emailCheck.valid) {
      setErrorMsg(emailCheck.error || 'Enter a valid @rvce.edu.in email address.');
      return;
    }
    if (!password) {
      setErrorMsg('Please enter your password.');
      return;
    }

    setSubmitting(true);
    try {
      const nextStage = await signInWithPassword(emailCheck.normalized, password);
      setPassword('');
      routeForStage(nextStage, emailCheck.normalized);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Invalid institutional email or password.');
      setCooldownSec(3); // Rapid repeated submission guard
    } finally {
      setSubmitting(false);
    }
  };

  const handleOidcPkceSignIn = async () => {
    if (ssoSubmitting || submitting) return;
    clearNotices();
    setErrorMsg(null);
    setSsoSubmitting(true);
    try {
      const nextStage = await signInWithOidcPkce();
      routeForStage(nextStage, email.trim().toLowerCase());
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'OIDC sign-in did not complete.';
      if (!msg.toLowerCase().includes('cancel')) {
        setErrorMsg(msg);
      }
    } finally {
      setSsoSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <PortalBrandHeader
            title="Faculty & Staff Sign In"
            subtitle="Sign in with your verified @rvce.edu.in account to manage availability, profile details, and authorised campus operations."
            showBack
          />

          <View style={styles.publicNoticeBanner}>
            <Ionicons name="information-circle-outline" size={18} color={Colors.primary} />
            <Text style={styles.publicNoticeText}>
              Students, visitors, and guests do not need an account — all campus maps, search, and routing work without signing in.
            </Text>
          </View>

          {sessionExpiredNotice ? (
            <View style={styles.warningBox} accessibilityLiveRegion="polite">
              <Ionicons name="time-outline" size={17} color={Colors.warning} />
              <Text style={styles.warningText}>{sessionExpiredNotice}</Text>
            </View>
          ) : null}

          <View style={styles.card}>
            <Text style={styles.label}>Official RVCE Email</Text>
            <View style={styles.inputShell}>
              <Ionicons name="mail-outline" size={18} color={Colors.textMuted} />
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={(t) => {
                  setEmail(t);
                  if (errorMsg) setErrorMsg(null);
                }}
                placeholder="name@rvce.edu.in"
                placeholderTextColor={Colors.textMuted}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                editable={!submitting}
                accessibilityLabel="Official RVCE email address"
              />
            </View>

            <View style={styles.labelRow}>
              <Text style={styles.label}>Password</Text>
              <TouchableOpacity
                onPress={() =>
                  router.push({
                    pathname: '/auth/forgot-password',
                    params: { email: email.trim().toLowerCase() },
                  })
                }
                accessibilityRole="button"
                accessibilityLabel="Forgot password"
              >
                <Text style={styles.inlineLink}>Forgot password?</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.inputShell}>
              <Ionicons name="lock-closed-outline" size={18} color={Colors.textMuted} />
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={(t) => {
                  setPassword(t);
                  if (errorMsg) setErrorMsg(null);
                }}
                placeholder="Enter your password"
                placeholderTextColor={Colors.textMuted}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!submitting}
                accessibilityLabel="Password"
              />
              <TouchableOpacity
                onPress={() => setShowPassword((v) => !v)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
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

            {errorMsg ? (
              <View style={styles.errorBox} accessibilityLiveRegion="assertive">
                <Ionicons name="alert-circle" size={16} color={Colors.danger} />
                <Text style={styles.errorText}>{errorMsg}</Text>
              </View>
            ) : null}

            <TouchableOpacity
              style={[
                styles.primaryBtn,
                (submitting || cooldownSec > 0) && styles.primaryBtnDisabled,
              ]}
              onPress={handlePasswordSignIn}
              disabled={submitting || cooldownSec > 0}
              accessibilityRole="button"
              accessibilityLabel="Sign in to RVCE Staff Portal"
            >
              {submitting ? (
                <ActivityIndicator size="small" color={Colors.textInverse} />
              ) : (
                <>
                  <Ionicons name="log-in-outline" size={18} color={Colors.textInverse} />
                  <Text style={styles.primaryBtnText}>
                    {cooldownSec > 0 ? `Please wait (${cooldownSec}s)` : 'Sign In'}
                  </Text>
                </>
              )}
            </TouchableOpacity>

            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>OR OIDC + PKCE / PASSKEY</Text>
              <View style={styles.dividerLine} />
            </View>

            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={handleOidcPkceSignIn}
              disabled={ssoSubmitting || submitting}
              accessibilityRole="button"
              accessibilityLabel="Continue with Cognito OAuth PKCE or Passkey"
            >
              {ssoSubmitting ? (
                <ActivityIndicator size="small" color={Colors.primary} />
              ) : (
                <>
                  <Ionicons name="key-outline" size={17} color={Colors.primary} />
                  <Text style={styles.secondaryBtnText}>
                    Sign In via Cognito SSO / Passkey
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.footerCard}>
            <Text style={styles.footerPrompt}>New RVCE faculty or authorised staff member?</Text>
            <TouchableOpacity
              style={styles.registerLinkBtn}
              onPress={() => router.push('/auth/register')}
              accessibilityRole="button"
            >
              <Text style={styles.registerLinkText}>Register with @rvce.edu.in Email</Text>
              <Ionicons name="arrow-forward" size={15} color={Colors.primary} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.serverConfigRow}
            onPress={() => router.push('/modal/server-settings')}
          >
            <Ionicons name="server-outline" size={14} color={Colors.textMuted} />
            <Text style={styles.serverConfigText}>
              Identity Mode:{' '}
              {providerConfig?.provider_mode === 'AWS_COGNITO'
                ? 'Amazon Cognito User Pool (OIDC)'
                : 'Cognito OIDC Connected'}{' '}
              • Server Settings
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xxxl,
  },
  publicNoticeBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    backgroundColor: Colors.primaryLight,
    borderRadius: Radius.md,
    padding: 12,
    marginBottom: Spacing.md,
  },
  publicNoticeText: {
    flex: 1,
    fontSize: 12.5,
    lineHeight: 18,
    color: Colors.primaryDark,
    fontWeight: '500',
  },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.warningBg,
    borderRadius: Radius.md,
    padding: 12,
    marginBottom: Spacing.md,
  },
  warningText: {
    flex: 1,
    fontSize: 12.5,
    color: Colors.warning,
    fontWeight: '600',
  },
  card: {
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.md,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: Spacing.md,
    marginBottom: 6,
  },
  label: {
    fontSize: 12.5,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 6,
  },
  inlineLink: {
    fontSize: 12.5,
    fontWeight: '700',
    color: Colors.primary,
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
  input: {
    flex: 1,
    fontSize: 15,
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
  primaryBtnDisabled: {
    opacity: 0.65,
  },
  primaryBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textInverse,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginVertical: Spacing.lg,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.border,
  },
  dividerText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: Colors.textMuted,
    letterSpacing: 0.5,
  },
  secondaryBtn: {
    height: 46,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    backgroundColor: Colors.card,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  secondaryBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.primary,
  },
  footerCard: {
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    gap: 8,
  },
  footerPrompt: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  registerLinkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  registerLinkText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.primary,
  },
  serverConfigRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: Spacing.lg,
  },
  serverConfigText: {
    fontSize: 11.5,
    color: Colors.textMuted,
  },
});
