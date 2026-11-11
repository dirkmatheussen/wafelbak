module.exports = async function handler(req, res) {
  const { dispatchApi } = await import("../lib/app.mjs");
  const query = req.url?.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  req.url = `/api/recordings${query}`;
  await dispatchApi(req, res);
};

module.exports.config = {
  api: {
    bodyParser: false,
  },
};
