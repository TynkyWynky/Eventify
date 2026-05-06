export function isStrongPassword(value: string) {
  const password = String(value || "");
  if (password.length < 10 || password.length > 256) return false;
  return /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /\d/.test(password) &&
    /[^A-Za-z0-9]/.test(password);
}
