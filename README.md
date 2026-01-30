<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1jL-yRelTHS_VIzl-hSk_cxiNY2M06D-f

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Android 앱 빌드 (Capacitor)

모바일에 설치형 앱으로 실행하려면 Capacitor로 Android 프로젝트를 사용합니다.

**필요 환경:** Node.js, Android Studio, JDK 17

1. 웹 빌드 후 Android에 동기화:
   ```bash
   npm run cap:sync
   ```
2. Android Studio에서 열기:
   ```bash
   npm run cap:android
   ```
3. Android Studio에서 기기/에뮬레이터 선택 후 Run(▶)으로 실행.

**한 번에 빌드 후 Android 열기:**
```bash
npm run build:android
```

- 앱 ID: `com.panelinspector.app`
- QR 스캔을 위해 카메라 권한이 매니페스트에 포함되어 있습니다.
