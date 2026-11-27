import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardSafeScrollView } from '../../src/components/KeyboardSafeScrollView';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { useCampusData } from '../../src/context/CampusDataContext';
import { useTheme } from '../../src/context/ThemeContext';
import { campusApi } from '../../src/services/api';
import { getFacilityIcon } from '../../src/components/NativeCampusMap';
import { Colors } from '../../src/theme/colors';
import { Radius, Spacing } from '../../src/theme/spacing';
import type { FacilityItem, FacultyMember, VisitPassReceipt } from '../../src/types/campus';

const FACILITY_FILTERS = [
  { key: 'ALL', label: 'All' },
  { key: 'CAFETERIA_FOOD', label: 'Cafeterias' },
  { key: 'GATE_RECEPTION', label: 'Gate & Metro' },
  { key: 'MEDICAL_FIRST_AID', label: 'Clinic' },
  { key: 'LIBRARY', label: 'Library' },
  { key: 'BANK_ATM', label: 'Bank & ATM' },
  { key: 'PARKING', label: 'Parking' },
  { key: 'ADMIN_SERVICE', label: 'Admin' },
];

export default function ServicesScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string }>();
  const { facilities, buildings, faculty, selectFacility } = useCampusData();
  const { isGlass, theme } = useTheme();

  const [activeTab, setActiveTab] = useState<'AMENITIES' | 'VISITOR_PASS'>('AMENITIES');
  const [facCategory, setFacCategory] = useState('ALL');

  useEffect(() => {
    if (params.tab === 'VISITOR_PASS') {
      setActiveTab('VISITOR_PASS');
    } else if (params.tab === 'AMENITIES') {
      setActiveTab('AMENITIES');
    }
  }, [params.tab]);

  // Visitor Pass form state
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [org, setOrg] = useState('');
  const [purpose, setPurpose] = useState('');
  const [selectedBldgId, setSelectedBldgId] = useState<number>(
    buildings.find((b) => b.building_code === 'CSE')?.building_id ||
      buildings.find((b) => b.building_code === 'ADMIN')?.building_id ||
      buildings[1]?.building_id ||
      3
  );
  const [visitType, setVisitType] = useState<'GENERAL' | 'FACULTY'>('GENERAL');
  const [selectedHostFaculty, setSelectedHostFaculty] = useState<FacultyMember | null>(null);
  const [facultyQuery, setFacultyQuery] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [passReceipt, setPassReceipt] = useState<VisitPassReceipt | null>(null);

  const matchingHostFaculty = useMemo(() => {
    const q = facultyQuery.trim().toLowerCase();
    // Put demo-linked faculty (Dr. Shanta Ranga Swamy #39, Dr. Ramakanth Kumar P #40, EEE HoD #181) at top when query is empty
    const priorityIds = new Set([39, 40, 181, 169, 174, 175, 172]);
    const baseList = q
      ? faculty.filter(
          (f) =>
            f.display_name.toLowerCase().includes(q) ||
            f.dept_code.toLowerCase().includes(q) ||
            f.designation.toLowerCase().includes(q) ||
            (f.office_room_number && f.office_room_number.toLowerCase().includes(q)) ||
            String(f.staff_id) === q
        )
      : [
          ...faculty.filter((f) => priorityIds.has(f.staff_id)),
          ...faculty.filter((f) => !priorityIds.has(f.staff_id)).slice(0, 15),
        ];
    return baseList.slice(0, 18);
  }, [faculty, facultyQuery]);

  const filteredFacilities = useMemo(() => {
    if (facCategory === 'ALL') return facilities;
    return facilities.filter((f) => f.category === facCategory);
  }, [facilities, facCategory]);

  const handleFacilitySelect = (f: FacilityItem) => {
    selectFacility(f);
    router.push('/(tabs)/map');
  };

  const handlePassSubmit = async () => {
    if (submitting) return;
    setFormError(null);

    if (fullName.trim().length < 2) {
      setFormError('Please enter your full name (at least 2 characters).');
      return;
    }
    if (!/^[0-9+\-\s()]{7,20}$/.test(phone.trim())) {
      setFormError('Please enter a valid 10-digit mobile number.');
      return;
    }
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setFormError('Please enter a valid email address or leave it blank.');
      return;
    }
    if (visitType === 'FACULTY' && !selectedHostFaculty) {
      setFormError('Please select the Faculty member you are visiting, or switch to General Campus Visit.');
      return;
    }
    if (purpose.trim().length < 3) {
      setFormError('Please briefly state your purpose of visit.');
      return;
    }

    setSubmitting(true);
    try {
      const hostStaffId =
        visitType === 'FACULTY' && selectedHostFaculty ? selectedHostFaculty.staff_id : null;
      const destRoomId =
        visitType === 'FACULTY' && selectedHostFaculty?.office_room_id
          ? selectedHostFaculty.office_room_id
          : null;
      const destBldgId =
        visitType === 'FACULTY' && selectedHostFaculty?.building_id
          ? selectedHostFaculty.building_id
          : selectedBldgId;

      const res = await campusApi.preRegisterVisitor({
        full_name: fullName.trim(),
        contact_phone: phone.trim(),
        contact_email: email.trim() || null,
        organization: org.trim() || 'Campus Visitor',
        destination_building_id: destBldgId,
        destination_room_id: destRoomId,
        host_staff_id: hostStaffId,
        requires_host_approval: Boolean(hostStaffId),
        purpose: purpose.trim(),
        gate_name: 'Main Mysuru Road Gate',
      });
      setPassReceipt(res);
    } catch (err: unknown) {
      const detail =
        err instanceof Error && err.message
          ? err.message
          : 'Visitor registration requires an active connection to the RVCE server. Please proceed to the Main Gate Security Desk.';
      setFormError(detail);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: theme.colors.canvas }]}
      edges={['top', 'left', 'right']}
    >
      <View style={{ flex: 1 }}>
        {/* Header */}
        <View
          style={[
            styles.header,
            {
              backgroundColor: isGlass ? theme.colors.surfaceFloating : theme.colors.surface,
              borderBottomColor: theme.colors.borderSubtle,
            },
          ]}
        >
          {isGlass && <BlurView intensity={60} tint="light" style={StyleSheet.absoluteFill} />}
          <Text style={[styles.title, { color: theme.colors.textPrimary }]}>
            Campus Services
          </Text>
          <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>
            Facilities, Cafeterias, Clinic & Visitor Gate Passes
          </Text>

          {/* Segmented Tab Switcher */}
          <View style={styles.tabSwitcher}>
            <TouchableOpacity
              style={[styles.tabBtn, activeTab === 'AMENITIES' && styles.tabBtnActive]}
              onPress={() => setActiveTab('AMENITIES')}
            >
              <Ionicons
                name="compass"
                size={15}
                color={activeTab === 'AMENITIES' ? Colors.textInverse : Colors.textSecondary}
              />
              <Text
                style={[styles.tabText, activeTab === 'AMENITIES' && styles.tabTextActive]}
              >
                Facilities ({facilities.length})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tabBtn, activeTab === 'VISITOR_PASS' && styles.tabBtnActive]}
              onPress={() => setActiveTab('VISITOR_PASS')}
            >
              <Ionicons
                name="shield-checkmark"
                size={15}
                color={activeTab === 'VISITOR_PASS' ? Colors.textInverse : Colors.textSecondary}
              />
              <Text
                style={[styles.tabText, activeTab === 'VISITOR_PASS' && styles.tabTextActive]}
              >
                Visitor Pass
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <KeyboardSafeScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
        >
          {activeTab === 'AMENITIES' ? (
            <>
              {/* Prominent Emergency / 24x7 Clinic Strip */}
              <TouchableOpacity
                activeOpacity={0.86}
                onPress={() => {
                  const clinic = facilities.find(
                    (f) => f.category === 'MEDICAL_FIRST_AID'
                  );
                  if (clinic) handleFacilitySelect(clinic);
                  else router.push('/(tabs)/map');
                }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: '#FEF2F2',
                  borderColor: '#FECACA',
                  borderWidth: 1,
                  borderRadius: 14,
                  padding: 12,
                  marginBottom: 12,
                  gap: 11,
                }}
              >
                <View
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 11,
                    backgroundColor: '#FEE2E2',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons name="medkit" size={19} color="#B91C1C" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13.5, fontWeight: '700', color: '#991B1B' }}>
                    24x7 Campus Health & First Aid Clinic
                  </Text>
                  <Text style={{ fontSize: 11.5, color: '#B91C1C', marginTop: 1 }}>
                    Tap for immediate campus map location & emergency walking route
                  </Text>
                </View>
                <Ionicons name="navigate-circle" size={22} color="#B91C1C" />
              </TouchableOpacity>

              {/* Category Chips */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.catFilterRow}
              >
                {FACILITY_FILTERS.map((cat) => {
                  const active = facCategory === cat.key;
                  return (
                    <TouchableOpacity
                      key={cat.key}
                      style={[styles.catChip, active && styles.catChipActive]}
                      onPress={() => setFacCategory(cat.key)}
                    >
                      <Text
                        style={[styles.catChipText, active && styles.catChipTextActive]}
                      >
                        {cat.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              <View style={styles.facilitiesList}>
                {filteredFacilities.map((fac) => (
                  <TouchableOpacity
                    key={`fac-${fac.facility_id}`}
                    style={styles.facCard}
                    activeOpacity={0.85}
                    onPress={() => handleFacilitySelect(fac)}
                  >
                    <View style={styles.facIconBox}>
                      <Ionicons
                        name={getFacilityIcon(fac.category)}
                        size={20}
                        color={Colors.primary}
                      />
                    </View>

                    <View style={styles.facBody}>
                      <Text style={styles.facName}>{fac.facility_name}</Text>
                      <Text style={styles.facCategory}>
                        {fac.category.replace(/_/g, ' ')}
                        {fac.building_name ? ` • ${fac.building_name}` : ''}
                      </Text>
                      {fac.opening_hours && (
                        <Text style={styles.facHours}>
                          <Ionicons name="time-outline" size={11} color={Colors.textMuted} />{' '}
                          {fac.opening_hours}
                        </Text>
                      )}
                    </View>

                    <View style={styles.mapPinCircle}>
                      <Ionicons name="navigate" size={15} color={Colors.primary} />
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          ) : (
            <View style={styles.formContainer}>
              {passReceipt ? (
                <View style={styles.receiptCard}>
                  <View style={styles.receiptHeader}>
                    <Ionicons name="checkmark-circle" size={40} color={Colors.success} />
                    <Text style={styles.receiptTitle}>Visitor Pass Issued</Text>
                    <Text style={styles.receiptCode}>{passReceipt.visit_pass_code}</Text>
                    <Text style={styles.receiptHint}>
                      Present this code at Main Mysuru Road Gate Reception
                    </Text>
                  </View>

                  <View style={styles.receiptDetails}>
                    <Text style={styles.receiptRow}>
                      <Text style={styles.receiptLabel}>Visitor: </Text>
                      {passReceipt.visitor_name}
                    </Text>
                    <Text style={styles.receiptRow}>
                      <Text style={styles.receiptLabel}>Destination: </Text>
                      {passReceipt.destination_building_name || 'RVCE Campus'}
                      {passReceipt.destination_room_number
                        ? ` • Cabin ${passReceipt.destination_room_number}`
                        : ''}
                    </Text>
                    <Text style={styles.receiptRow}>
                      <Text style={styles.receiptLabel}>Host / Type: </Text>
                      {passReceipt.host_name
                        ? `Meeting ${passReceipt.host_name}`
                        : 'General Campus Visit'}
                    </Text>
                    <Text style={styles.receiptRow}>
                      <Text style={styles.receiptLabel}>Host Approval: </Text>
                      {passReceipt.approval_status === 'PENDING'
                        ? 'SENT TO FACULTY HOST (PENDING)'
                        : passReceipt.approval_status}
                    </Text>
                    <Text style={styles.receiptRow}>
                      <Text style={styles.receiptLabel}>Purpose: </Text>
                      {passReceipt.purpose}
                    </Text>
                    <Text style={styles.receiptRow}>
                      <Text style={styles.receiptLabel}>Entry Gate: </Text>
                      {passReceipt.gate_name}
                    </Text>
                    <Text style={styles.receiptRow}>
                      <Text style={styles.receiptLabel}>Status: </Text>
                      {passReceipt.visit_status}
                    </Text>
                  </View>

                  <View style={styles.receiptBtnsRow}>
                    <TouchableOpacity
                      style={styles.routeDestBtn}
                      onPress={() => router.push('/(tabs)/map')}
                    >
                      <Ionicons name="map-outline" size={15} color={Colors.primary} />
                      <Text style={styles.routeDestBtnText}>Open Campus Map</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.newPassBtn}
                      onPress={() => {
                        setPassReceipt(null);
                        setFullName('');
                        setPhone('');
                        setEmail('');
                        setOrg('');
                        setPurpose('');
                        setSelectedHostFaculty(null);
                        setFacultyQuery('');
                        setFormError(null);
                      }}
                    >
                      <Text style={styles.newPassBtnText}>New Pass</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <View style={styles.formCard}>
                  <Text style={styles.formSectionTitle}>Visitor Gate Pre-Registration</Text>
                  <Text style={styles.formSectionSubtitle}>
                    Register your campus visit to generate an official `RVCE-YYYYMMDD-XXXX` gate pass.
                  </Text>

                  {formError && (
                    <View style={styles.errorBox}>
                      <Ionicons name="alert-circle" size={16} color={Colors.danger} />
                      <Text style={styles.errorText}>{formError}</Text>
                    </View>
                  )}

                  <Text style={styles.inputLabel}>Full Name *</Text>
                  <TextInput
                    style={styles.textInput}
                    value={fullName}
                    onChangeText={setFullName}
                    placeholder="Enter visitor full name"
                    placeholderTextColor={Colors.textMuted}
                  />

                  <Text style={styles.inputLabel}>Mobile Phone *</Text>
                  <TextInput
                    style={styles.textInput}
                    value={phone}
                    onChangeText={setPhone}
                    placeholder="10-digit mobile number"
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="phone-pad"
                  />

                  <Text style={styles.inputLabel}>Visit Category *</Text>
                  <View style={{ flexDirection: 'row', gap: 8, marginBottom: 4 }}>
                    <TouchableOpacity
                      activeOpacity={0.85}
                      onPress={() => {
                        setVisitType('GENERAL');
                        setSelectedHostFaculty(null);
                      }}
                      style={[
                        styles.bldgChip,
                        { flex: 1, alignItems: 'center', paddingVertical: 10 },
                        visitType === 'GENERAL' && styles.bldgChipActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.bldgChipText,
                          visitType === 'GENERAL' && styles.bldgChipTextActive,
                        ]}
                      >
                        General Campus Visit
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      activeOpacity={0.85}
                      onPress={() => setVisitType('FACULTY')}
                      style={[
                        styles.bldgChip,
                        { flex: 1, alignItems: 'center', paddingVertical: 10 },
                        visitType === 'FACULTY' && styles.bldgChipActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.bldgChipText,
                          visitType === 'FACULTY' && styles.bldgChipTextActive,
                        ]}
                      >
                        Meet a Specific Faculty
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {visitType === 'FACULTY' && (
                    <View
                      style={{
                        backgroundColor: '#F8FAFC',
                        borderRadius: 12,
                        padding: 11,
                        borderWidth: 1,
                        borderColor: '#CBD5E1',
                        marginTop: 6,
                        marginBottom: 4,
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 12,
                          fontWeight: '700',
                          color: Colors.primary,
                          marginBottom: 4,
                        }}
                      >
                        Select Host Faculty (Linked by staff_id) *
                      </Text>
                      <Text
                        style={{
                          fontSize: 11,
                          color: Colors.textSecondary,
                          marginBottom: 8,
                        }}
                      >
                        This pass will be sent directly to the selected faculty member's portal (and Admin/Security) for approval.
                      </Text>

                      {selectedHostFaculty ? (
                        <View
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            backgroundColor: '#EEF2FF',
                            borderRadius: 10,
                            padding: 10,
                            borderWidth: 1.5,
                            borderColor: Colors.primary,
                            gap: 10,
                          }}
                        >
                          <Ionicons name="person-circle" size={28} color={Colors.primary} />
                          <View style={{ flex: 1 }}>
                            <Text
                              style={{
                                fontSize: 13.5,
                                fontWeight: '800',
                                color: Colors.textPrimary,
                              }}
                            >
                              {selectedHostFaculty.display_name}
                            </Text>
                            <Text style={{ fontSize: 11.5, color: Colors.textSecondary }}>
                              {selectedHostFaculty.designation} • {selectedHostFaculty.dept_code} (ID #{selectedHostFaculty.staff_id})
                              {selectedHostFaculty.office_room_number
                                ? ` • Cabin ${selectedHostFaculty.office_room_number}`
                                : ''}
                            </Text>
                          </View>
                          <TouchableOpacity
                            onPress={() => setSelectedHostFaculty(null)}
                            style={{
                              paddingHorizontal: 8,
                              paddingVertical: 4,
                              backgroundColor: '#FFFFFF',
                              borderRadius: 6,
                              borderWidth: 1,
                              borderColor: Colors.border,
                            }}
                          >
                            <Text style={{ fontSize: 11, fontWeight: '700', color: Colors.danger }}>
                              Change
                            </Text>
                          </TouchableOpacity>
                        </View>
                      ) : (
                        <>
                          <TextInput
                            style={[styles.textInput, { backgroundColor: '#FFFFFF', marginBottom: 8 }]}
                            value={facultyQuery}
                            onChangeText={setFacultyQuery}
                            placeholder="Search faculty by name, dept (CSE, EEE), or staff_id..."
                            placeholderTextColor={Colors.textMuted}
                          />
                          <ScrollView
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            contentContainerStyle={{ gap: 8, paddingVertical: 2 }}
                          >
                            {matchingHostFaculty.map((fac) => (
                              <TouchableOpacity
                                key={`host-fac-${fac.staff_id}`}
                                activeOpacity={0.85}
                                onPress={() => {
                                  setSelectedHostFaculty(fac);
                                  if (fac.building_id) {
                                    setSelectedBldgId(fac.building_id);
                                  }
                                }}
                                style={{
                                  backgroundColor: '#FFFFFF',
                                  borderRadius: 10,
                                  paddingHorizontal: 11,
                                  paddingVertical: 8,
                                  borderWidth: 1,
                                  borderColor: Colors.border,
                                  minWidth: 175,
                                }}
                              >
                                <Text
                                  style={{
                                    fontSize: 12.5,
                                    fontWeight: '700',
                                    color: Colors.textPrimary,
                                  }}
                                  numberOfLines={1}
                                >
                                  {fac.display_name}
                                </Text>
                                <Text
                                  style={{
                                    fontSize: 11,
                                    color: Colors.primary,
                                    fontWeight: '600',
                                    marginTop: 1,
                                  }}
                                  numberOfLines={1}
                                >
                                  {fac.dept_code} • {fac.designation}
                                </Text>
                                <Text
                                  style={{
                                    fontSize: 10.5,
                                    color: Colors.textMuted,
                                    marginTop: 1,
                                  }}
                                  numberOfLines={1}
                                >
                                  ID #{fac.staff_id}
                                  {fac.office_room_number ? ` • Cabin ${fac.office_room_number}` : ''}
                                </Text>
                              </TouchableOpacity>
                            ))}
                          </ScrollView>
                        </>
                      )}
                    </View>
                  )}

                  <Text style={styles.inputLabel}>Destination Building *</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.bldgChipsRow}
                  >
                    {buildings.slice(0, 12).map((b) => {
                      const active = selectedBldgId === b.building_id;
                      return (
                        <TouchableOpacity
                          key={`dest-${b.building_id}`}
                          style={[styles.bldgChip, active && styles.bldgChipActive]}
                          onPress={() => setSelectedBldgId(b.building_id)}
                        >
                          <Text
                            style={[
                              styles.bldgChipText,
                              active && styles.bldgChipTextActive,
                            ]}
                          >
                            {b.building_code}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>

                  <Text style={styles.inputLabel}>Purpose of Visit *</Text>
                  <TextInput
                    style={styles.textInput}
                    value={purpose}
                    onChangeText={setPurpose}
                    placeholder="e.g. Admissions Enquiry / Academic Meeting"
                    placeholderTextColor={Colors.textMuted}
                  />

                  <Text style={styles.inputLabel}>Organisation / Institution (Optional)</Text>
                  <TextInput
                    style={styles.textInput}
                    value={org}
                    onChangeText={setOrg}
                    placeholder="Parent / Candidate / Partner Institution"
                    placeholderTextColor={Colors.textMuted}
                  />

                  <Text style={styles.inputLabel}>Email Address (Optional)</Text>
                  <TextInput
                    style={styles.textInput}
                    value={email}
                    onChangeText={setEmail}
                    placeholder="visitor@example.com"
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="email-address"
                    autoCapitalize="none"
                  />

                  <TouchableOpacity
                    style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
                    onPress={handlePassSubmit}
                    disabled={submitting}
                  >
                    <Ionicons name="qr-code-outline" size={17} color="#FFFFFF" />
                    <Text style={styles.submitBtnText}>
                      {submitting ? 'Generating Gate Pass…' : 'Generate Digital Gate Pass'}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}
        </KeyboardSafeScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.md,
    backgroundColor: Colors.card,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.textPrimary,
    letterSpacing: -0.4,
  },
  subtitle: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
    marginBottom: Spacing.md,
  },
  tabSwitcher: {
    flexDirection: 'row',
    backgroundColor: Colors.cardSecondary,
    borderRadius: Radius.full,
    padding: 3,
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 7.5,
    borderRadius: Radius.full,
  },
  tabBtnActive: {
    backgroundColor: Colors.primary,
  },
  tabText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  tabTextActive: {
    color: Colors.textInverse,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xxl,
  },
  catFilterRow: {
    gap: 7,
    paddingBottom: 12,
  },
  catChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.full,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  catChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  catChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  catChipTextActive: {
    color: '#FFFFFF',
  },
  facilitiesList: {
    gap: Spacing.sm,
  },
  facCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  facIconBox: {
    width: 42,
    height: 42,
    borderRadius: Radius.md,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
  },
  facBody: {
    flex: 1,
    marginRight: 8,
  },
  facName: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  facCategory: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  facHours: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 3,
  },
  mapPinCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  formContainer: {
    paddingTop: Spacing.xs,
  },
  formCard: {
    backgroundColor: Colors.card,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  formSectionTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: Colors.primary,
  },
  formSectionSubtitle: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 3,
    marginBottom: Spacing.md,
    lineHeight: 17,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: Colors.dangerBg,
    borderRadius: Radius.md,
    padding: 10,
    marginBottom: 10,
  },
  errorText: {
    flex: 1,
    fontSize: 12,
    color: Colors.danger,
    fontWeight: '600',
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginTop: Spacing.sm,
    marginBottom: 5,
  },
  textInput: {
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    fontSize: 13,
    color: Colors.textPrimary,
  },
  bldgChipsRow: {
    gap: 7,
    paddingVertical: 2,
  },
  bldgChip: {
    paddingHorizontal: 11,
    paddingVertical: 6.5,
    borderRadius: Radius.md,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  bldgChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  bldgChipText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: Colors.textSecondary,
  },
  bldgChipTextActive: {
    color: '#FFFFFF',
  },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    paddingVertical: 13,
    marginTop: Spacing.lg,
  },
  submitBtnDisabled: {
    opacity: 0.6,
  },
  submitBtnText: {
    color: Colors.textInverse,
    fontSize: 14,
    fontWeight: '700',
  },
  receiptCard: {
    backgroundColor: Colors.card,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: Colors.primary,
  },
  receiptHeader: {
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  receiptTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.primary,
    marginTop: Spacing.xs,
  },
  receiptCode: {
    fontSize: 21,
    fontWeight: '900',
    color: Colors.primaryDark,
    marginTop: 4,
    letterSpacing: 0.8,
  },
  receiptHint: {
    fontSize: 11.5,
    color: Colors.textSecondary,
    marginTop: 4,
    textAlign: 'center',
  },
  receiptDetails: {
    width: '100%',
    backgroundColor: Colors.cardSecondary,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginVertical: Spacing.md,
    gap: 6,
  },
  receiptRow: {
    fontSize: 13,
    color: Colors.textPrimary,
  },
  receiptLabel: {
    fontWeight: '700',
    color: Colors.textSecondary,
  },
  receiptBtnsRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },
  routeDestBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 11,
    borderRadius: Radius.md,
    backgroundColor: Colors.primaryLight,
    borderWidth: 1,
    borderColor: Colors.borderStrong,
  },
  routeDestBtnText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: Colors.primary,
  },
  newPassBtn: {
    flex: 0.8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
  },
  newPassBtnText: {
    color: Colors.textInverse,
    fontSize: 12.5,
    fontWeight: '700',
  },
});
