import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Building2,
  Compass,
  GraduationCap,
  Landmark,
  MapPin,
  Search,
  UserCheck,
  Users,
} from 'lucide-react';
import { CampusLeafletMap } from '../components/CampusLeafletMap';
import { Footer } from '../components/Footer';
import { Header } from '../components/Header';
import { campusApi } from '../services/api';
import type { Building, FacilityItem, MapConfigResponse } from '../types/campus';

const QUICK_ACCESS_CARDS = [
  {
    title: 'Campus Map',
    description: 'Interactive outdoor map of RVCE buildings, entrances, and walkways.',
    to: '/map',
    icon: Compass,
  },
  {
    title: 'Find a Department',
    description: 'Locate academic departments, offices, and associated laboratories.',
    to: '/directory?tab=departments',
    icon: GraduationCap,
  },
  {
    title: 'Find a Faculty Member',
    description: 'View faculty designations, cabin locations, and verified availability.',
    to: '/directory?tab=faculty',
    icon: Users,
  },
  {
    title: 'Campus Facilities',
    description: 'Browse library, cafeteria, reception gates, parking, and banking amenities.',
    to: '/facilities',
    icon: Landmark,
  },
  {
    title: 'Visitor Registration',
    description: 'Pre-register a campus visit and obtain an official gate entry pass code.',
    to: '/visitor-registration',
    icon: UserCheck,
  },
  {
    title: 'Building Directory',
    description: 'Explore multi-floor academic blocks and interactive indoor floor layouts.',
    to: '/buildings',
    icon: Building2,
  },
];

export function HomePage() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [mapConfig, setMapConfig] = useState<MapConfigResponse | null>(null);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [facilities, setFacilities] = useState<FacilityItem[]>([]);

  useEffect(() => {
    campusApi.getMapConfig().then(setMapConfig).catch(() => null);
    campusApi.getBuildings().then(setBuildings).catch(() => setBuildings([]));
    campusApi.getFacilities().then(setFacilities).catch(() => setFacilities([]));
  }, []);

  const handlePreviewSearch = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = searchQuery.trim();
    if (trimmed) {
      navigate(`/map?q=${encodeURIComponent(trimmed)}`);
    } else {
      navigate('/map');
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#F5F7FA]">
      <Header />

      <main className="flex-1">
        {/* Institutional Hero Section */}
        <section className="bg-white border-b border-[#E2E8F0]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
              <div className="lg:col-span-7 space-y-5">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#EDF2FA] text-[#27447E] text-xs font-semibold">
                  <MapPin className="w-3.5 h-3.5" />
                  R. V. College of Engineering, Bengaluru
                </div>

                <h1 className="text-3xl sm:text-4xl font-bold text-[#202938] tracking-tight leading-tight">
                  Explore RVCE Campus
                </h1>

                <p className="text-base sm:text-lg text-[#64748B] leading-relaxed max-w-2xl">
                  Find buildings, departments, facilities and destinations across the RVCE campus.
                </p>

                <div className="flex flex-wrap items-center gap-3.5 pt-2">
                  <Link
                    to="/map"
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-[#27447E] text-white text-sm font-semibold hover:bg-[#1E3666] transition-colors"
                  >
                    <Compass className="w-4 h-4" />
                    Explore Campus Map
                  </Link>
                  <Link
                    to="/visitor-registration"
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-white text-[#27447E] border border-[#27447E] text-sm font-semibold hover:bg-[#EDF2FA] transition-colors"
                  >
                    <UserCheck className="w-4 h-4" />
                    Visitor Registration
                  </Link>
                </div>
              </div>

              {/* Institutional Campus Identity Panel */}
              <div className="lg:col-span-5">
                <div className="bg-[#EDF2FA] border border-[#E2E8F0] rounded-lg p-6 space-y-4">
                  <div className="flex items-center gap-3.5 pb-4 border-b border-[#CBD5E1]/70">
                    <img
                      src="/assets/rvce-logo.png"
                      alt="RV College of Engineering Official Logo"
                      className="h-14 object-contain"
                    />
                  </div>
                  <div className="space-y-2 text-sm text-[#202938]">
                    <div className="font-semibold text-[#27447E]">
                      Unified Outdoor &amp; Indoor Wayfinding
                    </div>
                    <p className="text-xs text-[#64748B] leading-relaxed">
                      Search academic blocks, lecture halls, laboratories, administrative offices,
                      and faculty cabins from a single verified campus directory.
                    </p>
                  </div>
                  <form onSubmit={handlePreviewSearch} className="flex gap-2 pt-1">
                    <div className="relative flex-1">
                      <Search className="w-4 h-4 text-[#64748B] absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="search"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search building, room, or department..."
                        className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-[#E2E8F0] rounded-md focus:border-[#27447E] outline-none"
                      />
                    </div>
                    <button
                      type="submit"
                      className="px-4 py-2 rounded-md bg-[#27447E] text-white text-sm font-semibold hover:bg-[#1E3666] transition-colors shrink-0 cursor-pointer"
                    >
                      Search
                    </button>
                  </form>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Quick Access Section */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="mb-6">
            <h2 className="text-xl font-bold text-[#202938]">Campus Portal Services</h2>
            <p className="text-sm text-[#64748B] mt-1">
              Direct access to campus navigation, directories, and visitor reception services.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {QUICK_ACCESS_CARDS.map((card) => {
              const Icon = card.icon;
              return (
                <Link
                  key={card.title}
                  to={card.to}
                  className="bg-white border border-[#E2E8F0] rounded-lg p-5 hover:border-[#27447E] transition-colors group flex flex-col justify-between"
                >
                  <div>
                    <div className="w-10 h-10 rounded-md bg-[#EDF2FA] text-[#27447E] flex items-center justify-center mb-3.5 group-hover:bg-[#27447E] group-hover:text-white transition-colors">
                      <Icon className="w-5 h-5" />
                    </div>
                    <h3 className="text-base font-semibold text-[#202938] group-hover:text-[#27447E] transition-colors">
                      {card.title}
                    </h3>
                    <p className="text-sm text-[#64748B] mt-1.5 leading-relaxed">
                      {card.description}
                    </p>
                  </div>
                  <div className="mt-4 pt-3 border-t border-[#F5F7FA] inline-flex items-center gap-1.5 text-xs font-semibold text-[#27447E]">
                    Open Service
                    <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                  </div>
                </Link>
              );
            })}
          </div>
        </section>

        {/* Interactive Campus Navigation Preview */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-14">
          <div className="bg-white border border-[#E2E8F0] rounded-lg overflow-hidden">
            <div className="p-5 sm:p-6 border-b border-[#E2E8F0] flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-[#202938]">
                  RVCE Mysuru Road Campus — Map Preview
                </h2>
                <p className="text-sm text-[#64748B] mt-0.5">
                  Select any building marker or open the full-screen navigator for indoor floor
                  plans and room search.
                </p>
              </div>
              <Link
                to="/map"
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-[#27447E] text-white text-sm font-semibold hover:bg-[#1E3666] transition-colors shrink-0"
              >
                Open Full Interactive Map
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>

            <div className="h-[420px] w-full">
              <CampusLeafletMap
                center={mapConfig?.center}
                tileUrl={mapConfig?.tile_layer.url}
                attribution={mapConfig?.tile_layer.attribution}
                buildings={buildings}
                facilities={facilities}
                geometries={mapConfig?.geometries}
                previewMode={true}
                onSelectBuilding={(b) => navigate(`/map?building=${b.building_id}`)}
                onSelectFacility={(f) => navigate(`/map?facility=${f.facility_id}`)}
              />
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
