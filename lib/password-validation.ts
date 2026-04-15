/** כללי סיסמה לאפליקציה — שימוש ב-auth וב-reset-password */

export const PASSWORD_RULE_LABELS = [
  { key: "len", label: "לפחות 6 תווים", test: (p: string) => p.length >= 6 },
  { key: "upper", label: "לפחות אות גדולה אחת", test: (p: string) => /[A-Z]/.test(p) },
  { key: "lower", label: "לפחות אות קטנה אחת", test: (p: string) => /[a-z]/.test(p) },
  { key: "digit", label: "לפחות ספרה אחת", test: (p: string) => /[0-9]/.test(p) },
] as const;

/** מספר תנאים שמתקיימים (0–4) */
export function countMetPasswordRules(password: string): number {
  return PASSWORD_RULE_LABELS.filter((r) => r.test(password)).length;
}

/** חלש: 0–1 תנאים, בינוני: 2–3, חזק: 4 */
export function passwordStrengthTier(
  password: string,
): "weak" | "medium" | "strong" {
  const n = countMetPasswordRules(password);
  if (n <= 1) return "weak";
  if (n < 4) return "medium";
  return "strong";
}

/** הודעת שגיאה ראשונה לפי סדר התנאים; null אם הכל תקין */
export function firstPasswordValidationError(password: string): string | null {
  if (password.length < 6) {
    return "הסיסמה חייבת להכיל לפחות 6 תווים";
  }
  if (!/[A-Z]/.test(password)) {
    return "הסיסמה חייבת להכיל לפחות אות גדולה אחת";
  }
  if (!/[a-z]/.test(password)) {
    return "הסיסמה חייבת להכיל לפחות אות קטנה אחת";
  }
  if (!/[0-9]/.test(password)) {
    return "הסיסמה חייבת להכיל לפחות ספרה אחת";
  }
  return null;
}

export function passwordMeetsAllRules(password: string): boolean {
  return firstPasswordValidationError(password) === null;
}
