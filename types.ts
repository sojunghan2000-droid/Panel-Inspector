export interface Loads {
  welder: boolean;
  grinder: boolean;
  light: boolean;
  pump: boolean;
}

export interface InspectionRecord {
  id: string;
  status: 'Complete' | 'In Progress' | 'Pending';
  lastInspectionDate: string;
  loads: Loads;
  photoUrl: string | null;
  memo: string;
}

export type InspectionStatus = InspectionRecord['status'];

export interface StatData {
  name: string;
  value: number;
  color: string;
}