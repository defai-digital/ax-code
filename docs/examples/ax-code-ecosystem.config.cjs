module.exports = {
  apps: [
    {
      name: "ax-code-server",
      script: "/absolute/path/to/ax-code",
      args: "serve --hostname=127.0.0.1 --port=4096",
      cwd: "/absolute/path/to/project",
      env: {
        AX_CODE_PROJECT: "/absolute/path/to/project",
      },
      autorestart: true,
      restart_delay: 5_000,
      kill_timeout: 90_000,
      max_restarts: 20,
      min_uptime: "10s",
    },
  ],
}
