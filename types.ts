export interface Loads {
  welder: boolean;
  grinder: boolean;
  light: boolean;
  pump: boolean;
}

export interface BreakerInfo {
  breakerNo: string; // 차단기 No.
  category: '1차' | '2차'; // 구분
  breakerCapacity: number | null; // 차단기 용량[A]
  loadName: string; // 부하명 (고정부하, 이동부하X)
  type: string; // 형식
  kind: 'MCCB' | 'ELB'; // 종류
  currentL1: number | null; // 전류 (A) L1
  currentL2: number | null; // 전류 (A) L2
  currentL3: number | null; // 전류 (A) L3
  loadCapacityR: number | null; // 부하 용량[W] R
  loadCapacityS: number | null; // 부하 용량[W] S
  loadCapacityT: number | null; // 부하 용량[W] T
  loadCapacityN: number | null; // 부하 용량[W] N
}

export interface ThermalImageData {
  imageUrl: string | null; // 열화상 이미지 URL
  temperature: number | null; // 온도 측정값
  maxTemp: number | null; // 최대 온도
  minTemp: number | null; // 최소 온도
  emissivity: number | null; // 방사율
  measurementTime: string; // 측정 시간
  equipment: string; // 측정기 (예: KT-352)
}

export interface LoadSummary {
  phaseLoadSumA: number | null; // 상별 부하 합계 [AV] A
  phaseLoadSumB: number | null; // 상별 부하 합계 [AV] B
  phaseLoadSumC: number | null; // 상별 부하 합계 [AV] C
  totalLoadSum: number | null; // 총 연결 부하 합계[AV]
  phaseLoadShareA: number | null; // 상별 부하 분담 [%] A
  phaseLoadShareB: number | null; // 상별 부하 분담 [%] B
  phaseLoadShareC: number | null; // 상별 부하 분담 [%] C
}

export interface InspectionRecord {
  panelNo: string; // PNL NO. (유일 식별자)
  status: 'Complete' | 'In Progress' | 'Pending';
  lastInspectionDate: string;
  loads: Loads;
  photoUrl: string | null;
  memo: string;
  position?: {
    x: number; // percentage (0-100)
    y: number; // percentage (0-100)
  };
  // 사진의 엑셀 보고서 구조 반영
  inspectors?: string[]; // 점검자 (예: ["이재두 프로", "김윤수 프로", "이승환 프로"])
  projectName?: string; // PJT명
  contractor?: string; // 시공사
  managementNumber?: string; // 관리번호 (판넬명)
  breakers?: BreakerInfo[]; // 차단기 정보 배열
  currentL1?: number | null; // 전류 (A) - 후크메가 L1
  currentL2?: number | null; // 전류 (A) - 후크메가 L2
  currentL3?: number | null; // 전류 (A) - 후크메가 L3
  tr?: string; // TR: 'A' (TR-1 900KVA) 또는 'B' (TR-2 950KVA)
  floor?: string; // 명시적 층수: 'F1'~'F6', 'B1', 'B2'
  nominalCrossSection?: string; // 공칭 단면적 (예: '95SQ', '300SQ')
  breakerCapacity?: string; // 차단기 용량 [A] (Panel Master 연계)
  parentPanelNo?: string; // 상위 패널 번호
  notes?: string; // 비고 (T/C1(L), 양수기, 전력량계 등)
  grounding?: '양호' | '불량' | '미점검'; // 접지 (외관 점검)
  thermalImage?: ThermalImageData; // 열화상 측정 데이터
  loadSummary?: LoadSummary; // 부하 합계 정보
  updatedAt?: string; // ISO 8601 - Supabase 동기화용 타임스탬프
  acceptanceRate?: number; // 수용율 (%), 기본값 100
}

export type InspectionStatus = InspectionRecord['status'];

export interface StatData {
  name: string;
  value: number;
  color: string;
}

export interface ReportHistory {
  id: string;
  reportId: string;
  boardId: string;
  generatedAt: string;
  status: InspectionRecord['status'];
  htmlContent: string;
  isGenerated?: boolean; // true = Generate 버튼으로 생성됨, false = Save 시 자동 저장
  htmlUrl?: string; // Storage URL (HTML 파일이 reports 버킷에 저장된 경우)
  htmlSizeBytes?: number; // 저장된 HTML 파일 크기 (바이트)
  migratedToStorage?: boolean; // Storage 마이그레이션 완료 여부
  inspectionGroupId?: string; // 소속 점검 그룹 ID (예: "3월 검사")
}

export interface InspectionHistoryEntry {
  id: string;             // 고유 ID (timestamp 기반)
  groupId: string;        // 사용자 정의 그룹명 (예: "3월 검사")
  createdAt: string;      // 초기화 시점 ISO string
  locked?: boolean;       // 잠금 여부 (잠금 시 업데이트/이름수정/삭제 불가)
  stats: {
    total: number;
    complete: number;
    inProgress: number;
    pending: number;
    completionRate: number;   // 완료율 (%) = complete / total * 100
    groundFaultCount: number; // 접지 불량 건수 (grounding === '불량')
  };
}

export interface QRCodeData {
  id: string;
  location: string;
  floor: string;
  position: string;
  qrData: string; // JSON string
  createdAt: string;
}

// @MX:NOTE: 동기화 메타데이터 추적 (Phase 1)
export interface SyncMetadata {
  id: string; // 고유ID: "sync-metadata"
  storeType: 'inspections' | 'photos' | 'qrCodes' | 'floorPlanImages' | 'reports' | 'inspectionHistory';
  lastSyncTime: string; // ISO 8601 형식
  recordCount: number; // 마지막 동기화 시점의 레코드 수
  syncStatus: 'idle' | 'syncing' | 'success' | 'error';
  lastError?: string; // 에러 발생 시 메시지
  partialSyncIds?: string[]; // 부분동기 시 처리된 ID 목록
  createdAt: string;
  updatedAt: string;
}

// @MX:NOTE: 캐시 설정 (Phase 2)
export interface CacheConfig {
  storeType: keyof Omit<InspectionsDB, 'migration'>;
  ttlMinutes: number; // 캐시 유효시간 (분)
  enabled: boolean; // 캐시 활성화 여부
  developmentModeTTLSeconds?: number; // 개발모드 TTL (초)
}

// @MX:NOTE: 자동 동기화 설정 (Phase 3)
export interface AutoSyncConfig {
  enabled: boolean; // 자동 동기화 활성화
  intervalMinutes: number; // 동기화 주기 (5, 15, 30분 또는 0=비활성화)
  respectIdleState: boolean; // 유휴 상태 존중 (default: true)
  idleThresholdMinutes: number; // 유휴 상태 판정 시간 (default: 3분)
  respectTabVisibility: boolean; // 탭 가시성 확인 (default: true)
  respectBatteryStatus: boolean; // 배터리 상태 확인 (default: true)
  batteryLevelThreshold: number; // 자동 동기화 최소 배터리 (%) (default: 20)
  lastAutoSyncTime?: string; // 마지막 자동 동기화 시간
  nextAutoSyncTime?: string; // 다음 자동 동기화 예정 시간
}

// @MX:NOTE: IndexedDB v6 호환성을 위한 타입 확장
export interface InspectionsDB {
  inspections: InspectionRecord;
  photos: any;
  qrCodes: QRCodeData;
  floorPlanImages: any;
  reports: ReportHistory;
  inspectionHistory: InspectionHistoryEntry;
  syncMetadata?: SyncMetadata; // v7에서 추가됨
  migration?: any;
}