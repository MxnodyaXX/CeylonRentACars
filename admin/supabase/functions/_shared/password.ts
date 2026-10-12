// Password rules for staff logins (used by staff-users; unit-tested in security/tests).

/** Why a password is not acceptable, or null when it is */
export function passwordProblem(pw: string, username?: string): string | null {
  if (pw.length < 10) return "Use at least 10 characters.";
  if (pw.length > 72) return "Use at most 72 characters.";
  if (!/[a-zA-Z]/.test(pw) || !/\d/.test(pw)) return "Use letters and numbers.";
  if (username && username.length >= 3 && pw.toLowerCase().includes(username.toLowerCase())) return "Don't include the username in the password.";
  if (/^(.)\1+$/.test(pw) || /^(0123456789|1234567890|password\d*|qwerty\d*|abc12345)/i.test(pw)) return "That password is too easy to guess.";
  return null;
}

/** 12-character temporary password — no look-alike characters, always letters + numbers */
export function tempPassword(): string {
  const letters = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ", digits = "23456789", all = letters + digits;
  const rand = (n: number) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
  const chars = [letters[rand(letters.length)], digits[rand(digits.length)], ...Array.from({ length: 10 }, () => all[rand(all.length)])];
  for (let i = chars.length - 1; i > 0; i--) { const j = rand(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join("");
}
