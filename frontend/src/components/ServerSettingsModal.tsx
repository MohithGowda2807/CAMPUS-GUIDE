import { useState, useEffect } from 'react';
import {
  CheckCircle2,
  Globe,
  Radio,
  RefreshCw,
  Server,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import {
  campusApi,
  getApiBaseUrl,
  getConnectionState,
  setApiBaseUrl,
  type ConnectionState,
} from '../services/api';

interface ServerSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ServerSettingsModal({ isOpen, onClose }: ServerSettingsModalProps) {
  const [currentUrl, setCurrentUrl] = useState('');
  const [customInput, setCustomInput] = useState('');
  const [status, setStatus] = useState<ConnectionState>('CHECKING');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    msg: string;
    latencyMs?: number;
  } | null>(null);

  useEffect(() => {
    if (isOpen) {
      const url = getApiBaseUrl();
      setCurrentUrl(url);
      setCustomInput(url);
      setStatus(getConnectionState());
      setTestResult(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleTest = async (testUrl?: string) => {
    const targetUrl = (testUrl || customInput).trim().replace(/\/+$/, '');
    if (!targetUrl) return;

    setTesting(true);
    setTestResult(null);
    const start = performance.now();

    try {
      const probeUrl = `${targetUrl.replace(/\/+$/, '')}/health`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);

      const res = await fetch(probeUrl, { signal: controller.signal });
      clearTimeout(timer);
      const latency = Math.round(performance.now() - start);

      if (res.ok) {
        const body = await res.json();
        setTestResult({
          ok: true,
          msg: `Connected successfully (${latency}ms) — MySQL: ${body.mysql?.connected ? 'Online' : 'Offline'}`,
          latencyMs: latency,
        });
        setStatus('ONLINE');
      } else {
        setTestResult({
          ok: false,
          msg: `Server returned HTTP ${res.status}`,
          latencyMs: latency,
        });
      }
    } catch {
      setTestResult({
        ok: false,
        msg: 'Connection timed out or host unreachable. Check network/IP or keep using Offline Mode.',
      });
      setStatus('OFFLINE_CACHE');
    } finally {
      setTesting(false);
    }
  };

  const handleSave = () => {
    setApiBaseUrl(customInput.trim());
    setCurrentUrl(getApiBaseUrl());
    campusApi.getHealth().then(() => {
      setStatus(getConnectionState());
    });
    onClose();
  };

  const applyPreset = (presetUrl: string) => {
    setCustomInput(presetUrl);
    handleTest(presetUrl);
  };

  return (
    <div className="fixed inset-0 z-[2000] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4 animate-in fade-in duration-200">
      <div
        className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 16px)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50/80">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-[#27447E]/10 rounded-lg text-[#27447E]">
              <Server className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-800 text-base">Backend Connection</h3>
              <p className="text-[11px] text-slate-500 truncate max-w-[220px]">
                Active: <span className="font-mono text-[#27447E] font-medium">{currentUrl}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Status banner */}
          <div
            className={`p-3.5 rounded-xl border flex items-center gap-3 ${
              status === 'ONLINE'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : 'bg-amber-50 border-amber-200 text-amber-900'
            }`}
          >
            {status === 'ONLINE' ? (
              <Wifi className="w-5 h-5 text-emerald-600 shrink-0" />
            ) : (
              <WifiOff className="w-5 h-5 text-amber-600 shrink-0" />
            )}
            <div className="text-xs leading-relaxed">
              <span className="font-bold">
                {status === 'ONLINE' ? 'Live Server Connected' : 'Offline Mode Active'}
              </span>
              <p className="text-slate-600 mt-0.5">
                {status === 'ONLINE'
                  ? 'All campus queries, maps & routes are syncing live.'
                  : 'All 28 buildings, 20 departments & 339 faculty are bundled offline in APK.'}
              </p>
            </div>
          </div>

          {/* Current URL Input */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              API Base URL
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                placeholder="https://rvce-campus.trycloudflare.com/api/v1"
                className="flex-1 px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#27447E] focus:bg-white transition"
              />
              <button
                type="button"
                onClick={() => handleTest()}
                disabled={testing}
                className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium flex items-center gap-1.5 disabled:opacity-50 transition"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${testing ? 'animate-spin' : ''}`} />
                Test
              </button>
            </div>
          </div>

          {/* Test results banner */}
          {testResult && (
            <div
              className={`p-2.5 rounded-lg text-xs flex items-start gap-2 ${
                testResult.ok
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  : 'bg-rose-50 text-rose-800 border border-rose-200'
              }`}
            >
              {testResult.ok ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              ) : (
                <Radio className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              )}
              <span>{testResult.msg}</span>
            </div>
          )}

          {/* Quick presets */}
          <div>
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-2">
              Quick Presets
            </span>
            <div className="grid grid-cols-1 gap-2">
              <button
                type="button"
                onClick={() => applyPreset('https://rvce-campus.trycloudflare.com/api/v1')}
                className="p-2.5 text-left rounded-lg border border-slate-200 hover:border-[#27447E] hover:bg-blue-50/50 transition flex items-center justify-between group"
              >
                <div className="min-w-0">
                  <div className="text-xs font-medium text-slate-800 group-hover:text-[#27447E] flex items-center gap-1.5">
                    <Globe className="w-3.5 h-3.5 text-[#27447E]" />
                    Cloudflare Public Tunnel (Internet)
                  </div>
                  <div className="text-[11px] text-slate-400 truncate">
                    Works on 4G/5G mobile data from anywhere
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => applyPreset('http://192.168.1.7:8000/api/v1')}
                className="p-2.5 text-left rounded-lg border border-slate-200 hover:border-[#27447E] hover:bg-blue-50/50 transition flex items-center justify-between group"
              >
                <div className="min-w-0">
                  <div className="text-xs font-medium text-slate-800 group-hover:text-[#27447E] flex items-center gap-1.5">
                    <Wifi className="w-3.5 h-3.5 text-emerald-600" />
                    Local WiFi Direct IP (192.168.1.7)
                  </div>
                  <div className="text-[11px] text-slate-400 truncate">
                    Fastest when phone is on the same WiFi router
                  </div>
                </div>
              </button>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-slate-100 bg-slate-50/60 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-800 rounded-lg hover:bg-slate-100 transition"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-5 py-2 text-xs font-semibold bg-[#27447E] hover:bg-[#1E3666] text-white rounded-lg shadow-sm transition"
          >
            Save &amp; Connect
          </button>
        </div>
      </div>
    </div>
  );
}
