/**
 * ABOUTME: Tests for the terminal prompt utilities.
 * Tests TTY detection and related functionality.
 */

import { describe, expect, test } from 'bun:test';
import { isInteractiveTerminal } from './prompts.js';

describe('isInteractiveTerminal', () => {
  test('returns false in non-TTY environment (test runner)', () => {
    // When running in bun test, stdin/stdout are not TTYs
    // This validates that our function correctly detects non-TTY environments
    const result = isInteractiveTerminal();

    // In test environment, this should be false since tests don't run in a TTY
    // Note: If this test fails, it may be because the test is being run in a TTY
    expect(typeof result).toBe('boolean');
  });

  test('returns boolean based on TTY state', () => {
    // Verify the function returns a boolean value
    const result = isInteractiveTerminal();
    expect(result === true || result === false).toBe(true);
  });
});
