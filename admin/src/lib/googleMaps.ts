export const MAPS_KEY = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? '') as string;

let _promise: Promise<void> | null = null;

export function loadGoogleMaps(): Promise<void> {
  if (!MAPS_KEY) return Promise.reject(new Error('no-key'));
  if (_promise) return _promise;
  _promise = new Promise<void>((resolve, reject) => {
    if ((window as unknown as Record<string, unknown>)['google'] &&
        (window as any).google?.maps?.places) {
      resolve();
      return;
    }
    const s = document.createElement('script');
    s.src   = `https://maps.googleapis.com/maps/api/js?key=${MAPS_KEY}&libraries=places,marker&loading=async`;
    s.async = true;
    s.onload  = () => resolve();
    s.onerror = () => { _promise = null; reject(new Error('load-failed')); };
    document.head.appendChild(s);
  });
  return _promise;
}
