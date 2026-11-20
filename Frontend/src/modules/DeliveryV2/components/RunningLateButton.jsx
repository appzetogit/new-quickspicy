import React, { useState } from 'react';
import { Clock, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { deliveryAPI } from '@food/api';

const REASONS = [
  { key: 'traffic', label: 'Traffic' },
  { key: 'rain', label: 'Rain' },
  { key: 'restaurant_delay', label: 'Restaurant delay' },
  { key: 'other', label: 'Other' },
];
const MINUTES = [5, 10, 15, 20, 30];

/**
 * "Running late": tells the customer why and by how much, and moves their ETA
 * (POST /food/delivery/orders/:orderId/running-late).
 */
export default function RunningLateButton({ order, className = '' }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('traffic');
  const [minutes, setMinutes] = useState(10);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);

  const orderId = order?._id || order?.orderMongoId || order?.orderId;
  if (!orderId) return null;

  const send = async () => {
    if (reason === 'other' && !note.trim()) {
      toast.error('Say what the delay is');
      return;
    }
    setSending(true);
    try {
      const res = await deliveryAPI.reportRunningLate(orderId, {
        reason,
        extraMinutes: minutes,
        note: note.trim() || undefined,
      });
      toast.success(res?.data?.data?.message || 'Customer has been told you are running late');
      setOpen(false);
      setNote('');
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Could not send the update');
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`w-full py-3 rounded-2xl border-2 border-amber-200 bg-amber-50 text-amber-800 text-[11px] font-black uppercase tracking-[0.15em] flex items-center justify-center gap-2 active:scale-95 transition-all ${className}`}
      >
        <Clock className="w-4 h-4" /> Running late
      </button>

      {open && (
        <div className="fixed inset-0 z-[300] bg-black/60 flex items-end sm:items-center justify-center p-4" onClick={() => !sending && setOpen(false)}>
          <div className="w-full max-w-sm bg-white rounded-3xl p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-black text-gray-950">Running late</h3>
              <button type="button" onClick={() => setOpen(false)} className="p-2 rounded-xl bg-gray-50 text-gray-500" aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">Reason</p>
            <div className="grid grid-cols-2 gap-2 mb-4">
              {REASONS.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => setReason(r.key)}
                  className={`py-2.5 rounded-xl text-sm font-bold border-2 ${reason === r.key ? 'border-amber-500 bg-amber-50 text-amber-800' : 'border-gray-100 text-gray-600'}`}
                >
                  {r.label}
                </button>
              ))}
            </div>

            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">Extra minutes</p>
            <div className="flex flex-wrap gap-2 mb-4">
              {MINUTES.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMinutes(m)}
                  className={`px-3.5 py-2 rounded-xl text-sm font-bold border-2 ${minutes === m ? 'border-amber-500 bg-amber-50 text-amber-800' : 'border-gray-100 text-gray-600'}`}
                >
                  +{m}
                </button>
              ))}
            </div>

            <input
              type="text"
              maxLength={200}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={reason === 'other' ? 'What is the delay? (required)' : 'Note for the customer (optional)'}
              className="w-full mb-4 px-4 py-3 rounded-xl border-2 border-gray-100 focus:border-amber-400 outline-none text-sm"
            />

            <button
              type="button"
              disabled={sending}
              onClick={send}
              className="w-full py-4 rounded-2xl bg-gray-950 text-white font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Tell the customer
            </button>
          </div>
        </div>
      )}
    </>
  );
}
