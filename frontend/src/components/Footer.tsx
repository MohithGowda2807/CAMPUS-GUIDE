import { Link } from 'react-router-dom';
import { ExternalLink, MapPin, Shield } from 'lucide-react';

export function Footer() {
  return (
    <footer className="bg-white border-t border-[#E2E8F0] mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Institutional Identity */}
          <div className="md:col-span-2 space-y-3">
            <div className="flex items-center gap-3">
              <img
                src="/assets/rvce-crest.png"
                alt="RVCE Emblem"
                className="h-11 w-11 object-contain"
              />
              <div>
                <div className="font-bold text-[#202938] text-base">
                  RV College of Engineering<sup className="text-xs">®</sup>
                </div>
                <div className="text-xs font-medium text-[#27447E] italic">
                  Go, change the world®
                </div>
              </div>
            </div>
            <p className="text-sm text-[#64748B] leading-relaxed max-w-md">
              Autonomous Institution affiliated to Visvesvaraya Technological University, Belagavi.
              Approved by AICTE, New Delhi.
            </p>
            <div className="flex items-start gap-2 text-xs text-[#64748B]">
              <MapPin className="w-4 h-4 text-[#27447E] shrink-0 mt-0.5" />
              <span>
                RV Vidyaniketan Post, 8th Mile, Mysuru Road, Bengaluru, Karnataka – 560059, India
              </span>
            </div>
          </div>

          {/* Portal Links */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#202938] mb-3">
              Campus Services
            </h3>
            <ul className="space-y-2 text-sm text-[#64748B]">
              <li>
                <Link to="/map" className="hover:text-[#27447E] transition-colors">
                  Interactive Campus Map
                </Link>
              </li>
              <li>
                <Link to="/buildings" className="hover:text-[#27447E] transition-colors">
                  Building &amp; Floor Directory
                </Link>
              </li>
              <li>
                <Link to="/directory" className="hover:text-[#27447E] transition-colors">
                  Departments &amp; Faculty
                </Link>
              </li>
              <li>
                <Link to="/facilities" className="hover:text-[#27447E] transition-colors">
                  Campus Facilities
                </Link>
              </li>
              <li>
                <Link to="/visitor-registration" className="hover:text-[#27447E] transition-colors">
                  Visitor Pass Registration
                </Link>
              </li>
            </ul>
          </div>

          {/* Governance & Attribution */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#202938] mb-3">
              Information &amp; Policy
            </h3>
            <ul className="space-y-2.5 text-xs text-[#64748B] leading-relaxed">
              <li className="flex items-start gap-1.5">
                <Shield className="w-3.5 h-3.5 text-[#27447E] shrink-0 mt-0.5" />
                <span>
                  Visitor records are access-restricted to authorised RVCE reception and security
                  personnel under institutional data-minimisation policy.
                </span>
              </li>
              <li>
                Outdoor map data{' '}
                <a
                  href="https://www.openstreetmap.org/copyright"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#27447E] hover:underline font-medium"
                >
                  © OpenStreetMap contributors
                </a>{' '}
                (ODbL).
              </li>
              <li>
                <a
                  href="https://www.rvce.edu.in"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[#27447E] hover:underline font-medium"
                >
                  Official RVCE Main Portal
                  <ExternalLink className="w-3 h-3" />
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-[#E2E8F0] flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-[#64748B]">
          <span>
            © {new Date().getFullYear()} Rashtreeya Sikshana Samithi Trust — RV College of Engineering. All rights reserved.
          </span>
          <span>Campus Navigation &amp; Visitor Management Digital Service</span>
        </div>
      </div>
    </footer>
  );
}
