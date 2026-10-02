import { supabase, supabaseEnabled } from './supabase'

const TABLES = [
  'vehicles', 'owners', 'bookings', 'inquiries',
  'commissions', 'expenses', 'drivers', 'notifications', 'handovers',
]

/**
 * Subscribes to all table changes and calls onRefetch after a 200ms debounce.
 * Returns a cleanup function to unsubscribe.
 */
export function setupRealtime(onRefetch: () => void): () => void {
  if (!supabaseEnabled) return () => {}

  let timer: ReturnType<typeof setTimeout>
  const debouncedRefetch = () => {
    clearTimeout(timer)
    timer = setTimeout(onRefetch, 200)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let channel = supabase.channel('emrac-realtime') as any
  for (const table of TABLES) {
    channel = channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table },
      debouncedRefetch,
    )
  }
  channel.subscribe()

  return () => {
    clearTimeout(timer)
    supabase.removeChannel(channel)
  }
}
