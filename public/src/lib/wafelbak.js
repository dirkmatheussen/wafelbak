(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.WafelbakLib = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const WAFFLES_PER_ROUND = 3;
  const ROUND_SECONDS = 20;

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
    const count = Number.isFinite(waffleCount) ? Math.floor(waffleCount) : 0;
    const rounds = Math.floor(count / WAFFLES_PER_ROUND);

    if (rounds >= 1) {
      const duration = `${ROUND_SECONDS} seconden`;
      return {
        stage: "ready",
        message:
          rounds === 1
            ? `Eland gespot! Laat je ${duration} horen.`
            : `Eland gespot! Je hebt ${rounds} beurten van ${duration}.`,
      };
    }

    if (count >= 1) {
      const remaining = WAFFLES_PER_ROUND - count;
      return {
        stage: "warming-up",
        message: `Nog ${remaining} ${remaining === 1 ? "wafel" : "wafels"} voor je eerste beurt.`,
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
    const password = String(input?.password ?? "");
    const nickname = cleanText(input?.nickname);
    const consent = Boolean(input?.consent);
    const wantsPractice = password.length > 0;

    if (!name) {
      errors.name = "Naam is verplicht.";
    }

    if (!email) {
      errors.email = "E-mail is verplicht.";
    } else if (!isValidEmail(email)) {
      errors.email = "Geef een geldig e-mailadres.";
    }

    if (wantsPractice) {
      if (password.length < 8 || password.length > 128) {
        errors.password = "Kies een wachtwoord van 8 tot 128 tekens.";
      }
      if (!nickname) {
        errors.nickname = "Kies een roepnaam om te oefenen of te delen.";
      }
      if (!consent) {
        errors.consent =
          "Geef toestemming om te oefenen en opnames te delen.";
      }
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
    ROUND_SECONDS,
    getElandBalkenState,
    validateRegistration,
    createRegistration,
  };
});
