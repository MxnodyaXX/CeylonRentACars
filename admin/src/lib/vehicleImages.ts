import { supabase, supabaseEnabled } from './supabase';

const BUCKET = 'vehicle-images';

/**
 * Upload a single image file to Supabase Storage under the given vehicle ID folder.
 * Returns the public URL of the uploaded file.
 *
 * Requires a public Supabase Storage bucket named "vehicle-images".
 * Create it in the Supabase dashboard: Storage → New bucket → "vehicle-images" → Public.
 */
export async function uploadVehicleImage(vehicleId: string, file: File): Promise<string> {
  if (!supabaseEnabled) throw new Error('Supabase is not configured — image upload is unavailable.');
  const ext = file.name.split('.').pop() ?? 'jpg';
  const path = `${vehicleId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { cacheControl: '3600' });
  if (error) throw error;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Delete a previously uploaded vehicle image by its public URL.
 * Silently skips if Supabase is not configured or the URL can't be parsed.
 */
export async function deleteVehicleImage(url: string): Promise<void> {
  if (!supabaseEnabled) return;
  try {
    const marker = `/object/public/${BUCKET}/`;
    const idx = url.indexOf(marker);
    if (idx === -1) return;
    const path = decodeURIComponent(url.slice(idx + marker.length));
    await supabase.storage.from(BUCKET).remove([path]);
  } catch {
    // best-effort — don't surface storage cleanup errors to the user
  }
}
