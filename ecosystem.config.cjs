module.exports = {
  apps: [
    {
      name: 'quickglimpse',
      script: './packages/server/dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      node_args: '--env-file=.env',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
}
