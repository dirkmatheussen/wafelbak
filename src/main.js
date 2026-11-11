(function () {
  const ride = document.getElementById("waffleRide");
  if (!ride) {
    return;
  }

  const team = ride.querySelector(".ride__team");
  const replay = ride.querySelector(".ride__replay");
  const soundButton = ride.querySelector(".ride__sound");
  const sound = document.getElementById("rideSound");
  const leg = document.getElementById("ride-leg");
  const crank = document.getElementById("ride-crank");
  const pedal = document.getElementById("ride-pedal");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let pedalFrame;

  function pedalAlong(animation) {
    const angle = (animation.currentTime ?? 0) / 650 * 2 * Math.PI + 0.85;
    const horizontal = Math.round(18 * Math.cos(angle));
    const vertical = Math.round(18 * Math.sin(angle));
    const pedalX = 147 + horizontal;
    const pedalY = 312 + vertical;
    const kneeX = 166 + Math.round(horizontal * 0.38);
    const kneeY = 222 + Math.round(vertical * 0.42);
    const ankleX = pedalX - 5;
    const ankleY = pedalY - 12;

    crank.setAttribute("d", `M147 312 L${pedalX} ${pedalY}`);
    pedal.setAttribute("d", `M${pedalX - 6} ${pedalY} h15`);
    leg.setAttribute("d", `M119 199 Q132 210 ${kneeX} ${kneeY} L${ankleX} ${ankleY} l15 2`);
    pedalFrame = window.requestAnimationFrame(() => pedalAlong(animation));
  }

  function startRide() {
    if (reduceMotion.matches) {
      return;
    }

    sound.currentTime = 0;
    playMooseCall();

    if (team.classList.contains("is-riding")) {
      for (const animation of team.getAnimations({ subtree: true })) {
        animation.currentTime = 0;
      }
      return;
    }
    team.classList.add("is-riding");
    const animation = team.getAnimations().find((item) => item.animationName === "ride-across");
    if (animation) {
      pedalAlong(animation);
      team.classList.add("is-pedaling");
    }
  }

  function finishRide(event) {
    if (event.target !== team || event.animationName !== "ride-across") {
      return;
    }

    window.cancelAnimationFrame(pedalFrame);
    team.classList.remove("is-riding", "is-pedaling");
  }

  team.addEventListener("animationend", finishRide);
  team.addEventListener("animationcancel", finishRide);
  replay.addEventListener("click", startRide);
  replay.hidden = false;

  function updateSoundButton() {
    const playing = !sound.paused && !sound.ended;
    soundButton.setAttribute("aria-pressed", String(playing));
  }

  async function playMooseCall() {
    try {
      await sound.play();
      soundButton.classList.remove("needs-play");
    } catch (error) {
      soundButton.classList.toggle("needs-play", error.name === "NotAllowedError");
      updateSoundButton();
    }
  }

  soundButton.addEventListener("click", () => {
    if (!sound.paused) {
      sound.pause();
      sound.currentTime = 0;
      return;
    }

    playMooseCall();
  });
  sound.addEventListener("play", updateSoundButton);
  sound.addEventListener("pause", updateSoundButton);
  sound.addEventListener("ended", updateSoundButton);
  soundButton.hidden = false;

  const rideObserver = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.intersectionRatio >= 0.5)) {
      rideObserver.disconnect();
      startRide();
    }
  }, { threshold: 0.5 });
  rideObserver.observe(ride);
})();
