/**
 * Loader for the admin panel while a lazy chunk or a guard check is pending.
 *
 * Deliberately not the shared <Loader />: that renders AppShellSkeleton, a
 * full-screen mock of the customer storefront -- header, hero, restaurant
 * grid -- which is not what is arriving and looks like the wrong app.
 * `fullScreen` fills the viewport (before the admin chrome exists);
 * otherwise it fills the content area inside AdminLayout.
 */
export default function AdminPageLoader({ fullScreen = false }) {
  return (
    <div
      role="status"
      aria-label="Loading page"
      className={`flex w-full items-center justify-center ${
        fullScreen ? "min-h-screen bg-neutral-100" : "h-full min-h-[60vh]"
      }`}
    >
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-[#E64100]" />
    </div>
  );
}
