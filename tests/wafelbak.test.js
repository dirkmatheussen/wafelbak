const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getElandBalkenState,
  validateRegistration,
  createRegistration,
} = require("../public/src/lib/wafelbak");

test("getElandBalkenState returns ready state at 3 waffles", () => {
  const result = getElandBalkenState(3);
  assert.equal(result.stage, "ready");
  assert.match(result.message, /eland/i);
});

test("getElandBalkenState returns warming-up below threshold", () => {
  const result = getElandBalkenState(2);
  assert.equal(result.stage, "warming-up");
  assert.match(result.message, /nog 1/i);
});

test("validateRegistration rejects missing required fields", () => {
  const result = validateRegistration({
    name: "",
    email: "",
    team: "",
    waffleCount: "",
    consent: false,
  });

  assert.equal(result.valid, false);
  assert.equal(result.errors.name, "Naam is verplicht.");
  assert.equal(result.errors.email, "E-mail is verplicht.");
  assert.equal(result.errors.consent, "Je moet akkoord gaan om in te schrijven.");
});

test("validateRegistration rejects malformed email", () => {
  const result = validateRegistration({
    name: "Mila",
    email: "niet-geldig",
    consent: true,
  });

  assert.equal(result.valid, false);
  assert.equal(result.errors.email, "Geef een geldig e-mailadres.");
});

test("createRegistration normalizes values and parses waffle count", () => {
  const registration = createRegistration({
    name: "  Ana  ",
    email: " ANA@EXAMPLE.COM ",
    team: "  Team X  ",
    waffleCount: "5",
  });

  assert.equal(registration.name, "Ana");
  assert.equal(registration.email, "ana@example.com");
  assert.equal(registration.team, "Team X");
  assert.equal(registration.waffleCount, 5);
  assert.equal(typeof registration.id, "string");
  assert.equal(typeof registration.createdAt, "string");
});
