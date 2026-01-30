# Panel Inspector - 분전함 검사 현황 관리 시스템

분전함 검사 현황을 관리하고 엑셀 파일로 내보내기/임포트할 수 있는 시스템입니다.

## 주요 기능

- 📊 **검사 현황 관리**: 분전함별 검사 상태, 부하 정보, 메모 관리
- 📸 **사진 관리**: 현장 사진 및 열화상 이미지 저장 (IndexedDB)
- 📱 **QR 코드**: QR 코드 생성 및 스캔 기능
- 📄 **엑셀 내보내기/임포트**: ExcelJS를 사용한 고급 엑셀 파일 처리
- 💾 **로컬 저장**: IndexedDB를 사용한 데이터 영구 저장
- 🖥️ **PC 설치형 앱**: Electron 기반 데스크톱 애플리케이션
- 📱 **모바일 PWA**: Progressive Web App으로 모바일 설치 가능

## 기술 스택

### 공통
- **React 19**: UI 프레임워크
- **TypeScript**: 타입 안전성
- **Vite**: 빌드 도구
- **Tailwind CSS**: 스타일링
- **IndexedDB (idb)**: 클라이언트 사이드 데이터베이스
- **ExcelJS**: 엑셀 파일 생성 및 이미지 삽입
- **XLSX**: 엑셀 파일 읽기

### PC (Electron)
- **Electron**: 데스크톱 애플리케이션 프레임워크
- **electron-builder**: 앱 빌드 및 패키징

### 모바일 (PWA)
- **Service Worker**: 오프라인 지원 및 캐싱
- **Web App Manifest**: 앱 설치 및 홈 화면 추가

## 설치 및 실행

### 사전 요구사항
- Node.js 18 이상
- npm 또는 yarn

### 1. 의존성 설치
```bash
npm install
```

### 2. 환경 변수 설정
`.env.local` 파일을 생성하고 다음 내용을 추가:
```
VITE_GEMINI_API_KEY=your_gemini_api_key_here
```

### 3. 개발 모드 실행

#### 웹 앱 (모바일/브라우저)
```bash
npm run dev
```
브라우저에서 `http://localhost:3000` 접속

#### PC 앱 (Electron)
**터미널 1**: Vite 개발 서버 실행
```bash
npm run dev
```

**터미널 2**: Electron 앱 실행
```bash
npm run electron:dev
```

## 빌드 및 배포

### 웹 앱 빌드
```bash
npm run build
```
빌드된 파일은 `dist/` 폴더에 생성됩니다.

### PC 앱 빌드

#### Windows
```bash
npm run electron:build:win
```
`release/` 폴더에 Windows 설치 파일(.exe)이 생성됩니다.

#### macOS
```bash
npm run electron:build:mac
```
`release/` 폴더에 macOS 설치 파일(.dmg)이 생성됩니다.

#### Linux
```bash
npm run electron:build:linux
```
`release/` 폴더에 Linux 설치 파일(.AppImage)이 생성됩니다.

## 데이터 관리

### 저장 위치
- **검사 데이터**: IndexedDB (`panel-inspector-db` 데이터베이스)
- **사진**: IndexedDB (`photos` object store)
- **엑셀 파일**: PC에서는 파일 시스템, 모바일에서는 다운로드 폴더

### 데이터 동기화
- Mobile ↔ PC 간 데이터 공유는 **엑셀 파일**을 통해 이루어집니다.
- 엑셀 파일을 내보내고 다른 기기에서 임포트하여 데이터를 공유할 수 있습니다.

### PNL NO 관리 정책
- **PNL NO당 1개 데이터만 유지**: 새로 저장하면 이전 데이터는 덮어쓰기됩니다.
- 이력 관리 기능은 없습니다.

### 사진 저장 정책
- 사진은 **IndexedDB에 저장**되며, 엑셀 내보내기 시 엑셀 파일에 포함됩니다.
- **내보내기 후에도 최신 사진은 유지**됩니다 (로컬에서 삭제되지 않음).

## 엑셀 포맷

### 지원 포맷 버전
- 현재 버전: **v1.0**

### 시트 구조
1. **Meta**: 포맷 버전 정보
2. **검사 현황 (Inspection Status)**: 분전함별 검사 데이터
3. **QR List**: QR 코드 목록
4. **Reports**: 리포트 이력
5. **Photos**: 사진 데이터 (Base64 이미지 포함)

### 포맷 검증
- 엑셀 임포트 시 포맷 버전을 확인합니다.
- 지원하지 않는 포맷 버전의 경우 경고 메시지가 표시됩니다.

## PWA 설치 (모바일)

1. 모바일 브라우저에서 앱 접속
2. 브라우저 메뉴에서 **"홈 화면에 추가"** 또는 **"앱 설치"** 선택
3. 설치 완료 후 홈 화면에서 앱 실행

### PWA 기능
- 오프라인 지원 (Service Worker 캐싱)
- 홈 화면 아이콘
- 전체 화면 모드
- 빠른 시작

## 문제 해결

### Electron 앱이 실행되지 않는 경우
1. Vite 개발 서버가 실행 중인지 확인 (`npm run dev`)
2. 포트 3000이 사용 가능한지 확인
3. `node_modules` 삭제 후 `npm install` 재실행

### IndexedDB 오류
- 브라우저 개발자 도구에서 IndexedDB 상태 확인
- 필요시 브라우저 캐시 및 IndexedDB 초기화

### 엑셀 파일이 열리지 않는 경우
- 포맷 버전 확인 (현재 지원: v1.0)
- 필수 시트 및 컬럼 존재 여부 확인

## 라이선스

Private - All rights reserved
