import { InspectionRecord, QRCodeData } from '../types';

/** 공칭단면적 → 차단기 용량 임의 매핑 */
const SQ_TO_BREAKER: Record<string, string> = {
  '300': '600',
  '185': '400',
  '150': '350',
  '95': '225',
  '50': '125',
  '35': '100',
  '16': '50',
};

function panel(
  panelNo: string,
  tr: 'A' | 'B',
  floor: string,
  nominalCrossSection: string,
  notes?: string,
): InspectionRecord {
  return {
    panelNo,
    status: 'Pending',
    lastInspectionDate: '-',
    loads: { welder: false, grinder: false, light: false, pump: false },
    photoUrl: null,
    memo: '',
    tr,
    floor,
    nominalCrossSection,
    breakerCapacity: SQ_TO_BREAKER[nominalCrossSection] || '',
    contractor: '삼성물산',
    projectName: '성수동 K-PJT',
    managementNumber: '',
    notes: notes || '',
  };
}

/**
 * 가설 분전반 계통도 기반 초기 데이터 (65면)
 * - TR-1 (A) 900KVA: 32면
 * - TR-2 (B) 950KVA: 33면
 * 층수 배분: F6=2, F4=5, F3=4, F1=36, B1=15, B2=3 (총 65면)
 */
export const INITIAL_INSPECTIONS: InspectionRecord[] = [
  // ── TR-1 (A) 900KVA ──────────────────────────────
  // F1 (지상1층) - TR-1 계열
  panel('1',       'A', 'F1', '95'),
  panel('1-1',     'A', 'F1', '95'),
  panel('1-2',     'A', 'F1', '50'),
  panel('1-2-1',   'A', 'F1', '50'),
  panel('2',       'A', 'F1', '95'),
  panel('3',       'A', 'F1', '95'),
  panel('3-1',     'A', 'F1', '50'),
  panel('3-1-1',   'A', 'F1', '16'),
  panel('3-1(충전부)',   'A', 'F1', '95', '충전부'),
  panel('3-1(충전부-1)', 'A', 'F1', '50', '충전부'),
  panel('3-2',     'A', 'F1', '50', '양수기'),
  // PNL NO. 5 — 엑셀 점검표 데이터 하드코딩
  {
    panelNo: '5',
    status: 'Pending',
    lastInspectionDate: '-',
    loads: { welder: false, grinder: false, light: false, pump: false },
    photoUrl: null,
    memo: '',
    tr: 'A',
    floor: 'F1',
    nominalCrossSection: '95',
    breakerCapacity: '225',
    contractor: '물산',
    projectName: '성수 K',
    managementNumber: 'MP-5 산 054-5',
    notes: '',
    // 차단기 No.1 → 패널 수준 전류
    currentL1: 109,
    currentL2: 139,
    currentL3: 129,
    // 차단기 No.2~11 → breakers[]
    breakers: [
      { breakerNo: '2', category: '2차', breakerCapacity: 50, loadName: '서측 외곽 투광등 타이머#1', type: '2P', kind: 'ELB', currentL1: 0, currentL2: 0, currentL3: 0, loadCapacityR: 3500, loadCapacityS: 0, loadCapacityT: 0, loadCapacityN: 0 },
      { breakerNo: '3', category: '2차', breakerCapacity: 50, loadName: 'SPARE', type: '3P', kind: 'ELB', currentL1: 0, currentL2: 0, currentL3: 0, loadCapacityR: 0, loadCapacityS: 0, loadCapacityT: 0, loadCapacityN: 0 },
      { breakerNo: '4', category: '2차', breakerCapacity: 50, loadName: 'SPARE', type: '3P', kind: 'ELB', currentL1: 0, currentL2: 0, currentL3: 0, loadCapacityR: 0, loadCapacityS: 0, loadCapacityT: 0, loadCapacityN: 0 },
      { breakerNo: '5', category: '2차', breakerCapacity: 75, loadName: 'SPARE', type: '3P', kind: 'ELB', currentL1: 0, currentL2: 0, currentL3: 0, loadCapacityR: 0, loadCapacityS: 0, loadCapacityT: 0, loadCapacityN: 0 },
      { breakerNo: '6', category: '2차', breakerCapacity: 50, loadName: '서측 외곽 등로 전등 타이머#2', type: '2P', kind: 'ELB', currentL1: 0, currentL2: 0, currentL3: 0, loadCapacityR: 800, loadCapacityS: 0, loadCapacityT: 0, loadCapacityN: 0 },
      { breakerNo: '7', category: '2차', breakerCapacity: 50, loadName: 'CCTV 전원 타이머#3', type: '2P', kind: 'ELB', currentL1: 0, currentL2: 0, currentL3: 0, loadCapacityR: 0, loadCapacityS: 0, loadCapacityT: 100, loadCapacityN: 0 },
      { breakerNo: '8', category: '2차', breakerCapacity: 75, loadName: '서측면 외곽 등로 휴게실 난방기 1,2', type: '3P', kind: 'ELB', currentL1: 0, currentL2: 0, currentL3: 0, loadCapacityR: 8000, loadCapacityS: 8000, loadCapacityT: 8000, loadCapacityN: 0 },
      { breakerNo: '9', category: '2차', breakerCapacity: 100, loadName: 'SPARE', type: '3P', kind: 'ELB', currentL1: 0, currentL2: 0, currentL3: 0, loadCapacityR: 0, loadCapacityS: 0, loadCapacityT: 0, loadCapacityN: 0 },
      { breakerNo: '10', category: '2차', breakerCapacity: 100, loadName: '가설분전반#5-1 전원', type: '4P', kind: 'ELB', currentL1: 6, currentL2: 0.8, currentL3: 9.4, loadCapacityR: 3554.1, loadCapacityS: 473.88, loadCapacityT: 5568, loadCapacityN: 0 },
      { breakerNo: '11', category: '2차', breakerCapacity: 225, loadName: '가설분전반#5-2 전원', type: '4P', kind: 'ELB', currentL1: 94, currentL2: 53, currentL3: 52, loadCapacityR: 55680, loadCapacityS: 31394, loadCapacityT: 30802, loadCapacityN: 0 },
    ],
    loadSummary: {
      phaseLoadSumA: 70734,
      phaseLoadSumB: 40668,
      phaseLoadSumC: 44470,
      totalLoadSum: 155872.43,
      phaseLoadShareA: 45,
      phaseLoadShareB: 26,
      phaseLoadShareC: 29,
    },
  },
  panel('5-1',     'A', 'F1', '35'),
  panel('7',       'A', 'F1', '150', 'T/C1(L)'),
  panel('7-1',     'A', 'F1', '95'),
  panel('7-1-1',   'A', 'F1', '16'),
  panel('7-2',     'A', 'F1', '95'),
  panel('7-2-1',   'A', 'F1', '16'),
  panel('7-3',     'A', 'F1', '95'),
  panel('7-4',     'A', 'F1', '95'),
  panel('8',       'A', 'F1', '300', 'T/C4'),
  panel('9',       'A', 'F1', '300', 'T/C1'),
  panel('16',      'A', 'F1', '95'),

  // F3 (지상3층) - TR-1 계열
  panel('3-1-2',   'A', 'F3', '35'),
  panel('4',       'A', 'F3', '95'),
  panel('4-1',     'A', 'F3', '35'),
  panel('7-5',     'A', 'F3', '95'),

  // F4 (지상4층) - TR-1 계열
  panel('5-2',     'A', 'F4', '95'),
  panel('5-2-1',   'A', 'F4', '50', '전력량계'),
  panel('5-2-2',   'A', 'F4', '50', '전력량계'),
  panel('5-2-2-1', 'A', 'F4', '50'),
  panel('16-3',    'A', 'F4', '50'),

  // F6 (지상6층) - TR-1 계열
  panel('16-1',    'A', 'F6', '95'),
  panel('16-2',    'A', 'F6', '95'),

  // ── TR-2 (B) 950KVA ──────────────────────────────
  // F1 (지상1층) - TR-2 계열
  panel('6',       'B', 'F1', '300'),
  panel('6-1',     'B', 'F1', '150'),
  panel('6-1-1',   'B', 'F1', '95'),
  panel('6-1-2',   'B', 'F1', '95'),
  panel('6-1-2-1', 'B', 'F1', '150'),
  panel('6-1-3',   'B', 'F1', '95'),
  panel('6-1-3-1', 'B', 'F1', '95', '양수기'),
  panel('6-2',     'B', 'F1', '150'),
  panel('6-2-1',   'B', 'F1', '95'),
  panel('6-2-2',   'B', 'F1', '95'),
  panel('6-2-2-1', 'B', 'F1', '16', 'T/C4(L)'),
  panel('10',      'B', 'F1', '300', 'T/C2'),
  panel('14',      'B', 'F1', '300', 'T/C3'),

  // B1 (지하1층) - TR-2 계열
  panel('6-2-3',   'B', 'B1', '95'),
  panel('6-2-3-1', 'B', 'B1', '50'),
  panel('11',      'B', 'B1', '150', 'T/C2(L)'),
  panel('11-1',    'B', 'B1', '95'),
  panel('11-1-1',  'B', 'B1', '16'),
  panel('11-1-2',  'B', 'B1', '95'),
  panel('11-2',    'B', 'B1', '95'),
  panel('11-3',    'B', 'B1', '95'),
  panel('12',      'B', 'B1', '185', 'T/C3(L)'),
  panel('12-1',    'B', 'B1', '95'),
  panel('12-1-1',  'B', 'B1', '16'),
  panel('12-2',    'B', 'B1', '95'),
  panel('12-3',    'B', 'B1', '95'),
  panel('13',      'B', 'B1', '150'),
  panel('13-1',    'B', 'B1', '95'),

  // B2 (지하2층) - TR-2 계열
  panel('15',      'B', 'B2', '150'),
  panel('15-1',    'B', 'B2', '50'),
  panel('15-2',    'B', 'B2', '50'),
];

/** 초기 InspectionRecord에서 QRCodeData 생성 */
export function generateInitialQRCodes(inspections: InspectionRecord[]): QRCodeData[] {
  return inspections.map((ins, idx) => ({
    id: `qr-init-${ins.panelNo}-${idx}`,
    location: ins.tr || 'A',
    floor: ins.floor || 'F1',
    position: ins.managementNumber || '',
    qrData: JSON.stringify({
      id: ins.panelNo,
      location: ins.tr || 'A',
      floor: ins.floor || 'F1',
      position: { description: ins.managementNumber || '' },
      timestamp: new Date().toISOString(),
      contractor: ins.contractor,
      projectName: ins.projectName,
      nominalCrossSection: ins.nominalCrossSection,
      breakerCapacity: ins.breakerCapacity,
      managementNumber: ins.managementNumber,
    }),
    createdAt: new Date().toISOString(),
  }));
}
