import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const supabaseEnabled =
  typeof url === 'string' && url.startsWith('https://') &&
  typeof key === 'string' && key.length > 20

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const supabase: ReturnType<typeof createClient<any>> = supabaseEnabled
  ? createClient<any>(url!, key!)
  : null as any
