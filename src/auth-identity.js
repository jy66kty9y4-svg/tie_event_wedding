// Bare ten-digit numbers and the domestic 8 prefix use the Russian country code.
export function normalizePhone(value) {
  if (typeof value !== 'string' || value.length > 64) return null;
  const input = value.trim();
  if (!/^\+?[\d\s().-]+$/.test(input)) return null;
  let digits = input.replace(/\D/g, '');
  if (!input.startsWith('+')) {
    if (digits.length === 10) digits = `7${digits}`;
    else if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
  }
  if (digits.startsWith('7') && digits.length !== 11) return null;
  return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
}
