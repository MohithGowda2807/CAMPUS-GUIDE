import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/context/AuthContext';
import { useCampusData } from '../../src/context/CampusDataContext';
import { StatusPill } from '../../src/components/StatusPill';
import { campusApi, getApiBaseUrl } from '../../src/services/api';
import { Colors } from '../../src/theme/colors';
import { Radius, Spacing } from '../../src/theme/spacing';
import type { ReportsSummary, VisitRecord } from '../../src/types/campus';

export default function StaffPortalDashboardScreen() {
  const router = useRouter();
  const {
    user,
    authStage,
    onboardingStatus,
    statusReason,
    pendingEmail,
    providerConfig,
    sessionExpiredNotice,
    loading: authLoading,
    clearNotices,
    refreshSessionState,
    refreshMe,
    logout,
  } = useAuth();
  const { connectionState, faculty, refreshData } = useCampusData();

  const [refreshing, setRefreshing] = useState(false);
  const [visits, setVisits] = useState<VisitRecord[]>([]);
  const [loadingVisits, setLoadingVisits] = useState(false);
  const [actingVisitId, setActingVisitId] = useState<number | null>(null);
  const [reports, setReports] = useState<ReportsSummary | null>(null);

  const currentBaseUrl = getApiBaseUrl();
  const userRoles = user?.roles || [];
  const hasAnyRole = useCallback(
    (...codes: string[]) => codes.some((c) => userRoles.includes(c)),
    [userRoles]
  );

  const isAdmin = hasAnyRole('ADMIN', 'SYSTEM_ADMIN');
  const canUpdateAvailability =
    Boolean(user?.linked_staff_id) &&
    hasAnyRole('FACULTY', 'FACULTY_STAFF', 'DEPT_COORDINATOR', 'ADMIN', 'SYSTEM_ADMIN');
  const canManageVisits = hasAnyRole(
    'FACULTY',
    'STAFF',
    'FACULTY_STAFF',
    'SECURITY_RECEPTION',
    'FACILITY_ADMIN',
    'ADMIN',
    'SYSTEM_ADMIN'
  );
  const canCheckInGate = hasAnyRole('STAFF', 'SECURITY_RECEPTION', 'ADMIN', 'SYSTEM_ADMIN');
  const canViewReports = hasAnyRole(
    'STAFF',
    'SECURITY_RECEPTION',
    'FACILITY_ADMIN',
    'ADMIN',
    'SYSTEM_ADMIN'
  );

  const linkedFacultyRecord = useMemo(() => {
    if (!user?.linked_staff_id) return null;
    return faculty.find((f) => f.staff_id === user.linked_staff_id) || null;
  }, [faculty, user?.linked_staff_id]);

  const loadOperationalData = useCallback(async () => {
    if (!user || authStage !== 'AUTHENTICATED') return;
    if (canManageVisits) {
      setLoadingVisits(true);
      try {
        const vList = await campusApi.listVisits();
        setVisits(vList.slice(0, 8));
      } catch {
        setVisits([]);
      } finally {
        setLoadingVisits(false);
      }
    }
    if (canViewReports) {
      campusApi
        .getReportsSummary(30)
        .then(setReports)
        .catch(() => setReports(null));
    }
  }, [user, authStage, canManageVisits, canViewReports]);

  useEffect(() => {
    loadOperationalData();
  }, [loadOperationalData]);

  const handlePullRefresh = async () => {
    setRefreshing(true);
    try {
      if (authStage === 'AUTHENTICATED') {
        await Promise.all([refreshMe(), refreshData(), loadOperationalData()]);
      } else if (authStage === 'PENDING_APPROVAL' || authStage === 'REJECTED_OR_SUSPENDED') {
        await refreshSessionState();
      } else {
        await refreshData();
      }
    } finally {
      setRefreshing(false);
    }
  };

  const handleVisitAction = async (
    visitId: number,
    action: 'CHECK_IN' | 'CHECK_OUT' | 'APPROVE_HOST' | 'REJECT_HOST'
  ) => {
    setActingVisitId(visitId);
    try {
      await campusApi.recordVisitAction(visitId, action, 'Main Mysuru Road Gate');
      await loadOperationalData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unable to update visitor status.';
      Alert.alert('Visitor Action', msg);
    } finally {
      setActingVisitId(null);
    }
  };

  const handleSignOutConfirm = () => {
    Alert.alert(
      'Sign Out of Staff Portal',
      'End your current RVCE staff session and clear tokens on this device?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            await logout();
            setVisits([]);
            setReports(null);
          },
        },
      ]
    );
  };

  if (authLoading || authStage === 'LOADING') {
    return (
      <SafeAreaView style={styles.loadingContainer} edges={['top']}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>Verifying institutional session…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handlePullRefresh}
            tintColor={Colors.primary}
          />
        }
      >
        {/* Top Institutional Header */}
        <View style={styles.brandHeader}>
          <View style={styles.brandRow}>
            <View style={styles.logoFrame}>
              <Image
                source={require('../../assets/icon.png')}
                style={styles.logoImg}
                contentFit="contain"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.institutionLabel}>R. V. COLLEGE OF ENGINEERING</Text>
              <View style={styles.exclusiveBadge}>
                <Ionicons name="shield-checkmark" size={12} color={Colors.primary} />
                <Text style={styles.exclusiveBadgeText}>
                  {authStage === 'AUTHENTICATED'
                    ? 'Verified Faculty & Staff Workspace'
                    : 'Authorised RVCE Faculty & Staff Only'}
                </Text>
              </View>
            </View>
          </View>

          <Text style={styles.headerTitle}>
            {authStage === 'AUTHENTICATED'
              ? 'Faculty & Staff Dashboard'
              : 'RVCE Institutional Staff Portal'}
          </Text>
          <Text style={styles.headerSubtitle}>
            {authStage === 'AUTHENTICATED'
              ? 'Manage your academic profile, real-time cabin availability, visitor approvals, and account security.'
              : 'Public visitors and students can use the campus map, directory, and turn-by-turn navigation without signing in.'}
          </Text>
        </View>

        {/* Server Connectivity Bar */}
        <View style={styles.serverCard}>
          <View style={styles.serverCardRow}>
            <View style={styles.serverIconBg}>
              <Ionicons
                name={connectionState === 'ONLINE' ? 'cloud-done' : 'cloud-offline'}
                size={19}
                color={connectionState === 'ONLINE' ? Colors.success : Colors.warning}
              />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={styles.serverLabel}>Identity & API:</Text>
                <View
                  style={[
                    styles.statusDot,
                    {
                      backgroundColor:
                        connectionState === 'ONLINE' ? Colors.success : Colors.warning,
                    },
                  ]}
                />
                <Text
                  style={[
                    styles.serverStatusText,
                    {
                      color: connectionState === 'ONLINE' ? Colors.success : Colors.warning,
                    },
                  ]}
                >
                  {connectionState === 'ONLINE' ? 'Online' : 'Offline Cache'}
                </Text>
                {providerConfig ? (
                  <Text style={styles.providerBadgeText}>
                    • {providerConfig.provider_mode === 'AWS_COGNITO' ? 'AWS Cognito' : 'OIDC PKCE'}
                  </Text>
                ) : null}
              </View>
              <Text style={styles.serverUrl} numberOfLines={1}>
                {currentBaseUrl}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.configBtn}
              onPress={() => router.push('/modal/server-settings')}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel="Configure server connection"
            >
              <Ionicons name="options-outline" size={15} color={Colors.primary} />
              <Text style={styles.configBtnText}>Server</Text>
            </TouchableOpacity>
          </View>
        </View>

        {sessionExpiredNotice ? (
          <View style={styles.noticeBanner}>
            <Ionicons name="information-circle" size={18} color={Colors.warning} />
            <Text style={styles.noticeBannerText}>{sessionExpiredNotice}</Text>
            <TouchableOpacity onPress={clearNotices} hitSlop={8}>
              <Ionicons name="close" size={16} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>
        ) : null}

        {/* =====================================================================
            STATE A: UNAUTHENTICATED GATEWAY (NO HARDCODED PASSWORDS)
           ===================================================================== */}
        {authStage === 'UNAUTHENTICATED' && (
          <View style={styles.gatewaySection}>
            <View style={styles.gatewayCard}>
              <View style={styles.gatewayIconCircle}>
                <Ionicons name="lock-closed-outline" size={24} color={Colors.primary} />
              </View>
              <Text style={styles.gatewayTitle}>Authorised Staff Authentication</Text>
              <Text style={styles.gatewayDesc}>
                Sign in with your verified <Text style={styles.monoStrong}>@rvce.edu.in</Text>{' '}
                institutional account via OpenID Connect (PKCE). Role permissions are enforced by
                institutional directory verification.
              </Text>

              <TouchableOpacity
                style={styles.primaryActionBtn}
                onPress={() => router.push('/auth/sign-in')}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Sign in to RVCE Staff Portal"
              >
                <Ionicons name="log-in-outline" size={19} color="#FFFFFF" />
                <Text style={styles.primaryActionBtnText}>Sign In to Staff Portal</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.secondaryActionBtn}
                onPress={() => router.push('/auth/register')}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Register an official rvce.edu.in staff account"
              >
                <Ionicons name="person-add-outline" size={18} color={Colors.primary} />
                <Text style={styles.secondaryActionBtnText}>
                  Register Official @rvce.edu.in Account
                </Text>
              </TouchableOpacity>
            </View>

            {/* Public Access Assurance Card */}
            <View style={styles.publicAssuranceCard}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <Ionicons name="compass" size={19} color={Colors.primary} />
                <Text style={styles.publicAssuranceTitle}>Visiting RVCE Campus?</Text>
              </View>
              <Text style={styles.publicAssuranceDesc}>
                No account or login is required to browse campus buildings, search 339+ faculty
                cabins, inspect floor plans, or get walking & vehicle directions.
              </Text>
              <TouchableOpacity
                style={styles.publicMapLinkBtn}
                onPress={() => router.push('/(tabs)/map')}
                activeOpacity={0.8}
              >
                <Text style={styles.publicMapLinkText}>Open Public Campus Map & Directions</Text>
                <Ionicons name="arrow-forward" size={16} color={Colors.primary} />
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* =====================================================================
            STATE B: EMAIL VERIFICATION OR MFA CONTINUATION
           ===================================================================== */}
        {(authStage === 'EMAIL_VERIFICATION_REQUIRED' || authStage === 'MFA_REQUIRED') && (
          <View style={styles.stateCard}>
            <Ionicons name="shield-half-outline" size={28} color={Colors.primary} />
            <Text style={styles.stateCardTitle}>
              {authStage === 'MFA_REQUIRED'
                ? 'Authenticator Verification Pending'
                : 'Email Ownership Verification Pending'}
            </Text>
            <Text style={styles.stateCardDesc}>
              Continue verifying {pendingEmail || 'your @rvce.edu.in account'} to complete sign-in.
            </Text>
            <TouchableOpacity
              style={styles.primaryActionBtn}
              onPress={() =>
                router.push(
                  authStage === 'MFA_REQUIRED' ? '/auth/mfa-challenge' : '/auth/verify-email'
                )
              }
            >
              <Text style={styles.primaryActionBtnText}>Continue Verification</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.textLinkBtn} onPress={handleSignOutConfirm}>
              <Text style={styles.textLinkDanger}>Cancel & Sign Out</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* =====================================================================
            STATE C: REGISTRATION PENDING ADMINISTRATOR APPROVAL
           ===================================================================== */}
        {authStage === 'PENDING_APPROVAL' && (
          <View style={styles.stateCard}>
            <View style={styles.pendingBadgeCircle}>
              <Ionicons name="hourglass-outline" size={26} color={Colors.warning} />
            </View>
            <Text style={styles.stateCardTitle}>Account Pending Institutional Approval</Text>
            <Text style={styles.stateCardDesc}>
              Your <Text style={styles.monoStrong}>{pendingEmail}</Text> email is verified, and your
              registration is queued for RVCE Administrator eligibility verification. Staff portal
              privileges remain locked until approved.
            </Text>
            {statusReason ? <Text style={styles.reasonQuote}>{statusReason}</Text> : null}

            <TouchableOpacity
              style={styles.primaryActionBtn}
              onPress={() => router.push('/auth/pending-approval')}
            >
              <Ionicons name="document-text-outline" size={18} color="#FFFFFF" />
              <Text style={styles.primaryActionBtnText}>View Approval Status & Refresh</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.logoutOutlineBtn} onPress={handleSignOutConfirm}>
              <Ionicons name="log-out-outline" size={17} color={Colors.danger} />
              <Text style={styles.logoutBtnText}>Sign Out</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* =====================================================================
            STATE D: REJECTED / SUSPENDED / REVOKED
           ===================================================================== */}
        {authStage === 'REJECTED_OR_SUSPENDED' && (
          <View style={styles.stateCard}>
            <View style={[styles.pendingBadgeCircle, { backgroundColor: Colors.dangerBg }]}>
              <Ionicons name="ban-outline" size={26} color={Colors.danger} />
            </View>
            <Text style={styles.stateCardTitle}>
              Staff Access {onboardingStatus || 'Restricted'}
            </Text>
            <Text style={styles.stateCardDesc}>
              {statusReason ||
                'This institutional account is not currently authorised for RVCE Staff Portal access.'}
            </Text>
            <TouchableOpacity
              style={styles.secondaryActionBtn}
              onPress={() => router.push('/auth/rejected')}
            >
              <Text style={styles.secondaryActionBtnText}>View Account Notice</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.logoutOutlineBtn} onPress={handleSignOutConfirm}>
              <Ionicons name="log-out-outline" size={17} color={Colors.danger} />
              <Text style={styles.logoutBtnText}>Sign Out</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* =====================================================================
            STATE E: AUTHENTICATED 6-SECTION FACULTY & STAFF DASHBOARD
           ===================================================================== */}
        {authStage === 'AUTHENTICATED' && user && (
          <View style={styles.dashboardStack}>
            {/* SECTION 1: OVERVIEW */}
            <View style={styles.overviewCard}>
              <View style={styles.overviewTopRow}>
                <View style={styles.avatarCircle}>
                  <Text style={styles.avatarInitials}>
                    {(user.staff_name || user.full_name || user.username)
                      .slice(0, 2)
                      .toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1, marginLeft: 14 }}>
                  <Text style={styles.userNameText}>
                    {user.staff_name || user.full_name || user.username}
                  </Text>
                  <View style={styles.verifiedEmailRow}>
                    <Ionicons name="checkmark-circle" size={14} color={Colors.success} />
                    <Text style={styles.userEmailText} numberOfLines={1}>
                      {user.email}
                    </Text>
                  </View>
                  <View style={styles.badgeStrip}>
                    {linkedFacultyRecord ? (
                      <StatusPill
                        status={linkedFacultyRecord.effective_availability || 'NOT_SPECIFIED'}
                      />
                    ) : null}
                    <View
                      style={[
                        styles.mfaChip,
                        {
                          backgroundColor: user.mfa_enabled
                            ? Colors.successBg
                            : Colors.cardSecondary,
                        },
                      ]}
                    >
                      <Ionicons
                        name={user.mfa_enabled ? 'lock-closed' : 'shield-outline'}
                        size={11}
                        color={user.mfa_enabled ? Colors.success : Colors.textSecondary}
                      />
                      <Text
                        style={[
                          styles.mfaChipText,
                          { color: user.mfa_enabled ? Colors.success : Colors.textSecondary },
                        ]}
                      >
                        {user.mfa_enabled ? 'TOTP MFA Active' : 'MFA Optional'}
                      </Text>
                    </View>
                  </View>
                </View>
              </View>

              {canViewReports && reports ? (
                <View style={styles.kpiStrip}>
                  <View style={styles.kpiCell}>
                    <Text style={styles.kpiNum}>{reports.kpis.active_buildings}</Text>
                    <Text style={styles.kpiLbl}>Buildings</Text>
                  </View>
                  <View style={styles.kpiCell}>
                    <Text style={styles.kpiNum}>{reports.kpis.listed_faculty}</Text>
                    <Text style={styles.kpiLbl}>Faculty</Text>
                  </View>
                  <View style={styles.kpiCell}>
                    <Text style={styles.kpiNum}>{reports.kpis.visitors_currently_inside}</Text>
                    <Text style={styles.kpiLbl}>Inside Now</Text>
                  </View>
                  <View style={styles.kpiCell}>
                    <Text style={styles.kpiNum}>{reports.kpis.period_total_visits}</Text>
                    <Text style={styles.kpiLbl}>30d Visits</Text>
                  </View>
                </View>
              ) : null}
            </View>

            {/* ADMIN GOVERNANCE CONSOLE (ONLY FOR ADMIN / SYSTEM_ADMIN) */}
            {isAdmin && (
              <TouchableOpacity
                style={styles.adminActionCard}
                onPress={() => router.push('/staff/admin-approvals')}
                activeOpacity={0.82}
                accessibilityRole="button"
                accessibilityLabel="Open Administrator Staff Approvals and Allowlist"
              >
                <View style={styles.cardIconBoxNavy}>
                  <Ionicons name="people-circle-outline" size={22} color="#FFFFFF" />
                </View>
                <View style={{ flex: 1, marginHorizontal: 12 }}>
                  <Text style={styles.navCardTitle}>Staff Eligibility & Account Approvals</Text>
                  <Text style={styles.navCardSubtitle}>
                    Approve, reject, suspend, or revoke @rvce.edu.in accounts and manage the
                    institutional allowlist.
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={Colors.primary} />
              </TouchableOpacity>
            )}

            {/* SECTION 3: MY AVAILABILITY */}
            {canUpdateAvailability && (
              <View style={styles.sectionCard}>
                <View style={styles.sectionHeaderBetween}>
                  <View style={styles.sectionHeaderRow}>
                    <Ionicons name="time-outline" size={20} color={Colors.primary} />
                    <Text style={styles.sectionTitle}>My Availability</Text>
                  </View>
                  {linkedFacultyRecord ? (
                    <StatusPill status={linkedFacultyRecord.effective_availability} />
                  ) : null}
                </View>
                <Text style={styles.sectionDesc}>
                  {linkedFacultyRecord?.availability_note
                    ? `Current note: "${linkedFacultyRecord.availability_note}"`
                    : 'Broadcast your live office/cabin availability (Available, Busy, In Class, In a Meeting, Unavailable) with automatic expiry.'}
                </Text>
                {linkedFacultyRecord?.availability_updated_at ? (
                  <Text style={styles.timestampMeta}>
                    Last updated:{' '}
                    {new Date(linkedFacultyRecord.availability_updated_at).toLocaleString()}
                  </Text>
                ) : null}
                <TouchableOpacity
                  style={styles.primaryActionBtn}
                  onPress={() => router.push('/staff/availability')}
                  activeOpacity={0.85}
                >
                  <Ionicons name="options-outline" size={18} color="#FFFFFF" />
                  <Text style={styles.primaryActionBtnText}>Open Availability Editor</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* SECTION 2: MY PROFILE */}
            <TouchableOpacity
              style={styles.navCard}
              onPress={() => router.push('/staff/profile-edit')}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Manage my faculty or staff profile"
            >
              <View style={styles.cardIconBox}>
                <Ionicons name="person-outline" size={20} color={Colors.primary} />
              </View>
              <View style={{ flex: 1, marginHorizontal: 12 }}>
                <Text style={styles.navCardTitle}>My Profile & Cabin Location</Text>
                <Text style={styles.navCardSubtitle}>
                  {linkedFacultyRecord?.office_room_number
                    ? `Cabin ${linkedFacultyRecord.office_room_number} • ${linkedFacultyRecord.building_code || 'Campus'}`
                    : 'Update assigned cabin/office room, public consultation email, URL, and directory visibility.'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
            </TouchableOpacity>

            {/* SECTION 4: DEPARTMENT & DESIGNATION INFORMATION */}
            <View style={styles.sectionCard}>
              <View style={styles.sectionHeaderRow}>
                <Ionicons name="school-outline" size={20} color={Colors.primary} />
                <Text style={styles.sectionTitle}>Department & Designation</Text>
              </View>

              <View style={styles.infoGrid}>
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Department</Text>
                  <Text style={styles.infoValue}>
                    {user.dept_name
                      ? `${user.dept_name} (${user.dept_code || ''})`
                      : linkedFacultyRecord?.dept_name || 'Campus Administration / General'}
                  </Text>
                </View>
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Designation</Text>
                  <Text style={styles.infoValue}>
                    {user.designation || linkedFacultyRecord?.designation || 'Authorised Staff'}
                  </Text>
                </View>
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Employee Code</Text>
                  <Text style={styles.infoValueMono}>
                    {user.employee_code || linkedFacultyRecord?.employee_code || `USR-${user.user_id}`}
                  </Text>
                </View>
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Authorised Roles</Text>
                  <View style={styles.roleTagWrap}>
                    {userRoles.map((r) => (
                      <View key={r} style={styles.rolePill}>
                        <Text style={styles.rolePillText}>{r.replace(/_/g, ' ')}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              </View>
            </View>

            {/* GATE & HOST VISITOR QUEUE (ROLE-RESTRICTED) */}
            {canManageVisits && (
              <View style={styles.sectionCard}>
                <View style={styles.sectionHeaderBetween}>
                  <View style={styles.sectionHeaderRow}>
                    <Ionicons name="clipboard-outline" size={20} color={Colors.primary} />
                    <Text style={styles.sectionTitle}>Visitor Pass & Host Queue</Text>
                  </View>
                  <TouchableOpacity onPress={loadOperationalData} hitSlop={8}>
                    <Ionicons name="refresh" size={18} color={Colors.primary} />
                  </TouchableOpacity>
                </View>
                <Text style={styles.sectionDesc}>
                  Authorised visitor pass log for host approvals and gate verification.
                </Text>

                {loadingVisits ? (
                  <ActivityIndicator
                    size="small"
                    color={Colors.primary}
                    style={{ marginVertical: 14 }}
                  />
                ) : visits.length === 0 ? (
                  <Text style={styles.emptyQueueText}>No active visitor passes right now.</Text>
                ) : (
                  <View style={{ gap: 10 }}>
                    {visits.map((v) => (
                      <View key={v.visit_id} style={styles.visitRow}>
                        <View style={{ flex: 1, marginRight: 8 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <Text style={styles.visitCode}>{v.visit_pass_code}</Text>
                            <View
                              style={[
                                styles.visitStatusBadge,
                                v.visit_status === 'CHECKED_IN'
                                  ? { backgroundColor: Colors.successBg }
                                  : v.visit_status === 'REGISTERED'
                                  ? { backgroundColor: Colors.warningBg }
                                  : { backgroundColor: Colors.cardSecondary },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.visitStatusText,
                                  {
                                    color:
                                      v.visit_status === 'CHECKED_IN'
                                        ? Colors.success
                                        : v.visit_status === 'REGISTERED'
                                        ? Colors.warning
                                        : Colors.textSecondary,
                                  },
                                ]}
                              >
                                {v.visit_status.replace(/_/g, ' ')}
                              </Text>
                            </View>
                          </View>
                          <Text style={styles.visitName}>{v.visitor_name}</Text>
                          <Text style={styles.visitMeta} numberOfLines={1}>
                            {v.destination_building_name || 'Campus'} • {v.purpose}
                          </Text>
                        </View>

                        <View style={{ flexDirection: 'row', gap: 6 }}>
                          {v.approval_status === 'PENDING' && (
                            <TouchableOpacity
                              style={styles.gateActionBtnIn}
                              onPress={() => handleVisitAction(v.visit_id, 'APPROVE_HOST')}
                              disabled={actingVisitId === v.visit_id}
                            >
                              <Text style={styles.gateActionText}>Approve</Text>
                            </TouchableOpacity>
                          )}
                          {canCheckInGate &&
                            v.visit_status === 'REGISTERED' &&
                            v.approval_status !== 'REJECTED' && (
                              <TouchableOpacity
                                style={styles.gateActionBtnIn}
                                onPress={() => handleVisitAction(v.visit_id, 'CHECK_IN')}
                                disabled={actingVisitId === v.visit_id}
                              >
                                <Text style={styles.gateActionText}>Check In</Text>
                              </TouchableOpacity>
                            )}
                          {canCheckInGate && v.visit_status === 'CHECKED_IN' && (
                            <TouchableOpacity
                              style={styles.gateActionBtnOut}
                              onPress={() => handleVisitAction(v.visit_id, 'CHECK_OUT')}
                              disabled={actingVisitId === v.visit_id}
                            >
                              <Text style={styles.gateActionTextOut}>Check Out</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            )}

            {/* SECTION 5: ACCOUNT SECURITY */}
            <TouchableOpacity
              style={styles.navCard}
              onPress={() => router.push('/staff/security')}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Account security, authenticator MFA, and session controls"
            >
              <View style={styles.cardIconBox}>
                <Ionicons name="shield-checkmark-outline" size={20} color={Colors.primary} />
              </View>
              <View style={{ flex: 1, marginHorizontal: 12 }}>
                <Text style={styles.navCardTitle}>Account Security & Sessions</Text>
                <Text style={styles.navCardSubtitle}>
                  Configure TOTP Authenticator MFA, reset password, or revoke all active sessions.
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
            </TouchableOpacity>

            {/* SECTION 6: SIGN OUT */}
            <TouchableOpacity
              style={styles.logoutOutlineBtn}
              onPress={handleSignOutConfirm}
              activeOpacity={0.78}
              accessibilityRole="button"
              accessibilityLabel="Sign out of staff portal"
            >
              <Ionicons name="log-out-outline" size={18} color={Colors.danger} />
              <Text style={styles.logoutBtnText}>Sign Out of Staff Session</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.footer}>
          <Text style={styles.footerText}>R. V. College of Engineering • Bengaluru 560059</Text>
          <Text style={styles.footerSub}>
            Protected by OpenID Connect (PKCE) & Backend RBAC • Zero local password storage
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  scrollContent: {
    padding: Spacing.lg,
    paddingBottom: 48,
  },
  brandHeader: {
    marginBottom: Spacing.md,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  logoFrame: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  logoImg: {
    width: 40,
    height: 40,
  },
  institutionLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.7,
    color: Colors.textSecondary,
    marginBottom: 3,
  },
  exclusiveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: Radius.full,
  },
  exclusiveBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.primary,
  },
  headerTitle: {
    fontSize: 23,
    fontWeight: '800',
    color: Colors.textPrimary,
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 4,
    lineHeight: 19,
  },
  serverCard: {
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.md,
  },
  serverCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  serverIconBg: {
    width: 36,
    height: 36,
    borderRadius: Radius.md,
    backgroundColor: Colors.cardSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  serverLabel: {
    fontSize: 11,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  serverStatusText: {
    fontSize: 11,
    fontWeight: '700',
  },
  providerBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.primary,
  },
  serverUrl: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
  },
  configBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.cardSecondary,
  },
  configBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.primary,
  },
  noticeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.warningBg,
    borderRadius: Radius.md,
    padding: 12,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  noticeBannerText: {
    flex: 1,
    fontSize: 12.5,
    color: Colors.textPrimary,
    lineHeight: 17,
  },
  gatewaySection: {
    gap: Spacing.md,
  },
  gatewayCard: {
    backgroundColor: Colors.card,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  gatewayIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  gatewayTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.textPrimary,
    marginBottom: 6,
  },
  gatewayDesc: {
    fontSize: 13.5,
    color: Colors.textSecondary,
    lineHeight: 20,
    marginBottom: 18,
  },
  monoStrong: {
    fontWeight: '700',
    color: Colors.primary,
  },
  primaryActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: Radius.lg,
    marginBottom: 10,
  },
  primaryActionBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  secondaryActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primaryLight,
    paddingVertical: 13,
    paddingHorizontal: 16,
    borderRadius: Radius.lg,
  },
  secondaryActionBtnText: {
    color: Colors.primary,
    fontSize: 13.5,
    fontWeight: '700',
  },
  publicAssuranceCard: {
    backgroundColor: Colors.card,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  publicAssuranceTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  publicAssuranceDesc: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 19,
    marginBottom: 12,
  },
  publicMapLinkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.cardSecondary,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: Radius.md,
  },
  publicMapLinkText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.primary,
  },
  stateCard: {
    backgroundColor: Colors.card,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'stretch',
  },
  pendingBadgeCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.warningBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  stateCardTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.textPrimary,
    marginBottom: 8,
  },
  stateCardDesc: {
    fontSize: 13.5,
    color: Colors.textSecondary,
    lineHeight: 20,
    marginBottom: 16,
  },
  reasonQuote: {
    fontSize: 12.5,
    color: Colors.textPrimary,
    backgroundColor: Colors.cardSecondary,
    padding: 10,
    borderRadius: Radius.md,
    marginBottom: 14,
  },
  textLinkBtn: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  textLinkDanger: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.danger,
  },
  dashboardStack: {
    gap: Spacing.md,
  },
  overviewCard: {
    backgroundColor: Colors.card,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  overviewTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
  },
  userNameText: {
    fontSize: 17,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  verifiedEmailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 3,
  },
  userEmailText: {
    fontSize: 12.5,
    color: Colors.textSecondary,
    flex: 1,
  },
  badgeStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  mfaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3.5,
    borderRadius: Radius.full,
  },
  mfaChipText: {
    fontSize: 11,
    fontWeight: '600',
  },
  kpiStrip: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  kpiCell: {
    flex: 1,
    backgroundColor: Colors.cardSecondary,
    borderRadius: Radius.md,
    paddingVertical: 9,
    alignItems: 'center',
  },
  kpiNum: {
    fontSize: 16,
    fontWeight: '800',
    color: Colors.primary,
  },
  kpiLbl: {
    fontSize: 10,
    fontWeight: '600',
    color: Colors.textSecondary,
    marginTop: 2,
  },
  adminActionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primaryLight,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  cardIconBoxNavy: {
    width: 42,
    height: 42,
    borderRadius: Radius.md,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardIconBox: {
    width: 42,
    height: 42,
    borderRadius: Radius.md,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navCardTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  navCardSubtitle: {
    fontSize: 12.5,
    color: Colors.textSecondary,
    marginTop: 3,
    lineHeight: 17,
  },
  sectionCard: {
    backgroundColor: Colors.card,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionHeaderBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: 15.5,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  sectionDesc: {
    fontSize: 12.5,
    color: Colors.textSecondary,
    marginTop: 6,
    lineHeight: 18,
    marginBottom: 12,
  },
  timestampMeta: {
    fontSize: 11.5,
    color: Colors.textMuted,
    marginBottom: 12,
  },
  infoGrid: {
    marginTop: 12,
    gap: 10,
  },
  infoRow: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  infoLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 3,
  },
  infoValue: {
    fontSize: 13.5,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  infoValueMono: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.primary,
  },
  roleTagWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  rolePill: {
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: 9,
    paddingVertical: 3.5,
    borderRadius: Radius.sm,
  },
  rolePillText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.primary,
  },
  emptyQueueText: {
    fontSize: 12.5,
    color: Colors.textMuted,
    paddingVertical: 8,
  },
  visitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.cardSecondary,
    padding: 12,
    borderRadius: Radius.lg,
  },
  visitCode: {
    fontSize: 12,
    fontWeight: '800',
    color: Colors.primary,
  },
  visitStatusBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: Radius.sm,
  },
  visitStatusText: {
    fontSize: 9.5,
    fontWeight: '800',
  },
  visitName: {
    fontSize: 13.5,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginTop: 2,
  },
  visitMeta: {
    fontSize: 11.5,
    color: Colors.textSecondary,
    marginTop: 1,
  },
  gateActionBtnIn: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: Radius.md,
  },
  gateActionText: {
    color: '#FFFFFF',
    fontSize: 11.5,
    fontWeight: '700',
  },
  gateActionBtnOut: {
    borderWidth: 1,
    borderColor: Colors.primary,
    backgroundColor: Colors.card,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: Radius.md,
  },
  gateActionTextOut: {
    color: Colors.primary,
    fontSize: 11.5,
    fontWeight: '700',
  },
  logoutOutlineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: '#FECACA',
    paddingVertical: 13,
    borderRadius: Radius.lg,
    marginTop: 4,
  },
  logoutBtnText: {
    fontSize: 13.5,
    fontWeight: '700',
    color: Colors.danger,
  },
  footer: {
    marginTop: Spacing.xl,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textSecondary,
  },
  footerSub: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 3,
    textAlign: 'center',
  },
});
