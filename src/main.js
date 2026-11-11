(function () {
  const STORAGE_KEY = "wafelbakRegistrations";
  const { getElandBalkenState, validateRegistration, createRegistration } =
    window.WafelbakLib;

  const waffleRange = document.getElementById("waffleRange");
  const waffleCountValue = document.getElementById("waffleCountValue");
  const minusWaffle = document.getElementById("minusWaffle");
  const plusWaffle = document.getElementById("plusWaffle");
  const demoMessage = document.getElementById("demoMessage");
  const wafflesVisual = document.getElementById("wafflesVisual");
  const elandVisual = document.getElementById("elandVisual");

  const registrationForm = document.getElementById("registrationForm");
  const formStatus = document.getElementById("formStatus");
  const registrationsList = document.getElementById("registrationsList");

  let registrations = loadRegistrations();

  function loadRegistrations() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return [];
      }

      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
      return [];
    }
  }

  function saveRegistrations() {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(registrations));
  }

  function updateElandDemo(newCount) {
    const clampedCount = Math.max(
      Number(waffleRange.min),
      Math.min(Number(waffleRange.max), Number(newCount))
    );

    waffleRange.value = String(clampedCount);
    waffleCountValue.value = String(clampedCount);

    wafflesVisual.innerHTML = "";
    for (let index = 0; index < clampedCount; index += 1) {
      const waffle = document.createElement("span");
      waffle.className = "waffle-icon";
      waffle.textContent = "🧇";
      wafflesVisual.appendChild(waffle);
    }

    const state = getElandBalkenState(clampedCount);
    demoMessage.textContent = state.message;
    elandVisual.classList.toggle("is-visible", state.stage === "ready");
  }

  function getFormInput() {
    const formData = new FormData(registrationForm);

    return {
      name: formData.get("name"),
      email: formData.get("email"),
      team: formData.get("team"),
      waffleCount: formData.get("waffleCount"),
      consent: formData.get("consent") === "on",
    };
  }

  function renderErrors(errors) {
    const errorNodes = registrationForm.querySelectorAll("[data-error-for]");
    errorNodes.forEach((node) => {
      const field = node.getAttribute("data-error-for");
      node.textContent = errors[field] || "";
    });
  }

  function renderRegistrations() {
    registrationsList.innerHTML = "";

    if (registrations.length === 0) {
      const empty = document.createElement("li");
      empty.textContent = "Nog geen inschrijvingen op dit toestel. Jij kan de eerste zijn!";
      registrationsList.appendChild(empty);
      return;
    }

    const sorted = [...registrations].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    );

    sorted.forEach((entry) => {
      const item = document.createElement("li");
      const waffleText =
        typeof entry.waffleCount === "number"
          ? `${entry.waffleCount} wafels`
          : "mysterieus aantal wafels";

      item.innerHTML = `
        <strong>${escapeHtml(entry.name)}</strong> · ${escapeHtml(entry.email)}<br />
        Team: ${escapeHtml(entry.team || "Solo")} · Claim: ${escapeHtml(
          waffleText
        )}
      `;
      registrationsList.appendChild(item);
    });
  }

  function escapeHtml(text) {
    return String(text)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  waffleRange.addEventListener("input", (event) => {
    updateElandDemo(Number(event.target.value));
  });

  minusWaffle.addEventListener("click", () => {
    updateElandDemo(Number(waffleRange.value) - 1);
  });

  plusWaffle.addEventListener("click", () => {
    updateElandDemo(Number(waffleRange.value) + 1);
  });

  registrationForm.addEventListener("submit", (event) => {
    event.preventDefault();
    formStatus.textContent = "";
    formStatus.classList.remove("is-success");

    const input = getFormInput();
    const validation = validateRegistration(input);
    renderErrors(validation.errors);

    if (!validation.valid) {
      formStatus.textContent = "Controleer de velden met foutmeldingen.";
      return;
    }

    const registration = createRegistration(input);
    registrations.push(registration);
    saveRegistrations();
    renderRegistrations();

    registrationForm.reset();
    renderErrors({});
    formStatus.textContent =
      "Gelukt! Je inschrijving staat in de lokale deelnemerslijst.";
    formStatus.classList.add("is-success");
  });

  updateElandDemo(Number(waffleRange.value));
  renderRegistrations();
})();
