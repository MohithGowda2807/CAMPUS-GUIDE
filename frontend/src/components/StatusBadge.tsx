import type { AvailabilityState, VerificationStatus } from '../types/campus';

export function AvailabilityBadge({ state }: { state: AvailabilityState }) {
  const styles: Record<AvailabilityState, { label: string; cls: string; dot: string }> = {
    AVAILABLE: {
      label: 'Available',
      cls: 'bg-emerald-50 text-emerald-800 border-emerald-200',
      dot: 'bg-emerald-600',
    },
    BUSY_SCHEDULED: {
      label: 'Busy / Scheduled',
      cls: 'bg-amber-50 text-amber-800 border-amber-200',
      dot: 'bg-amber-500',
    },
    UNAVAILABLE: {
      label: 'Unavailable',
      cls: 'bg-red-50 text-red-800 border-red-200',
      dot: 'bg-red-600',
    },
    UNKNOWN: {
      label: 'Unknown',
      cls: 'bg-slate-100 text-[#64748B] border-[#E2E8F0]',
      dot: 'bg-slate-400',
    },
  };

  const cfg = styles[state] || styles.UNKNOWN;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${cfg.cls}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

export function VerificationBadge({ status }: { status?: VerificationStatus }) {
  if (!status || status === 'VERIFIED') return null;

  if (status === 'SAMPLE_DEV') {
    return (
      <span
        title="Sample development record — replace with verified institutional data prior to public launch"
        className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-amber-50 text-amber-800 border border-amber-200"
      >
        Sample Data
      </span>
    );
  }

  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-[#EDF2FA] text-[#27447E] border border-[#E2E8F0]">
      Pending Verification
    </span>
  );
}

export function VisitStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    REGISTERED: { label: 'Registered', cls: 'bg-[#EDF2FA] text-[#27447E] border-[#CBD5E1]' },
    CHECKED_IN: { label: 'Checked In', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
    CHECKED_OUT: { label: 'Checked Out', cls: 'bg-slate-100 text-[#64748B] border-[#E2E8F0]' },
    CANCELLED: { label: 'Cancelled', cls: 'bg-red-50 text-red-800 border-red-200' },
    APPROVED: { label: 'Host Approved', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
    PENDING: { label: 'Host Pending', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
    REJECTED: { label: 'Host Rejected', cls: 'bg-red-50 text-red-800 border-red-200' },
    NOT_REQUIRED: { label: 'Direct Gate Pass', cls: 'bg-slate-50 text-[#64748B] border-[#E2E8F0]' },
  };
  const cfg = map[status] || { label: status, cls: 'bg-slate-100 text-[#64748B] border-[#E2E8F0]' };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium border ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}
