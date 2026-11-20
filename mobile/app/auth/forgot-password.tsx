import React, { useState } from 'react';
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
import { validateRvceInstitutionalEmail } from '../../src/services/cognitoAuth';
import { Colors } from '../../src/theme/colors';
import { Radius, Spacing } from '../../src/theme/spacing';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();
  const { requestPasswordReset } = useAuth();

  const [email, setEmail] = useState(params.email || '');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleRequestCode = async () => {
    if (submitting) return;
    setErrorMsg(null);
    const emailCheck = validateRvceInstitutionalEmail(email);
    if (!emailCheck.valid) {
      setErrorMsg(emailCheck.error || 'Enter your @rvce.edu.in email address.');
      return;
    }

    setSubmitting(true);
    try {
      await requestPasswordReset(emailCheck.normalized);
      router.push({
        pathname: '/auth/reset-password',
        params: { email: emailCheck.normalized },
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to initiate password recovery.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <PortalBrandHeader
          title="Account Recovery"
          subtitle="Enter your @rvce.edu.in email address. If an eligible account exists, a one-time recovery verification code will be sent to your inbox."
          showBack
        />

        <View style={styles.card}>
          <Text style={styles.label}>Official RVCE Email</Text>
          <View style={styles.inputShell}>
            <Ionicons name="mail-outline" size={18} color={Colors.textMuted} />
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="name@rvce.edu.in"
              placeholderTextColor={Colors.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!submitting}
              accessibilityLabel="Official RVCE email address"
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
            onPress={handleRequestCode}
            disabled={submitting}
            accessibilityRole="button"
          >
            {submitting ? (
              <ActivityIndicator size="small" color={Colors.textInverse} />
            ) : (
              <Text style={styles.primaryBtnText}>Send Verification Code</Text>
            )}
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
  label: { fontSize: 12.5, fontWeight: '700', color: Colors.textPrimary, marginBottom: 6 },
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
