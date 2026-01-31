export interface Customer {
  id: string;
  name: string;
  createdAt: number;
}

export interface Type {
  id: string;
  name: string;
  createdAt: number;
}

export interface Part {
  id: string;
  name: string;
  createdAt: number;
}

export interface Test {
  id: string;
  name: string;
  color?: string;
  createdAt: number;
}

export interface WeekData {
  ist: number;
  soll: number;
  comment?: string;        // Komentarz do pola
  stoppage?: boolean;      // Postój projektu
  productionLack?: boolean; // Brak produkcji (brak części)
}

export interface Project {
  id: string;
  customer_id: string;
  type_id: string;
  part_id: string;
  test_id: string;
  weeks: { [week: string]: WeekData };
  timePerUnit: number;     // Czas na jednostkę w minutach
  hidden?: boolean;        // Ukryty projekt (zakończony)
  created_at: number;
  updated_at: number;
}

// ==================== Employee (Pracownik) ====================
export interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  color: string;
  createdAt: number;
}

// ==================== Schedule Assignment (Przypisanie w grafiku) ====================
export interface ScheduleAssignment {
  id: string;
  projectId: string;
  testId?: string;        // Jeśli null - przypisanie do całego projektu, jeśli set - tylko do tego testu
  employeeId: string;
  week: string;           // np. "2026-KW05"
  shift: 1 | 2 | 3;       // Zmiana
  createdAt: number;
  updatedAt: number;
}

// ==================== Project Comment (Komentarz do projektu) ====================
export interface ProjectComment {
  id: string;
  projectId: string;
  week: string;
  comment: string;
  createdAt: number;
  updatedAt: number;
}

// ==================== Schedule Entry (Grafik - legacy) ====================
export interface ScheduleEntry {
  id: string;
  projectId: string;
  employeeId: string;
  week: string;           // np. "2026-KW05"
  year: number;
  status: 'planned' | 'in-progress' | 'completed' | 'cancelled';
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface AppSettings {
  language: 'en' | 'de' | 'pl' | 'ro';
  darkMode: boolean;
  animations: boolean;
  highlightMissing: boolean;
  blinkAlerts: boolean;
  deletePassword: string;
  editMode: boolean;  // Tryb edycji po wpisaniu hasła
  userName: string;   // Nazwa użytkownika dla logów
  zoomLevel: number;  // Poziom zoom siatki (50-150)
  shiftSystem: 1 | 2 | 3;  // System zmianowy (1, 2 lub 3 zmiany)
}

export interface AppState {
  customers: Customer[];
  types: Type[];
  parts: Part[];
  tests: Test[];
  projects: Project[];
  employees: Employee[];
  scheduleEntries: ScheduleEntry[];
  scheduleAssignments: ScheduleAssignment[];
  projectComments: ProjectComment[];
  settings: AppSettings;
  currentView: string;
  selectedYear: number;
}
