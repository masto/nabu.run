/**
 * @param {import('preact-cli').Config} config - Original webpack config
 * @param {import('preact-cli').Env} env - Current environment info
 * @param {import('preact-cli').Helpers} helpers - Object with useful helpers for working with the webpack config
 */
export default (config, env, helpers) => {
  if (env.isProd) {
    config.devtool = false;
  }

  const { plugin } = helpers.getPluginsByName(config, 'DefinePlugin')[0];
  plugin.definitions['process.env.VERSION'] = JSON.stringify(process.env.npm_package_version);
}
