module.exports = async function handler(req, res) {
  const { dispatchApi } = await import("../../lib/app.mjs");
  const id = req.query?.id || "";
  req.url = `/api/recordings/${id}`;
  await dispatchApi(req, res);
};

module.exports.config = {
  api: {
    bodyParser: false,
  },
};
