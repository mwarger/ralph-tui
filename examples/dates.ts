/**
 * ABOUTME: Date utility functions demonstrating common date operations
 * following ralph-tui patterns: ISO 8601 storage, manual duration math,
 * and pure JavaScript Date API without external libraries.
 */

/**
 * Format a date to a human-readable string
 * Follows the codebase pattern of using locale-based formatting
 *
 * @param date - Date to format (can be Date object or ISO string)
 * @param format - Output format: 'full' | 'date' | 'time'
 * @returns Formatted date string
 *
 * @example
 * formatDate(new Date(), 'full') // "1/19/2026, 9:30:45 PM"
 * formatDate('2026-01-19T21:30:45.123Z', 'date') // "January 19, 2026"
 * formatDate(new Date(), 'time') // "21:30:45"
 */
export function formatDate(
  date: Date | string,
  format: 'full' | 'date' | 'time' = 'full'
): string {
  const d = typeof date === 'string' ? new Date(date) : date;

  switch (format) {
    case 'date':
      return d.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    case 'time': {
      // Follow codebase pattern: HH:mm:ss with padStart
      const hours = d.getHours().toString().padStart(2, '0');
      const minutes = d.getMinutes().toString().padStart(2, '0');
      const seconds = d.getSeconds().toString().padStart(2, '0');
      return `${hours}:${minutes}:${seconds}`;
    }
    case 'full':
    default:
      return d.toLocaleString('en-US');
  }
}

/**
 * Calculate the number of days between two dates
 * Uses the codebase pattern of getTime() arithmetic for duration math
 *
 * @param date1 - First date (can be Date object or ISO string)
 * @param date2 - Second date (can be Date object or ISO string)
 * @returns Number of days between dates (can be negative if date1 > date2)
 *
 * @example
 * daysBetween('2026-01-01', '2026-01-10') // 9
 * daysBetween(new Date('2026-01-10'), new Date('2026-01-01')) // -9
 */
export function daysBetween(date1: Date | string, date2: Date | string): number {
  const d1 = typeof date1 === 'string' ? new Date(date1) : date1;
  const d2 = typeof date2 === 'string' ? new Date(date2) : date2;

  // Follow codebase pattern: getTime() for millisecond arithmetic
  const ms1 = d1.getTime();
  const ms2 = d2.getTime();
  const diffMs = ms2 - ms1;

  // Convert milliseconds to days
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.floor(diffMs / msPerDay);
}

/**
 * Check if a date falls on a weekend (Saturday or Sunday)
 *
 * @param date - Date to check (can be Date object or ISO string)
 * @returns true if the date is Saturday or Sunday
 *
 * @example
 * isWeekend(new Date('2026-01-17')) // true (Saturday)
 * isWeekend('2026-01-19T00:00:00Z') // false (Monday)
 */
export function isWeekend(date: Date | string): boolean {
  const d = typeof date === 'string' ? new Date(date) : date;
  const dayOfWeek = d.getDay();
  // 0 = Sunday, 6 = Saturday
  return dayOfWeek === 0 || dayOfWeek === 6;
}
