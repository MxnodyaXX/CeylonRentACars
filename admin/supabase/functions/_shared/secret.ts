// Shared-secret check for webhooks that outside services call (Text.lk can't send a login,
// so the secret goes in the URL: .../sms-inbound?key=<SMS_WEBHOOK_SECRET>).
// Fails closed: when the secret isn't set, nothing gets in.

/** true when the request's ?key= matches the named secret (constant-time compare) */
export function keyMatches(req: Request, secretName: string): boolean {
  const secret = Deno.env.get(secretName) ?? "";
  const given = new URL(req.url).searchParams.get("key") ?? "";
  if (!secret || given.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < secret.length; i++) diff |= given.charCodeAt(i) ^ secret.charCodeAt(i);
  return diff === 0;
}
