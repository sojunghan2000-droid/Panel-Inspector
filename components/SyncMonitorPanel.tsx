import React, { useState, useEffect } from 'react';
import { Activity, Battery, Eye, Wifi, AlertCircle, Clock } from 'lucide-react';
import { ActivityState } from '../hooks/useActivityDetector';
import { getLastAutoSyncTime, getAutoSyncConfig } from '../services/syncService';

interface SyncMonitorPanelProps {
  activityState: ActivityState;
  isAutoSyncEnabled: boolean;
}

/**
 * 자동 동기화 모니터링 패널
 * - 마지막 동기화 시간
 * - 현재 활동 상태
 * - 배터리 상태
 * - 탭 표시 여부
 * - 다음 예약 시간 (예상)
 */
export function SyncMonitorPanel({ activityState, isAutoSyncEnabled }: SyncMonitorPanelProps) {
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const [config, setConfig] = useState<any>(null);
  const [nextSyncEstimate, setNextSyncEstimate] = useState<Date | null>(null);

  useEffect(() => {
    // 마지막 동기화 시간 가져오기
    const syncTime = getLastAutoSyncTime();
    setLastSyncTime(syncTime);

    // 설정 가져오기
    const currentConfig = getAutoSyncConfig();
    setConfig(currentConfig);

    // 다음 동기화 시간 예상 (현재 시간 + intervalMinutes)
    if (currentConfig?.enabled) {
      const nextTime = new Date(Date.now() + currentConfig.intervalMinutes * 60 * 1000);
      setNextSyncEstimate(nextTime);
    }
  }, []);

  if (!isAutoSyncEnabled || !config?.enabled) {
    return null;
  }

  const formatTime = (date: string | Date | null) => {
    if (!date) return '없음';
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const getBatteryPercentage = () => {
    if (activityState.batteryLevel === null) return '불명';
    return `${Math.round(activityState.batteryLevel * 100)}%`;
  };

  return (
    <div className="fixed bottom-4 right-4 bg-white rounded-lg shadow-lg border border-slate-200 p-4 w-80 z-40">
      {/* 헤더 */}
      <div className="flex items-center gap-2 mb-3 pb-3 border-b border-slate-100">
        <Wifi size={16} className="text-blue-600" />
        <h3 className="text-sm font-semibold text-slate-700">동기화 상태</h3>
      </div>

      {/* 모니터링 항목들 */}
      <div className="space-y-2.5 text-xs">
        {/* 마지막 동기화 */}
        <div className="flex items-center justify-between">
          <span className="text-slate-600 flex items-center gap-1.5">
            <Clock size={14} />
            마지막 동기화
          </span>
          <span className="text-slate-700 font-medium">{formatTime(lastSyncTime)}</span>
        </div>

        {/* 활동 상태 */}
        <div className="flex items-center justify-between">
          <span className="text-slate-600 flex items-center gap-1.5">
            <Activity size={14} />
            활동 상태
          </span>
          <span className={`font-medium ${activityState.isActive ? 'text-emerald-600' : 'text-slate-500'}`}>
            {activityState.isActive ? '활성' : '유휴'}
          </span>
        </div>

        {/* 탭 표시 */}
        <div className="flex items-center justify-between">
          <span className="text-slate-600 flex items-center gap-1.5">
            <Eye size={14} />
            탭 표시
          </span>
          <span className={`font-medium ${activityState.isTabVisible ? 'text-emerald-600' : 'text-slate-500'}`}>
            {activityState.isTabVisible ? '표시' : '숨김'}
          </span>
        </div>

        {/* 배터리 */}
        {activityState.batteryLevel !== null && (
          <div className="flex items-center justify-between">
            <span className="text-slate-600 flex items-center gap-1.5">
              <Battery size={14} />
              배터리
            </span>
            <div className="flex items-center gap-2">
              <span className="text-slate-700 font-medium">{getBatteryPercentage()}</span>
              {activityState.isCharging && <span className="text-amber-600 text-xs">충전 중</span>}
            </div>
          </div>
        )}

        {/* 다음 동기화 */}
        {nextSyncEstimate && (
          <div className="flex items-center justify-between">
            <span className="text-slate-600 flex items-center gap-1.5">
              <AlertCircle size={14} />
              다음 동기화
            </span>
            <span className="text-slate-700 font-medium">{formatTime(nextSyncEstimate)}</span>
          </div>
        )}
      </div>

      {/* 설정 요약 */}
      <div className="mt-3 pt-3 border-t border-slate-100">
        <div className="text-xs text-slate-600">
          <p>간격: {config?.intervalMinutes}분</p>
          <p>배터리 임계값: {config?.batteryLevelThreshold}%</p>
        </div>
      </div>
    </div>
  );
}

export default SyncMonitorPanel;
