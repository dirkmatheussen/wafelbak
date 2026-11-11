import { createApp } from "./lib/app.mjs";

const app = createApp();
const host = process.env.PORT ? "0.0.0.0" : "127.0.0.1";
const port = Number(process.env.PORT || 4173);

app.listen(port, host, () => {
  console.log(`Wafelbak: http://${host}:${port}`);
});
