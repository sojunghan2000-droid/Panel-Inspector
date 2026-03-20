import React from 'react';
import { Cloud, CloudOff, RefreshCw, CheckCircle2, AlertCircle, Settings } from 'lucide-react';
import type { SyncStatus } from '../services/syncService';

interface SyncStatusBadgeProps {
  status: SyncStatus;
  isConfigured: boolean;
  onManualSync: () => void;
  onSettingsClick?: () => void;
}

const SyncStatusBadge: React.FC<SyncStatusBadgeProps> = ({ status, isConfigured, onManualSync, onSettingsClick }) => {
  if (!isConfigured) return null;

  const config: Record<SyncStatus, { icon: React.ReactNode; label: string; className: string }> = {
    idle: {
      icon: <Cloud size={14} />,
      label: '동기화 대기',
      className: 'text-slate-400 hover:text-slate-600',
    },
    syncing: {
      icon: <RefreshCw size={14} className="animate-spin" />,
      label: '동기화 중',
      className: 'text-blue-500',
    },
    success: {
      icon: <CheckCircle2 size={14} />,
      label: '동기화 완료',
      className: 'text-emerald-500',
    },
    error: {
      icon: <AlertCircle size={14} />,
      label: '동기화 오류',
      className: 'text-red-500 hover:text-red-600',
    },
    offline: {
      icon: <CloudOff size={14} />,
      label: '오프라인',
      className: 'text-amber-500',
    },
  };

  const { icon, label, className } = config[status];

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={onManualSync}
        disabled={status === 'syncing'}
        title={`${label} · 클릭하여 수동 동기화`}
        className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:cursor-not-allowed ${className}`}
      >
        {icon}
        <span className="hidden sm:inline">{label}</span>
      </button>
      {onSettingsClick && (
        <button
          onClick={onSettingsClick}
          title="자동 동기화 설정"
          className="p-1.5 hover:bg-slate-200 rounded-lg text-slate-500 hover:text-slate-700 transition-colors"
        >
          <Settings size={14} />
        </button>
      )}
    </div>
  );
};

export default SyncStatusBadge;
