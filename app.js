const canvas = document.querySelector("#visualizer");
const ctx = canvas.getContext("2d", { alpha: false });

const ui = {
  micButton: document.querySelector("#micButton"),
  demoButton: document.querySelector("#demoButton"),
  clearButton: document.querySelector("#clearButton"),
  statusDot: document.querySelector("#statusDot"),
  statusText: document.querySelector("#statusText"),
  sensitivity: document.querySelector("#sensitivity"),
  lowFocus: document.querySelector("#lowFocus"),
  highFocus: document.querySelector("#highFocus"),
  birdScore: document.querySelector("#birdScore"),
  centroid: document.querySelector("#centroid"),
  peakCount: document.querySelector("#peakCount"),
};

const state = {
  width: 0,
  height: 0,
  dpr: 1,
  startedAt: performance.now(),
  audioContext: null,
  analyser: null,
  stream: null,
  source: null,
  freqData: null,
  prevData: null,
  demoMode: false,
  demoData: new Uint8Array(2048),
  demoChirps: [],
  nextDemoChirp: 0,
  noiseFloor: 0.018,
  score: 0,
  centroid: 0,
  peakCount: 0,
  sampleRate: 44100,
  fftSize: 4096,
  lastSpawn: 0,
  lastLabel: 0,
  nodes: [],
  sparks: [],
  labels: [],
  spectrumHistory: [],
};

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const lerp = (a, b, t) => a + (b - a) * t;
const random = (min, max) => min + Math.random() * (max - min);

function resizeCanvas() {
  state.dpr = Math.min(window.devicePixelRatio || 1, 2);
  state.width = window.innerWidth;
  state.height = window.innerHeight;
  canvas.width = Math.floor(state.width * state.dpr);
  canvas.height = Math.floor(state.height * state.dpr);
  canvas.style.width = `${state.width}px`;
  canvas.style.height = `${state.height}px`;
  ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  ctx.fillStyle = "#010309";
  ctx.fillRect(0, 0, state.width, state.height);
}

function setStatus(text, tone = "idle") {
  ui.statusText.textContent = text;
  ui.statusDot.classList.toggle("live", tone === "live");
  ui.statusDot.classList.toggle("detecting", tone === "detecting");
}

function getSensitivity() {
  return Number(ui.sensitivity.value) / 100;
}

function getFocusRange() {
  let low = Number(ui.lowFocus.value);
  let high = Number(ui.highFocus.value);
  if (high <= low + 900) {
    high = low + 900;
    ui.highFocus.value = String(high);
  }
  return { low, high };
}

async function startMicrophone() {
  stopDemo();

  if (state.stream) {
    stopMicrophone();
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("Microfono non disponibile", "idle");
    return;
  }

  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    state.audioContext = new AudioContext();
    state.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      video: false,
    });

    state.source = state.audioContext.createMediaStreamSource(state.stream);
    state.analyser = state.audioContext.createAnalyser();
    state.analyser.fftSize = state.fftSize;
    state.analyser.smoothingTimeConstant = 0.58;
    state.source.connect(state.analyser);

    state.freqData = new Uint8Array(state.analyser.frequencyBinCount);
    state.prevData = new Float32Array(state.analyser.frequencyBinCount);
    state.sampleRate = state.audioContext.sampleRate;
    ui.micButton.classList.add("active");
    ui.demoButton.classList.remove("active");
    ui.micButton.querySelector("span").textContent = "Stop";
    setStatus("Ascolto", "live");
  } catch (error) {
    console.warn("Microphone permission failed", error);
    setStatus("Permesso microfono negato", "idle");
    stopMicrophone();
  }
}

function stopMicrophone() {
  if (state.stream) {
    state.stream.getTracks().forEach((track) => track.stop());
  }
  if (state.audioContext) {
    state.audioContext.close();
  }
  state.audioContext = null;
  state.analyser = null;
  state.stream = null;
  state.source = null;
  state.freqData = null;
  state.prevData = null;
  ui.micButton.classList.remove("active");
  ui.micButton.querySelector("span").textContent = "Microfono";
  setStatus(state.demoMode ? "Demo" : "Pronto", state.demoMode ? "live" : "idle");
}

function toggleDemo() {
  if (state.demoMode) {
    stopDemo();
    return;
  }

  stopMicrophone();
  state.demoMode = true;
  state.nextDemoChirp = performance.now() + 180;
  ui.demoButton.classList.add("active");
  setStatus("Demo", "live");
}

function stopDemo() {
  state.demoMode = false;
  state.demoChirps.length = 0;
  ui.demoButton.classList.remove("active");
  if (!state.stream) setStatus("Pronto", "idle");
}

function clearGraph() {
  state.nodes.length = 0;
  state.sparks.length = 0;
  state.labels.length = 0;
  state.spectrumHistory.length = 0;
  ctx.fillStyle = "#010309";
  ctx.fillRect(0, 0, state.width, state.height);
}

function makeDemoSpectrum(now) {
  const data = state.demoData;
  data.fill(0);

  if (now > state.nextDemoChirp) {
    const burstCount = Math.random() > 0.56 ? 2 : 1;
    for (let i = 0; i < burstCount; i += 1) {
      state.demoChirps.push({
        start: now + i * random(80, 150),
        duration: random(180, 420),
        f0: random(2100, 6800),
        sweep: random(-1300, 2100),
        wobble: random(120, 540),
        amp: random(0.58, 1),
      });
    }
    state.nextDemoChirp = now + random(220, 760);
  }

  const binHz = state.sampleRate / state.fftSize;
  for (let i = 0; i < data.length; i += 1) {
    const freq = i * binHz;
    const rumble = freq < 900 ? random(0, 9) : random(0, 3);
    data[i] = rumble;
  }

  state.demoChirps = state.demoChirps.filter((chirp) => now - chirp.start < chirp.duration + 60);
  for (const chirp of state.demoChirps) {
    const age = now - chirp.start;
    if (age < 0 || age > chirp.duration) continue;

    const t = age / chirp.duration;
    const envelope = Math.sin(Math.PI * t);
    const freq = chirp.f0 + chirp.sweep * t + Math.sin(t * Math.PI * 7) * chirp.wobble;
    const center = Math.round(freq / binHz);
    const width = Math.round(random(5, 13));
    const strength = 255 * chirp.amp * envelope;

    for (let offset = -width; offset <= width; offset += 1) {
      const index = center + offset;
      if (index < 0 || index >= data.length) continue;
      const falloff = Math.exp(-(offset * offset) / (width * width * 0.55));
      data[index] = Math.max(data[index], Math.min(255, strength * falloff + random(0, 12)));
    }
  }

  return data;
}

function bandStats(data, binHz, fromHz, toHz) {
  const start = clamp(Math.floor(fromHz / binHz), 0, data.length - 1);
  const end = clamp(Math.ceil(toHz / binHz), start + 1, data.length);
  let sum = 0;
  let sumSquares = 0;
  let weighted = 0;
  let max = 0;
  let maxIndex = start;

  for (let i = start; i < end; i += 1) {
    const amp = data[i] / 255;
    sum += amp;
    sumSquares += amp * amp;
    weighted += amp * i * binHz;
    if (amp > max) {
      max = amp;
      maxIndex = i;
    }
  }

  const count = Math.max(1, end - start);
  return {
    start,
    end,
    avg: sum / count,
    rms: Math.sqrt(sumSquares / count),
    centroid: sum > 0 ? weighted / sum : 0,
    max,
    maxIndex,
  };
}

function spectralFlux(data, previous, start, end) {
  if (!previous) return 0;

  let flux = 0;
  let count = 0;
  for (let i = start; i < end; i += 1) {
    const amp = data[i] / 255;
    flux += Math.max(0, amp - previous[i]);
    previous[i] = amp;
    count += 1;
  }
  return count ? flux / count : 0;
}

function findPeaks(data, binHz, range, floor) {
  const peaks = [];
  const minDistance = Math.max(3, Math.round(180 / binHz));

  for (let i = range.start + 2; i < range.end - 2; i += 1) {
    const amp = data[i] / 255;
    if (amp < floor) continue;
    if (amp <= data[i - 1] / 255 || amp <= data[i + 1] / 255) continue;

    const freq = i * binHz;
    const existing = peaks.find((peak) => Math.abs(peak.index - i) < minDistance);
    if (existing) {
      if (amp > existing.amp) {
        existing.amp = amp;
        existing.freq = freq;
        existing.index = i;
      }
    } else {
      peaks.push({ amp, freq, index: i });
    }
  }

  return peaks.sort((a, b) => b.amp - a.amp).slice(0, 8);
}

function analyzeSpectrum(data, now) {
  if (!state.prevData || state.prevData.length !== data.length) {
    state.prevData = new Float32Array(data.length);
  }

  const { low, high } = getFocusRange();
  const binHz = state.sampleRate / state.fftSize;
  const nyquist = state.sampleRate / 2;
  const focusHigh = Math.min(high, nyquist - binHz);
  const lowBand = bandStats(data, binHz, 80, Math.min(1200, nyquist));
  const midBand = bandStats(data, binHz, 1200, Math.min(low, nyquist));
  const birdBand = bandStats(data, binHz, low, focusHigh);
  const flux = spectralFlux(data, state.prevData, birdBand.start, birdBand.end);
  const sensitivity = getSensitivity();
  const speechGuard = birdBand.rms / (lowBand.rms + midBand.rms * 0.7 + 0.018);
  const peakiness = birdBand.max / (birdBand.avg + 0.006);
  const idleWeight = state.score < 0.24 ? 0.024 : 0.004;

  state.noiseFloor = clamp(
    state.noiseFloor * (1 - idleWeight) + birdBand.rms * idleWeight,
    0.008,
    0.2,
  );

  const gate = lerp(0.095, 0.028, sensitivity);
  const rawScore =
    (birdBand.rms - state.noiseFloor - gate) * 6.8 +
    (speechGuard - lerp(1.26, 0.54, sensitivity)) * 0.28 +
    flux * 3.4 +
    (peakiness - lerp(1.85, 1.12, sensitivity)) * 0.08 +
    clamp((birdBand.centroid - low) / Math.max(1, focusHigh - low), 0, 1) * 0.12;

  const score = clamp(rawScore);
  state.score = state.score * 0.68 + score * 0.32;
  state.centroid = birdBand.centroid || 0;

  const peakFloor = Math.max(state.noiseFloor + lerp(0.16, 0.07, sensitivity), 0.08);
  const peaks = findPeaks(data, binHz, birdBand, peakFloor);
  state.peakCount = peaks.length;

  const detected =
    state.score > 0.28 &&
    speechGuard > lerp(1.18, 0.52, sensitivity) &&
    peakiness > lerp(1.72, 1.05, sensitivity) &&
    birdBand.max > peakFloor;

  if (detected && now - state.lastSpawn > lerp(90, 32, state.score)) {
    spawnGraph(peaks, birdBand, now);
    state.lastSpawn = now;
  }

  if (detected && now - state.lastLabel > 180 && peaks[0]) {
    spawnLabel(peaks[0], now);
    state.lastLabel = now;
  }

  updateReadout(detected);
}

function updateReadout(detected) {
  ui.birdScore.textContent = `${Math.round(state.score * 100)}%`;
  ui.centroid.textContent = `${(state.centroid / 1000 || 0).toFixed(1)} kHz`;
  ui.peakCount.textContent = String(state.peakCount);

  if (detected) {
    setStatus("Canto rilevato", "detecting");
  } else if (state.stream || state.demoMode) {
    setStatus(state.demoMode ? "Demo" : "Ascolto", "live");
  }
}

function colorForFreq(freq) {
  const { low, high } = getFocusRange();
  const t = clamp((freq - low) / Math.max(1, high - low));
  if (t < 0.33) return { r: 255, g: 59 + 120 * t, b: 215, css: "#ff3bd7" };
  if (t < 0.7) return { r: 43, g: 247, b: 255, css: "#2bf7ff" };
  return { r: 182, g: 255, b: 92, css: "#b6ff5c" };
}

function spawnGraph(peaks, band, now) {
  const chosen = peaks.length ? peaks : [{ freq: band.centroid, amp: band.max, index: band.maxIndex }];
  const { low, high } = getFocusRange();
  const scaleByViewport = Math.min(state.width, state.height) / 620;

  for (const peak of chosen.slice(0, 6)) {
    const f = clamp((peak.freq - low) / Math.max(1, high - low));
    const energy = clamp(peak.amp);
    const color = colorForFreq(peak.freq);
    const ribbon = Math.sin(now * 0.0018 + f * Math.PI * 4);

    state.nodes.push({
        x: (f - 0.5) * 2.65 + random(-0.06, 0.06),
        y: ribbon * 0.52 + random(-0.08, 0.08),
        z: random(-0.28, 0.28),
        // velocities set to zero to keep the graph static/centered
        vx: 0,
        vy: 0,
        vz: 0,
      freq: peak.freq,
      size: (2.5 + energy * 7.5) * scaleByViewport,
      color,
      energy,
      born: now,
      life: random(4200, 7600),
    });

    if (energy > 0.36) {
      state.sparks.push({
        x: (f - 0.5) * 2.65,
        y: ribbon * 0.5,
        z: random(-0.72, 0.72),
        radius: 0,
        color,
        born: now,
        life: random(520, 900),
      });
    }
  }

  if (state.nodes.length > 560) state.nodes.splice(0, state.nodes.length - 560);
}

function spawnLabel(peak, now) {
  const { low, high } = getFocusRange();
  const f = clamp((peak.freq - low) / Math.max(1, high - low));
  state.labels.push({
    x: (f - 0.5) * 2.6 + random(-0.16, 0.16),
    y: random(-0.85, 0.58),
    z: random(-0.85, 0.85),
    text: `${(peak.freq / 1000).toFixed(2)} kHz`,
    color: colorForFreq(peak.freq),
    born: now,
    life: 1250,
  });

  if (state.labels.length > 18) state.labels.shift();
}

function updateEntities(now, dt) {
  // Keep nodes fixed in place (no movement). Only remove expired nodes.
  // This preserves their initial positions so the graph stays centered.
  state.nodes = state.nodes.filter((node) => now - node.born < node.life);
  state.sparks = state.sparks.filter((spark) => now - spark.born < spark.life);
  state.labels = state.labels.filter((label) => now - label.born < label.life);
}

function project(point, now) {
  const compact = state.width < 720;
  const scale = Math.min(state.width, state.height) * (compact ? 0.31 : 0.39);
  // Fix center to true center of canvas and remove time-based rotation/tilt
  const centerX = state.width * 0.5;
  const centerY = state.height * 0.5;
  const turn = 0; // no rotation
  const tilt = 0; // no tilt
  const cosY = Math.cos(turn);
  const sinY = Math.sin(turn);
  const cosX = Math.cos(tilt);
  const sinX = Math.sin(tilt);

  let x = point.x * cosY - point.z * sinY;
  let z = point.x * sinY + point.z * cosY;
  let y = point.y * cosX - z * sinX;
  z = point.y * sinX + z * cosX;

  const perspective = clamp(1.65 / Math.max(0.42, 1.65 + z), 0.38, 2.8);
  return {
    x: centerX + x * scale * perspective,
    y: centerY + y * scale * perspective,
    p: perspective,
  };
}

function drawBackground(now) {
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "rgba(1, 3, 9, 0.2)";
  ctx.fillRect(0, 0, state.width, state.height);

  const cx = state.width * 0.5;
  const cy = state.height * 0.47;
  const pulse = 0.24 + state.score * 0.58 + Math.sin(now * 0.004) * 0.035;
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(state.width, state.height) * 0.58);
  gradient.addColorStop(0, `rgba(255, 59, 215, ${0.035 + pulse * 0.07})`);
  gradient.addColorStop(0.38, `rgba(43, 247, 255, ${0.022 + pulse * 0.045})`);
  gradient.addColorStop(1, "rgba(1, 3, 9, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, state.width, state.height);

  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.strokeStyle = "#8eefff";
  ctx.lineWidth = 1;
  const gap = Math.max(56, Math.min(96, state.width / 12));
  const drift = (now * 0.018) % gap;
  for (let x = -gap + drift; x < state.width + gap; x += gap) {
    ctx.beginPath();
    ctx.moveTo(x, state.height * 0.12);
    ctx.lineTo(x + state.width * 0.05, state.height * 0.9);
    ctx.stroke();
  }
  ctx.restore();
}

function drawSpectrum(data) {
  if (!data) return;

  const { low, high } = getFocusRange();
  const binHz = state.sampleRate / state.fftSize;
  const bars = 72;
  const row = [];

  for (let i = 0; i < bars; i += 1) {
    const from = low + ((high - low) * i) / bars;
    const to = low + ((high - low) * (i + 1)) / bars;
    const stats = bandStats(data, binHz, from, to);
    row.push(clamp(stats.rms * 2.4));
  }

  state.spectrumHistory.push(row);
  if (state.spectrumHistory.length > 90) state.spectrumHistory.shift();

  const width = Math.min(680, state.width - 36);
  const height = state.width < 720 ? 82 : 96;
  const left = (state.width - width) / 2;
  const top = state.height - height - (state.width < 720 ? 264 : 28);
  const cellW = width / bars;
  const cellH = height / Math.max(1, state.spectrumHistory.length);

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let y = 0; y < state.spectrumHistory.length; y += 1) {
    const age = y / state.spectrumHistory.length;
    const rowData = state.spectrumHistory[y];
    for (let x = 0; x < rowData.length; x += 1) {
      const value = rowData[x];
      if (value < 0.035) continue;
      const hue = x / rowData.length;
      const alpha = value * age * (0.14 + state.score * 0.34);
      ctx.fillStyle =
        hue < 0.35
          ? `rgba(255, 59, 215, ${alpha})`
          : hue < 0.72
            ? `rgba(43, 247, 255, ${alpha})`
            : `rgba(182, 255, 92, ${alpha})`;
      ctx.fillRect(left + x * cellW, top + y * cellH, Math.max(1, cellW - 1), Math.max(1, cellH));
    }
  }
  ctx.restore();
}

function drawEdges(now) {
  const nodes = state.nodes;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  // Group nodes by similar frequency so connections follow repeating freq patterns.
  // Choose a tolerance in Hz; smaller value = tighter grouping. We'll scale it
  // with the focus range so it behaves sensibly on different settings.
  const { low, high } = getFocusRange();
  const focusWidth = Math.max(1, high - low);
  const tolHz = Math.max(120, focusWidth * 0.06); // tolerance in Hz
  // Convert tolHz to normalized freq space (0..1) matching how node.freq is used
  const tolNorm = tolHz / Math.max(1, focusWidth);

  // Build groups: each group is an array of nodes with similar freq
  const groups = [];
  for (const node of nodes) {
    const fNorm = clamp((node.freq - low) / Math.max(1, high - low));
    let placed = false;
    for (const g of groups) {
      // compare to group's representative frequency (first node)
      const rep = clamp((g.repFreq - low) / Math.max(1, high - low));
      if (Math.abs(fNorm - rep) <= tolNorm) {
        g.nodes.push(node);
        placed = true;
        break;
      }
    }
    if (!placed) {
      groups.push({ repFreq: node.freq, nodes: [node] });
    }
  }

  // For each group, sort by birth time and draw sequential connections
  for (const g of groups) {
    if (g.nodes.length < 2) continue;
    g.nodes.sort((a, b) => a.born - b.born);
    for (let i = 0; i < g.nodes.length - 1; i += 1) {
      const a = g.nodes[i];
      const b = g.nodes[i + 1];
      const ageA = clamp(1 - (now - a.born) / a.life);
      const pa = project(a, now);
      const pb = project(b, now);
      const alpha = 0.46 * ageA * (0.35 + state.score);
      ctx.strokeStyle = `rgba(${a.color.r}, ${a.color.g}, ${a.color.b}, ${alpha})`;
      ctx.lineWidth = Math.max(0.6, 1.6 * a.energy * pa.p);
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }
  }

  ctx.restore();
}

function drawNodes(now) {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  for (const spark of state.sparks) {
    const age = clamp((now - spark.born) / spark.life);
    const p = project(spark, now);
    const radius = (20 + 72 * age) * p.p * (0.5 + state.score);
    ctx.strokeStyle = `rgba(${spark.color.r}, ${spark.color.g}, ${spark.color.b}, ${(1 - age) * 0.24})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  for (const node of state.nodes) {
    const age = clamp(1 - (now - node.born) / node.life);
    const p = project(node, now);
    const radius = node.size * p.p * (0.7 + state.score * 0.55);
    ctx.shadowColor = node.color.css;
    ctx.shadowBlur = 20 + 28 * node.energy;
    ctx.fillStyle = `rgba(${node.color.r}, ${node.color.g}, ${node.color.b}, ${0.23 + age * 0.66})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.fillStyle = `rgba(255, 255, 255, ${0.48 * age})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(1.2, radius * 0.32), 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawLabels(now) {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textBaseline = "middle";

  for (const label of state.labels) {
    const age = clamp((now - label.born) / label.life);
    const alpha = Math.sin(Math.PI * age);
    const p = project(label, now);
    const padX = 8;
    const textWidth = ctx.measureText(label.text).width;
    const width = textWidth + padX * 2;
    const height = 24;
    const x = p.x + 12;
    const y = p.y - height / 2;

    ctx.strokeStyle = `rgba(${label.color.r}, ${label.color.g}, ${label.color.b}, ${0.62 * alpha})`;
    ctx.fillStyle = `rgba(1, 3, 9, ${0.48 * alpha})`;
    ctx.lineWidth = 1;
    ctx.shadowColor = label.color.css;
    ctx.shadowBlur = 14;
    ctx.strokeRect(x, y, width, height);
    ctx.fillRect(x, y, width, height);
    ctx.shadowBlur = 0;
    ctx.fillStyle = `rgba(245, 251, 255, ${0.86 * alpha})`;
    ctx.fillText(label.text, x + padX, y + height / 2 + 0.5);
  }

  ctx.restore();
}

function drawPulse(now) {
  const center = project({ x: 0, y: 0, z: 0 }, now);
  const radius = Math.min(state.width, state.height) * (0.035 + state.score * 0.045);

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const gradient = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, radius * 3.1);
  gradient.addColorStop(0, `rgba(255, 255, 255, ${0.16 + state.score * 0.22})`);
  gradient.addColorStop(0.25, `rgba(255, 59, 215, ${0.12 + state.score * 0.2})`);
  gradient.addColorStop(0.68, `rgba(43, 247, 255, ${0.05 + state.score * 0.11})`);
  gradient.addColorStop(1, "rgba(1, 3, 9, 0)");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(center.x, center.y, radius * 3.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

let lastTime = performance.now();

function frame(now) {
  const dt = Math.min(48, now - lastTime);
  lastTime = now;

  let data = null;
  if (state.analyser && state.freqData) {
    state.analyser.getByteFrequencyData(state.freqData);
    data = state.freqData;
  } else if (state.demoMode) {
    data = makeDemoSpectrum(now);
  } else {
    state.score *= 0.965;
    state.peakCount = 0;
  }

  if (data) analyzeSpectrum(data, now);
  updateEntities(now, dt);

  drawBackground(now);
  drawSpectrum(data);
  drawPulse(now);
  drawEdges(now);
  drawNodes(now);
  drawLabels(now);

  requestAnimationFrame(frame);
}

ui.micButton.addEventListener("click", startMicrophone);
ui.demoButton.addEventListener("click", toggleDemo);
ui.clearButton.addEventListener("click", clearGraph);
window.addEventListener("resize", resizeCanvas);

resizeCanvas();
requestAnimationFrame(frame);
