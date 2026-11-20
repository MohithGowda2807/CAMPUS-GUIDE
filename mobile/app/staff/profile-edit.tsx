import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  FlatList,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { PortalBrandHeader } from '../../src/components/PortalBrandHeader';
import { useAuth } from '../../src/context/AuthContext';
import { useCampusData } from '../../src/context/CampusDataContext';
import { campusApi } from '../../src/services/api';
import { validateRvceInstitutionalEmail } from '../../src/services/cognitoAuth';
import type { DetailedStaffProfileResponse } from '../../src/types/campus';
import { Colors } from '../../src/theme/colors';
import { Radius, Spacing } from '../../src/theme/spacing';

export default function StaffProfileEditScreen() {
  const { refreshMe } = useAuth();
  const { refreshData } = useCampusData();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState<DetailedStaffProfileResponse | null>(null);
  const [roomModalOpen, setRoomModalOpen] = useState(false);

  const [selectedRoomId, setSelectedRoomId] = useState<number | null>(null);
  const [publicEmail, setPublicEmail] = useState('');
  const [profileUrl, setProfileUrl] = useState('');
  const [visibility, setVisibility] = useState<'PUBLIC' | 'INTERNAL_ONLY' | 'HIDDEN'>('PUBLIC');
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    try {
      const data = await campusApi.getDetailedProfile();
      setDetail(data);
      if (data.staff_record) {
        setSelectedRoomId(data.staff_record.office_room_id);
        setPublicEmail(data.staff_record.public_email || '');
        setProfileUrl(data.staff_record.official_profile_url || '');
        setVisibility(data.staff_record.profile_visibility || 'PUBLIC');
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to load faculty profile.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const selectedRoomObj = detail?.available_rooms.find((r) => r.room_id === selectedRoomId);

  const handleSave = async () => {
    if (saving) return;
    setErrorMsg(null);
    setSaveMessage(null);

    let normalizedPubEmail: string | null = null;
    if (publicEmail.trim()) {
      const check = validateRvceInstitutionalEmail(publicEmail);
      if (!check.valid) {
        setErrorMsg(check.error || 'Public email must be an official @rvce.edu.in address.');
        return;
      }
      normalizedPubEmail = check.normalized;
    }

    setSaving(true);
    try {
      await campusApi.updateMyProfile({
        office_room_id: selectedRoomId,
        public_email: normalizedPubEmail,
        official_profile_url: profileUrl.trim() || null,
        profile_visibility: visibility,
      });
      setSaveMessage('Approved profile changes saved and recorded in institutional audit log.');
      await refreshMe();
      await refreshData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to update profile.';
      if (msg.toLowerCase().includes('re-authenticate') || msg.toLowerCase().includes('recent')) {
        Alert.alert(
          'Re-Authentication Required',
          'Sensitive profile updates require a recent sign-in within the last 15 minutes. Please sign in again to continue.'
        );
      }
      setErrorMsg(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <PortalBrandHeader
          title="My Faculty Profile"
          subtitle="Review your verified institutional HR roster record and manage permitted public directory details."
          showBack
          showPublicMapAction={false}
        />

        {loading ? (
          <ActivityIndicator size="large" color={Colors.primary} style={{ marginTop: 40 }} />
        ) : !detail?.staff_record ? (
          <View style={styles.card}>
            <Text style={styles.readonlyTitle}>Administrative Account</Text>
            <Text style={styles.readonlyVal}>
              This account ({detail?.user.email}) is an operational/administrative identity without a public faculty roster profile.
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.card}>
              <View style={styles.sectionHeader}>
                <Ionicons name="ribbon-outline" size={18} color={Colors.primary} />
                <Text style={styles.sectionTitle}>Verified Institutional Roster (Read-Only)</Text>
              </View>

              <View style={styles.kvRow}>
                <Text style={styles.kvKey}>Full Name</Text>
                <Text style={styles.kvVal}>{detail.staff_record.display_name}</Text>
              </View>
              <View style={styles.kvRow}>
                <Text style={styles.kvKey}>Employee Code</Text>
                <Text style={styles.kvVal}>{detail.staff_record.employee_code}</Text>
              </View>
              <View style={styles.kvRow}>
                <Text style={styles.kvKey}>Department</Text>
                <Text style={styles.kvVal}>
                  {detail.staff_record.dept_name} ({detail.staff_record.dept_code})
                </Text>
              </View>
              <View style={styles.kvRow}>
                <Text style={styles.kvKey}>Designation</Text>
                <Text style={styles.kvVal}>{detail.staff_record.designation}</Text>
              </View>
              {detail.staff_record.qualification ? (
                <View style={styles.kvRow}>
                  <Text style={styles.kvKey}>Qualification</Text>
                  <Text style={styles.kvVal}>{detail.staff_record.qualification}</Text>
                </View>
              ) : null}
            </View>

            <View style={styles.card}>
              <View style={styles.sectionHeader}>
                <Ionicons name="create-outline" size={18} color={Colors.primary} />
                <Text style={styles.sectionTitle}>Permitted Self-Service Settings</Text>
              </View>

              <Text style={styles.label}>Assigned Cabin / Office Room</Text>
              <TouchableOpacity
                style={styles.selectorBtn}
                onPress={() => setRoomModalOpen(true)}
                accessibilityRole="button"
              >
                <Ionicons name="business-outline" size={18} color={Colors.primary} />
                <Text style={styles.selectorText}>
                  {selectedRoomObj
                    ? `${selectedRoomObj.room_number} — ${selectedRoomObj.room_name} (${selectedRoomObj.building_code})`
                    : 'Not Assigned (Tap to select campus room)'}
                </Text>
                <Ionicons name="chevron-down" size={16} color={Colors.textMuted} />
              </TouchableOpacity>

              <Text style={[styles.label, { marginTop: Spacing.md }]}>
                Public Contact Email (@rvce.edu.in)
              </Text>
              <TextInput
                style={styles.input}
                value={publicEmail}
                onChangeText={setPublicEmail}
                placeholder="Optional @rvce.edu.in address shown in directory"
                placeholderTextColor={Colors.textMuted}
                keyboardType="email-address"
                autoCapitalize="none"
              />

              <Text style={[styles.label, { marginTop: Spacing.md }]}>
                Official RVCE Webpage URL
              </Text>
              <TextInput
                style={styles.input}
                value={profileUrl}
                onChangeText={setProfileUrl}
                placeholder="https://rvce.edu.in/..."
                placeholderTextColor={Colors.textMuted}
                autoCapitalize="none"
              />

              <Text style={[styles.label, { marginTop: Spacing.md }]}>Directory Visibility</Text>
              <View style={styles.visRow}>
                {(['PUBLIC', 'INTERNAL_ONLY', 'HIDDEN'] as const).map((opt) => (
                  <TouchableOpacity
                    key={opt}
                    style={[styles.visChip, visibility === opt && styles.visChipActive]}
                    onPress={() => setVisibility(opt)}
                  >
                    <Text
                      style={[
                        styles.visChipText,
                        visibility === opt && styles.visChipTextActive,
                      ]}
                    >
                      {opt.replace('_', ' ')}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}
              {saveMessage ? <Text style={styles.successText}>{saveMessage}</Text> : null}

              <TouchableOpacity
                style={[styles.primaryBtn, saving && { opacity: 0.65 }]}
                onPress={handleSave}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator size="small" color={Colors.textInverse} />
                ) : (
                  <Text style={styles.primaryBtnText}>Save Profile Changes</Text>
                )}
              </TouchableOpacity>
            </View>
          </>
        )}

        <Modal visible={roomModalOpen} animationType="slide" onRequestClose={() => setRoomModalOpen(false)}>
          <SafeAreaView style={styles.modalSafe}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Office / Cabin Room</Text>
              <TouchableOpacity onPress={() => setRoomModalOpen(false)}>
                <Ionicons name="close" size={24} color={Colors.textPrimary} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={detail?.available_rooms || []}
              keyExtractor={(item) => String(item.room_id)}
              ListHeaderComponent={
                <TouchableOpacity
                  style={styles.roomRow}
                  onPress={() => {
                    setSelectedRoomId(null);
                    setRoomModalOpen(false);
                  }}
                >
                  <Text style={styles.roomRowTitle}>Clear Room Assignment</Text>
                </TouchableOpacity>
              }
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.roomRow}
                  onPress={() => {
                    setSelectedRoomId(item.room_id);
                    setRoomModalOpen(false);
                  }}
                >
                  <Text style={styles.roomRowTitle}>
                    {item.room_number} • {item.room_name}
                  </Text>
                  <Text style={styles.roomRowSub}>
                    {item.building_name} ({item.building_code})
                  </Text>
                </TouchableOpacity>
              )}
            />
          </SafeAreaView>
        </Modal>
      </ScrollView>
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
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  sectionTitle: { fontSize: 14.5, fontWeight: '800', color: Colors.textPrimary },
  readonlyTitle: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary, marginBottom: 6 },
  readonlyVal: { fontSize: 13.5, color: Colors.textSecondary, lineHeight: 20 },
  kvRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 12,
  },
  kvKey: { fontSize: 12.5, color: Colors.textSecondary, fontWeight: '600' },
  kvVal: { flex: 1, fontSize: 13, color: Colors.textPrimary, fontWeight: '700', textAlign: 'right' },
  label: { fontSize: 12.5, fontWeight: '700', color: Colors.textPrimary, marginBottom: 6 },
  selectorBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: 12,
    height: 48,
    backgroundColor: Colors.background,
  },
  selectorText: { flex: 1, fontSize: 13.5, color: Colors.textPrimary, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: 12,
    height: 46,
    fontSize: 14,
    color: Colors.textPrimary,
    backgroundColor: Colors.background,
  },
  visRow: { flexDirection: 'row', gap: 8 },
  visChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  visChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  visChipText: { fontSize: 11.5, fontWeight: '700', color: Colors.textSecondary },
  visChipTextActive: { color: Colors.textInverse },
  errorText: { marginTop: 12, fontSize: 12.5, fontWeight: '600', color: Colors.danger },
  successText: { marginTop: 12, fontSize: 12.5, fontWeight: '600', color: Colors.success },
  primaryBtn: {
    marginTop: Spacing.lg,
    height: 48,
    borderRadius: Radius.md,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: { fontSize: 15, fontWeight: '700', color: Colors.textInverse },
  modalSafe: { flex: 1, backgroundColor: Colors.background },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.card,
  },
  modalTitle: { fontSize: 17, fontWeight: '800', color: Colors.textPrimary },
  roomRow: {
    padding: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.card,
  },
  roomRowTitle: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary },
  roomRowSub: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
});
