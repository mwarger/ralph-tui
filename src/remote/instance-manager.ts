/**
 * ABOUTME: Manages multiple remote instance connections for the TUI.
 * Coordinates tab state, connection lifecycle, and auto-reconnection with exponential backoff.
 * US-5: Extended with connection resilience (auto-reconnect, metrics tracking, toast events).
 * Provides a unified interface for the TUI to interact with local and remote instances.
 */

import type { RemoteServerConfig } from './config.js';
import { listRemotes, updateLastConnected } from './config.js';
import {
  RemoteClient,
  createLocalTab,
  createRemoteTab,
  type InstanceTab,
  type ConnectionStatus,
  type ConnectionMetrics,
  type RemoteClientEvent,
} from './client.js';

/**
 * Toast notification types for connection events.
 * These are emitted to the UI for display as temporary notifications.
 */
export type ConnectionToast =
  | { type: 'reconnecting'; alias: string; attempt: number; maxRetries: number }
  | { type: 'reconnected'; alias: string; totalAttempts: number }
  | { type: 'reconnect_failed'; alias: string; attempts: number; error: string }
  | { type: 'connection_error'; alias: string; error: string };

/**
 * Callback for toast notifications
 */
export type ToastHandler = (toast: ConnectionToast) => void;

/**
 * Callback for instance state changes
 */
export type InstanceStateChangeHandler = (tabs: InstanceTab[], selectedIndex: number) => void;

/**
 * Manages local and remote ralph-tui instances.
 * Handles tab state, connection management, and instance selection.
 * US-5: Tracks connection metrics and emits toast notifications for reconnection events.
 */
export class InstanceManager {
  private tabs: InstanceTab[] = [];
  private selectedIndex = 0;
  private clients: Map<string, RemoteClient> = new Map();
  private stateChangeHandler: InstanceStateChangeHandler | null = null;
  private remoteConfigs: Map<string, RemoteServerConfig> = new Map();
  private toastHandler: ToastHandler | null = null;

  /**
   * Initialize the instance manager.
   * Loads remote configurations and sets up the local tab.
   */
  async initialize(): Promise<void> {
    // Always start with the local tab
    this.tabs = [createLocalTab()];

    // Load remote configurations
    const remotes = await listRemotes();
    for (const [alias, config] of remotes) {
      this.remoteConfigs.set(alias, config);
      const tab = createRemoteTab(alias, config.host, config.port);
      this.tabs.push(tab);
    }

    this.notifyStateChange();
  }

  /**
   * Register a handler for state changes
   */
  onStateChange(handler: InstanceStateChangeHandler): void {
    this.stateChangeHandler = handler;
  }

  /**
   * Register a handler for toast notifications (reconnection events, errors).
   * Toasts are temporary notifications shown to the user.
   */
  onToast(handler: ToastHandler): void {
    this.toastHandler = handler;
  }

  /**
   * Emit a toast notification.
   */
  private emitToast(toast: ConnectionToast): void {
    if (this.toastHandler) {
      this.toastHandler(toast);
    }
  }

  /**
   * Get the current tabs
   */
  getTabs(): InstanceTab[] {
    return [...this.tabs];
  }

  /**
   * Get the selected tab index
   */
  getSelectedIndex(): number {
    return this.selectedIndex;
  }

  /**
   * Get the currently selected tab
   */
  getSelectedTab(): InstanceTab | undefined {
    return this.tabs[this.selectedIndex];
  }

  /**
   * Select a tab by index.
   * If the tab is disconnected, initiates a reconnection.
   */
  async selectTab(index: number): Promise<void> {
    if (index < 0 || index >= this.tabs.length) {
      return;
    }

    this.selectedIndex = index;
    const tab = this.tabs[index];

    // Reconnect if disconnected (per acceptance criteria: no auto-reconnect, only on selection)
    if (!tab.isLocal && tab.status === 'disconnected') {
      await this.connectToRemote(tab);
    }

    this.notifyStateChange();
  }

  /**
   * Select the next tab (wraps around)
   */
  async selectNextTab(): Promise<void> {
    const nextIndex = (this.selectedIndex + 1) % this.tabs.length;
    await this.selectTab(nextIndex);
  }

  /**
   * Select the previous tab (wraps around)
   */
  async selectPreviousTab(): Promise<void> {
    const prevIndex = (this.selectedIndex - 1 + this.tabs.length) % this.tabs.length;
    await this.selectTab(prevIndex);
  }

  /**
   * Disconnect from all remotes
   */
  disconnectAll(): void {
    for (const client of this.clients.values()) {
      client.disconnect();
    }
    this.clients.clear();

    // Update all remote tabs to disconnected
    for (const tab of this.tabs) {
      if (!tab.isLocal) {
        tab.status = 'disconnected';
      }
    }

    this.notifyStateChange();
  }

  /**
   * Refresh the remote list from configuration
   */
  async refresh(): Promise<void> {
    // Keep existing connections, but update the tab list
    const remotes = await listRemotes();
    const newAliases = new Set(remotes.map(([alias]) => alias));

    // Remove tabs for deleted remotes
    this.tabs = this.tabs.filter((tab) => {
      if (tab.isLocal) return true;
      if (!tab.alias) return false;
      if (!newAliases.has(tab.alias)) {
        // Disconnect if connected
        const client = this.clients.get(tab.alias);
        if (client) {
          client.disconnect();
          this.clients.delete(tab.alias);
        }
        return false;
      }
      return true;
    });

    // Add tabs for new remotes
    for (const [alias, config] of remotes) {
      this.remoteConfigs.set(alias, config);
      const existingTab = this.tabs.find((t) => t.alias === alias);
      if (!existingTab) {
        const tab = createRemoteTab(alias, config.host, config.port);
        this.tabs.push(tab);
      }
    }

    // Ensure selectedIndex is valid
    if (this.selectedIndex >= this.tabs.length) {
      this.selectedIndex = Math.max(0, this.tabs.length - 1);
    }

    this.notifyStateChange();
  }

  /**
   * Connect to a remote instance
   */
  private async connectToRemote(tab: InstanceTab): Promise<void> {
    if (!tab.alias || !tab.host || !tab.port) {
      return;
    }

    // Get the token from config
    const config = this.remoteConfigs.get(tab.alias);
    if (!config) {
      this.updateTabStatus(tab.id, 'disconnected', 'Remote configuration not found');
      return;
    }

    // Check for existing client
    let client = this.clients.get(tab.alias);
    if (client && client.status === 'connected') {
      return;
    }

    // Create new client if needed
    if (!client) {
      client = new RemoteClient(tab.host, tab.port, config.token, (event) => {
        this.handleClientEvent(tab.alias!, event);
      });
      this.clients.set(tab.alias, client);
    }

    // Update status to connecting
    this.updateTabStatus(tab.id, 'connecting');

    try {
      await client.connect();
      // Update last connected timestamp
      await updateLastConnected(tab.alias);
    } catch {
      // Error handling is done in the event handler
    }
  }

  /**
   * Handle events from a remote client.
   * US-5: Extended to handle reconnection events and metrics updates.
   */
  private handleClientEvent(alias: string, event: RemoteClientEvent): void {
    const tab = this.tabs.find((t) => t.alias === alias);
    if (!tab) return;

    const client = this.clients.get(alias);

    switch (event.type) {
      case 'connecting':
        this.updateTabStatus(tab.id, 'connecting');
        break;

      case 'connected':
        this.updateTabStatus(tab.id, 'connected');
        if (client) {
          this.updateTabMetrics(tab.id, client.metrics);
        }
        break;

      case 'disconnected':
        this.updateTabStatus(tab.id, 'disconnected', event.error);
        if (event.error) {
          this.emitToast({ type: 'connection_error', alias, error: event.error });
        }
        break;

      case 'reconnecting':
        this.updateTabStatus(tab.id, 'reconnecting');
        // Only show toast if past silent retry threshold (client knows this)
        if (client?.shouldAlertOnReconnect()) {
          this.emitToast({
            type: 'reconnecting',
            alias,
            attempt: event.attempt,
            maxRetries: event.maxRetries,
          });
        }
        break;

      case 'reconnected':
        this.updateTabStatus(tab.id, 'connected');
        if (client) {
          this.updateTabMetrics(tab.id, client.metrics);
        }
        // Always show toast for successful reconnection
        this.emitToast({
          type: 'reconnected',
          alias,
          totalAttempts: event.totalAttempts,
        });
        break;

      case 'reconnect_failed':
        this.updateTabStatus(tab.id, 'disconnected', event.error);
        this.emitToast({
          type: 'reconnect_failed',
          alias,
          attempts: event.attempts,
          error: event.error,
        });
        break;

      case 'metrics_updated':
        this.updateTabMetrics(tab.id, event.metrics);
        break;
    }
  }

  /**
   * Update a tab's connection status.
   */
  private updateTabStatus(tabId: string, status: ConnectionStatus, error?: string): void {
    const tab = this.tabs.find((t) => t.id === tabId);
    if (tab) {
      tab.status = status;
      tab.lastError = error;
      this.notifyStateChange();
    }
  }

  /**
   * Update a tab's connection metrics.
   */
  private updateTabMetrics(tabId: string, metrics: ConnectionMetrics): void {
    const tab = this.tabs.find((t) => t.id === tabId);
    if (tab) {
      tab.metrics = metrics;
      this.notifyStateChange();
    }
  }

  /**
   * Notify the state change handler
   */
  private notifyStateChange(): void {
    if (this.stateChangeHandler) {
      this.stateChangeHandler([...this.tabs], this.selectedIndex);
    }
  }
}

/**
 * Create a singleton instance manager
 */
let instanceManager: InstanceManager | null = null;

export function getInstanceManager(): InstanceManager {
  if (!instanceManager) {
    instanceManager = new InstanceManager();
  }
  return instanceManager;
}

/**
 * Reset the instance manager (for testing)
 */
export function resetInstanceManager(): void {
  if (instanceManager) {
    instanceManager.disconnectAll();
  }
  instanceManager = null;
}
