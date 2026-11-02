import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Accessibility, Clock, Landmark, MapPin, Search } from 'lucide-react';
import { Footer } from '../components/Footer';
import { Header } from '../components/Header';
import { VerificationBadge } from '../components/StatusBadge';
import { campusApi } from '../services/api';
import type { FacilityItem } from '../types/campus';

const FACILITY_CATEGORIES = [
  { code: '', label: 'All Facilities' },
  { code: 'GATE_RECEPTION', label: 'Gates & Reception' },
  { code: 'LIBRARY', label: 'Library' },
  { code: 'ADMIN_SERVICE', label: 'Administrative Services' },
  { code: 'CAFETERIA_FOOD', label: 'Cafeteria & Dining' },
  { code: 'BANK_ATM', label: 'Bank & ATM' },
  { code: 'PARKING', label: 'Visitor Parking' },
];

export function FacilitiesPage() {
  const [facilities, setFacilities] = useState<FacilityItem[]>([]);
  const [category, setCategory] = useState<string>('');
  const [query, setQuery] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    setLoading(true);
    campusApi
      .getFacilities({
        category: category || undefined,
        q: query.trim() || undefined,
      })
      .then(setFacilities)
      .catch(() => setFacilities([]))
      .finally(() => setLoading(false));
  }, [category, query]);

  return (
    <div className="min-h-screen flex flex-col bg-[#F5F7FA]">
      <Header />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[#202938]">Campus Facilities &amp; Services</h1>
          <p className="text-sm text-[#64748B] mt-1">
            Essential visitor amenities, administrative helpdesks, library services, parking zones,
            and reception gates across RVCE.
          </p>
        </div>

        {/* Filter Controls */}
        <div className="bg-white border border-[#E2E8F0] rounded-lg p-4 space-y-3">
          <div className="relative max-w-md">
            <Search className="w-4 h-4 text-[#64748B] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search facilities (e.g. Library, ATM, Parking, Reception)..."
              className="w-full pl-9 pr-3 py-2 text-sm bg-[#F5F7FA] border border-[#E2E8F0] rounded-md focus:bg-white focus:border-[#27447E] outline-none"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {FACILITY_CATEGORIES.map((c) => {
              const active = category === c.code;
              return (
                <button
                  key={c.code}
                  type="button"
                  onClick={() => setCategory(c.code)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors cursor-pointer ${
                    active
                      ? 'bg-[#27447E] text-white border-[#27447E]'
                      : 'bg-white text-[#64748B] border-[#E2E8F0] hover:border-[#27447E] hover:text-[#27447E]'
                  }`}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
        </div>

        {loading ? (
          <div className="bg-white border border-[#E2E8F0] rounded-lg p-8 text-center text-sm text-[#64748B]">
            Loading campus facilities…
          </div>
        ) : facilities.length === 0 ? (
          <div className="bg-white border border-[#E2E8F0] rounded-lg p-8 text-center text-sm text-[#64748B]">
            No facilities match the selected filter.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {facilities.map((fc) => (
              <div
                key={fc.facility_id}
                className="bg-white border border-[#E2E8F0] rounded-lg p-5 flex flex-col justify-between space-y-4 hover:border-[#27447E] transition-colors"
              >
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-[#EDF2FA] text-[#27447E] text-xs font-semibold">
                      <Landmark className="w-3.5 h-3.5" />
                      {fc.category.replace(/_/g, ' ')}
                    </span>
                    <VerificationBadge status={fc.verification_status} />
                  </div>

                  <h2 className="text-base font-bold text-[#202938]">{fc.facility_name}</h2>

                  {fc.description && (
                    <p className="text-xs text-[#64748B] leading-relaxed">{fc.description}</p>
                  )}

                  <div className="space-y-1 pt-1 text-xs text-[#64748B]">
                    {fc.building_name && (
                      <div className="text-[#202938] font-medium">
                        {fc.building_name}
                        {fc.floor_name ? ` • ${fc.floor_name}` : ''}
                        {fc.room_number ? ` (${fc.room_number})` : ''}
                      </div>
                    )}
                    {fc.opening_hours && (
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-[#27447E]" />
                        <span>{fc.opening_hours}</span>
                      </div>
                    )}
                    {fc.is_accessible && (
                      <div className="flex items-center gap-1.5 text-emerald-800 font-medium">
                        <Accessibility className="w-3.5 h-3.5" />
                        <span>Accessible Access</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="pt-3 border-t border-[#E2E8F0] flex items-center justify-end gap-2">
                  {fc.building_id && fc.floor_id && fc.room_id ? (
                    <Link
                      to={`/buildings/${fc.building_id}?floor=${fc.floor_id}&room=${fc.room_id}`}
                      className="px-3 py-1.5 rounded border border-[#E2E8F0] text-xs font-medium text-[#202938] hover:bg-[#F5F7FA]"
                    >
                      Indoor Plan
                    </Link>
                  ) : null}
                  <Link
                    to={
                      fc.building_id
                        ? `/map?building=${fc.building_id}`
                        : `/map?facility=${fc.facility_id}`
                    }
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-[#27447E] text-white text-xs font-semibold hover:bg-[#1E3666]"
                  >
                    <MapPin className="w-3.5 h-3.5" />
                    Show on Map
                  </Link>
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
