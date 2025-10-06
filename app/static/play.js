// === VİMOVE WEB OYUN MOTORU (game.py ile bire bir mantık) ===
// GEREKSİNİM: play.html içinde önce şunu ekle:
// <script src="https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/vision_bundle.js"></script>

(() => {
  const $ = (q) => document.querySelector(q);
  const video = $("#cam");
  const canvas = $("#overlay");
  const ctx = canvas.getContext("2d");
  const btnStart = $("#btn-start");
  const btnStop = $("#btn-stop");
  const $status = $("#status") || { textContent: "" };
  const $score  = $("#score")  || { textContent: "" };
  const $exercise = $("#exercise") || { textContent: "" };
  const $calib = $("#calib") || { textContent: "" };

  // --- CONFIG (game.py ile bire bir) ---
  const FONT_COLOR = "#000000"; // game.py'de metinler siyah
  const CALIBRATION_FRAMES = 60;
  const SMOOTHING_WINDOW   = 5;
  const DEBOUNCE_FRAME     = 10;

  const OTURMA_ORANI = 0.75;
  const KALKMA_ORANI = 0.92;

  const DIZ_OTURMA_ACI = 110;
  const DIZ_KALKMA_ACI = 150;

  const egzersizler = [
    { ad: "Right Hand Open - Close", hedef: 10 },
    { ad: "Left Hand Open - Close",  hedef: 10 },
    { ad: "Mouth Open - Close",      hedef: 5  },
    { ad: "Right Eye Blink",         hedef: 5  },
    { ad: "Left Eye Blink",          hedef: 5  },
    { ad: "Right Leg Extension",     hedef: 8  },
    { ad: "Left Leg Extension",      hedef: 8  },
    { ad: "Right Arm Raise",         hedef: 5  },
    { ad: "Left Arm Raise",          hedef: 5  },
    { ad: "Sit Down, Stand Up",      hedef: 8  },
  ];

  // --- STATE ---
  let stream = null, running = false, rafId = null;
  let mevcut_index = 0;
  let tekrar_sayisi = 0;
  let frame_son_tekrar = DEBOUNCE_FRAME;

  // debounce bayrakları
  let parmak_acik_sag = false;
  let parmak_acik_sol = false;
  let agiz_acik       = false;
  let goz_kirpma_sag  = false;
  let goz_kirpma_sol  = false;
  let bacak_acik_sag  = false;
  let bacak_acik_sol  = false;
  let oturukalk       = false;
  let kol_kaldirma_sag = false;
  let kol_kaldirma_sol = false;

  // otur-kalk kalibrasyon
  let referans_yukseklik = null;
  let calib_count = 0;
  const son_yukseklikler = [];

  // --- Mediapipe Tasks (Pose + Face + Hands) ---
  // Model URL'leri (Google public bucket)
  const MP_WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm";
  const POSE_MODEL =
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task";
  const FACE_MODEL =
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
  const HAND_MODEL =
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/2/hand_landmarker.task";

  let vision = null;
  let poseLandmarker = null;
  let faceLandmarker = null;
  let handLandmarker = null;

  async function loadModels() {
    const { FilesetResolver, PoseLandmarker, FaceLandmarker, HandLandmarker } = window;
    vision = await FilesetResolver.forVisionTasks(MP_WASM_BASE);

    poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: POSE_MODEL },
      runningMode: "VIDEO",
      numPoses: 1,
      outputSegmentationMasks: false,
    });

    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: FACE_MODEL },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
    });

    handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: HAND_MODEL },
      runningMode: "VIDEO",
      numHands: 2,
    });
  }

  async function openCamera() {
    if (stream) return;
    stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    video.srcObject = stream;
    await video.play();
  }

  // --- Yardımcılar (game.py eşdeğerleri) ---
  function mesafe(a, b) {
    // a,b: {x,y} normalized (0..1)
    const dx = a.x - b.x, dy = a.y - b.y;
    return Math.hypot(dx, dy);
  }

  function aci_hesapla(a, b, c) {
    // a,b,c: {x,y} normalized, b tepe
    const ba = [a.x - b.x, a.y - b.y];
    const bc = [c.x - b.x, c.y - b.y];
    const nba = Math.hypot(ba[0], ba[1]);
    const nbc = Math.hypot(bc[0], bc[1]);
    const denom = nba * nbc;
    if (denom === 0) return 180.0;
    let cosang = (ba[0] * bc[0] + ba[1] * bc[1]) / denom;
    cosang = Math.max(-1, Math.min(1, cosang));
    return Math.acos(cosang) * 180 / Math.PI;
  }

  function agiz_acma_kapama(lm) {
    // Face mesh indexleri: 13 (upper inner lip), 14 (lower inner lip)
    const ust = lm[13], alt = lm[14];
    const d = Math.hypot(ust.x - alt.x, ust.y - alt.y);
    return d > 0.03;
  }

  function goz_kirpma(lm, sag = true) {
    // Python kodundaki aynı indexler:
    // sağ göz: 159 (üst), 145 (alt)
    // sol  göz: 386 (üst), 374 (alt)
    const pair = sag ? [159, 145] : [386, 374];
    const a = lm[pair[0]], b = lm[pair[1]];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    return d < 0.015;
  }

  function bacak_acma(landmarks, sag = true) {
    // pose 33 nokta: sağ hip 24, sağ ayak bileği 28 / sol hip 23, sol ayak bileği 27
    const hip   = landmarks[sag ? 24 : 23];
    const ankle = landmarks[sag ? 28 : 27];
    const yan = Math.abs((ankle.x ?? 0) - (hip.x ?? 0));
    return yan > 0.15;
  }

  function kol_kaldirma(landmarks, sag = true) {
    // sağ omuz 12, sağ elbileği 16 / sol omuz 11, sol elbileği 15
    const omuz = landmarks[sag ? 12 : 11];
    const el   = landmarks[sag ? 16 : 15];
    return el.y < (omuz.y - 0.1);
  }

  function oturup_kalkma(landmarks) {
    // game.py ile bire bir
    // bas = 0 (nose), ayaklar: 27,28 -> ortalama y
    try {
      const bas = landmarks[0];
      const ayak_sag = landmarks[28];
      const ayak_sol = landmarks[27];
      const ayak_ort_y = (ayak_sag.y + ayak_sol.y) / 2.0;
      const yukseklik = Math.abs(bas.y - ayak_ort_y);

      // smoothing
      son_yukseklikler.push(yukseklik);
      if (son_yukseklikler.length > SMOOTHING_WINDOW) son_yukseklikler.shift();
      const ort = son_yukseklikler.reduce((a,b)=>a+b,0)/son_yukseklikler.length;

      // kalibrasyon
      if (referans_yukseklik === null && calib_count < CALIBRATION_FRAMES) {
        calib_count += 1;
        if (calib_count === CALIBRATION_FRAMES) {
          // medyan
          const sorted = [...son_yukseklikler].sort((a,b)=>a-b);
          const mid = Math.floor(sorted.length/2);
          referans_yukseklik = sorted.length ? (sorted.length%2? sorted[mid] : 0.5*(sorted[mid-1]+sorted[mid])) : yukseklik;
          if (referans_yukseklik < 0.2) referans_yukseklik = Math.max(referans_yukseklik, 0.25);
        }
        return false;
      }
      if (referans_yukseklik === null) return false;

      const oturma_esigi = referans_yukseklik * OTURMA_ORANI;
      const kalkma_esigi = referans_yukseklik * KALKMA_ORANI;

      // diz açıları
      const hip_r=landmarks[24], knee_r=landmarks[26], ankle_r=landmarks[28];
      const hip_l=landmarks[23], knee_l=landmarks[25], ankle_l=landmarks[27];
      const aci_r = aci_hesapla(hip_r, knee_r, ankle_r);
      const aci_l = aci_hesapla(hip_l, knee_l, ankle_l);
      const diz_min = Math.min(aci_r, aci_l);

      if (!oturukalk && (ort < oturma_esigi || diz_min < DIZ_OTURMA_ACI)) {
        oturukalk = true;
      } else if (oturukalk && (ort > kalkma_esigi && diz_min > DIZ_KALKMA_ACI)) {
        oturukalk = false;
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  // --- Egzersiz mantığı (bire bir) ---
  function hareket_tespit_et(resultsHands, resultsFace, resultsPose) {
    const ad = egzersizler[mevcut_index].ad;

    if (/Right Hand|Left Hand/.test(ad)) {
      // HandLandmarker: landmarks + handedness
      if (resultsHands?.landmarks?.length && resultsHands?.handedness?.length) {
        for (let i=0;i<resultsHands.landmarks.length;i++) {
          const lm = resultsHands.landmarks[i];
          const handLabel = resultsHands.handedness[i][0].categoryName; // "Left" / "Right"
          // parmak ucu (8) - bilek (0) arası mesafe
          const m = mesafe(lm[8], lm[0]);
          const acik = m > 0.25;
          const kapali = m < 0.15;

          if (ad.includes("Left Hand") && handLabel === "Right") {
            if (!parmak_acik_sag && acik) parmak_acik_sag = true;
            else if (parmak_acik_sag && !acik && kapali) { parmak_acik_sag = false; return true; }

          } else if (ad.includes("Right Hand") && handLabel === "Left") {
            if (!parmak_acik_sol && acik) parmak_acik_sol = true;
            else if (parmak_acik_sol && !acik && kapali) { parmak_acik_sol = false; return true; }
          }
        }
      }
    }
    else if (ad === "Mouth Open - Close") {
      const lm = resultsFace?.faceLandmarks?.[0];
      if (lm) {
        const durum = agiz_acma_kapama(lm);
        if (!agiz_acik && durum) agiz_acik = true;
        else if (agiz_acik && !durum) { agiz_acik = false; return true; }
      }
    }
    else if (ad === "Right Eye Blink") {
      const lm = resultsFace?.faceLandmarks?.[0];
      if (lm) {
        const k = goz_kirpma(lm, true);
        if (!goz_kirpma_sag && k) goz_kirpma_sag = true;
        else if (goz_kirpma_sag && !k) { goz_kirpma_sag = false; return true; }
      }
    }
    else if (ad === "Left Eye Blink") {
      const lm = resultsFace?.faceLandmarks?.[0];
      if (lm) {
        const k = goz_kirpma(lm, false);
        if (!goz_kirpma_sol && k) goz_kirpma_sol = true;
        else if (goz_kirpma_sol && !k) { goz_kirpma_sol = false; return true; }
      }
    }
    else if (ad === "Right Leg Extension") {
      const lmp = resultsPose?.landmarks?.[0];
      if (lmp) {
        const b = bacak_acma(lmp, true);
        if (!bacak_acik_sag && b) bacak_acik_sag = true;
        else if (bacak_acik_sag && !b) { bacak_acik_sag = false; return true; }
      }
    }
    else if (ad === "Left Leg Extension") {
      const lmp = resultsPose?.landmarks?.[0];
      if (lmp) {
        const b = bacak_acma(lmp, false);
        if (!bacak_acik_sol && b) bacak_acik_sol = true;
        else if (bacak_acik_sol && !b) { bacak_acik_sol = false; return true; }
      }
    }
    else if (ad === "Right Arm Raise") {
      const lmp = resultsPose?.landmarks?.[0];
      if (lmp) {
        const k = kol_kaldirma(lmp, true);
        if (!kol_kaldirma_sag && k) kol_kaldirma_sag = true;
        else if (kol_kaldirma_sag && !k) { kol_kaldirma_sag = false; return true; }
      }
    }
    else if (ad === "Left Arm Raise") {
      const lmp = resultsPose?.landmarks?.[0];
      if (lmp) {
        const k = kol_kaldirma(lmp, false);
        if (!kol_kaldirma_sol && k) kol_kaldirma_sol = true;
        else if (kol_kaldirma_sol && !k) { kol_kaldirma_sol = false; return true; }
      }
    }
    else if (ad === "Sit Down, Stand Up") {
      const lmp = resultsPose?.landmarks?.[0];
      if (lmp) {
        if (oturup_kalkma(lmp)) return true;
      }
    }

    return false;
  }

  // --- Çizim yardımcıları (metinler) ---
  function drawHUD() {
    ctx.fillStyle = FONT_COLOR;
    ctx.font = "20px system-ui, Arial";
    const egz = egzersizler[mevcut_index];
    const kalib = (referans_yukseklik === null)
      ? `Calibrate: ${calib_count}/${CALIBRATION_FRAMES}`
      : `Referans: ${referans_yukseklik.toFixed(3)}`;
    ctx.fillText(`Exercise: ${egz.ad}`, 10, 24);
    ctx.fillText(`Set: ${tekrar_sayisi}/${egz.hedef ?? "Time"}`, 10, 50);
    ctx.fillText(kalib, 10, 76);
    if ($exercise) $exercise.textContent = egz.ad;
    if ($calib) $calib.textContent = kalib;
  }

  // --- Oyun döngüsü ---
  async function loop() {
    if (!running) return;

    // video → canvas
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const now = performance.now();

    // Pose
    let poseRes = null;
    if (poseLandmarker) {
      poseRes = await poseLandmarker.detectForVideo(video, now);
      // normalize: tasks-vision already gives normalized 0..1
    }

    // Face
    let faceRes = null;
    if (faceLandmarker) {
      faceRes = await faceLandmarker.detectForVideo(video, now);
    }

    // Hands
    let handsRes = null;
    if (handLandmarker) {
      handsRes = await handLandmarker.detectForVideo(video, now);
    }

    const hareket_basarili = hareket_tespit_et(
      handsRes,
      faceRes,
      poseRes
    );

    if (frame_son_tekrar < DEBOUNCE_FRAME) {
      frame_son_tekrar += 1;
    }

    if (hareket_basarili && frame_son_tekrar >= DEBOUNCE_FRAME) {
      tekrar_sayisi += 1;
      frame_son_tekrar = 0;
      const hedef = egzersizler[mevcut_index].hedef;
      if (hedef && tekrar_sayisi >= hedef) {
        tekrar_sayisi = 0;
        mevcut_index += 1;
        if (mevcut_index >= egzersizler.length) {
          // tüm egzersizler tamamlandı → başa sar
          mevcut_index = 0;
        }
      }
      $score.textContent = String(tekrar_sayisi);
    }

    drawHUD();

    rafId = requestAnimationFrame(loop);
  }

  // --- UI events ---
  btnStart?.addEventListener("click", async () => {
    try {
      btnStart.disabled = true;
      $status.textContent = "Kamera açılıyor...";
      await openCamera();
      $status.textContent = "Modeller yükleniyor...";
      await loadModels();
      $status.textContent = "Çalışıyor";
      running = true;
      tekrar_sayisi = 0;
      frame_son_tekrar = DEBOUNCE_FRAME;
      $score.textContent = "0";
      loop();
    } catch (e) {
      console.error(e);
      $status.textContent = "Hata: " + e;
      btnStart.disabled = false;
    }
  });

  btnStop?.addEventListener("click", () => {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    $status.textContent = "Durdu";
    btnStart.disabled = false;
  });

  window.addEventListener("beforeunload", () => {
    if (stream) stream.getTracks().forEach((t) => t.stop());
  });
})();
