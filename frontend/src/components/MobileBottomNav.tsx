import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  Compass,
  Home,
  Layers,
  Server,
  ShieldCheck,
  Users,
} from 'lucide-react';
import {
  getConnectionState,
  subscribeConnectionState,
  type ConnectionState,
} from '../services/api';

interface MobileBottomNavProps {
  onOpenSettings: () => void;
}

export function MobileBottomNav({ onOpenSettings }: MobileBottomNavProps) {
  const [connState, setConnState] = useState<ConnectionState>(getConnectionState());

  useEffect(() => {
    return subscribeConnectionState(setConnState);
  }, []);

  const navItems = [
    { to: '/', label: 'Home', icon: Home, end: true },
    { to: '/map', label: 'Map', icon: Compass, end: false },
    { to: '/directory', label: 'Faculty', icon: Users, end: false },
    { to: '/buildings', label: 'Buildings', icon: Layers, end: false },
    { to: '/visitor-registration', label: 'Pass', icon: ShieldCheck, end: false },
  ];

  return (
    <nav
      aria-label="Mobile Bottom Navigation"
      className="fixed bottom-0 left-0 right-0 z-[1000] lg:hidden bg-white/95 backdrop-blur-md border-t border-slate-200/90 shadow-[0_-4px_16px_rgba(0,0,0,0.06)]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 8px)' }}
    >
      <div className="flex items-center justify-around h-15 px-1 max-w-lg mx-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center flex-1 h-full py-1 text-[11px] font-medium transition-colors select-none ${
                  isActive
                    ? 'text-[#27447E] font-semibold'
                    : 'text-slate-500 hover:text-slate-700 active:scale-95'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <div
                    className={`p-1 rounded-full transition-transform ${
                      isActive ? 'bg-blue-50 scale-105' : ''
                    }`}
                  >
                    <Icon
                      className={`w-5 h-5 ${
                        isActive ? 'text-[#27447E] stroke-[2.2]' : 'text-slate-500'
                      }`}
                    />
                  </div>
                  <span className="leading-tight mt-0.5">{item.label}</span>
                </>
              )}
            </NavLink>
          );
        })}

        {/* Server & Offline Status Quick Switcher */}
        <button
          type="button"
          onClick={onOpenSettings}
          className="flex flex-col items-center justify-center flex-1 h-full py-1 text-[11px] font-medium text-slate-500 hover:text-slate-700 active:scale-95 select-none transition-colors relative"
          title="Server Connection Settings"
        >
          <div className="p-1 relative">
            <Server className="w-5 h-5 text-slate-500" />
            <span
              className={`absolute top-0.5 right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white ${
                connState === 'ONLINE' ? 'bg-emerald-500' : 'bg-amber-500'
              }`}
            />
          </div>
          <span className="leading-tight mt-0.5">
            {connState === 'ONLINE' ? 'Online' : 'Offline'}
          </span>
        </button>
      </div>
    </nav>
  );
}
