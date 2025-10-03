# Elderly Exercise Web Launcher (FastAPI)

Bu paket, **oyununuzun kodunu değiştirmeden** bir web sayfasından seçim yapıp oyunu başlatmanızı sağlar.

## Kurulum (Windows)

1) ZIP'i bir klasöre çıkarın.
2) `run.bat` dosyasına çift tıklayın.
3) Tarayıcıda `http://127.0.0.1:8000` açılacaktır.
4) Yaş / Cinsiyet / Hastalık (yalnızca **Parkinson**) seçin ve **Başlat** deyin.
5) OpenCV penceresi açılır. Çıkmak için OpenCV penceresinde `q`'ya basın.
6) Web sayfasından **Durdur** derseniz çalışan süreç sonlandırılır.

> Notlar:
> - Oyun penceresi **yerel kamera** kullanır. Bu nedenle **uzak sunucuda** çalıştırmayın.
> - `C:\Windows\Fonts\arial.ttf` mevcut değilse, `game.py` içindeki `FONT_PATH` değerini sisteminizde var olan bir TTF ile değiştirin.
> - Antivirüs / Kamera izinleri oyun penceresini engelleyebilir; izin verin.
> - Ekran beyaz kalıyorsa, konsolda hata var mı diye `run.bat` penceresine bakın.

## Kurulum (macOS / Linux)

```bash
chmod +x run.sh
./run.sh
# Sonra tarayıcı: http://127.0.0.1:8000
```

## Yapı

```
elderly_exercise_site/
├─ app/
│  ├─ main.py            # FastAPI (web form + oyunu başlat/durdur)
│  ├─ templates/
│  │  ├─ index.html
│  │  ├─ started.html
│  │  └─ stopped.html
│  └─ static/
│     └─ styles.css
├─ game.py               # Sizin orijinal oyununuz (hiç değiştirilmedi)
├─ requirements.txt
├─ run.bat               # Windows için tek tıkla çalışma
└─ run.sh                # macOS/Linux
```

## Sorun Giderme

- **Beyaz sayfa / API çalışıyor ama oyun açılmıyor:** 
  - `run.bat` konsolunda hata var mı bakın.
  - `opencv-python`, `mediapipe` kurulumlarının başarıyla tamamlandığını doğrulayın.
  - Harici kamera yazılımı kamerayı kilitlemiş olabilir; kapatın.

- **`arial.ttf` bulunamadı**: 
  - `game.py` içindeki `FONT_PATH`'i, sistemde var olan bir `.ttf` dosya yoluna ayarlayın.

- **Kamera açılmıyor**: 
  - Laptop kamerası devre dışı olabilir. `cap = cv2.VideoCapture(0)` satırındaki `0` yerine `1` veya `2` deneyin.

- **Uygulamayı durdurmak**: 
  - Web arayüzünde **Durdur** butonu var. Alternatif olarak OpenCV penceresinde `q`.

İyi çalışmalar!
