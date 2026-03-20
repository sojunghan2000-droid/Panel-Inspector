import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { StatData } from '../types';

interface StatsChartProps {
  data: StatData[];
}

const StatsChart: React.FC<StatsChartProps> = ({ data }) => {
  // 데이터 없거나 합계 0이면 렌더링 생략 (Recharts width/height -1 경고 방지)
  if (!data || data.length === 0 || data.every(d => d.value === 0)) {
    return <div className="w-full" style={{ height: '256px', minHeight: '200px' }} />;
  }
  return (
    <div className="w-full" style={{ height: '256px', minHeight: '200px', minWidth: 0 }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius="40%"
            outerRadius="60%"
            paddingAngle={5}
            dataKey="value"
          >
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip 
            contentStyle={{ backgroundColor: '#fff', borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
            itemStyle={{ color: '#374151', fontWeight: 600 }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
};

export default StatsChart;