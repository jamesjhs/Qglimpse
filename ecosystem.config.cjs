module.exports = {
  apps: [
    {
      name: 'quickglimpse',
      script: './packages/server/dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
    },
  ],
}
