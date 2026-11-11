module.exports = async function handler(req, res) {
  const { dispatchApi } = await import("../lib/app.mjs");
  req.url = "/api/account";
  await dispatchApi(req, res);
};
