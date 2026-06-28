function shouldCheckForUpdatesOnStartup(env = process.env) {
  return env.AX_CODE_DESKTOP_DISABLE_AUTO_UPDATE !== "1"
}

module.exports = {
  shouldCheckForUpdatesOnStartup,
}
