import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  Accessibility,
  Building2,
  ChevronRight,
  Layers,
  MapPin,
  Users,
} from 'lucide-react';
import { Footer } from '../components/Footer';
import { Header } from '../components/Header';
import { IndoorFloorPlanViewer } from '../components/IndoorFloorPlanViewer';
import { AvailabilityBadge, VerificationBadge } from '../components/StatusBadge';
import { campusApi } from '../services/api';
import type {
  Building,
  BuildingDetailResponse,
  FacultyMember,
  FloorPlanResponse,
  RoomItem,
} from '../types/campus';

export function BuildingIndoorPage() {
  const { buildingId } = useParams<{ buildingId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const [buildings, setBuildings] = useState<Building[]>([]);
  const [detail, setDetail] = useState<BuildingDetailResponse | null>(null);
  const [selectedFloorId, setSelectedFloorId] = useState<number | null>(() => {
    const f = searchParams.get('floor');
    return f ? Number(f) : null;
  });
  const [floorPlanData, setFloorPlanData] = useState<FloorPlanResponse | null>(null);
  const [selectedRoom, setSelectedRoom] = useState<RoomItem | null>(null);
  const [roomOccupants, setRoomOccupants] = useState<FacultyMember[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Directory mode when no buildingId is selected
  useEffect(() => {
    if (buildingId) return;
    setLoading(true);
    campusApi
      .getBuildings()
      .then((rows) => {
        setBuildings(rows);
        setError(null);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [buildingId]);

  // Specific building mode
  useEffect(() => {
    if (!buildingId) return;
    setLoading(true);
    campusApi
      .getBuildingDetail(Number(buildingId))
      .then((res) => {
        setDetail(res);
        setError(null);
        const paramFloor = searchParams.get('floor');
        if (paramFloor && res.floors.some((f) => f.floor_id === Number(paramFloor))) {
          setSelectedFloorId(Number(paramFloor));
        } else if (res.floors.length > 0) {
          setSelectedFloorId(res.floors[0].floor_id);
        } else {
          setSelectedFloorId(null);
        }
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildingId]);

  // Load selected floor's plan + rooms
  useEffect(() => {
    if (!selectedFloorId) {
      setFloorPlanData(null);
      return;
    }
    campusApi
      .getFloorPlan(selectedFloorId)
      .then((fp) => {
        setFloorPlanData(fp);
        const paramRoom = searchParams.get('room');
        if (paramRoom) {
          const match = fp.rooms.find((r) => r.room_id === Number(paramRoom)) || null;
          setSelectedRoom(match);
        } else {
          setSelectedRoom(null);
        }
      })
      .catch(() => setFloorPlanData(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFloorId]);

  // Load assigned faculty when a room is selected
  useEffect(() => {
    if (!selectedRoom) {
      setRoomOccupants([]);
      return;
    }
    campusApi
      .getRoomDetail(selectedRoom.room_id)
      .then((res) => setRoomOccupants(res.occupants))
      .catch(() => setRoomOccupants([]));
  }, [selectedRoom]);

  const handleFloorChange = (floorId: number) => {
    setSelectedFloorId(floorId);
    setSelectedRoom(null);
    setSearchParams({ floor: String(floorId) }, { replace: true });
  };

  const handleRoomSelect = (room: RoomItem) => {
    setSelectedRoom(room);
    if (selectedFloorId) {
      setSearchParams(
        { floor: String(selectedFloorId), room: String(room.room_id) },
        { replace: true }
      );
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#F5F7FA]">
      <Header />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Institutional Breadcrumb: Campus -> Building -> Floor -> Room */}
        <nav
          aria-label="Breadcrumb"
          className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-[#64748B]"
        >
          <Link to="/map" className="hover:text-[#27447E]">
            Campus
          </Link>
          <ChevronRight className="w-3.5 h-3.5" />
          <Link to="/buildings" className="hover:text-[#27447E]">
            Buildings
          </Link>
          {detail && (
            <>
              <ChevronRight className="w-3.5 h-3.5" />
              <span className="text-[#202938] font-semibold">
                {detail.building.building_name}
              </span>
            </>
          )}
          {floorPlanData && (
            <>
              <ChevronRight className="w-3.5 h-3.5" />
              <span className="text-[#27447E] font-semibold">
                {floorPlanData.floor.floor_name}
              </span>
            </>
          )}
          {selectedRoom && (
            <>
              <ChevronRight className="w-3.5 h-3.5" />
              <span className="px-2 py-0.5 rounded bg-[#EDF2FA] text-[#27447E] font-semibold">
                {selectedRoom.room_number}
              </span>
            </>
          )}
        </nav>

        {error && (
          <div className="bg-amber-50 border border-amber-200 rounded-md p-4 text-sm text-amber-900">
            {error}
          </div>
        )}

        {!buildingId ? (
          /* Building Directory Overview */
          <div className="space-y-5">
            <div>
              <h1 className="text-2xl font-bold text-[#202938]">
                Campus Building &amp; Floor Directory
              </h1>
              <p className="text-sm text-[#64748B] mt-1">
                Select any campus building to explore its floors, indoor layouts, classrooms,
                laboratories, and offices.
              </p>
            </div>

            {loading ? (
              <div className="bg-white border border-[#E2E8F0] rounded-lg p-8 text-sm text-[#64748B]">
                Loading campus buildings…
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {buildings.map((b) => (
                  <div
                    key={b.building_id}
                    className="bg-white border border-[#E2E8F0] rounded-lg p-5 flex flex-col justify-between hover:border-[#27447E] transition-colors"
                  >
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="px-2.5 py-0.5 rounded bg-[#EDF2FA] text-[#27447E] text-xs font-semibold">
                          {b.building_code}
                        </span>
                        <VerificationBadge status={b.verification_status} />
                      </div>
                      <h2 className="text-base font-bold text-[#202938]">{b.building_name}</h2>
                      <p className="text-xs text-[#64748B] leading-relaxed">
                        {b.description || b.building_type.replace(/_/g, ' ')}
                      </p>
                    </div>

                    <div className="mt-5 pt-3.5 border-t border-[#E2E8F0] flex items-center justify-between gap-2">
                      <span className="text-xs text-[#64748B]">
                        {b.total_floors} {b.total_floors === 1 ? 'Floor' : 'Floors'}
                        {b.public_rooms_count > 0
                          ? ` • ${b.public_rooms_count} Listed Office${b.public_rooms_count === 1 ? '' : 's'}`
                          : ''}
                      </span>
                      <div className="flex items-center gap-2">
                        <Link
                          to={`/map?building=${b.building_id}`}
                          className="px-2.5 py-1.5 rounded border border-[#E2E8F0] text-xs font-medium text-[#202938] hover:bg-[#F5F7FA]"
                        >
                          Map
                        </Link>
                        <Link
                          to={`/buildings/${b.building_id}`}
                          className="px-3 py-1.5 rounded bg-[#27447E] text-white text-xs font-semibold hover:bg-[#1E3666]"
                        >
                          Explore Floors
                        </Link>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : detail ? (
          /* Single Building & Indoor Floor-Plan View */
          <div className="space-y-6">
            {/* Building Header Card */}
            <div className="bg-white border border-[#E2E8F0] rounded-lg p-5 sm:p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-[#27447E]" />
                  <span className="text-xs font-semibold text-[#27447E]">
                    {detail.building.building_code}
                  </span>
                  <VerificationBadge status={detail.building.verification_status} />
                </div>
                <h1 className="text-2xl font-bold text-[#202938]">
                  {detail.building.building_name}
                </h1>
                {detail.building.description && (
                  <p className="text-sm text-[#64748B] max-w-3xl">
                    {detail.building.description}
                  </p>
                )}
              </div>

              <Link
                to={`/map?building=${detail.building.building_id}`}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md border border-[#27447E] text-[#27447E] text-xs font-semibold hover:bg-[#EDF2FA] shrink-0 self-start md:self-center"
              >
                <MapPin className="w-4 h-4" />
                Locate on Outdoor Map
              </Link>
            </div>

            {/* Intuitive Floor Selector Bar */}
            {detail.floors.length > 0 ? (
              <div className="bg-white border border-[#E2E8F0] rounded-lg p-3 flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-[#64748B] px-2 flex items-center gap-1.5">
                  <Layers className="w-4 h-4 text-[#27447E]" />
                  Floors:
                </span>
                {detail.floors.map((fl) => {
                  const active = fl.floor_id === selectedFloorId;
                  return (
                    <button
                      key={fl.floor_id}
                      type="button"
                      onClick={() => handleFloorChange(fl.floor_id)}
                      className={`px-3.5 py-2 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                        active
                          ? 'bg-[#27447E] text-white'
                          : 'bg-[#F5F7FA] text-[#202938] hover:bg-[#EDF2FA] hover:text-[#27447E]'
                      }`}
                    >
                      {fl.floor_name}
                      {fl.room_count > 0 ? ` (${fl.room_count})` : ''}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="bg-white border border-[#E2E8F0] rounded-lg p-6 text-sm text-[#64748B]">
                Floor records have not yet been configured for this building.
              </div>
            )}

            {/* Indoor Floor Plan + Room Directory */}
            {floorPlanData && (
              <IndoorFloorPlanViewer
                data={floorPlanData}
                selectedRoomId={selectedRoom?.room_id ?? null}
                onSelectRoom={handleRoomSelect}
              />
            )}

            {/* Selected Room Details & Assigned Faculty */}
            {selectedRoom && (
              <div className="bg-white border border-[#27447E] rounded-lg p-5 sm:p-6 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-0.5 rounded bg-[#27447E] text-white text-xs font-semibold">
                        {selectedRoom.room_number}
                      </span>
                      <span className="text-xs font-medium text-[#64748B]">
                        {selectedRoom.room_type.replace(/_/g, ' ')}
                      </span>
                      <VerificationBadge status={selectedRoom.verification_status} />
                    </div>
                    <h2 className="text-lg font-bold text-[#202938] mt-1.5">
                      {selectedRoom.room_name}
                    </h2>
                    {selectedRoom.dept_name && (
                      <p className="text-xs font-medium text-[#27447E] mt-0.5">
                        {selectedRoom.dept_name}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-4 text-xs text-[#64748B]">
                    {selectedRoom.capacity ? (
                      <span>Capacity: {selectedRoom.capacity} seats</span>
                    ) : null}
                    {selectedRoom.is_accessible && (
                      <span className="inline-flex items-center gap-1 text-emerald-800 font-medium">
                        <Accessibility className="w-4 h-4" />
                        Accessible
                      </span>
                    )}
                  </div>
                </div>

                {selectedRoom.description && (
                  <p className="text-sm text-[#64748B]">{selectedRoom.description}</p>
                )}

                {roomOccupants.length > 0 && (
                  <div className="pt-3 border-t border-[#E2E8F0] space-y-2.5">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-[#64748B] flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5 text-[#27447E]" />
                      Assigned Faculty / Staff in {selectedRoom.room_number}
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {roomOccupants.map((occ) => (
                        <div
                          key={occ.staff_id}
                          className="p-3 rounded-md bg-[#F5F7FA] border border-[#E2E8F0] flex items-center justify-between gap-3"
                        >
                          <div>
                            <div className="text-sm font-semibold text-[#202938]">
                              {occ.display_name}
                            </div>
                            <div className="text-xs text-[#64748B]">{occ.designation}</div>
                          </div>
                          <AvailabilityBadge state={occ.effective_availability} />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : null}
      </main>

      <Footer />
    </div>
  );
}
