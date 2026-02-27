module.exports = {
  apps: [
    {
      name: 'superclaw',
      script: 'dist/index.js',
      watch: false,
      max_memory_restart: '500M',
      out_file: './logs/pm2.log',
      error_file: './logs/pm2-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      autorestart: true,
      cron_restart: '0 4 * * *',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
