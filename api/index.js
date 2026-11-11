module.exports = async function handler(req, res) {
  const { createApp } = await import("../lib/app.mjs");
  const app = createApp();
  return app(req, res);
};
