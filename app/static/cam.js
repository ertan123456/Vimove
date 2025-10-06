const $ = (q) => document.querySelector(q);
const video = $("#cam");
const canvas = $("#frame");
const startBtn = $("#start");
const stopBtn  = $("#stop");
const statusEl = $("#status");

let stream = null;

function setStatus(msg) { statusEl.textContent = msg || ""; }

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("Tarayıcı kamera API'sını desteklemiyor.");
    return;
  }
  try {
    setStatus("Kamera izni isteniyor...");
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
    video.srcObject = stream;
    await video.play();
    setStatus("Kamera açık.");
    // TODO: Burada oyun döngünü başlat (requestAnimationFrame ile frame oku)
    // tick();
  } catch (err) {
    console.error(err);
    setStatus("Kamera açılamadı: " + (err?.message || err));
  }
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }
  video.srcObject = null;
  setStatus("Kamera kapandı.");
}

startBtn.addEventListener("click", startCamera);
stopBtn.addEventListener("click", stopCamera);

// function tick() {
//   if (!stream) return;
//   const w = video.videoWidth, h = video.videoHeight;
//   if (w && h) {
//     canvas.width = w; canvas.height = h;
//     const ctx = canvas.getContext("2d");
//     ctx.drawImage(video, 0, 0, w, h);
//     // burada pose/oyun hesaplarını yap veya WS ile sunucuya gönder
//   }
//   requestAnimationFrame(tick);
// }
