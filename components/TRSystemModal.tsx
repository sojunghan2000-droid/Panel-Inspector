import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Trash2, ChevronDown, ChevronRight, GitBranch, Zap, Save, RotateCcw } from 'lucide-react';
import { InspectionRecord, getTrLetter } from '../types';

/* ─── 타입 ─── */
interface PanelNode {
  panelNo: string;
  notes: string;        // 비고
  nominalCrossSection: string; // 공칭 단면적 (숫자만, SQ 제외)
  tr: string;           // 'A' | 'B'
  floor: string;
  parentPanelNo?: string;
}

interface TreeNode {
  panel: PanelNode;
  children: TreeNode[];
  depth: number;
  isLast: boolean;
  parentIsLast: boolean[];
}

interface TRGroup {
  trKey: string;        // 'A' | 'B'
  trLabel: string;      // 'TR-1 (A) 900KVA'
  panels: PanelNode[];
  collapsed: boolean;
}

interface TRSystemModalProps {
  isOpen: boolean;
  onClose: () => void;
  inspections: InspectionRecord[];
  onApply: (panels: InspectionRecord[]) => void;
}

/* ─── TR 표시 라벨 ─── */
const TR_LABELS: Record<string, string> = {
  'A': 'TR-1 (A) 900KVA',
  'B': 'TR-2 (B) 950KVA',
};

/* ─── Natural sort ─── */
function naturalSort(a: string, b: string): number {
  const pa = a.split(/(\d+)/);
  const pb = b.split(/(\d+)/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const sa = pa[i] || '';
    const sb = pb[i] || '';
    const na = parseInt(sa, 10);
    const nb = parseInt(sb, 10);
    if (!isNaN(na) && !isNaN(nb)) {
      if (na !== nb) return na - nb;
    } else {
      if (sa !== sb) return sa.localeCompare(sb);
    }
  }
  return 0;
}

/* ─── 트리 빌드 ─── */
function buildTree(panels: PanelNode[]): TreeNode[] {
  const roots = panels.filter(p => !p.parentPanelNo);
  const childrenMap = new Map<string, PanelNode[]>();

  panels.forEach(p => {
    if (p.parentPanelNo) {
      const siblings = childrenMap.get(p.parentPanelNo) || [];
      siblings.push(p);
      childrenMap.set(p.parentPanelNo, siblings);
    }
  });

  function buildNode(panel: PanelNode, depth: number, isLast: boolean, parentIsLast: boolean[]): TreeNode {
    const children = (childrenMap.get(panel.panelNo) || [])
      .sort((a, b) => naturalSort(a.panelNo, b.panelNo));
    return {
      panel,
      depth,
      isLast,
      parentIsLast,
      children: children.map((child, idx) =>
        buildNode(child, depth + 1, idx === children.length - 1, [...parentIsLast, isLast])
      ),
    };
  }

  return roots
    .sort((a, b) => naturalSort(a.panelNo, b.panelNo))
    .map((root, idx, arr) => buildNode(root, 0, idx === arr.length - 1, []));
}

function flattenTree(nodes: TreeNode[]): TreeNode[] {
  const result: TreeNode[] = [];
  function walk(node: TreeNode) {
    result.push(node);
    node.children.forEach(walk);
  }
  nodes.forEach(walk);
  return result;
}

/* ─── 트리 커넥터 ─── */
const TreeConnector: React.FC<{ node: TreeNode }> = ({ node }) => {
  if (node.depth === 0) return null;
  return (
    <span className="inline-flex items-center text-slate-300 font-mono text-[11px] select-none leading-none">
      {node.parentIsLast.slice(1).map((ancestorIsLast, i) => (
        <span key={i} className="inline-block w-4 text-center">
          {ancestorIsLast ? '\u00A0' : '│'}
        </span>
      ))}
      <span className="inline-block w-4 text-center">
        {node.isLast ? '└' : '├'}
      </span>
      <span className="inline-block w-2">─</span>
    </span>
  );
};

/* ─── 메인 컴포넌트 ─── */
const TRSystemModal: React.FC<TRSystemModalProps> = ({ isOpen, onClose, inspections, onApply }) => {
  // inspections → PanelNode[] 변환
  const initialPanels = useMemo((): PanelNode[] => {
    return inspections.map(ins => ({
      panelNo: ins.panelNo,
      notes: ins.notes || '',
      nominalCrossSection: ins.nominalCrossSection?.replace(/SQ$/i, '') || '',
      tr: ins.tr || 'TR-1(A) 900KVA',
      floor: ins.floor || 'F1',
      parentPanelNo: ins.parentPanelNo,
    }));
  }, [inspections]);

  const [panels, setPanels] = useState<PanelNode[]>([]);
  const [trGroups, setTrGroups] = useState<Record<string, boolean>>({ A: false, B: false });
  const [focusedCell, setFocusedCell] = useState<{ trKey: string; row: number; col: number } | null>(null);
  const cellRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  // TR 추가 팝업 상태
  const [showAddTRDialog, setShowAddTRDialog] = useState(false);
  const [newTRNum, setNewTRNum] = useState('');      // 예: "3"
  const [newTRLetter, setNewTRLetter] = useState(''); // 예: "C"
  const [newTRKVA, setNewTRKVA] = useState('');       // 예: "950"

  // 모달 열릴 때 데이터 초기화
  useEffect(() => {
    if (isOpen) {
      setPanels(initialPanels);
    }
  }, [isOpen, initialPanels]);

  /* ─── 셀 참조 관리 ─── */
  const setCellRef = useCallback((trKey: string, row: number, col: number, el: HTMLInputElement | null) => {
    const key = `${trKey}-${row}-${col}`;
    if (el) {
      cellRefs.current.set(key, el);
    } else {
      cellRefs.current.delete(key);
    }
  }, []);

  const focusCell = useCallback((trKey: string, row: number, col: number) => {
    const key = `${trKey}-${row}-${col}`;
    const el = cellRefs.current.get(key);
    if (el) {
      el.focus();
      el.select();
      setFocusedCell({ trKey, row, col });
    }
  }, []);

  /* ─── 패널 수정 ─── */
  const updatePanel = useCallback((panelNo: string, field: keyof PanelNode, value: string) => {
    setPanels(prev => prev.map(p =>
      p.panelNo === panelNo ? { ...p, [field]: value } : p
    ));
  }, []);

  const updatePanelNo = useCallback((oldPanelNo: string, newPanelNo: string) => {
    if (!newPanelNo.trim()) return;
    setPanels(prev => {
      // panelNo 변경 + 자식들의 parentPanelNo도 업데이트
      return prev.map(p => {
        if (p.panelNo === oldPanelNo) {
          return { ...p, panelNo: newPanelNo };
        }
        if (p.parentPanelNo === oldPanelNo) {
          return { ...p, parentPanelNo: newPanelNo };
        }
        return p;
      });
    });
  }, []);

  /* ─── 패널 추가 ─── */
  // 하위 PNL 추가 (열 추가: 1-1, 1-2, 1-3...)
  const addChildPanel = useCallback((parentNo: string) => {
    const parentPanel = panels.find(p => p.panelNo === parentNo);
    if (!parentPanel) return;

    const existingChildren = panels.filter(p => p.parentPanelNo === parentNo);
    // 기존 자식 번호에서 최대값 찾기
    let maxIdx = 0;
    existingChildren.forEach(c => {
      const parts = c.panelNo.split('-');
      const lastPart = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(lastPart) && lastPart > maxIdx) maxIdx = lastPart;
    });
    const nextIdx = maxIdx + 1;
    const newPanelNo = `${parentNo}-${nextIdx}`;

    const newPanel: PanelNode = {
      panelNo: newPanelNo,
      notes: '',
      nominalCrossSection: '',
      tr: parentPanel.tr,
      floor: parentPanel.floor,
      parentPanelNo: parentNo,
    };
    setPanels(prev => [...prev, newPanel]);
  }, [panels]);

  // 새 루트 PNL 추가 (행 추가: 1, 2, 3...)
  const addRootPanel = useCallback((trKey: string) => {
    const trPanels = panels.filter(p => p.tr === trKey && !p.parentPanelNo);
    let maxNo = 0;
    trPanels.forEach(p => {
      const num = parseInt(p.panelNo, 10);
      if (!isNaN(num) && num > maxNo) maxNo = num;
    });
    const newPanelNo = String(maxNo + 1);

    const newPanel: PanelNode = {
      panelNo: newPanelNo,
      notes: '',
      nominalCrossSection: '',
      tr: trKey,
      floor: getTrLetter(trKey) === 'A' ? 'F1' : 'B1',
    };
    setPanels(prev => [...prev, newPanel]);
  }, [panels]);

  /* ─── 패널 삭제 ─── */
  const deletePanel = useCallback((panelNo: string) => {
    // 자식 패널도 모두 삭제
    const toDelete = new Set<string>();
    const findDescendants = (pno: string) => {
      toDelete.add(pno);
      panels.filter(p => p.parentPanelNo === pno).forEach(child => findDescendants(child.panelNo));
    };
    findDescendants(panelNo);
    setPanels(prev => prev.filter(p => !toDelete.has(p.panelNo)));
  }, [panels]);

  /* ─── 키보드 네비게이션 ─── */
  const handleCellKeyDown = useCallback((e: React.KeyboardEvent, trKey: string, rowIdx: number, colIdx: number, maxRow: number) => {
    const maxCol = 2;

    switch (e.key) {
      case 'Tab':
        e.preventDefault();
        if (e.shiftKey) {
          if (colIdx > 0) focusCell(trKey, rowIdx, colIdx - 1);
          else if (rowIdx > 0) focusCell(trKey, rowIdx - 1, maxCol);
        } else {
          if (colIdx < maxCol) focusCell(trKey, rowIdx, colIdx + 1);
          else if (rowIdx < maxRow) focusCell(trKey, rowIdx + 1, 0);
        }
        break;
      case 'ArrowUp':
        if (e.altKey) return;
        e.preventDefault();
        if (rowIdx > 0) focusCell(trKey, rowIdx - 1, colIdx);
        break;
      case 'ArrowDown':
        if (e.altKey) return;
        e.preventDefault();
        if (rowIdx < maxRow) focusCell(trKey, rowIdx + 1, colIdx);
        break;
      case 'Enter':
        e.preventDefault();
        if (rowIdx < maxRow) focusCell(trKey, rowIdx + 1, colIdx);
        break;
      case 'Escape':
        (e.target as HTMLInputElement).blur();
        setFocusedCell(null);
        break;
    }
  }, [focusCell]);

  /* ─── 적용 (저장) ─── */
  const handleApply = useCallback(() => {
    // PanelNode[] → InspectionRecord[] 변환
    // 기존 inspections에서 매칭되는 것은 업데이트, 새로운 것은 추가
    const existingMap = new Map(inspections.map(ins => [ins.panelNo, ins]));
    const result: InspectionRecord[] = [];
    const processedPanelNos = new Set<string>();

    panels.forEach(p => {
      processedPanelNos.add(p.panelNo);
      const existing = existingMap.get(p.panelNo);
      if (existing) {
        // 기존 패널 업데이트
        result.push({
          ...existing,
          panelNo: p.panelNo,
          notes: p.notes || existing.notes,
          nominalCrossSection: p.nominalCrossSection ? `${p.nominalCrossSection}SQ` : existing.nominalCrossSection,
          tr: p.tr || existing.tr,
          floor: p.floor || existing.floor,
          parentPanelNo: p.parentPanelNo,
        });
      } else {
        // 새 패널 추가
        result.push({
          panelNo: p.panelNo,
          status: 'Pending',
          lastInspectionDate: '-',
          loads: { welder: false, grinder: false, light: false, pump: false },
          photoUrl: null,
          memo: '',
          tr: p.tr,
          floor: p.floor,
          nominalCrossSection: p.nominalCrossSection ? `${p.nominalCrossSection}SQ` : '',
          parentPanelNo: p.parentPanelNo,
          notes: p.notes,
          contractor: '삼성물산',
          projectName: '성수동 K-PJT',
        });
      }
    });

    // 계통도에서 삭제되지 않은 기존 패널도 유지 (계통도에 없는 패널)
    inspections.forEach(ins => {
      if (!processedPanelNos.has(ins.panelNo)) {
        result.push(ins);
      }
    });

    onApply(result);
    onClose();
  }, [panels, inspections, onApply, onClose]);

  /* ─── 리셋 ─── */
  const handleReset = useCallback(() => {
    setPanels(initialPanels);
  }, [initialPanels]);

  /* ─── TR별 트리 데이터 ─── */
  const trData = useMemo(() => {
    const grouped: Record<string, PanelNode[]> = {};
    panels.forEach(p => {
      const key = p.tr || 'A';
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(p);
    });

    return Object.keys(grouped).sort().map(trKey => ({
      trKey,
      trLabel: trKey || '미지정',
      panels: grouped[trKey],
      flatRows: flattenTree(buildTree(grouped[trKey])),
    }));
  }, [panels]);

  /* ─── TR 추가 팝업 열기 ─── */
  const openAddTRDialog = useCallback(() => {
    // 다음 번호/계통 자동 제안
    const existingLetters = [...new Set(panels.map(p => getTrLetter(p.tr)).filter(Boolean))];
    const allLetters = ['A', 'B', 'C', 'D', 'E', 'F'];
    const nextLetter = allLetters.find(l => !existingLetters.includes(l)) || '';
    const maxNum = panels.reduce((max, p) => {
      const m = p.tr?.match(/TR-(\d+)/);
      return m ? Math.max(max, parseInt(m[1], 10)) : max;
    }, 0);
    setNewTRNum(String(maxNum + 1));
    setNewTRLetter(nextLetter);
    setNewTRKVA('');
    setShowAddTRDialog(true);
  }, [panels]);

  /* ─── TR 추가 확정 ─── */
  const addNewTR = useCallback((trName: string) => {
    const existingTRs = new Set(panels.map(p => p.tr));
    if (existingTRs.has(trName)) {
      alert('이미 존재하는 TR입니다.');
      return;
    }
    const newPanel: PanelNode = {
      panelNo: '1',
      notes: '',
      nominalCrossSection: '',
      tr: trName,
      floor: 'F1',
    };
    setPanels(prev => [...prev, newPanel]);
    setTrGroups(prev => ({ ...prev, [trName]: false }));
    setShowAddTRDialog(false);
  }, [panels]);

  /* ─── TR 그룹 토글 ─── */
  const toggleTRGroup = useCallback((trKey: string) => {
    setTrGroups(prev => ({ ...prev, [trKey]: !prev[trKey] }));
  }, []);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-[95%] max-w-4xl mx-4 max-h-[90vh] flex flex-col overflow-hidden animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-slate-800 to-slate-700 text-white shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/10 rounded-lg">
              <GitBranch size={22} className="text-blue-300" />
            </div>
            <div>
              <h2 className="text-lg font-bold">TR 계통도</h2>
              <p className="text-xs text-slate-300">가설변대 - TR - PNL 계통 관리</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleReset}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
              title="초기화"
            >
              <RotateCcw size={14} />
              초기화
            </button>
            <button
              onClick={handleApply}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs bg-blue-500 hover:bg-blue-600 rounded-lg font-medium transition-colors"
            >
              <Save size={14} />
              적용
            </button>
            <button
              onClick={onClose}
              className="p-1.5 hover:bg-white/10 rounded-lg transition-colors"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">

          {/* TR 추가 팝업 */}
          {showAddTRDialog && (
            <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40">
              <div className="bg-white rounded-xl shadow-xl p-5 w-80 flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-800">TR 추가</h3>
                  <button onClick={() => setShowAddTRDialog(false)} className="p-1 hover:bg-slate-100 rounded-lg">
                    <X size={16} className="text-slate-500" />
                  </button>
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="block text-xs text-slate-500 mb-1">TR 번호</label>
                    <input
                      type="number" min="1" value={newTRNum}
                      onChange={e => setNewTRNum(e.target.value)}
                      placeholder="3"
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-amber-400 focus:outline-none"
                    />
                  </div>
                  <div className="w-20">
                    <label className="block text-xs text-slate-500 mb-1">계통</label>
                    <input
                      type="text" maxLength={1} value={newTRLetter}
                      onChange={e => setNewTRLetter(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
                      placeholder="C"
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-amber-400 focus:outline-none"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs text-slate-500 mb-1">KVA</label>
                    <input
                      type="number" min="1" value={newTRKVA}
                      onChange={e => setNewTRKVA(e.target.value)}
                      placeholder="950"
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-amber-400 focus:outline-none"
                    />
                  </div>
                </div>
                {/* 미리보기 */}
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-center">
                  <span className="text-xs text-amber-600 font-medium">
                    {newTRNum && newTRLetter && newTRKVA
                      ? `TR-${newTRNum}(${newTRLetter}) ${newTRKVA}KVA`
                      : '번호 · 계통 · KVA를 입력하세요'}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowAddTRDialog(false)}
                    className="flex-1 py-2 text-sm border border-slate-300 text-slate-600 rounded-lg hover:bg-slate-50 transition-colors"
                  >
                    취소
                  </button>
                  <button
                    disabled={!newTRNum || !newTRLetter || !newTRKVA}
                    onClick={() => addNewTR(`TR-${newTRNum}(${newTRLetter}) ${newTRKVA}KVA`)}
                    className="flex-1 py-2 text-sm bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium"
                  >
                    추가
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 가설변대 헤더 */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap size={18} className="text-amber-500" />
              <h3 className="font-bold text-slate-800">가설변대</h3>
              <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                {trData.length}개 TR · {panels.length}개 PNL
              </span>
            </div>
            <button
              onClick={openAddTRDialog}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 rounded-lg font-medium transition-colors"
            >
              <Plus size={14} />
              TR 추가
            </button>
          </div>

          {/* TR 그룹들 */}
          {trData.map(({ trKey, trLabel, panels: trPanels, flatRows }) => (
            <div key={trKey} className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm">
              {/* TR 헤더 */}
              <div
                className={`flex items-center justify-between px-4 py-3 cursor-pointer select-none transition-colors ${
                  getTrLetter(trKey) === 'A' ? 'bg-blue-50 hover:bg-blue-100 border-b border-blue-200' :
                  getTrLetter(trKey) === 'B' ? 'bg-orange-50 hover:bg-orange-100 border-b border-orange-200' :
                  'bg-slate-50 hover:bg-slate-100 border-b border-slate-200'
                }`}
                onClick={() => toggleTRGroup(trKey)}
              >
                <div className="flex items-center gap-2">
                  {trGroups[trKey] ? <ChevronRight size={18} className="text-slate-500" /> : <ChevronDown size={18} className="text-slate-500" />}
                  <span className={`font-bold text-sm ${
                    getTrLetter(trKey) === 'A' ? 'text-blue-800' : getTrLetter(trKey) === 'B' ? 'text-orange-800' : 'text-slate-800'
                  }`}>
                    {trLabel}
                  </span>
                  <span className="text-xs text-slate-500 bg-white/70 px-2 py-0.5 rounded-full">
                    {trPanels.length}개 PNL
                  </span>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    addRootPanel(trKey);
                  }}
                  className={`flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg font-medium transition-colors ${
                    getTrLetter(trKey) === 'A' ? 'bg-blue-600 text-white hover:bg-blue-700' :
                    getTrLetter(trKey) === 'B' ? 'bg-orange-600 text-white hover:bg-orange-700' :
                    'bg-slate-600 text-white hover:bg-slate-700'
                  }`}
                >
                  <Plus size={12} />
                  PNL 추가
                </button>
              </div>

              {/* TR 테이블 */}
              {!trGroups[trKey] && (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="bg-slate-50">
                        <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 border-b border-slate-200 w-[40%]">
                          PNL NO.
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 border-b border-slate-200 w-[30%]">
                          비고
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 border-b border-slate-200 w-[20%]">
                          공칭 단면적
                        </th>
                        <th className="px-3 py-2 text-center text-xs font-semibold text-slate-600 border-b border-slate-200 w-[10%]">
                          작업
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {flatRows.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-4 py-8 text-center text-slate-400 text-xs">
                            등록된 PNL이 없습니다. 'PNL 추가' 버튼을 클릭하세요.
                          </td>
                        </tr>
                      ) : (
                        flatRows.map((node, rowIdx) => {
                          const isFocusedRow = focusedCell?.trKey === trKey && focusedCell?.row === rowIdx;
                          return (
                            <tr
                              key={`${trKey}-${node.panel.panelNo}-${rowIdx}`}
                              className={`group transition-colors ${
                                isFocusedRow ? 'bg-blue-50/70' : 'hover:bg-slate-50/70'
                              } ${node.depth === 0 ? 'font-medium' : ''}`}
                            >
                              {/* PNL NO. */}
                              <td className="px-2 py-1 border-b border-slate-100">
                                <div className="flex items-center">
                                  <TreeConnector node={node} />
                                  <input
                                    ref={(el) => setCellRef(trKey, rowIdx, 0, el)}
                                    className={`w-full max-w-[120px] text-xs bg-transparent rounded px-1.5 py-1 outline-none transition-all
                                      border border-transparent focus:border-blue-400 focus:bg-white focus:shadow-sm
                                      ${node.depth === 0 ? 'font-semibold text-slate-800' : 'text-slate-700'}`}
                                    value={node.panel.panelNo}
                                    onChange={(e) => updatePanelNo(node.panel.panelNo, e.target.value)}
                                    onFocus={() => setFocusedCell({ trKey, row: rowIdx, col: 0 })}
                                    onKeyDown={(e) => handleCellKeyDown(e, trKey, rowIdx, 0, flatRows.length - 1)}
                                  />
                                </div>
                              </td>
                              {/* 비고 */}
                              <td className="px-2 py-1 border-b border-slate-100">
                                <input
                                  ref={(el) => setCellRef(trKey, rowIdx, 1, el)}
                                  className="w-full text-xs text-slate-600 bg-transparent rounded px-1.5 py-1 outline-none transition-all
                                    border border-transparent focus:border-blue-400 focus:bg-white focus:shadow-sm"
                                  value={node.panel.notes}
                                  onChange={(e) => updatePanel(node.panel.panelNo, 'notes', e.target.value)}
                                  onFocus={() => setFocusedCell({ trKey, row: rowIdx, col: 1 })}
                                  onKeyDown={(e) => handleCellKeyDown(e, trKey, rowIdx, 1, flatRows.length - 1)}
                                  placeholder="—"
                                />
                              </td>
                              {/* 공칭 단면적 */}
                              <td className="px-2 py-1 border-b border-slate-100">
                                <div className="flex items-center gap-0.5">
                                  <input
                                    ref={(el) => setCellRef(trKey, rowIdx, 2, el)}
                                    className="w-16 text-xs text-slate-600 bg-transparent text-right rounded px-1.5 py-1 outline-none transition-all
                                      border border-transparent focus:border-blue-400 focus:bg-white focus:shadow-sm"
                                    value={node.panel.nominalCrossSection}
                                    onChange={(e) => {
                                      const val = e.target.value.replace(/[^0-9]/g, '');
                                      updatePanel(node.panel.panelNo, 'nominalCrossSection', val);
                                    }}
                                    onFocus={() => setFocusedCell({ trKey, row: rowIdx, col: 2 })}
                                    onKeyDown={(e) => handleCellKeyDown(e, trKey, rowIdx, 2, flatRows.length - 1)}
                                    placeholder="0"
                                  />
                                  <span className="text-[10px] text-slate-400 font-medium shrink-0">SQ</span>
                                </div>
                              </td>
                              {/* 작업 버튼 */}
                              <td className="px-1 py-1 border-b border-slate-100 text-center">
                                <div className="flex items-center justify-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button
                                    onClick={() => addChildPanel(node.panel.panelNo)}
                                    className="p-1 hover:bg-blue-100 rounded text-blue-500 transition-colors"
                                    title={`${node.panel.panelNo}의 하위 PNL 추가`}
                                  >
                                    <Plus size={14} />
                                  </button>
                                  <button
                                    onClick={() => {
                                      if (window.confirm(`PNL NO. ${node.panel.panelNo}을(를) 삭제하시겠습니까?\n하위 PNL도 함께 삭제됩니다.`)) {
                                        deletePanel(node.panel.panelNo);
                                      }
                                    }}
                                    className="p-1 hover:bg-red-100 rounded text-red-400 hover:text-red-600 transition-colors"
                                    title="삭제"
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}

          {trData.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400">
              <GitBranch size={48} className="mb-4 opacity-30" />
              <p className="text-sm font-medium mb-2">등록된 TR이 없습니다</p>
              <p className="text-xs mb-4">'TR 추가' 버튼을 클릭하여 시작하세요</p>
              <button
                onClick={openAddTRDialog}
                className="flex items-center gap-1.5 px-4 py-2 text-sm bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors font-medium"
              >
                <Plus size={16} />
                TR 추가
              </button>
            </div>
          )}
        </div>

        {/* Footer 요약 */}
        <div className="shrink-0 px-6 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
          <div className="flex items-center gap-4">
            {trData.map(({ trKey, trLabel, panels: trPanels }) => (
              <span key={trKey} className="flex items-center gap-1">
                <span className={`w-2 h-2 rounded-full ${getTrLetter(trKey) === 'A' ? 'bg-blue-500' : getTrLetter(trKey) === 'B' ? 'bg-orange-500' : 'bg-slate-400'}`} />
                {trLabel}: <strong className="text-slate-700">{trPanels.length}</strong>개
              </span>
            ))}
          </div>
          <span>
            총 <strong className="text-slate-700">{panels.length}</strong>개 PNL
          </span>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default TRSystemModal;
