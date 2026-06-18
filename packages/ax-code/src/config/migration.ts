/**
 * Configuration Migration Helper
 *
 * Provides backward compatibility for the deprecated `super_long` config.
 * During the 6-month deprecation period, this module:
 * - Detects old `super_long` config format
 * - Maps it to the new `autonomous.long_run` format
 * - Logs deprecation warnings
 *
 * @deprecated This module will be removed after the deprecation period (2026-12-15)
 */

import { Log } from "../util/log.js"

const log = Log.create({ service: "config-migration" })

/**
 * Old config format (deprecated)
 * @deprecated Use `NewAutonomousConfig` instead
 */
export interface LegacySuperLongConfig {
  enabled?: boolean
  duration_hours?: number
}

/**
 * Old config format with super_long key
 * @deprecated Use `NewConfig` instead
 */
export interface LegacyConfig {
  super_long?: boolean | LegacySuperLongConfig
  autonomous?: boolean
}

/**
 * New config format
 */
export interface NewLongRunConfig {
  enabled: boolean
  max_duration_hours?: number
}

/**
 * New autonomous config with long_run support
 */
export interface NewAutonomousConfig {
  enabled: boolean
  long_run?: NewLongRunConfig
}

/**
 * New config format
 */
export interface NewConfig {
  autonomous?: NewAutonomousConfig
}

/**
 * Migration result with warnings
 */
export interface MigrationResult {
  config: NewConfig
  warnings: string[]
  migrated: boolean
}

/**
 * Check if config uses the deprecated `super_long` format.
 *
 * @param config - Configuration object to check
 * @returns true if config contains deprecated `super_long` key
 */
export function hasLegacyConfig(config: Record<string, unknown> | LegacyConfig | null | undefined): boolean {
  if (!config || typeof config !== "object") {
    return false
  }
  return "super_long" in config
}

/**
 * Migrate legacy `super_long` config to new `autonomous.long_run` format.
 *
 * This function:
 * - Preserves existing `autonomous` config
 * - Maps `super_long: true` to `autonomous.long_run.enabled: true`
 * - Maps `super_long.duration_hours` to `autonomous.long_run.max_duration_hours`
 * - Logs deprecation warnings
 *
 * @param config - Configuration object (may contain legacy `super_long` key)
 * @returns Migrated config with warnings
 *
 * @example
 * ```typescript
 * const oldConfig = { super_long: { enabled: true, duration_hours: 24 } }
 * const result = migrateLegacyConfig(oldConfig)
 * // result.config = { autonomous: { enabled: true, long_run: { enabled: true, max_duration_hours: 24 } } }
 * // result.warnings = ["super_long config is deprecated..."]
 * ```
 */
export function migrateLegacyConfig(config: LegacyConfig): MigrationResult {
  const warnings: string[] = []
  let migrated = false

  // Check if migration is needed
  if (!hasLegacyConfig(config)) {
    return { config: config as NewConfig, warnings, migrated: false }
  }

  const legacy = config as LegacyConfig
  const newConfig: NewConfig = { ...config } as NewConfig

  // Migrate super_long config
  if (legacy.super_long !== undefined) {
    migrated = true
    warnings.push(
      "The 'super_long' configuration is deprecated and will be removed in 6 months (2026-12-15). " +
        "Please migrate to 'autonomous.long_run' instead. " +
        "See documentation for migration guide.",
    )

    // Initialize autonomous config if not present
    if (!newConfig.autonomous) {
      newConfig.autonomous = {
        enabled: true,
      }
    }

    // Map super_long to autonomous.long_run
    if (typeof legacy.super_long === "boolean") {
      newConfig.autonomous.long_run = {
        enabled: legacy.super_long,
      }
    } else if (typeof legacy.super_long === "object") {
      newConfig.autonomous.long_run = {
        enabled: legacy.super_long.enabled ?? true,
        max_duration_hours: legacy.super_long.duration_hours,
      }
    }

    // Ensure autonomous is enabled when long_run is enabled
    if (newConfig.autonomous.long_run?.enabled && !newConfig.autonomous.enabled) {
      newConfig.autonomous.enabled = true
      warnings.push("Automatically enabled 'autonomous' because 'autonomous.long_run' is enabled.")
    }
  }

  // Log warnings
  for (const warning of warnings) {
    log.warn(warning)
  }

  return { config: newConfig, warnings, migrated }
}

/**
 * Deprecation notice for logging.
 *
 * Call this function when loading configuration to ensure users see
 * the deprecation warning.
 */
export function logDeprecationNotice(): void {
  log.warn(
    "Configuration format change notice: " +
      "The 'super_long' configuration key is deprecated. " +
      "Please migrate to 'autonomous.long_run' by 2026-12-15. " +
      "Run 'ax-code config migrate' for automatic migration.",
  )
}

/**
 * Check if we're within the deprecation period.
 *
 * The deprecation period is 6 months from the announcement date (2026-06-15).
 *
 * @returns true if within deprecation period, false if past removal date
 */
export function isWithinDeprecationPeriod(): boolean {
  const removalDate = new Date("2026-12-15")
  const now = new Date()
  return now < removalDate
}

/**
 * Get days remaining in deprecation period.
 *
 * @returns Number of days remaining, or 0 if past removal date
 */
export function getDaysRemaining(): number {
  const removalDate = new Date("2026-12-15")
  const now = new Date()
  const diffMs = removalDate.getTime() - now.getTime()
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
  return Math.max(0, diffDays)
}

/**
 * Format deprecation warning message with days remaining.
 *
 * @returns Formatted warning message
 */
export function formatDeprecationWarning(): string {
  const days = getDaysRemaining()
  if (days === 0) {
    return "CRITICAL: The 'super_long' configuration has been removed. Please migrate immediately."
  }
  return `WARNING: The 'super_long' configuration will be removed in ${days} days (2026-12-15). Please migrate to 'autonomous.long_run'.`
}
