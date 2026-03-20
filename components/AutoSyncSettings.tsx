import React, { useState, useEffect } from 'react';
import { Settings, X } from 'lucide-react';
import { AutoSyncConfig, getAutoSyncConfig, saveAutoSyncConfig } from '../services/syncService';

interface AutoSyncSettingsProps {
  isOpen: boolean;
  onClose: () => void;
  onSettingsSaved?: () => void;
}

/**
 * 자동 동기화 설정 모달 컴포넌트
 * - 활성화 여부 토글
 * - 동기화 간격 설정 (5, 15, 30분)
 * - 배터리 임계값 설정 (10-50%)
 */
export function AutoSyncSettings({ isOpen, onClose, onSettingsSaved }: AutoSyncSettingsProps) {
  const [config, setConfig] = useState<AutoSyncConfig | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // 컴포넌트 마운트 시 현재 설정 로드
  useEffect(() => {
    if (isOpen) {
      const currentConfig = getAutoSyncConfig();
      setConfig(currentConfig);
    }
  }, [isOpen]);

  // 설정 저장
  const handleSave = async () => {
    if (!config) return;

    setIsSaving(true);
    try {
      // 설정 저장
      saveAutoSyncConfig(config);

      // 콜백 실행
      onSettingsSaved?.();

      // 모달 닫기
      onClose();
    } catch (error) {
      console.error('[AutoSyncSettings] 설정 저장 오류:', error);
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen || !config) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-lg p-6 max-w-md w-full mx-4">
        {/* 헤더 */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-blue-600" />
            <h2 className="text-lg font-semibold">자동 동기화 설정</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded-md transition-colors"
            aria-label="닫기"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 설정 항목 */}
        <div className="space-y-6">
          {/* 활성화 토글 */}
          <div className="flex items-center justify-between">
            <label className="font-medium text-gray-700">자동 동기화</label>
            <button
              onClick={() => setConfig({ ...config, enabled: !config.enabled })}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                config.enabled ? 'bg-blue-600' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  config.enabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* 동기화 간격 선택 */}
          {config.enabled && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  동기화 간격 (분)
                </label>
                <select
                  value={config.intervalMinutes}
                  onChange={(e) =>
                    setConfig({ ...config, intervalMinutes: Number(e.target.value) })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value={5}>5분</option>
                  <option value={15}>15분</option>
                  <option value={30}>30분</option>
                </select>
              </div>

              {/* 배터리 임계값 슬라이더 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  최소 배터리 레벨: {config.batteryLevelThreshold}%
                </label>
                <input
                  type="range"
                  min="10"
                  max="50"
                  step="5"
                  value={config.batteryLevelThreshold}
                  onChange={(e) =>
                    setConfig({ ...config, batteryLevelThreshold: Number(e.target.value) })
                  }
                  className="w-full"
                />
                <p className="text-xs text-gray-500 mt-1">
                  배터리가 이 수준 아래면 동기화하지 않습니다
                </p>
              </div>

              {/* 설정 요약 */}
              <div className="bg-blue-50 p-3 rounded-md text-sm">
                <p className="text-gray-700">
                  설정된 동기화 간격: <span className="font-semibold">{config.intervalMinutes}분</span>
                </p>
                <p className="text-gray-700">
                  최소 배터리: <span className="font-semibold">{config.batteryLevelThreshold}%</span>
                </p>
              </div>
            </>
          )}

          {!config.enabled && (
            <div className="bg-yellow-50 p-3 rounded-md text-sm text-gray-700">
              자동 동기화가 비활성화되었습니다
            </div>
          )}
        </div>

        {/* 버튼 */}
        <div className="flex gap-3 mt-8">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md font-medium transition-colors"
          >
            취소
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex-1 px-4 py-2 text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 rounded-md font-medium transition-colors"
          >
            {isSaving ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}
