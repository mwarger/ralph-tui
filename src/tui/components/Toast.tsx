/**
 * ABOUTME: Toast notification component for temporary feedback messages.
 * Displays auto-dismissing notifications at the bottom of the screen.
 * US-5: Used for connection resilience feedback (reconnecting, reconnected, failed).
 */

import type { ReactNode } from 'react';
import { colors } from '../theme.js';

/**
 * Toast variant types that determine styling.
 */
export type ToastVariant = 'success' | 'warning' | 'error' | 'info';

/**
 * Props for the Toast component
 */
export interface ToastProps {
  /** Whether the toast is visible */
  visible: boolean;

  /** The message to display */
  message: string;

  /** Optional icon to display before the message */
  icon?: string;

  /** Toast variant for styling (default: 'info') */
  variant?: ToastVariant;

  /** Position from right edge (default: 2) */
  right?: number;

  /** Position from bottom edge (default: 2) */
  bottom?: number;
}

/**
 * Get border and text color for a toast variant.
 */
function getVariantColors(variant: ToastVariant): { border: string; text: string } {
  switch (variant) {
    case 'success':
      return { border: colors.status.success, text: colors.status.success };
    case 'warning':
      return { border: colors.status.warning, text: colors.status.warning };
    case 'error':
      return { border: colors.status.error, text: colors.status.error };
    case 'info':
      return { border: colors.status.info, text: colors.status.info };
  }
}

/**
 * Default icons for toast variants.
 */
const DEFAULT_ICONS: Record<ToastVariant, string> = {
  success: '✓',
  warning: '⚠',
  error: '✗',
  info: 'ℹ',
};

/**
 * Toast component for displaying temporary notifications.
 * Positioned absolutely at the bottom-right of the screen.
 */
export function Toast({
  visible,
  message,
  icon,
  variant = 'info',
  right = 2,
  bottom = 2,
}: ToastProps): ReactNode {
  if (!visible) {
    return null;
  }

  const variantColors = getVariantColors(variant);
  const displayIcon = icon ?? DEFAULT_ICONS[variant];

  return (
    <box
      style={{
        position: 'absolute',
        bottom,
        right,
        paddingLeft: 1,
        paddingRight: 1,
        backgroundColor: colors.bg.tertiary,
        border: true,
        borderColor: variantColors.border,
      }}
    >
      <text fg={variantColors.text}>
        {displayIcon} {message}
      </text>
    </box>
  );
}

/**
 * Connection-specific toast message type (used by InstanceManager).
 */
export type ConnectionToastMessage =
  | { type: 'reconnecting'; alias: string; attempt: number; maxRetries: number }
  | { type: 'reconnected'; alias: string; totalAttempts: number }
  | { type: 'reconnect_failed'; alias: string; attempts: number; error: string }
  | { type: 'connection_error'; alias: string; error: string };

/**
 * Format a connection toast message for display.
 */
export function formatConnectionToast(toast: ConnectionToastMessage): {
  message: string;
  variant: ToastVariant;
  icon: string;
} {
  switch (toast.type) {
    case 'reconnecting':
      return {
        message: `${toast.alias}: Reconnecting (${toast.attempt}/${toast.maxRetries})...`,
        variant: 'warning',
        icon: '⟳',
      };
    case 'reconnected':
      return {
        message: `${toast.alias}: Reconnected after ${toast.totalAttempts} ${toast.totalAttempts === 1 ? 'attempt' : 'attempts'}`,
        variant: 'success',
        icon: '●',
      };
    case 'reconnect_failed':
      return {
        message: `${toast.alias}: Connection failed after ${toast.attempts} attempts`,
        variant: 'error',
        icon: '○',
      };
    case 'connection_error':
      return {
        message: `${toast.alias}: ${toast.error}`,
        variant: 'error',
        icon: '✗',
      };
  }
}
