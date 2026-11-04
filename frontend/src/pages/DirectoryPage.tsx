import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Award,
  ChevronLeft,
  ChevronRight,
  GraduationCap,
  Mail,
  MapPin,
  Search,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { Footer } from '../components/Footer';
import { Header } from '../components/Header';
import { AvailabilityBadge } from '../components/StatusBadge';
import { campusApi } from '../services/api';
import type { DepartmentItem, FacultyMember } from '../types/campus';

const PAGE_SIZE = 25;

function formatCategoryLabel(cat?: string): string {
  switch (cat) {
    case 'ENGINEERING':
      return 'Engineering Department';
    case 'PG_PROGRAMME':
      return 'Postgraduate Programme';
    case 'BASIC_SCIENCES':
      return 'Basic Sciences';
    case 'CAMPUS_CENTRAL':
      return 'Central Campus Unit';
    default:
      return 'Institutional Unit';
  }
}

export function DirectoryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') === 'departments' ? 'departments' : 'faculty';

  const [tab, setTab] = useState<'faculty' | 'departments'>(initialTab);
  const [departments, setDepartments] = useState<DepartmentItem[]>([]);
  const [faculty, setFaculty] = useState<FacultyMember[]>([]);
  const [selectedDeptId, setSelectedDeptId] = useState<string>(searchParams.get('dept') || '');
  const [selectedCadre, setSelectedCadre] = useState<string>('');
  const [query, setQuery] = useState<string>(searchParams.get('q') || '');
  const [page, setPage] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    campusApi.getDepartments().then(setDepartments).catch(() => setDepartments([]));
  }, []);

  useEffect(() => {
    setLoading(true);
    setPage(1);
    campusApi
      .getFaculty({
        dept_id: selectedDeptId ? Number(selectedDeptId) : undefined,
        cadre: selectedCadre || undefined,
        q: query.trim() || undefined,
      })
      .then(setFaculty)
      .catch(() => setFaculty([]))
      .finally(() => setLoading(false));
  }, [selectedDeptId, selectedCadre, query]);

  const switchTab = (next: 'faculty' | 'departments') => {
    setTab(next);
    setSearchParams({ tab: next }, { replace: true });
  };

  const totalPages = Math.max(1, Math.ceil(faculty.length / PAGE_SIZE));
  const paginatedFaculty = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return faculty.slice(start, start + PAGE_SIZE);
  }, [faculty, page]);

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
              Find R. V. College of Engineering departments, faculty members, leadership offices,
              and campus building locations.
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
              Faculty
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
            {/* Visitor-Focused Search & Filter Bar */}
            <div className="bg-white border border-[#E2E8F0] rounded-lg p-4 grid grid-cols-1 md:grid-cols-12 gap-3">
              <div className="md:col-span-5 relative">
                <Search className="w-4 h-4 text-[#64748B] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by faculty name, designation, or department..."
                  className="w-full pl-9 pr-3 py-2 text-sm bg-[#F5F7FA] border border-[#E2E8F0] rounded-md focus:bg-white focus:border-[#27447E] outline-none"
                />
              </div>

              <div className="md:col-span-4">
                <select
                  value={selectedDeptId}
                  onChange={(e) => setSelectedDeptId(e.target.value)}
                  aria-label="Filter by Department"
                  className="w-full px-3 py-2 text-sm bg-[#F5F7FA] border border-[#E2E8F0] rounded-md focus:bg-white focus:border-[#27447E] outline-none"
                >
                  <option value="">All Departments</option>
                  {departments
                    .filter((d) => d.faculty_count > 0)
                    .map((d) => (
                      <option key={d.dept_id} value={d.dept_id}>
                        {d.dept_code} — {d.dept_name}
                      </option>
                    ))}
                </select>
              </div>

              <div className="md:col-span-3">
                <select
                  value={selectedCadre}
                  onChange={(e) => setSelectedCadre(e.target.value)}
                  aria-label="Filter by Role"
                  className="w-full px-3 py-2 text-sm bg-[#F5F7FA] border border-[#E2E8F0] rounded-md focus:bg-white focus:border-[#27447E] outline-none"
                >
                  <option value="">All Roles</option>
                  <option value="LEADERSHIP">Leadership (Principal, Deans &amp; HODs)</option>
                  <option value="PROFESSOR">Professors</option>
                  <option value="ASSOCIATE_PROFESSOR">Associate Professors</option>
                  <option value="ASSISTANT_PROFESSOR">Assistant Professors</option>
                </select>
              </div>
            </div>

            {/* Active Filter Summary + Reset */}
            {(selectedDeptId || selectedCadre || query.trim()) && (
              <div className="flex items-center justify-between text-xs text-[#64748B] px-1">
                <span>
                  Showing <strong className="text-[#202938]">{faculty.length}</strong> matching
                  faculty member{faculty.length === 1 ? '' : 's'}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedDeptId('');
                    setSelectedCadre('');
                    setQuery('');
                  }}
                  className="text-[#27447E] font-semibold hover:underline cursor-pointer"
                >
                  Clear filters
                </button>
              </div>
            )}

            {/* Clean Visitor Faculty List */}
            <div className="bg-white border border-[#E2E8F0] rounded-lg divide-y divide-[#E2E8F0]">
              {loading ? (
                <div className="p-8 text-center text-sm text-[#64748B]">
                  Loading faculty directory…
                </div>
              ) : paginatedFaculty.length === 0 ? (
                <div className="p-8 text-center text-sm text-[#64748B]">
                  No faculty members match your search criteria.
                </div>
              ) : (
                paginatedFaculty.map((f) => (
                  <div
                    key={f.staff_id}
                    className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-[#F5F7FA]/60 transition-colors"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-base font-bold text-[#202938]">{f.display_name}</h2>
                        <span className="px-2 py-0.5 rounded bg-[#EDF2FA] text-[#27447E] text-xs font-semibold">
                          {f.dept_code}
                        </span>
                        {f.leadership_role && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#27447E] text-white text-[11px] font-semibold">
                            <Award className="w-3 h-3" />
                            {f.leadership_role}
                          </span>
                        )}
                      </div>

                      <div className="text-sm text-[#202938]">
                        <span className="font-medium">{f.designation}</span>{' '}
                        <span className="text-[#64748B]">• {f.dept_name}</span>
                      </div>

                      {(f.building_name || f.public_email) && (
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#64748B] pt-0.5">
                          {f.building_name && (
                            <span className="inline-flex items-center gap-1 text-[#202938]">
                              <MapPin className="w-3.5 h-3.5 text-[#27447E] shrink-0" />
                              <span>
                                {f.building_name}
                                {f.office_room_name
                                  ? ` • ${f.office_room_name}`
                                  : f.office_room_number
                                    ? ` • ${f.office_room_number}`
                                    : ''}
                              </span>
                            </span>
                          )}
                          {f.public_email && (
                            <a
                              href={`mailto:${f.public_email}`}
                              className="inline-flex items-center gap-1 text-[#27447E] hover:underline"
                            >
                              <Mail className="w-3.5 h-3.5" />
                              {f.public_email}
                            </a>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col sm:items-end gap-1.5 shrink-0">
                      <div className="flex items-center gap-2">
                        {f.effective_availability !== 'UNKNOWN' && (
                          <AvailabilityBadge state={f.effective_availability} />
                        )}
                        {f.building_id && (
                          <Link
                            to={`/map?building=${f.building_id}`}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-[#27447E] text-[#27447E] text-xs font-semibold hover:bg-[#EDF2FA] transition-colors"
                          >
                            <MapPin className="w-3.5 h-3.5" />
                            Locate on Map
                          </Link>
                        )}
                      </div>

                      {f.availability_note && f.effective_availability !== 'UNKNOWN' && (
                        <div className="text-xs text-[#64748B] max-w-xs sm:text-right">
                          {f.availability_note}
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Pagination Footer */}
            {!loading && faculty.length > PAGE_SIZE && (
              <div className="bg-white border border-[#E2E8F0] rounded-lg px-4 py-3 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-[#64748B]">
                <div>
                  Showing{' '}
                  <strong className="text-[#202938]">
                    {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, faculty.length)}
                  </strong>{' '}
                  of <strong className="text-[#202938]">{faculty.length}</strong> faculty members
                </div>
                <div className="inline-flex items-center gap-2">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded border border-[#E2E8F0] bg-[#F5F7FA] text-[#202938] font-medium disabled:opacity-40 hover:border-[#27447E] cursor-pointer disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    Previous
                  </button>
                  <span className="px-2 font-medium text-[#202938]">
                    Page {page} of {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded border border-[#E2E8F0] bg-[#F5F7FA] text-[#202938] font-medium disabled:opacity-40 hover:border-[#27447E] cursor-pointer disabled:cursor-not-allowed"
                  >
                    Next
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Clean Visitor Department Cards */
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {departments.map((d) => (
              <div
                key={d.dept_id}
                className="bg-white border border-[#E2E8F0] rounded-lg p-5 flex flex-col justify-between space-y-4"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-0.5 rounded bg-[#EDF2FA] text-[#27447E] text-xs font-semibold">
                        {d.dept_code}
                      </span>
                      <span className="text-[11px] text-[#64748B] font-medium">
                        {formatCategoryLabel(d.dept_category)}
                      </span>
                    </div>
                  </div>
                  <h2 className="text-base font-bold text-[#202938]">{d.dept_name}</h2>
                  {d.hod_name && (
                    <div className="inline-flex items-center gap-1.5 text-xs text-[#27447E] font-medium">
                      <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                      <span>Head of Department: {d.hod_name}</span>
                    </div>
                  )}
                  {d.primary_building_name && (
                    <div className="flex items-center gap-1.5 text-xs text-[#202938]">
                      <MapPin className="w-3.5 h-3.5 text-[#27447E] shrink-0" />
                      <span>{d.primary_building_name}</span>
                    </div>
                  )}
                  {d.short_description && (
                    <p className="text-xs text-[#64748B] leading-relaxed">
                      {d.short_description}
                    </p>
                  )}
                </div>

                <div className="pt-3 border-t border-[#E2E8F0] flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-3 text-[#64748B]">
                    {d.official_email && (
                      <a
                        href={`mailto:${d.official_email}`}
                        className="inline-flex items-center gap-1 text-[#27447E] hover:underline"
                      >
                        <Mail className="w-3.5 h-3.5" />
                        {d.official_email}
                      </a>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {d.primary_building_id && (
                      <Link
                        to={`/map?building=${d.primary_building_id}`}
                        className="inline-flex items-center gap-1 font-semibold text-[#202938] hover:text-[#27447E]"
                      >
                        <MapPin className="w-3.5 h-3.5 text-[#27447E]" />
                        Locate Building
                      </Link>
                    )}
                    {d.faculty_count > 0 && (
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
                    )}
                  </div>
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
