// Service Worker for Panel Inspector PWA
const CACHE_NAME = 'panel-inspector-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/index.css',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

// 설치 이벤트: 캐시 생성 및 리소스 캐싱
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('캐시 열기 완료');
        return cache.addAll(urlsToCache);
      })
      .catch((error) => {
        console.error('캐시 설치 오류:', error);
      })
  );
  self.skipWaiting(); // 즉시 활성화
});

// 활성화 이벤트: 오래된 캐시 정리
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('오래된 캐시 삭제:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  return self.clients.claim(); // 즉시 제어권 획득
});

// fetch 이벤트: 네트워크 우선, 캐시 폴백 전략
self.addEventListener('fetch', (event) => {
  // 엑셀 파일이나 외부 리소스는 네트워크만 사용
  if (event.request.url.includes('.xlsx') || 
      event.request.url.includes('.xls') ||
      event.request.url.startsWith('http://') ||
      event.request.url.startsWith('https://')) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // 네트워크 요청 성공 시 캐시에 저장
        if (response && response.status === 200) {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => {
        // 네트워크 실패 시 캐시에서 반환
        return caches.match(event.request);
      })
  );
});

// 백그라운드 동기화 (선택사항)
self.addEventListener('sync', (event) => {
  if (event.tag === 'background-sync') {
    event.waitUntil(
      // IndexedDB 데이터 동기화 로직 (필요시 구현)
      Promise.resolve()
    );
  }
});

// 푸시 알림 (선택사항)
self.addEventListener('push', (event) => {
  const options = {
    body: event.data ? event.data.text() : '새 알림이 있습니다.',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [200, 100, 200],
    tag: 'panel-inspector-notification',
  };

  event.waitUntil(
    self.registration.showNotification('Panel Inspector', options)
  );
});

// 알림 클릭 이벤트
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow('/')
  );
});
