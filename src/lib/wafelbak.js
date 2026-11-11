(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.WafelbakLib = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function cleanText(value) {
    return String(value ?? "").trim();
  }

  function cleanEmail(email) {
    return cleanText(email).toLowerCase();
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function getElandBalkenState(waffleCount) {
    const count = Number.isFinite(waffleCount) ? waffleCount : 0;

    if (count >= 3) {
      return {
        stage: "ready",
        message: "Eland gespot! Je mag nu voluit balken.",
      };
    }

    if (count >= 1) {
      return {
        stage: "warming-up",
        message: `Nog ${3 - count} wafel(s) te gaan voor de eland verschijnt.`,
      };
    }

    return {
      stage: "start",
      message: "Start met je eerste wafel om de eland te lokken.",
    };
  }

  function validateRegistration(input) {
    const errors = {};
    const name = cleanText(input?.name);
    const email = cleanEmail(input?.email);
    const consent = Boolean(input?.consent);

    if (!name) {
      errors.name = "Naam is verplicht.";
    }

    if (!email) {
      errors.email = "E-mail is verplicht.";
    } else if (!isValidEmail(email)) {
      errors.email = "Geef een geldig e-mailadres.";
    }

    if (!consent) {
      errors.consent = "Je moet akkoord gaan om in te schrijven.";
    }

    return {
      valid: Object.keys(errors).length === 0,
      errors,
    };
  }

  function parseWaffleCount(value) {
    const trimmed = cleanText(value);
    if (!trimmed) {
      return null;
    }

    const parsed = Number.parseInt(trimmed, 10);
    if (Number.isNaN(parsed)) {
      return null;
    }

    return parsed;
  }

  function createRegistration(input) {
    return {
      id: `reg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: cleanText(input?.name),
      email: cleanEmail(input?.email),
      team: cleanText(input?.team),
      waffleCount: parseWaffleCount(input?.waffleCount),
      createdAt: new Date().toISOString(),
    };
  }

  return {
    getElandBalkenState,
    validateRegistration,
    createRegistration,
  };
});
