(function () {
  const { ROUND_SECONDS, validateRegistration } = window.WafelbakLib;
  const signup = document.getElementById("signupPanel");
  const form = document.getElementById("registrationForm");
  const fields = document.getElementById("registrationFields");
  const formStatus = document.getElementById("formStatus");
  const returning = document.getElementById("inloggen");
  const loginForm = document.getElementById("loginForm");
  const loginButton = loginForm.querySelector("button");
  const loginStatus = document.getElementById("loginStatus");
  const gate = document.getElementById("practiceGate");
  const controls = document.getElementById("practiceControls");
  const greeting = document.getElementById("practiceGreeting");
  const start = document.getElementById("startRound");
  const timer = document.getElementById("roundTimer");
  const roundStatus = document.getElementById("roundStatus");
  const micStatus = document.getElementById("micStatus");
  const eland = document.getElementById("elandVisual");
  const preview = document.getElementById("recordingPreview");
  const player = document.getElementById("ownRecording");
  const share = document.getElementById("shareRecording");
  const discard = document.getElementById("discardRecording");
  const gallery = document.getElementById("recordingsPanel");
  const galleryStatus = document.getElementById("recordingsStatus");
  const list = document.getElementById("recordingsList");
  const refresh = document.getElementById("refreshRecordings");
  const more = document.getElementById("moreRecordings");

  let capture = null;
  let draft = null;
  let offset = 0;

  async function request(path, options) {
    const response = await fetch(`/api/${path}`, options);
    const type = response.headers.get("Content-Type") || "";
    if (!type.includes("application/json")) {
      throw new Error("Open de Wafelbak-site via de server om te oefenen.");
    }

    const data = await response.json();
    if (!response.ok) {
      const error = new Error(data.error || "De aanvraag is mislukt. Probeer opnieuw.");
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function showSignup() {
    if (capture) {
      closeCapture(capture);
    }
    clearDraft();
    signup.hidden = false;
    fields.disabled = false;
    gate.hidden = false;
    controls.hidden = true;
    gallery.hidden = true;
    list.replaceChildren();
    formStatus.textContent = "Je inschrijving in deze browser is verlopen. Schrijf je opnieuw in.";
  }

  function showPractice(nickname) {
    signup.hidden = true;
    gate.hidden = true;
    controls.hidden = false;
    gallery.hidden = false;
    greeting.textContent = `Klaar om te balken, ${nickname}?`;
    loadRecordings();
  }

  async function deleteAccount() {
    if (
      !window.confirm(
        "Wil je je inschrijving en alle gedeelde opnames definitief verwijderen?"
      )
    ) {
      return;
    }
    await request("account", { method: "DELETE" });
    showSignup();
    formStatus.textContent = "Je inschrijving is verwijderd.";
  }

  function openLogin() {
    if (location.hash === "#inloggen") {
      returning.open = true;
    }
  }

  window.addEventListener("hashchange", openLogin);
  openLogin();

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    loginButton.disabled = true;
    loginStatus.textContent = "Aanmelden…";
    try {
      const loginData = new FormData(loginForm);
      const { nickname } = await request("login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: loginData.get("email"),
          password: loginData.get("password"),
        }),
      });
      loginForm.reset();
      loginStatus.textContent = "";
      showPractice(nickname);
      start.focus();
    } catch (error) {
      loginStatus.textContent = error.message;
    } finally {
      loginButton.disabled = false;
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const count = form.elements.waffleCount;
    const partySize = form.elements.partySize;
    const arrivalTime = form.elements.arrivalTime;
    const password = String(data.get("password") || "");
    const input = {
      name: data.get("name"),
      email: data.get("email"),
      nickname: String(data.get("nickname") || "").trim(),
      password,
      waffleCount: count.value === "" ? null : count.valueAsNumber,
      partySize: partySize.value === "" ? null : partySize.valueAsNumber,
      arrivalTime: arrivalTime.value || null,
      consent: data.has("consent"),
    };
    const { errors } = validateRegistration(input);
    if (!input.nickname) {
      errors.nickname = "Kies een roepnaam.";
    }
    if (password.length < 8 || password.length > 128) {
      errors.password = "Kies een wachtwoord van 8 tot 128 tekens.";
    }
    if (!count.validity.valid) {
      errors.waffleCount = "Geef een geheel aantal tussen 0 en 999 op.";
    }
    if (!partySize.validity.valid) {
      errors.partySize = "Geef een geheel aantal tussen 1 en 999 op.";
    }
    if (!arrivalTime.validity.valid) {
      errors.arrivalTime = "Vul een geldig aankomstuur in.";
    }

    for (const node of form.querySelectorAll("[data-error-for]")) {
      node.textContent = errors[node.dataset.errorFor] || "";
    }
    if (Object.keys(errors).length) {
      formStatus.textContent = "Controleer de aangeduide velden.";
      form.elements[Object.keys(errors)[0]].focus();
      return;
    }

    fields.disabled = true;
    formStatus.textContent = "Inschrijving bewaren…";
    try {
      await request("register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      form.reset();
      const session = await request("session");
      if (session.nickname) {
        showPractice(session.nickname);
        start.focus();
      } else {
        formStatus.textContent =
          "Inschrijving verwerkt. Meld je aan als je al een account had.";
        returning.open = true;
      }
    } catch (error) {
      formStatus.textContent = error.message;
    } finally {
      fields.disabled = false;
    }
  });

  function wavBlob(samples, sampleRate) {
    // Some microphones run above 48 kHz. Keep all uploads within the WAV size limit.
    if (sampleRate > 48000) {
      const ratio = sampleRate / 48000;
      const converted = new Int16Array(Math.floor(samples.length / ratio));
      for (let index = 0; index < converted.length; index += 1) {
        const first = Math.floor(index * ratio);
        const end = Math.floor((index + 1) * ratio);
        let sum = 0;
        for (let sample = first; sample < end; sample += 1) {
          sum += samples[sample];
        }
        converted[index] = sum / (end - first);
      }
      samples = converted;
      sampleRate = 48000;
    }
    const wav = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(wav);
    const writeTag = (offset, tag) => {
      for (let index = 0; index < tag.length; index += 1) {
        view.setUint8(offset + index, tag.charCodeAt(index));
      }
    };
    writeTag(0, "RIFF");
    view.setUint32(4, wav.byteLength - 8, true);
    writeTag(8, "WAVE");
    writeTag(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeTag(36, "data");
    view.setUint32(40, samples.length * 2, true);
    samples.forEach((sample, index) => view.setInt16(44 + index * 2, sample, true));
    return new Blob([wav], { type: "audio/wav" });
  }

  function closeCapture(recording) {
    window.clearInterval(recording.interval);
    recording.stream?.getTracks().forEach((track) => track.stop());
    recording.context?.close().catch(() => {});
    capture = null;
    micStatus.hidden = true;
    eland.classList.remove("is-calling");
    start.disabled = false;
    start.textContent = "Start opname";
    timer.textContent = `${ROUND_SECONDS} s`;
  }

  function finishCapture(recording, samples) {
    if (capture !== recording) {
      return;
    }
    const sampleRate = recording.context.sampleRate;
    closeCapture(recording);
    if (!samples.length) {
      roundStatus.textContent = "Er is geen geluid opgenomen. Probeer opnieuw.";
      return;
    }

    const blob = wavBlob(samples, sampleRate);
    draft = { blob, url: URL.createObjectURL(blob) };
    player.src = draft.url;
    preview.hidden = false;
    start.disabled = true;
    roundStatus.textContent = "Opname klaar.";
  }

  function stopCapture() {
    if (capture?.node) {
      capture.node.port.postMessage("stop");
      start.disabled = true;
      window.clearInterval(capture.interval);
    }
  }

  async function startCapture() {
    if (capture) {
      stopCapture();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode || !window.AudioContext) {
      roundStatus.textContent = "Open deze pagina via HTTPS of localhost in een browser met microfoonondersteuning.";
      return;
    }

    const recording = {};
    capture = recording;
    start.disabled = true;
    roundStatus.textContent = "Geef je browser toegang tot de microfoon.";
    try {
      recording.context = new AudioContext();
      const resume = recording.context.resume();
      const microphone = navigator.mediaDevices.getUserMedia({ audio: true });
      // If the page closes while the permission prompt is open, release a late stream.
      microphone.then((stream) => {
        if (capture === recording) {
          recording.stream = stream;
        } else {
          stream.getTracks().forEach((track) => track.stop());
        }
      }).catch(() => {});
      const [, stream] = await Promise.all([resume, microphone]);
      if (capture !== recording) {
        return;
      }

      const context = recording.context;
      await context.audioWorklet.addModule("./src/recording-worklet.js");
      if (capture !== recording) {
        return;
      }
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      const signal = new Float32Array(analyser.fftSize);
      const node = new AudioWorkletNode(context, "eland-recorder", {
        channelCount: 1,
        channelCountMode: "explicit",
        processorOptions: { seconds: ROUND_SECONDS },
      });
      recording.node = node;
      node.port.onmessage = ({ data }) => finishCapture(recording, data);
      node.onprocessorerror = () => {
        if (capture === recording) {
          closeCapture(recording);
          roundStatus.textContent = "De opname werd onderbroken. Probeer opnieuw.";
        }
      };
      for (const track of stream.getTracks()) {
        track.addEventListener("ended", stopCapture, { once: true });
      }
      // The worklet writes no output samples, so the microphone is never played back live.
      source.connect(analyser).connect(node).connect(context.destination);
      micStatus.hidden = false;
      start.textContent = "Stop opname";
      start.disabled = false;
      roundStatus.textContent = "Microfoon aan. Balken maar!";
      const deadline = performance.now() + ROUND_SECONDS * 1000;
      let lastAudible = -Infinity;
      recording.interval = window.setInterval(() => {
        const now = performance.now();
        analyser.getFloatTimeDomainData(signal);
        const meanSquare = signal.reduce((sum, sample) => sum + sample * sample, 0) / signal.length;
        if (meanSquare >= 0.008 ** 2) {
          lastAudible = now;
        }
        eland.classList.toggle("is-calling", now - lastAudible < 200);

        const remaining = Math.max(0, Math.ceil((deadline - now) / 1000));
        timer.textContent = `${remaining} s`;
        if (!remaining) {
          stopCapture();
        }
      }, 100);
    } catch (error) {
      if (capture === recording) {
        closeCapture(recording);
        roundStatus.textContent = error.name === "NotAllowedError"
          ? "De microfoon is geblokkeerd. Geef toestemming in je browser en probeer opnieuw."
          : "De microfoon kon niet starten. Controleer of hij beschikbaar is.";
      }
    }
  }

  function clearDraft() {
    if (draft) {
      player.pause();
      player.removeAttribute("src");
      player.load();
      URL.revokeObjectURL(draft.url);
      draft = null;
    }
    preview.hidden = true;
    start.disabled = false;
  }

  start.addEventListener("click", startCapture);
  discard.addEventListener("click", () => {
    clearDraft();
    roundStatus.textContent = "Proefopname gewist.";
    start.focus();
  });
  window.addEventListener("pagehide", () => {
    if (capture) {
      closeCapture(capture);
      roundStatus.textContent = "";
    }
  });

  share.addEventListener("click", async () => {
    if (!draft) {
      return;
    }
    share.disabled = true;
    discard.disabled = true;
    roundStatus.textContent = "Opname delen…";
    try {
      await request("recordings", { method: "POST", body: draft.blob });
      clearDraft();
      roundStatus.textContent = "Je opname staat bij de gedeelde elandroepen.";
      start.focus();
      loadRecordings();
    } catch (error) {
      if (error.status === 401) {
        showSignup();
      } else {
        roundStatus.textContent = error.message;
      }
    } finally {
      share.disabled = false;
      discard.disabled = false;
    }
  });

  function recordingRow(item) {
    const row = document.createElement("li");
    const label = document.createElement("strong");
    label.textContent = item.nickname;
    const audio = document.createElement("audio");
    audio.controls = true;
    audio.preload = "none";
    audio.src = `/api/recordings/${item.id}`;
    audio.setAttribute("aria-label", `Opname van ${item.nickname}`);
    row.append(label, audio);
    if (item.own) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "recordings-remove";
      remove.textContent = "Verwijder mijn opname";
      remove.addEventListener("click", async () => {
        remove.disabled = true;
        try {
          await request(`recordings/${item.id}`, { method: "DELETE" });
          refresh.focus();
          loadRecordings();
        } catch (error) {
          galleryStatus.textContent = error.message;
          remove.disabled = false;
        }
      });
      row.append(remove);
    }
    return row;
  }

  let galleryRequest = 0;
  async function loadRecordings(append = false) {
    const requestNumber = ++galleryRequest;
    refresh.disabled = true;
    more.disabled = true;
    const from = append ? offset : 0;
    try {
      const data = await request(`recordings?offset=${from}`);
      if (requestNumber !== galleryRequest) {
        return;
      }
      if (!append) {
        list.replaceChildren();
      }
      list.append(...data.items.map(recordingRow));
      offset = from + data.items.length;
      more.hidden = data.items.length < 25;
      galleryStatus.textContent = offset ? "" : "Er zijn nog geen gedeelde opnames.";
    } catch (error) {
      if (requestNumber === galleryRequest) {
        if (error.status === 401) {
          showSignup();
        } else {
          galleryStatus.textContent = error.message;
        }
      }
    } finally {
      if (requestNumber === galleryRequest) {
        refresh.disabled = false;
        more.disabled = false;
      }
    }
  }

  refresh.addEventListener("click", () => loadRecordings());
  more.addEventListener("click", () => loadRecordings(true));
  const deleteAccountButton = document.getElementById("deleteAccount");
  if (deleteAccountButton) {
    deleteAccountButton.addEventListener("click", async () => {
      deleteAccountButton.disabled = true;
      try {
        await deleteAccount();
      } catch (error) {
        roundStatus.textContent = error.message;
      } finally {
        deleteAccountButton.disabled = false;
      }
    });
  }

  async function restoreSession() {
    try {
      const { nickname } = await request("session");
      if (nickname) {
        showPractice(nickname);
      }
      fields.disabled = false;
      loginButton.disabled = false;
    } catch (error) {
      formStatus.textContent = error.message;
    }
  }

  if (location.protocol === "file:") {
    formStatus.textContent = "Open de site via http://127.0.0.1:4173 om je in te schrijven en opnames te delen.";
  } else {
    restoreSession();
  }
})();
