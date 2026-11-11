module.exports = async function handler(req, res) {
  const { dispatchApi } = await import("../lib/app.mjs");
  req.url = "/api/session";
  await dispatchApi(req, res);
};
