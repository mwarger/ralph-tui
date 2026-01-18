/**
 * ABOUTME: Simple validation utilities for demonstration purposes.
 * Provides basic validators: isEmail, isURL, and isNumeric.
 */

/**
 * Checks if a string is a valid email address format.
 * Uses a simple pattern that validates most common email formats.
 *
 * @param str - The string to validate
 * @returns True if the string is a valid email format, false otherwise
 * @example
 * isEmail('user@example.com') // returns true
 * isEmail('invalid') // returns false
 */
export function isEmail(str: string): boolean {
  if (str.length === 0) {
    return false;
  }
  const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return EMAIL_PATTERN.test(str);
}

/**
 * Checks if a string is a valid URL.
 * Accepts any URL with a valid protocol (http, https, ftp, etc.).
 *
 * @param str - The string to validate
 * @returns True if the string is a valid URL, false otherwise
 * @example
 * isURL('https://example.com') // returns true
 * isURL('example.com') // returns false (missing protocol)
 */
export function isURL(str: string): boolean {
  if (str.length === 0) {
    return false;
  }
  try {
    new URL(str);
    return true;
  } catch {
    return false;
  }
}

/**
 * Checks if a string represents a numeric value.
 * Accepts integers and decimals, including negative numbers.
 * Does not accept scientific notation, leading/trailing whitespace,
 * or special values like Infinity or NaN.
 *
 * @param str - The string to validate
 * @returns True if the string is a valid numeric format, false otherwise
 * @example
 * isNumeric('42') // returns true
 * isNumeric('-3.14') // returns true
 * isNumeric('abc') // returns false
 */
export function isNumeric(str: string): boolean {
  if (str.length === 0) {
    return false;
  }
  const NUMERIC_PATTERN = /^-?\d+(\.\d+)?$/;
  return NUMERIC_PATTERN.test(str);
}
