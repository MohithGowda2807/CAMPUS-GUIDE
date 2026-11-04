import { useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { MobileBottomNav } from './components/MobileBottomNav';
import { ServerSettingsModal } from './components/ServerSettingsModal';
import { BuildingIndoorPage } from './pages/BuildingIndoorPage';
import { CampusMapPage } from './pages/CampusMapPage';
import { DirectoryPage } from './pages/DirectoryPage';
import { FacilitiesPage } from './pages/FacilitiesPage';
import { HomePage } from './pages/HomePage';
import { StaffLoginPage } from './pages/StaffLoginPage';
import { StaffPortalPage } from './pages/StaffPortalPage';
import { VisitorRegistrationPage } from './pages/VisitorRegistrationPage';

export default function App() {
  const [serverModalOpen, setServerModalOpen] = useState(false);

  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/map" element={<CampusMapPage />} />
          <Route path="/buildings" element={<BuildingIndoorPage />} />
          <Route path="/buildings/:buildingId" element={<BuildingIndoorPage />} />
          <Route path="/directory" element={<DirectoryPage />} />
          <Route path="/facilities" element={<FacilitiesPage />} />
          <Route path="/visitor-registration" element={<VisitorRegistrationPage />} />
          <Route path="/login" element={<StaffLoginPage />} />
          <Route path="/portal" element={<StaffPortalPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>

        {/* Global Native Mobile Bottom Navigation Bar */}
        <MobileBottomNav onOpenSettings={() => setServerModalOpen(true)} />

        {/* Server & Offline Backend Configuration Dialog */}
        <ServerSettingsModal
          isOpen={serverModalOpen}
          onClose={() => setServerModalOpen(false)}
        />
      </BrowserRouter>
    </AuthProvider>
  );
}
