import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import {
  BarChart3,
  Building2,
  ClipboardCheck,
  Clock,
  FileCheck2,
  RefreshCw,
  ShieldAlert,
  UserCheck,
  Users,
} from 'lucide-react';
import { Footer } from '../components/Footer';
import { Header } from '../components/Header';
import { VisitStatusBadge } from '../components/StatusBadge';
import { useAuth } from '../context/AuthContext';
import { campusApi } from '../services/api';
import type {
  AuditLogEntry,
  Building,
  DepartmentItem,
  ReportsSummary,
  VisitRecord,
} from '../types/campus';

type PortalTab = 'visits' | 'availability' | 'campus_admin' | 'reports' | 'system_admin';

export function StaffPortalPage() {
  const { user, loading, hasAnyRole } = useAuth();

  const canManageVisits = hasAnyRole(
    'SECURITY_RECEPTION',
    'FACULTY_STAFF',
    'FACILITY_ADMIN',
    'SYSTEM_ADMIN'
  );
  const canUpdateAvailability = hasAnyRole('FACULTY_STAFF', 'DEPT_COORDINATOR', 'SYSTEM_ADMIN');
  const canManageCampus = hasAnyRole('FACILITY_ADMIN', 'DEPT_COORDINATOR', 'SYSTEM_ADMIN');
  const canViewReports = hasAnyRole('SECURITY_RECEPTION', 'FACILITY_ADMIN', 'SYSTEM_ADMIN');
  const canSystemAdmin = hasAnyRole('SYSTEM_ADMIN');

  const [activeTab, setActiveTab] = useState<PortalTab>('visits');
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Visitor Logs State
  const [visits, setVisits] = useState<VisitRecord[]>([]);
  const [visitStatusFilter, setVisitStatusFilter] = useState<string>('');
  const [visitSearch, setVisitSearch] = useState<string>('');

  // Walk-in Registration State
  const [walkinName, setWalkinName] = useState('');
  const [walkinPhone, setWalkinPhone] = useState('');
  const [walkinPurpose, setWalkinPurpose] = useState('');
  const [walkinBldgId, setWalkinBldgId] = useState('');

  // Faculty Availability Self-Service State
  const [availState, setAvailState] = useState('AVAILABLE');
  const [availNote, setAvailNote] = useState('');
  const [availMinutes, setAvailMinutes] = useState(180);

  // Campus Admin Data & Quick Create Building/Room State
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [departments, setDepartments] = useState<DepartmentItem[]>([]);
  const [bCode, setBCode] = useState('');
  const [bName, setBName] = useState('');
  const [bType, setBType] = useState('ACADEMIC_BLOCK');
  const [bLat, setBLat] = useState('12.923500');
  const [bLng, setBLng] = useState('77.499500');
  const [bFloors, setBFloors] = useState('3');

  // Reports & Audit State
  const [reports, setReports] = useState<ReportsSummary | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);

  const loadVisits = useCallback(() => {
    if (!canManageVisits) return;
    campusApi
      .listVisits({
        visit_status: visitStatusFilter || undefined,
        q: visitSearch.trim() || undefined,
      })
      .then(setVisits)
      .catch(() => setVisits([]));
  }, [canManageVisits, visitStatusFilter, visitSearch]);

  useEffect(() => {
    if (!user) return;
    loadVisits();
    campusApi.getBuildings().then(setBuildings).catch(() => null);
    campusApi.getDepartments().then(setDepartments).catch(() => null);
  }, [user, loadVisits]);

  useEffect(() => {
    if (activeTab === 'reports' && canViewReports) {
      campusApi.getReportsSummary(30).then(setReports).catch(() => null);
    }
    if (activeTab === 'system_admin' && (canSystemAdmin || canManageCampus)) {
      campusApi.getAuditLogs(40).then(setAuditLogs).catch(() => null);
    }
  }, [activeTab, canViewReports, canSystemAdmin, canManageCampus]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F7FA] text-sm text-[#64748B]">
        Verifying staff session…
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  const handleVisitAction = async (visitId: number, action: string) => {
    setFeedback(null);
    try {
      await campusApi.recordVisitAction(visitId, action);
      setFeedback({ type: 'ok', text: `Action ${action.replace('_', ' ')} recorded.` });
      loadVisits();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to update visit status.',
      });
    }
  };

  const handleWalkinSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    try {
      const receipt = await campusApi.registerVisitorByStaff({
        full_name: walkinName.trim(),
        contact_phone: walkinPhone.trim(),
        purpose: walkinPurpose.trim(),
        destination_building_id: walkinBldgId ? Number(walkinBldgId) : null,
        gate_name: 'Main Mysuru Road Gate',
        immediate_check_in: true,
      });
      setWalkinName('');
      setWalkinPhone('');
      setWalkinPurpose('');
      setWalkinBldgId('');
      setFeedback({
        type: 'ok',
        text: `Issued & Checked In Gate Pass ${receipt.visit_pass_code} for ${receipt.visitor_name}.`,
      });
      loadVisits();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Walk-in registration failed.',
      });
    }
  };

  const handleAvailabilitySubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    try {
      const res = await campusApi.updateAvailability({
        availability_state: availState,
        public_note: availNote.trim() || undefined,
        valid_minutes: availMinutes,
      });
      setFeedback({
        type: 'ok',
        text: `Availability updated to ${res.availability_state} (expires ${new Date(
          res.valid_until
        ).toLocaleTimeString()}).`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Could not update availability.',
      });
    }
  };

  const handleCreateBuilding = async (e: FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    try {
      await campusApi.createBuilding({
        building_code: bCode.trim().toUpperCase(),
        building_name: bName.trim(),
        building_type: bType,
        latitude: Number(bLat),
        longitude: Number(bLng),
        total_floors: Number(bFloors),
        verification_status: 'PENDING_REVIEW',
        status: 'ACTIVE',
      });
      setBCode('');
      setBName('');
      setFeedback({ type: 'ok', text: 'Building record added and logged in audit trail.' });
      campusApi.getBuildings().then(setBuildings).catch(() => null);
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to create building.',
      });
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#F5F7FA]">
      <Header />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Staff Session Header */}
        <div className="bg-white border border-[#E2E8F0] rounded-lg p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-[#202938]">
              Staff &amp; Campus Administration Portal
            </h1>
            <p className="text-xs text-[#64748B] mt-1">
              Signed in as <strong className="text-[#202938]">{user.staff_name || user.username}</strong>{' '}
              ({user.email})
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {user.roles.map((r) => (
              <span
                key={r}
                className="px-2.5 py-1 rounded bg-[#EDF2FA] text-[#27447E] text-xs font-semibold"
              >
                {r.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        </div>

        {/* Module Navigation Tabs */}
        <div className="flex flex-wrap gap-2 border-b border-[#E2E8F0] pb-3">
          {canManageVisits && (
            <button
              type="button"
              onClick={() => setActiveTab('visits')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-semibold cursor-pointer ${
                activeTab === 'visits'
                  ? 'bg-[#27447E] text-white'
                  : 'bg-white text-[#202938] border border-[#E2E8F0] hover:bg-[#EDF2FA]'
              }`}
            >
              <ClipboardCheck className="w-4 h-4" />
              Visitor Records &amp; Check-In
            </button>
          )}

          {canUpdateAvailability && (
            <button
              type="button"
              onClick={() => setActiveTab('availability')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-semibold cursor-pointer ${
                activeTab === 'availability'
                  ? 'bg-[#27447E] text-white'
                  : 'bg-white text-[#202938] border border-[#E2E8F0] hover:bg-[#EDF2FA]'
              }`}
            >
              <Clock className="w-4 h-4" />
              Faculty Availability
            </button>
          )}

          {canManageCampus && (
            <button
              type="button"
              onClick={() => setActiveTab('campus_admin')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-semibold cursor-pointer ${
                activeTab === 'campus_admin'
                  ? 'bg-[#27447E] text-white'
                  : 'bg-white text-[#202938] border border-[#E2E8F0] hover:bg-[#EDF2FA]'
              }`}
            >
              <Building2 className="w-4 h-4" />
              Building &amp; Directory Management
            </button>
          )}

          {canViewReports && (
            <button
              type="button"
              onClick={() => setActiveTab('reports')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-semibold cursor-pointer ${
                activeTab === 'reports'
                  ? 'bg-[#27447E] text-white'
                  : 'bg-white text-[#202938] border border-[#E2E8F0] hover:bg-[#EDF2FA]'
              }`}
            >
              <BarChart3 className="w-4 h-4" />
              Operational Reports
            </button>
          )}

          {(canSystemAdmin || canManageCampus) && (
            <button
              type="button"
              onClick={() => setActiveTab('system_admin')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-semibold cursor-pointer ${
                activeTab === 'system_admin'
                  ? 'bg-[#27447E] text-white'
                  : 'bg-white text-[#202938] border border-[#E2E8F0] hover:bg-[#EDF2FA]'
              }`}
            >
              <FileCheck2 className="w-4 h-4" />
              Audit Trail
            </button>
          )}
        </div>

        {feedback && (
          <div
            className={`px-4 py-3 rounded-md text-xs font-medium border ${
              feedback.type === 'ok'
                ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
                : 'bg-red-50 text-red-900 border-red-200'
            }`}
          >
            {feedback.text}
          </div>
        )}

        {/* TAB 1: VISITOR GATE CHECK-IN / CHECK-OUT & LOGS */}
        {activeTab === 'visits' && canManageVisits && (
          <div className="space-y-6">
            {hasAnyRole('SECURITY_RECEPTION', 'SYSTEM_ADMIN') && (
              <form
                onSubmit={handleWalkinSubmit}
                className="bg-white border border-[#E2E8F0] rounded-lg p-5 space-y-4"
              >
                <div className="flex items-center gap-2 text-sm font-bold text-[#202938]">
                  <UserCheck className="w-4 h-4 text-[#27447E]" />
                  Express Security Gate Check-In (Walk-In Visitor)
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <input
                    type="text"
                    required
                    value={walkinName}
                    onChange={(e) => setWalkinName(e.target.value)}
                    placeholder="Visitor Full Name *"
                    className="px-3 py-2 text-xs bg-[#F5F7FA] border border-[#E2E8F0] rounded-md"
                  />
                  <input
                    type="tel"
                    required
                    value={walkinPhone}
                    onChange={(e) => setWalkinPhone(e.target.value)}
                    placeholder="Contact Phone *"
                    className="px-3 py-2 text-xs bg-[#F5F7FA] border border-[#E2E8F0] rounded-md"
                  />
                  <select
                    value={walkinBldgId}
                    onChange={(e) => setWalkinBldgId(e.target.value)}
                    className="px-3 py-2 text-xs bg-[#F5F7FA] border border-[#E2E8F0] rounded-md"
                  >
                    <option value="">General Campus</option>
                    {buildings.map((b) => (
                      <option key={b.building_id} value={b.building_id}>
                        {b.building_code} — {b.building_name}
                      </option>
                    ))}
                  </select>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      required
                      value={walkinPurpose}
                      onChange={(e) => setWalkinPurpose(e.target.value)}
                      placeholder="Purpose *"
                      className="flex-1 px-3 py-2 text-xs bg-[#F5F7FA] border border-[#E2E8F0] rounded-md"
                    />
                    <button
                      type="submit"
                      className="px-3.5 py-2 rounded-md bg-[#27447E] text-white text-xs font-semibold hover:bg-[#1E3666] shrink-0 cursor-pointer"
                    >
                      Check In
                    </button>
                  </div>
                </div>
              </form>
            )}

            {/* Visitor Log Table */}
            <div className="bg-white border border-[#E2E8F0] rounded-lg overflow-hidden">
              <div className="p-4 border-b border-[#E2E8F0] flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <input
                    type="search"
                    value={visitSearch}
                    onChange={(e) => setVisitSearch(e.target.value)}
                    placeholder="Search pass code, visitor, phone..."
                    className="px-3 py-1.5 text-xs bg-[#F5F7FA] border border-[#E2E8F0] rounded-md min-w-[220px]"
                  />
                  <select
                    value={visitStatusFilter}
                    onChange={(e) => setVisitStatusFilter(e.target.value)}
                    className="px-3 py-1.5 text-xs bg-[#F5F7FA] border border-[#E2E8F0] rounded-md"
                  >
                    <option value="">All Statuses</option>
                    <option value="REGISTERED">Registered (Awaiting Entry)</option>
                    <option value="CHECKED_IN">Currently Checked In</option>
                    <option value="CHECKED_OUT">Checked Out</option>
                  </select>
                </div>

                <button
                  type="button"
                  onClick={loadVisits}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-[#E2E8F0] text-xs font-medium text-[#202938] hover:bg-[#F5F7FA] cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Refresh
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-[#F5F7FA] border-b border-[#E2E8F0] text-[#64748B] uppercase tracking-wider text-[11px]">
                      <th className="py-3 px-4">Pass Code</th>
                      <th className="py-3 px-4">Visitor</th>
                      <th className="py-3 px-4">Destination &amp; Host</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4">Check-In / Out</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E8F0]">
                    {visits.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-[#64748B]">
                          No authorised visit records found for this filter.
                        </td>
                      </tr>
                    ) : (
                      visits.map((v) => (
                        <tr key={v.visit_id} className="hover:bg-[#F5F7FA]/60">
                          <td className="py-3 px-4 font-mono font-semibold text-[#27447E]">
                            {v.visit_pass_code}
                          </td>
                          <td className="py-3 px-4">
                            <div className="font-semibold text-[#202938]">{v.visitor_name}</div>
                            <div className="text-[#64748B]">{v.contact_phone}</div>
                          </td>
                          <td className="py-3 px-4">
                            <div className="font-medium text-[#202938]">
                              {v.destination_building_name || 'General Campus'}
                              {v.destination_room_number ? ` (${v.destination_room_number})` : ''}
                            </div>
                            <div className="text-[#64748B]">
                              {v.purpose}
                              {v.host_name ? ` • Host: ${v.host_name}` : ''}
                            </div>
                          </td>
                          <td className="py-3 px-4 space-y-1">
                            <div>
                              <VisitStatusBadge status={v.visit_status} />
                            </div>
                            {v.approval_status !== 'NOT_REQUIRED' && (
                              <div>
                                <VisitStatusBadge status={v.approval_status} />
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-4 text-[#64748B]">
                            <div>
                              In:{' '}
                              {v.check_in_at
                                ? new Date(v.check_in_at).toLocaleTimeString()
                                : '—'}
                            </div>
                            <div>
                              Out:{' '}
                              {v.check_out_at
                                ? new Date(v.check_out_at).toLocaleTimeString()
                                : '—'}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-right space-x-1.5 whitespace-nowrap">
                            {v.approval_status === 'PENDING' && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleVisitAction(v.visit_id, 'APPROVE_HOST')}
                                  className="px-2.5 py-1 rounded bg-emerald-700 text-white font-semibold hover:bg-emerald-800 cursor-pointer"
                                >
                                  Approve
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleVisitAction(v.visit_id, 'REJECT_HOST')}
                                  className="px-2.5 py-1 rounded bg-red-600 text-white font-semibold hover:bg-red-700 cursor-pointer"
                                >
                                  Reject
                                </button>
                              </>
                            )}
                            {v.visit_status === 'REGISTERED' &&
                              v.approval_status !== 'REJECTED' &&
                              hasAnyRole('SECURITY_RECEPTION', 'SYSTEM_ADMIN') && (
                                <button
                                  type="button"
                                  onClick={() => handleVisitAction(v.visit_id, 'CHECK_IN')}
                                  className="px-2.5 py-1 rounded bg-[#27447E] text-white font-semibold hover:bg-[#1E3666] cursor-pointer"
                                >
                                  Check In
                                </button>
                              )}
                            {v.visit_status === 'CHECKED_IN' &&
                              hasAnyRole('SECURITY_RECEPTION', 'SYSTEM_ADMIN') && (
                                <button
                                  type="button"
                                  onClick={() => handleVisitAction(v.visit_id, 'CHECK_OUT')}
                                  className="px-2.5 py-1 rounded border border-[#27447E] text-[#27447E] font-semibold hover:bg-[#EDF2FA] cursor-pointer"
                                >
                                  Check Out
                                </button>
                              )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: FACULTY AVAILABILITY SELF-SERVICE */}
        {activeTab === 'availability' && canUpdateAvailability && (
          <form
            onSubmit={handleAvailabilitySubmit}
            className="bg-white border border-[#E2E8F0] rounded-lg p-6 max-w-xl space-y-4"
          >
            <h2 className="text-base font-bold text-[#202938]">
              Publish Time-Bounded Faculty Availability
            </h2>
            <p className="text-xs text-[#64748B]">
              Published status automatically reverts to <strong>Unknown</strong> once the selected
              validity duration elapses.
            </p>

            <div>
              <label className="block text-xs font-semibold text-[#202938] mb-1">Status</label>
              <select
                value={availState}
                onChange={(e) => setAvailState(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[#F5F7FA] border border-[#E2E8F0] rounded-md"
              >
                <option value="AVAILABLE">Available</option>
                <option value="BUSY_SCHEDULED">Busy / Scheduled</option>
                <option value="UNAVAILABLE">Unavailable</option>
                <option value="UNKNOWN">Clear Status (Unknown)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#202938] mb-1">
                Validity Window
              </label>
              <select
                value={availMinutes}
                onChange={(e) => setAvailMinutes(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm bg-[#F5F7FA] border border-[#E2E8F0] rounded-md"
              >
                <option value={60}>1 Hour</option>
                <option value={180}>3 Hours</option>
                <option value={360}>6 Hours</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#202938] mb-1">
                Public Consultation Note (Optional)
              </label>
              <input
                type="text"
                maxLength={200}
                value={availNote}
                onChange={(e) => setAvailNote(e.target.value)}
                placeholder="e.g. Available for student project review in Cabin G04"
                className="w-full px-3 py-2 text-sm bg-[#F5F7FA] border border-[#E2E8F0] rounded-md"
              />
            </div>

            <button
              type="submit"
              className="px-4 py-2 rounded-md bg-[#27447E] text-white text-xs font-semibold hover:bg-[#1E3666] cursor-pointer"
            >
              Publish Availability
            </button>
          </form>
        )}

        {/* TAB 3: CAMPUS & DIRECTORY ADMINISTRATION */}
        {activeTab === 'campus_admin' && canManageCampus && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {hasAnyRole('FACILITY_ADMIN', 'SYSTEM_ADMIN') && (
              <form
                onSubmit={handleCreateBuilding}
                className="lg:col-span-5 bg-white border border-[#E2E8F0] rounded-lg p-5 space-y-3.5 self-start"
              >
                <h2 className="text-sm font-bold text-[#202938]">Add Campus Building</h2>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-[#64748B] mb-1">
                      Building Code *
                    </label>
                    <input
                      type="text"
                      required
                      value={bCode}
                      onChange={(e) => setBCode(e.target.value)}
                      placeholder="e.g. MECH"
                      className="w-full px-3 py-1.5 text-xs bg-[#F5F7FA] border border-[#E2E8F0] rounded"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-[#64748B] mb-1">
                      Floors *
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      required
                      value={bFloors}
                      onChange={(e) => setBFloors(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs bg-[#F5F7FA] border border-[#E2E8F0] rounded"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-[#64748B] mb-1">
                    Building Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={bName}
                    onChange={(e) => setBName(e.target.value)}
                    placeholder="Department / Block Name"
                    className="w-full px-3 py-1.5 text-xs bg-[#F5F7FA] border border-[#E2E8F0] rounded"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-[#64748B] mb-1">
                    Category
                  </label>
                  <select
                    value={bType}
                    onChange={(e) => setBType(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs bg-[#F5F7FA] border border-[#E2E8F0] rounded"
                  >
                    <option value="ACADEMIC_BLOCK">Academic Block</option>
                    <option value="ADMINISTRATION">Administration</option>
                    <option value="LIBRARY">Library</option>
                    <option value="LABORATORY_COMPLEX">Laboratory Complex</option>
                    <option value="AUDITORIUM">Auditorium</option>
                    <option value="SECURITY_GATE">Security Gate</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-[#64748B] mb-1">
                      WGS84 Latitude *
                    </label>
                    <input
                      type="number"
                      step="0.000001"
                      required
                      value={bLat}
                      onChange={(e) => setBLat(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs bg-[#F5F7FA] border border-[#E2E8F0] rounded"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-[#64748B] mb-1">
                      WGS84 Longitude *
                    </label>
                    <input
                      type="number"
                      step="0.000001"
                      required
                      value={bLng}
                      onChange={(e) => setBLng(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs bg-[#F5F7FA] border border-[#E2E8F0] rounded"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  className="w-full py-2 rounded bg-[#27447E] text-white text-xs font-semibold hover:bg-[#1E3666] cursor-pointer"
                >
                  Save Building Record
                </button>
              </form>
            )}

            <div className="lg:col-span-7 bg-white border border-[#E2E8F0] rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-[#E2E8F0] flex items-center justify-between">
                <h2 className="text-sm font-bold text-[#202938]">
                  Registered Buildings ({buildings.length}) &amp; Departments ({departments.length})
                </h2>
                <Users className="w-4 h-4 text-[#27447E]" />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-[#F5F7FA] border-b border-[#E2E8F0] text-[#64748B]">
                      <th className="py-2.5 px-4">Code</th>
                      <th className="py-2.5 px-4">Building Name</th>
                      <th className="py-2.5 px-4">Coordinates</th>
                      <th className="py-2.5 px-4">Rooms</th>
                      <th className="py-2.5 px-4">Verification</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E8F0]">
                    {buildings.map((b) => (
                      <tr key={b.building_id}>
                        <td className="py-2.5 px-4 font-semibold text-[#27447E]">
                          {b.building_code}
                        </td>
                        <td className="py-2.5 px-4 font-medium text-[#202938]">
                          {b.building_name}
                        </td>
                        <td className="py-2.5 px-4 font-mono text-[11px] text-[#64748B]">
                          {b.latitude.toFixed(5)}, {b.longitude.toFixed(5)}
                        </td>
                        <td className="py-2.5 px-4 text-[#64748B]">{b.public_rooms_count}</td>
                        <td className="py-2.5 px-4 text-[#64748B]">{b.verification_status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: OPERATIONAL REPORTS & SEARCH INSIGHTS */}
        {activeTab === 'reports' && canViewReports && reports && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="bg-white border border-[#E2E8F0] rounded-lg p-4">
                <div className="text-xs text-[#64748B]">Visitors Currently Inside</div>
                <div className="text-2xl font-bold text-[#27447E] mt-1">
                  {reports.kpis.visitors_currently_inside}
                </div>
              </div>
              <div className="bg-white border border-[#E2E8F0] rounded-lg p-4">
                <div className="text-xs text-[#64748B]">30-Day Total Visits</div>
                <div className="text-2xl font-bold text-[#202938] mt-1">
                  {reports.kpis.period_total_visits}
                </div>
              </div>
              <div className="bg-white border border-[#E2E8F0] rounded-lg p-4">
                <div className="text-xs text-[#64748B]">Active Buildings / Rooms</div>
                <div className="text-2xl font-bold text-[#202938] mt-1">
                  {reports.kpis.active_buildings} / {reports.kpis.public_rooms}
                </div>
              </div>
              <div className="bg-white border border-[#E2E8F0] rounded-lg p-4">
                <div className="text-xs text-[#64748B]">Listed Faculty &amp; Staff</div>
                <div className="text-2xl font-bold text-[#202938] mt-1">
                  {reports.kpis.listed_faculty}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Daily Visitor Log Summary */}
              <div className="lg:col-span-7 bg-white border border-[#E2E8F0] rounded-lg overflow-hidden">
                <div className="px-4 py-3 border-b border-[#E2E8F0] text-sm font-bold text-[#202938]">
                  Daily Gate &amp; Destination Summary
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-[#F5F7FA] border-b border-[#E2E8F0] text-[#64748B]">
                        <th className="py-2.5 px-4">Date</th>
                        <th className="py-2.5 px-4">Destination</th>
                        <th className="py-2.5 px-4">Total</th>
                        <th className="py-2.5 px-4">Inside</th>
                        <th className="py-2.5 px-4">Avg Duration</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E8F0]">
                      {reports.daily_visitor_analytics.map((row, idx) => (
                        <tr key={idx}>
                          <td className="py-2.5 px-4 font-medium text-[#202938]">
                            {row.visit_date}
                          </td>
                          <td className="py-2.5 px-4 text-[#64748B]">{row.destination_building}</td>
                          <td className="py-2.5 px-4 font-semibold text-[#27447E]">
                            {row.total_visits}
                          </td>
                          <td className="py-2.5 px-4 text-[#64748B]">{row.currently_inside}</td>
                          <td className="py-2.5 px-4 text-[#64748B]">
                            {row.avg_visit_duration_minutes !== null
                              ? `${row.avg_visit_duration_minutes} min`
                              : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Directory Search Demand Insights */}
              <div className="lg:col-span-5 bg-white border border-[#E2E8F0] rounded-lg p-4 space-y-4">
                <h3 className="text-sm font-bold text-[#202938]">
                  Most Searched Campus Queries
                </h3>
                {reports.search_insights.top_queries.length === 0 ? (
                  <p className="text-xs text-[#64748B]">No search activity recorded yet.</p>
                ) : (
                  <ul className="divide-y divide-[#E2E8F0] text-xs">
                    {reports.search_insights.top_queries.map((item) => (
                      <li key={item.query} className="py-2 flex items-center justify-between">
                        <span className="font-medium text-[#202938]">{item.query}</span>
                        <span className="text-[#64748B]">
                          {item.searches} searches ({item.avg_ms} ms)
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                {reports.search_insights.unmatched_queries.length > 0 && (
                  <div className="pt-3 border-t border-[#E2E8F0] space-y-2">
                    <div className="text-xs font-semibold text-amber-800 flex items-center gap-1.5">
                      <ShieldAlert className="w-3.5 h-3.5" />
                      Unmatched Queries (Candidates for Directory Addition)
                    </div>
                    <ul className="space-y-1 text-xs text-[#64748B]">
                      {reports.search_insights.unmatched_queries.map((u) => (
                        <li key={u.query} className="flex justify-between">
                          <span>"{u.query}"</span>
                          <span>{u.attempts}x</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: AUDIT LOGS */}
        {activeTab === 'system_admin' && (canSystemAdmin || canManageCampus) && (
          <div className="bg-white border border-[#E2E8F0] rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-[#E2E8F0] text-sm font-bold text-[#202938]">
              Administrative &amp; Security Audit Log
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-[#F5F7FA] border-b border-[#E2E8F0] text-[#64748B]">
                    <th className="py-2.5 px-4">Timestamp</th>
                    <th className="py-2.5 px-4">Actor</th>
                    <th className="py-2.5 px-4">Action</th>
                    <th className="py-2.5 px-4">Entity</th>
                    <th className="py-2.5 px-4">Record ID</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0]">
                  {auditLogs.map((log) => (
                    <tr key={log.log_id}>
                      <td className="py-2.5 px-4 text-[#64748B]">
                        {new Date(log.changed_at).toLocaleString()}
                      </td>
                      <td className="py-2.5 px-4 font-medium text-[#202938]">
                        {log.actor_username || 'Public / Trigger'}
                      </td>
                      <td className="py-2.5 px-4 font-semibold text-[#27447E]">
                        {log.action_type}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-[#202938]">{log.table_name}</td>
                      <td className="py-2.5 px-4 text-[#64748B]">#{log.record_id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}
