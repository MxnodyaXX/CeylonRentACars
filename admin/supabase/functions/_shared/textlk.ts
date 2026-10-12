// Send one SMS through Text.lk (same account + sender ID as send-sms: TEXTLK_API_TOKEN, TEXTLK_SENDER_ID).

export interface TextLkResult { ok: boolean; uid: string | null; cost: number | null; error: string | null }

export async function sendTextLk(to: string, message: string): Promise<TextLkResult> {
  const apiToken = Deno.env.get("TEXTLK_API_TOKEN");
  const senderId = Deno.env.get("TEXTLK_SENDER_ID") ?? "TextLKDemo";
  if (!apiToken) return { ok: false, uid: null, cost: null, error: "SMS gateway not configured (TEXTLK_API_TOKEN)" };
  try {
    const res = await fetch("https://app.text.lk/api/v3/sms/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ recipient: to, sender_id: senderId, type: "plain", message }),
    });
    const data = await res.json().catch(() => ({}));
    const ok = res.ok && (data?.status === "success" || data?.status === true);
    return {
      ok,
      uid: data?.data?.uid ?? null,
      cost: data?.data?.cost != null ? Number(data.data.cost) : null,
      error: ok ? null : JSON.stringify(data).slice(0, 500),
    };
  } catch (e) {
    return { ok: false, uid: null, cost: null, error: String(e) };
  }
}
