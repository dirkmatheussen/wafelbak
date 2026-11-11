module.exports = async function handler(req, res) {
  const { dispatchApi } = await import("../lib/app.mjs");
  req.url = "/api/register";
  await dispatchApi(req, res);
};

module.exports.config = {
  api: {
    bodyParser: false,
  },
};
