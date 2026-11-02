import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Clock, GraduationCap, Info, Mail, MapPin, Search, Users } from 'lucide-react';
import { Footer } from '../components/Footer';
import { Header } from '../components/Header';
import { AvailabilityBadge, VerificationBadge } from '../components/StatusBadge';
import { campusApi } from '../services/api';
import type { DepartmentItem, FacultyMember } from '../types/campus';

function formatSourceLabel(src: string | null): string {
  if (!src) return 'No active status feed';
  const map: Record<string, string> = {
    FACULTY_SELF: 'Faculty Self-Updated',
    DEPARTMENT_OFFICE: 'Department Office',
    APPROVED_SCHEDULE: 'Approved Schedule',
    SYSTEM_EXPIRED: 'Expired',
  };
  return map[src] || src;
}

export function DirectoryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') === 'departments' ? 'departments' : 'faculty';

  const [tab, setTab] = useState<'faculty' | 'departments'>(initialTab);
  const [departments, setDepartments] = useState<DepartmentItem[]>([]);
  const [faculty, setFaculty] = useState<FacultyMember[]>([]);
  const [selectedDeptId, setSelectedDeptId] = useState<string>('');
  const [query, setQuery] = useState<string>(searchParams.get('q') || '');
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    campusApi.getDepartments().then(setDepartments).catch(() => setDepartments([]));
  }, []);

  useEffect(() => {
    setLoading(true);
    campusApi
      .getFaculty({
        dept_id: selectedDeptId ? Number(selectedDeptId) : undefined,
        q: query.trim() || undefined,
      })
      .then(setFaculty)
      .catch(() => setFaculty([]))
      .finally(() => setLoading(false));
  }, [selectedDeptId, query]);

  const switchTab = (next: 'faculty' | 'departments') => {
    setTab(next);
    setSearchParams({ tab: next }, { replace: true });
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#F5F7FA]">
      <Header />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[#202938]">
              Faculty &amp; Department Directory
            </h1>
            <p className="text-sm text-[#64748B] mt-1">
              Locate RVCE academic departments, faculty cabins, and source-verified consultation
              availability.
            </p>
          </div>

          <div className="inline-flex rounded-md border border-[#E2E8F0] bg-white p-1 self-start">
            <button
              type="button"
              onClick={() => switchTab('faculty')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded text-xs font-semibold cursor-pointer ${
                tab === 'faculty'
                  ? 'bg-[#27447E] text-white'
                  : 'text-[#64748B] hover:text-[#202938]'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              Faculty &amp; Staff
            </button>
            <button
              type="button"
              onClick={() => switchTab('departments')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded text-xs font-semibold cursor-pointer ${
                tab === 'departments'
                  ? 'bg-[#27447E] text-white'
                  : 'text-[#64748B] hover:text-[#202938]'
              }`}
            >
              <GraduationCap className="w-3.5 h-3.5" />
              Departments
            </button>
          </div>
        </div>

        {tab === 'faculty' ? (
          <div className="space-y-4">
            {/* Availability Truthfulness Policy Note */}
            <div className="bg-[#EDF2FA] border border-[#CBD5E1] rounded-md px-4 py-2.5 text-xs text-[#202938] flex items-start gap-2.5">
              <Info className="w-4 h-4 text-[#27447E] shrink-0 mt-0.5" />
              <span>
                Availability indicators reflect only current, authorised faculty or department
                updates and automatically revert to <strong>Unknown</strong> once their validity
                window expires. Scheduled classes do not guarantee physical cabin presence.
              </span>
            </div>

            {/* Search & Department Filter Bar */}
            <div className="bg-white border border-[#E2E8F0] rounded-lg p-4 grid grid-cols-1 md:grid-cols-12 gap-3">
              <div className="md:col-span-7 relative">
                <Search className="w-4 h-4 text-[#64748B] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by faculty name or designation..."
                  className="w-full pl-9 pr-3 py-2 text-sm bg-[#F5F7FA] border border-[#E2E8F0] rounded-md focus:bg-white focus:border-[#27447E] outline-none"
                />
              </div>
              <div className="md:col-span-5">
                <select
                  value={selectedDeptId}
                  onChange={(e) => setSelectedDeptId(e.target.value)}
                  aria-label="Filter by Department"
                  className="w-full px-3 py-2 text-sm bg-[#F5F7FA] border border-[#E2E8F0] rounded-md focus:bg-white focus:border-[#27447E] outline-none"
                >
                  <option value="">All Departments</option>
                  {departments.map((d) => (
                    <option key={d.dept_id} value={d.dept_id}>
                      {d.dept_code} — {d.dept_name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Faculty Cards / Table */}
            <div className="bg-white border border-[#E2E8F0] rounded-lg divide-y divide-[#E2E8F0]">
              {loading ? (
                <div className="p-8 text-center text-sm text-[#64748B]">
                  Loading faculty directory…
                </div>
              ) : faculty.length === 0 ? (
                <div className="p-8 text-center text-sm text-[#64748B]">
                  No faculty records match your current search filter.
                </div>
              ) : (
                faculty.map((f) => (
                  <div
                    key={f.staff_id}
                    className="p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 hover:bg-[#F5F7FA]/60 transition-colors"
                  >
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-base font-bold text-[#202938]">{f.display_name}</h2>
                        <span className="px-2 py-0.5 rounded bg-[#EDF2FA] text-[#27447E] text-xs font-semibold">
                          {f.dept_code}
                        </span>
                        <VerificationBadge status={f.verification_status} />
                      </div>
                      <div className="text-sm text-[#64748B]">
                        {f.designation} • {f.dept_name}
                      </div>
                      <div className="flex flex-wrap items-center gap-4 text-xs text-[#64748B] pt-0.5">
                        {f.public_email && (
                          <a
                            href={`mailto:${f.public_email}`}
                            className="inline-flex items-center gap-1 text-[#27447E] hover:underline"
                          >
                            <Mail className="w-3.5 h-3.5" />
                            {f.public_email}
                          </a>
                        )}
                        {f.building_name && f.office_room_number && (
                          <span className="inline-flex items-center gap-1 text-[#202938] font-medium">
                            <MapPin className="w-3.5 h-3.5 text-[#27447E]" />
                            {f.building_name} • {f.floor_name} • Cabin {f.office_room_number}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row lg:flex-col items-start sm:items-center lg:items-end justify-between gap-2.5 shrink-0">
                      <div className="flex items-center gap-2">
                        <AvailabilityBadge state={f.effective_availability} />
                        {f.building_id && (
                          <Link
                            to={
                              f.floor_id && f.office_room_id
                                ? `/buildings/${f.building_id}?floor=${f.floor_id}&room=${f.office_room_id}`
                                : `/map?building=${f.building_id}`
                            }
                            className="px-3 py-1.5 rounded border border-[#27447E] text-[#27447E] text-xs font-semibold hover:bg-[#EDF2FA]"
                          >
                            Locate Office
                          </Link>
                        )}
                      </div>

                      {f.availability_updated_at && (
                        <div className="text-[11px] text-[#64748B] flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          <span>
                            {formatSourceLabel(f.availability_source)} • Updated{' '}
                            {new Date(f.availability_updated_at).toLocaleString()}
                          </span>
                        </div>
                      )}
                      {f.availability_note && f.effective_availability !== 'UNKNOWN' && (
                        <div className="text-xs text-[#202938] italic max-w-xs text-right">
                          "{f.availability_note}"
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : (
          /* Departments List */
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {departments.map((d) => (
              <div
                key={d.dept_id}
                className="bg-white border border-[#E2E8F0] rounded-lg p-5 flex flex-col justify-between space-y-4"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="px-2.5 py-0.5 rounded bg-[#EDF2FA] text-[#27447E] text-xs font-semibold">
                      {d.dept_code}
                    </span>
                    <VerificationBadge status={d.verification_status} />
                  </div>
                  <h2 className="text-base font-bold text-[#202938]">{d.dept_name}</h2>
                  {d.short_description && (
                    <p className="text-xs text-[#64748B] leading-relaxed">
                      {d.short_description}
                    </p>
                  )}
                </div>

                <div className="pt-3 border-t border-[#E2E8F0] flex items-center justify-between text-xs">
                  <span className="text-[#64748B]">
                    {d.faculty_count} Listed Faculty • {d.room_count} Rooms/Labs
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedDeptId(String(d.dept_id));
                      switchTab('faculty');
                    }}
                    className="font-semibold text-[#27447E] hover:underline cursor-pointer"
                  >
                    View Faculty →
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}
