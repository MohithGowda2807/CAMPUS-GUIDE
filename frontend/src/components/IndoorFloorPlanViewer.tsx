import { useMemo, useState } from 'react';
import {
  Accessibility,
  AlertCircle,
  Info,
  Maximize2,
  RotateCcw,
  Search,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { FloorPlanResponse, RoomItem } from '../types/campus';
import { VerificationBadge } from './StatusBadge';

interface IndoorFloorPlanViewerProps {
  data: FloorPlanResponse;
  selectedRoomId: number | null;
  onSelectRoom: (room: RoomItem) => void;
}

const ROOM_CATEGORY_FILL: Record<string, string> = {
  CLASSROOM: '#F8FAFC',
  LABORATORY: '#EFF6FF',
  SEMINAR_HALL: '#F0F9FF',
  FACULTY_OFFICE: '#F5F7FA',
  HOD_CABIN: '#EDF2FA',
  ADMIN_OFFICE: '#F8FAFC',
  LIBRARY_ZONE: '#F0FDF4',
  RECEPTION: '#FEFCE8',
};

export function IndoorFloorPlanViewer({
  data,
  selectedRoomId,
  onSelectRoom,
}: IndoorFloorPlanViewerProps) {
  const [zoom, setZoom] = useState<number>(1);
  const [roomFilter, setRoomFilter] = useState<string>('');

  const canvasW = data.overlay?.canvas.width ?? data.floor_plan?.canvas_width ?? 1000;
  const canvasH = data.overlay?.canvas.height ?? data.floor_plan?.canvas_height ?? 650;

  const roomById = useMemo(() => {
    const map = new Map<number, RoomItem>();
    for (const r of data.rooms) {
      map.set(r.room_id, r);
    }
    return map;
  }, [data.rooms]);

  const filteredRooms = useMemo(() => {
    const q = roomFilter.trim().toLowerCase();
    if (!q) return data.rooms;
    return data.rooms.filter(
      (r) =>
        r.room_number.toLowerCase().includes(q) ||
        r.room_name.toLowerCase().includes(q) ||
        r.room_type.toLowerCase().includes(q)
    );
  }, [data.rooms, roomFilter]);

  const isSchematic =
    data.floor_plan?.is_schematic_sample || data.overlay?.is_schematic_sample || false;

  return (
    <div className="space-y-4">
      {/* Schematic / Source Verification Notice */}
      {isSchematic && (
        <div className="bg-amber-50 border border-amber-200 rounded-md px-4 py-2.5 text-xs text-amber-900 flex items-start gap-2.5">
          <Info className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold">Schematic Floor Layout (Sample Data):</span> Local
            room coordinates shown below are illustrative development schematics. Official RVCE
            architectural floor drawings replace this layer upon departmental approval.
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Interactive Local-Coordinate SVG Floor Plan Area */}
        <div className="lg:col-span-8 bg-white border border-[#E2E8F0] rounded-lg overflow-hidden flex flex-col">
          {/* Viewer Toolbar */}
          <div className="px-4 py-2.5 border-b border-[#E2E8F0] bg-[#F5F7FA] flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-medium text-[#202938]">
              <Maximize2 className="w-3.5 h-3.5 text-[#27447E]" />
              <span>
                {data.floor.building_name} — {data.floor.floor_name}
              </span>
              {data.floor_plan && (
                <span className="text-[#64748B]">({data.floor_plan.version_label})</span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(0.75, +(z - 0.2).toFixed(2)))}
                className="p-1.5 rounded border border-[#E2E8F0] bg-white hover:bg-[#EDF2FA] text-[#202938] cursor-pointer"
                title="Zoom out floor plan"
                aria-label="Zoom out floor plan"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="text-xs font-medium text-[#64748B] min-w-[44px] text-center">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(2.2, +(z + 0.2).toFixed(2)))}
                className="p-1.5 rounded border border-[#E2E8F0] bg-white hover:bg-[#EDF2FA] text-[#202938] cursor-pointer"
                title="Zoom in floor plan"
                aria-label="Zoom in floor plan"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setZoom(1)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[#E2E8F0] bg-white hover:bg-[#EDF2FA] text-xs font-medium text-[#202938] cursor-pointer"
                title="Reset floor plan zoom"
              >
                <RotateCcw className="w-3 h-3" />
                Reset
              </button>
            </div>
          </div>

          {/* Floor Plan Canvas */}
          {data.floor_plan && data.overlay ? (
            <div className="overflow-auto bg-[#F8FAFC] p-4 flex-1 min-h-[360px] flex items-center justify-center">
              <div
                style={{
                  width: `${Math.round(680 * zoom)}px`,
                  maxWidth: zoom === 1 ? '100%' : 'none',
                }}
                className="transition-all duration-150"
              >
                <svg
                  viewBox={`0 0 ${canvasW} ${canvasH}`}
                  className="w-full h-auto bg-white border border-[#CBD5E1] rounded shadow-xs select-none"
                  role="img"
                  aria-label={`Indoor floor plan for ${data.floor.building_name} ${data.floor.floor_name}`}
                >
                  {/* Outer Architectural Slab */}
                  <rect
                    x={50}
                    y={55}
                    width={canvasW - 100}
                    height={canvasH - 110}
                    rx={8}
                    fill="#FFFFFF"
                    stroke="#64748B"
                    strokeWidth={3}
                  />

                  {/* Walkable Corridors */}
                  {data.overlay.corridors.map((c, idx) => (
                    <g key={`corridor-${idx}`}>
                      <rect
                        x={c.x}
                        y={c.y}
                        width={c.w}
                        height={c.h}
                        fill="#F1F5F9"
                        stroke="#E2E8F0"
                        strokeDasharray="4 4"
                      />
                      {c.label && c.w > 250 && (
                        <text
                          x={c.x + c.w / 2}
                          y={c.y + c.h / 2 + 4}
                          textAnchor="middle"
                          fontSize={12}
                          fill="#64748B"
                          fontWeight={500}
                        >
                          {c.label}
                        </text>
                      )}
                    </g>
                  ))}

                  {/* Interactive Selectable Rooms (Local Normalized Coordinates) */}
                  {data.overlay.rooms.map((poly) => {
                    const isSelected = poly.room_id === selectedRoomId;
                    const linkedRoom = roomById.get(poly.room_id);
                    const defaultFill = ROOM_CATEGORY_FILL[poly.category] || '#F8FAFC';

                    return (
                      <g
                        key={poly.room_id}
                        onClick={() => {
                          if (linkedRoom) onSelectRoom(linkedRoom);
                        }}
                        className="cursor-pointer group"
                        role="button"
                        tabIndex={0}
                        aria-label={`Select room ${poly.room_number} ${poly.label}`}
                        onKeyDown={(e) => {
                          if ((e.key === 'Enter' || e.key === ' ') && linkedRoom) {
                            e.preventDefault();
                            onSelectRoom(linkedRoom);
                          }
                        }}
                      >
                        <rect
                          x={poly.bounds.x}
                          y={poly.bounds.y}
                          width={poly.bounds.w}
                          height={poly.bounds.h}
                          rx={4}
                          fill={isSelected ? '#27447E' : defaultFill}
                          stroke={isSelected ? '#1E3666' : '#94A3B8'}
                          strokeWidth={isSelected ? 3 : 1.75}
                        />
                        <text
                          x={poly.bounds.x + poly.bounds.w / 2}
                          y={poly.bounds.y + poly.bounds.h / 2 - 6}
                          textAnchor="middle"
                          fontSize={14}
                          fontWeight={700}
                          fill={isSelected ? '#FFFFFF' : '#27447E'}
                        >
                          {poly.room_number}
                        </text>
                        <text
                          x={poly.bounds.x + poly.bounds.w / 2}
                          y={poly.bounds.y + poly.bounds.h / 2 + 14}
                          textAnchor="middle"
                          fontSize={11}
                          fontWeight={500}
                          fill={isSelected ? '#EDF2FA' : '#475569'}
                        >
                          {poly.label.length > 24 ? `${poly.label.slice(0, 22)}…` : poly.label}
                        </text>
                      </g>
                    );
                  })}

                  {/* Vertical Circulation & Entrance Landmarks */}
                  {data.overlay.landmarks.map((lm, idx) => (
                    <g key={`lm-${idx}`} transform={`translate(${lm.x}, ${lm.y})`}>
                      <circle r={12} fill="#EDF2FA" stroke="#27447E" strokeWidth={1.5} />
                      <text
                        y={4}
                        textAnchor="middle"
                        fontSize={9}
                        fontWeight={700}
                        fill="#27447E"
                      >
                        {lm.type === 'LIFT' ? 'L' : lm.type === 'STAIRS' ? 'S' : 'IN'}
                      </text>
                    </g>
                  ))}
                </svg>
              </div>
            </div>
          ) : (
            <div className="p-10 text-center space-y-2 flex-1 flex flex-col items-center justify-center">
              <AlertCircle className="w-8 h-8 text-[#64748B]" />
              <div className="text-sm font-semibold text-[#202938]">
                Approved Indoor Floor Plan Not Yet Published
              </div>
              <p className="text-xs text-[#64748B] max-w-md">
                An approved visual floor plan is not currently available for {data.floor.floor_name}.
                You can browse all listed rooms on this floor using the searchable directory beside
                this panel.
              </p>
            </div>
          )}

          {/* Legend Footer */}
          <div className="px-4 py-2 border-t border-[#E2E8F0] bg-white flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#64748B]">
            <div className="flex items-center gap-4">
              <span className="inline-flex items-center gap-1">
                <span className="w-3 h-3 rounded-xs bg-[#27447E] inline-block" /> Selected Room
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-3 h-3 rounded-full bg-[#EDF2FA] border border-[#27447E] inline-block" />{' '}
                L = Lift / S = Stairs / IN = Lobby Access
              </span>
            </div>
            <span>Local Floor Coordinates (Non-Geographic)</span>
          </div>
        </div>

        {/* Accessible Text/List Room Selector */}
        <div className="lg:col-span-4 bg-white border border-[#E2E8F0] rounded-lg flex flex-col max-h-[520px]">
          <div className="p-3.5 border-b border-[#E2E8F0] space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#202938]">
                Rooms on {data.floor.floor_name}
              </h3>
              <span className="text-xs text-[#64748B] font-medium">
                {filteredRooms.length} listed
              </span>
            </div>
            <div className="relative">
              <Search className="w-4 h-4 text-[#64748B] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={roomFilter}
                onChange={(e) => setRoomFilter(e.target.value)}
                placeholder="Filter by room number or name..."
                className="w-full pl-9 pr-3 py-1.5 text-sm border border-[#E2E8F0] rounded-md bg-[#F5F7FA] focus:bg-white focus:border-[#27447E] outline-none"
              />
            </div>
          </div>

          <div className="overflow-y-auto divide-y divide-[#E2E8F0] flex-1">
            {filteredRooms.length === 0 ? (
              <div className="p-6 text-center text-xs text-[#64748B]">
                No rooms match "{roomFilter}" on this floor.
              </div>
            ) : (
              filteredRooms.map((room) => {
                const active = room.room_id === selectedRoomId;
                return (
                  <button
                    key={room.room_id}
                    type="button"
                    onClick={() => onSelectRoom(room)}
                    className={`w-full text-left px-4 py-3 transition-colors cursor-pointer ${
                      active ? 'bg-[#EDF2FA] border-l-4 border-l-[#27447E]' : 'hover:bg-[#F5F7FA]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-[#27447E]">
                        {room.room_number}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {room.is_accessible && (
                          <span title="Step-free / Lift accessible">
                            <Accessibility className="w-3.5 h-3.5 text-[#64748B]" />
                          </span>
                        )}
                        <VerificationBadge status={room.verification_status} />
                      </div>
                    </div>
                    <div className="text-sm font-medium text-[#202938] mt-0.5">
                      {room.room_name}
                    </div>
                    <div className="text-xs text-[#64748B] mt-0.5 flex items-center gap-2">
                      <span>{room.room_type.replace(/_/g, ' ')}</span>
                      {room.capacity ? <span>• Capacity: {room.capacity}</span> : null}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
