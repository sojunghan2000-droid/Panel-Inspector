import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Service Worker 등록 및 업데이트 알림 (PWA)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        console.log('Service Worker 등록 성공:', registration.scope);

        // 업데이트 감지
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) return;

          newWorker.addEventListener('statechange', () => {
            // 새 버전이 설치되었고, 기존 버전이 활성화되어 있는 경우
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // 업데이트 알림 표시
              const updateBanner = document.createElement('div');
              updateBanner.id = 'sw-update-banner';
              updateBanner.innerHTML = `
                <div style="
                  position: fixed;
                  top: 0;
                  left: 0;
                  right: 0;
                  z-index: 9999;
                  background: linear-gradient(to right, #059669, #10b981);
                  color: white;
                  padding: 12px 16px;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  gap: 16px;
                  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                  font-family: 'Inter', sans-serif;
                ">
                  <span style="font-size: 14px;">새로운 버전이 있습니다!</span>
                  <button id="sw-update-btn" style="
                    background: white;
                    color: #059669;
                    border: none;
                    padding: 8px 16px;
                    border-radius: 6px;
                    font-weight: 600;
                    cursor: pointer;
                    font-size: 14px;
                  ">업데이트</button>
                  <button id="sw-dismiss-btn" style="
                    background: transparent;
                    color: white;
                    border: 1px solid white;
                    padding: 8px 16px;
                    border-radius: 6px;
                    cursor: pointer;
                    font-size: 14px;
                  ">나중에</button>
                </div>
              `;
              document.body.appendChild(updateBanner);

              // 업데이트 버튼 클릭
              document.getElementById('sw-update-btn')?.addEventListener('click', () => {
                newWorker.postMessage({ type: 'SKIP_WAITING' });
                window.location.reload();
              });

              // 닫기 버튼 클릭
              document.getElementById('sw-dismiss-btn')?.addEventListener('click', () => {
                updateBanner.remove();
              });
            }
          });
        });
      })
      .catch((error) => {
        console.error('Service Worker 등록 실패:', error);
      });

    // 컨트롤러 변경 시 페이지 새로고침
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  });
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(<App />);