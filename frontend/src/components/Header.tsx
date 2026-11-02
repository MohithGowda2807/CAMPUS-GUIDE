import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import {
  Building2,
  ExternalLink,
  LayoutDashboard,
  LogIn,
  LogOut,
  MapPin,
  Menu,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface HeaderProps {
  compact?: boolean;
}

const NAV_ITEMS = [
  { to: '/', label: 'Home', end: true },
  { to: '/map', label: 'Campus Map', end: false },
  { to: '/buildings', label: 'Buildings & Floors', end: false },
  { to: '/directory', label: 'Directory', end: false },
  { to: '/facilities', label: 'Facilities', end: false },
  { to: '/visitor-registration', label: 'Visitor Services', end: false },
];

export function Header({ compact = false }: HeaderProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    setMobileOpen(false);
    navigate('/');
  };

  return (
    <header className="sticky top-0 z-[1000] bg-white border-b border-[#E2E8F0]">
      {/* Official RVCE Institutional Top Utility Bar */}
      {!compact && (
        <div className="bg-[#27447E] text-white text-xs">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-8 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 truncate">
              <span className="font-medium tracking-wide">
                Rashtreeya Sikshana Samithi Trust
              </span>
              <span className="hidden md:inline text-white/50">|</span>
              <span className="hidden md:inline text-white/90 italic">
                Go, change the world®
              </span>
            </div>
            <div className="flex items-center gap-4 shrink-0">
              <span className="hidden sm:inline-flex items-center gap-1 text-white/85">
                <MapPin className="w-3.5 h-3.5" />
                Mysuru Road, Bengaluru – 560059
              </span>
              <a
                href="https://www.rvce.edu.in"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-white hover:underline font-medium"
              >
                rvce.edu.in
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Main Institutional Navigation Header */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className={`flex items-center justify-between gap-4 ${compact ? 'h-16' : 'h-20'}`}>
          {/* Authentic RVCE Emblem & Portal Identity */}
          <Link
            to="/"
            className="flex items-center gap-3.5 min-w-0 group"
            onClick={() => setMobileOpen(false)}
          >
            <img
              src="/assets/rvce-crest.png"
              alt="RV College of Engineering Official Emblem"
              className={`${compact ? 'h-11 w-11' : 'h-13 w-13'} object-contain shrink-0`}
            />
            <div className="min-w-0">
              <div className="text-base sm:text-lg font-bold text-[#202938] leading-tight tracking-tight group-hover:text-[#27447E] transition-colors truncate">
                RV College of Engineering<sup className="text-xs font-semibold">®</sup>
              </div>
              <div className="text-xs sm:text-[13px] font-medium text-[#64748B] truncate">
                Campus Navigation &amp; Visitor Management
              </div>
            </div>
          </Link>

          {/* Desktop Navigation Links */}
          <nav className="hidden lg:flex items-center gap-1" aria-label="Primary Navigation">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-[#EDF2FA] text-[#27447E] font-semibold'
                      : 'text-[#202938] hover:bg-[#F5F7FA] hover:text-[#27447E]'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          {/* Staff Portal / Login Controls */}
          <div className="hidden lg:flex items-center gap-2.5 shrink-0">
            {user ? (
              <>
                <Link
                  to="/portal"
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-sm font-semibold bg-[#27447E] text-white hover:bg-[#1E3666] transition-colors"
                >
                  <LayoutDashboard className="w-4 h-4" />
                  Staff Portal
                </Link>
                <button
                  type="button"
                  onClick={handleLogout}
                  title={`Sign out (${user.username})`}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium border border-[#E2E8F0] text-[#202938] hover:bg-[#F5F7FA] transition-colors cursor-pointer"
                >
                  <LogOut className="w-4 h-4 text-[#64748B]" />
                  Sign Out
                </button>
              </>
            ) : (
              <Link
                to="/login"
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-sm font-semibold border border-[#27447E] text-[#27447E] hover:bg-[#EDF2FA] transition-colors"
              >
                <LogIn className="w-4 h-4" />
                Staff Login
              </Link>
            )}
          </div>

          {/* Mobile Menu Toggle */}
          <button
            type="button"
            onClick={() => setMobileOpen((prev) => !prev)}
            className="lg:hidden inline-flex items-center justify-center p-2 rounded-md text-[#202938] hover:bg-[#F5F7FA] border border-[#E2E8F0]"
            aria-expanded={mobileOpen}
            aria-label="Toggle navigation menu"
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Collapsible Menu */}
      {mobileOpen && (
        <div className="lg:hidden border-t border-[#E2E8F0] bg-white px-4 pt-2 pb-4 space-y-1 shadow-sm">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                `block px-3 py-2.5 rounded-md text-sm font-medium ${
                  isActive
                    ? 'bg-[#EDF2FA] text-[#27447E] font-semibold'
                    : 'text-[#202938] hover:bg-[#F5F7FA]'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
          <div className="pt-2 mt-2 border-t border-[#E2E8F0] flex flex-col gap-2">
            {user ? (
              <>
                <div className="px-3 py-1.5 text-xs text-[#64748B] flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-[#27447E]" />
                  Signed in as <strong className="text-[#202938]">{user.username}</strong>
                </div>
                <Link
                  to="/portal"
                  onClick={() => setMobileOpen(false)}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-md text-sm font-semibold bg-[#27447E] text-white"
                >
                  <Building2 className="w-4 h-4" />
                  Open Staff Portal
                </Link>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium border border-[#E2E8F0] text-[#202938]"
                >
                  <LogOut className="w-4 h-4" />
                  Sign Out
                </button>
              </>
            ) : (
              <Link
                to="/login"
                onClick={() => setMobileOpen(false)}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-md text-sm font-semibold bg-[#27447E] text-white"
              >
                <LogIn className="w-4 h-4" />
                Staff Login
              </Link>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
