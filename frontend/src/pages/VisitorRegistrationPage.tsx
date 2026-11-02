import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, MapPin, Printer, Shield, UserCheck } from 'lucide-react';
import { Footer } from '../components/Footer';
import { Header } from '../components/Header';
import { VisitStatusBadge } from '../components/StatusBadge';
import { campusApi } from '../services/api';
import type { Building, FacultyMember, VisitPassReceipt } from '../types/campus';

export function VisitorRegistrationPage() {
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [faculty, setFaculty] = useState<FacultyMember[]>([]);

  const [fullName, setFullName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [organization, setOrganization] = useState('');
  const [destinationBuildingId, setDestinationBuildingId] = useState('');
  const [hostStaffId, setHostStaffId] = useState('');
  const [purpose, setPurpose] = useState('');
  const [gateName, setGateName] = useState('Main Mysuru Road Gate');
  const [requiresHostApproval, setRequiresHostApproval] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<VisitPassReceipt | null>(null);

  useEffect(() => {
    campusApi.getBuildings().then(setBuildings).catch(() => setBuildings([]));
    campusApi.getFaculty().then(setFaculty).catch(() => setFaculty([]));
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const created = await campusApi.preRegisterVisitor({
        full_name: fullName.trim(),
        contact_phone: contactPhone.trim(),
        contact_email: contactEmail.trim() || null,
        organization: organization.trim() || null,
        destination_building_id: destinationBuildingId ? Number(destinationBuildingId) : null,
        host_staff_id: hostStaffId ? Number(hostStaffId) : null,
        purpose: purpose.trim(),
        gate_name: gateName,
        requires_host_approval: Boolean(hostStaffId && requiresHostApproval),
      });
      setReceipt(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to submit visitor registration.');
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setReceipt(null);
    setFullName('');
    setContactPhone('');
    setContactEmail('');
    setOrganization('');
    setDestinationBuildingId('');
    setHostStaffId('');
    setPurpose('');
    setRequiresHostApproval(false);
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#F5F7FA]">
      <Header />

      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[#202938]">Visitor Pass Pre-Registration</h1>
          <p className="text-sm text-[#64748B] mt-1">
            Register an upcoming campus visit to expedite verification at the RVCE Security &amp;
            Reception Desk.
          </p>
        </div>

        {receipt ? (
          /* Official Visitor Pass Receipt */
          <div className="bg-white border border-[#27447E] rounded-lg overflow-hidden shadow-xs">
            <div className="bg-[#27447E] text-white px-6 py-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-6 h-6 text-emerald-300 shrink-0" />
                <div>
                  <div className="text-sm font-bold">Visitor Pass Pre-Registration Confirmed</div>
                  <div className="text-xs text-white/80">
                    Present this pass code at {receipt.gate_name} upon arrival.
                  </div>
                </div>
              </div>
              <span className="font-mono text-sm font-bold bg-white/15 px-3 py-1 rounded">
                {receipt.visit_pass_code}
              </span>
            </div>

            <div className="p-6 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-xs text-[#64748B]">Visitor Name</div>
                  <div className="font-semibold text-[#202938] mt-0.5">{receipt.visitor_name}</div>
                </div>
                <div>
                  <div className="text-xs text-[#64748B]">Pass Status</div>
                  <div className="mt-1 flex items-center gap-2">
                    <VisitStatusBadge status={receipt.visit_status} />
                    <VisitStatusBadge status={receipt.approval_status} />
                  </div>
                </div>
                <div>
                  <div className="text-xs text-[#64748B]">Destination</div>
                  <div className="font-medium text-[#202938] mt-0.5">
                    {receipt.destination_building_name || 'General Campus Enquiry'}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-[#64748B]">Host / Contact</div>
                  <div className="font-medium text-[#202938] mt-0.5">
                    {receipt.host_name || 'Reception Desk'}
                  </div>
                </div>
                <div className="sm:col-span-2">
                  <div className="text-xs text-[#64748B]">Purpose of Visit</div>
                  <div className="text-[#202938] mt-0.5">{receipt.purpose}</div>
                </div>
              </div>

              <div className="pt-4 border-t border-[#E2E8F0] flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md border border-[#E2E8F0] text-xs font-semibold text-[#202938] hover:bg-[#F5F7FA] cursor-pointer"
                  >
                    <Printer className="w-4 h-4 text-[#64748B]" />
                    Print / Save Pass
                  </button>
                  <Link
                    to={
                      destinationBuildingId
                        ? `/map?building=${destinationBuildingId}`
                        : '/map'
                    }
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-[#27447E] text-white text-xs font-semibold hover:bg-[#1E3666]"
                  >
                    <MapPin className="w-4 h-4" />
                    Navigate to Destination on Map
                  </Link>
                </div>

                <button
                  type="button"
                  onClick={resetForm}
                  className="text-xs font-semibold text-[#27447E] hover:underline cursor-pointer"
                >
                  Register Another Visitor
                </button>
              </div>
            </div>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="bg-white border border-[#E2E8F0] rounded-lg p-6 sm:p-8 space-y-6"
          >
            {error && (
              <div className="p-3.5 rounded-md bg-red-50 border border-red-200 text-xs text-red-800 font-medium">
                {error}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <label className="block text-xs font-semibold text-[#202938] mb-1.5">
                  Full Name <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  minLength={2}
                  maxLength={120}
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Enter visitor full name"
                  className="w-full px-3 py-2 text-sm bg-[#F5F7FA] border border-[#E2E8F0] rounded-md focus:bg-white focus:border-[#27447E] outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#202938] mb-1.5">
                  Contact Phone Number <span className="text-red-600">*</span>
                </label>
                <input
                  type="tel"
                  required
                  pattern="^[0-9+\-\s()]{7,20}$"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  placeholder="+91-98XXXXXXXX"
                  className="w-full px-3 py-2 text-sm bg-[#F5F7FA] border border-[#E2E8F0] rounded-md focus:bg-white focus:border-[#27447E] outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#202938] mb-1.5">
                  Email Address (Optional)
                </label>
                <input
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="w-full px-3 py-2 text-sm bg-[#F5F7FA] border border-[#E2E8F0] rounded-md focus:bg-white focus:border-[#27447E] outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#202938] mb-1.5">
                  Institution / Organization (Optional)
                </label>
                <input
                  type="text"
                  maxLength={150}
                  value={organization}
                  onChange={(e) => setOrganization(e.target.value)}
                  placeholder="Parent, Alumni, Company, or University"
                  className="w-full px-3 py-2 text-sm bg-[#F5F7FA] border border-[#E2E8F0] rounded-md focus:bg-white focus:border-[#27447E] outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#202938] mb-1.5">
                  Intended Destination Building
                </label>
                <select
                  value={destinationBuildingId}
                  onChange={(e) => setDestinationBuildingId(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-[#F5F7FA] border border-[#E2E8F0] rounded-md focus:bg-white focus:border-[#27447E] outline-none"
                >
                  <option value="">General Campus / Admissions Helpdesk</option>
                  {buildings.map((b) => (
                    <option key={b.building_id} value={b.building_id}>
                      {b.building_code} — {b.building_name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#202938] mb-1.5">
                  Entry Gate
                </label>
                <select
                  value={gateName}
                  onChange={(e) => setGateName(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-[#F5F7FA] border border-[#E2E8F0] rounded-md focus:bg-white focus:border-[#27447E] outline-none"
                >
                  <option value="Main Mysuru Road Gate">Main Mysuru Road Gate</option>
                  <option value="Admin Reception Desk">Admin Reception Desk</option>
                </select>
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-[#202938] mb-1.5">
                  Host Faculty / Staff Member (Optional)
                </label>
                <select
                  value={hostStaffId}
                  onChange={(e) => setHostStaffId(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-[#F5F7FA] border border-[#E2E8F0] rounded-md focus:bg-white focus:border-[#27447E] outline-none"
                >
                  <option value="">No specific individual host (General / Office Visit)</option>
                  {faculty.map((f) => (
                    <option key={f.staff_id} value={f.staff_id}>
                      {f.display_name} — {f.designation} ({f.dept_code})
                    </option>
                  ))}
                </select>
              </div>

              {hostStaffId && (
                <div className="sm:col-span-2 flex items-center gap-2.5 bg-[#EDF2FA] px-3.5 py-2.5 rounded-md border border-[#CBD5E1]">
                  <input
                    id="req-host-approval"
                    type="checkbox"
                    checked={requiresHostApproval}
                    onChange={(e) => setRequiresHostApproval(e.target.checked)}
                    className="rounded border-[#CBD5E1] text-[#27447E]"
                  />
                  <label htmlFor="req-host-approval" className="text-xs text-[#202938]">
                    Request host confirmation prior to gate check-in
                  </label>
                </div>
              )}

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-[#202938] mb-1.5">
                  Purpose of Visit <span className="text-red-600">*</span>
                </label>
                <textarea
                  required
                  minLength={3}
                  maxLength={255}
                  rows={3}
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  placeholder="Briefly state the purpose of your visit (e.g. Admissions enquiry, Academic meeting, Guest lecture)..."
                  className="w-full px-3 py-2 text-sm bg-[#F5F7FA] border border-[#E2E8F0] rounded-md focus:bg-white focus:border-[#27447E] outline-none"
                />
              </div>
            </div>

            <div className="pt-2 border-t border-[#E2E8F0] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start gap-2 text-xs text-[#64748B] max-w-md">
                <Shield className="w-4 h-4 text-[#27447E] shrink-0 mt-0.5" />
                <span>
                  Only essential visit details are collected. Government ID numbers and photographs
                  are not requested online.
                </span>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-md bg-[#27447E] text-white text-sm font-semibold hover:bg-[#1E3666] disabled:opacity-60 transition-colors cursor-pointer shrink-0"
              >
                <UserCheck className="w-4 h-4" />
                {submitting ? 'Generating Pass…' : 'Submit Registration'}
              </button>
            </div>
          </form>
        )}
      </main>

      <Footer />
    </div>
  );
}
