export interface Customer {
  id: string;
  name: string;
  created_at: number;
}

export interface Type {
  id: string;
  name: string;
  created_at: number;
}

export interface Part {
  id: string;
  name: string;
  created_at: number;
}

export interface Test {
  id: string;
  name: string;
  created_at: number;
}

export interface WeekData {
  ist: number;
  soll: number;
}

export interface Project {
  id: string;
  customer_id: string;
  type_id: string;
  part_id: string;
  test_id: string;
  weeks: { [week: string]: WeekData };
  created_at: number;
  updated_at: number;
}

export interface AppSettings {
  language: 'en' | 'de' | 'pl' | 'ro';
  darkMode: boolean;
  animations: boolean;
  highlightMissing: boolean;
  blinkAlerts: boolean;
}
