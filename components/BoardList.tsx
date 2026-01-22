import React from 'react';
import { InspectionRecord } from '../types';
import { ClipboardList, AlertTriangle, CheckCircle, Clock } from 'lucide-react';

interface BoardListProps {
  items: InspectionRecord[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const BoardList: React.FC<BoardListProps> = ({ items, selectedId, onSelect }) => {
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'Complete': return <CheckCircle size={16} className="text-emerald-500" />;
      case 'In Progress': return <Clock size={16} className="text-blue-500" />;
      default: return <AlertTriangle size={16} className="text-slate-400" />;
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden h-full flex flex-col">
      <div className="p-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
        <h3 className="font-semibold text-slate-700 flex items-center gap-2">
          <ClipboardList size={18} />
          Board List
        </h3>
        <span className="text-xs bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full">{items.length} Items</span>
      </div>
      <div className="overflow-y-auto flex-1">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-slate-500 uppercase bg-slate-50 sticky top-0">
            <tr>
              <th className="px-4 py-3 font-medium">ID</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium text-right">Last Check</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((item) => (
              <tr 
                key={item.id}
                onClick={() => onSelect(item.id)}
                className={`
                  cursor-pointer transition-colors hover:bg-blue-50
                  ${selectedId === item.id ? 'bg-blue-50 border-l-4 border-l-blue-500' : 'border-l-4 border-l-transparent'}
                `}
              >
                <td className="px-4 py-3 font-medium text-slate-800">{item.id}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {getStatusIcon(item.status)}
                    <span className={`
                      ${item.status === 'Complete' ? 'text-emerald-700' : ''}
                      ${item.status === 'In Progress' ? 'text-blue-700' : ''}
                      ${item.status === 'Pending' ? 'text-slate-500' : ''}
                    `}>
                      {item.status}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3 text-right text-slate-500 font-mono text-xs">{item.lastInspectionDate}</td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-slate-400">
                  No records found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default BoardList;