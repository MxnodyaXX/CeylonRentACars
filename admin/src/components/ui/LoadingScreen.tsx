/** Full-screen branded loader shown while the app boots / data loads.
 *  Mirrors the customer site's intro: logo above a glowing red seam. */
export default function LoadingScreen({ label = 'Loading your fleet…' }: { label?: string }) {
  return (
    <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-white">
      <div className="absolute w-80 h-80 rounded-full bg-brand-500/10 blur-3xl" />

      <div className="relative flex flex-col items-center anim-fade-in">
        <img src="/brand/logo-light.png" alt="Ceylon Rent A Cars" className="w-40 h-auto mb-8 select-none" draggable={false} />

        {/* red seam progress */}
        <div className="relative w-56 h-[3px] rounded-full bg-navy-100 overflow-hidden">
          <span className="absolute top-0 left-0 h-full w-1/3 rounded-full bg-gradient-to-r from-transparent via-brand-500 to-transparent anim-loader-bar" />
        </div>

        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-navy-400 mt-5">{label}</p>
      </div>
    </div>
  );
}
