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
export type EmployeeStatus = 'available' | 'vacation' | 'sick';

export type EmployeeRole = 'worker' | 'leader' | 'manager';

export type EmployeePosition = 'worker' | 'leader' | 'manager' | 'trainee';

/** Definicja umiejętności / kwalifikacji — konfigurowalna przez użytkownika */
export interface QualificationDefinition {
  id: string;            // Unikalny identyfikator (np. 'audit', 'custom_1')
  name: string;          // Nazwa wyświetlana
  icon: string;          // Emoji ikona
  description?: string;  // Opis umiejętności
  sortOrder: number;     // Kolejność wyświetlania
}

/** Kwalifikacje pracownika — ocena 0-5 (0 = brak, 5 = ekspert) */
export interface EmployeeQualifications {
  [key: string]: number | undefined;  // Dynamiczne kwalifikacje z oceną gwiazdkową
}

export interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  color: string;
  status?: EmployeeStatus;        // Domyślnie 'available'
  suggestedShift?: 1 | 2 | 3;     // Sugerowana zmiana
  shiftSystem?: 1 | 2 | 3;        // System zmianowy (1=jednozmianowy, 2=dwuzmianowy, 3=trzyzmianowy)
  note?: string;                  // Notatka o pracowniku
  role?: EmployeeRole;            // Rola: pracownik, lider, kierownik
  position?: EmployeePosition;    // Stanowisko
  schedulable?: boolean;          // Czy pracownik ma być obsadzany w grafiku (domyślnie true)
  qualifications?: EmployeeQualifications; // Kwalifikacje z oceną gwiazdkową
  email?: string;                 // Adres email
  phone?: string;                 // Numer telefonu
  department?: string;            // Dział
  createdAt: number;
}

// ==================== Schedule Assignment (Przypisanie w grafiku) ====================
export type AssignmentScope = 
  | 'project'           // Cały projekt
  | 'audit'             // Tylko audyty
  | 'adhesion'          // Tylko przyczepność
  | 'specific';         // Konkretna część/test

export interface ScheduleAssignment {
  id: string;
  projectId: string;
  scope: AssignmentScope;           // Zakres przypisania
  testId?: string;                  // Jeśli scope='specific' - ID testu
  partId?: string;                  // Jeśli scope='specific' - ID części (opcjonalnie)
  employeeId: string;
  week: string;                     // np. "2026-KW05"
  shift: 1 | 2 | 3;                 // Zmiana
  note?: string;                    // Komentarz co pracownik ma robić
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
  compactMode: boolean;   // Tryb kompaktowy - mniejsze odstępy
  highlightMissing: boolean;
  blinkAlerts: boolean;
  soundAlerts: boolean;    // Dźwiękowe powiadomienia
  deletePassword: string;
  editMode: boolean;  // Tryb edycji po wpisaniu hasła
  userName: string;   // Nazwa użytkownika dla logów
  recoveryEmail: string;  // Email do odzyskiwania hasła
  zoomLevel: number;  // Poziom zoom siatki (50-150)
  shiftSystem: 1 | 2 | 3;  // System zmianowy (1, 2 lub 3 zmiany)
  autoSaveInterval: number; // Auto-save in seconds (0 = disabled)
  // Backup settings
  backupPath: string;
  backupFrequency: 'none' | 'session' | 'daily' | 'weekly';
  lastBackupDate: string;
  // Qualification definitions
  qualificationDefinitions?: QualificationDefinition[];  // Dynamiczne definicje kwalifikacji
}

// ==================== Absence Management (Zarządzanie nieobecnościami) ====================

export interface AbsenceType {
  id: string;
  name: string;
  icon: string;
  color: string;
  defaultDays: number;
  isPaid: boolean;
  requiresApproval: boolean;
  isActive: boolean;
  sortOrder: number;
}

export interface EmployeeAbsenceLimit {
  id: string;
  employeeId: string;
  absenceTypeId: string;
  year: number;
  totalDays: number;
  usedDays: number;
}

export type AbsenceStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface Absence {
  id: string;
  employeeId: string;
  absenceTypeId: string;
  startDate: string;     // YYYY-MM-DD
  endDate: string;       // YYYY-MM-DD
  workDays: number;      // Liczba dni roboczych
  status?: string;       // Legacy field - kept for backward compatibility
  note?: string;
  createdAt: number;
  approvedAt?: number;
  approvedBy?: string;
  // Joined data
  typeName?: string;
  typeIcon?: string;
  typeColor?: string;
  firstName?: string;
  lastName?: string;
}

export interface EmployeeDetails {
  employeeId: string;
  email?: string;
  phone?: string;
  birthDate?: string;
  hireDate?: string;
  department?: string;
  position?: string;
  contractType?: string;
  workingHours?: number;
  notes?: string;
}

export interface EmployeeQualification {
  id: string;
  employeeId: string;
  testId: string;
  level: number;         // 1 = podstawowy, 2 = zaawansowany, 3 = ekspert
  certifiedAt?: number;
  expiresAt?: number;
  testName?: string;
}

export interface Holiday {
  id: string;
  date: string;          // YYYY-MM-DD
  name: string;
  isMovable: boolean;
}

export interface ExtraTask {
  id: string;
  name: string;
  week: string;           // np. "2026-KW09"
  timePerUnit: number;    // Czas na jednostkę w minutach
  units: number;          // Liczba jednostek
  comment?: string;       // Komentarz
  created_at: number;
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
  extraTasks: ExtraTask[];
  settings: AppSettings;
  currentView: string;
  selectedYear: number;
  // Absence management
  absenceTypes?: AbsenceType[];
  absences?: Absence[];
  holidays?: Holiday[];
}
