import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { PortalBrandHeader } from '../../src/components/PortalBrandHeader';
import { KeyboardSafeScrollView } from '../../src/components/KeyboardSafeScrollView';
import { useAuth } from '../../src/context/AuthContext';
import { campusApi, getApiBaseUrl } from '../../src/services/api';
import { cognitoClient } from '../../src/services/cognitoAuth';
import { Colors } from '../../src/theme/colors';
import { Radius, Spacing } from '../../src/theme/spacing';

export default function AccountSecurityScreen() {
  const router = useRouter();
  const { user, refreshMe, logout, logoutAllSessions } = useAuth();

  const [enrollingTotp, setEnrollingTotp] = useState(false);
  const [totpSecret, setTotpSecret] = useState<string | null>(null);
  const [otpauthUri, setOtpauthUri] = useState<string | null>(null);
  const [verifyCode, setVerifyCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [mfaMsg, setMfaMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleStartTotpSetup = async () => {
    setEnrollingTotp(true);
    setErrorMsg(null);
    setMfaMsg(null);
    try {
      const res = await cognitoClient.beginTotpEnrolment(getApiBaseUrl());
      setTotpSecret(res.secretCode);
      setOtpauthUri(res.otpauthUri);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to start authenticator enrolment.');
    } finally {
      setEnrollingTotp(false);
    }
  };

  const handleConfirmTotpSetup = async () => {
    if (verifyCode.trim().length !== 6) {
      setErrorMsg('Enter the 6-digit code displayed in your authenticator app.');
      return;
    }
    setVerifying(true);
    setErrorMsg(null);
    try {
      await cognitoClient.verifyTotpEnrolment(getApiBaseUrl(), verifyCode.trim());
      await campusApi.syncMfaEnabled();
      setTotpSecret(null);
      setOtpauthUri(null);
      setVerifyCode('');
      setMfaMsg('TOTP Authenticator MFA is now active on your RVCE account.');
      await refreshMe();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Invalid 6-digit authenticator code.');
    } finally {
      setVerifying(false);
    }
  };

  const handleGlobalSignOut = () => {
    Alert.alert(
      'Sign Out From All Devices',
      'This will revoke refresh tokens in Cognito and invalidate all active sessions across every device immediately.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out Everywhere',
          style: 'destructive',
          onPress: async () => {
            await logoutAllSessions();
            router.replace('/(tabs)/map');
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <KeyboardSafeScrollView contentContainerStyle={styles.scrollContent}>
        <PortalBrandHeader
          title="Account Security"
          subtitle="Manage TOTP Authenticator MFA, password recovery, and active institutional sessions."
          showBack
          showPublicMapAction={false}
        />

        <View style={styles.card}>
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Authenticator App (TOTP MFA)</Text>
              <Text style={styles.cardSub}>
                Protects your @rvce.edu.in account using free time-based 6-digit codes (no SMS charges).
              </Text>
            </View>
            <View
              style={[
                styles.badge,
                { backgroundColor: user?.mfa_enabled ? Colors.successBg : Colors.warningBg },
              ]}
            >
              <Text
                style={[
                  styles.badgeText,
                  { color: user?.mfa_enabled ? Colors.success : Colors.warning },
                ]}
              >
                {user?.mfa_enabled ? 'ENABLED' : 'OPTIONAL'}
              </Text>
            </View>
          </View>

          {!totpSecret ? (
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={handleStartTotpSetup}
              disabled={enrollingTotp}
            >
              {enrollingTotp ? (
                <ActivityIndicator size="small" color={Colors.primary} />
              ) : (
                <>
                  <Ionicons name="qr-code-outline" size={17} color={Colors.primary} />
                  <Text style={styles.secondaryBtnText}>
                    {user?.mfa_enabled
                      ? 'Re-configure Authenticator App'
                      : 'Set Up Authenticator App (TOTP)'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          ) : (
            <View style={styles.enrolBox}>
              <Text style={styles.enrolStep}>
                1. Copy this Setup Key into Google Authenticator, Microsoft Authenticator, or Authy:
              </Text>
              <Text selectable style={styles.secretBox}>
                {totpSecret}
              </Text>

              {otpauthUri ? (
                <TouchableOpacity
                  style={styles.openAuthBtn}
                  onPress={() => Linking.openURL(otpauthUri).catch(() => {})}
                >
                  <Ionicons name="open-outline" size={15} color={Colors.primary} />
                  <Text style={styles.openAuthText}>Open Installed Authenticator App</Text>
                </TouchableOpacity>
              ) : null}

              <Text style={[styles.enrolStep, { marginTop: 12 }]}>
                2. Enter the 6-digit code generated by your app:
              </Text>
              <TextInput
                style={styles.otpInput}
                value={verifyCode}
                onChangeText={(t) => setVerifyCode(t.replace(/[^0-9]/g, '').slice(0, 6))}
                placeholder="000000"
                placeholderTextColor={Colors.textMuted}
                keyboardType="number-pad"
                maxLength={6}
              />

              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={handleConfirmTotpSetup}
                disabled={verifying}
              >
                {verifying ? (
                  <ActivityIndicator size="small" color={Colors.textInverse} />
                ) : (
                  <Text style={styles.primaryBtnText}>Verify & Activate MFA</Text>
                )}
              </TouchableOpacity>
            </View>
          )}

          {mfaMsg ? <Text style={styles.successText}>{mfaMsg}</Text> : null}
          {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Credentials & Sessions</Text>
          <Text style={styles.cardSub}>
            Signed in as {user?.email} • External Identity Provider: Amazon Cognito OIDC (Zero passwords stored in RVCE DB)
          </Text>

          <TouchableOpacity
            style={[styles.secondaryBtn, { marginTop: Spacing.md }]}
            onPress={() =>
              router.push({
                pathname: '/auth/forgot-password',
                params: { email: user?.email || '' },
              })
            }
          >
            <Ionicons name="key-outline" size={17} color={Colors.primary} />
            <Text style={styles.secondaryBtnText}>Change / Reset Password via Email Code</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.signOutBtn}
            onPress={async () => {
              await logout();
              router.replace('/(tabs)/map');
            }}
          >
            <Ionicons name="log-out-outline" size={18} color={Colors.danger} />
            <Text style={styles.signOutText}>Sign Out (This Device)</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.dangerBtn} onPress={handleGlobalSignOut}>
            <Ionicons name="shield-outline" size={18} color={Colors.textInverse} />
            <Text style={styles.dangerBtnText}>Sign Out From All Sessions</Text>
          </TouchableOpacity>
        </View>
      </KeyboardSafeScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.background },
  scrollContent: { padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  card: {
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.md,
  },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 14 },
  cardTitle: { fontSize: 16, fontWeight: '800', color: Colors.textPrimary, marginBottom: 4 },
  cardSub: { fontSize: 12.5, lineHeight: 18, color: Colors.textSecondary },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.full },
  badgeText: { fontSize: 11, fontWeight: '800' },
  enrolBox: {
    marginTop: 8,
    padding: 12,
    borderRadius: Radius.md,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  enrolStep: { fontSize: 12.5, fontWeight: '600', color: Colors.textPrimary, marginBottom: 8 },
  secretBox: {
    fontFamily: 'monospace',
    fontSize: 14,
    fontWeight: '700',
    color: Colors.primaryDark,
    backgroundColor: Colors.primaryLight,
    padding: 10,
    borderRadius: Radius.sm,
    textAlign: 'center',
  },
  openAuthBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 10,
  },
  openAuthText: { fontSize: 13, fontWeight: '700', color: Colors.primary },
  otpInput: {
    height: 48,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    backgroundColor: Colors.card,
    textAlign: 'center',
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 6,
    color: Colors.textPrimary,
  },
  primaryBtn: {
    marginTop: 12,
    height: 46,
    borderRadius: Radius.md,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: { fontSize: 14.5, fontWeight: '700', color: Colors.textInverse },
  secondaryBtn: {
    height: 45,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  secondaryBtnText: { fontSize: 13.5, fontWeight: '700', color: Colors.primary },
  signOutBtn: {
    marginTop: 12,
    height: 45,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.danger,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  signOutText: { fontSize: 14, fontWeight: '700', color: Colors.danger },
  dangerBtn: {
    marginTop: 10,
    height: 46,
    borderRadius: Radius.md,
    backgroundColor: Colors.danger,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  dangerBtnText: { fontSize: 14, fontWeight: '700', color: Colors.textInverse },
  successText: { marginTop: 10, fontSize: 12.5, fontWeight: '600', color: Colors.success },
  errorText: { marginTop: 10, fontSize: 12.5, fontWeight: '600', color: Colors.danger },
});
