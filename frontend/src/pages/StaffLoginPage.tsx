import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Lock, ShieldCheck } from 'lucide-react';
import { Footer } from '../components/Footer';
import { Header } from '../components/Header';
import { useAuth } from '../context/AuthContext';

export function StaffLoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (user) {
    return <Navigate to="/portal" replace />;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(username.trim(), password);
      navigate('/portal', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#F5F7FA]">
      <Header />

      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md bg-white border border-[#E2E8F0] rounded-lg p-6 sm:p-8 space-y-6">
          <div className="flex items-center gap-3.5 pb-4 border-b border-[#E2E8F0]">
            <img
              src="/assets/rvce-crest.png"
              alt="RVCE Official Emblem"
              className="h-12 w-12 object-contain"
            />
            <div>
              <h1 className="text-lg font-bold text-[#202938]">Staff &amp; Administrator Sign In</h1>
              <p className="text-xs text-[#64748B]">
                Authorised RVCE Reception, Faculty &amp; Estate Portal
              </p>
            </div>
          </div>

          {error && (
            <div className="p-3 rounded-md bg-red-50 border border-red-200 text-xs text-red-800 font-medium">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-[#202938] mb-1.5">
                Staff Username or Institutional Email
              </label>
              <input
                type="text"
                required
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. security.desk or facility.admin"
                className="w-full px-3 py-2 text-sm bg-[#F5F7FA] border border-[#E2E8F0] rounded-md focus:bg-white focus:border-[#27447E] outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#202938] mb-1.5">
                Password
              </label>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your account password"
                className="w-full px-3 py-2 text-sm bg-[#F5F7FA] border border-[#E2E8F0] rounded-md focus:bg-white focus:border-[#27447E] outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-[#27447E] text-white text-sm font-semibold hover:bg-[#1E3666] disabled:opacity-60 transition-colors cursor-pointer"
            >
              <Lock className="w-4 h-4" />
              {submitting ? 'Signing In…' : 'Sign In to Staff Portal'}
            </button>
          </form>

          <div className="pt-3 border-t border-[#E2E8F0] flex items-start gap-2 text-xs text-[#64748B]">
            <ShieldCheck className="w-4 h-4 text-[#27447E] shrink-0 mt-0.5" />
            <span>
              All administrative actions and visitor log accesses are role-restricted and recorded
              in the institutional audit log.
            </span>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
