import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { PortalBrandHeader } from '../../src/components/PortalBrandHeader';
import { KeyboardSafeScrollView } from '../../src/components/KeyboardSafeScrollView';
import { useAuth } from '../../src/context/AuthContext';
import { campusApi } from '../../src/services/api';
import type { AdminUserAccount, AllowlistEntry } from '../../src/types/campus';
import { Colors } from '../../src/theme/colors';
import { Radius, Spacing } from '../../src/theme/spacing';

export default function AdminApprovalsScreen() {
  const { user } = useAuth();

  const [accounts, setAccounts] = useState<AdminUserAccount[]>([]);
  const [allowlist, setAllowlist] = useState<AllowlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<'FACULTY' | 'STAFF'>('FACULTY');
  const [adding, setAdding] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [acc, alw] = await Promise.all([
        campusApi.listAdminUsers(),
        campusApi.listAllowlist(),
      ]);
      setAccounts(acc);
      setAllowlist(alw);
    } catch (err) {
      Alert.alert('Admin Access Error', err instanceof Error ? err.message : 'Failed to load accounts.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleDecision = async (
    targetId: number,
    action: 'APPROVE' | 'REJECT' | 'SUSPEND' | 'REVOKE',
    roleCode: 'FACULTY' | 'STAFF' = 'FACULTY'
  ) => {
    try {
      await campusApi.decideAdminAccount(targetId, {
        action,
        role_code: action === 'APPROVE' ? roleCode : undefined,
      });
      await loadData();
    } catch (err) {
      Alert.alert('Decision Rejected', err instanceof Error ? err.message : 'Operation failed.');
    }
  };

  const handleAddAllowlist = async () => {
    if (!newEmail.trim()) return;
    setAdding(true);
    try {
      await campusApi.addAllowlistEntry({
        email: newEmail.trim().toLowerCase(),
        assigned_role_code: newRole,
        notes: 'Added via RVCE Mobile Admin Console',
      });
      setNewEmail('');
      await loadData();
    } catch (err) {
      Alert.alert('Allowlist Error', err instanceof Error ? err.message : 'Invalid @rvce.edu.in email.');
    } finally {
      setAdding(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <KeyboardSafeScrollView contentContainerStyle={styles.scrollContent}>
        <PortalBrandHeader
          title="Staff Eligibility & Approvals"
          subtitle="Pre-authorise @rvce.edu.in emails and approve, suspend, or revoke staff portal accounts."
          badgeText="Administrator Governance"
          showBack
          showPublicMapAction={false}
        />

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Pre-Authorise @rvce.edu.in Email</Text>
          <TextInput
            style={styles.input}
            value={newEmail}
            onChangeText={setNewEmail}
            placeholder="faculty.member@rvce.edu.in"
            placeholderTextColor={Colors.textMuted}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <View style={styles.roleRow}>
            {(['FACULTY', 'STAFF'] as const).map((r) => (
              <TouchableOpacity
                key={r}
                style={[styles.roleChip, newRole === r && styles.roleChipActive]}
                onPress={() => setNewRole(r)}
              >
                <Text style={[styles.roleChipText, newRole === r && { color: Colors.textInverse }]}>
                  Assign {r}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity style={styles.primaryBtn} onPress={handleAddAllowlist} disabled={adding}>
            {adding ? (
              <ActivityIndicator size="small" color={Colors.textInverse} />
            ) : (
              <Text style={styles.primaryBtnText}>Add to Eligibility Allowlist</Text>
            )}
          </TouchableOpacity>

          <Text style={[styles.sectionTitle, { marginTop: Spacing.lg }]}>
            Active Allowlist ({allowlist.filter((x) => x.is_active).length})
          </Text>
          {allowlist
            .filter((x) => x.is_active)
            .slice(0, 8)
            .map((item) => (
              <View key={item.allowlist_id} style={styles.listRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{item.email}</Text>
                  <Text style={styles.rowSub}>
                    Role: {item.assigned_role_code}
                    {item.staff_name ? ` • ${item.staff_name}` : ''}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() =>
                    campusApi.removeAllowlistEntry(item.allowlist_id).then(loadData)
                  }
                >
                  <Ionicons name="trash-outline" size={18} color={Colors.danger} />
                </TouchableOpacity>
              </View>
            ))}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Registered Staff Accounts ({accounts.length})</Text>
          {loading ? (
            <ActivityIndicator size="small" color={Colors.primary} />
          ) : (
            accounts.map((acc) => {
              const isSelf = acc.user_id === user?.user_id;
              return (
                <View key={acc.user_id} style={styles.accCard}>
                  <View style={styles.accHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle}>{acc.full_name}</Text>
                      <Text style={styles.rowSub}>{acc.email}</Text>
                    </View>
                    <Text style={styles.statusTag}>{acc.approval_status}</Text>
                  </View>

                  {!isSelf ? (
                    <View style={styles.actionRow}>
                      {acc.approval_status !== 'APPROVED' ? (
                        <>
                          <TouchableOpacity
                            style={[styles.smallBtn, { backgroundColor: Colors.success }]}
                            onPress={() => handleDecision(acc.user_id, 'APPROVE', 'FACULTY')}
                          >
                            <Text style={styles.smallBtnText}>Approve Faculty</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.smallBtn, { backgroundColor: Colors.primary }]}
                            onPress={() => handleDecision(acc.user_id, 'APPROVE', 'STAFF')}
                          >
                            <Text style={styles.smallBtnText}>Approve Staff</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.smallBtn, { backgroundColor: Colors.danger }]}
                            onPress={() => handleDecision(acc.user_id, 'REJECT')}
                          >
                            <Text style={styles.smallBtnText}>Reject</Text>
                          </TouchableOpacity>
                        </>
                      ) : (
                        <>
                          <TouchableOpacity
                            style={[styles.smallBtn, { backgroundColor: Colors.warning }]}
                            onPress={() => handleDecision(acc.user_id, 'SUSPEND')}
                          >
                            <Text style={styles.smallBtnText}>Suspend</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.smallBtn, { backgroundColor: Colors.danger }]}
                            onPress={() => handleDecision(acc.user_id, 'REVOKE')}
                          >
                            <Text style={styles.smallBtnText}>Revoke</Text>
                          </TouchableOpacity>
                        </>
                      )}
                    </View>
                  ) : (
                    <Text style={styles.selfNote}>Current signed-in administrator account</Text>
                  )}
                </View>
              );
            })
          )}
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
  sectionTitle: { fontSize: 14, fontWeight: '800', color: Colors.textPrimary, marginBottom: 10 },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: 12,
    height: 45,
    fontSize: 14,
    color: Colors.textPrimary,
    backgroundColor: Colors.background,
  },
  roleRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  roleChip: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  roleChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  roleChipText: { fontSize: 12.5, fontWeight: '700', color: Colors.textPrimary },
  primaryBtn: {
    marginTop: 12,
    height: 44,
    borderRadius: Radius.md,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: { fontSize: 13.5, fontWeight: '700', color: Colors.textInverse },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  rowTitle: { fontSize: 13.5, fontWeight: '700', color: Colors.textPrimary },
  rowSub: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  accCard: {
    padding: 12,
    borderRadius: Radius.md,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 10,
  },
  accHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  statusTag: { fontSize: 10.5, fontWeight: '800', color: Colors.primary },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  smallBtn: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: Radius.sm },
  smallBtnText: { fontSize: 11.5, fontWeight: '700', color: Colors.textInverse },
  selfNote: { marginTop: 6, fontSize: 11.5, fontStyle: 'italic', color: Colors.textMuted },
});
