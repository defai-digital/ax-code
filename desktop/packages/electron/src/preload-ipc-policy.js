"use strict"

// Keep the renderer bridge capability-based. A newly-added main-process IPC
// handler is not exposed to renderer JavaScript until it is deliberately
// reviewed and added here.
const DESKTOP_INVOKE_COMMANDS = new Set([
  "desktop_browser_capture_page",
  "desktop_capture_page_rect",
  "desktop_check_for_updates",
  "desktop_clear_cache",
  "desktop_close_current_window",
  "desktop_dialog_open",
  "desktop_download_and_install_update",
  "desktop_fetch_app_icons",
  "desktop_filter_installed_apps",
  "desktop_focus_main_window",
  "desktop_get_app_version",
  "desktop_get_current_window_state",
  "desktop_get_installed_apps",
  "desktop_get_lan_address",
  "desktop_get_launch_at_login",
  "desktop_get_window_pinned",
  "desktop_host_probe",
  "desktop_hosts_get",
  "desktop_hosts_set",
  "desktop_is_window_fullscreen",
  "desktop_minimize_current_window",
  "desktop_new_window",
  "desktop_new_window_at_url",
  "desktop_notify",
  "desktop_open_draft_mini_chat_window",
  "desktop_open_external_url",
  "desktop_open_file_in_app",
  "desktop_open_in_app",
  "desktop_open_path",
  "desktop_open_session_mini_chat_window",
  "desktop_quit_and_install",
  "desktop_read_file",
  "desktop_record_startup_event",
  "desktop_restart",
  "desktop_reveal_path",
  "desktop_save_markdown_file",
  "desktop_search_files",
  "desktop_set_badge_count",
  "desktop_set_launch_at_login",
  "desktop_set_vibrancy",
  "desktop_set_window_pinned",
  "desktop_set_window_theme",
  "desktop_set_window_title",
  "desktop_show_app_menu",
  "desktop_ssh_connect",
  "desktop_ssh_disconnect",
  "desktop_ssh_import_hosts",
  "desktop_ssh_instances_get",
  "desktop_ssh_instances_set",
  "desktop_ssh_logs",
  "desktop_ssh_logs_clear",
  "desktop_ssh_status",
  "desktop_toggle_current_window_maximized",
])

const isAllowedDesktopInvokeCommand = (command) => {
  return typeof command === "string" && DESKTOP_INVOKE_COMMANDS.has(command)
}

module.exports = {
  DESKTOP_INVOKE_COMMANDS,
  isAllowedDesktopInvokeCommand,
}
