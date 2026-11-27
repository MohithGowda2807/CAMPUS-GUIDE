import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { PortalBrandHeader } from '../../src/components/PortalBrandHeader';
import { KeyboardSafeScrollView } from '../../src/components/KeyboardSafeScrollView';
import { StatusPill } from '../../src/components/StatusPill';
import { useAuth } from '../../src/context/AuthContext';
import { useCampusData } from '../../src/context/CampusDataContext';
import { campusApi } from '../../src/services/api';
import type { AvailabilityState } from '../../src/types/campus';
import { Colors } from '../../src/theme/colors';
import { Radius, Spacing } from '../../src/theme/spacing';

const AVAILABILITY_OPTIONS: Array<{
  state: AvailabilityState;
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
}> = [
  {
    state: 'AVAILABLE',
    title: 'Available',
    subtitle: 'Open for student & visitor consultation in office',
    icon: 'checkmark-circle-outline',
    tint: Colors.success,
  },
  {
    state: 'IN_CLASS',
    title: 'In Class',
    subtitle: 'Conducting lecture or laboratory session',
    icon: 'school-outline',
    tint: '#4F46E5',
  },
  {
    state: 'IN_MEETING',
    title: 'In a Meeting',
    subtitle: 'Departmental or institutional meeting in progress',
    icon: 'people-outline',
    tint: Colors.warning,
  },
  {
    state: 'BUSY',
    title: 'Busy',
    subtitle: 'Occupied with academic / research work',
    icon: 'time-outline',
    tint: Colors.warning,
  },
  {
    state: 'UNAVAILABLE',
    title: 'Unavailable',
    subtitle: 'Away from cabin or off-campus duty',
    icon: 'close-circle-outline',
    tint: Colors.danger,
  },
  {
    state: 'NOT_SPECIFIED',
    title: 'Not Specified',
    subtitle: 'Clear active live status broadcast',
    icon: 'remove-circle-outline',
    tint: Colors.textMuted,
  },
];

const DURATION_PRESETS = [
  { label: '30m', minutes: 30 },
  { label: '1h', minutes: 60 },
  { label: '2h', minutes: 120 },
  { label: '3h', minutes: 180 },
  { label: '4h', minutes: 240 },
  { label: 'Full Day (8h)', minutes: 480 },
];

export default function AvailabilityEditorScreen() {
  const { user, refreshMe } = useAuth();
  const { faculty, refreshData } = useCampusData();

  const myFacultyEntry = useMemo(
    () => faculty.find((f) => f.staff_id === user?.linked_staff_id) || null,
    [faculty, user?.linked_staff_id]
  );

  const [selectedState, setSelectedState] = useState<AvailabilityState>(
    myFacultyEntry?.effective_availability || 'AVAILABLE'
  );
  const [validMinutes, setValidMinutes] = useState<number>(120);
  const [publicNote, setPublicNote] = useState<string>(myFacultyEntry?.availability_note || '');
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(
    myFacultyEntry?.availability_updated_at || null
  );
  const [validUntilIso, setValidUntilIso] = useState<string | null>(
    myFacultyEntry?.availability_valid_until || null
  );
  const [confirmBanner, setConfirmBanner] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSaveAvailability = async () => {
    if (saving) return;
    setSaving(true);
    setConfirmBanner(null);
    setErrorMsg(null);
    try {
      const res = await campusApi.updateAvailability({
        availability_state: selectedState,
        valid_minutes: validMinutes,
        public_note: publicNote.trim() || undefined,
      });
      setLastSavedAt(res.last_updated_at || new Date().toISOString());
      setValidUntilIso(res.valid_until);
      setConfirmBanner('Availability updated and published to the RVCE Faculty Directory.');
      await refreshMe();
      await refreshData();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to save availability status.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <KeyboardSafeScrollView contentContainerStyle={styles.scrollContent}>
        <PortalBrandHeader
          title="My Availability"
          subtitle="Broadcast your current office availability with automatic time-window expiration."
          showBack
          showPublicMapAction={false}
        />

        <View style={styles.liveCard}>
          <View style={styles.liveHeader}>
            <Text style={styles.liveLabel}>CURRENT DIRECTORY STATUS</Text>
            <StatusPill status={selectedState} type="AVAILABILITY" />
          </View>
          {lastSavedAt ? (
            <Text style={styles.timestampText}>
              Last updated: {new Date(lastSavedAt).toLocaleString()}
              {validUntilIso ? ` • Expires: ${new Date(validUntilIso).toLocaleTimeString()}` : ''}
            </Text>
          ) : (
            <Text style={styles.timestampText}>No recent manual status update recorded.</Text>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Select Status</Text>
          <View style={styles.optionsList}>
            {AVAILABILITY_OPTIONS.map((opt) => {
              const active = selectedState === opt.state;
              return (
                <TouchableOpacity
                  key={opt.state}
                  style={[styles.optionCard, active && styles.optionCardActive]}
                  onPress={() => setSelectedState(opt.state)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                >
                  <Ionicons
                    name={opt.icon}
                    size={22}
                    color={active ? Colors.primary : opt.tint}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.optionTitle, active && { color: Colors.primary }]}>
                      {opt.title}
                    </Text>
                    <Text style={styles.optionSub}>{opt.subtitle}</Text>
                  </View>
                  {active ? (
                    <Ionicons name="radio-button-on" size={20} color={Colors.primary} />
                  ) : (
                    <Ionicons name="radio-button-off" size={20} color={Colors.border} />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={[styles.sectionTitle, { marginTop: Spacing.lg }]}>
            Auto-Expiry Window
          </Text>
          <View style={styles.durationRow}>
            {DURATION_PRESETS.map((d) => {
              const active = validMinutes === d.minutes;
              return (
                <TouchableOpacity
                  key={d.minutes}
                  style={[styles.durationChip, active && styles.durationChipActive]}
                  onPress={() => setValidMinutes(d.minutes)}
                >
                  <Text
                    style={[
                      styles.durationChipText,
                      active && styles.durationChipTextActive,
                    ]}
                  >
                    {d.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={[styles.sectionTitle, { marginTop: Spacing.lg }]}>
            Optional Public Note (Max 200 chars)
          </Text>
          <TextInput
            style={styles.noteInput}
            value={publicNote}
            onChangeText={(t) => setPublicNote(t.slice(0, 200))}
            placeholder="e.g., Available in CSE Cabin 204 after 2:30 PM"
            placeholderTextColor={Colors.textMuted}
            maxLength={200}
            multiline
          />

          {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}
          {confirmBanner ? (
            <View style={styles.confirmBox}>
              <Ionicons name="checkmark-circle" size={17} color={Colors.success} />
              <Text style={styles.confirmText}>{confirmBanner}</Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={[styles.primaryBtn, saving && { opacity: 0.65 }]}
            onPress={handleSaveAvailability}
            disabled={saving}
            accessibilityRole="button"
          >
            {saving ? (
              <ActivityIndicator size="small" color={Colors.textInverse} />
            ) : (
              <>
                <Ionicons name="radio-outline" size={18} color={Colors.textInverse} />
                <Text style={styles.primaryBtnText}>Publish Availability Status</Text>
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
  scrollContent: { padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  liveCard: {
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.md,
  },
  liveHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  liveLabel: { fontSize: 11, fontWeight: '800', color: Colors.textSecondary, letterSpacing: 0.6 },
  timestampText: { fontSize: 12, color: Colors.textSecondary },
  card: {
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  sectionTitle: { fontSize: 13.5, fontWeight: '800', color: Colors.textPrimary, marginBottom: 10 },
  optionsList: { gap: 8 },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  optionCardActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryLight,
  },
  optionTitle: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary },
  optionSub: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  durationRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  durationChip: {
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  durationChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  durationChipText: { fontSize: 12.5, fontWeight: '700', color: Colors.textSecondary },
  durationChipTextActive: { color: Colors.textInverse },
  noteInput: {
    minHeight: 72,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: 12,
    fontSize: 14,
    color: Colors.textPrimary,
    backgroundColor: Colors.background,
    textAlignVertical: 'top',
  },
  errorText: { marginTop: 12, fontSize: 12.5, fontWeight: '600', color: Colors.danger },
  confirmBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    padding: 11,
    borderRadius: Radius.md,
    backgroundColor: Colors.successBg,
  },
  confirmText: { flex: 1, fontSize: 12.5, fontWeight: '600', color: Colors.success },
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
  primaryBtnText: { fontSize: 15, fontWeight: '700', color: Colors.textInverse },
});
