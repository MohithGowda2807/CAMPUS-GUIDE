import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Award,
  BookOpen,
  Briefcase,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  GraduationCap,
  Info,
  Mail,
  MapPin,
  Search,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { Footer } from '../components/Footer';
import { Header } from '../components/Header';
import { AvailabilityBadge, VerificationBadge } from '../components/StatusBadge';
import { campusApi } from '../services/api';
import type { DepartmentItem, FacultyMember } from '../types/campus';

const PAGE_SIZE = 25;

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

function formatJoiningYear(isoDate: string | null, years: number | null): string | null {
  if (!isoDate) return null;
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) return null;
  const yr = parsed.getFullYear();
  if (years !== null && years >= 1) {
    return `Joined ${yr} (${years} yr${years === 1 ? '' : 's'})`;
  }
  return `Joined ${yr}`;
}

export function DirectoryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') === 'departments' ? 'departments' : 'faculty';

  const [tab, setTab] = useState<'faculty' | 'departments'>(initialTab);
  const [departments, setDepartments] = useState<DepartmentItem[]>([]);
  const [faculty, setFaculty] = useState<FacultyMember[]>([]);
  const [selectedDeptId, setSelectedDeptId] = useState<string>(searchParams.get('dept') || '');
  const [selectedCadre, setSelectedCadre] = useState<string>('');
  const [selectedQualification, setSelectedQualification] = useState<string>('');
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
        qualification: selectedQualification || undefined,
        q: query.trim() || undefined,
      })
      .then(setFaculty)
      .catch(() => setFaculty([]))
      .finally(() => setLoading(false));
  }, [selectedDeptId, selectedCadre, selectedQualification, query]);

  const switchTab = (next: 'faculty' | 'departments') => {
    setTab(next);
    setSearchParams({ tab: next }, { replace: true });
  };

  const kpis = useMemo(() => {
    const academicDepts = departments.filter(
      (d) => d.dept_code !== 'ADMIN' && d.dept_code !== 'SEC'
    );
    const totalFaculty = departments.reduce((acc, d) => acc + Number(d.faculty_count || 0), 0);
    const totalPhd = departments.reduce((acc, d) => acc + Number(d.phd_completed_count || 0), 0);
    const totalProfessors = departments.reduce(
      (acc, d) => acc + Number(d.professors_count || 0),
      0
    );
    return {
      totalFaculty: totalFaculty || faculty.length,
      deptCount: academicDepts.length || departments.length,
      totalPhd,
      totalProfessors,
    };
  }, [departments, faculty.length]);

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
              Official Faculty &amp; Department Directory
            </h1>
            <p className="text-sm text-[#64748B] mt-1">
              Explore R. V. College of Engineering departments, verified teaching faculty roster,
              academic leadership, cabins, and live consultation availability.
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
              Faculty Roster ({faculty.length})
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
              Departments ({departments.length})
            </button>
          </div>
        </div>

        {/* Institutional Roster Summary Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
          <div className="bg-white border border-[#E2E8F0] rounded-lg px-4 py-3.5">
            <div className="text-xs font-medium text-[#64748B]">Listed Teaching &amp; Campus Staff</div>
            <div className="mt-1 text-2xl font-bold text-[#27447E]">{kpis.totalFaculty}</div>
            <div className="text-[11px] text-[#64748B] mt-0.5">Verified institutional directory</div>
          </div>
          <div className="bg-white border border-[#E2E8F0] rounded-lg px-4 py-3.5">
            <div className="text-xs font-medium text-[#64748B]">Academic &amp; Central Units</div>
            <div className="mt-1 text-2xl font-bold text-[#202938]">{kpis.deptCount}</div>
            <div className="text-[11px] text-[#64748B] mt-0.5">UG, PG, Basic Sciences &amp; Library</div>
          </div>
          <div className="bg-white border border-[#E2E8F0] rounded-lg px-4 py-3.5">
            <div className="text-xs font-medium text-[#64748B]">Doctoral Faculty (Ph.D)</div>
            <div className="mt-1 text-2xl font-bold text-[#202938]">{kpis.totalPhd}</div>
            <div className="text-[11px] text-[#64748B] mt-0.5">Awarded doctoral qualification</div>
          </div>
          <div className="bg-white border border-[#E2E8F0] rounded-lg px-4 py-3.5">
            <div className="text-xs font-medium text-[#64748B]">Professors &amp; Senior Leadership</div>
            <div className="mt-1 text-2xl font-bold text-[#202938]">{kpis.totalProfessors}</div>
            <div className="text-[11px] text-[#64748B] mt-0.5">Principal, Deans, HODs &amp; Professors</div>
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
                window expires. Faculty on official university deputation or lien are marked
                accordingly.
              </span>
            </div>

            {/* Search & Multi-Facet Filter Bar */}
            <div className="bg-white border border-[#E2E8F0] rounded-lg p-4 grid grid-cols-1 md:grid-cols-12 gap-3">
              <div className="md:col-span-5 relative">
                <Search className="w-4 h-4 text-[#64748B] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search name, Faculty ID (e.g. 5795), role, or programme..."
                  className="w-full pl-9 pr-3 py-2 text-sm bg-[#F5F7FA] border border-[#E2E8F0] rounded-md focus:bg-white focus:border-[#27447E] outline-none"
                />
              </div>

              <div className="md:col-span-3">
                <select
                  value={selectedDeptId}
                  onChange={(e) => setSelectedDeptId(e.target.value)}
                  aria-label="Filter by Department"
                  className="w-full px-3 py-2 text-sm bg-[#F5F7FA] border border-[#E2E8F0] rounded-md focus:bg-white focus:border-[#27447E] outline-none"
                >
                  <option value="">All Departments</option>
                  {departments.map((d) => (
                    <option key={d.dept_id} value={d.dept_id}>
                      {d.dept_code} — {d.dept_name} ({d.faculty_count})
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-2">
                <select
                  value={selectedCadre}
                  onChange={(e) => setSelectedCadre(e.target.value)}
                  aria-label="Filter by Cadre or Role"
                  className="w-full px-3 py-2 text-sm bg-[#F5F7FA] border border-[#E2E8F0] rounded-md focus:bg-white focus:border-[#27447E] outline-none"
                >
                  <option value="">All Designations</option>
                  <option value="LEADERSHIP">Leadership (Principal / Deans / HODs)</option>
                  <option value="PROFESSOR">Professors</option>
                  <option value="ASSOCIATE_PROFESSOR">Associate Professors</option>
                  <option value="ASSISTANT_PROFESSOR">Assistant Professors</option>
                  <option value="VISITING">Visiting &amp; Adjunct Faculty</option>
                </select>
              </div>

              <div className="md:col-span-2">
                <select
                  value={selectedQualification}
                  onChange={(e) => setSelectedQualification(e.target.value)}
                  aria-label="Filter by Qualification"
                  className="w-full px-3 py-2 text-sm bg-[#F5F7FA] border border-[#E2E8F0] rounded-md focus:bg-white focus:border-[#27447E] outline-none"
                >
                  <option value="">All Qualifications</option>
                  <option value="PHD">Ph.D Awarded</option>
                  <option value="PURSUING_PHD">Pursuing (Ph.D)</option>
                  <option value="POSTGRADUATE">M.Tech / M.E / PG</option>
                </select>
              </div>
            </div>

            {/* Active Filter Summary + Reset */}
            {(selectedDeptId || selectedCadre || selectedQualification || query.trim()) && (
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
                    setSelectedQualification('');
                    setQuery('');
                  }}
                  className="text-[#27447E] font-semibold hover:underline cursor-pointer"
                >
                  Clear all filters
                </button>
              </div>
            )}

            {/* Faculty Cards / Table */}
            <div className="bg-white border border-[#E2E8F0] rounded-lg divide-y divide-[#E2E8F0]">
              {loading ? (
                <div className="p-8 text-center text-sm text-[#64748B]">
                  Loading official faculty directory…
                </div>
              ) : paginatedFaculty.length === 0 ? (
                <div className="p-8 text-center text-sm text-[#64748B]">
                  No faculty records match your current search filter.
                </div>
              ) : (
                paginatedFaculty.map((f) => {
                  const joinLabel = formatJoiningYear(f.date_of_joining, f.years_at_rvce);
                  return (
                    <div
                      key={f.staff_id}
                      className="p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 hover:bg-[#F5F7FA]/60 transition-colors"
                    >
                      <div className="space-y-1.5 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-base font-bold text-[#202938]">{f.display_name}</h2>
                          <span className="px-2 py-0.5 rounded bg-[#EDF2FA] text-[#27447E] text-xs font-semibold">
                            {f.dept_code}
                          </span>
                          <span className="px-2 py-0.5 rounded border border-[#E2E8F0] bg-[#F5F7FA] text-[#64748B] text-[11px] font-mono">
                            ID: {f.employee_code}
                          </span>
                          {f.qualification && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#F8FAFC] border border-[#CBD5E1] text-[#202938] text-[11px] font-medium">
                              <GraduationCap className="w-3 h-3 text-[#27447E]" />
                              {f.qualification}
                            </span>
                          )}
                          {f.leadership_role && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#27447E] text-white text-[11px] font-semibold">
                              <Award className="w-3 h-3" />
                              {f.leadership_role}
                            </span>
                          )}
                          <VerificationBadge status={f.verification_status} />
                        </div>

                        <div className="text-sm font-medium text-[#202938]">
                          {f.designation}{' '}
                          <span className="font-normal text-[#64748B]">• {f.dept_name}</span>
                        </div>

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#64748B] pt-0.5">
                          {f.program_name && (
                            <span className="inline-flex items-center gap-1">
                              <BookOpen className="w-3.5 h-3.5 text-[#27447E]" />
                              {f.program_name}
                            </span>
                          )}
                          {joinLabel && (
                            <span className="inline-flex items-center gap-1">
                              <Calendar className="w-3.5 h-3.5 text-[#64748B]" />
                              {joinLabel}
                            </span>
                          )}
                          <span className="inline-flex items-center gap-1">
                            <Briefcase className="w-3.5 h-3.5 text-[#64748B]" />
                            {f.association_nature === 'REGULAR'
                              ? 'Regular Appointment'
                              : f.employment_mode === 'PART_TIME'
                                ? 'Visiting / Part-Time'
                                : 'Contractual • Full-Time'}
                          </span>
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
                            &ldquo;{f.availability_note}&rdquo;
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
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
          /* Departments List */
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
                    <VerificationBadge status={d.verification_status} />
                  </div>
                  <h2 className="text-base font-bold text-[#202938]">{d.dept_name}</h2>
                  {d.hod_name && (
                    <div className="inline-flex items-center gap-1.5 text-xs text-[#27447E] font-medium">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      Head of Department: {d.hod_name}
                    </div>
                  )}
                  {d.short_description && (
                    <p className="text-xs text-[#64748B] leading-relaxed">
                      {d.short_description}
                    </p>
                  )}
                </div>

                <div className="pt-3 border-t border-[#E2E8F0] flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex flex-wrap items-center gap-3 text-[#64748B]">
                    <span>
                      <strong className="text-[#202938]">{d.faculty_count}</strong> Faculty
                    </span>
                    {typeof d.phd_completed_count === 'number' && d.phd_completed_count > 0 && (
                      <span>
                        • <strong className="text-[#202938]">{d.phd_completed_count}</strong> Ph.D
                      </span>
                    )}
                    {typeof d.professors_count === 'number' && d.professors_count > 0 && (
                      <span>
                        • <strong className="text-[#202938]">{d.professors_count}</strong>{' '}
                        Professors
                      </span>
                    )}
                    {d.room_count > 0 && (
                      <span>
                        • <strong className="text-[#202938]">{d.room_count}</strong> Mapped Spaces
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedDeptId(String(d.dept_id));
                      switchTab('faculty');
                    }}
                    className="font-semibold text-[#27447E] hover:underline cursor-pointer"
                  >
                    View Department Faculty →
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
