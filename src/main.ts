import { i18n } from './i18n';
import { api } from './api/client';
import { db } from './database';
import { Customer, Type, Part, Test, Project, AppState, Employee, ScheduleEntry, ScheduleAssignment, ProjectComment, AssignmentScope, EmployeeStatus, ExtraTask } from './types';
import { Chart, registerables } from 'chart.js';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

Chart.register(...registerables);

// ==================== Activity Log Interface ====================
interface ActivityLog {
  id: string;
  userId: string;
  userName: string;
  action: 'created' | 'updated' | 'deleted' | 'imported' | 'exported';
  entityType: string;
  entityName: string;
  details: string;
  timestamp: number;
}

// ==================== Test Color Palette ====================
const TEST_COLORS = [
  '#0097AC', '#E91E63', '#9C27B0', '#673AB7', '#3F51B5',
  '#00BCD4', '#009688', '#4CAF50', '#FF9800', '#795548'
];

// ==================== Employee Color Palette ====================
const EMPLOYEE_COLORS = [
  '#E91E63', '#9C27B0', '#673AB7', '#3F51B5', '#2196F3',
  '#00BCD4', '#009688', '#4CAF50', '#FF9800', '#795548',
  '#607D8B', '#F44336'
];

// ==================== Comment Interface ====================
interface Comment {
  id: string;
  projectId: string;
  week: string;
  text: string;
  createdAt: number;
}

// ==================== Main Application ====================
class KappaApp {
  private state: AppState = {
    customers: [],
    types: [],
    parts: [],
    tests: [],
    projects: [],
    employees: [],
    scheduleEntries: [],
    scheduleAssignments: [],
    projectComments: [],
    extraTasks: [],
    settings: {
      language: 'en',
      darkMode: false,
      animations: true,
      highlightMissing: true,
      blinkAlerts: true,
      deletePassword: '',
      editMode: false,
      userName: '',
      zoomLevel: 100,
      shiftSystem: 2,
      backupPath: '',
      backupFrequency: 'none',
      lastBackupDate: '',
    },
    currentView: 'planning',
    selectedYear: new Date().getFullYear(),
  };

  private comments: Comment[] = [];
  private logs: ActivityLog[] = [];
  private weeklyChart: Chart | null = null;
  private testChart: Chart | null = null;
  private trendChart: Chart | null = null;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private draggedEntry: HTMLElement | null = null;
  private skipNextScroll: boolean = false;
  
  // Sorting state
  private sortColumn: 'customer' | 'type' | 'part' | 'test' | 'time' | null = null;
  private sortDirection: 'asc' | 'desc' = 'asc';
  
  // Pinned projects
  private pinnedProjects: Set<string> = new Set();
  
  // Active cell for keyboard navigation
  private activeCell: { projectId: string; week: number; type: 'ist' | 'soll' } | null = null;

  // Absence module state
  private absenceYear: number = new Date().getFullYear();
  private absenceViewMode: 'calendar' | 'list' | 'heatmap' | 'employees' | 'timeline' = 'timeline';
  private absenceCalendarMonth: number = new Date().getMonth();
  private absenceFilterEmployee: string = '';
  private absenceFilterType: string = '';
  private absenceFilterMonth: string = '';
  private absenceTypes: any[] = [];
  private absences: any[] = [];
  private absenceLimits: any[] = [];
  private holidays: any[] = [];
  private absenceEventsInitialized: boolean = false;

  // Admin mode - unlocked by password in settings
  private adminUnlocked: boolean = false;

  async init(): Promise<void> {
    try {
      await db.init();
      await this.loadData();
      
      // Load pinned projects from database
      await this.loadPinnedProjects();
      
      // Load item tags from database
      await this.loadItemTags();
      
      // Load example data if database is empty
      if (this.state.projects.length === 0 && this.state.customers.length === 0) {
        await this.loadExampleData();
      }
      
      this.setupEventListeners();
      this.applyTheme();
      this.applyZoom();
      this.updateAdminUI(); // Hide admin elements initially
      this.renderCurrentView();
      this.startAnimations();
      
      // Auto-backup check
      await this.checkAutoBackup();
      
      console.log('✅ Kappaplannung initialized successfully');
    } catch (error) {
      console.error('Failed to initialize:', error);
    }
  }
  
  private async loadExampleData(): Promise<void> {
    try {
      const response = await fetch('/example-data.json');
      if (!response.ok) return;
      
      const data = await response.json();
      const currentYear = new Date().getFullYear();
      
      // Import example data
      for (const c of (data.customers || [])) await db.put('customers', c);
      for (const t of (data.types || [])) await db.put('types', t);
      for (const p of (data.parts || [])) await db.put('parts', p);
      for (const t of (data.tests || [])) await db.put('tests', t);
      
      for (const p of (data.projects || [])) {
        // Handle old format (camelCase to snake_case)
        if (p.customerId) p.customer_id = p.customerId;
        if (p.typeId) p.type_id = p.typeId;
        if (p.partId) p.part_id = p.partId;
        if (p.testId) p.test_id = p.testId;
        if (p.createdAt && !p.created_at) p.created_at = p.createdAt;
        if (p.updatedAt && !p.updated_at) p.updated_at = p.updatedAt;
        if (!p.timePerUnit) p.timePerUnit = 15;
        
        // Migrate week keys to year-prefixed format
        this.migrateProjectWeekKeys(p, currentYear);
        
        await db.put('projects', p);
      }
      
      // Reload data after import
      await this.loadData();
      console.log('📦 Example data loaded successfully');
    } catch (error) {
      console.log('Could not load example data:', error);
    }
  }
  
  private async clearAndLoadExampleData(): Promise<void> {
    try {
      // Clear existing data
      for (const store of ['customers', 'types', 'parts', 'tests', 'projects', 'comments']) {
        await db.clear(store);
      }
      
      // Load example data
      const response = await fetch('/example-data.json');
      if (!response.ok) {
        this.showToast('Could not load example data', 'error');
        return;
      }
      
      const data = await response.json();
      const currentYear = new Date().getFullYear();
      
      // Import example data
      for (const c of (data.customers || [])) await db.put('customers', c);
      for (const t of (data.types || [])) await db.put('types', t);
      for (const p of (data.parts || [])) await db.put('parts', p);
      for (const t of (data.tests || [])) await db.put('tests', t);
      
      for (const p of (data.projects || [])) {
        // Handle old format (camelCase to snake_case)
        if (p.customerId) p.customer_id = p.customerId;
        if (p.typeId) p.type_id = p.typeId;
        if (p.partId) p.part_id = p.partId;
        if (p.testId) p.test_id = p.testId;
        if (p.createdAt && !p.created_at) p.created_at = p.createdAt;
        if (p.updatedAt && !p.updated_at) p.updated_at = p.updatedAt;
        if (!p.timePerUnit) p.timePerUnit = 15;
        
        // Migrate week keys to year-prefixed format
        this.migrateProjectWeekKeys(p, currentYear);
        
        await db.put('projects', p);
      }
      
      // Reload data and refresh view
      await this.loadData();
      this.renderCurrentView();
      this.showToast('Example data loaded successfully! 🎉', 'success');
    } catch (error) {
      console.error('Failed to load example data:', error);
      this.showToast('Failed to load example data', 'error');
    }
  }

  private async loadData(): Promise<void> {
    this.state.customers = await db.getAll<Customer>('customers');
    this.state.types = await db.getAll<Type>('types');
    this.state.parts = await db.getAll<Part>('parts');
    this.state.tests = await db.getAll<Test>('tests');
    this.state.projects = await db.getAll<Project>('projects');
    this.state.employees = await db.getAll<Employee>('employees');
    this.state.scheduleEntries = await db.getAll<ScheduleEntry>('scheduleEntries');
    this.comments = await db.getAll<Comment>('comments');
    this.logs = await db.getAll<ActivityLog>('logs');
    
    // Load new schedule data
    this.state.scheduleAssignments = await db.getAll<ScheduleAssignment>('scheduleAssignments');
    this.state.projectComments = await db.getAll<ProjectComment>('projectComments');
    
    // Load extra tasks
    try {
      this.state.extraTasks = await api.getExtraTasks();
    } catch (e) {
      this.state.extraTasks = [];
    }
    
    // Cleanup: usuń duplikaty i osierocone przypisania (po załadowaniu projektów i extra tasks)
    await this.cleanupDuplicateAssignments();
    
    // Sort logs by timestamp descending
    this.logs.sort((a, b) => b.timestamp - a.timestamp);
    
    // Migrate old week keys to year-prefixed format
    await this.migrateAllProjectWeekKeys();
    
    const savedSettings = await db.get<{ key: string; value: AppState['settings'] }>('settings', 'appSettings');
    if (savedSettings) {
      this.state.settings = { ...this.state.settings, ...savedSettings.value };
    }
    
    i18n.setLanguage(this.state.settings.language);
  }

  private async cleanupDuplicateAssignments(): Promise<void> {
    const seen = new Map<string, ScheduleAssignment>();
    const toRemove: string[] = [];
    
    // Zbierz prawidłowe project IDs
    const validProjectIds = new Set<string>();
    this.state.projects.forEach(p => {
      validProjectIds.add(p.id);
      validProjectIds.add(`${p.customer_id}-${p.type_id}`);
    });
    // Extra task project IDs
    this.state.extraTasks.forEach(t => {
      validProjectIds.add(`extra-${t.id}`);
    });
    
    for (const a of this.state.scheduleAssignments) {
      // Usuń przypisania do nieistniejących projektów (osierocone)
      if (!validProjectIds.has(a.projectId)) {
        toRemove.push(a.id);
        continue;
      }
      
      // Klucz unikalności: pracownik + projekt + tydzień + zmiana + scope + test + part
      const key = `${a.employeeId}|${a.projectId}|${a.week}|${a.shift}|${a.scope || ''}|${a.testId || ''}|${a.partId || ''}`;
      if (seen.has(key)) {
        // Duplikat - zachowaj nowsze (wyższe updatedAt/createdAt)
        const existing = seen.get(key)!;
        const existingTime = existing.updatedAt || existing.createdAt || 0;
        const currentTime = a.updatedAt || a.createdAt || 0;
        if (currentTime > existingTime) {
          toRemove.push(existing.id);
          seen.set(key, a);
        } else {
          toRemove.push(a.id);
        }
      } else {
        seen.set(key, a);
      }
    }
    
    if (toRemove.length > 0) {
      console.log(`[Kappa] Cleaning up ${toRemove.length} orphan/duplicate assignment(s)`);
      for (const id of toRemove) {
        const idx = this.state.scheduleAssignments.findIndex((a: ScheduleAssignment) => a.id === id);
        if (idx !== -1) this.state.scheduleAssignments.splice(idx, 1);
        await db.delete('scheduleAssignments', id);
      }
    }
  }

  // Migrate week keys from old format (KW01) to new format (2026-KW01)
  private migrateProjectWeekKeys(project: any, targetYear: number): void {
    if (!project.weeks) return;
    
    const newWeeks: any = {};
    let hasMigrated = false;
    
    for (const [key, value] of Object.entries(project.weeks)) {
      // Check if already in year-prefixed format
      if (key.match(/^\d{4}-KW\d{2}$/)) {
        newWeeks[key] = value;
      } else if (key.match(/^KW\d{2}$/)) {
        // Old format - migrate to year-prefixed
        const newKey = `${targetYear}-${key}`;
        newWeeks[newKey] = value;
        hasMigrated = true;
      } else {
        // Unknown format - keep as is
        newWeeks[key] = value;
      }
    }
    
    if (hasMigrated) {
      project.weeks = newWeeks;
    }
  }
  
  // Migrate all existing projects in database
  private async migrateAllProjectWeekKeys(): Promise<void> {
    const currentYear = new Date().getFullYear();
    let needsSave = false;
    
    for (const project of this.state.projects) {
      const oldWeeksStr = JSON.stringify(project.weeks);
      this.migrateProjectWeekKeys(project, currentYear);
      
      if (JSON.stringify(project.weeks) !== oldWeeksStr) {
        await db.put('projects', project);
        needsSave = true;
      }
    }
    
    if (needsSave) {
      console.log('📦 Migrated project week keys to year-prefixed format');
    }
  }

  private async saveSettings(): Promise<void> {
    await db.put('settings', { key: 'appSettings', value: this.state.settings });
  }

  private applyTheme(): void {
    document.body.classList.toggle('dark-theme', this.state.settings.darkMode);
    // Icons are now handled by CSS (icon-sun / icon-moon visibility)
  }

  private applyZoom(): void {
    const grid = document.getElementById('planningGrid');
    const zoomLevel = document.getElementById('zoomLevel');
    if (grid) {
      const scale = this.state.settings.zoomLevel / 100;
      document.documentElement.style.setProperty('--grid-zoom', scale.toString());
      grid.style.transform = `scale(${scale})`;
      grid.style.transformOrigin = 'top left';
    }
    if (zoomLevel) {
      zoomLevel.textContent = `${this.state.settings.zoomLevel}%`;
    }
  }

  private async addLog(action: ActivityLog['action'], entityType: string, entityName: string, details: string = ''): Promise<void> {
    const log: ActivityLog = {
      id: this.generateId(),
      userId: this.generateId(),
      userName: this.state.settings.userName || 'Anonymous',
      action,
      entityType,
      entityName,
      details,
      timestamp: Date.now(),
    };
    
    await db.put('logs', log);
    this.logs.unshift(log);
  }

  private setupEventListeners(): void {
    // Navigation
    document.querySelectorAll('.nav-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const view = (e.currentTarget as HTMLElement).dataset.view!;
        this.switchView(view);
      });
    });

    // Language selector
    const langSelect = document.getElementById('languageSelect') as HTMLSelectElement;
    if (langSelect) {
      langSelect.value = this.state.settings.language;
      langSelect.addEventListener('change', async (e) => {
        const lang = (e.target as HTMLSelectElement).value as any;
        this.state.settings.language = lang;
        i18n.setLanguage(lang);
        await this.saveSettings();
        this.renderCurrentView();
      });
    }

    // Theme toggle button
    document.getElementById('toggleTheme')?.addEventListener('click', async () => {
      this.state.settings.darkMode = !this.state.settings.darkMode;
      this.applyTheme();
      await this.saveSettings();
      this.renderCharts();
    });

    // Zoom controls
    document.getElementById('zoomIn')?.addEventListener('click', async () => {
      if (this.state.settings.zoomLevel < 150) {
        this.state.settings.zoomLevel += 10;
        this.applyZoom();
        await this.saveSettings();
      }
    });

    document.getElementById('zoomOut')?.addEventListener('click', async () => {
      if (this.state.settings.zoomLevel > 50) {
        this.state.settings.zoomLevel -= 10;
        this.applyZoom();
        await this.saveSettings();
      }
    });

    document.getElementById('zoomReset')?.addEventListener('click', async () => {
      this.state.settings.zoomLevel = 100;
      this.applyZoom();
      await this.saveSettings();
    });

    // Planning view buttons
    document.getElementById('addProject')?.addEventListener('click', () => this.showAddProjectModal());
    document.getElementById('exportData')?.addEventListener('click', () => this.exportData());

    // Toolbar collapse toggle
    document.getElementById('toggleToolbarExpand')?.addEventListener('click', async () => {
      const toolbar = document.getElementById('planningToolbar');
      if (toolbar) {
        toolbar.classList.toggle('collapsed');
        // Save preference to database
        await db.setPreference('toolbarCollapsed', toolbar.classList.contains('collapsed'));
      }
    });

    // Restore toolbar state from database
    db.getPreference('toolbarCollapsed').then(collapsed => {
      if (collapsed === true) {
        document.getElementById('planningToolbar')?.classList.add('collapsed');
      }
    });

    // Sliding Stats Panel - Tab toggle
    document.getElementById('statsPanelTab')?.addEventListener('click', () => {
      const panel = document.getElementById('statsSlidePanel');
      panel?.classList.add('open');
      this.updateStatsPanel();
    });

    // Sliding Stats Panel - Close button
    document.getElementById('statsPanelClose')?.addEventListener('click', () => {
      const panel = document.getElementById('statsSlidePanel');
      panel?.classList.remove('open');
    });

    // Click outside to close panel
    document.addEventListener('click', (e) => {
      const panel = document.getElementById('statsSlidePanel');
      const target = e.target as HTMLElement;
      if (panel?.classList.contains('open') && 
          !panel.contains(target) && 
          !target.closest('#statsPanelTab')) {
        panel.classList.remove('open');
      }
    });

    // Quick action buttons
    document.getElementById('quickAddProject')?.addEventListener('click', () => {
      this.showAddProjectModal();
    });

    document.getElementById('quickExport')?.addEventListener('click', () => {
      this.exportData();
    });

    document.getElementById('quickAnalytics')?.addEventListener('click', () => {
      this.showAnalyticsModal();
    });

    // Projects slide panel (inside Planning)
    document.getElementById('openProjectsPanel')?.addEventListener('click', () => {
      const panel = document.getElementById('projectsSlidePanel');
      if (panel) {
        panel.classList.add('open');
        this.renderProjectsView();
      }
    });
    document.getElementById('projectsPanelClose')?.addEventListener('click', () => {
      const panel = document.getElementById('projectsSlidePanel');
      panel?.classList.remove('open');
    });

    // Admin unlock toggle
    document.getElementById('toggleAdminUnlock')?.addEventListener('click', () => this.toggleAdminUnlock());

    // Projects view buttons
    document.getElementById('addCustomer')?.addEventListener('click', () => this.showAddModal('customer'));
    document.getElementById('addType')?.addEventListener('click', () => this.showAddModal('type'));
    document.getElementById('addPart')?.addEventListener('click', () => this.showAddModal('part'));
    document.getElementById('addTest')?.addEventListener('click', () => this.showAddModal('test'));

    // Settings toggles
    document.getElementById('darkModeToggle')?.addEventListener('change', async (e) => {
      this.state.settings.darkMode = (e.target as HTMLInputElement).checked;
      this.applyTheme();
      await this.saveSettings();
    });

    document.getElementById('animationsToggle')?.addEventListener('change', async (e) => {
      this.state.settings.animations = (e.target as HTMLInputElement).checked;
      await this.saveSettings();
    });

    document.getElementById('highlightMissingToggle')?.addEventListener('change', async (e) => {
      this.state.settings.highlightMissing = (e.target as HTMLInputElement).checked;
      await this.saveSettings();
      this.renderPlanningGrid();
    });

    document.getElementById('blinkAlertsToggle')?.addEventListener('change', async (e) => {
      this.state.settings.blinkAlerts = (e.target as HTMLInputElement).checked;
      await this.saveSettings();
      this.renderPlanningGrid();
    });

    document.getElementById('clearAllData')?.addEventListener('click', () => this.clearAllData());
    
    // ==================== Backup & Import Settings ====================
    document.getElementById('createBackupBtn')?.addEventListener('click', () => this.createManualBackup());
    document.getElementById('importFullBackupBtn')?.addEventListener('click', () => this.importFullBackup());
    document.getElementById('exportFullDatabaseBtn')?.addEventListener('click', () => this.exportFullDatabase());

    // Module import buttons
    document.getElementById('importModulePlanning')?.addEventListener('click', () => this.importModuleFromFile('planning'));
    document.getElementById('importModuleEmployees')?.addEventListener('click', () => this.importModuleFromFile('employees'));
    document.getElementById('importModuleSchedule')?.addEventListener('click', () => this.importModuleFromFile('schedule'));
    document.getElementById('importModuleAbsences')?.addEventListener('click', () => this.importModuleFromFile('absences'));
    // Individual table import buttons
    document.getElementById('importModuleCustomers')?.addEventListener('click', () => this.importModuleFromFile('customers'));
    document.getElementById('importModuleTypes')?.addEventListener('click', () => this.importModuleFromFile('types'));
    document.getElementById('importModuleParts')?.addEventListener('click', () => this.importModuleFromFile('parts'));
    document.getElementById('importModuleTests')?.addEventListener('click', () => this.importModuleFromFile('tests'));
    document.getElementById('importModuleProjects')?.addEventListener('click', () => this.importModuleFromFile('projects'));

    // Module export buttons
    document.getElementById('exportModulePlanning')?.addEventListener('click', () => this.exportModuleToFile('planning'));
    document.getElementById('exportModuleEmployees')?.addEventListener('click', () => this.exportModuleToFile('employees'));
    document.getElementById('exportModuleSchedule')?.addEventListener('click', () => this.exportModuleToFile('schedule'));
    document.getElementById('exportModuleAbsences')?.addEventListener('click', () => this.exportModuleToFile('absences'));
    // Individual table export buttons
    document.getElementById('exportModuleCustomers')?.addEventListener('click', () => this.exportModuleToFile('customers'));
    document.getElementById('exportModuleTypes')?.addEventListener('click', () => this.exportModuleToFile('types'));
    document.getElementById('exportModuleParts')?.addEventListener('click', () => this.exportModuleToFile('parts'));
    document.getElementById('exportModuleTests')?.addEventListener('click', () => this.exportModuleToFile('tests'));
    document.getElementById('exportModuleProjects')?.addEventListener('click', () => this.exportModuleToFile('projects'));

    // Local database file download/upload
    document.getElementById('downloadDbBtn')?.addEventListener('click', () => this.downloadDatabaseFile());
    document.getElementById('uploadDbBtn')?.addEventListener('click', () => {
      const fileInput = document.getElementById('uploadDbFileInput') as HTMLInputElement;
      if (fileInput) fileInput.click();
    });
    document.getElementById('uploadDbFileInput')?.addEventListener('change', (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) this.uploadDatabaseFile(file);
      (e.target as HTMLInputElement).value = '';
    });

    // Backup path input
    document.getElementById('backupPathInput')?.addEventListener('change', async (e) => {
      this.state.settings.backupPath = (e.target as HTMLInputElement).value;
      await this.saveSettings();
      this.loadBackupList();
    });

    // Backup frequency
    document.getElementById('backupFrequency')?.addEventListener('change', async (e) => {
      this.state.settings.backupFrequency = (e.target as HTMLSelectElement).value as any;
      await this.saveSettings();
    });

    // File inputs for import
    document.getElementById('settingsImportFileInput')?.addEventListener('change', (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) this.handleFullImportFile(file);
      (e.target as HTMLInputElement).value = '';
    });
    document.getElementById('settingsModuleImportFileInput')?.addEventListener('change', (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) this.handleModuleImportFile(file);
      (e.target as HTMLInputElement).value = '';
    });

    // Load example data
    document.getElementById('loadExampleData')?.addEventListener('click', async () => {
      if (this.state.projects.length > 0) {
        if (!confirm('This will replace all existing data with example data. Continue?')) return;
      }
      await this.clearAndLoadExampleData();
    });

    // Password setting
    document.getElementById('setPasswordBtn')?.addEventListener('click', () => this.showPasswordModal());

    // Schedule view buttons
    document.getElementById('manageEmployees')?.addEventListener('click', () => this.showManageEmployeesModal());
    document.getElementById('scheduleYear')?.addEventListener('change', () => this.renderScheduleView());
    document.getElementById('scheduleFilterCustomer')?.addEventListener('change', () => this.renderScheduleView());
    document.getElementById('scheduleFilterTest')?.addEventListener('change', () => this.renderScheduleView());
    document.getElementById('scheduleWeekFrom')?.addEventListener('change', () => this.renderScheduleView());
    document.getElementById('scheduleWeekTo')?.addEventListener('change', () => this.renderScheduleView());

    // User name setting
    document.getElementById('userNameInput')?.addEventListener('change', async (e) => {
      this.state.settings.userName = (e.target as HTMLInputElement).value;
      await this.saveSettings();
      this.showToast(i18n.t('messages.savedSuccessfully'), 'success');
    });

    // Logs view buttons
    document.getElementById('exportLogs')?.addEventListener('click', () => this.exportLogs());
    document.getElementById('clearLogs')?.addEventListener('click', () => this.clearLogs());
    document.getElementById('openLogsView')?.addEventListener('click', () => this.switchView('logs'));
    document.getElementById('backToSettings')?.addEventListener('click', () => this.switchView('settings'));

    // Modal close
    document.querySelector('.modal-close')?.addEventListener('click', () => this.hideModal());
    document.querySelector('.modal-cancel')?.addEventListener('click', () => this.hideModal());

    // Filters
    document.getElementById('filterYear')?.addEventListener('change', (e) => {
      this.state.selectedYear = parseInt((e.target as HTMLSelectElement).value);
      this.renderPlanningGrid();
      // Sync analytics year filter if visible
      const analyticsYearFilter = document.getElementById('analyticsFilterYear') as HTMLSelectElement;
      if (analyticsYearFilter) {
        analyticsYearFilter.value = this.state.selectedYear.toString();
      }
      // Reset week filters if in analytics view
      if (this.state.currentView === 'analytics') {
        this.resetWeekFiltersForYear();
        this.renderAnalyticsView();
      }
    });
    document.getElementById('filterCustomer')?.addEventListener('change', () => this.renderPlanningGrid());
    document.getElementById('filterType')?.addEventListener('change', () => this.renderPlanningGrid());
    document.getElementById('filterTest')?.addEventListener('change', () => this.renderPlanningGrid());
    document.getElementById('searchInput')?.addEventListener('input', () => this.renderPlanningGrid());

    // Prevent context menu on grid
    document.getElementById('planningGrid')?.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });
    
    // Keyboard shortcuts for grid navigation
    document.addEventListener('keydown', (e) => this.handleKeyboardNavigation(e));
  }
  
  // Toggle project pin status
  private async togglePin(projectId: string): Promise<void> {
    if (this.pinnedProjects.has(projectId)) {
      this.pinnedProjects.delete(projectId);
    } else {
      this.pinnedProjects.add(projectId);
    }
    // Save pinned projects to database
    await db.setPreference('pinnedProjects', [...this.pinnedProjects]);
    this.renderPlanningGrid();
  }
  
  // Load pinned projects from database
  private async loadPinnedProjects(): Promise<void> {
    try {
      const saved = await db.getPreference('pinnedProjects');
      if (saved && Array.isArray(saved)) {
        this.pinnedProjects = new Set(saved);
      }
    } catch (e) {
      console.warn('Failed to load pinned projects:', e);
    }
  }
  
  // Keyboard navigation handler
  private handleKeyboardNavigation(e: KeyboardEvent): void {
    if (this.state.currentView !== 'planning') return;
    
    // Check if we're in an input field
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
      if (e.key === 'Escape') {
        target.blur();
        return;
      }
      if (e.key === 'Enter' && target.classList.contains('cell-input')) {
        // Move to next cell
        const cell = target.closest('.grid-cell') as HTMLElement;
        if (cell) {
          const projectId = cell.dataset.projectId;
          const week = parseInt(cell.dataset.week || '0');
          const type = cell.dataset.type as 'ist' | 'soll';
          
          if (projectId && week) {
            // Move to next week or next project
            if (type === 'ist') {
              // Move to SOLL of same week
              this.focusCell(projectId, week, 'soll');
            } else {
              // Move to IST of next week
              if (week < 52) {
                this.focusCell(projectId, week + 1, 'ist');
              }
            }
          }
        }
        return;
      }
      return;
    }
    
    // Global shortcuts
    if (e.key === 'Escape') {
      this.activeCell = null;
      document.querySelectorAll('.grid-cell.focused').forEach(c => c.classList.remove('focused'));
      this.hideModal();
    }
    
    // Arrow navigation when activeCell is set
    if (this.activeCell && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      const projects = this.getFilteredProjects();
      const currentIdx = projects.findIndex(p => p.id === this.activeCell!.projectId);
      
      if (currentIdx === -1) return;
      
      let newProjectIdx = currentIdx;
      let newWeek = this.activeCell.week;
      let newType = this.activeCell.type;
      
      switch (e.key) {
        case 'ArrowUp':
          newProjectIdx = Math.max(0, currentIdx - 1);
          break;
        case 'ArrowDown':
          newProjectIdx = Math.min(projects.length - 1, currentIdx + 1);
          break;
        case 'ArrowLeft':
          if (newType === 'soll') {
            newType = 'ist';
          } else if (newWeek > 1) {
            newWeek--;
            newType = 'soll';
          }
          break;
        case 'ArrowRight':
          if (newType === 'ist') {
            newType = 'soll';
          } else if (newWeek < 52) {
            newWeek++;
            newType = 'ist';
          }
          break;
      }
      
      const newProjectId = projects[newProjectIdx].id;
      this.focusCell(newProjectId, newWeek, newType);
    }
  }
  
  // Focus a specific cell
  private focusCell(projectId: string, week: number, type: 'ist' | 'soll'): void {
    // Remove old focus
    document.querySelectorAll('.grid-cell.focused').forEach(c => c.classList.remove('focused'));
    
    // Find and focus new cell
    const selector = `.grid-cell[data-project-id="${projectId}"][data-week="${week}"][data-type="${type}"]`;
    const cell = document.querySelector(selector) as HTMLElement;
    
    if (cell) {
      cell.classList.add('focused');
      cell.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      
      // Focus the input if exists
      const input = cell.querySelector('input') as HTMLInputElement;
      if (input) {
        input.focus();
        input.select();
      }
      
      this.activeCell = { projectId, week, type };
    }
  }
  
  // Setup row hover highlighting
  private setupRowHover(container: HTMLElement): void {
    let currentHoveredProjectId: string | null = null;
    
    container.addEventListener('mouseover', (e) => {
      const target = e.target as HTMLElement;
      const cell = target.closest('.grid-cell[data-project-id]') as HTMLElement;
      
      if (!cell) {
        // Mouse left all cells - clear hover
        if (currentHoveredProjectId) {
          container.querySelectorAll('.grid-cell.row-hover').forEach(c => c.classList.remove('row-hover'));
          currentHoveredProjectId = null;
        }
        return;
      }
      
      const projectId = cell.getAttribute('data-project-id');
      
      if (projectId && projectId !== currentHoveredProjectId) {
        // Clear previous hover
        container.querySelectorAll('.grid-cell.row-hover').forEach(c => c.classList.remove('row-hover'));
        
        // Add hover to all cells in this row
        container.querySelectorAll(`.grid-cell[data-project-id="${projectId}"]`).forEach(c => {
          c.classList.add('row-hover');
        });
        
        currentHoveredProjectId = projectId;
      }
    });
    
    container.addEventListener('mouseleave', () => {
      container.querySelectorAll('.grid-cell.row-hover').forEach(c => c.classList.remove('row-hover'));
      currentHoveredProjectId = null;
    });
  }
  
  // Create mini sparkline SVG showing IST vs SOLL trend
  private createMiniSparkline(project: Project): SVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'mini-sparkline');
    svg.setAttribute('viewBox', '0 0 80 20');
    svg.setAttribute('preserveAspectRatio', 'none');
    
    // Get current week
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const days = Math.floor((now.getTime() - startOfYear.getTime()) / (24 * 60 * 60 * 1000));
    const currentWeek = Math.ceil((days + startOfYear.getDay() + 1) / 7);
    
    // Collect last 12 weeks data for better trend visibility
    const weeksToShow = 12;
    const startWeek = Math.max(1, currentWeek - weeksToShow + 1);
    const endWeek = currentWeek;
    
    const istData: number[] = [];
    const sollData: number[] = [];
    let maxVal = 1;
    
    for (let w = startWeek; w <= endWeek; w++) {
      const wKey = `KW${w.toString().padStart(2, '0')}`;
      const data = this.getWeekData(project, wKey);
      istData.push(data.ist);
      sollData.push(data.soll);
      maxVal = Math.max(maxVal, data.ist, data.soll);
    }
    
    if (istData.length === 0 || maxVal === 0) {
      // Empty sparkline
      return svg;
    }
    
    const width = 80;
    const height = 18;
    const padding = 2;
    const chartHeight = height - padding * 2;
    const chartWidth = width - padding * 2;
    const pointSpacing = chartWidth / Math.max(1, istData.length - 1);
    
    // Create filled area under SOLL line (subtle background)
    const sollAreaPoints = sollData.map((val, i) => {
      const x = padding + i * pointSpacing;
      const y = padding + chartHeight - (val / maxVal) * chartHeight;
      return `${x},${y}`;
    });
    const sollArea = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    sollArea.setAttribute('points', `${padding},${height - padding} ${sollAreaPoints.join(' ')} ${padding + (sollData.length - 1) * pointSpacing},${height - padding}`);
    sollArea.setAttribute('fill', 'rgba(148, 163, 184, 0.15)');
    svg.appendChild(sollArea);
    
    // Create SOLL line (background, lighter)
    const sollLine = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    sollLine.setAttribute('points', sollAreaPoints.join(' '));
    sollLine.setAttribute('fill', 'none');
    sollLine.setAttribute('stroke', 'var(--color-text-muted)');
    sollLine.setAttribute('stroke-width', '1');
    sollLine.setAttribute('stroke-dasharray', '2,1');
    svg.appendChild(sollLine);
    
    // Create filled area under IST line
    const istAreaPoints = istData.map((val, i) => {
      const x = padding + i * pointSpacing;
      const y = padding + chartHeight - (val / maxVal) * chartHeight;
      return `${x},${y}`;
    });
    const istArea = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    istArea.setAttribute('points', `${padding},${height - padding} ${istAreaPoints.join(' ')} ${padding + (istData.length - 1) * pointSpacing},${height - padding}`);
    istArea.setAttribute('fill', 'rgba(0, 151, 172, 0.2)');
    svg.appendChild(istArea);
    
    // Create IST line (foreground)
    const istLine = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    istLine.setAttribute('points', istAreaPoints.join(' '));
    istLine.setAttribute('fill', 'none');
    istLine.setAttribute('stroke', 'var(--color-primary)');
    istLine.setAttribute('stroke-width', '1.5');
    istLine.setAttribute('stroke-linecap', 'round');
    istLine.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(istLine);
    
    // Add a dot at the end of IST line
    if (istData.length > 0) {
      const lastX = padding + (istData.length - 1) * pointSpacing;
      const lastY = padding + chartHeight - (istData[istData.length - 1] / maxVal) * chartHeight;
      
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('cx', lastX.toString());
      dot.setAttribute('cy', lastY.toString());
      dot.setAttribute('r', '2');
      dot.setAttribute('fill', 'var(--color-primary)');
      svg.appendChild(dot);
    }
    
    // Title for tooltip
    const totalIst = istData.reduce((a, b) => a + b, 0);
    const totalSoll = sollData.reduce((a, b) => a + b, 0);
    svg.innerHTML = `<title>Ostatnie ${weeksToShow} tyg.: IST ${totalIst} / SOLL ${totalSoll}</title>` + svg.innerHTML;
    
    return svg;
  }

  private switchView(view: string): void {
    this.state.currentView = view;
    
    document.querySelectorAll('.nav-btn').forEach((btn) => {
      btn.classList.remove('active');
    });
    document.querySelector(`[data-view="${view}"]`)?.classList.add('active');
    
    document.querySelectorAll('.view').forEach((v) => {
      v.classList.remove('active');
    });
    document.getElementById(`${view}View`)?.classList.add('active');
    
    this.renderCurrentView();
  }

  private renderCurrentView(): void {
    switch (this.state.currentView) {
      case 'planning':
        this.renderPlanningGrid();
        if (this.adminUnlocked) {
          this.renderProjectsView();
        }
        break;
      case 'projects':
        this.renderPlanningGrid();
        if (this.adminUnlocked) {
          this.renderProjectsView();
        }
        break;
      case 'analytics':
        this.renderAnalyticsView();
        break;
      case 'schedule':
        this.renderScheduleView();
        break;
      case 'absences':
        this.renderAbsencesView();
        break;
      case 'logs':
        this.renderLogsView();
        break;
      case 'settings':
        this.renderSettingsView();
        break;
    }
  }

  private getCurrentWeek(): number {
    const now = new Date();
    // ISO 8601 week calculation
    const target = new Date(now.valueOf());
    // Set to nearest Thursday: current date + 4 - current day number (Monday=1, Sunday=7)
    const dayNum = target.getDay() || 7; // Convert Sunday from 0 to 7
    target.setDate(target.getDate() + 4 - dayNum);
    // Get first day of year
    const yearStart = new Date(target.getFullYear(), 0, 1);
    // Calculate full weeks to nearest Thursday
    const weekNo = Math.ceil((((target.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return weekNo;
  }

  // ==================== Focus/Advanced Mode ====================
  private async togglePlanningMode(): Promise<void> {
    const planningView = document.getElementById('planningView');
    const modeLabel = document.getElementById('modeLabelText');
    
    if (planningView && modeLabel) {
      const isAdvanced = planningView.classList.toggle('advanced-mode');
      modeLabel.textContent = isAdvanced ? 'Advanced' : 'Focus';
      
      // Save preference
      await db.setPreference('planningAdvancedMode', isAdvanced);
      
      // Update stats panel if in advanced mode
      if (isAdvanced) {
        this.updateStatsPanel();
      }
    }
  }

  private updateStatsPanel(): void {
    const currentWeek = this.getCurrentWeek();
    const currentYear = this.state.selectedYear;
    const currentWeekKey = `${currentYear}-KW${String(currentWeek).padStart(2, '0')}`;
    
    // Projects stats - only Kappa related
    const totalProjects = this.state.projects.length;
    
    let totalIst = 0;
    let totalSoll = 0;
    let completedProjects = 0;
    let delayedProjects = 0;
    let activeProjects = 0;
    
    this.state.projects.forEach(p => {
      const weekData = p.weeks?.[currentWeekKey];
      if (weekData) {
        totalIst += weekData.ist || 0;
        totalSoll += weekData.soll || 0;
        
        if (weekData.soll > 0) {
          activeProjects++;
          if (weekData.ist >= weekData.soll) {
            completedProjects++;
          } else if (weekData.ist < weekData.soll * 0.5) {
            delayedProjects++;
          }
        }
      }
    });

    const progressPercent = totalSoll > 0 ? Math.round((totalIst / totalSoll) * 100) : 0;

    // Update stats cards
    const statTotal = document.getElementById('statTotalProjects');
    const statActive = document.getElementById('statActiveProjects');
    const statCompleted = document.getElementById('statCompletedProjects');
    const statDelayed = document.getElementById('statDelayedProjects');
    
    if (statTotal) statTotal.textContent = String(totalProjects);
    if (statActive) statActive.textContent = String(activeProjects);
    if (statCompleted) statCompleted.textContent = String(completedProjects);
    if (statDelayed) statDelayed.textContent = String(delayedProjects);
    
    // Update week/year info
    const currentWeekNum = document.getElementById('currentWeekNum');
    const currentYearNum = document.getElementById('currentYearNum');
    if (currentWeekNum) currentWeekNum.textContent = String(currentWeek);
    if (currentYearNum) currentYearNum.textContent = String(currentYear);
    
    // Update IST/SOLL progress
    const weeklyIst = document.getElementById('weeklyIstDone');
    const weeklySoll = document.getElementById('weeklySollTotal');
    const weeklyProgress = document.getElementById('weeklyProgressBar');
    const weeklyPercent = document.getElementById('weeklyProgressPercent');
    
    if (weeklyIst) weeklyIst.textContent = String(totalIst);
    if (weeklySoll) weeklySoll.textContent = String(totalSoll);
    if (weeklyProgress) weeklyProgress.style.width = `${Math.min(progressPercent, 100)}%`;
    if (weeklyPercent) weeklyPercent.textContent = `${progressPercent}%`;

    // Update alerts - only Kappa related
    const alertsList = document.getElementById('alertsList');
    if (alertsList) {
      let alertsHtml = '';
      if (delayedProjects > 0) {
        alertsHtml += `<div class="alert-item alert-danger">
          <span class="alert-icon">🔴</span>
          <span class="alert-text">${i18n.t('planning.belowRealization').replace('{0}', String(delayedProjects))}</span>
        </div>`;
      }
      const noSollProjects = this.state.projects.filter(p => {
        const weekData = p.weeks?.[currentWeekKey];
        return !weekData || !weekData.soll;
      }).length;
      if (noSollProjects > 0) {
        alertsHtml += `<div class="alert-item alert-warning">
          <span class="alert-icon">⚠️</span>
          <span class="alert-text">${noSollProjects} bez planu SOLL</span>
        </div>`;
      }
      if (!alertsHtml) {
        alertsHtml = `<div class="alert-item alert-success">
          <span class="alert-icon">✅</span>
          <span class="alert-text">${i18n.t('schedule.allOk')}</span>
        </div>`;
      }
      alertsList.innerHTML = alertsHtml;
    }

    // Update priority list (top projects behind schedule)
    const priorityList = document.getElementById('priorityList');
    if (priorityList) {
      const topProjects = this.getTopPriorityProjects();
      if (topProjects.length > 0) {
        const priorityHtml = topProjects.map((p, idx) => {
          const customer = this.state.customers.find(c => c.id === p.customer_id);
          const test = this.state.tests.find(t => t.id === p.test_id);
          const weekData = p.weeks?.[currentWeekKey];
          const percent = weekData && weekData.soll > 0 
            ? Math.round((weekData.ist / weekData.soll) * 100) 
            : 0;
          return `<div class="priority-item" data-project-id="${p.id}">
            <span class="priority-badge p${idx + 1}">${idx + 1}</span>
            <span class="priority-name">${customer?.name || 'N/A'}</span>
            <span class="priority-percent">${percent}%</span>
          </div>`;
        }).join('');
        priorityList.innerHTML = priorityHtml;
        
        // Add click handlers
        priorityList.querySelectorAll('.priority-item').forEach(item => {
          item.addEventListener('click', () => {
            const projectId = item.getAttribute('data-project-id');
            if (projectId) this.highlightProject(projectId);
          });
        });
      } else {
        priorityList.innerHTML = `<div class="priority-empty">${i18n.t('planning.noProjectsToShow')}</div>`;
      }
    }
  }

  private showAnalyticsModal(): void {
    // Switch to analytics view
    this.switchView('analytics');
  }

  private getTopPriorityProjects(): Project[] {
    const currentWeekKey = `${this.state.selectedYear}-KW${String(this.getCurrentWeek()).padStart(2, '0')}`;
    
    // Sort by how behind they are (lowest IST/SOLL ratio first)
    return [...this.state.projects]
      .filter(p => {
        const weekData = p.weeks?.[currentWeekKey];
        return weekData && weekData.soll > 0 && weekData.ist < weekData.soll;
      })
      .sort((a, b) => {
        const aWeek = a.weeks?.[currentWeekKey];
        const bWeek = b.weeks?.[currentWeekKey];
        const aRatio = aWeek ? (aWeek.ist / aWeek.soll) : 1;
        const bRatio = bWeek ? (bWeek.ist / bWeek.soll) : 1;
        return aRatio - bRatio;
      })
      .slice(0, 5);
  }

  private highlightProject(projectId: string): void {
    // Scroll to project and highlight it
    const projectRow = document.querySelector(`[data-project-id="${projectId}"]`);
    if (projectRow) {
      projectRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
      projectRow.classList.add('highlighted');
      setTimeout(() => projectRow.classList.remove('highlighted'), 2000);
    }
  }

  private renderPlanningGrid(): void {
    const container = document.getElementById('planningGrid');
    const headerContainer = document.getElementById('planningGridHeader');
    if (!container || !headerContainer) return;

    // Initialize year selector
    this.initYearSelector();

    const filteredProjects = this.getFilteredProjects();
    const currentWeek = this.getCurrentWeek();
    const currentYear = new Date().getFullYear();
    
    container.innerHTML = '';
    headerContainer.innerHTML = '';

    // Calculate column count: 6 fixed + 104 week columns (52 weeks × 2)
    const totalWeekCols = 52 * 2;
    const gridColumns = `150px 100px 120px 150px 70px 80px repeat(${totalWeekCols}, minmax(45px, 1fr))`;
    container.style.gridTemplateColumns = gridColumns;
    headerContainer.style.gridTemplateColumns = gridColumns;

    // Fixed headers with data-col attribute for sticky positioning
    const sortableColumns = ['customer', 'type', 'part', 'test', 'time'];
    const fixedHeaders = [
      { text: i18n.t('planning.kunde'), col: 'customer', icon: null, sortable: true },
      { text: i18n.t('planning.typ'), col: 'type', icon: null, sortable: true },
      { text: i18n.t('planning.teil'), col: 'part', icon: null, sortable: true },
      { text: i18n.t('planning.prufung'), col: 'test', icon: null, sortable: true },
      { text: '', col: 'time', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>', sortable: true },
      { text: '', col: 'actions', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>', sortable: false }
    ];
    fixedHeaders.forEach((item) => {
      const header = document.createElement('div');
      header.className = `grid-header fixed-header col-${item.col}${item.sortable ? ' sortable' : ''}${this.sortColumn === item.col ? ' sorted' : ''}`;
      
      if (item.icon) {
        header.innerHTML = item.icon;
        header.style.display = 'flex';
        header.style.alignItems = 'center';
        header.style.justifyContent = 'center';
      } else {
        // Add sort indicator for text headers
        const sortIcon = this.sortColumn === item.col 
          ? (this.sortDirection === 'asc' 
            ? '<svg class="sort-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><polyline points="18 15 12 9 6 15"/></svg>'
            : '<svg class="sort-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><polyline points="6 9 12 15 18 9"/></svg>')
          : '';
        header.innerHTML = `<span>${item.text}</span>${sortIcon}`;
      }
      
      // Add click handler for sortable columns
      if (item.sortable && sortableColumns.includes(item.col)) {
        header.style.cursor = 'pointer';
        header.addEventListener('click', () => this.toggleSort(item.col as 'customer' | 'type' | 'part' | 'test' | 'time'));
      }
      
      headerContainer.appendChild(header);
    });

    // Week headers
    for (let week = 1; week <= 52; week++) {
      const kwNum = `KW${week.toString().padStart(2, '0')}`;
      const isCurrentWeek = week === currentWeek && this.state.selectedYear === currentYear;
      
      // IST header
      const istHeader = document.createElement('div');
      istHeader.className = `grid-header week-header ${isCurrentWeek ? 'current-week' : ''}`;
      istHeader.innerHTML = `<div class="kw-num">${kwNum}</div><div class="ist-soll">IST</div>`;
      headerContainer.appendChild(istHeader);
      
      // SOLL header
      const sollHeader = document.createElement('div');
      sollHeader.className = `grid-header week-header ${isCurrentWeek ? 'current-week' : ''}`;
      sollHeader.innerHTML = `<div class="kw-num">${kwNum}</div><div class="ist-soll">SOLL</div>`;
      headerContainer.appendChild(sollHeader);
    }

    // Project rows
    filteredProjects.forEach((project, rowIndex) => {
      const customer = this.state.customers.find((c) => c.id === project.customer_id);
      const type = this.state.types.find((t) => t.id === project.type_id);
      const part = this.state.parts.find((p) => p.id === project.part_id);
      const test = this.state.tests.find((t) => t.id === project.test_id);
      const isPinned = this.pinnedProjects.has(project.id);

      // Calculate project progress
      let totalIst = 0, totalSoll = 0;
      for (let w = 1; w <= 52; w++) {
        const wKey = `KW${w.toString().padStart(2, '0')}`;
        const data = this.getWeekData(project, wKey);
        totalIst += data.ist;
        totalSoll += data.soll;
      }
      const progressPercent = totalSoll > 0 ? Math.round((totalIst / totalSoll) * 100) : 0;

      // Fixed cells with proper column classes
      const testColor = test?.color || TEST_COLORS[0];
      const colNames = ['customer', 'type', 'part', 'test'];
      const values = [customer?.name, type?.name, part?.name, test?.name];
      
      values.forEach((value, cellIdx) => {
        const cell = document.createElement('div');
        cell.className = `grid-cell fixed-cell col-${colNames[cellIdx]}`;
        cell.setAttribute('data-project-id', project.id);
        cell.setAttribute('data-row-index', rowIndex.toString());
        
        // Get tag color for this item
        const itemId = cellIdx === 0 ? project.customer_id : 
                       cellIdx === 1 ? project.type_id : 
                       cellIdx === 2 ? project.part_id : project.test_id;
        const tagColor = this.itemTags.get(itemId);
        
        if (colNames[cellIdx] === 'customer') {
          // First column: add pin button, color badge and progress bar
          const wrapper = document.createElement('div');
          wrapper.className = 'cell-with-pin';
          
          const pinBtn = document.createElement('button');
          pinBtn.className = `btn-pin ${isPinned ? 'pinned' : ''}`;
          pinBtn.title = isPinned ? i18n.t('schedule.unpin') : i18n.t('schedule.pinToTop');
          pinBtn.innerHTML = isPinned 
            ? '<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>'
            : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>';
          pinBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.togglePin(project.id);
          });
          wrapper.appendChild(pinBtn);
          
          // Color badge if has tag
          if (tagColor) {
            const colorBadge = document.createElement('span');
            colorBadge.className = 'cell-color-badge';
            colorBadge.style.backgroundColor = tagColor;
            wrapper.appendChild(colorBadge);
          }
          
          const textSpan = document.createElement('span');
          textSpan.className = 'cell-text';
          textSpan.textContent = value || '-';
          wrapper.appendChild(textSpan);
          
          // Progress bar
          const progressBar = document.createElement('div');
          progressBar.className = 'row-progress';
          progressBar.title = i18n.t('planning.progressTooltip').replace('{0}', String(progressPercent)).replace('{1}', String(totalIst)).replace('{2}', String(totalSoll));
          const progressFill = document.createElement('div');
          progressFill.className = 'row-progress-fill';
          progressFill.style.width = `${Math.min(progressPercent, 100)}%`;
          if (progressPercent >= 100) progressFill.classList.add('complete');
          else if (progressPercent >= 75) progressFill.classList.add('good');
          else if (progressPercent >= 50) progressFill.classList.add('medium');
          progressBar.appendChild(progressFill);
          wrapper.appendChild(progressBar);
          
          cell.appendChild(wrapper);
        } else if (colNames[cellIdx] === 'test' && test) {
          // Create wrapper with badge and sparkline
          const wrapper = document.createElement('div');
          wrapper.className = 'test-cell-wrapper';
          
          // Colored badge for test
          const badge = document.createElement('span');
          badge.className = 'test-badge';
          badge.style.backgroundColor = testColor;
          badge.textContent = value || '-';
          wrapper.appendChild(badge);
          
          // Mini sparkline - last 12 weeks IST vs SOLL trend
          const sparkline = this.createMiniSparkline(project);
          wrapper.appendChild(sparkline);
          
          cell.appendChild(wrapper);
        } else if (colNames[cellIdx] === 'type' || colNames[cellIdx] === 'part') {
          // Type and Part columns with optional color badge
          const wrapper = document.createElement('div');
          wrapper.className = 'cell-with-badge';
          
          if (tagColor) {
            const colorBadge = document.createElement('span');
            colorBadge.className = 'cell-color-badge';
            colorBadge.style.backgroundColor = tagColor;
            wrapper.appendChild(colorBadge);
          }
          
          const textSpan = document.createElement('span');
          textSpan.className = 'cell-text';
          textSpan.textContent = value || '-';
          wrapper.appendChild(textSpan);
          
          cell.appendChild(wrapper);
        } else {
          cell.textContent = value || '-';
        }
        cell.title = value || '';
        container.appendChild(cell);
      });

      // Time per test cell (editable)
      const timeCell = document.createElement('div');
      timeCell.className = 'grid-cell fixed-cell col-time time-cell';
      timeCell.innerHTML = `<span class="time-value">${project.timePerUnit || 0}</span><span class="time-unit">min</span>`;
      timeCell.title = i18n.t('planning.clickToSetTime');
      timeCell.style.cursor = 'pointer';
      timeCell.addEventListener('click', () => this.showTimeEditPopup(project, timeCell));
      container.appendChild(timeCell);

      // Actions cell with fill down button
      const actionsCell = document.createElement('div');
      actionsCell.className = 'grid-cell actions-cell col-actions';
      actionsCell.innerHTML = `
        <button class="btn-icon btn-fill-down" title="${i18n.t('planning.fillDown')}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <polyline points="19 12 12 19 5 12"/>
          </svg>
        </button>
        <button class="btn-icon" title="Bulk Fill">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <line x1="3" y1="9" x2="21" y2="9"/>
            <line x1="9" y1="21" x2="9" y2="9"/>
          </svg>
        </button>
        <button class="btn-icon btn-del" title="${i18n.t('common.delete')}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>
      `;
      actionsCell.querySelector('.btn-fill-down')?.addEventListener('click', () => this.showFillDownModal(project));
      actionsCell.querySelector('.btn-icon:nth-child(2)')?.addEventListener('click', () => this.showBulkFillModal(project));
      actionsCell.querySelector('.btn-del')?.addEventListener('click', () => this.deleteProject(project.id));
      container.appendChild(actionsCell);

      // Week cells - use year-specific week keys ONLY (no fallback to old format)
      for (let week = 1; week <= 52; week++) {
        const kwNum = `KW${week.toString().padStart(2, '0')}`;
        const yearWeekKey = `${this.state.selectedYear}-${kwNum}`;
        const weekData = project.weeks[yearWeekKey] || { ist: 0, soll: 0 };
        const isCurrentWeek = week === currentWeek && this.state.selectedYear === currentYear;
        const comment = this.comments.find(c => c.projectId === project.id && (c.week === yearWeekKey || c.week === kwNum));

        // IST cell
        const istCell = this.createWeekCell(project, yearWeekKey, 'ist', weekData.ist, weekData.soll, isCurrentWeek, comment || null, weekData);
        container.appendChild(istCell);

        // SOLL cell
        const sollCell = this.createWeekCell(project, yearWeekKey, 'soll', weekData.soll, weekData.soll, isCurrentWeek, null, weekData);
        container.appendChild(sollCell);
      }
    });

    // ==================== EXTRA TASKS IN PLANNER ====================
    this.renderExtraTasksInPlanner(container, headerContainer, currentWeek, currentYear);

    this.updateFilterOptions();
    
    // Add row hover effect
    this.setupRowHover(container);
    
    // Sync scroll between header and body
    const gridContainer = container.parentElement;
    if (gridContainer && headerContainer) {
      gridContainer.addEventListener('scroll', () => {
        headerContainer.scrollLeft = gridContainer.scrollLeft;
      });
    }
    
    // Scroll to current week only if viewing current year and not skipping scroll
    if (this.state.selectedYear === currentYear && !this.skipNextScroll) {
      setTimeout(() => {
        const currentWeekCell = container.querySelector('.week-cell.current-week');
        if (currentWeekCell && gridContainer) {
          const cellRect = currentWeekCell.getBoundingClientRect();
          const containerRect = gridContainer.getBoundingClientRect();
          const scrollLeft = cellRect.left - containerRect.left + gridContainer.scrollLeft - containerRect.width / 2;
          gridContainer.scrollLeft = scrollLeft;
        }
      }, 100);
    }
    // Reset skip flag
    this.skipNextScroll = false;
  }

  // ==================== EXTRA TASKS IN PLANNER ====================
  private renderExtraTasksInPlanner(
    container: HTMLElement, 
    headerContainer: HTMLElement,
    currentWeek: number, 
    currentYear: number
  ): void {
    // Pobierz dodatkowe zadania dla wybranego roku
    const yearTasks = this.state.extraTasks.filter(t => {
      const match = t.week.match(/^(\d{4})-KW/);
      return match && parseInt(match[1]) === this.state.selectedYear;
    });
    
    // Zbierz unikalne nazwy zadań
    const taskNames = new Map<string, ExtraTask[]>();
    yearTasks.forEach(t => {
      if (!taskNames.has(t.name)) taskNames.set(t.name, []);
      taskNames.get(t.name)!.push(t);
    });
    
    // Separator row
    const sepCells = 6 + 52 * 2; // fixed cols + week cols
    const sepCell = document.createElement('div');
    sepCell.className = 'grid-cell planner-extra-separator';
    sepCell.style.gridColumn = `1 / -1`;
    sepCell.innerHTML = `
      <div class="planner-extra-sep-content">
        <span class="planner-extra-sep-icon">📌</span>
        <span class="planner-extra-sep-label">${i18n.t('schedule.extraTasks')}</span>
        <button class="planner-extra-add-btn" id="plannerAddExtraTask">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          ${i18n.t('schedule.addExtraTask')}
        </button>
      </div>
    `;
    container.appendChild(sepCell);
    
    sepCell.querySelector('#plannerAddExtraTask')?.addEventListener('click', () => {
      const weekKey = `${this.state.selectedYear}-KW${currentWeek.toString().padStart(2, '0')}`;
      this.showExtraTaskModal(weekKey);
    });
    
    // Render row per unique task name
    taskNames.forEach((tasks, name) => {
      // Znajdź pierwszy task dla metadanych
      const firstTask = tasks[0];
      const totalTime = firstTask.timePerUnit * firstTask.units;
      const hours = Math.floor(totalTime / 60);
      const mins = totalTime % 60;
      const timeStr = hours > 0 ? `${hours}h${mins > 0 ? mins + 'm' : ''}` : `${totalTime}m`;
      
      // Name cell (klient kolumna)
      const nameCell = document.createElement('div');
      nameCell.className = 'grid-cell fixed-cell col-customer planner-extra-row-cell';
      nameCell.innerHTML = `
        <div class="cell-with-badge">
          <span class="planner-extra-pin">📌</span>
          <span class="cell-text">${name}</span>
        </div>
      `;
      nameCell.title = name;
      container.appendChild(nameCell);
      
      // Empty cell (typ kolumna)
      const typeCell = document.createElement('div');
      typeCell.className = 'grid-cell fixed-cell col-type planner-extra-row-cell';
      container.appendChild(typeCell);
      
      // Comment cell (część kolumna) - editable
      const commentCell = document.createElement('div');
      commentCell.className = 'grid-cell fixed-cell col-part planner-extra-row-cell planner-extra-comment-cell';
      commentCell.innerHTML = firstTask.comment 
        ? `<span class="cell-text planner-extra-comment-text">${firstTask.comment}</span>` 
        : `<span class="cell-text planner-extra-comment-placeholder">${i18n.t('schedule.addComment')}</span>`;
      commentCell.title = firstTask.comment || i18n.t('schedule.addComment');
      commentCell.style.cursor = 'pointer';
      commentCell.addEventListener('click', () => {
        const currentComment = firstTask.comment || '';
        const newComment = prompt(i18n.t('schedule.addComment'), currentComment);
        if (newComment !== null) {
          tasks.forEach(t => t.comment = newComment);
          this.updateExtraTaskComment(firstTask.id, newComment);
          this.renderPlanningGrid();
        }
      });
      container.appendChild(commentCell);
      
      // Empty cell (test kolumna)
      const testCell = document.createElement('div');
      testCell.className = 'grid-cell fixed-cell col-test planner-extra-row-cell';
      container.appendChild(testCell);
      
      // Time per unit cell (czas kolumna)
      const tpuCell = document.createElement('div');
      tpuCell.className = 'grid-cell fixed-cell col-time time-cell planner-extra-row-cell';
      tpuCell.innerHTML = `<span class="time-value">${firstTask.timePerUnit}</span><span class="time-unit">min</span>`;
      container.appendChild(tpuCell);
      
      // Actions cell
      const actionsCell = document.createElement('div');
      actionsCell.className = 'grid-cell actions-cell col-actions planner-extra-row-cell';
      actionsCell.innerHTML = `
        <button class="btn-icon planner-extra-del" title="${i18n.t('common.delete')}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>
      `;
      actionsCell.querySelector('.planner-extra-del')?.addEventListener('click', async () => {
        // Usuń wszystkie zadania o tej nazwie
        for (const t of tasks) {
          await this.deleteExtraTask(t.id);
        }
        this.renderPlanningGrid();
      });
      container.appendChild(actionsCell);
      
      // Week cells - pokaż info o extra task per tydzień
      for (let week = 1; week <= 52; week++) {
        const kwNum = `KW${week.toString().padStart(2, '0')}`;
        const yearWeekKey = `${this.state.selectedYear}-${kwNum}`;
        const isCurrentWeek = week === currentWeek && this.state.selectedYear === currentYear;
        
        const weekTask = tasks.find(t => t.week === yearWeekKey);
        
        // IST cell - pokaż liczbę przypisanych pracowników
        const istCell = document.createElement('div');
        istCell.className = `grid-cell week-cell planner-extra-week-cell ${isCurrentWeek ? 'current-week' : ''}`;
        if (weekTask) {
          const extraProjectId = `extra-${weekTask.id}`;
          const assignments = this.state.scheduleAssignments.filter(
            (a: ScheduleAssignment) => a.projectId === extraProjectId && a.week === yearWeekKey
          );
          istCell.innerHTML = assignments.length > 0 
            ? `<span class="cell-value planner-extra-ist">${assignments.length}</span>` 
            : '';
          istCell.classList.add('planner-extra-active-cell');
          istCell.title = `${name} - ${yearWeekKey}: ${assignments.length} ${i18n.t('schedule.employeesAssigned')}`;
        }
        container.appendChild(istCell);
        
        // SOLL cell - pokaż jednostki zadania
        const sollCell = document.createElement('div');
        sollCell.className = `grid-cell week-cell planner-extra-week-cell ${isCurrentWeek ? 'current-week' : ''}`;
        if (weekTask) {
          sollCell.innerHTML = `<span class="cell-value planner-extra-soll">${weekTask.units}</span>`;
          sollCell.classList.add('planner-extra-active-cell');
          sollCell.title = `${weekTask.units} × ${weekTask.timePerUnit}min`;
          
          // Kliknięcie na cell otwiera modal edycji
          sollCell.style.cursor = 'pointer';
          sollCell.addEventListener('click', () => {
            this.showExtraTaskModal(yearWeekKey, weekTask);
          });
        } else {
          // Empty cell - kliknięcie dodaje task na ten tydzień
          sollCell.style.cursor = 'pointer';
          sollCell.addEventListener('click', () => {
            const newTask: ExtraTask = {
              id: crypto.randomUUID(),
              name: name,
              week: yearWeekKey,
              timePerUnit: firstTask.timePerUnit,
              units: firstTask.units,
              comment: firstTask.comment,
              created_at: Date.now()
            };
            this.showExtraTaskModal(yearWeekKey, undefined);
          });
        }
        container.appendChild(sollCell);
      }
    });
  }

  private initYearSelector(): void {
    const yearSelect = document.getElementById('filterYear') as HTMLSelectElement;
    if (!yearSelect) return;
    
    const currentYear = new Date().getFullYear();
    
    // Only rebuild if empty
    if (yearSelect.options.length === 0) {
      // Generate years: 2 years back to 2 years forward
      for (let year = currentYear - 2; year <= currentYear + 2; year++) {
        const option = document.createElement('option');
        option.value = year.toString();
        option.textContent = year.toString();
        if (year === this.state.selectedYear) {
          option.selected = true;
        }
        yearSelect.appendChild(option);
      }
    }
  }

  private createWeekCell(
    project: Project,
    week: string,
    type: 'ist' | 'soll',
    value: number,
    sollValue: number,
    isCurrentWeek: boolean,
    comment: Comment | null,
    weekData?: { ist: number; soll: number; stoppage?: boolean; productionLack?: boolean }
  ): HTMLElement {
    const cell = document.createElement('div');
    cell.className = `grid-cell week-cell ${isCurrentWeek ? 'current-week' : ''}`;
    
    // Extract week number for keyboard navigation
    const weekMatch = week.match(/KW(\d+)/);
    const weekNum = weekMatch ? parseInt(weekMatch[1]) : 0;
    
    // Add data attributes for hover and keyboard navigation
    cell.setAttribute('data-project-id', project.id);
    cell.setAttribute('data-week', weekNum.toString());
    cell.setAttribute('data-type', type);
    
    // Add stoppage/production lack indicator classes
    if (weekData?.stoppage) {
      cell.classList.add('has-stoppage');
    }
    if (weekData?.productionLack) {
      cell.classList.add('has-production-lack');
    }
    
    // Value display
    const valueEl = document.createElement('span');
    valueEl.className = 'cell-value';
    valueEl.textContent = value.toString();
    cell.appendChild(valueEl);

    // Comment indicator - blue border if has comment
    if (comment && type === 'ist') {
      cell.classList.add('has-comment');
    }
    
    // Add hover functionality for IST cells
    if (type === 'ist') {
      let hoverTimeout: number | null = null;
      let currentPopup: HTMLElement | null = null;
      
      cell.addEventListener('mouseenter', () => {
        hoverTimeout = window.setTimeout(() => {
          currentPopup = this.showCellActionPopup(cell, project, week, comment, weekData);
        }, 400);
      });
      
      cell.addEventListener('mouseleave', (e) => {
        if (hoverTimeout) {
          clearTimeout(hoverTimeout);
          hoverTimeout = null;
        }
        // Check if moving to popup
        const relatedTarget = e.relatedTarget as HTMLElement;
        if (currentPopup && relatedTarget && currentPopup.contains(relatedTarget)) {
          return; // Don't close if moving to popup
        }
        if (currentPopup) {
          setTimeout(() => {
            if (currentPopup && !currentPopup.matches(':hover')) {
              currentPopup.remove();
              currentPopup = null;
            }
          }, 100);
        }
      });
    }
    
    // Status colors and SVG indicator for IST
    if (type === 'ist') {
      let statusClass = 'status-empty';
      let statusSvg = '';
      
      // Simple color logic based on IST vs SOLL values only
      if (sollValue === 0) {
        // No SOLL value - neutral
        statusClass = 'status-empty';
      } else if (value >= sollValue) {
        // IST >= SOLL - completed (green)
        statusClass = 'status-green';
        statusSvg = `<svg class="cell-status-icon status-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
          <polyline points="20 6 9 17 4 12"/>
        </svg>`;
      } else if (value > 0 && value < sollValue) {
        // IST > 0 but < SOLL - in progress (orange)
        statusClass = 'status-orange';
        statusSvg = `<svg class="cell-status-icon status-warning" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>`;
      } else if (value === 0 && sollValue > 0) {
        // IST = 0 but SOLL > 0 - not started (red)
        statusClass = 'status-red';
        statusSvg = `<svg class="cell-status-icon status-x" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>`;
      }
      
      cell.classList.add(statusClass);
      
      // Add status icon - ALWAYS visible for completed (IST >= SOLL), hover for others
      if (statusSvg && sollValue > 0) {
        const iconWrapper = document.createElement('span');
        iconWrapper.className = 'cell-status-wrapper';
        if (value >= sollValue) {
          iconWrapper.classList.add('always-visible');
        }
        iconWrapper.innerHTML = statusSvg;
        cell.appendChild(iconWrapper);
      }
      
      // Add pattern classes for stoppage and production lack
      if (weekData?.stoppage) {
        cell.classList.add('cell-stoppage');
      }
      if (weekData?.productionLack) {
        cell.classList.add('cell-production-lack');
      }

      // Blink/highlight based on settings
      if (this.state.settings.blinkAlerts && value < sollValue && sollValue > 0) {
        cell.classList.add('blink');
      }

      if (this.state.settings.highlightMissing && value === 0 && sollValue > 0) {
        cell.classList.add('important');
      }
    } else {
      cell.classList.add('status-soll');
    }

    // LEFT CLICK: +1
    cell.addEventListener('click', async (e) => {
      if (e.shiftKey) return; // Let shift+click handle comments
      e.preventDefault();
      await this.updateProjectWeek(project.id, week, type, value + 1);
    });

    // RIGHT CLICK: -1
    cell.addEventListener('contextmenu', async (e) => {
      e.preventDefault();
      await this.updateProjectWeek(project.id, week, type, Math.max(0, value - 1));
    });

    // SHIFT + CLICK: Comment (only for IST)
    if (type === 'ist') {
      cell.addEventListener('click', (e) => {
        if (e.shiftKey) {
          e.preventDefault();
          e.stopPropagation();
          this.showCommentModal(project.id, week);
        }
      });
    }

    return cell;
  }

  private async toggleCellStatus(project: Project, week: string, statusType: 'stoppage' | 'productionLack'): Promise<void> {
    if (!project.weeks[week]) {
      project.weeks[week] = { ist: 0, soll: 0 };
    }

    project.weeks[week][statusType] = !project.weeks[week][statusType];
    project.updated_at = Date.now();
    
    await db.put('projects', project);
    this.skipNextScroll = true;
    this.renderPlanningGrid();
    
    const statusName = statusType === 'stoppage' ? i18n.t('planning.stoppageLabel') : i18n.t('planning.partsMissing');
    const isActive = project.weeks[week][statusType];
    this.showToast(`${statusName}: ${isActive ? i18n.t('planning.enabled') : i18n.t('planning.disabled')}`, 'success');
  }

  private showCellActionPopup(
    cell: HTMLElement, 
    project: Project, 
    week: string, 
    comment: Comment | null,
    weekData?: { ist: number; soll: number; stoppage?: boolean; productionLack?: boolean }
  ): HTMLElement {
    // Remove any existing popup
    document.querySelector('.cell-action-popup')?.remove();
    
    const rect = cell.getBoundingClientRect();
    const popup = document.createElement('div');
    popup.className = 'cell-action-popup';
    
    // Build popup content
    let html = '';
    
    // Comment preview if exists
    if (comment) {
      html += `
        <div class="cell-comment-preview">
          <div class="comment-preview-header">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            <span>${i18n.t('planning.comment')}</span>
          </div>
          <p>${this.escapeHtml(comment.text)}</p>
        </div>
      `;
    }
    
    // Action buttons
    html += `
      <div class="cell-action-buttons">
        <button class="cell-action-btn action-comment ${comment ? 'active' : ''}" data-action="comment" title="${i18n.t('planning.comment')}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        </button>
        <button class="cell-action-btn action-stoppage ${weekData?.stoppage ? 'active' : ''}" data-action="stoppage" title="${i18n.t('planning.stoppageLabel')}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
          </svg>
        </button>
        <button class="cell-action-btn action-lack ${weekData?.productionLack ? 'active' : ''}" data-action="lack" title="${i18n.t('planning.partsMissing')}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
            <line x1="7.5" y1="4.21" x2="16.5" y2="19.79"/>
          </svg>
        </button>
      </div>
    `;
    
    popup.innerHTML = html;
    document.body.appendChild(popup);
    
    // Calculate position after adding to DOM to get actual size
    const popupRect = popup.getBoundingClientRect();
    const popupHeight = popupRect.height;
    const popupWidth = popupRect.width;
    
    // Position: prefer above cell, but show below if not enough space
    let top: number;
    let left = rect.left + (rect.width / 2) - (popupWidth / 2);
    
    if (rect.top > popupHeight + 10) {
      // Enough space above
      top = rect.top - popupHeight - 6;
    } else {
      // Show below
      top = rect.bottom + 6;
    }
    
    // Keep within viewport horizontally
    if (left < 10) left = 10;
    if (left + popupWidth > window.innerWidth - 10) {
      left = window.innerWidth - popupWidth - 10;
    }
    
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
    
    // Add event listeners
    popup.querySelector('[data-action="comment"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      popup.remove();
      this.showCommentModal(project.id, week);
    });
    
    popup.querySelector('[data-action="stoppage"]')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      popup.remove();
      await this.toggleCellStatus(project, week, 'stoppage');
    });
    
    popup.querySelector('[data-action="lack"]')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      popup.remove();
      await this.toggleCellStatus(project, week, 'productionLack');
    });
    
    // Close when mouse leaves popup
    popup.addEventListener('mouseleave', () => {
      setTimeout(() => {
        if (!popup.matches(':hover') && !cell.matches(':hover')) {
          popup.remove();
        }
      }, 150);
    });
    
    return popup;
  }

  private showCellHoverPopup(cell: HTMLElement, projectId: string, week: string, ist: number, soll: number): void {
    // Remove any existing hover popup
    document.querySelector('.cell-hover-popup')?.remove();

    const rect = cell.getBoundingClientRect();
    const project = this.state.projects.find(p => p.id === projectId);
    if (!project) return;

    const weekData = project.weeks[week];
    const hasStoppage = weekData?.stoppage || false;
    const hasProductionLack = weekData?.productionLack || false;

    const popup = document.createElement('div');
    popup.className = 'cell-hover-popup stoppage-popup';
    
    // Start with visibility hidden to prevent flash in top-left corner
    popup.style.opacity = '0';
    
    // Calculate position with bounds checking
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    let left = rect.right + 10;
    let top = rect.top;
    
    // Ensure popup doesn't go off-screen
    if (left + 280 > viewportWidth) {
      left = rect.left - 290; // Show on left side instead
    }
    if (left < 10) left = 10;
    if (top < 10) top = 10;
    if (top + 200 > viewportHeight) {
      top = viewportHeight - 210;
    }
    
    // Set position BEFORE adding to DOM
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;

    const percentage = soll > 0 ? Math.round((ist / soll) * 100) : 0;
    const statusText = percentage >= 100 ? i18n.t('planning.statusCompleted') : percentage > 0 ? i18n.t('planning.statusInProgress') : i18n.t('planning.statusNotStarted');
    const statusClass = percentage >= 100 ? 'pct-100' : percentage > 0 ? 'pct-partial' : 'pct-zero';

    popup.innerHTML = `
      <div class="stoppage-popup-header">
        <h4>${week}</h4>
        <button class="stoppage-popup-close">✕</button>
      </div>
      <div class="cell-popup-stats">
        <div class="popup-stat-row">
          <span>IST:</span> <strong>${ist}</strong>
        </div>
        <div class="popup-stat-row">
          <span>SOLL:</span> <strong>${soll}</strong>
        </div>
        <div class="popup-stat-row popup-stat-status">
          <span>Status:</span> <strong class="${statusClass}">${percentage}% - ${statusText}</strong>
        </div>
      </div>
      <div class="cell-popup-options">
        <button class="stoppage-option ${hasStoppage ? 'active' : ''}" data-action="stoppage">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
          </svg>
          ${i18n.t('planning.stoppageLabel')}
        </button>
        <button class="stoppage-option ${hasProductionLack ? 'active' : ''}" data-action="production-lack">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="1" y="3" width="15" height="13"/>
            <polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/>
            <circle cx="5.5" cy="18.5" r="2.5"/>
            <circle cx="18.5" cy="18.5" r="2.5"/>
          </svg>
          ${i18n.t('planning.productionLack')}
        </button>
      </div>
    `;

    document.body.appendChild(popup);
    
    // Trigger animation after position is set
    requestAnimationFrame(() => {
      popup.style.opacity = '1';
    });

    // Close button
    popup.querySelector('.stoppage-popup-close')?.addEventListener('click', () => popup.remove());

    // Handle option clicks
    popup.querySelectorAll('.stoppage-option').forEach(option => {
      option.addEventListener('click', async () => {
        const action = (option as HTMLElement).dataset.action;
        
        if (!project.weeks[week]) {
          project.weeks[week] = { ist: 0, soll: 0 };
        }

        if (action === 'stoppage') {
          project.weeks[week].stoppage = !project.weeks[week].stoppage;
        } else if (action === 'production-lack') {
          project.weeks[week].productionLack = !project.weeks[week].productionLack;
        }

        project.updated_at = Date.now();
        await db.put('projects', project);
        
        popup.remove();
        this.skipNextScroll = true;
        this.renderPlanningGrid();
        this.showToast(i18n.t('planning.statusUpdated'), 'success');
      });
    });

    // Close on mouse leave (with delay)
    let closeTimeout: number;
    popup.addEventListener('mouseenter', () => {
      clearTimeout(closeTimeout);
    });
    
    popup.addEventListener('mouseleave', () => {
      closeTimeout = window.setTimeout(() => popup.remove(), 300);
    });

    cell.addEventListener('mouseleave', () => {
      closeTimeout = window.setTimeout(() => popup.remove(), 300);
    }, { once: true });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private showValueInputModal(projectId: string, week: string, type: 'ist' | 'soll', currentValue: number): void {
    const modal = document.getElementById('modal')!;
    const modalTitle = document.getElementById('modalTitle')!;
    const modalBody = document.getElementById('modalBody')!;

    modalTitle.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18" style="display:inline;vertical-align:middle;margin-right:8px"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/></svg> ${week} - ${type.toUpperCase()}`;
    
    modalBody.innerHTML = `
      <div class="form-group">
        <label>${i18n.t('schedule.valueLabel')}</label>
        <input type="number" id="cellValue" class="form-control" value="${currentValue}" min="0" autofocus />
      </div>
      <p class="hint"><svg viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2" width="14" height="14" style="display:inline;vertical-align:middle;margin-right:4px"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg> ${i18n.t('schedule.tipClickInfo')}</p>
    `;

    const confirmBtn = modal.querySelector('.modal-confirm') as HTMLButtonElement;
    confirmBtn.onclick = async () => {
      const newValue = parseInt((document.getElementById('cellValue') as HTMLInputElement).value) || 0;
      await this.updateProjectWeek(projectId, week, type, newValue);
      this.hideModal();
    };

    modal.classList.add('active');
    setTimeout(() => (document.getElementById('cellValue') as HTMLInputElement)?.focus(), 100);
  }

  private showCommentModal(projectId: string, week: string): void {
    const modal = document.getElementById('modal')!;
    const modalTitle = document.getElementById('modalTitle')!;
    const modalBody = document.getElementById('modalBody')!;

    const existingComment = this.comments.find(c => c.projectId === projectId && c.week === week);

    modalTitle.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18" style="display:inline;vertical-align:middle;margin-right:8px"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> ${i18n.t('planning.comment')} - ${week}`;
    
    modalBody.innerHTML = `
      <div class="form-group">
        <label>${i18n.t('planning.comment')}:</label>
        <textarea id="commentText" class="form-control" rows="4" placeholder="${i18n.t('planning.addCommentPlaceholder')}">${existingComment?.text || ''}</textarea>
      </div>
      ${existingComment ? `<button id="deleteComment" class="btn btn-danger"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="display:inline;vertical-align:middle;margin-right:4px"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> ${i18n.t('planning.deleteComment')}</button>` : ''}
    `;

    document.getElementById('deleteComment')?.addEventListener('click', async () => {
      if (existingComment) {
        await db.delete('comments', existingComment.id);
        this.comments = this.comments.filter(c => c.id !== existingComment.id);
        this.hideModal();
        this.renderPlanningGrid();
        this.showToast(i18n.t('planning.commentDeleted'), 'success');
      }
    });

    const confirmBtn = modal.querySelector('.modal-confirm') as HTMLButtonElement;
    confirmBtn.onclick = async () => {
      const text = (document.getElementById('commentText') as HTMLTextAreaElement).value.trim();
      
      if (text) {
        const comment: Comment = existingComment || {
          id: this.generateId(),
          projectId,
          week,
          text: '',
          createdAt: Date.now(),
        };
        comment.text = text;
        
        await db.put('comments', comment);
        if (!existingComment) {
          this.comments.push(comment);
        } else {
          const idx = this.comments.findIndex(c => c.id === comment.id);
          if (idx >= 0) this.comments[idx] = comment;
        }
        this.showToast(i18n.t('planning.commentSaved'), 'success');
      }
      
      this.hideModal();
      this.renderPlanningGrid();
    };

    modal.classList.add('active');
  }

  private showTimeEditPopup(project: Project, cell: HTMLElement): void {
    // Admin guard: only allow time editing when unlocked
    if (!this.adminUnlocked) {
      this.showToast(i18n.t('settings.appLocked'), 'warning');
      return;
    }
    // Remove existing popup
    document.querySelector('.time-edit-popup')?.remove();
    
    const popup = document.createElement('div');
    popup.className = 'time-edit-popup';
    
    const rect = cell.getBoundingClientRect();
    popup.style.position = 'fixed';
    popup.style.zIndex = '10000';
    
    // Calculate position - prefer below, but check boundaries
    let left = rect.left;
    let top = rect.bottom + 5;
    
    // Check if popup would go off screen
    const popupWidth = 200;
    const popupHeight = 100;
    
    if (left + popupWidth > window.innerWidth) {
      left = window.innerWidth - popupWidth - 10;
    }
    if (top + popupHeight > window.innerHeight) {
      top = rect.top - popupHeight - 5;
    }
    
    popup.style.left = `${Math.max(10, left)}px`;
    popup.style.top = `${Math.max(10, top)}px`;
    
    popup.innerHTML = `
      <div class="time-edit-content">
        <label>Czas na 1 test (min):</label>
        <input type="number" class="time-input" value="${project.timePerUnit || 0}" min="0" max="999" step="1">
        <div class="time-edit-buttons">
          <button class="btn-save">Zapisz</button>
          <button class="btn-cancel">Anuluj</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(popup);
    
    const input = popup.querySelector('.time-input') as HTMLInputElement;
    input.focus();
    input.select();
    
    // Save on button click or Enter
    const saveTime = async () => {
      const newTime = parseInt(input.value) || 0;
      project.timePerUnit = newTime;
      project.updated_at = Date.now();
      
      // Save to IndexedDB
      await db.put('projects', project);
      
      // Also save to backend database
      try {
        await api.updateProject(project);
      } catch (err) {
        console.error('Error saving time to backend:', err);
      }
      
      // Update state
      const stateProject = this.state.projects.find(p => p.id === project.id);
      if (stateProject) {
        stateProject.timePerUnit = newTime;
      }
      
      // Update cell display
      const timeValue = cell.querySelector('.time-value');
      if (timeValue) timeValue.textContent = newTime.toString();
      
      popup.remove();
      this.showToast(`Czas ustawiony: ${newTime} min`, 'success');
    };
    
    popup.querySelector('.btn-save')?.addEventListener('click', saveTime);
    popup.querySelector('.btn-cancel')?.addEventListener('click', () => popup.remove());
    
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveTime();
      if (e.key === 'Escape') popup.remove();
    });
    
    // Close on click outside
    setTimeout(() => {
      const closeHandler = (e: MouseEvent) => {
        if (!popup.contains(e.target as Node)) {
          popup.remove();
          document.removeEventListener('click', closeHandler);
        }
      };
      document.addEventListener('click', closeHandler);
    }, 100);
  }

  private showFillDownModal(sourceProject: Project): void {
    // Admin guard
    if (!this.adminUnlocked) {
      this.showToast(i18n.t('settings.appLocked'), 'warning');
      return;
    }
    const modal = document.getElementById('modal')!;
    const modalTitle = document.getElementById('modalTitle')!;
    const modalBody = document.getElementById('modalBody')!;

    const customer = this.state.customers.find(c => c.id === sourceProject.customer_id);
    
    // Get projects below the source
    const filteredProjects = this.getFilteredProjects();
    const sourceIdx = filteredProjects.findIndex(p => p.id === sourceProject.id);
    const targetProjects = filteredProjects.slice(sourceIdx + 1);

    if (targetProjects.length === 0) {
      this.showToast(i18n.t('messages.errorOccurred'), 'warning');
      return;
    }

    modalTitle.textContent = `⬇️ ${i18n.t('planning.fillDown')} - ${customer?.name || ''}`;
    modalBody.innerHTML = `
      <p class="hint">${i18n.t('planning.fillDownHint')}</p>
      <div class="form-group">
        <label>${i18n.t('projects.projects')} (${targetProjects.length}):</label>
        <div class="fill-down-targets" style="max-height: 200px; overflow-y: auto; border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: 8px;">
          ${targetProjects.map(p => {
            const c = this.state.customers.find(c => c.id === p.customer_id);
            const t = this.state.types.find(t => t.id === p.type_id);
            return `
              <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px; cursor: pointer;">
                <input type="checkbox" class="fill-target" data-id="${p.id}" checked />
                <span>${c?.name || '-'} / ${t?.name || '-'}</span>
              </label>
            `;
          }).join('')}
        </div>
      </div>
      <div class="form-group">
        <label>
          <input type="checkbox" id="fillDownCopyComments" />
          ${i18n.t('planning.copyComments')}
        </label>
      </div>
    `;

    const confirmBtn = modal.querySelector('.modal-confirm') as HTMLButtonElement;
    confirmBtn.onclick = async () => {
      const selectedIds = Array.from(document.querySelectorAll('.fill-target:checked'))
        .map(el => (el as HTMLInputElement).dataset.id);
      const copyComments = (document.getElementById('fillDownCopyComments') as HTMLInputElement).checked;
      
      for (const targetId of selectedIds) {
        const target = this.state.projects.find(p => p.id === targetId);
        if (target) {
          // Copy all week data
          target.weeks = { ...sourceProject.weeks };
          target.updated_at = Date.now();
          await db.put('projects', target);
          
          // Copy comments if selected
          if (copyComments) {
            const sourceComments = this.comments.filter(c => c.projectId === sourceProject.id);
            for (const comment of sourceComments) {
              const newComment: Comment = {
                ...comment,
                id: this.generateId(),
                projectId: targetId!,
              };
              await db.put('comments', newComment);
              this.comments.push(newComment);
            }
          }
        }
      }

      await this.addLog('updated', 'projects', `Fill down (${selectedIds.length})`);
      this.hideModal();
      this.renderPlanningGrid();
      this.showToast(i18n.t('messages.savedSuccessfully'), 'success');
    };

    modal.classList.add('active');
  }

  private showBulkFillModal(project: Project): void {
    const modal = document.getElementById('modal')!;
    const modalTitle = document.getElementById('modalTitle')!;
    const modalBody = document.getElementById('modalBody')!;

    const customer = this.state.customers.find(c => c.id === project.customer_id);
    const type = this.state.types.find(t => t.id === project.type_id);

    modalTitle.textContent = `📊 ${i18n.t('bulkFill.title')} - ${customer?.name || ''} / ${type?.name || ''}`;
    
    modalBody.innerHTML = `
      <div class="bulk-fill-form">
        <div class="fill-method">
          <label class="radio-label">
            <input type="radio" name="fillMethod" value="range" checked />
            <span>📅 ${i18n.t('bulkFill.weekRange')}</span>
          </label>
          
          <div id="rangeOptions" class="fill-options">
            <div class="form-row">
              <div class="form-group">
                <label>${i18n.t('bulkFill.from')}:</label>
                <select id="fromWeek" class="form-control">
                  ${Array.from({length: 52}, (_, i) => `<option value="${i+1}">KW${(i+1).toString().padStart(2, '0')}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label>${i18n.t('bulkFill.to')}:</label>
                <select id="toWeek" class="form-control">
                  ${Array.from({length: 52}, (_, i) => `<option value="${i+1}" ${i+1 === 52 ? 'selected' : ''}>KW${(i+1).toString().padStart(2, '0')}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label>${i18n.t('bulkFill.ist')}:</label>
                <input type="number" id="fillIst" class="form-control" value="0" min="0" />
              </div>
              <div class="form-group">
                <label>${i18n.t('bulkFill.soll')}:</label>
                <input type="number" id="fillSoll" class="form-control" value="1" min="0" />
              </div>
            </div>
          </div>
        </div>

        <div class="fill-method">
          <label class="radio-label">
            <input type="radio" name="fillMethod" value="pattern" />
            <span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="display:inline;vertical-align:middle;margin-right:4px"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> ${i18n.t('bulkFill.cyclicPattern')}</span>
          </label>
          
          <div id="patternOptions" class="fill-options hidden">
            <div class="form-row">
              <div class="form-group">
                <label>${i18n.t('bulkFill.start')}:</label>
                <select id="patternStart" class="form-control">
                  ${Array.from({length: 52}, (_, i) => `<option value="${i+1}">KW${(i+1).toString().padStart(2, '0')}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label>${i18n.t('bulkFill.everyNWeeks')}:</label>
                <input type="number" id="patternInterval" class="form-control" value="4" min="1" max="52" />
              </div>
              <div class="form-group">
                <label>${i18n.t('bulkFill.ist')}:</label>
                <input type="number" id="patternIst" class="form-control" value="0" min="0" />
              </div>
              <div class="form-group">
                <label>${i18n.t('bulkFill.soll')}:</label>
                <input type="number" id="patternSoll" class="form-control" value="1" min="0" />
              </div>
            </div>
          </div>
        </div>

        <div class="fill-method">
          <label class="radio-label">
            <input type="radio" name="fillMethod" value="audit" />
            <span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="display:inline;vertical-align:middle;margin-right:4px"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg> ${i18n.t('bulkFill.auditPlan')}</span>
          </label>
          
          <div id="auditOptions" class="fill-options hidden">
            <div class="quarters-grid">
              <label><input type="checkbox" id="q1" checked /> Q1 (KW01-13)</label>
              <label><input type="checkbox" id="q2" checked /> Q2 (KW14-26)</label>
              <label><input type="checkbox" id="q3" checked /> Q3 (KW27-39)</label>
              <label><input type="checkbox" id="q4" checked /> Q4 (KW40-52)</label>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>${i18n.t('bulkFill.istPerQ')}:</label>
                <input type="number" id="auditIst" class="form-control" value="0" min="0" />
              </div>
              <div class="form-group">
                <label>${i18n.t('bulkFill.sollPerQ')}:</label>
                <input type="number" id="auditSoll" class="form-control" value="1" min="0" />
              </div>
            </div>
          </div>
        </div>

        <div class="fill-method">
          <label class="radio-label">
            <input type="radio" name="fillMethod" value="monthly" />
            <span>📆 ${i18n.t('bulkFill.monthly')}</span>
          </label>
          
          <div id="monthlyOptions" class="fill-options hidden">
            <p class="hint">${i18n.t('bulkFill.monthlyHint')}</p>
            <div class="form-row">
              <div class="form-group">
                <label>${i18n.t('bulkFill.ist')}:</label>
                <input type="number" id="monthlyIst" class="form-control" value="0" min="0" />
              </div>
              <div class="form-group">
                <label>${i18n.t('bulkFill.soll')}:</label>
                <input type="number" id="monthlySoll" class="form-control" value="1" min="0" />
              </div>
            </div>
          </div>
        </div>

        <div class="fill-method danger">
          <label class="radio-label">
            <input type="radio" name="fillMethod" value="clear" />
            <span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="display:inline;vertical-align:middle;margin-right:4px"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> ${i18n.t('bulkFill.clearAll')}</span>
          </label>
        </div>
      </div>
    `;

    // Toggle options visibility
    document.querySelectorAll('input[name="fillMethod"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        const method = (e.target as HTMLInputElement).value;
        document.querySelectorAll('.fill-options').forEach(el => el.classList.add('hidden'));
        const optionsEl = document.getElementById(`${method}Options`);
        if (optionsEl) optionsEl.classList.remove('hidden');
      });
    });

    const confirmBtn = modal.querySelector('.modal-confirm') as HTMLButtonElement;
    confirmBtn.onclick = async () => {
      const method = (document.querySelector('input[name="fillMethod"]:checked') as HTMLInputElement).value;
      await this.executeBulkFill(project, method);
      this.hideModal();
      this.renderPlanningGrid();
      this.showToast(i18n.t('messages.savedSuccessfully'), 'success');
    };

    modal.classList.add('active');
  }

  private async executeBulkFill(project: Project, method: string): Promise<void> {
    switch (method) {
      case 'range': {
        const fromWeek = parseInt((document.getElementById('fromWeek') as HTMLSelectElement).value);
        const toWeek = parseInt((document.getElementById('toWeek') as HTMLSelectElement).value);
        const ist = parseInt((document.getElementById('fillIst') as HTMLInputElement).value) || 0;
        const soll = parseInt((document.getElementById('fillSoll') as HTMLInputElement).value) || 0;
        
        for (let week = fromWeek; week <= toWeek; week++) {
          const kwNum = `KW${week.toString().padStart(2, '0')}`;
          project.weeks[kwNum] = { ist, soll };
        }
        break;
      }
      
      case 'pattern': {
        const start = parseInt((document.getElementById('patternStart') as HTMLSelectElement).value);
        const interval = parseInt((document.getElementById('patternInterval') as HTMLInputElement).value) || 4;
        const ist = parseInt((document.getElementById('patternIst') as HTMLInputElement).value) || 0;
        const soll = parseInt((document.getElementById('patternSoll') as HTMLInputElement).value) || 0;
        
        for (let week = start; week <= 52; week += interval) {
          const kwNum = `KW${week.toString().padStart(2, '0')}`;
          project.weeks[kwNum] = { ist, soll };
        }
        break;
      }
      
      case 'audit': {
        const quarters = [
          { id: 'q1', start: 1, end: 13 },
          { id: 'q2', start: 14, end: 26 },
          { id: 'q3', start: 27, end: 39 },
          { id: 'q4', start: 40, end: 52 },
        ];
        const ist = parseInt((document.getElementById('auditIst') as HTMLInputElement).value) || 0;
        const soll = parseInt((document.getElementById('auditSoll') as HTMLInputElement).value) || 0;
        
        quarters.forEach(q => {
          if ((document.getElementById(q.id) as HTMLInputElement).checked) {
            const midWeek = Math.floor((q.start + q.end) / 2);
            const kwNum = `KW${midWeek.toString().padStart(2, '0')}`;
            project.weeks[kwNum] = { ist, soll };
          }
        });
        break;
      }

      case 'monthly': {
        const monthStarts = [1, 5, 9, 14, 18, 22, 27, 31, 35, 40, 44, 48]; // Approximate week starts for each month
        const ist = parseInt((document.getElementById('monthlyIst') as HTMLInputElement).value) || 0;
        const soll = parseInt((document.getElementById('monthlySoll') as HTMLInputElement).value) || 0;
        
        monthStarts.forEach(week => {
          const kwNum = `KW${week.toString().padStart(2, '0')}`;
          project.weeks[kwNum] = { ist, soll };
        });
        break;
      }
      
      case 'clear': {
        project.weeks = {};
        break;
      }
    }
    
    project.updated_at = Date.now();
    await db.put('projects', project);
    
    const idx = this.state.projects.findIndex(p => p.id === project.id);
    if (idx >= 0) this.state.projects[idx] = project;
  }

  private async updateProjectWeek(projectId: string, week: string, type: 'ist' | 'soll', value: number): Promise<void> {
    const project = this.state.projects.find((p) => p.id === projectId);
    if (!project) return;

    if (!project.weeks[week]) {
      project.weeks[week] = { ist: 0, soll: 0 };
    }

    project.weeks[week][type] = value;
    project.updated_at = Date.now();

    await db.put('projects', project);
    
    // Don't scroll after cell update - user wants to stay in place
    this.skipNextScroll = true;
    this.renderPlanningGrid();
    
    // Also update Analytics if it was rendered (data changed)
    if (this.state.currentView === 'analytics') {
      this.renderAnalyticsView();
    }
  }

  private toggleSort(column: 'customer' | 'type' | 'part' | 'test' | 'time'): void {
    if (this.sortColumn === column) {
      // Toggle direction or reset
      if (this.sortDirection === 'asc') {
        this.sortDirection = 'desc';
      } else {
        // Reset sorting
        this.sortColumn = null;
        this.sortDirection = 'asc';
      }
    } else {
      this.sortColumn = column;
      this.sortDirection = 'asc';
    }
    
    this.renderPlanningGrid();
    
    if (this.sortColumn) {
      this.showToast(i18n.t('planning.sortApplied').replace('{0}', this.getSortColumnName(column)).replace('{1}', this.sortDirection === 'asc' ? '↑' : '↓'), 'success');
    } else {
      this.showToast(i18n.t('planning.sortDisabled'), 'success');
    }
  }

  private getSortColumnName(column: string): string {
    const names: { [key: string]: string } = {
      'customer': i18n.t('planning.kunde'),
      'type': i18n.t('planning.typ'),
      'part': i18n.t('planning.teil'),
      'test': i18n.t('planning.prufung'),
      'time': i18n.t('planning.timeLabel')
    };
    return names[column] || column;
  }

  private getFilteredProjects(): Project[] {
    const customerFilter = (document.getElementById('filterCustomer') as HTMLSelectElement)?.value;
    const typeFilter = (document.getElementById('filterType') as HTMLSelectElement)?.value;
    const testFilter = (document.getElementById('filterTest') as HTMLSelectElement)?.value;
    const searchQuery = (document.getElementById('searchInput') as HTMLInputElement)?.value?.toLowerCase() || '';

    let filtered = this.state.projects.filter((project) => {
      if (customerFilter && project.customer_id !== customerFilter) return false;
      if (typeFilter && project.type_id !== typeFilter) return false;
      if (testFilter && project.test_id !== testFilter) return false;
      
      if (searchQuery) {
        const customer = this.state.customers.find((c) => c.id === project.customer_id);
        const type = this.state.types.find((t) => t.id === project.type_id);
        const part = this.state.parts.find((p) => p.id === project.part_id);
        const test = this.state.tests.find((t) => t.id === project.test_id);
        
        const searchText = [customer?.name, type?.name, part?.name, test?.name].join(' ').toLowerCase();
        if (!searchText.includes(searchQuery)) return false;
      }
      
      return true;
    });

    // Apply sorting
    if (this.sortColumn) {
      filtered = filtered.sort((a, b) => {
        let valueA = '';
        let valueB = '';
        
        switch (this.sortColumn) {
          case 'customer':
            valueA = this.state.customers.find(c => c.id === a.customer_id)?.name || '';
            valueB = this.state.customers.find(c => c.id === b.customer_id)?.name || '';
            break;
          case 'type':
            valueA = this.state.types.find(t => t.id === a.type_id)?.name || '';
            valueB = this.state.types.find(t => t.id === b.type_id)?.name || '';
            break;
          case 'part':
            valueA = this.state.parts.find(p => p.id === a.part_id)?.name || '';
            valueB = this.state.parts.find(p => p.id === b.part_id)?.name || '';
            break;
          case 'test':
            valueA = this.state.tests.find(t => t.id === a.test_id)?.name || '';
            valueB = this.state.tests.find(t => t.id === b.test_id)?.name || '';
            break;
          case 'time':
            const timeA = a.timePerUnit || 0;
            const timeB = b.timePerUnit || 0;
            return this.sortDirection === 'asc' ? timeA - timeB : timeB - timeA;
        }
        
        const comparison = valueA.localeCompare(valueB, 'pl');
        return this.sortDirection === 'asc' ? comparison : -comparison;
      });
    }

    // Move pinned projects to top
    const pinned = filtered.filter(p => this.pinnedProjects.has(p.id));
    const unpinned = filtered.filter(p => !this.pinnedProjects.has(p.id));
    return [...pinned, ...unpinned];
  }

  private updateFilterOptions(): void {
    const customerSelect = document.getElementById('filterCustomer') as HTMLSelectElement;
    const typeSelect = document.getElementById('filterType') as HTMLSelectElement;
    const testSelect = document.getElementById('filterTest') as HTMLSelectElement;

    const allText = i18n.t('common.all');

    if (customerSelect) {
      const currentValue = customerSelect.value;
      customerSelect.innerHTML = `<option value="">${allText}</option>`;
      this.state.customers.forEach((c) => {
        customerSelect.innerHTML += `<option value="${c.id}">${c.name}</option>`;
      });
      customerSelect.value = currentValue;
    }

    if (typeSelect) {
      const currentValue = typeSelect.value;
      typeSelect.innerHTML = `<option value="">${allText}</option>`;
      this.state.types.forEach((t) => {
        typeSelect.innerHTML += `<option value="${t.id}">${t.name}</option>`;
      });
      typeSelect.value = currentValue;
    }

    if (testSelect) {
      const currentValue = testSelect.value;
      testSelect.innerHTML = `<option value="">${allText}</option>`;
      this.state.tests.forEach((t) => {
        testSelect.innerHTML += `<option value="${t.id}">${t.name}</option>`;
      });
      testSelect.value = currentValue;
    }
  }

  private renderProjectsView(): void {
    // Update stats dashboard
    this.updateProjectsStats();
    
    // Render lists with extended info
    this.renderItemsListExtended('customers', this.state.customers);
    this.renderItemsListExtended('types', this.state.types);
    this.renderItemsListExtended('parts', this.state.parts);
    this.renderItemsListExtended('tests', this.state.tests);
    
    // Setup event listeners for search/filter
    this.setupProjectsEventListeners();
  }
  
  private projectsSearchQuery: string = '';
  private projectsFilter: 'all' | 'used' | 'unused' = 'all';
  private selectedItems: Map<string, Set<string>> = new Map([
    ['customers', new Set()],
    ['types', new Set()],
    ['parts', new Set()],
    ['tests', new Set()]
  ]);
  private itemTags: Map<string, string> = new Map(); // itemId -> color
  
  private TAG_COLORS = [
    '#EF4444', '#F59E0B', '#10B981', '#3B82F6', 
    '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16'
  ];
  
  private updateProjectsStats(): void {
    const usedCustomers = new Set(this.state.projects.map(p => p.customer_id));
    const usedTypes = new Set(this.state.projects.map(p => p.type_id));
    const usedParts = new Set(this.state.projects.map(p => p.part_id));
    const usedTests = new Set(this.state.projects.map(p => p.test_id));
    
    const stats = [
      { id: 'Customers', total: this.state.customers.length, used: usedCustomers.size },
      { id: 'Types', total: this.state.types.length, used: usedTypes.size },
      { id: 'Parts', total: this.state.parts.length, used: usedParts.size },
      { id: 'Tests', total: this.state.tests.length, used: usedTests.size }
    ];
    
    stats.forEach(stat => {
      const valueEl = document.getElementById(`stat${stat.id}`);
      const barEl = document.getElementById(`stat${stat.id}Bar`);
      const detailEl = document.getElementById(`stat${stat.id}Detail`);
      
      if (valueEl) valueEl.textContent = stat.total.toString();
      if (barEl) barEl.style.width = stat.total > 0 ? `${(stat.used / stat.total) * 100}%` : '0%';
      if (detailEl) detailEl.textContent = i18n.t('schedule.usedCount').replace('{0}', String(stat.used));
    });
    
    // Update counts
    document.getElementById('customersCount')!.textContent = this.state.customers.length.toString();
    document.getElementById('typesCount')!.textContent = this.state.types.length.toString();
    document.getElementById('partsCount')!.textContent = this.state.parts.length.toString();
    document.getElementById('testsCount')!.textContent = this.state.tests.length.toString();
  }
  
  private setupProjectsTabs(): void {
    document.querySelectorAll('.projects-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const tabId = (tab as HTMLElement).dataset.tab;
        document.querySelectorAll('.projects-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.projects-tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(`projects${tabId === 'list' ? 'List' : 'Tree'}View`)?.classList.add('active');
      });
    });
  }
  
  private getItemUsageCount(type: string, itemId: string): number {
    switch (type) {
      case 'customers': return this.state.projects.filter(p => p.customer_id === itemId).length;
      case 'types': return this.state.projects.filter(p => p.type_id === itemId).length;
      case 'parts': return this.state.projects.filter(p => p.part_id === itemId).length;
      case 'tests': return this.state.projects.filter(p => p.test_id === itemId).length;
      default: return 0;
    }
  }
  
  private renderItemsListExtended(type: string, items: any[]): void {
    const list = document.getElementById(`${type}List`);
    if (!list) return;

    list.innerHTML = '';
    
    // Filter items
    let filteredItems = items.filter(item => {
      // Search filter
      if (this.projectsSearchQuery) {
        if (!item.name.toLowerCase().includes(this.projectsSearchQuery.toLowerCase())) {
          return false;
        }
      }
      // Usage filter
      if (this.projectsFilter !== 'all') {
        const usage = this.getItemUsageCount(type, item.id);
        if (this.projectsFilter === 'used' && usage === 0) return false;
        if (this.projectsFilter === 'unused' && usage > 0) return false;
      }
      return true;
    });

    if (filteredItems.length === 0) {
      list.innerHTML = `<li class="empty-state">${i18n.t('settings.noMatchingItems')}</li>`;
      return;
    }

    filteredItems.forEach((item) => {
      const li = document.createElement('li');
      li.className = 'item';
      li.dataset.id = item.id;
      li.draggable = true;
      
      const isSelected = this.selectedItems.get(type)?.has(item.id);
      const tag = this.itemTags.get(item.id);
      
      if (isSelected) li.classList.add('selected');
      
      // Get item color (tests have their own color, others can have tag color)
      const itemColor = item.color || tag;
      
      li.innerHTML = `
        <input type="checkbox" class="item-checkbox" ${isSelected ? 'checked' : ''}>
        <div class="item-drag-handle">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
            <circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/>
            <circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/>
          </svg>
        </div>
        <div class="item-content">
          <span class="item-name">
            ${itemColor ? `<span class="item-color-badge" style="background: ${itemColor}"></span>` : ''}
            ${item.name}
          </span>
        </div>
        <div class="item-actions">
          <button class="btn-edit" title="Edytuj">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button class="btn-delete" title="${i18n.t('schedule.deleteBtn')}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </div>
      `;
      
      // Event listeners
      li.querySelector('.item-checkbox')?.addEventListener('change', (e) => {
        const checked = (e.target as HTMLInputElement).checked;
        if (checked) {
          this.selectedItems.get(type)?.add(item.id);
          li.classList.add('selected');
        } else {
          this.selectedItems.get(type)?.delete(item.id);
          li.classList.remove('selected');
        }
        this.updateBulkDeleteButton();
      });
      
      li.querySelector('.btn-edit')?.addEventListener('click', () => this.showEditModal(type, item));
      li.querySelector('.btn-delete')?.addEventListener('click', () => this.deleteItem(type, item.id));
      
      // Drag & Drop
      li.addEventListener('dragstart', (e) => {
        li.classList.add('dragging');
        e.dataTransfer!.setData('text/plain', JSON.stringify({ type, id: item.id }));
      });
      
      li.addEventListener('dragend', () => {
        li.classList.remove('dragging');
        document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
      });
      
      li.addEventListener('dragover', (e) => {
        e.preventDefault();
        li.classList.add('drag-over');
      });
      
      li.addEventListener('dragleave', () => {
        li.classList.remove('drag-over');
      });
      
      li.addEventListener('drop', async (e) => {
        e.preventDefault();
        li.classList.remove('drag-over');
        const data = JSON.parse(e.dataTransfer!.getData('text/plain'));
        if (data.type === type && data.id !== item.id) {
          await this.reorderItems(type, data.id, item.id);
        }
      });
      
      list.appendChild(li);
    });
  }
  
  private async reorderItems(type: string, draggedId: string, targetId: string): Promise<void> {
    const items = (this.state as any)[type] as any[];
    const draggedIndex = items.findIndex(i => i.id === draggedId);
    const targetIndex = items.findIndex(i => i.id === targetId);
    
    if (draggedIndex === -1 || targetIndex === -1) return;
    
    const [draggedItem] = items.splice(draggedIndex, 1);
    items.splice(targetIndex, 0, draggedItem);
    
    // Re-render
    this.renderItemsListExtended(type, items);
    this.showToast(i18n.t('settings.orderChanged'), 'success');
  }
  
  private showTagPicker(target: HTMLElement, itemId: string, type: string): void {
    document.querySelector('.tag-picker')?.remove();
    
    const picker = document.createElement('div');
    picker.className = 'tag-picker';
    
    const rect = target.getBoundingClientRect();
    picker.style.left = `${rect.left}px`;
    picker.style.top = `${rect.bottom + 5}px`;
    
    // No tag option
    const noTag = document.createElement('div');
    noTag.className = 'tag-option no-tag';
    noTag.innerHTML = '✕';
    noTag.title = i18n.t('settings.removeTag');
    noTag.addEventListener('click', () => {
      this.itemTags.delete(itemId);
      this.saveItemTags();
      this.renderItemsListExtended(type, (this.state as any)[type]);
      picker.remove();
    });
    picker.appendChild(noTag);
    
    // Color options
    this.TAG_COLORS.forEach(color => {
      const option = document.createElement('div');
      option.className = 'tag-option';
      option.style.background = color;
      if (this.itemTags.get(itemId) === color) option.classList.add('selected');
      option.addEventListener('click', () => {
        this.itemTags.set(itemId, color);
        this.saveItemTags();
        this.renderItemsListExtended(type, (this.state as any)[type]);
        picker.remove();
      });
      picker.appendChild(option);
    });
    
    document.body.appendChild(picker);
    
    // Close on click outside
    setTimeout(() => {
      document.addEventListener('click', function closeHandler(e) {
        if (!picker.contains(e.target as Node)) {
          picker.remove();
          document.removeEventListener('click', closeHandler);
        }
      });
    }, 10);
  }
  
  private async saveItemTags(): Promise<void> {
    await db.setPreference('itemTags', [...this.itemTags]);
  }
  
  private async loadItemTags(): Promise<void> {
    try {
      const saved = await db.getPreference('itemTags');
      if (saved && Array.isArray(saved)) {
        this.itemTags = new Map(saved);
      }
    } catch (e) {
      console.warn('Failed to load item tags:', e);
    }
  }
  
  private updateBulkDeleteButton(): void {
    const totalSelected = Array.from(this.selectedItems.values()).reduce((sum, set) => sum + set.size, 0);
    const btn = document.getElementById('bulkDeleteProjects') as HTMLButtonElement;
    if (btn) {
      btn.disabled = totalSelected === 0;
      btn.querySelector('span')!.textContent = totalSelected > 0 ? i18n.t('settings.deleteSelectedN').replace('{0}', totalSelected.toString()) : i18n.t('settings.deleteSelected');
    }
  }
  
  private setupProjectsEventListeners(): void {
    // Search
    document.getElementById('projectsSearch')?.addEventListener('input', (e) => {
      this.projectsSearchQuery = (e.target as HTMLInputElement).value;
      this.renderProjectsView();
    });
    
    // Filter
    document.getElementById('projectsFilter')?.addEventListener('change', (e) => {
      this.projectsFilter = (e.target as HTMLSelectElement).value as any;
      this.renderProjectsView();
    });
    
    // Bulk delete
    document.getElementById('bulkDeleteProjects')?.addEventListener('click', () => this.bulkDeleteItems());
    
    // Export CSV
    document.getElementById('exportProjectsCSV')?.addEventListener('click', () => this.exportAllProjectsCSV());
    
    // Individual category exports
    ['customers', 'types', 'parts', 'tests'].forEach(type => {
      document.getElementById(`export${type.charAt(0).toUpperCase() + type.slice(1)}CSV`)?.addEventListener('click', () => {
        this.exportCategoryCSV(type);
      });
    });
    
    // Check all checkboxes
    ['Customers', 'Types', 'Parts', 'Tests'].forEach(type => {
      document.getElementById(`checkAll${type}`)?.addEventListener('change', (e) => {
        const checked = (e.target as HTMLInputElement).checked;
        const lowerType = type.toLowerCase();
        const items = (this.state as any)[lowerType] as any[];
        
        if (checked) {
          items.forEach(item => this.selectedItems.get(lowerType)?.add(item.id));
        } else {
          this.selectedItems.get(lowerType)?.clear();
        }
        
        this.renderItemsListExtended(lowerType, items);
        this.updateBulkDeleteButton();
      });
    });
  }
  
  private async bulkDeleteItems(): Promise<void> {
    const totalSelected = Array.from(this.selectedItems.values()).reduce((sum, set) => sum + set.size, 0);
    
    if (totalSelected === 0) return;
    
    if (!confirm(i18n.t('schedule.confirmBulkDelete').replace('{0}', String(totalSelected)))) return;
    
    for (const [type, ids] of this.selectedItems) {
      for (const id of ids) {
        await this.deleteItem(type, id, false);
      }
      ids.clear();
    }
    
    await this.loadData();
    this.renderProjectsView();
    this.showToast(i18n.t('settings.deletedNItems').replace('{0}', totalSelected.toString()), 'success');
  }
  
  private exportCategoryCSV(type: string): void {
    const items = (this.state as any)[type] as any[];
    let csv = `${i18n.t('settings.csvHeaderName')},${i18n.t('settings.csvHeaderCreated')},${i18n.t('settings.csvHeaderProjectCount')}\n`;
    
    items.forEach(item => {
      const usage = this.getItemUsageCount(type, item.id);
      const date = item.createdAt ? new Date(item.createdAt).toLocaleDateString(i18n.getDateLocale()) : '-';
      csv += `"${item.name}","${date}",${usage}\n`;
    });
    
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${type}_export_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    
    this.showToast(i18n.t('messages.exportedType').replace('{0}', type), 'success');
  }
  
  private exportAllProjectsCSV(): void {
    let csv = `${i18n.t('settings.csvHeaderCategory')},${i18n.t('settings.csvHeaderName')},${i18n.t('settings.csvHeaderCreated')},${i18n.t('settings.csvHeaderProjectCount')}\n`;
    
    ['customers', 'types', 'parts', 'tests'].forEach(type => {
      const items = (this.state as any)[type] as any[];
      items.forEach(item => {
        const usage = this.getItemUsageCount(type, item.id);
        const date = item.createdAt ? new Date(item.createdAt).toLocaleDateString(i18n.getDateLocale()) : '-';
        csv += `"${type}","${item.name}","${date}",${usage}\n`;
      });
    });
    
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `all_projects_export_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    
    this.showToast(i18n.t('messages.exportedAll'), 'success');
  }
  
  private importProjectsCSV(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      
      const text = await file.text();
      const lines = text.split('\n').slice(1); // Skip header
      
      let imported = 0;
      for (const line of lines) {
        if (!line.trim()) continue;
        
        const parts = line.match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g);
        if (!parts || parts.length < 2) continue;
        
        const category = parts[0].replace(/"/g, '').trim().toLowerCase();
        const name = parts[1].replace(/"/g, '').trim();
        
        if (!['customers', 'types', 'parts', 'tests'].includes(category) || !name) continue;
        
        // Check if already exists
        const items = (this.state as any)[category] as any[];
        if (items.some(i => i.name.toLowerCase() === name.toLowerCase())) continue;
        
        const newItem: any = {
          id: this.generateId(),
          name,
          createdAt: Date.now()
        };
        
        if (category === 'tests') {
          newItem.color = TEST_COLORS[this.state.tests.length % TEST_COLORS.length];
        }
        
        await db.put(category, newItem);
        imported++;
      }
      
      if (imported > 0) {
        await this.loadData();
        this.renderProjectsView();
        this.showToast(i18n.t('settings.importedNItems').replace('{0}', imported.toString()), 'success');
      } else {
        this.showToast(i18n.t('settings.noNewItems'), 'warning');
      }
    };
    input.click();
  }
  
  private renderProjectsTree(): void {
    const container = document.getElementById('projectsTree');
    if (!container) return;
    
    container.innerHTML = '';
    
    // Group projects by customer -> type -> part -> test with IDs for colors
    interface TreeData {
      id: string;
      name: string;
      children: Map<string, TreeData>;
      tests?: Set<{id: string; name: string; color?: string}>;
    }
    
    const tree = new Map<string, TreeData>();
    
    this.state.projects.forEach(project => {
      const customerObj = this.state.customers.find(c => c.id === project.customer_id);
      const typeObj = this.state.types.find(t => t.id === project.type_id);
      const partObj = this.state.parts.find(p => p.id === project.part_id);
      const testObj = this.state.tests.find(t => t.id === project.test_id);
      
      if (!customerObj || !typeObj || !partObj || !testObj) return;
      
      const customerId = customerObj.id;
      const typeId = typeObj.id;
      const partId = partObj.id;
      
      if (!tree.has(customerId)) {
        tree.set(customerId, { id: customerId, name: customerObj.name, children: new Map() });
      }
      
      const customerNode = tree.get(customerId)!;
      if (!customerNode.children.has(typeId)) {
        customerNode.children.set(typeId, { id: typeId, name: typeObj.name, children: new Map() });
      }
      
      const typeNode = customerNode.children.get(typeId)!;
      if (!typeNode.children.has(partId)) {
        typeNode.children.set(partId, { id: partId, name: partObj.name, children: new Map(), tests: new Set() });
      }
      
      const partNode = typeNode.children.get(partId)!;
      partNode.tests!.add({ id: testObj.id, name: testObj.name, color: testObj.color });
    });
    
    if (tree.size === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48" style="margin-bottom: 16px; opacity: 0.5">
            <circle cx="12" cy="5" r="3"/><line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="12" x2="6" y2="16"/><line x1="12" y1="12" x2="18" y2="16"/>
            <circle cx="6" cy="19" r="3"/><circle cx="18" cy="19" r="3"/>
          </svg>
          <p>${i18n.t('schedule.noProjectsTree')}</p>
          <p style="font-size: 0.85rem; margin-top: 8px;">${i18n.t('stats.addProjectsHint')}</p>
        </div>`;
      return;
    }
    
    // Render tree with proper nesting
    tree.forEach((customerData) => {
      const customerWrapper = document.createElement('div');
      customerWrapper.className = 'tree-node tree-root';
      
      const customerTag = this.itemTags.get(customerData.id);
      const customerItem = this.createTreeItemElement('customer', customerData.name, customerData.children.size, customerTag);
      customerWrapper.appendChild(customerItem);
      
      const customerChildren = document.createElement('div');
      customerChildren.className = 'tree-children';
      
      customerData.children.forEach((typeData) => {
        const typeWrapper = document.createElement('div');
        typeWrapper.className = 'tree-node';
        
        const typeTag = this.itemTags.get(typeData.id);
        const typeItem = this.createTreeItemElement('type', typeData.name, typeData.children.size, typeTag);
        typeWrapper.appendChild(typeItem);
        
        const typeChildren = document.createElement('div');
        typeChildren.className = 'tree-children';
        
        typeData.children.forEach((partData) => {
          const partWrapper = document.createElement('div');
          partWrapper.className = 'tree-node';
          
          const partTag = this.itemTags.get(partData.id);
          const partItem = this.createTreeItemElement('part', partData.name, partData.tests!.size, partTag);
          partWrapper.appendChild(partItem);
          
          const partChildren = document.createElement('div');
          partChildren.className = 'tree-children';
          
          partData.tests!.forEach(testData => {
            const testWrapper = document.createElement('div');
            testWrapper.className = 'tree-node';
            
            const testItem = this.createTreeItemElement('test', testData.name, 0, testData.color, true);
            testWrapper.appendChild(testItem);
            
            partChildren.appendChild(testWrapper);
          });
          
          partWrapper.appendChild(partChildren);
          typeChildren.appendChild(partWrapper);
        });
        
        typeWrapper.appendChild(typeChildren);
        customerChildren.appendChild(typeWrapper);
      });
      
      customerWrapper.appendChild(customerChildren);
      container.appendChild(customerWrapper);
    });
  }
  
  private createTreeItemElement(type: string, label: string, count: number, color?: string, isLeaf: boolean = false): HTMLElement {
    const item = document.createElement('div');
    item.className = 'tree-item';
    
    const toggleHtml = !isLeaf ? `
      <div class="tree-toggle">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </div>
    ` : '<div style="width:20px"></div>';
    
    const icons: Record<string, string> = {
      customer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>',
      type: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>',
      part: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
      test: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>'
    };
    
    const colorBadge = color ? `<span class="tree-color-badge" style="background: ${color}"></span>` : '';
    
    item.innerHTML = `
      ${toggleHtml}
      <div class="tree-icon ${type}">${icons[type] || ''}</div>
      ${colorBadge}
      <span class="tree-label">${label}</span>
      ${count > 0 ? `<span class="tree-count">${count}</span>` : ''}
    `;
    
    if (!isLeaf) {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        // Toggle expanded class on parent tree-node
        const treeNode = item.closest('.tree-node');
        if (treeNode) {
          treeNode.classList.toggle('expanded');
          item.classList.toggle('expanded'); // Also keep on item for styling
        }
      });
    }
    
    return item;
  }
  
  private createTreeNode(type: string, label: string, count: number, isLeaf: boolean = false): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = `tree-node ${type === 'customer' ? 'tree-root' : ''}`;
    const item = this.createTreeItemElement(type, label, count, undefined, isLeaf);
    wrapper.appendChild(item);
    return wrapper;
  }

  private renderItemsList(type: string, items: any[]): void {
    // Redirect to extended version
    this.renderItemsListExtended(type, items);
  }

  private renderAnalyticsView(): void {
    this.updateStatistics();
    this.renderCharts();
    this.renderAnalyticsTable();
    this.renderWeeklyComparison();
    this.setupAnalyticsEventListeners();
    // Advanced Analytics
    this.renderAdvancedAnalytics();
    // AI Insights
    this.renderAIInsights();
    // New charts
    this.renderVelocityChart();
    this.renderRadarChart();
  }

  private analyticsOptionsUnlocked: boolean = false;
  private projectStoppages: Map<string, Set<string>> = new Map(); // projectId -> Set of weeks
  private analyticsWeekFrom: number = 1;
  private analyticsWeekTo: number = 52;
  private velocityChart: Chart | null = null;
  private radarChart: Chart | null = null;

  private setupAnalyticsEventListeners(): void {
    // Initialize week filter dropdowns
    this.initWeekFilters();
    
    // Unlock options button
    document.getElementById('unlockAnalyticsOptions')?.addEventListener('click', async () => {
      if (this.state.settings.deletePassword) {
        const password = prompt(i18n.t('planning.enterPassword'));
        if (password !== this.state.settings.deletePassword) {
          this.showToast(i18n.t('planning.invalidPassword'), 'error');
          return;
        }
      }
      this.analyticsOptionsUnlocked = !this.analyticsOptionsUnlocked;
      this.toggleAnalyticsOptions();
    });

    // Export dropdown toggle
    const exportBtn = document.getElementById('exportAnalyticsBtn');
    const exportDropdownContainer = exportBtn?.closest('.export-dropdown-container');
    
    exportBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      exportDropdownContainer?.classList.toggle('open');
    });
    
    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (exportDropdownContainer && !exportDropdownContainer.contains(e.target as Node)) {
        exportDropdownContainer.classList.remove('open');
      }
    });
    
    // Export to PDF button
    document.getElementById('exportToPdf')?.addEventListener('click', () => {
      exportDropdownContainer?.classList.remove('open');
      this.exportAnalyticsToPdf();
    });
    
    // Export to Excel button
    document.getElementById('exportToExcel')?.addEventListener('click', () => {
      exportDropdownContainer?.classList.remove('open');
      this.exportAnalyticsToExcel();
    });

    // Legacy export analytics button (fallback)
    document.getElementById('exportAnalytics')?.addEventListener('click', () => this.exportData());

    // Filter status
    document.getElementById('analyticsFilterStatus')?.addEventListener('change', () => {
      this.renderAnalyticsTable();
    });
    
    // Apply date filter button
    document.getElementById('applyDateFilter')?.addEventListener('click', () => {
      this.applyAnalyticsDateFilter();
    });
  }

  private initWeekFilters(): void {
    const fromSelect = document.getElementById('analyticsWeekFrom') as HTMLSelectElement;
    const toSelect = document.getElementById('analyticsWeekTo') as HTMLSelectElement;
    const yearSelect = document.getElementById('analyticsFilterYear') as HTMLSelectElement;
    const yearInfo = document.getElementById('analyticsYearInfo');
    
    if (!fromSelect || !toSelect) return;
    
    // Initialize year select
    if (yearSelect) {
      yearSelect.innerHTML = '';
      const currentYear = new Date().getFullYear();
      for (let y = currentYear - 2; y <= currentYear + 1; y++) {
        const opt = document.createElement('option');
        opt.value = y.toString();
        opt.textContent = y.toString();
        if (y === this.state.selectedYear) opt.selected = true;
        yearSelect.appendChild(opt);
      }
      
      // Sync with global year
      yearSelect.value = this.state.selectedYear.toString();
      
      // Add change listener
      yearSelect.addEventListener('change', () => {
        this.state.selectedYear = parseInt(yearSelect.value);
        // Also update global filter if exists
        const globalYearFilter = document.getElementById('filterYear') as HTMLSelectElement;
        if (globalYearFilter) globalYearFilter.value = yearSelect.value;
        // Reset week filters for new year
        this.resetWeekFiltersForYear();
        // Refresh all analytics
        this.renderAnalyticsView();
        this.showToast(`Rok zmieniony na ${yearSelect.value}`, 'success');
      });
    }
    
    // Update year info display
    if (yearInfo) {
      const currentWeek = this.getCurrentWeek();
      yearInfo.textContent = i18n.t('planning.yearInfoDisplay').replace('{0}', this.state.selectedYear.toString()).replace('{1}', currentWeek.toString().padStart(2, '0'));
    }
    
    // Clear existing options (except first "All" option if present)
    fromSelect.innerHTML = '';
    toSelect.innerHTML = '';
    
    // Populate options KW01-KW52
    for (let i = 1; i <= 52; i++) {
      const weekKey = `KW${i.toString().padStart(2, '0')}`;
      const optionFrom = document.createElement('option');
      optionFrom.value = i.toString();
      optionFrom.textContent = weekKey;
      fromSelect.appendChild(optionFrom);
      
      const optionTo = document.createElement('option');
      optionTo.value = i.toString();
      optionTo.textContent = weekKey;
      toSelect.appendChild(optionTo);
    }
    
    // Set defaults based on current year or show full year for past years
    const currentYear = new Date().getFullYear();
    const currentWeek = this.getCurrentWeek();
    
    if (this.state.selectedYear === currentYear) {
      // Current year: KW01 to current week
      fromSelect.value = '1';
      toSelect.value = currentWeek.toString();
      this.analyticsWeekFrom = 1;
      this.analyticsWeekTo = currentWeek;
    } else if (this.state.selectedYear < currentYear) {
      // Past year: show full year
      fromSelect.value = '1';
      toSelect.value = '52';
      this.analyticsWeekFrom = 1;
      this.analyticsWeekTo = 52;
    } else {
      // Future year: KW01 to KW01
      fromSelect.value = '1';
      toSelect.value = '1';
      this.analyticsWeekFrom = 1;
      this.analyticsWeekTo = 1;
    }
  }

  private resetWeekFiltersForYear(): void {
    const fromSelect = document.getElementById('analyticsWeekFrom') as HTMLSelectElement;
    const toSelect = document.getElementById('analyticsWeekTo') as HTMLSelectElement;
    
    if (!fromSelect || !toSelect) return;
    
    const currentYear = new Date().getFullYear();
    const currentWeek = this.getCurrentWeek();
    
    if (this.state.selectedYear === currentYear) {
      fromSelect.value = '1';
      toSelect.value = currentWeek.toString();
      this.analyticsWeekFrom = 1;
      this.analyticsWeekTo = currentWeek;
    } else if (this.state.selectedYear < currentYear) {
      fromSelect.value = '1';
      toSelect.value = '52';
      this.analyticsWeekFrom = 1;
      this.analyticsWeekTo = 52;
    } else {
      fromSelect.value = '1';
      toSelect.value = '1';
      this.analyticsWeekFrom = 1;
      this.analyticsWeekTo = 1;
    }
    
    // Update year info
    const yearInfo = document.getElementById('analyticsYearInfo');
    if (yearInfo) {
      yearInfo.textContent = i18n.t('planning.yearInfoDisplay').replace('{0}', this.state.selectedYear.toString()).replace('{1}', currentWeek.toString().padStart(2, '0'));
    }
  }

  private applyAnalyticsDateFilter(): void {
    const fromSelect = document.getElementById('analyticsWeekFrom') as HTMLSelectElement;
    const toSelect = document.getElementById('analyticsWeekTo') as HTMLSelectElement;
    
    if (!fromSelect || !toSelect) return;
    
    const fromWeek = parseInt(fromSelect.value) || 1;
    const toWeek = parseInt(toSelect.value) || 52;
    
    if (fromWeek > toWeek) {
      this.showToast(i18n.t('planning.dateRangeError'), 'error');
      return;
    }
    
    this.analyticsWeekFrom = fromWeek;
    this.analyticsWeekTo = toWeek;
    
    // Re-render all analytics with new filter
    this.updateStatistics();
    this.renderCharts();
    this.renderAnalyticsTable();
    this.renderAdvancedAnalytics();
    
    this.showToast(`Filtr zastosowany: KW${fromWeek.toString().padStart(2, '0')} - KW${toWeek.toString().padStart(2, '0')}`, 'success');
  }

  private isWeekInFilter(weekKey: string): boolean {
    const match = weekKey.match(/KW(\d+)/);
    if (!match) return false;
    const weekNum = parseInt(match[1]);
    return weekNum >= this.analyticsWeekFrom && weekNum <= this.analyticsWeekTo;
  }

  // Helper to get week data with year-aware key lookup
  private getWeekData(project: Project, weekKey: string): { ist: number; soll: number; stoppage?: boolean; productionLack?: boolean } {
    // Try year-prefixed key first (e.g., "2026-KW05")
    const yearWeekKey = `${this.state.selectedYear}-${weekKey}`;
    if (project.weeks[yearWeekKey]) {
      return project.weeks[yearWeekKey];
    }
    // Fallback to old format (KW05) for backwards compatibility with unmigrated data
    if (project.weeks[weekKey]) {
      return project.weeks[weekKey];
    }
    return { ist: 0, soll: 0 };
  }

  // Helper to iterate over all weeks of a project for the selected year
  private getProjectWeekEntries(project: Project): Array<[string, { ist: number; soll: number; stoppage?: boolean; productionLack?: boolean }]> {
    const entries: Array<[string, { ist: number; soll: number; stoppage?: boolean; productionLack?: boolean }]> = [];
    for (let w = 1; w <= 52; w++) {
      const weekKey = `KW${w.toString().padStart(2, '0')}`;
      const data = this.getWeekData(project, weekKey);
      if (data.ist > 0 || data.soll > 0) {
        entries.push([weekKey, data]);
      }
    }
    return entries;
  }

  private toggleAnalyticsOptions(): void {
    const optionsCols = document.querySelectorAll('.analytics-options-col');
    const unlockBtn = document.getElementById('unlockAnalyticsOptions');
    
    optionsCols.forEach(col => {
      col.classList.toggle('hidden', !this.analyticsOptionsUnlocked);
    });

    if (unlockBtn) {
      unlockBtn.innerHTML = this.analyticsOptionsUnlocked 
        ? `<svg class="btn-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 9.9-1"/>
          </svg><span>Zablokuj</span>`
        : `<svg class="btn-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg><span>Odblokuj opcje</span>`;
    }
  }

  private analyticsSortColumn: string = '';
  private analyticsSortDirection: 'asc' | 'desc' = 'asc';

  private renderAnalyticsTable(): void {
    const tbody = document.getElementById('analyticsTableBody');
    if (!tbody) return;

    const filterStatus = (document.getElementById('analyticsFilterStatus') as HTMLSelectElement)?.value || 'all';

    tbody.innerHTML = '';

    // Prepare data with calculated values
    const projectsData = this.state.projects.map((project) => {
      const customer = this.state.customers.find(c => c.id === project.customer_id);
      const type = this.state.types.find(t => t.id === project.type_id);
      const part = this.state.parts.find(p => p.id === project.part_id);
      const test = this.state.tests.find(t => t.id === project.test_id);

      let totalIst = 0;
      let totalSoll = 0;
      let hasStoppage = this.projectStoppages.has(project.id);

      for (let w = 1; w <= 52; w++) {
        const weekKey = `KW${w.toString().padStart(2, '0')}`;
        if (!this.isWeekInFilter(weekKey)) continue;
        const data = this.getWeekData(project, weekKey);
        totalIst += data.ist;
        totalSoll += data.soll;
      }

      const percentage = totalSoll > 0 ? Math.round((totalIst / totalSoll) * 100) : 0;
      
      let status: 'complete' | 'partial' | 'zero' | 'stoppage' = 'zero';
      if (hasStoppage) status = 'stoppage';
      else if (totalSoll === 0) status = 'zero';
      else if (totalIst >= totalSoll) status = 'complete';
      else if (totalIst > 0) status = 'partial';

      return {
        project,
        customer: customer?.name || '-',
        type: type?.name || '-',
        part: part?.name || '-',
        test: test?.name || '-',
        testColor: (test as any)?.color || '#0097AC',
        totalIst,
        totalSoll,
        percentage,
        status,
        hasStoppage
      };
    });

    // Apply filter
    let filteredData = projectsData.filter(d => filterStatus === 'all' || filterStatus === d.status);

    // Apply sorting
    if (this.analyticsSortColumn) {
      filteredData.sort((a, b) => {
        let valA: any, valB: any;
        switch (this.analyticsSortColumn) {
          case 'customer': valA = a.customer; valB = b.customer; break;
          case 'type': valA = a.type; valB = b.type; break;
          case 'part': valA = a.part; valB = b.part; break;
          case 'test': valA = a.test; valB = b.test; break;
          case 'ist': valA = a.totalIst; valB = b.totalIst; break;
          case 'soll': valA = a.totalSoll; valB = b.totalSoll; break;
          case 'percent': valA = a.percentage; valB = b.percentage; break;
          default: return 0;
        }
        if (typeof valA === 'string') {
          return this.analyticsSortDirection === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        }
        return this.analyticsSortDirection === 'asc' ? valA - valB : valB - valA;
      });
    }

    // Update header sort indicators
    document.querySelectorAll('.th-sortable').forEach(th => {
      th.classList.remove('sort-asc', 'sort-desc');
      if ((th as HTMLElement).dataset.sort === this.analyticsSortColumn) {
        th.classList.add(this.analyticsSortDirection === 'asc' ? 'sort-asc' : 'sort-desc');
      }
    });

    // Render rows
    filteredData.forEach((d) => {
      const tr = document.createElement('tr');
      tr.dataset.projectId = d.project.id;
      
      // Row color based on percentage
      let rowClass = '';
      if (d.totalSoll > 0) {
        if (d.percentage >= 100) rowClass = 'row-success';
        else if (d.percentage >= 80) rowClass = 'row-good';
        else if (d.percentage >= 50) rowClass = 'row-warning';
        else rowClass = 'row-danger';
      }
      tr.className = rowClass;
      
      tr.innerHTML = `
        <td class="td-sticky">${d.customer}</td>
        <td>${d.type}</td>
        <td>${d.part}</td>
        <td>
          <span class="test-badge" style="background: ${d.testColor}">
            ${d.test}
          </span>
        </td>
        <td class="status-cell">
          ${this.getStatusSvg(d.status)}
        </td>
        <td class="ist-cell">${d.totalIst}</td>
        <td class="soll-cell">${d.totalSoll}</td>
        <td class="percentage-cell ${d.percentage >= 100 ? 'pct-100' : d.percentage > 0 ? 'pct-partial' : 'pct-zero'}">
          ${d.totalSoll > 0 ? d.percentage + '%' : '-'}
        </td>
        <td class="analytics-options-col ${this.analyticsOptionsUnlocked ? '' : 'hidden'}">
          <div class="options-cell">
            <button class="btn-option btn-stoppage ${d.hasStoppage ? 'active' : ''}" title="${i18n.t('planning.markStoppage')}" data-project-id="${d.project.id}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
              </svg>
            </button>
            <button class="btn-option btn-details" title="${i18n.t('schedule.wizardStepDetails')}" data-project-id="${d.project.id}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="16" x2="12" y2="12"/>
                <line x1="12" y1="8" x2="12.01" y2="8"/>
              </svg>
            </button>
          </div>
        </td>
      `;

      tbody.appendChild(tr);
    });

    // Add event listeners for stoppage buttons
    document.querySelectorAll('.btn-stoppage').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const projectId = (e.currentTarget as HTMLElement).dataset.projectId;
        if (projectId) this.showStoppagePopup(projectId, e as MouseEvent);
      });
    });

    // Add event listeners for sorting
    document.querySelectorAll('.th-sortable').forEach(th => {
      th.addEventListener('click', () => {
        const sortKey = (th as HTMLElement).dataset.sort;
        if (!sortKey) return;
        
        if (this.analyticsSortColumn === sortKey) {
          this.analyticsSortDirection = this.analyticsSortDirection === 'asc' ? 'desc' : 'asc';
        } else {
          this.analyticsSortColumn = sortKey;
          this.analyticsSortDirection = 'asc';
        }
        this.renderAnalyticsTable();
      });
    });
  }

  private getStatusSvg(status: 'complete' | 'partial' | 'zero' | 'stoppage'): string {
    switch (status) {
      case 'complete':
        return `<svg class="status-icon-svg status-complete" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10" fill="currentColor" opacity="0.15"/>
          <polyline points="20 6 9 17 4 12" fill="none"/>
        </svg>`;
      case 'partial':
        return `<svg class="status-icon-svg status-partial" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" fill="currentColor" opacity="0.15"/>
          <line x1="12" y1="9" x2="12" y2="13"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>`;
      case 'zero':
        return `<svg class="status-icon-svg status-zero" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10" fill="currentColor" opacity="0.15"/>
          <line x1="15" y1="9" x2="9" y2="15"/>
          <line x1="9" y1="9" x2="15" y2="15"/>
        </svg>`;
      case 'stoppage':
        return `<svg class="status-icon-svg status-stoppage" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10" fill="currentColor" opacity="0.15"/>
          <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
        </svg>`;
    }
  }

  private showStoppagePopup(projectId: string, event: MouseEvent): void {
    // Remove existing popup
    document.querySelector('.stoppage-popup')?.remove();

    const project = this.state.projects.find(p => p.id === projectId);
    if (!project) return;

    const currentWeek = this.getCurrentWeek();
    const stoppages = this.projectStoppages.get(projectId) || new Set();

    const popup = document.createElement('div');
    popup.className = 'stoppage-popup';
    popup.style.left = `${event.clientX}px`;
    popup.style.top = `${event.clientY}px`;

    popup.innerHTML = `
      <div class="stoppage-popup-header">
        <h4>🚫 ${i18n.t('planning.stoppageLabel')}</h4>
        <button class="stoppage-popup-close">✕</button>
      </div>
      <div class="stoppage-options">
        <button class="stoppage-option ${stoppages.has(`KW${currentWeek.toString().padStart(2, '0')}`) ? 'active' : ''}" data-week="${currentWeek}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
          </svg>
          ${i18n.t('planning.noProductionThisWeek').replace('{0}', currentWeek.toString().padStart(2, '0'))}
        </button>
        <button class="stoppage-option ${stoppages.size > 0 ? 'active' : ''}" data-action="toggle-all">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <line x1="9" y1="9" x2="15" y2="15"/>
            <line x1="15" y1="9" x2="9" y2="15"/>
          </svg>
          ${stoppages.size > 0 ? i18n.t('planning.removeStoppage') : i18n.t('planning.markAsStopped')}
        </button>
      </div>
    `;

    document.body.appendChild(popup);

    // Close popup
    popup.querySelector('.stoppage-popup-close')?.addEventListener('click', () => popup.remove());

    // Handle week stoppage
    popup.querySelectorAll('.stoppage-option').forEach(option => {
      option.addEventListener('click', () => {
        const week = (option as HTMLElement).dataset.week;
        const action = (option as HTMLElement).dataset.action;

        if (week) {
          const weekKey = `KW${week.padStart(2, '0')}`;
          if (!this.projectStoppages.has(projectId)) {
            this.projectStoppages.set(projectId, new Set());
          }
          const weekSet = this.projectStoppages.get(projectId)!;
          if (weekSet.has(weekKey)) {
            weekSet.delete(weekKey);
          } else {
            weekSet.add(weekKey);
          }
        } else if (action === 'toggle-all') {
          if (this.projectStoppages.has(projectId) && this.projectStoppages.get(projectId)!.size > 0) {
            this.projectStoppages.delete(projectId);
          } else {
            this.projectStoppages.set(projectId, new Set(['all']));
          }
        }

        popup.remove();
        this.renderAnalyticsTable();
        this.showToast('Status postoju zaktualizowany', 'success');
      });
    });

    // Close on click outside
    setTimeout(() => {
      document.addEventListener('click', (e) => {
        if (!popup.contains(e.target as Node)) {
          popup.remove();
        }
      }, { once: true });
    }, 100);
  }

  private renderWeeklyComparison(): void {
    const grid = document.getElementById('weeklyComparisonGrid');
    if (!grid) return;

    grid.innerHTML = '';

    const weeklyData: { [week: string]: { ist: number; soll: number } } = {};
    for (let i = 1; i <= 52; i++) {
      weeklyData[`KW${i.toString().padStart(2, '0')}`] = { ist: 0, soll: 0 };
    }

    // Use year-aware week data lookup
    this.state.projects.forEach((project) => {
      for (let i = 1; i <= 52; i++) {
        const weekKey = `KW${i.toString().padStart(2, '0')}`;
        const data = this.getWeekData(project, weekKey);
        weeklyData[weekKey].ist += data.ist;
        weeklyData[weekKey].soll += data.soll;
      }
    });

    const currentWeek = this.getCurrentWeek();

    Object.entries(weeklyData).forEach(([week, data]) => {
      const weekNum = parseInt(week.replace('KW', ''));
      let status = 'empty';
      
      if (data.soll === 0 && data.ist === 0) {
        status = 'empty';
      } else if (data.ist >= data.soll) {
        status = 'complete';
      } else if (data.ist > 0) {
        status = 'partial';
      } else {
        status = 'zero';
      }

      const cell = document.createElement('div');
      cell.className = `week-comparison-cell status-${status} ${weekNum === currentWeek ? 'current-week' : ''}`;
      cell.innerHTML = `
        <span class="week-label">${week}</span>
        <span class="week-values">${data.ist}/${data.soll}</span>
        <span class="status-indicator">${this.getSmallStatusSvg(status as any)}</span>
      `;
      
      cell.addEventListener('mouseenter', () => {
        this.showWeekTooltip(cell, week, data);
      });
      
      cell.addEventListener('mouseleave', () => {
        document.querySelector('.week-tooltip')?.remove();
      });

      grid.appendChild(cell);
    });
  }

  private getSmallStatusSvg(status: 'complete' | 'partial' | 'zero' | 'empty'): string {
    if (status === 'empty') return '';
    
    switch (status) {
      case 'complete':
        return `<svg viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" stroke-width="3">
          <polyline points="20 6 9 17 4 12"/>
        </svg>`;
      case 'partial':
        return `<svg viewBox="0 0 24 24" fill="none" stroke="var(--color-warning)" stroke-width="3">
          <line x1="12" y1="5" x2="12" y2="14"/>
          <line x1="12" y1="18" x2="12.01" y2="18"/>
        </svg>`;
      case 'zero':
        return `<svg viewBox="0 0 24 24" fill="none" stroke="var(--color-danger)" stroke-width="3">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>`;
    }
    return '';
  }

  private showWeekTooltip(element: HTMLElement, week: string, data: { ist: number; soll: number }): void {
    document.querySelector('.week-tooltip')?.remove();
    
    const tooltip = document.createElement('div');
    tooltip.className = 'stoppage-popup week-tooltip';
    
    const rect = element.getBoundingClientRect();
    tooltip.style.left = `${rect.right + 10}px`;
    tooltip.style.top = `${rect.top}px`;
    
    const percentage = data.soll > 0 ? Math.round((data.ist / data.soll) * 100) : 0;
    
    tooltip.innerHTML = `
      <div class="stoppage-popup-header" style="border-bottom: none; padding-bottom: 0; margin-bottom: 0;">
        <h4>${week}</h4>
      </div>
      <div style="padding: 8px 0; font-size: 0.85rem;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
          <span>IST:</span> <strong>${data.ist}</strong>
        </div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
          <span>SOLL:</span> <strong>${data.soll}</strong>
        </div>
        <div style="display: flex; justify-content: space-between; padding-top: 8px; border-top: 1px solid var(--color-border);">
          <span>Status:</span> <strong class="${percentage >= 100 ? 'pct-100' : percentage > 0 ? 'pct-partial' : 'pct-zero'}">${percentage}%</strong>
        </div>
      </div>
    `;
    
    document.body.appendChild(tooltip);
  }

  private updateStatistics(): void {
    const totalProjects = this.state.projects.length;
    let completedTests = 0;
    let pendingTests = 0;
    let overdueTests = 0;
    let totalTests = 0;

    const currentWeek = this.getCurrentWeek();

    this.state.projects.forEach((project) => {
      // Use year-aware week data lookup
      for (let w = 1; w <= 52; w++) {
        const weekKey = `KW${w.toString().padStart(2, '0')}`;
        // Apply week filter
        if (!this.isWeekInFilter(weekKey)) continue;
        
        const data = this.getWeekData(project, weekKey);
        if (data.soll === 0) continue;
        
        totalTests++;
        
        if (data.ist >= data.soll) {
          completedTests++;
        } else if (w < currentWeek) {
          overdueTests++;
        } else {
          pendingTests++;
        }
      }
    });

    const set = (id: string, val: number) => {
      const el = document.getElementById(id);
      if (el) {
        // Animate the number
        const current = parseInt(el.textContent || '0');
        if (current !== val) {
          this.animateNumber(el, current, val, 500);
        }
      }
    };
    
    set('totalProjects', totalProjects);
    set('completedTests', completedTests);
    set('pendingTests', pendingTests);
    set('overdueTests', overdueTests);

    // Update progress bars
    const total = totalTests || 1;
    this.setProgressBar('completedProgress', (completedTests / total) * 100);
    this.setProgressBar('pendingProgress', (pendingTests / total) * 100);
    this.setProgressBar('overdueProgress', (overdueTests / total) * 100);
  }

  private animateNumber(el: HTMLElement, from: number, to: number, duration: number): void {
    const start = performance.now();
    const animate = (currentTime: number) => {
      const elapsed = currentTime - start;
      const progress = Math.min(elapsed / duration, 1);
      const easeOut = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(from + (to - from) * easeOut);
      el.textContent = current.toString();
      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };
    requestAnimationFrame(animate);
  }

  private setProgressBar(id: string, percentage: number): void {
    const bar = document.getElementById(id);
    if (bar) {
      setTimeout(() => {
        bar.style.width = `${Math.min(100, percentage)}%`;
      }, 100);
    }
  }

  // ==================== AI INSIGHTS ====================
  private renderAIInsights(): void {
    const container = document.getElementById('aiInsightsList');
    if (!container) return;

    const insights: { type: 'positive' | 'negative' | 'warning' | 'info'; text: string; meta: string }[] = [];
    const currentWeek = this.getCurrentWeek();

    // Calculate various metrics
    let totalIst = 0, totalSoll = 0;
    let prevWeekIst = 0, prevWeekSoll = 0;
    let currentWeekIst = 0, currentWeekSoll = 0;
    let stoppageCount = 0;
    const customerPerformance: { [name: string]: { ist: number; soll: number } } = {};
    const testPerformance: { [name: string]: { ist: number; soll: number } } = {};

    this.state.projects.forEach(project => {
      const customer = this.state.customers.find(c => c.id === project.customer_id);
      const test = this.state.tests.find(t => t.id === project.test_id);
      const customerName = customer?.name || 'Unknown';
      const testName = test?.name || 'Unknown';

      if (!customerPerformance[customerName]) customerPerformance[customerName] = { ist: 0, soll: 0 };
      if (!testPerformance[testName]) testPerformance[testName] = { ist: 0, soll: 0 };

      for (let w = this.analyticsWeekFrom; w <= this.analyticsWeekTo; w++) {
        const weekKey = `KW${w.toString().padStart(2, '0')}`;
        const data = this.getWeekData(project, weekKey);
        totalIst += data.ist;
        totalSoll += data.soll;
        customerPerformance[customerName].ist += data.ist;
        customerPerformance[customerName].soll += data.soll;
        testPerformance[testName].ist += data.ist;
        testPerformance[testName].soll += data.soll;

        if (w === currentWeek) {
          currentWeekIst += data.ist;
          currentWeekSoll += data.soll;
        }
        if (w === currentWeek - 1) {
          prevWeekIst += data.ist;
          prevWeekSoll += data.soll;
        }
        if (data.stoppage) stoppageCount++;
      }
    });

    // Overall realization
    const overallRate = totalSoll > 0 ? Math.round((totalIst / totalSoll) * 100) : 0;
    if (overallRate >= 90) {
      insights.push({ type: 'positive', text: i18n.t('analytics.greatRealization').replace('{0}', String(overallRate)), meta: i18n.t('analytics.basedOnIstSoll') });
    } else if (overallRate >= 70) {
      insights.push({ type: 'info', text: i18n.t('analytics.realizationAtLevel').replace('{0}', String(overallRate)).replace('{1}', String(totalSoll - totalIst)), meta: i18n.t('analytics.possibleToCatchUp') });
    } else if (overallRate >= 50) {
      insights.push({ type: 'warning', text: i18n.t('analytics.attentionRealization').replace('{0}', String(overallRate)), meta: i18n.t('analytics.requiresAttention') });
    } else {
      insights.push({ type: 'negative', text: i18n.t('analytics.criticalRealization').replace('{0}', String(overallRate)), meta: i18n.t('analytics.highPriority') });
    }

    // Week over week comparison
    const currentWeekRate = currentWeekSoll > 0 ? Math.round((currentWeekIst / currentWeekSoll) * 100) : 0;
    const prevWeekRate = prevWeekSoll > 0 ? Math.round((prevWeekIst / prevWeekSoll) * 100) : 0;
    const weekChange = currentWeekRate - prevWeekRate;

    if (weekChange > 10) {
      insights.push({ type: 'positive', text: i18n.t('analytics.increaseVsPrev').replace('{0}', String(weekChange)), meta: `KW${currentWeek}: ${currentWeekRate}% vs KW${currentWeek-1}: ${prevWeekRate}%` });
    } else if (weekChange < -10) {
      insights.push({ type: 'negative', text: i18n.t('analytics.decreaseVsPrev').replace('{0}', String(Math.abs(weekChange))), meta: `KW${currentWeek}: ${currentWeekRate}% vs KW${currentWeek-1}: ${prevWeekRate}%` });
    }

    // Best/worst customer
    const customerRates = Object.entries(customerPerformance)
      .filter(([_, d]) => d.soll > 0)
      .map(([name, d]) => ({ name, rate: Math.round((d.ist / d.soll) * 100) }))
      .sort((a, b) => b.rate - a.rate);

    if (customerRates.length > 0) {
      const best = customerRates[0];
      const worst = customerRates[customerRates.length - 1];
      if (best.rate >= 90) {
        insights.push({ type: 'positive', text: i18n.t('analytics.bestClient').replace('{0}', best.name).replace('{1}', String(best.rate)), meta: i18n.t('analytics.exemplaryCooperation') });
      }
      if (worst.rate < 50 && customerRates.length > 1) {
        insights.push({ type: 'warning', text: i18n.t('analytics.needsAttention').replace('{0}', worst.name).replace('{1}', String(worst.rate)), meta: i18n.t('analytics.considerContact') });
      }
    }

    // Best/worst test type
    const testRates = Object.entries(testPerformance)
      .filter(([_, d]) => d.soll > 0)
      .map(([name, d]) => ({ name, rate: Math.round((d.ist / d.soll) * 100) }))
      .sort((a, b) => b.rate - a.rate);

    if (testRates.length > 1) {
      const best = testRates[0];
      const worst = testRates[testRates.length - 1];
      if (best.rate - worst.rate > 30) {
        insights.push({ type: 'info', text: i18n.t('analytics.bigTestDifference').replace('{0}', best.name).replace('{1}', String(best.rate)).replace('{2}', worst.name).replace('{3}', String(worst.rate)), meta: i18n.t('analytics.considerReallocation') });
      }
    }

    // Stoppage alert
    if (stoppageCount > 0) {
      insights.push({ type: 'negative', text: i18n.t('analytics.stoppageWeeksDetected').replace('{0}', String(stoppageCount)), meta: i18n.t('analytics.affectsGoalAchievement') });
    }

    // Backlog insight
    const backlog = totalSoll - totalIst;
    if (backlog > 0) {
      const weeksLeft = 52 - currentWeek;
      const avgPerWeek = weeksLeft > 0 ? Math.ceil(backlog / weeksLeft) : backlog;
      insights.push({ type: 'info', text: i18n.t('analytics.backlogInsight').replace('{0}', String(backlog)).replace('{1}', String(avgPerWeek)), meta: i18n.t('analytics.weeksRemaining').replace('{0}', String(weeksLeft)) });
    }

    // Render insights
    const iconMap = {
      positive: '↑',
      negative: '↓',
      warning: '!',
      info: 'i'
    };

    container.innerHTML = insights.slice(0, 5).map(insight => `
      <div class="ai-insight-item ${insight.type}">
        <div class="ai-insight-icon">${iconMap[insight.type]}</div>
        <div class="ai-insight-content">
          <p class="ai-insight-text">${insight.text}</p>
          <div class="ai-insight-meta">${insight.meta}</div>
        </div>
      </div>
    `).join('');
  }

  // ==================== VELOCITY CHART ====================
  private renderVelocityChart(): void {
    const canvas = document.getElementById('velocityChart') as HTMLCanvasElement;
    if (!canvas) return;

    if (this.velocityChart) this.velocityChart.destroy();

    const weeks: string[] = [];
    const velocityData: number[] = [];
    const avgLine: number[] = [];

    // Calculate velocity per week
    for (let w = this.analyticsWeekFrom; w <= this.analyticsWeekTo; w++) {
      const weekKey = `KW${w.toString().padStart(2, '0')}`;
      weeks.push(weekKey);

      let weekIst = 0;
      this.state.projects.forEach(p => {
        const data = this.getWeekData(p, weekKey);
        weekIst += data.ist;
      });
      velocityData.push(weekIst);
    }

    // Calculate moving average
    const windowSize = 4;
    for (let i = 0; i < velocityData.length; i++) {
      const start = Math.max(0, i - windowSize + 1);
      const slice = velocityData.slice(start, i + 1);
      avgLine.push(Math.round(slice.reduce((a, b) => a + b, 0) / slice.length));
    }

    const isDark = this.state.settings.darkMode;

    this.velocityChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: weeks,
        datasets: [
          {
            type: 'bar',
            label: i18n.t('analytics.chartCompletedIst'),
            data: velocityData,
            backgroundColor: 'rgba(0, 151, 172, 0.6)',
            borderColor: '#0097AC',
            borderWidth: 1,
            borderRadius: 4,
          },
          {
            type: 'line',
            label: i18n.t('analytics.chartMovingAverage'),
            data: avgLine,
            borderColor: '#10B981',
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.4,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'top',
            labels: { color: isDark ? '#FFF' : '#333', font: { size: 10 }, boxWidth: 12, padding: 8 },
          },
        },
        scales: {
          x: { ticks: { color: isDark ? '#FFF' : '#333', font: { size: 9 } }, grid: { display: false } },
          y: { ticks: { color: isDark ? '#FFF' : '#333' }, beginAtZero: true, grid: { color: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)' } },
        },
      },
    });
  }

  // ==================== RADAR CHART ====================
  private renderRadarChart(): void {
    const canvas = document.getElementById('radarChart') as HTMLCanvasElement;
    if (!canvas) return;

    if (this.radarChart) this.radarChart.destroy();

    const testData: { name: string; rate: number }[] = [];

    this.state.tests.forEach(test => {
      let ist = 0, soll = 0;
      this.state.projects.filter(p => p.test_id === test.id).forEach(p => {
        for (let w = this.analyticsWeekFrom; w <= this.analyticsWeekTo; w++) {
          const weekKey = `KW${w.toString().padStart(2, '0')}`;
          const data = this.getWeekData(p, weekKey);
          ist += data.ist;
          soll += data.soll;
        }
      });
      const rate = soll > 0 ? Math.round((ist / soll) * 100) : 0;
      testData.push({ name: test.name, rate: Math.min(rate, 100) });
    });

    const isDark = this.state.settings.darkMode;

    this.radarChart = new Chart(canvas, {
      type: 'radar',
      data: {
        labels: testData.map(d => d.name),
        datasets: [{
          label: i18n.t('analytics.chartRealizationPercent'),
          data: testData.map(d => d.rate),
          backgroundColor: 'rgba(0, 151, 172, 0.2)',
          borderColor: '#0097AC',
          borderWidth: 2,
          pointBackgroundColor: '#0097AC',
          pointRadius: 3,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'top',
            labels: { color: isDark ? '#FFF' : '#333', font: { size: 10 }, boxWidth: 12, padding: 8 },
          },
        },
        scales: {
          r: {
            beginAtZero: true,
            max: 100,
            ticks: { color: isDark ? '#FFF' : '#333', backdropColor: 'transparent', font: { size: 9 } },
            grid: { color: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' },
            pointLabels: { color: isDark ? '#FFF' : '#333', font: { size: 9 } },
          },
        },
      },
    });
  }

  private renderCharts(): void {
    this.renderWeeklyChart();
    this.renderTestChart();
    this.renderCustomerBarChart();
  }

  private customerBarChart: any = null;

  private renderCustomerBarChart(): void {
    const canvas = document.getElementById('customerBarChart') as HTMLCanvasElement;
    if (!canvas) return;

    if (this.customerBarChart) this.customerBarChart.destroy();

    // Aggregate data per customer
    const customerData: { [name: string]: { ist: number; soll: number } } = {};
    
    this.state.projects.forEach(project => {
      const customer = this.state.customers.find(c => c.id === project.customer_id);
      const name = customer?.name || 'Unknown';
      if (!customerData[name]) customerData[name] = { ist: 0, soll: 0 };
      
      for (let w = this.analyticsWeekFrom; w <= this.analyticsWeekTo; w++) {
        const weekKey = `KW${w.toString().padStart(2, '0')}`;
        const data = this.getWeekData(project, weekKey);
        customerData[name].ist += data.ist;
        customerData[name].soll += data.soll;
      }
    });

    const labels = Object.keys(customerData);
    const istValues = labels.map(l => customerData[l].ist);
    const sollValues = labels.map(l => customerData[l].soll);
    const isDark = this.state.settings.darkMode;

    this.customerBarChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'IST',
            data: istValues,
            backgroundColor: '#10B981',
            borderRadius: 4,
            barPercentage: 0.7,
          },
          {
            label: 'SOLL',
            data: sollValues,
            backgroundColor: '#0097AC',
            borderRadius: 4,
            barPercentage: 0.7,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y',
        plugins: { 
          legend: { 
            position: 'top',
            labels: { 
              color: isDark ? '#FFF' : '#333',
              font: { size: 11 },
              boxWidth: 12,
              padding: 8
            } 
          } 
        },
        scales: {
          x: { 
            ticks: { color: isDark ? '#FFF' : '#333' },
            beginAtZero: true,
            grid: { color: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)' }
          },
          y: { 
            ticks: { 
              color: isDark ? '#FFF' : '#333',
              font: { size: 11 }
            },
            grid: { display: false }
          },
        },
      },
    });
  }

  private renderWeeklyChart(): void {
    const canvas = document.getElementById('weeklyChart') as HTMLCanvasElement;
    if (!canvas) return;

    if (this.weeklyChart) this.weeklyChart.destroy();

    const weeklyData: { [week: string]: { ist: number; soll: number } } = {};
    // Only include weeks in filter range
    for (let i = this.analyticsWeekFrom; i <= this.analyticsWeekTo; i++) {
      weeklyData[`KW${i.toString().padStart(2, '0')}`] = { ist: 0, soll: 0 };
    }

    // Use year-aware week data lookup
    this.state.projects.forEach((project) => {
      for (let i = this.analyticsWeekFrom; i <= this.analyticsWeekTo; i++) {
        const weekKey = `KW${i.toString().padStart(2, '0')}`;
        const data = this.getWeekData(project, weekKey);
        weeklyData[weekKey].ist += data.ist;
        weeklyData[weekKey].soll += data.soll;
      }
    });

    const weeks = Object.keys(weeklyData);
    const isDark = this.state.settings.darkMode;

    this.weeklyChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: weeks,
        datasets: [
          {
            label: 'IST',
            data: weeks.map(w => weeklyData[w].ist),
            borderColor: '#4CAF50',
            backgroundColor: 'rgba(76, 175, 80, 0.2)',
            tension: 0.4,
            fill: true,
          },
          {
            label: 'SOLL',
            data: weeks.map(w => weeklyData[w].soll),
            borderColor: '#0097AC',
            backgroundColor: 'rgba(0, 151, 172, 0.2)',
            tension: 0.4,
            fill: true,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: isDark ? '#FFF' : '#333' } } },
        scales: {
          x: { 
            ticks: { 
              color: isDark ? '#FFF' : '#333',
              maxRotation: 45,
              minRotation: 45,
              font: { size: 9 }
            },
            grid: { display: false }
          },
          y: { 
            ticks: { color: isDark ? '#FFF' : '#333' },
            beginAtZero: true
          },
        },
      },
    });
  }

  private renderTestChart(): void {
    const canvas = document.getElementById('testChart') as HTMLCanvasElement;
    if (!canvas) return;

    if (this.testChart) this.testChart.destroy();

    const testCounts: { [id: string]: number } = {};
    this.state.projects.forEach(p => {
      testCounts[p.test_id] = (testCounts[p.test_id] || 0) + 1;
    });

    const labels = Object.keys(testCounts).map(id => {
      const test = this.state.tests.find(t => t.id === id);
      return test?.name || 'Unknown';
    });

    const isDark = this.state.settings.darkMode;

    this.testChart = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: Object.values(testCounts),
          backgroundColor: ['#0097AC', '#4CAF50', '#FF9800', '#F44336', '#2196F3', '#9C27B0', '#00BCD4', '#8BC34A'],
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { 
          legend: { 
            position: 'right',
            labels: { 
              color: isDark ? '#FFF' : '#333',
              font: { size: 11 },
              padding: 8
            } 
          } 
        },
      },
    });
  }

  private renderSettingsView(): void {
    const set = (id: string, checked: boolean) => {
      const el = document.getElementById(id) as HTMLInputElement;
      if (el) el.checked = checked;
    };
    
    set('darkModeToggle', this.state.settings.darkMode);
    set('animationsToggle', this.state.settings.animations);
    set('highlightMissingToggle', this.state.settings.highlightMissing);
    set('blinkAlertsToggle', this.state.settings.blinkAlerts);
    
    // Update user name input
    const userNameInput = document.getElementById('userNameInput') as HTMLInputElement;
    if (userNameInput) {
      userNameInput.value = this.state.settings.userName || '';
    }
    
    // Update password button text
    const pwdBtn = document.getElementById('setPasswordBtn');
    if (pwdBtn) {
      pwdBtn.textContent = this.state.settings.deletePassword 
        ? i18n.t('settings.changePassword') 
        : i18n.t('settings.setPassword');
    }

    // Update backup settings
    const backupPathInput = document.getElementById('backupPathInput') as HTMLInputElement;
    if (backupPathInput) {
      backupPathInput.value = this.state.settings.backupPath || '';
    }

    const backupFrequency = document.getElementById('backupFrequency') as HTMLSelectElement;
    if (backupFrequency) {
      backupFrequency.value = this.state.settings.backupFrequency || 'none';
    }

    // Update last backup info
    const lastBackupInfo = document.getElementById('lastBackupInfo');
    if (lastBackupInfo) {
      if (this.state.settings.lastBackupDate) {
        const date = new Date(this.state.settings.lastBackupDate);
        lastBackupInfo.textContent = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
      } else {
        lastBackupInfo.textContent = '-';
      }
    }

    // Load backup list
    this.loadBackupList();
    
    // Update admin unlock button state
    this.updateAdminUnlockButton();
  }

  private toggleAdminUnlock(): void {
    if (this.adminUnlocked) {
      // Lock the app
      this.adminUnlocked = false;
      this.updateAdminUI();
      this.updateAdminUnlockButton();
      // Close projects panel if open
      document.getElementById('projectsSlidePanel')?.classList.remove('open');
      this.showToast(i18n.t('settings.appLocked'), 'warning');
      return;
    }

    // Need to unlock - check if password is set
    if (!this.state.settings.deletePassword) {
      this.showToast(i18n.t('settings.noPasswordSet'), 'warning');
      return;
    }

    // Prompt for password
    const modal = document.getElementById('modal')!;
    const modalTitle = document.getElementById('modalTitle')!;
    const modalBody = document.getElementById('modalBody')!;

    modalTitle.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18" style="display:inline;vertical-align:middle;margin-right:8px"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> ${i18n.t('settings.unlockApp')}`;
    modalBody.innerHTML = `
      <div class="form-group">
        <label>${i18n.t('settings.enterPasswordToUnlock')}</label>
        <div class="password-input-group">
          <input type="password" id="adminUnlockPassword" class="form-control" autofocus />
        </div>
      </div>
    `;

    const confirmBtn = modal.querySelector('.modal-confirm') as HTMLButtonElement;
    const cancelBtn = modal.querySelector('.modal-cancel') as HTMLButtonElement;

    const cleanup = () => {
      confirmBtn.onclick = null;
      cancelBtn.onclick = null;
    };

    confirmBtn.onclick = () => {
      const password = (document.getElementById('adminUnlockPassword') as HTMLInputElement).value;
      if (password === this.state.settings.deletePassword) {
        cleanup();
        this.hideModal();
        this.adminUnlocked = true;
        this.updateAdminUI();
        this.updateAdminUnlockButton();
        this.showToast(i18n.t('settings.appUnlocked'), 'success');
      } else {
        this.showToast(i18n.t('settings.wrongPassword'), 'error');
      }
    };

    cancelBtn.onclick = () => {
      cleanup();
      this.hideModal();
    };

    modal.classList.add('active');
    setTimeout(() => (document.getElementById('adminUnlockPassword') as HTMLInputElement)?.focus(), 100);
  }

  private updateAdminUnlockButton(): void {
    const btn = document.getElementById('toggleAdminUnlock');
    const btnText = document.getElementById('adminUnlockBtnText');
    if (btn && btnText) {
      if (this.adminUnlocked) {
        btnText.textContent = i18n.t('settings.lock');
        btn.className = 'btn-danger';
        btn.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 9.9-1"/>
          </svg>
          <span id="adminUnlockBtnText">${i18n.t('settings.lock')}</span>
        `;
      } else {
        btnText.textContent = i18n.t('settings.unlock');
        btn.className = 'btn-primary';
        btn.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          <span id="adminUnlockBtnText">${i18n.t('settings.unlock')}</span>
        `;
      }
    }
  }

  private updateAdminUI(): void {
    const adminElements = document.querySelectorAll('.admin-only');
    adminElements.forEach(el => {
      (el as HTMLElement).style.display = this.adminUnlocked ? '' : 'none';
    });
  }

  private renderLogsView(): void {
    const tbody = document.getElementById('logsTableBody');
    const noLogsMsg = document.getElementById('noLogsMessage');
    
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    if (this.logs.length === 0) {
      if (noLogsMsg) noLogsMsg.style.display = 'block';
      return;
    }
    
    if (noLogsMsg) noLogsMsg.style.display = 'none';
    
    this.logs.forEach(log => {
      const tr = document.createElement('tr');
      const date = new Date(log.timestamp);
      const formattedDate = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
      
      tr.innerHTML = `
        <td class="log-timestamp">${formattedDate}</td>
        <td class="log-user">${log.userName}</td>
        <td><span class="log-action action-${log.action}">${i18n.t(`logs.actions.${log.action}`)}</span></td>
        <td>${log.entityType}: ${log.entityName}${log.details ? ` - ${log.details}` : ''}</td>
      `;
      
      tbody.appendChild(tr);
    });
  }

  private showPasswordModal(): void {
    const modal = document.getElementById('modal')!;
    const modalTitle = document.getElementById('modalTitle')!;
    const modalBody = document.getElementById('modalBody')!;
    
    const hasPassword = !!this.state.settings.deletePassword;
    
    modalTitle.textContent = `🔐 ${hasPassword ? i18n.t('settings.changePassword') : i18n.t('settings.setPassword')}`;
    
    modalBody.innerHTML = `
      ${hasPassword ? `
        <div class="form-group">
          <label>${i18n.t('settings.currentPassword')}</label>
          <div class="password-input-group">
            <input type="password" id="currentPassword" class="form-control" />
          </div>
        </div>
      ` : ''}
      <div class="form-group">
        <label>${i18n.t('settings.newPassword')}</label>
        <div class="password-input-group">
          <input type="password" id="newPassword" class="form-control" />
        </div>
        <div class="password-strength"><div class="password-strength-bar" id="pwdStrength"></div></div>
      </div>
      <div class="form-group">
        <label>${i18n.t('settings.confirmPassword')}</label>
        <div class="password-input-group">
          <input type="password" id="confirmNewPassword" class="form-control" />
        </div>
      </div>
      ${hasPassword ? `
        <button type="button" class="btn-danger" id="removePasswordBtn" style="margin-top: 12px">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="display:inline;vertical-align:middle;margin-right:4px"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> ${i18n.t('common.delete')} ${i18n.t('settings.deletePassword')}
        </button>
      ` : ''}
    `;
    
    // Password strength indicator
    document.getElementById('newPassword')?.addEventListener('input', (e) => {
      const pwd = (e.target as HTMLInputElement).value;
      const bar = document.getElementById('pwdStrength');
      if (bar) {
        if (pwd.length < 4) {
          bar.className = 'password-strength-bar weak';
        } else if (pwd.length < 8) {
          bar.className = 'password-strength-bar medium';
        } else {
          bar.className = 'password-strength-bar strong';
        }
      }
    });
    
    // Remove password button
    document.getElementById('removePasswordBtn')?.addEventListener('click', async () => {
      const current = (document.getElementById('currentPassword') as HTMLInputElement)?.value;
      if (current !== this.state.settings.deletePassword) {
        this.showToast(i18n.t('settings.wrongPassword'), 'error');
        return;
      }
      this.state.settings.deletePassword = '';
      await this.saveSettings();
      this.hideModal();
      this.renderSettingsView();
      this.showToast(i18n.t('settings.passwordRemoved'), 'success');
    });
    
    const confirmBtn = modal.querySelector('.modal-confirm') as HTMLButtonElement;
    confirmBtn.onclick = async () => {
      if (hasPassword) {
        const current = (document.getElementById('currentPassword') as HTMLInputElement).value;
        if (current !== this.state.settings.deletePassword) {
          this.showToast(i18n.t('settings.wrongPassword'), 'error');
          return;
        }
      }
      
      const newPwd = (document.getElementById('newPassword') as HTMLInputElement).value;
      const confirmPwd = (document.getElementById('confirmNewPassword') as HTMLInputElement).value;
      
      if (newPwd !== confirmPwd) {
        this.showToast(i18n.t('settings.passwordMismatch'), 'error');
        return;
      }
      
      if (!newPwd) {
        this.showToast(i18n.t('messages.errorOccurred'), 'error');
        return;
      }
      
      this.state.settings.deletePassword = newPwd;
      await this.saveSettings();
      this.hideModal();
      this.renderSettingsView();
      this.showToast(i18n.t('settings.passwordSet'), 'success');
    };
    
    modal.classList.add('active');
  }

  private async exportLogs(): Promise<void> {
    if (this.logs.length === 0) {
      this.showToast(i18n.t('logs.noLogs'), 'warning');
      return;
    }
    
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Activity Logs');
    
    sheet.columns = [
      { header: i18n.t('logs.timestamp'), key: 'timestamp', width: 20 },
      { header: i18n.t('logs.user'), key: 'user', width: 15 },
      { header: i18n.t('logs.action'), key: 'action', width: 12 },
      { header: 'Entity Type', key: 'entityType', width: 12 },
      { header: 'Entity Name', key: 'entityName', width: 20 },
      { header: i18n.t('logs.details'), key: 'details', width: 30 },
    ];
    
    this.logs.forEach(log => {
      const date = new Date(log.timestamp);
      sheet.addRow({
        timestamp: date.toLocaleDateString() + ' ' + date.toLocaleTimeString(),
        user: log.userName,
        action: log.action,
        entityType: log.entityType,
        entityName: log.entityName,
        details: log.details,
      });
    });
    
    // Style header
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0097AC' } };
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    saveAs(blob, `Kappaplannung_Logs_${new Date().toISOString().split('T')[0]}.xlsx`);
    
    this.showToast(i18n.t('messages.exportSuccessfully'), 'success');
  }

  private async clearLogs(): Promise<void> {
    const confirmed = await this.confirmDeletion();
    if (!confirmed) return;
    
    await db.clear('logs');
    this.logs = [];
    this.renderLogsView();
    this.showToast(i18n.t('messages.deletedSuccessfully'), 'success');
  }

  private showAddModal(type: string): void {
    // Admin guard
    if (!this.adminUnlocked) {
      this.showToast(i18n.t('settings.appLocked'), 'warning');
      return;
    }
    const modal = document.getElementById('modal')!;
    const modalTitle = document.getElementById('modalTitle')!;
    const modalBody = document.getElementById('modalBody')!;

    const labelKey = `messages.add${type.charAt(0).toUpperCase() + type.slice(1)}`;

    modalTitle.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18" style="display:inline;vertical-align:middle;margin-right:8px"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg> ${i18n.t(labelKey)}`;
    
    // Add color picker for tests
    const colorPicker = type === 'test' ? `
      <div class="form-group">
        <label>${i18n.t('projects.color')}:</label>
        <div class="test-color-picker" id="colorPicker">
          ${TEST_COLORS.map((color, idx) => `
            <div class="color-option ${idx === 0 ? 'selected' : ''}" 
                 data-color="${color}" 
                 style="background: ${color}"></div>
          `).join('')}
        </div>
      </div>
    ` : '';
    
    modalBody.innerHTML = `
      <div class="form-group">
        <label>${i18n.t('messages.name')}:</label>
        <input type="text" id="itemName" class="form-control" placeholder="${i18n.t('messages.name')}..." />
      </div>
      ${colorPicker}
    `;
    
    // Color picker logic
    if (type === 'test') {
      document.querySelectorAll('.color-option').forEach(el => {
        el.addEventListener('click', () => {
          document.querySelectorAll('.color-option').forEach(e => e.classList.remove('selected'));
          el.classList.add('selected');
        });
      });
    }

    const confirmBtn = modal.querySelector('.modal-confirm') as HTMLButtonElement;
    confirmBtn.onclick = async () => {
      const name = (document.getElementById('itemName') as HTMLInputElement).value.trim();
      if (!name) {
        this.showToast(i18n.t('messages.errorOccurred'), 'warning');
        return;
      }

      const item: any = { id: this.generateId(), name, createdAt: Date.now() };
      
      // Save color for tests
      if (type === 'test') {
        const selectedColor = document.querySelector('.color-option.selected') as HTMLElement;
        item.color = selectedColor?.dataset.color || TEST_COLORS[0];
      }
      
      const stores: { [k: string]: string } = {
        customer: 'customers', type: 'types', part: 'parts', test: 'tests'
      };

      await db.put(stores[type], item);
      (this.state as any)[stores[type]].push(item);
      
      await this.addLog('created', type, name);

      this.hideModal();
      this.renderProjectsView();
      this.showToast(i18n.t('messages.savedSuccessfully'), 'success');
    };

    modal.classList.add('active');
    setTimeout(() => (document.getElementById('itemName') as HTMLInputElement)?.focus(), 100);
  }

  private showEditModal(type: string, item: any): void {
    // Admin guard
    if (!this.adminUnlocked) {
      this.showToast(i18n.t('settings.appLocked'), 'warning');
      return;
    }
    const modal = document.getElementById('modal')!;
    const modalTitle = document.getElementById('modalTitle')!;
    const modalBody = document.getElementById('modalBody')!;

    // Get current color (from item.color for tests, or from itemTags for others)
    const currentColor = item.color || this.itemTags.get(item.id) || '';
    
    const colorOptions = [
      '', // No color
      '#EF4444', '#F97316', '#F59E0B', '#EAB308', 
      '#84CC16', '#22C55E', '#10B981', '#14B8A6',
      '#06B6D4', '#0EA5E9', '#3B82F6', '#6366F1',
      '#8B5CF6', '#A855F7', '#D946EF', '#EC4899'
    ];

    modalTitle.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18" style="display:inline;vertical-align:middle;margin-right:8px"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Edytuj`;
    modalBody.innerHTML = `
      <div class="form-group">
        <label>Nazwa:</label>
        <input type="text" id="itemName" class="form-control" value="${item.name}" />
      </div>
      <div class="form-group">
        <label>Kolor:</label>
        <div class="color-picker-grid">
          ${colorOptions.map(color => `
            <button type="button" class="color-option ${currentColor === color ? 'selected' : ''}" 
                    data-color="${color}" 
                    style="${color ? `background: ${color}` : 'background: var(--color-bg-secondary)'}">
              ${!color ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' : ''}
            </button>
          `).join('')}
        </div>
      </div>
    `;
    
    // Setup color picker
    let selectedColor = currentColor;
    modalBody.querySelectorAll('.color-option').forEach(btn => {
      btn.addEventListener('click', () => {
        modalBody.querySelectorAll('.color-option').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectedColor = (btn as HTMLElement).dataset.color || '';
      });
    });

    const confirmBtn = modal.querySelector('.modal-confirm') as HTMLButtonElement;
    confirmBtn.onclick = async () => {
      const name = (document.getElementById('itemName') as HTMLInputElement).value.trim();
      if (!name) return;

      item.name = name;
      
      // Save color - for tests it's stored in item.color, for others in itemTags
      if (type === 'tests') {
        item.color = selectedColor || TEST_COLORS[0];
      } else {
        if (selectedColor) {
          this.itemTags.set(item.id, selectedColor);
        } else {
          this.itemTags.delete(item.id);
        }
        await this.saveItemTags();
      }
      
      await db.put(type, item);
      
      const idx = (this.state as any)[type].findIndex((i: any) => i.id === item.id);
      if (idx >= 0) (this.state as any)[type][idx] = item;
      
      await this.addLog('updated', type, name);

      this.hideModal();
      this.renderProjectsView();
      this.renderPlanningGrid();
      this.showToast(i18n.t('messages.savedSuccessfully'), 'success');
    };

    modal.classList.add('active');
  }

  private showAddProjectModal(): void {
    // Admin guard
    if (!this.adminUnlocked) {
      this.showToast(i18n.t('settings.appLocked'), 'warning');
      return;
    }
    if (this.state.customers.length === 0 || this.state.types.length === 0 || 
        this.state.parts.length === 0 || this.state.tests.length === 0) {
      this.showToast(i18n.t('messages.errorOccurred') + ' - ' + i18n.t('messages.noItems'), 'warning');
      return;
    }

    const modal = document.getElementById('modal')!;
    const modalTitle = document.getElementById('modalTitle')!;
    const modalBody = document.getElementById('modalBody')!;

    modalTitle.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18" style="display:inline;vertical-align:middle;margin-right:8px"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg> ${i18n.t('messages.addProject')}`;
    modalBody.innerHTML = `
      <div class="form-group">
        <label>${i18n.t('messages.customer')}:</label>
        <select id="projectCustomer" class="form-control">
          ${this.state.customers.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>${i18n.t('messages.type')}:</label>
        <select id="projectType" class="form-control">
          ${this.state.types.map(t => `<option value="${t.id}">${t.name}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>${i18n.t('messages.part')}:</label>
        <select id="projectPart" class="form-control">
          ${this.state.parts.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>${i18n.t('messages.test')}:</label>
        <select id="projectTest" class="form-control">
          ${this.state.tests.map(t => `<option value="${t.id}">${t.name}</option>`).join('')}
        </select>
      </div>
    `;

    const confirmBtn = modal.querySelector('.modal-confirm') as HTMLButtonElement;
    confirmBtn.onclick = async () => {
      const customerId = (document.getElementById('projectCustomer') as HTMLSelectElement).value;
      const customer = this.state.customers.find(c => c.id === customerId);
      
      const project: Project = {
        id: this.generateId(),
        customer_id: customerId,
        type_id: (document.getElementById('projectType') as HTMLSelectElement).value,
        part_id: (document.getElementById('projectPart') as HTMLSelectElement).value,
        test_id: (document.getElementById('projectTest') as HTMLSelectElement).value,
        weeks: {},
        timePerUnit: 0,
        created_at: Date.now(),
        updated_at: Date.now(),
      };

      await db.put('projects', project);
      this.state.projects.push(project);
      
      await this.addLog('created', 'project', customer?.name || 'Project');
      
      this.hideModal();
      this.renderPlanningGrid();
      this.showToast(i18n.t('messages.savedSuccessfully'), 'success');
    };

    modal.classList.add('active');
  }

  private async deleteItem(type: string, id: string, showConfirm: boolean = true): Promise<void> {
    // Admin guard
    if (!this.adminUnlocked) {
      this.showToast(i18n.t('settings.appLocked'), 'warning');
      return;
    }
    if (showConfirm) {
      const confirmed = await this.confirmDeletion();
      if (!confirmed) return;
    }

    const item = (this.state as any)[type].find((i: any) => i.id === id);
    await db.delete(type, id);
    (this.state as any)[type] = (this.state as any)[type].filter((i: any) => i.id !== id);

    await this.addLog('deleted', type, item?.name || id);
    
    if (showConfirm) {
      this.renderProjectsView();
      this.showToast(i18n.t('messages.deletedSuccessfully'), 'success');
    }
  }

  private async deleteProject(id: string): Promise<void> {
    // Admin guard
    if (!this.adminUnlocked) {
      this.showToast(i18n.t('settings.appLocked'), 'warning');
      return;
    }
    const confirmed = await this.confirmDeletion();
    if (!confirmed) return;

    const project = this.state.projects.find(p => p.id === id);
    const customer = this.state.customers.find(c => c.id === project?.customer_id);
    
    await db.delete('projects', id);
    this.state.projects = this.state.projects.filter(p => p.id !== id);
    
    // Delete related comments
    for (const comment of this.comments.filter(c => c.projectId === id)) {
      await db.delete('comments', comment.id);
    }
    this.comments = this.comments.filter(c => c.projectId !== id);

    await this.addLog('deleted', 'project', customer?.name || id);
    this.renderPlanningGrid();
    this.showToast(i18n.t('messages.deletedSuccessfully'), 'success');
  }

  private confirmDeletion(): Promise<boolean> {
    return new Promise((resolve) => {
      if (!this.state.settings.deletePassword) {
        // No password set, use simple confirm
        resolve(confirm(i18n.t('messages.deleteConfirm')));
        return;
      }

      // Show password modal
      const modal = document.getElementById('modal')!;
      const modalTitle = document.getElementById('modalTitle')!;
      const modalBody = document.getElementById('modalBody')!;

      modalTitle.textContent = `🔒 ${i18n.t('common.confirm')}`;
      modalBody.innerHTML = `
        <div class="form-group">
          <label>${i18n.t('common.enterPassword')}</label>
          <div class="password-input-group">
            <input type="password" id="confirmPassword" class="form-control" autofocus />
            <button type="button" class="password-toggle" id="togglePwdVisibility">👁️</button>
          </div>
        </div>
      `;

      document.getElementById('togglePwdVisibility')?.addEventListener('click', () => {
        const input = document.getElementById('confirmPassword') as HTMLInputElement;
        input.type = input.type === 'password' ? 'text' : 'password';
      });

      const confirmBtn = modal.querySelector('.modal-confirm') as HTMLButtonElement;
      const cancelBtn = modal.querySelector('.modal-cancel') as HTMLButtonElement;
      
      const cleanup = () => {
        confirmBtn.onclick = null;
        cancelBtn.onclick = null;
        this.hideModal();
      };

      confirmBtn.onclick = () => {
        const password = (document.getElementById('confirmPassword') as HTMLInputElement).value;
        if (password === this.state.settings.deletePassword) {
          cleanup();
          resolve(true);
        } else {
          this.showToast(i18n.t('settings.wrongPassword'), 'error');
        }
      };

      cancelBtn.onclick = () => {
        cleanup();
        resolve(false);
      };

      modal.classList.add('active');
      setTimeout(() => (document.getElementById('confirmPassword') as HTMLInputElement)?.focus(), 100);
    });
  }

  private hideModal(): void {
    document.getElementById('modal')?.classList.remove('active');
  }

  private async showWeeklyReport(): Promise<void> {
    try {
      const currentWeek = this.getCurrentWeek();
      const currentYear = new Date().getFullYear();
      const weekKey = `${currentYear}-KW${String(currentWeek).padStart(2, '0')}`;
      
      // Get assignments for current week
      const assignments = await db.getScheduleAssignments();
      const weekAssignments = assignments.filter((a: ScheduleAssignment) => 
        a.week === weekKey
      );
      
      // Calculate stats
      const employees = [...new Set(weekAssignments.map(a => a.employeeId))];
      const projects = [...new Set(weekAssignments.map(a => a.projectId))];
      const shifts = weekAssignments.reduce((acc, a) => {
        acc[String(a.shift)] = (acc[String(a.shift)] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      
      const totalHours = weekAssignments.reduce((sum, a) => {
        // Shift is 1, 2, or 3, each is 8 hours
        return sum + 8;
      }, 0);
      
      const content = `
        <h3 style="margin-bottom: 20px;">📊 Weekly Report - KW ${currentWeek}/${currentYear}</h3>
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin-bottom: 20px;">
          <div style="background: var(--color-bg-secondary); padding: 16px; border-radius: 8px; text-align: center;">
            <div style="font-size: 2rem; font-weight: 700; color: var(--color-primary);">${weekAssignments.length}</div>
            <div style="color: var(--color-text-secondary);">Total Assignments</div>
          </div>
          <div style="background: var(--color-bg-secondary); padding: 16px; border-radius: 8px; text-align: center;">
            <div style="font-size: 2rem; font-weight: 700; color: #10b981;">${employees.length}</div>
            <div style="color: var(--color-text-secondary);">Active Employees</div>
          </div>
          <div style="background: var(--color-bg-secondary); padding: 16px; border-radius: 8px; text-align: center;">
            <div style="font-size: 2rem; font-weight: 700; color: #3b82f6;">${projects.length}</div>
            <div style="color: var(--color-text-secondary);">Active Projects</div>
          </div>
          <div style="background: var(--color-bg-secondary); padding: 16px; border-radius: 8px; text-align: center;">
            <div style="font-size: 2rem; font-weight: 700; color: #f59e0b;">${totalHours}h</div>
            <div style="color: var(--color-text-secondary);">Total Hours</div>
          </div>
        </div>
        <h4 style="margin-bottom: 12px;">Shift Distribution</h4>
        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          ${Object.entries(shifts).map(([shift, count]) => `
            <span style="background: var(--color-bg-tertiary); padding: 6px 12px; border-radius: 4px;">
              ${shift}: <strong>${count}</strong>
            </span>
          `).join('')}
        </div>
      `;
      
      const modal = document.getElementById('modal')!;
      const modalContent = modal.querySelector('.modal-content')!;
      modalContent.innerHTML = `
        <div class="modal-header">
          <h3>📊 Weekly Report</h3>
          <button class="modal-close" onclick="document.getElementById('modal').classList.remove('active')">×</button>
        </div>
        <div class="modal-body">
          ${content}
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="document.getElementById('modal').classList.remove('active')">Close</button>
        </div>
      `;
      modal.classList.add('active');
    } catch (error) {
      console.error('Error generating weekly report:', error);
      this.showToast('Error generating weekly report', 'error');
    }
  }

  private async exportData(): Promise<void> {
    try {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Kappaplannung';
      workbook.created = new Date();
      
      const currentWeek = this.getCurrentWeek();
      const currentYear = new Date().getFullYear();
      const filteredProjects = this.getFilteredProjects();

      // ==================== SHEET 1: Main Planning ====================
      const sheet = workbook.addWorksheet('Kappa Planning', {
        views: [{ state: 'frozen', xSplit: 5, ySplit: 4 }]
      });

      // Header section - DRÄXLMAIER Group branding
      sheet.mergeCells('A1:G1');
      const titleCell = sheet.getCell('A1');
      titleCell.value = 'DRÄXLMAIER Group';
      titleCell.font = { name: 'Arial', size: 18, bold: true, color: { argb: 'FFFFFFFF' } };
      titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF000000' } };
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
      sheet.getRow(1).height = 35;

      sheet.mergeCells('A2:G2');
      const subtitleCell = sheet.getCell('A2');
      subtitleCell.value = 'Kappa Planning - ' + this.state.selectedYear;
      subtitleCell.font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
      subtitleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0097AC' } };
      subtitleCell.alignment = { horizontal: 'center', vertical: 'middle' };
      sheet.getRow(2).height = 28;

      // Filter info
      const filterCustomer = (document.getElementById('filterCustomer') as HTMLSelectElement)?.value;
      const filterType = (document.getElementById('filterType') as HTMLSelectElement)?.value;
      const filterTest = (document.getElementById('filterTest') as HTMLSelectElement)?.value;
      const searchText = (document.getElementById('searchInput') as HTMLInputElement)?.value;
      
      let filterInfo = `Export: ${new Date().toLocaleDateString()} | ${i18n.t('planning.year')}: ${this.state.selectedYear}`;
      if (filterCustomer || filterType || filterTest || searchText) {
        filterInfo += ' | Filters:';
        if (filterCustomer) {
          const customer = this.state.customers.find(c => c.id === filterCustomer);
          filterInfo += ` Customer: ${customer?.name || filterCustomer}`;
        }
        if (filterType) {
          const type = this.state.types.find(t => t.id === filterType);
          filterInfo += ` Type: ${type?.name || filterType}`;
        }
        if (filterTest) {
          const test = this.state.tests.find(t => t.id === filterTest);
          filterInfo += ` Test: ${test?.name || filterTest}`;
        }
        if (searchText) filterInfo += ` Search: "${searchText}"`;
      }

      sheet.mergeCells('A3:G3');
      const infoCell = sheet.getCell('A3');
      infoCell.value = filterInfo;
      infoCell.font = { name: 'Arial', size: 10, italic: true, color: { argb: 'FF666666' } };
      infoCell.alignment = { horizontal: 'center', vertical: 'middle' };
      sheet.getRow(3).height = 20;

      // Column headers row
      const headerRow = 4;
      const headers = [
        i18n.t('planning.kunde'),
        i18n.t('planning.typ'),
        i18n.t('planning.teil'),
        i18n.t('planning.prufung'),
        'Status'
      ];
      
      // Add week headers (KW01-KW52 with IST/SOLL)
      for (let week = 1; week <= 52; week++) {
        headers.push(`KW${week.toString().padStart(2, '0')} IST`);
        headers.push(`KW${week.toString().padStart(2, '0')} SOLL`);
      }

      // Set column widths
      sheet.getColumn(1).width = 18; // Customer
      sheet.getColumn(2).width = 12; // Type
      sheet.getColumn(3).width = 18; // Part
      sheet.getColumn(4).width = 18; // Test
      sheet.getColumn(5).width = 10; // Status
      for (let i = 6; i <= 109; i++) {
        sheet.getColumn(i).width = 7;
      }

      // Add headers
      const headerRowObj = sheet.getRow(headerRow);
      headers.forEach((header, idx) => {
        const cell = headerRowObj.getCell(idx + 1);
        cell.value = header;
        cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0097AC' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FF000000' } },
          left: { style: 'thin', color: { argb: 'FF000000' } },
          bottom: { style: 'thin', color: { argb: 'FF000000' } },
          right: { style: 'thin', color: { argb: 'FF000000' } }
        };
        
        // Highlight current week
        if (idx >= 5) {
          const weekIdx = Math.floor((idx - 5) / 2);
          const weekNum = weekIdx + 1;
          if (weekNum === currentWeek && this.state.selectedYear === currentYear) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF007589' } };
          }
        }
      });
      headerRowObj.height = 30;

      // Data rows
      let rowNum = headerRow + 1;

      filteredProjects.forEach((project) => {
        const customer = this.state.customers.find(c => c.id === project.customer_id);
        const type = this.state.types.find(t => t.id === project.type_id);
        const part = this.state.parts.find(p => p.id === project.part_id);
        const test = this.state.tests.find(t => t.id === project.test_id);

        // Calculate status
        let totalIst = 0, totalSoll = 0;
        for (let week = 1; week <= 52; week++) {
          const kwNum = `KW${week.toString().padStart(2, '0')}`;
          const yearWeekKey = `${this.state.selectedYear}-${kwNum}`;
          const weekData = project.weeks[yearWeekKey] || { ist: 0, soll: 0 };
          totalIst += weekData.ist;
          totalSoll += weekData.soll;
        }
        
        const statusPercent = totalSoll > 0 ? Math.round((totalIst / totalSoll) * 100) : 0;
        const status = totalSoll === 0 ? '-' : `${statusPercent}%`;

        const row = sheet.getRow(rowNum);
        const rowData: (string | number)[] = [
          customer?.name || '-',
          type?.name || '-',
          part?.name || '-',
          test?.name || '-',
          status
        ];

        // Add week data
        for (let week = 1; week <= 52; week++) {
          const kwNum = `KW${week.toString().padStart(2, '0')}`;
          const yearWeekKey = `${this.state.selectedYear}-${kwNum}`;
          const weekData = project.weeks[yearWeekKey] || { ist: 0, soll: 0 };
          rowData.push(weekData.ist);
          rowData.push(weekData.soll);
        }

        rowData.forEach((value, idx) => {
          const cell = row.getCell(idx + 1);
          cell.value = value;
          cell.font = { name: 'Arial', size: 9 };
          cell.alignment = { horizontal: idx < 5 ? 'left' : 'center', vertical: 'middle' };
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFCCCCCC' } },
            left: { style: 'thin', color: { argb: 'FFCCCCCC' } },
            bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } },
            right: { style: 'thin', color: { argb: 'FFCCCCCC' } }
          };

          // Color coding for week cells
          if (idx >= 5) {
            const weekIdx = Math.floor((idx - 5) / 2);
            const isIst = (idx - 5) % 2 === 0;
            const weekNum = weekIdx + 1;
            const isCurrentWeek = weekNum === currentWeek && this.state.selectedYear === currentYear;
            const kwNum = `KW${weekNum.toString().padStart(2, '0')}`;
            const yearWeekKey = `${this.state.selectedYear}-${kwNum}`;
            const weekData = project.weeks[yearWeekKey] || { ist: 0, soll: 0 };
            
            // Check for stoppage or production lack
            if (weekData.stoppage) {
              cell.fill = { 
                type: 'pattern', 
                pattern: 'darkTrellis', 
                fgColor: { argb: 'FF888888' },
                bgColor: { argb: 'FFEEEEEE' }
              };
            } else if (weekData.productionLack) {
              cell.fill = { 
                type: 'pattern', 
                pattern: 'darkTrellis', 
                fgColor: { argb: 'FFF59E0B' },
                bgColor: { argb: 'FFFFF3CD' }
              };
            } else if (isCurrentWeek) {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0F7FA' } };
            }
            
            if (isIst && typeof value === 'number' && !weekData.stoppage && !weekData.productionLack) {
              const sollValue = rowData[idx + 1] as number;
              if (sollValue > 0) {
                if (value >= sollValue) {
                  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4ADE80' } };
                  cell.font = { ...cell.font, color: { argb: 'FF166534' } };
                } else if (value > 0) {
                  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFBBF24' } };
                  cell.font = { ...cell.font, color: { argb: 'FF92400E' } };
                } else {
                  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF87171' } };
                  cell.font = { ...cell.font, color: { argb: 'FF991B1B' } };
                }
              }
            }
            
            // Add comment as cell note
            const comment = this.comments.find(c => c.projectId === project.id && (c.week === yearWeekKey || c.week === kwNum));
            if (comment && isIst) {
              cell.note = {
                texts: [{ text: comment.text, font: { size: 9, name: 'Arial' } }],
                margins: { insetmode: 'auto' }
              } as ExcelJS.Comment;
              cell.border = {
                ...cell.border,
                diagonal: { style: 'thin', color: { argb: 'FF3B82F6' } }
              };
            }
          }

          // Status cell coloring
          if (idx === 4 && typeof value === 'string' && value !== '-') {
            if (statusPercent >= 100) {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4ADE80' } };
              cell.font = { ...cell.font, bold: true, color: { argb: 'FF166534' } };
            } else if (statusPercent >= 50) {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFBBF24' } };
              cell.font = { ...cell.font, bold: true, color: { argb: 'FF92400E' } };
            } else {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF87171' } };
              cell.font = { ...cell.font, bold: true, color: { argb: 'FF991B1B' } };
            }
          }
        });

        // Alternate row colors for fixed columns
        if (rowNum % 2 === 0) {
          for (let i = 1; i <= 4; i++) {
            const cell = row.getCell(i);
            if (!cell.fill || (cell.fill as ExcelJS.FillPattern).fgColor?.argb === undefined) {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8F9FA' } };
            }
          }
        }

        rowNum++;
      });

      // ==================== SHEET 2: Comments ====================
      const commentsSheet = workbook.addWorksheet('Comments');
      
      commentsSheet.mergeCells('A1:E1');
      const commentsTitle = commentsSheet.getCell('A1');
      commentsTitle.value = 'Comments - Kappa Planning ' + this.state.selectedYear;
      commentsTitle.font = { name: 'Arial', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
      commentsTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0097AC' } };
      commentsTitle.alignment = { horizontal: 'center', vertical: 'middle' };
      commentsSheet.getRow(1).height = 30;

      // Comments headers
      commentsSheet.getColumn(1).width = 18;
      commentsSheet.getColumn(2).width = 18;
      commentsSheet.getColumn(3).width = 12;
      commentsSheet.getColumn(4).width = 50;
      commentsSheet.getColumn(5).width = 18;

      const commentsHeaderRow = commentsSheet.getRow(3);
      ['Project', 'Test', 'Week', 'Comment', 'Date'].forEach((h, i) => {
        const cell = commentsHeaderRow.getCell(i + 1);
        cell.value = h;
        cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF333333' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      });

      // Filter comments for selected year and filtered projects
      const projectIds = new Set(filteredProjects.map(p => p.id));
      const relevantComments = this.comments.filter(c => {
        if (!projectIds.has(c.projectId)) return false;
        if (c.week.includes('-')) {
          return c.week.startsWith(this.state.selectedYear.toString());
        }
        return true;
      });

      let commentRowNum = 4;
      relevantComments.forEach(comment => {
        const project = this.state.projects.find(p => p.id === comment.projectId);
        const test = project ? this.state.tests.find(t => t.id === project.test_id) : null;
        const customer = project ? this.state.customers.find(c => c.id === project.customer_id) : null;
        const part = project ? this.state.parts.find(p => p.id === project.part_id) : null;
        
        const row = commentsSheet.getRow(commentRowNum);
        row.getCell(1).value = `${customer?.name || '-'} / ${part?.name || '-'}`;
        row.getCell(2).value = test?.name || '-';
        row.getCell(3).value = comment.week;
        row.getCell(4).value = comment.text;
        row.getCell(4).alignment = { wrapText: true };
        row.getCell(5).value = new Date(comment.createdAt).toLocaleDateString();
        
        for (let i = 1; i <= 5; i++) {
          row.getCell(i).font = { name: 'Arial', size: 9 };
          row.getCell(i).border = {
            top: { style: 'thin', color: { argb: 'FFCCCCCC' } },
            left: { style: 'thin', color: { argb: 'FFCCCCCC' } },
            bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } },
            right: { style: 'thin', color: { argb: 'FFCCCCCC' } }
          };
        }
        commentRowNum++;
      });

      if (relevantComments.length === 0) {
        commentsSheet.getRow(4).getCell(1).value = 'No comments found';
        commentsSheet.getRow(4).getCell(1).font = { name: 'Arial', size: 10, italic: true, color: { argb: 'FF666666' } };
      }

      // ==================== SHEET 3: Analytics ====================
      const analyticsSheet = workbook.addWorksheet('Analytics');
      
      analyticsSheet.mergeCells('A1:F1');
      const analyticsTitle = analyticsSheet.getCell('A1');
      analyticsTitle.value = 'Analytics - Kappa Planning ' + this.state.selectedYear;
      analyticsTitle.font = { name: 'Arial', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
      analyticsTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0097AC' } };
      analyticsTitle.alignment = { horizontal: 'center', vertical: 'middle' };
      analyticsSheet.getRow(1).height = 30;

      analyticsSheet.getColumn(1).width = 25;
      analyticsSheet.getColumn(2).width = 15;
      analyticsSheet.getColumn(3).width = 15;
      analyticsSheet.getColumn(4).width = 15;
      analyticsSheet.getColumn(5).width = 15;
      analyticsSheet.getColumn(6).width = 15;

      // Calculate analytics data
      let totalIstAll = 0, totalSollAll = 0;
      let completedProjects = 0, inProgressProjects = 0, notStartedProjects = 0;
      const testStats: Record<string, { ist: number; soll: number; count: number }> = {};
      const customerStats: Record<string, { ist: number; soll: number; count: number }> = {};
      const weeklyStats: Record<number, { ist: number; soll: number }> = {};

      filteredProjects.forEach(project => {
        const test = this.state.tests.find(t => t.id === project.test_id);
        const customer = this.state.customers.find(c => c.id === project.customer_id);
        let projectIst = 0, projectSoll = 0;

        for (let week = 1; week <= 52; week++) {
          const kwNum = `KW${week.toString().padStart(2, '0')}`;
          const yearWeekKey = `${this.state.selectedYear}-${kwNum}`;
          const weekData = project.weeks[yearWeekKey] || { ist: 0, soll: 0 };
          
          projectIst += weekData.ist;
          projectSoll += weekData.soll;
          totalIstAll += weekData.ist;
          totalSollAll += weekData.soll;

          if (!weeklyStats[week]) weeklyStats[week] = { ist: 0, soll: 0 };
          weeklyStats[week].ist += weekData.ist;
          weeklyStats[week].soll += weekData.soll;
        }

        // Project status
        if (projectSoll === 0) {
          notStartedProjects++;
        } else if (projectIst >= projectSoll) {
          completedProjects++;
        } else {
          inProgressProjects++;
        }

        // Test stats
        if (test) {
          if (!testStats[test.name]) testStats[test.name] = { ist: 0, soll: 0, count: 0 };
          testStats[test.name].ist += projectIst;
          testStats[test.name].soll += projectSoll;
          testStats[test.name].count++;
        }

        // Customer stats
        if (customer) {
          if (!customerStats[customer.name]) customerStats[customer.name] = { ist: 0, soll: 0, count: 0 };
          customerStats[customer.name].ist += projectIst;
          customerStats[customer.name].soll += projectSoll;
          customerStats[customer.name].count++;
        }
      });

      // Summary section
      analyticsSheet.getRow(3).getCell(1).value = 'SUMMARY';
      analyticsSheet.getRow(3).getCell(1).font = { name: 'Arial', size: 12, bold: true };
      
      const summaryData = [
        ['Total Projects', filteredProjects.length],
        ['Completed (100%+)', completedProjects],
        ['In Progress', inProgressProjects],
        ['Not Started', notStartedProjects],
        ['Total IST', totalIstAll],
        ['Total SOLL', totalSollAll],
        ['Overall Progress', totalSollAll > 0 ? `${Math.round((totalIstAll / totalSollAll) * 100)}%` : '-'],
        ['Current Week', `KW${currentWeek.toString().padStart(2, '0')}`]
      ];

      summaryData.forEach((data, idx) => {
        const row = analyticsSheet.getRow(idx + 4);
        row.getCell(1).value = data[0];
        row.getCell(1).font = { name: 'Arial', size: 10 };
        row.getCell(2).value = data[1];
        row.getCell(2).font = { name: 'Arial', size: 10, bold: true };
        row.getCell(2).alignment = { horizontal: 'center' };
      });

      // Test breakdown section
      const testStartRow = 14;
      analyticsSheet.getRow(testStartRow).getCell(1).value = 'BY TEST TYPE';
      analyticsSheet.getRow(testStartRow).getCell(1).font = { name: 'Arial', size: 12, bold: true };

      const testHeaders = ['Test', 'Projects', 'IST', 'SOLL', 'Progress'];
      testHeaders.forEach((h, i) => {
        const cell = analyticsSheet.getRow(testStartRow + 1).getCell(i + 1);
        cell.value = h;
        cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF333333' } };
        cell.alignment = { horizontal: 'center' };
      });

      let testRowNum = testStartRow + 2;
      Object.entries(testStats).forEach(([testName, stats]) => {
        const row = analyticsSheet.getRow(testRowNum);
        row.getCell(1).value = testName;
        row.getCell(2).value = stats.count;
        row.getCell(3).value = stats.ist;
        row.getCell(4).value = stats.soll;
        row.getCell(5).value = stats.soll > 0 ? `${Math.round((stats.ist / stats.soll) * 100)}%` : '-';
        
        for (let i = 1; i <= 5; i++) {
          row.getCell(i).font = { name: 'Arial', size: 9 };
          row.getCell(i).alignment = { horizontal: i === 1 ? 'left' : 'center' };
          row.getCell(i).border = {
            top: { style: 'thin', color: { argb: 'FFCCCCCC' } },
            left: { style: 'thin', color: { argb: 'FFCCCCCC' } },
            bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } },
            right: { style: 'thin', color: { argb: 'FFCCCCCC' } }
          };
        }
        testRowNum++;
      });

      // Customer breakdown section
      const customerStartRow = testRowNum + 2;
      analyticsSheet.getRow(customerStartRow).getCell(1).value = 'BY CUSTOMER';
      analyticsSheet.getRow(customerStartRow).getCell(1).font = { name: 'Arial', size: 12, bold: true };

      const customerHeaders = ['Customer', 'Projects', 'IST', 'SOLL', 'Progress'];
      customerHeaders.forEach((h, i) => {
        const cell = analyticsSheet.getRow(customerStartRow + 1).getCell(i + 1);
        cell.value = h;
        cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF333333' } };
        cell.alignment = { horizontal: 'center' };
      });

      let customerRowNum = customerStartRow + 2;
      Object.entries(customerStats).forEach(([customerName, stats]) => {
        const row = analyticsSheet.getRow(customerRowNum);
        row.getCell(1).value = customerName;
        row.getCell(2).value = stats.count;
        row.getCell(3).value = stats.ist;
        row.getCell(4).value = stats.soll;
        row.getCell(5).value = stats.soll > 0 ? `${Math.round((stats.ist / stats.soll) * 100)}%` : '-';
        
        for (let i = 1; i <= 5; i++) {
          row.getCell(i).font = { name: 'Arial', size: 9 };
          row.getCell(i).alignment = { horizontal: i === 1 ? 'left' : 'center' };
          row.getCell(i).border = {
            top: { style: 'thin', color: { argb: 'FFCCCCCC' } },
            left: { style: 'thin', color: { argb: 'FFCCCCCC' } },
            bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } },
            right: { style: 'thin', color: { argb: 'FFCCCCCC' } }
          };
        }
        customerRowNum++;
      });

      // ==================== SHEET 4: Weekly Data ====================
      const weeklySheet = workbook.addWorksheet('Weekly Data');
      
      weeklySheet.mergeCells('A1:D1');
      const weeklyTitle = weeklySheet.getCell('A1');
      weeklyTitle.value = 'Weekly Data - Kappa Planning ' + this.state.selectedYear;
      weeklyTitle.font = { name: 'Arial', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
      weeklyTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0097AC' } };
      weeklyTitle.alignment = { horizontal: 'center', vertical: 'middle' };
      weeklySheet.getRow(1).height = 30;

      weeklySheet.getColumn(1).width = 12;
      weeklySheet.getColumn(2).width = 12;
      weeklySheet.getColumn(3).width = 12;
      weeklySheet.getColumn(4).width = 15;

      const weeklyHeaders = ['Week', 'IST', 'SOLL', 'Progress'];
      weeklyHeaders.forEach((h, i) => {
        const cell = weeklySheet.getRow(3).getCell(i + 1);
        cell.value = h;
        cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF333333' } };
        cell.alignment = { horizontal: 'center' };
      });

      for (let week = 1; week <= 52; week++) {
        const stats = weeklyStats[week] || { ist: 0, soll: 0 };
        const row = weeklySheet.getRow(week + 3);
        const isCurrentWeek = week === currentWeek && this.state.selectedYear === currentYear;
        
        row.getCell(1).value = `KW${week.toString().padStart(2, '0')}`;
        row.getCell(2).value = stats.ist;
        row.getCell(3).value = stats.soll;
        row.getCell(4).value = stats.soll > 0 ? `${Math.round((stats.ist / stats.soll) * 100)}%` : '-';
        
        for (let i = 1; i <= 4; i++) {
          const cell = row.getCell(i);
          cell.font = { name: 'Arial', size: 9 };
          cell.alignment = { horizontal: 'center' };
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFCCCCCC' } },
            left: { style: 'thin', color: { argb: 'FFCCCCCC' } },
            bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } },
            right: { style: 'thin', color: { argb: 'FFCCCCCC' } }
          };
          
          if (isCurrentWeek) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0F7FA' } };
            cell.font = { ...cell.font, bold: true };
          }
        }
      }

      // ==================== SHEET 5: Raw Data ====================
      const rawSheet = workbook.addWorksheet('Raw Data');
      
      rawSheet.mergeCells('A1:H1');
      const rawTitle = rawSheet.getCell('A1');
      rawTitle.value = 'Raw Data - All Projects';
      rawTitle.font = { name: 'Arial', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
      rawTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0097AC' } };
      rawTitle.alignment = { horizontal: 'center', vertical: 'middle' };
      rawSheet.getRow(1).height = 30;

      const rawHeaders = ['ID', 'Customer', 'Type', 'Part', 'Test', 'Total IST', 'Total SOLL', 'Progress'];
      rawHeaders.forEach((h, i) => {
        const cell = rawSheet.getRow(3).getCell(i + 1);
        cell.value = h;
        cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF333333' } };
        cell.alignment = { horizontal: 'center' };
      });

      rawSheet.getColumn(1).width = 10;
      rawSheet.getColumn(2).width = 18;
      rawSheet.getColumn(3).width = 12;
      rawSheet.getColumn(4).width = 18;
      rawSheet.getColumn(5).width = 18;
      rawSheet.getColumn(6).width = 12;
      rawSheet.getColumn(7).width = 12;
      rawSheet.getColumn(8).width = 12;

      let rawRowNum = 4;
      filteredProjects.forEach((project, idx) => {
        const customer = this.state.customers.find(c => c.id === project.customer_id);
        const type = this.state.types.find(t => t.id === project.type_id);
        const part = this.state.parts.find(p => p.id === project.part_id);
        const test = this.state.tests.find(t => t.id === project.test_id);

        let totalIst = 0, totalSoll = 0;
        for (let week = 1; week <= 52; week++) {
          const kwNum = `KW${week.toString().padStart(2, '0')}`;
          const yearWeekKey = `${this.state.selectedYear}-${kwNum}`;
          const weekData = project.weeks[yearWeekKey] || { ist: 0, soll: 0 };
          totalIst += weekData.ist;
          totalSoll += weekData.soll;
        }

        const row = rawSheet.getRow(rawRowNum);
        row.getCell(1).value = idx + 1;
        row.getCell(2).value = customer?.name || '-';
        row.getCell(3).value = type?.name || '-';
        row.getCell(4).value = part?.name || '-';
        row.getCell(5).value = test?.name || '-';
        row.getCell(6).value = totalIst;
        row.getCell(7).value = totalSoll;
        row.getCell(8).value = totalSoll > 0 ? `${Math.round((totalIst / totalSoll) * 100)}%` : '-';

        for (let i = 1; i <= 8; i++) {
          row.getCell(i).font = { name: 'Arial', size: 9 };
          row.getCell(i).alignment = { horizontal: i <= 5 ? 'left' : 'center' };
          row.getCell(i).border = {
            top: { style: 'thin', color: { argb: 'FFCCCCCC' } },
            left: { style: 'thin', color: { argb: 'FFCCCCCC' } },
            bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } },
            right: { style: 'thin', color: { argb: 'FFCCCCCC' } }
          };
        }
        rawRowNum++;
      });

      // Generate file
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const filename = `Kappaplannung_${this.state.selectedYear}_${new Date().toISOString().split('T')[0]}.xlsx`;
      saveAs(blob, filename);
      
      this.showToast(i18n.t('messages.exportSuccessfully'), 'success');
    } catch (error) {
      console.error('Export error:', error);
      this.showToast(i18n.t('messages.errorOccurred'), 'error');
    }
  }

  // ==================== Analytics Export Functions ====================
  
  private showExportProgress(show: boolean, progress: number = 0, message: string = ''): void {
    let overlay = document.getElementById('exportProgressOverlay');
    
    if (!overlay && show) {
      overlay = document.createElement('div');
      overlay.id = 'exportProgressOverlay';
      overlay.className = 'export-progress-overlay';
      overlay.innerHTML = `
        <div class="export-progress-modal">
          <div class="export-progress-icon">
            <svg class="spinner" viewBox="0 0 50 50">
              <circle cx="25" cy="25" r="20" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-dasharray="89, 200" stroke-dashoffset="-35"></circle>
            </svg>
          </div>
          <h3 class="export-progress-title">Generowanie raportu...</h3>
          <p class="export-progress-message" id="exportProgressMessage">${message}</p>
          <div class="export-progress-bar">
            <div class="export-progress-bar-fill" id="exportProgressBarFill" style="width: ${progress}%"></div>
          </div>
          <span class="export-progress-percent" id="exportProgressPercent">${progress}%</span>
        </div>
      `;
      document.body.appendChild(overlay);
      setTimeout(() => overlay?.classList.add('show'), 10);
    } else if (overlay) {
      if (show) {
        overlay.classList.add('show');
        const msgEl = document.getElementById('exportProgressMessage');
        const barFill = document.getElementById('exportProgressBarFill');
        const percentEl = document.getElementById('exportProgressPercent');
        if (msgEl) msgEl.textContent = message;
        if (barFill) barFill.style.width = `${progress}%`;
        if (percentEl) percentEl.textContent = `${progress}%`;
      } else {
        overlay.classList.remove('show');
        setTimeout(() => overlay?.remove(), 300);
      }
    }
  }

  private getFilterInfo(): { year: number; weekFrom: number; weekTo: number; rangeText: string } {
    const fromSelect = document.getElementById('analyticsWeekFrom') as HTMLSelectElement;
    const toSelect = document.getElementById('analyticsWeekTo') as HTMLSelectElement;
    
    const weekFrom = fromSelect ? parseInt(fromSelect.value) || 1 : 1;
    const weekTo = toSelect ? parseInt(toSelect.value) || 52 : 52;
    const year = this.state.selectedYear;
    
    const rangeText = weekFrom === 1 && weekTo === 52 
      ? i18n.t('analytics.fullYear').replace('{0}', String(year)) 
      : `KW${weekFrom.toString().padStart(2, '0')} - KW${weekTo.toString().padStart(2, '0')} ${year}`;
    
    return { year, weekFrom, weekTo, rangeText };
  }

  private async exportAnalyticsToPdf(): Promise<void> {
    try {
      const t = (key: string) => i18n.t(key);
      const lang = i18n.getLanguage();
      const dateLocale = lang === 'de' ? 'de-DE' : lang === 'pl' ? 'pl-PL' : lang === 'ro' ? 'ro-RO' : 'en-US';
      
      this.showExportProgress(true, 5, t('export.preparingReport'));
      
      const filterInfo = this.getFilterInfo();
      const analyticsView = document.getElementById('analyticsView');
      if (!analyticsView) throw new Error('Analytics view not found');
      
      this.showExportProgress(true, 10, t('export.creatingHeader'));
      
      // Get analytics data
      const analyticsData = this.calculateAnalyticsData();
      const projects = this.getFilteredProjects();
      
      const dateStr = new Date().toLocaleDateString(dateLocale);
      const timeStr = new Date().toLocaleTimeString(dateLocale);
      
      // Helper to create a page section - A4 ratio: 1000px width = 1414px height
      const pageHeight = 1414;
      const headerHeight = 110; // black + teal headers
      const footerHeight = 40;
      
      const createPageSection = (content: string, includeHeader: boolean = false): HTMLDivElement => {
        const section = document.createElement('div');
        section.style.cssText = `width: 1000px; height: ${pageHeight}px; background: #f8fafc; padding: 0; position: relative; overflow: hidden;`;
        
        if (includeHeader) {
          section.innerHTML = `
            <div style="background: #000; color: #fff; padding: 20px 28px; display: flex; justify-content: space-between; align-items: center;">
              <div>
                <h1 style="margin: 0; font-size: 24px; font-weight: 700; letter-spacing: 1px;">DRÄXLMAIER Group</h1>
                <p style="margin: 5px 0 0 0; font-size: 14px; opacity: 0.85;">Produkt Audit 360</p>
              </div>
              <div style="text-align: right;">
                <p style="margin: 0; font-size: 13px; opacity: 0.9;">${t('export.analyticsReport')}</p>
                <p style="margin: 3px 0 0 0; font-size: 12px; opacity: 0.7;">${filterInfo.rangeText}</p>
              </div>
            </div>
            <div style="background: #0097AC; color: #fff; padding: 10px 28px; display: flex; justify-content: space-between; font-size: 11px;">
              <span><strong>${t('export.generatedAt')}:</strong> ${dateStr} ${timeStr}</span>
              <span><strong>${t('export.user')}:</strong> ${this.state.settings.userName || 'System'}</span>
            </div>
          `;
        }
        
        const contentHeight = pageHeight - (includeHeader ? headerHeight : 0) - footerHeight;
        section.innerHTML += `<div style="padding: 24px 28px; background: #f8fafc; min-height: ${contentHeight}px;">${content}</div>`;
        
        // Add footer - positioned at bottom
        section.innerHTML += `
          <div style="background: #1e293b; color: #fff; padding: 12px 28px; text-align: center; font-size: 10px; position: absolute; bottom: 0; left: 0; right: 0;">
            <p style="margin: 0; opacity: 0.8;">© ${new Date().getFullYear()} ${t('export.copyright')}</p>
          </div>
        `;
        
        return section;
      };
      
      this.showExportProgress(true, 20, t('export.copyingContent'));
      
      // Calculate test type statistics - using getWeekData for year-aware lookup
      const testTypeStats = new Map<string, { name: string; count: number; ist: number; soll: number }>();
      const filterInfo2 = this.getFilterInfo();
      projects.forEach(project => {
        const test = this.state.tests.find(t => t.id === project.test_id);
        const testName = test?.name || 'Unknown';
        
        if (!testTypeStats.has(project.test_id)) {
          testTypeStats.set(project.test_id, { name: testName, count: 0, ist: 0, soll: 0 });
        }
        
        const ts = testTypeStats.get(project.test_id)!;
        ts.count++;
        
        for (let week = filterInfo2.weekFrom; week <= filterInfo2.weekTo; week++) {
          const weekKey = `KW${week.toString().padStart(2, '0')}`;
          const wd = this.getWeekData(project, weekKey);
          ts.ist += wd.ist || 0;
          ts.soll += wd.soll || 0;
        }
      });
      
      const testStats = Array.from(testTypeStats.values())
        .map(ts => ({ ...ts, percent: ts.soll > 0 ? (ts.ist / ts.soll * 100) : 0 }))
        .sort((a, b) => b.count - a.count);
      
      // Calculate status distribution - using getWeekData for year-aware lookup
      let completedCount = 0, inProgressCount = 0, delayedCount = 0, notStartedCount = 0;
      projects.forEach(project => {
        let istTotal = 0, sollTotal = 0;
        for (let w = filterInfo2.weekFrom; w <= filterInfo2.weekTo; w++) {
          const weekKey = `KW${w.toString().padStart(2, '0')}`;
          const wd = this.getWeekData(project, weekKey);
          istTotal += wd.ist || 0;
          sollTotal += wd.soll || 0;
        }
        const percent = sollTotal > 0 ? (istTotal / sollTotal * 100) : 0;
        if (sollTotal === 0) notStartedCount++;
        else if (percent >= 100) completedCount++;
        else if (percent >= 50) inProgressCount++;
        else delayedCount++;
      });
      
      // Calculate weekly data - using getWeekData for year-aware lookup
      const weeklyData: { week: number; ist: number; soll: number }[] = [];
      for (let w = filterInfo2.weekFrom; w <= filterInfo2.weekTo; w++) {
        let weekIst = 0, weekSoll = 0;
        const weekKey = `KW${w.toString().padStart(2, '0')}`;
        projects.forEach(project => {
          const wd = this.getWeekData(project, weekKey);
          weekIst += wd.ist || 0;
          weekSoll += wd.soll || 0;
        });
        weeklyData.push({ week: w, ist: weekIst, soll: weekSoll });
      }
      
      // PAGE 1: KPI + Customer Statistics + Test Type Stats + Status + Projects
      const kpiContent = `
        <div style="margin-bottom: 12px;">
          <h2 style="margin: 0 0 8px 0; font-size: 16px; color: #1e293b; border-bottom: 2px solid #0097AC; padding-bottom: 4px;">📊 ${t('export.kpiTitle')}</h2>
          <div style="display: grid; grid-template-columns: repeat(8, 1fr); gap: 8px;">
            <div style="background: #fff; padding: 10px; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.06);">
              <div style="font-size: 24px; font-weight: 700; color: #0097AC;">${analyticsData.totalProjects}</div>
              <div style="font-size: 11px; color: #64748b;">${t('export.projects')}</div>
            </div>
            <div style="background: #fff; padding: 10px; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.06);">
              <div style="font-size: 24px; font-weight: 700; color: #10b981;">${analyticsData.totalIst.toLocaleString(dateLocale)}</div>
              <div style="font-size: 11px; color: #64748b;">${t('export.testsIst')}</div>
            </div>
            <div style="background: #fff; padding: 10px; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.06);">
              <div style="font-size: 24px; font-weight: 700; color: #6366f1;">${analyticsData.totalSoll.toLocaleString(dateLocale)}</div>
              <div style="font-size: 11px; color: #64748b;">${t('export.testsSoll')}</div>
            </div>
            <div style="background: #fff; padding: 10px; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.06);">
              <div style="font-size: 24px; font-weight: 700; color: ${analyticsData.totalPercent >= 100 ? '#10b981' : analyticsData.totalPercent >= 50 ? '#f59e0b' : '#ef4444'};">${analyticsData.totalPercent.toFixed(1)}%</div>
              <div style="font-size: 11px; color: #64748b;">${t('export.realization')}</div>
            </div>
            <div style="background: #dcfce7; padding: 10px; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.06);">
              <div style="font-size: 24px; font-weight: 700; color: #166534;">${completedCount}</div>
              <div style="font-size: 11px; color: #166534;">${t('export.completedProjects')}</div>
            </div>
            <div style="background: #fef3c7; padding: 10px; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.06);">
              <div style="font-size: 24px; font-weight: 700; color: #92400e;">${inProgressCount}</div>
              <div style="font-size: 11px; color: #92400e;">${t('export.inProgressProjects')}</div>
            </div>
            <div style="background: #fee2e2; padding: 10px; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.06);">
              <div style="font-size: 24px; font-weight: 700; color: #991b1b;">${delayedCount}</div>
              <div style="font-size: 11px; color: #991b1b;">${t('export.delayedProjects')}</div>
            </div>
            <div style="background: #f1f5f9; padding: 10px; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.06);">
              <div style="font-size: 24px; font-weight: 700; color: #64748b;">${notStartedCount}</div>
              <div style="font-size: 11px; color: #64748b;">${t('analytics.pending')}</div>
            </div>
          </div>
        </div>
        
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 12px;">
          <div>
            <h2 style="margin: 0 0 6px 0; font-size: 14px; color: #1e293b; border-bottom: 2px solid #0097AC; padding-bottom: 3px;">👥 ${t('export.customerStats')}</h2>
            <table style="width: 100%; border-collapse: collapse; background: #fff; border-radius: 6px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.06);">
              <thead>
                <tr style="background: #1e293b; color: #fff;">
                  <th style="padding: 5px 6px; text-align: left; font-weight: 600; font-size: 11px;">${t('export.customer')}</th>
                  <th style="padding: 5px 6px; text-align: center; font-weight: 600; font-size: 11px;">#</th>
                  <th style="padding: 5px 6px; text-align: center; font-weight: 600; font-size: 11px;">IST</th>
                  <th style="padding: 5px 6px; text-align: center; font-weight: 600; font-size: 11px;">SOLL</th>
                  <th style="padding: 5px 6px; text-align: center; font-weight: 600; font-size: 11px;">%</th>
                </tr>
              </thead>
              <tbody>
                ${analyticsData.customerStats.slice(0, 10).map((cs, idx) => `
                  <tr style="background: ${idx % 2 === 0 ? '#fff' : '#f1f5f9'};">
                    <td style="padding: 5px 6px; font-weight: 600; font-size: 11px; color: #0f172a;">${cs.name}</td>
                    <td style="padding: 5px 6px; text-align: center; font-size: 11px; color: #1e293b; font-weight: 500;">${cs.count}</td>
                    <td style="padding: 5px 6px; text-align: center; font-size: 11px; color: #059669; font-weight: 600;">${cs.ist}</td>
                    <td style="padding: 5px 6px; text-align: center; font-size: 11px; color: #4f46e5; font-weight: 600;">${cs.soll}</td>
                    <td style="padding: 5px 6px; text-align: center;">
                      <span style="display: inline-block; padding: 3px 8px; border-radius: 8px; font-weight: 700; font-size: 11px;
                        background: ${cs.percent >= 100 ? '#bbf7d0' : cs.percent >= 50 ? '#fde68a' : '#fecaca'};
                        color: ${cs.percent >= 100 ? '#14532d' : cs.percent >= 50 ? '#78350f' : '#7f1d1d'};">
                        ${cs.percent.toFixed(0)}%
                      </span>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          
          <div>
            <h2 style="margin: 0 0 6px 0; font-size: 14px; color: #1e293b; border-bottom: 2px solid #0097AC; padding-bottom: 3px;">🔬 ${t('export.testTypeStats')}</h2>
            <table style="width: 100%; border-collapse: collapse; background: #fff; border-radius: 6px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.06);">
              <thead>
                <tr style="background: #1e293b; color: #fff;">
                  <th style="padding: 5px 6px; text-align: left; font-weight: 600; font-size: 11px;">${t('export.test')}</th>
                  <th style="padding: 5px 6px; text-align: center; font-weight: 600; font-size: 11px;">#</th>
                  <th style="padding: 5px 6px; text-align: center; font-weight: 600; font-size: 11px;">IST</th>
                  <th style="padding: 5px 6px; text-align: center; font-weight: 600; font-size: 11px;">SOLL</th>
                  <th style="padding: 5px 6px; text-align: center; font-weight: 600; font-size: 11px;">%</th>
                </tr>
              </thead>
              <tbody>
                ${testStats.slice(0, 10).map((ts, idx) => `
                  <tr style="background: ${idx % 2 === 0 ? '#fff' : '#f1f5f9'};">
                    <td style="padding: 5px 6px; font-weight: 600; font-size: 11px; color: #0f172a;">${ts.name.substring(0, 18)}</td>
                    <td style="padding: 5px 6px; text-align: center; font-size: 11px; color: #1e293b; font-weight: 500;">${ts.count}</td>
                    <td style="padding: 5px 6px; text-align: center; font-size: 11px; color: #059669; font-weight: 600;">${ts.ist}</td>
                    <td style="padding: 5px 6px; text-align: center; font-size: 11px; color: #4f46e5; font-weight: 600;">${ts.soll}</td>
                    <td style="padding: 5px 6px; text-align: center;">
                      <span style="display: inline-block; padding: 3px 8px; border-radius: 8px; font-weight: 700; font-size: 11px;
                        background: ${ts.percent >= 100 ? '#bbf7d0' : ts.percent >= 50 ? '#fde68a' : '#fecaca'};
                        color: ${ts.percent >= 100 ? '#14532d' : ts.percent >= 50 ? '#78350f' : '#7f1d1d'};">
                        ${ts.percent.toFixed(0)}%
                      </span>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          
          <div>
            <h2 style="margin: 0 0 6px 0; font-size: 14px; color: #1e293b; border-bottom: 2px solid #0097AC; padding-bottom: 3px;">📅 ${t('export.weeklyData')}</h2>
            <table style="width: 100%; border-collapse: collapse; background: #fff; border-radius: 6px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.06);">
              <thead>
                <tr style="background: #1e293b; color: #fff;">
                  <th style="padding: 5px 6px; text-align: left; font-weight: 600; font-size: 11px;">${t('export.week')}</th>
                  <th style="padding: 5px 6px; text-align: center; font-weight: 600; font-size: 11px;">IST</th>
                  <th style="padding: 5px 6px; text-align: center; font-weight: 600; font-size: 11px;">SOLL</th>
                  <th style="padding: 5px 6px; text-align: center; font-weight: 600; font-size: 11px;">%</th>
                </tr>
              </thead>
              <tbody>
                ${weeklyData.slice(0, 10).map((wd, idx) => {
                  const pct = wd.soll > 0 ? (wd.ist / wd.soll * 100) : 0;
                  return `
                  <tr style="background: ${idx % 2 === 0 ? '#fff' : '#f1f5f9'};">
                    <td style="padding: 5px 6px; font-weight: 600; font-size: 11px; color: #0f172a;">KW ${wd.week}</td>
                    <td style="padding: 5px 6px; text-align: center; font-size: 11px; color: #059669; font-weight: 600;">${wd.ist}</td>
                    <td style="padding: 5px 6px; text-align: center; font-size: 11px; color: #4f46e5; font-weight: 600;">${wd.soll}</td>
                    <td style="padding: 5px 6px; text-align: center;">
                      <span style="display: inline-block; padding: 3px 8px; border-radius: 8px; font-weight: 700; font-size: 11px;
                        background: ${pct >= 100 ? '#bbf7d0' : pct >= 50 ? '#fde68a' : '#fecaca'};
                        color: ${pct >= 100 ? '#14532d' : pct >= 50 ? '#78350f' : '#7f1d1d'};">
                        ${pct.toFixed(0)}%
                      </span>
                    </td>
                  </tr>
                `}).join('')}
              </tbody>
            </table>
          </div>
        </div>
        
        <div>
          <h2 style="margin: 0 0 6px 0; font-size: 14px; color: #1e293b; border-bottom: 2px solid #0097AC; padding-bottom: 3px;">📋 ${t('export.projectList')}</h2>
          <table style="width: 100%; border-collapse: collapse; background: #fff; border-radius: 6px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.06); font-size: 10px;">
            <thead>
              <tr style="background: #1e293b; color: #fff;">
                <th style="padding: 5px 6px; text-align: left; font-weight: 600;">${t('export.customer')}</th>
                <th style="padding: 5px 6px; text-align: left; font-weight: 600;">${t('export.type')}</th>
                <th style="padding: 5px 6px; text-align: left; font-weight: 600;">${t('export.part')}</th>
                <th style="padding: 5px 6px; text-align: left; font-weight: 600;">${t('export.test')}</th>
                <th style="padding: 5px 6px; text-align: center; font-weight: 600;">IST</th>
                <th style="padding: 5px 6px; text-align: center; font-weight: 600;">SOLL</th>
                <th style="padding: 5px 6px; text-align: center; font-weight: 600;">%</th>
              </tr>
            </thead>
            <tbody>
              ${projects.slice(0, 18).map((project, idx) => {
                const customer = this.state.customers.find(c => c.id === project.customer_id);
                const type = this.state.types.find(t => t.id === project.type_id);
                const part = this.state.parts.find(p => p.id === project.part_id);
                const test = this.state.tests.find(t => t.id === project.test_id);
                
                let istTotal = 0, sollTotal = 0;
                for (let w = filterInfo.weekFrom; w <= filterInfo.weekTo; w++) {
                  const weekKey = `KW${w.toString().padStart(2, '0')}`;
                  const wd = this.getWeekData(project, weekKey);
                  istTotal += wd.ist || 0; sollTotal += wd.soll || 0;
                }
                const percent = sollTotal > 0 ? (istTotal / sollTotal * 100) : 0;
                
                return `
                  <tr style="background: ${idx % 2 === 0 ? '#fff' : '#f1f5f9'};">
                    <td style="padding: 5px 6px; color: #0f172a; font-weight: 600;">${customer?.name || '-'}</td>
                    <td style="padding: 5px 6px; color: #334155;">${type?.name || '-'}</td>
                    <td style="padding: 5px 6px; color: #334155;">${(part?.name || '-').substring(0, 18)}</td>
                    <td style="padding: 5px 6px; color: #334155;">${(test?.name || '-').substring(0, 18)}</td>
                    <td style="padding: 5px 6px; text-align: center; color: #059669; font-weight: 600;">${istTotal}</td>
                    <td style="padding: 5px 6px; text-align: center; color: #4f46e5; font-weight: 600;">${sollTotal}</td>
                    <td style="padding: 5px 6px; text-align: center;">
                      <span style="padding: 3px 6px; border-radius: 6px; font-weight: 700; font-size: 10px;
                        background: ${percent >= 100 ? '#bbf7d0' : percent >= 50 ? '#fde68a' : '#fecaca'};
                        color: ${percent >= 100 ? '#14532d' : percent >= 50 ? '#78350f' : '#7f1d1d'};">
                        ${percent.toFixed(0)}%
                      </span>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
          ${projects.length > 18 ? `<p style="margin: 6px 0 0 0; font-size: 9px; color: #64748b; text-align: center;">${t('export.moreProjectsOnNextPages')} (+${projects.length - 18})</p>` : ''}
        </div>
      `;
      
      // Capture chart images before creating pages
      this.showExportProgress(true, 30, t('export.addingCharts'));
      const chartNames: { [key: string]: string } = {
        'weeklyChart': t('export.chartWeeklyIstSoll'),
        'testChart': t('export.chartTestDistribution'),
        'customerBarChart': t('export.chartCustomerComparison'),
        'velocityChart': t('export.chartVelocity'),
        'radarChart': t('export.chartRadar'),
        'trendChart': t('export.chartTrend')
      };
      
      // Always force light mode for PDF and ensure all charts are rendered
      const wasDarkMode = this.state.settings.darkMode;
      this.state.settings.darkMode = false;
      
      // Disable Chart.js animations for instant rendering for PDF capture
      const origAnimation = (Chart as any).defaults.animation;
      (Chart as any).defaults.animation = false;
      
      // Force re-render ALL charts to ensure they exist and have light mode colors (no animation)
      this.renderWeeklyChart();
      this.renderTestChart();
      this.renderCustomerBarChart();
      this.renderVelocityChart();
      this.renderRadarChart();
      this.renderTrendChart();
      
      // Small wait for synchronous Chart.js render to flush to canvas
      await new Promise(r => setTimeout(r, 200));
      
      const chartIds = ['weeklyChart', 'testChart', 'customerBarChart', 'velocityChart', 'radarChart', 'trendChart'];
      const chartImages: { [key: string]: string } = {};
      
      // Capture charts using direct canvas.toDataURL() - most reliable method
      for (const chartId of chartIds) {
        const chartCanvas = document.getElementById(chartId) as HTMLCanvasElement;
        if (chartCanvas && chartCanvas.width > 0 && chartCanvas.height > 0) {
          try {
            chartImages[chartId] = chartCanvas.toDataURL('image/png', 1.0);
            console.log(`Captured ${chartId}: ${chartCanvas.width}x${chartCanvas.height}`);
          } catch (e) {
            console.error(`Error capturing chart ${chartId}:`, e);
          }
        } else {
          console.warn(`Chart ${chartId} not found or has zero dimensions`);
        }
      }
      
      // Restore Chart.js animation defaults
      (Chart as any).defaults.animation = origAnimation;
      
      // Restore dark mode if it was enabled
      if (wasDarkMode) {
        this.state.settings.darkMode = true;
        this.renderWeeklyChart();
        this.renderTestChart();
        this.renderCustomerBarChart();
        this.renderVelocityChart();
        this.renderRadarChart();
        this.renderTrendChart();
      }
      
      // Add 2 charts to page 1 content with titles
      let page1ChartsHtml = `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 14px;">
      `;
      if (chartImages['weeklyChart']) {
        page1ChartsHtml += `
          <div style="background: #fff; padding: 8px; border-radius: 10px; box-shadow: 0 3px 6px rgba(0,0,0,0.12); border: 2px solid #0097AC;">
            <div style="font-size: 11px; font-weight: 700; color: #1e293b; padding: 4px 4px 6px 4px; border-bottom: 1px solid #e2e8f0;">📈 ${chartNames['weeklyChart']}</div>
            <img src="${chartImages['weeklyChart']}" style="max-width: 100%; height: auto; border-radius: 6px;" />
          </div>
        `;
      }
      if (chartImages['testChart']) {
        page1ChartsHtml += `
          <div style="background: #fff; padding: 8px; border-radius: 10px; box-shadow: 0 3px 6px rgba(0,0,0,0.12); border: 2px solid #0097AC;">
            <div style="font-size: 11px; font-weight: 700; color: #1e293b; padding: 4px 4px 6px 4px; border-bottom: 1px solid #e2e8f0;">🍩 ${chartNames['testChart']}</div>
            <img src="${chartImages['testChart']}" style="max-width: 100%; height: auto; border-radius: 6px;" />
          </div>
        `;
      }
      page1ChartsHtml += `</div>`;
      
      const fullPage1Content = kpiContent + page1ChartsHtml;
      const page1 = createPageSection(fullPage1Content, true);
      
      this.showExportProgress(true, 35, t('export.addingCharts'));
      
      // PAGE 2: All 6 Charts in 3x2 grid
      let chartsHtml = `<h2 style="margin: 0 0 10px 0; font-size: 16px; color: #0f172a; font-weight: 700; border-bottom: 3px solid #0097AC; padding-bottom: 6px;">📈 ${t('export.charts')}</h2>`;
      chartsHtml += `<div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; margin-bottom: 14px;">`;
      
      // Show all 6 charts on page 2 with chart titles
      const chartEmojis: { [key: string]: string } = {
        'weeklyChart': '📈', 'testChart': '🍩', 'customerBarChart': '📊',
        'velocityChart': '🚀', 'radarChart': '🎯', 'trendChart': '📉'
      };
      const page2ChartIds = ['weeklyChart', 'testChart', 'customerBarChart', 'velocityChart', 'radarChart', 'trendChart'];
      for (const chartId of page2ChartIds) {
        if (chartImages[chartId]) {
          chartsHtml += `
            <div style="background: #fff; padding: 8px; border-radius: 10px; box-shadow: 0 3px 6px rgba(0,0,0,0.12); border: 2px solid #0097AC;">
              <div style="font-size: 11px; font-weight: 700; color: #1e293b; padding: 4px 4px 6px 4px; border-bottom: 1px solid #e2e8f0;">${chartEmojis[chartId] || '📊'} ${chartNames[chartId]}</div>
              <img src="${chartImages[chartId]}" style="max-width: 100%; height: auto; border-radius: 6px;" />
            </div>
          `;
        }
      }
      chartsHtml += `</div>`;
      
      const page2 = createPageSection(chartsHtml, true);
      
      this.showExportProgress(true, 40, t('export.addingCharts'));
      
      // PAGE 3: Advanced Analytics - Weekly Comparison, Quarterly & Monthly Summary, Stoppage
      let analyticsHtml = '';
      
      // Weekly Comparison grid
      analyticsHtml += `<h2 style="margin: 0 0 8px 0; font-size: 14px; color: #1e293b; border-bottom: 2px solid #0097AC; padding-bottom: 3px;">📅 ${t('export.weeklyComparison')}</h2>`;
      analyticsHtml += `<div style="display: grid; grid-template-columns: repeat(13, 1fr); gap: 3px; margin-bottom: 14px;">`;
      for (let w = filterInfo2.weekFrom; w <= filterInfo2.weekTo; w++) {
        const weekKey = `KW${w.toString().padStart(2, '0')}`;
        let wIst = 0, wSoll = 0;
        projects.forEach(p => { const d = this.getWeekData(p, weekKey); wIst += d.ist || 0; wSoll += d.soll || 0; });
        const pct = wSoll > 0 ? (wIst / wSoll * 100) : (wIst > 0 ? 100 : 0);
        const bg = wSoll === 0 && wIst === 0 ? '#f1f5f9' : pct >= 100 ? '#bbf7d0' : pct >= 50 ? '#fde68a' : pct > 0 ? '#fed7aa' : '#fecaca';
        const fg = wSoll === 0 && wIst === 0 ? '#94a3b8' : pct >= 100 ? '#14532d' : pct >= 50 ? '#78350f' : '#7f1d1d';
        analyticsHtml += `<div style="background: ${bg}; border-radius: 4px; padding: 4px 2px; text-align: center; font-size: 8px;">
          <div style="font-weight: 700; color: ${fg};">${weekKey.replace('KW', '')}</div>
          <div style="color: ${fg}; font-size: 7px;">${wIst}/${wSoll}</div>
          <div style="color: ${fg}; font-weight: 600; font-size: 7px;">${wSoll > 0 ? pct.toFixed(0) + '%' : '-'}</div>
        </div>`;
      }
      analyticsHtml += `</div>`;
      
      // Workload Heatmap
      analyticsHtml += `<h2 style="margin: 0 0 8px 0; font-size: 14px; color: #1e293b; border-bottom: 2px solid #0097AC; padding-bottom: 3px;">🗺️ ${t('export.workloadHeatmap')}</h2>`;
      const heatmapWeeks: number[] = [];
      for (let w = filterInfo2.weekFrom; w <= Math.min(filterInfo2.weekTo, filterInfo2.weekFrom + 25); w++) heatmapWeeks.push(w);
      analyticsHtml += `<table style="width: 100%; border-collapse: collapse; font-size: 8px; margin-bottom: 14px;">`;
      analyticsHtml += `<tr style="background: #1e293b; color: #fff;"><th style="padding: 3px 4px; text-align: left; font-size: 8px;">${t('export.test')}</th>`;
      heatmapWeeks.forEach(w => { analyticsHtml += `<th style="padding: 3px; text-align: center; font-size: 7px;">KW${w.toString().padStart(2, '0')}</th>`; });
      analyticsHtml += `</tr>`;
      this.state.tests.forEach((test, tIdx) => {
        analyticsHtml += `<tr style="background: ${tIdx % 2 === 0 ? '#fff' : '#f8fafc'};"><td style="padding: 3px 4px; font-weight: 600; font-size: 8px; white-space: nowrap; max-width: 80px; overflow: hidden; text-overflow: ellipsis;">${test.name.substring(0, 12)}</td>`;
        heatmapWeeks.forEach(w => {
          const weekKey = `KW${w.toString().padStart(2, '0')}`;
          let ist = 0, soll = 0;
          this.state.projects.filter(p => p.test_id === test.id).forEach(p => { const d = this.getWeekData(p, weekKey); ist += d.ist || 0; soll += d.soll || 0; });
          const remaining = Math.max(0, soll - ist);
          const isComplete = soll > 0 && ist >= soll;
          const cellBg = soll === 0 ? '#f8fafc' : isComplete ? '#bbf7d0' : remaining <= 2 ? '#fef3c7' : remaining <= 5 ? '#fed7aa' : '#fecaca';
          analyticsHtml += `<td style="padding: 2px; text-align: center; background: ${cellBg}; font-size: 7px; font-weight: 600;">${soll > 0 ? (isComplete ? '✓' : remaining) : ''}</td>`;
        });
        analyticsHtml += `</tr>`;
      });
      analyticsHtml += `</table>`;
      
      // Quarterly + Monthly in 2-column layout
      analyticsHtml += `<div style="display: grid; grid-template-columns: 1fr 2fr; gap: 12px; margin-bottom: 14px;">`;
      
      // Quarterly Summary
      analyticsHtml += `<div>`;
      analyticsHtml += `<h2 style="margin: 0 0 6px 0; font-size: 13px; color: #1e293b; border-bottom: 2px solid #0097AC; padding-bottom: 3px;">📊 ${t('export.quarterlySummary')}</h2>`;
      const qData: { [q: string]: { ist: number; soll: number } } = { Q1: {ist:0,soll:0}, Q2: {ist:0,soll:0}, Q3: {ist:0,soll:0}, Q4: {ist:0,soll:0} };
      projects.forEach(p => {
        for (let w = filterInfo2.weekFrom; w <= filterInfo2.weekTo; w++) {
          const weekKey = `KW${w.toString().padStart(2, '0')}`;
          const d = this.getWeekData(p, weekKey);
          const q = w <= 13 ? 'Q1' : w <= 26 ? 'Q2' : w <= 39 ? 'Q3' : 'Q4';
          qData[q].ist += d.ist || 0;
          qData[q].soll += d.soll || 0;
        }
      });
      analyticsHtml += `<table style="width: 100%; border-collapse: collapse; background: #fff; border-radius: 6px; overflow: hidden; font-size: 10px;">
        <thead><tr style="background: #1e293b; color: #fff;"><th style="padding: 5px;">Q</th><th style="padding: 5px;">IST</th><th style="padding: 5px;">SOLL</th><th style="padding: 5px;">${t('export.rate')}</th></tr></thead><tbody>`;
      ['Q1','Q2','Q3','Q4'].forEach((q, i) => {
        const rate = qData[q].soll > 0 ? (qData[q].ist / qData[q].soll * 100) : 0;
        analyticsHtml += `<tr style="background: ${i % 2 === 0 ? '#fff' : '#f1f5f9'};"><td style="padding: 5px; font-weight: 600;">${q}</td><td style="padding: 5px; text-align: center; color: #059669; font-weight: 600;">${qData[q].ist}</td><td style="padding: 5px; text-align: center; color: #4f46e5; font-weight: 600;">${qData[q].soll}</td><td style="padding: 5px; text-align: center;"><span style="padding: 2px 6px; border-radius: 6px; font-weight: 700; font-size: 10px; background: ${rate >= 100 ? '#bbf7d0' : rate >= 50 ? '#fde68a' : '#fecaca'}; color: ${rate >= 100 ? '#14532d' : rate >= 50 ? '#78350f' : '#7f1d1d'};">${rate.toFixed(0)}%</span></td></tr>`;
      });
      analyticsHtml += `</tbody></table></div>`;
      
      // Monthly Summary
      analyticsHtml += `<div>`;
      analyticsHtml += `<h2 style="margin: 0 0 6px 0; font-size: 13px; color: #1e293b; border-bottom: 2px solid #0097AC; padding-bottom: 3px;">📅 ${t('export.monthlySummary')}</h2>`;
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const monthWeeks = [[1,4], [5,8], [9,13], [14,17], [18,22], [23,26], [27,30], [31,35], [36,39], [40,44], [45,48], [49,52]];
      analyticsHtml += `<div style="display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px;">`;
      months.forEach((name, idx) => {
        let mIst = 0, mSoll = 0;
        const [start, end] = monthWeeks[idx];
        for (let w = start; w <= end; w++) {
          if (w < filterInfo2.weekFrom || w > filterInfo2.weekTo) continue;
          const weekKey = `KW${w.toString().padStart(2, '0')}`;
          projects.forEach(p => { const d = this.getWeekData(p, weekKey); mIst += d.ist || 0; mSoll += d.soll || 0; });
        }
        const rate = mSoll > 0 ? (mIst / mSoll * 100) : 0;
        const rColor = rate >= 90 ? '#10B981' : rate >= 70 ? '#3B82F6' : rate >= 50 ? '#F59E0B' : '#EF4444';
        analyticsHtml += `<div style="background: #fff; border-radius: 6px; padding: 6px; text-align: center; border: 1px solid #e2e8f0;">
          <div style="font-size: 8px; font-weight: 600; color: #64748b; text-transform: uppercase;">${name}</div>
          <div style="font-size: 14px; font-weight: 700;">${mIst}</div>
          <div style="font-size: 7px; color: #64748b;">/${mSoll}</div>
          ${mSoll > 0 ? `<div style="font-size: 8px; font-weight: 700; color: ${rColor}; margin-top: 2px;">${rate.toFixed(0)}%</div>` : ''}
        </div>`;
      });
      analyticsHtml += `</div></div></div>`;
      
      // Stoppage Report
      let stoppage = 0, prodLack = 0, normalWeeks = 0;
      projects.forEach(p => {
        for (let w = filterInfo2.weekFrom; w <= filterInfo2.weekTo; w++) {
          const weekKey = `KW${w.toString().padStart(2, '0')}`;
          const d = this.getWeekData(p, weekKey);
          if (d.stoppage) stoppage++;
          else if (d.productionLack) prodLack++;
          else if (d.soll > 0) normalWeeks++;
        }
      });
      const stoppageTotal = stoppage + prodLack + normalWeeks;
      analyticsHtml += `<h2 style="margin: 0 0 6px 0; font-size: 13px; color: #1e293b; border-bottom: 2px solid #0097AC; padding-bottom: 3px;">🚫 ${t('export.stoppageIssues')}</h2>`;
      analyticsHtml += `<div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;">
        <div style="background: #fee2e2; border-radius: 8px; padding: 10px; text-align: center;">
          <div style="font-size: 22px; font-weight: 700; color: #991b1b;">${stoppage}</div>
          <div style="font-size: 9px; color: #991b1b;">${t('export.stoppageLabel')} (${stoppageTotal > 0 ? Math.round((stoppage/stoppageTotal)*100) : 0}%)</div>
        </div>
        <div style="background: #fef3c7; border-radius: 8px; padding: 10px; text-align: center;">
          <div style="font-size: 22px; font-weight: 700; color: #92400e;">${prodLack}</div>
          <div style="font-size: 9px; color: #92400e;">${t('export.prodLackLabel')} (${stoppageTotal > 0 ? Math.round((prodLack/stoppageTotal)*100) : 0}%)</div>
        </div>
        <div style="background: #dcfce7; border-radius: 8px; padding: 10px; text-align: center;">
          <div style="font-size: 22px; font-weight: 700; color: #166534;">${normalWeeks}</div>
          <div style="font-size: 9px; color: #166534;">${t('export.normalLabel')}</div>
        </div>
      </div>`;
      
      const page3 = createPageSection(analyticsHtml, true);
      
      this.showExportProgress(true, 50, t('export.addingProjects'));
      
      // PAGE 4: Customer Analysis, Test Performance, Top/Bottom Performers, AI Insights
      let page4Html = '';
      
      // Customer Analysis
      page4Html += `<h2 style="margin: 0 0 8px 0; font-size: 14px; color: #1e293b; border-bottom: 2px solid #0097AC; padding-bottom: 3px;">👥 ${t('export.customerAnalysis')}</h2>`;
      const custAnalysis: { [key: string]: { count: number; ist: number; soll: number } } = {};
      projects.forEach(p => {
        const cust = this.state.customers.find(c => c.id === p.customer_id);
        const name = cust?.name || 'Unknown';
        if (!custAnalysis[name]) custAnalysis[name] = { count: 0, ist: 0, soll: 0 };
        custAnalysis[name].count++;
        for (let w = filterInfo2.weekFrom; w <= filterInfo2.weekTo; w++) {
          const weekKey = `KW${w.toString().padStart(2, '0')}`;
          const d = this.getWeekData(p, weekKey);
          custAnalysis[name].ist += d.ist || 0;
          custAnalysis[name].soll += d.soll || 0;
        }
      });
      page4Html += `<div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 14px;">`;
      Object.entries(custAnalysis).forEach(([name, data]) => {
        const rate = data.soll > 0 ? (data.ist / data.soll * 100) : 0;
        const color = rate >= 90 ? '#10B981' : rate >= 70 ? '#3B82F6' : rate >= 50 ? '#F59E0B' : '#EF4444';
        page4Html += `<div style="background: #fff; border-radius: 8px; padding: 8px; border: 1px solid #e2e8f0;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <strong style="font-size: 10px;">${name}</strong>
            <span style="font-size: 8px; padding: 1px 5px; background: #e0f2fe; border-radius: 8px;">${data.count} ${t('export.proj')}</span>
          </div>
          <div style="display: flex; gap: 6px; margin-bottom: 6px;">
            <div style="flex: 1; text-align: center; padding: 4px; background: #f8fafc; border-radius: 4px;">
              <div style="font-size: 12px; font-weight: 700; color: #059669;">${data.ist}</div>
              <div style="font-size: 7px; color: #64748b;">IST</div>
            </div>
            <div style="flex: 1; text-align: center; padding: 4px; background: #f8fafc; border-radius: 4px;">
              <div style="font-size: 12px; font-weight: 700; color: #4f46e5;">${data.soll}</div>
              <div style="font-size: 7px; color: #64748b;">SOLL</div>
            </div>
            <div style="flex: 1; text-align: center; padding: 4px; background: ${color}15; border-radius: 4px;">
              <div style="font-size: 12px; font-weight: 700; color: ${color};">${rate.toFixed(0)}%</div>
              <div style="font-size: 7px; color: #64748b;">${t('export.rate')}</div>
            </div>
          </div>
          <div style="height: 4px; background: #e2e8f0; border-radius: 2px; overflow: hidden;">
            <div style="height: 100%; width: ${Math.min(rate, 100)}%; background: ${color}; border-radius: 2px;"></div>
          </div>
        </div>`;
      });
      page4Html += `</div>`;
      
      // Test Performance bars
      const testColors = ['#0097AC', '#10B981', '#3B82F6', '#8B5CF6', '#F59E0B', '#EC4899'];
      const testPerfData = this.state.tests.map((test, idx) => {
        let tIst = 0, tSoll = 0;
        this.state.projects.filter(p => p.test_id === test.id).forEach(p => {
          for (let w = filterInfo2.weekFrom; w <= filterInfo2.weekTo; w++) {
            const weekKey = `KW${w.toString().padStart(2, '0')}`;
            const d = this.getWeekData(p, weekKey);
            tIst += d.ist || 0; tSoll += d.soll || 0;
          }
        });
        return { name: test.name, ist: tIst, soll: tSoll, color: testColors[idx % testColors.length] };
      });
      const maxTestIst = Math.max(1, ...testPerfData.map(d => d.ist));
      
      page4Html += `<h2 style="margin: 0 0 6px 0; font-size: 13px; color: #1e293b; border-bottom: 2px solid #0097AC; padding-bottom: 3px;">🔬 ${t('export.testPerformance')}</h2>`;
      page4Html += `<div style="margin-bottom: 14px;">`;
      testPerfData.forEach(d => {
        const rate = d.soll > 0 ? (d.ist / d.soll * 100) : 0;
        const width = (d.ist / maxTestIst) * 100;
        page4Html += `<div style="display: grid; grid-template-columns: 90px 1fr auto; align-items: center; gap: 8px; margin-bottom: 4px;">
          <div style="font-weight: 600; font-size: 9px;">${d.name.substring(0, 18)}</div>
          <div style="height: 16px; background: #f1f5f9; border-radius: 8px; overflow: hidden;">
            <div style="height: 100%; width: ${width}%; background: ${d.color}; border-radius: 8px; display: flex; align-items: center; justify-content: flex-end; padding-right: 4px; min-width: 28px;">
              <span style="font-size: 7px; font-weight: 700; color: white;">${rate.toFixed(0)}%</span>
            </div>
          </div>
          <div style="font-weight: 600; font-size: 9px; min-width: 50px; text-align: right;">${d.ist}/${d.soll}</div>
        </div>`;
      });
      page4Html += `</div>`;
      
      // Top & Bottom Performers
      const projectRates = projects.map(p => {
        const cust = this.state.customers.find(c => c.id === p.customer_id);
        const typ = this.state.types.find(t => t.id === p.type_id);
        let pIst = 0, pSoll = 0;
        for (let w = filterInfo2.weekFrom; w <= filterInfo2.weekTo; w++) {
          const weekKey = `KW${w.toString().padStart(2, '0')}`;
          const d = this.getWeekData(p, weekKey);
          pIst += d.ist || 0; pSoll += d.soll || 0;
        }
        return { name: `${cust?.name || '?'} / ${typ?.name || '?'}`, ist: pIst, soll: pSoll, rate: pSoll > 0 ? (pIst / pSoll * 100) : 0 };
      }).filter(r => r.soll > 0).sort((a, b) => b.rate - a.rate);
      
      page4Html += `<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px;">`;
      // Top 5
      page4Html += `<div><h2 style="margin: 0 0 6px 0; font-size: 13px; color: #10B981; border-bottom: 2px solid #10B981; padding-bottom: 3px;">⬆ ${t('export.topPerformers')}</h2>`;
      projectRates.slice(0, 5).forEach((p, i) => {
        page4Html += `<div style="display: flex; align-items: center; gap: 6px; padding: 5px; background: ${i % 2 === 0 ? '#f0fdf4' : '#fff'}; border-radius: 4px; margin-bottom: 3px; border-left: 2px solid #10B981;">
          <div style="width: 16px; height: 16px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 8px; font-weight: 700; background: rgba(16,185,129,0.1); color: #10B981;">${i + 1}</div>
          <div style="flex: 1; font-size: 9px; font-weight: 500; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;">${p.name}</div>
          <div style="font-weight: 700; font-size: 10px; color: #10B981;">${p.rate.toFixed(0)}%</div>
        </div>`;
      });
      page4Html += `</div>`;
      // Bottom 5
      page4Html += `<div><h2 style="margin: 0 0 6px 0; font-size: 13px; color: #EF4444; border-bottom: 2px solid #EF4444; padding-bottom: 3px;">⬇ ${t('export.bottomPerformers')}</h2>`;
      projectRates.slice(-5).reverse().forEach((p, i) => {
        page4Html += `<div style="display: flex; align-items: center; gap: 6px; padding: 5px; background: ${i % 2 === 0 ? '#fef2f2' : '#fff'}; border-radius: 4px; margin-bottom: 3px; border-left: 2px solid #EF4444;">
          <div style="width: 16px; height: 16px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 8px; font-weight: 700; background: rgba(239,68,68,0.1); color: #EF4444;">${i + 1}</div>
          <div style="flex: 1; font-size: 9px; font-weight: 500; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;">${p.name}</div>
          <div style="font-weight: 700; font-size: 10px; color: #EF4444;">${p.rate.toFixed(0)}%</div>
        </div>`;
      });
      page4Html += `</div></div>`;
      
      // AI Insights (simplified for PDF)
      const currentWeek = this.getCurrentWeek();
      let aiTotalIst = 0, aiTotalSoll = 0;
      projects.forEach(p => {
        for (let w = filterInfo2.weekFrom; w <= filterInfo2.weekTo; w++) {
          const weekKey = `KW${w.toString().padStart(2, '0')}`;
          const d = this.getWeekData(p, weekKey);
          aiTotalIst += d.ist || 0; aiTotalSoll += d.soll || 0;
        }
      });
      const overallRate = aiTotalSoll > 0 ? Math.round((aiTotalIst / aiTotalSoll) * 100) : 0;
      const aiBacklog = aiTotalSoll - aiTotalIst;
      const weeksLeft = 52 - currentWeek;
      const avgPerWeek = weeksLeft > 0 ? Math.ceil(aiBacklog / weeksLeft) : aiBacklog;
      
      page4Html += `<h2 style="margin: 0 0 6px 0; font-size: 13px; color: #1e293b; border-bottom: 2px solid #0097AC; padding-bottom: 3px;">🤖 ${t('export.aiInsights')}</h2>`;
      page4Html += `<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">`;
      
      const insightColor = overallRate >= 90 ? '#10B981' : overallRate >= 70 ? '#3B82F6' : overallRate >= 50 ? '#F59E0B' : '#EF4444';
      page4Html += `<div style="background: ${insightColor}10; border-left: 3px solid ${insightColor}; border-radius: 6px; padding: 8px;">
        <div style="font-size: 10px; font-weight: 600; color: ${insightColor};">${t('export.overallRealization')}: ${overallRate}%</div>
        <div style="font-size: 8px; color: #64748b; margin-top: 2px;">IST: ${aiTotalIst} / SOLL: ${aiTotalSoll}</div>
      </div>`;
      
      if (aiBacklog > 0) {
        page4Html += `<div style="background: #eff6ff; border-left: 3px solid #3B82F6; border-radius: 6px; padding: 8px;">
          <div style="font-size: 10px; font-weight: 600; color: #1e40af;">${t('export.backlogTests').replace('{0}', String(aiBacklog))}</div>
          <div style="font-size: 8px; color: #64748b; margin-top: 2px;">${t('export.requiredPerWeek').replace('{0}', String(avgPerWeek)).replace('{1}', String(weeksLeft))}</div>
        </div>`;
      }
      
      if (stoppage > 0) {
        page4Html += `<div style="background: #fef2f2; border-left: 3px solid #EF4444; border-radius: 6px; padding: 8px;">
          <div style="font-size: 10px; font-weight: 600; color: #991b1b;">${t('export.stoppageDetected').replace('{0}', String(stoppage))}</div>
          <div style="font-size: 8px; color: #64748b; margin-top: 2px;">${t('export.affectsGoals')}</div>
        </div>`;
      }
      
      // Best/worst customer insight
      const custRates = Object.entries(custAnalysis).filter(([_, d]) => d.soll > 0).map(([name, d]) => ({name, rate: (d.ist / d.soll * 100)})).sort((a, b) => b.rate - a.rate);
      if (custRates.length > 0) {
        const bestCust = custRates[0];
        page4Html += `<div style="background: #f0fdf4; border-left: 3px solid #10B981; border-radius: 6px; padding: 8px;">
          <div style="font-size: 10px; font-weight: 600; color: #166534;">${t('export.bestCustomer')}: ${bestCust.name}</div>
          <div style="font-size: 8px; color: #64748b; margin-top: 2px;">${t('export.realization')}: ${bestCust.rate.toFixed(0)}%</div>
        </div>`;
      }
      page4Html += `</div>`;
      
      const page4 = createPageSection(page4Html, true);
      
      this.showExportProgress(true, 55, t('export.addingProjects'));
      
      // PAGE 5+: Project list pages (all projects)
      const projectsPerPage = 35;
      const totalProjectPages = Math.ceil(projects.length / projectsPerPage);
      const projectPages: HTMLDivElement[] = [];
      
      for (let pageNum = 0; pageNum < totalProjectPages; pageNum++) {
        const startIdx = pageNum * projectsPerPage;
        const endIdx = Math.min(startIdx + projectsPerPage, projects.length);
        const pageProjects = projects.slice(startIdx, endIdx);
        
        let projectsHtml = `
          <h2 style="margin: 0 0 10px 0; font-size: 16px; color: #1e293b; border-bottom: 2px solid #0097AC; padding-bottom: 5px;">
            📋 ${t('export.projectList')} (${startIdx + 1}-${endIdx} / ${projects.length})
          </h2>
          <table style="width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.06); font-size: 11px;">
            <thead>
              <tr style="background: #1e293b; color: #fff;">
                <th style="padding: 6px 8px; text-align: left; font-weight: 600;">${t('export.customer')}</th>
                <th style="padding: 6px 8px; text-align: left; font-weight: 600;">${t('export.type')}</th>
                <th style="padding: 6px 8px; text-align: left; font-weight: 600;">${t('export.part')}</th>
                <th style="padding: 6px 8px; text-align: left; font-weight: 600;">${t('export.test')}</th>
                <th style="padding: 6px 8px; text-align: center; font-weight: 600;">IST</th>
                <th style="padding: 6px 8px; text-align: center; font-weight: 600;">SOLL</th>
                <th style="padding: 6px 8px; text-align: center; font-weight: 600;">%</th>
              </tr>
            </thead>
            <tbody>
        `;
        
        pageProjects.forEach((project, idx) => {
          const customer = this.state.customers.find(c => c.id === project.customer_id);
          const type = this.state.types.find(t => t.id === project.type_id);
          const part = this.state.parts.find(p => p.id === project.part_id);
          const test = this.state.tests.find(t => t.id === project.test_id);
          
          let istTotal = 0, sollTotal = 0;
          for (let w = filterInfo.weekFrom; w <= filterInfo.weekTo; w++) {
            const weekKey = `KW${w.toString().padStart(2, '0')}`;
            const wd = this.getWeekData(project, weekKey);
            istTotal += wd.ist || 0; sollTotal += wd.soll || 0;
          }
          const percent = sollTotal > 0 ? (istTotal / sollTotal * 100) : 0;
          
          projectsHtml += `
            <tr style="background: ${idx % 2 === 0 ? '#fff' : '#f1f5f9'};">
              <td style="padding: 5px 8px; color: #0f172a; font-weight: 600;">${customer?.name || '-'}</td>
              <td style="padding: 5px 8px; color: #334155;">${type?.name || '-'}</td>
              <td style="padding: 5px 8px; color: #334155;">${(part?.name || '-').substring(0, 22)}</td>
              <td style="padding: 5px 8px; color: #334155;">${(test?.name || '-').substring(0, 22)}</td>
              <td style="padding: 5px 8px; text-align: center; color: #059669; font-weight: 600;">${istTotal}</td>
              <td style="padding: 5px 8px; text-align: center; color: #4f46e5; font-weight: 600;">${sollTotal}</td>
              <td style="padding: 5px 8px; text-align: center;">
                <span style="padding: 3px 6px; border-radius: 6px; font-weight: 700; font-size: 11px;
                  background: ${percent >= 100 ? '#bbf7d0' : percent >= 50 ? '#fde68a' : '#fecaca'};
                  color: ${percent >= 100 ? '#14532d' : percent >= 50 ? '#78350f' : '#7f1d1d'};">
                  ${percent.toFixed(0)}%
                </span>
              </td>
            </tr>
          `;
        });
        
        projectsHtml += `</tbody></table>`;
        projectPages.push(createPageSection(projectsHtml, true));
      }
      
      this.showExportProgress(true, 70, t('export.convertingImage'));
      
      // Create temporary container
      const tempContainer = document.createElement('div');
      tempContainer.style.cssText = 'position: fixed; left: -9999px; top: 0; z-index: -9999;';
      document.body.appendChild(tempContainer);
      
      // Generate PDF
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfPageWidth = 210;
      const pdfPageHeight = 297;
      
      const allPages = [page1, page2, page3, page4, ...projectPages];
      
      for (let i = 0; i < allPages.length; i++) {
        this.showExportProgress(true, 70 + Math.round((i / allPages.length) * 25), t('export.creatingPdf'));
        
        tempContainer.innerHTML = '';
        tempContainer.appendChild(allPages[i]);
        
        await new Promise(resolve => setTimeout(resolve, 100));
        
        const canvas = await html2canvas(allPages[i], {
          scale: 3,
          useCORS: true,
          logging: false,
          backgroundColor: '#ffffff',
          width: 1000
        });
        
        const imgWidth = pdfPageWidth;
        const imgHeight = (canvas.height * imgWidth) / canvas.width;
        
        if (i > 0) pdf.addPage();
        
        // If content is taller than page, scale it down to fit
        if (imgHeight > pdfPageHeight) {
          const scale = pdfPageHeight / imgHeight;
          const scaledWidth = imgWidth * scale;
          const scaledHeight = imgHeight * scale;
          const xOffset = (pdfPageWidth - scaledWidth) / 2;
          pdf.addImage(canvas.toDataURL('image/png'), 'PNG', xOffset, 0, scaledWidth, scaledHeight);
        } else {
          pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, imgWidth, imgHeight);
        }
      }
      
      // Add page numbers
      const totalPages = pdf.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        pdf.setPage(i);
        pdf.setFontSize(8);
        pdf.setTextColor(150, 150, 150);
        pdf.text(`${i} / ${totalPages}`, pdfPageWidth - 15, pdfPageHeight - 5);
      }
      
      // Cleanup
      tempContainer.remove();
      
      this.showExportProgress(true, 95, t('export.savingFile'));
      
      // Save PDF
      const filename = `Kappaplannung_Analytics_${filterInfo.year}_KW${filterInfo.weekFrom.toString().padStart(2, '0')}-${filterInfo.weekTo.toString().padStart(2, '0')}_${new Date().toISOString().split('T')[0]}.pdf`;
      pdf.save(filename);
      
      this.showExportProgress(false);
      this.showToast(t('export.pdfGenerated'), 'success');
      
    } catch (error) {
      console.error('PDF export error:', error);
      this.showExportProgress(false);
      this.showToast(i18n.t('export.pdfError'), 'error');
    }
  }

  private async exportAnalyticsToExcel(): Promise<void> {
    try {
      const t = (key: string) => i18n.t(key);
      const lang = i18n.getLanguage();
      const dateLocale = lang === 'de' ? 'de-DE' : lang === 'pl' ? 'pl-PL' : lang === 'ro' ? 'ro-RO' : 'en-US';
      
      this.showExportProgress(true, 5, t('export.preparingData'));
      
      const filterInfo = this.getFilterInfo();
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Kappaplannung - DRÄXLMAIER Group';
      workbook.created = new Date();
      
      // Get analytics data
      const analyticsData = this.calculateAnalyticsData();
      const projects = this.getFilteredProjects();
      
      this.showExportProgress(true, 15, t('export.creatingMainSheet'));
      
      // Sheet name translations
      const sheetNames = {
        summary: lang === 'de' ? 'Zusammenfassung' : lang === 'pl' ? 'Podsumowanie' : lang === 'ro' ? 'Rezumat' : 'Summary',
        projects: lang === 'de' ? 'Projekte' : lang === 'pl' ? 'Projekty' : lang === 'ro' ? 'Proiecte' : 'Projects',
        customers: lang === 'de' ? 'Kunden' : lang === 'pl' ? 'Klienci' : lang === 'ro' ? 'Clienți' : 'Customers',
        weekly: lang === 'de' ? 'Wöchentlich' : lang === 'pl' ? 'Tygodniowe' : lang === 'ro' ? 'Săptămânal' : 'Weekly',
        chartData: lang === 'de' ? 'Diagrammdaten' : lang === 'pl' ? 'Dane wykresów' : lang === 'ro' ? 'Date grafice' : 'Chart Data'
      };
      
      // ==================== SHEET 1: Summary ====================
      const summarySheet = workbook.addWorksheet(`Kappa - ${sheetNames.summary}`, {
        views: [{ state: 'frozen', ySplit: 6 }]
      });
      
      // Header - DRÄXLMAIER Group branding
      summarySheet.mergeCells('A1:H1');
      const titleCell = summarySheet.getCell('A1');
      titleCell.value = 'DRÄXLMAIER Group';
      titleCell.font = { name: 'Arial', size: 20, bold: true, color: { argb: 'FFFFFFFF' } };
      titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF000000' } };
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
      summarySheet.getRow(1).height = 40;
      
      summarySheet.mergeCells('A2:H2');
      const subtitleCell = summarySheet.getCell('A2');
      subtitleCell.value = `Produkt Audit 360 - ${t('export.analyticsReport')}`;
      subtitleCell.font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
      subtitleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0097AC' } };
      subtitleCell.alignment = { horizontal: 'center', vertical: 'middle' };
      summarySheet.getRow(2).height = 30;
      
      // Filter info row
      summarySheet.mergeCells('A3:H3');
      const filterCell = summarySheet.getCell('A3');
      filterCell.value = `${t('export.dataRange')}: ${filterInfo.rangeText} | ${t('export.generatedAt')}: ${new Date().toLocaleDateString(dateLocale)} ${new Date().toLocaleTimeString(dateLocale)} | ${t('export.user')}: ${this.state.settings.userName || 'System'}`;
      filterCell.font = { name: 'Arial', size: 10, italic: true, color: { argb: 'FF666666' } };
      filterCell.alignment = { horizontal: 'center', vertical: 'middle' };
      summarySheet.getRow(3).height = 25;
      
      // KPI Section title
      summarySheet.mergeCells('A5:H5');
      const kpiTitleCell = summarySheet.getCell('A5');
      kpiTitleCell.value = `📊 ${t('export.kpiTitle')}`;
      kpiTitleCell.font = { name: 'Arial', size: 12, bold: true, color: { argb: 'FF333333' } };
      kpiTitleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      
      this.showExportProgress(true, 25, t('export.addingStats'));
      
      // KPI Data headers
      const kpiHeaders = [
        lang === 'de' ? 'Kennzahl' : lang === 'pl' ? 'Wskaźnik' : lang === 'ro' ? 'Indicator' : 'Indicator',
        lang === 'de' ? 'Wert' : lang === 'pl' ? 'Wartość' : lang === 'ro' ? 'Valoare' : 'Value',
        lang === 'de' ? 'Beschreibung' : lang === 'pl' ? 'Opis' : lang === 'ro' ? 'Descriere' : 'Description'
      ];
      const kpiHeaderRow = summarySheet.getRow(7);
      kpiHeaders.forEach((h, i) => {
        const cell = kpiHeaderRow.getCell(i + 1);
        cell.value = h;
        cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      });
      
      summarySheet.getColumn(1).width = 35;
      summarySheet.getColumn(2).width = 20;
      summarySheet.getColumn(3).width = 50;
      
      // KPI descriptions in current language
      const kpiDescriptions = {
        totalProjects: lang === 'de' ? 'Gesamtzahl aktiver Projekte' : lang === 'pl' ? 'Łączna liczba aktywnych projektów' : lang === 'ro' ? 'Numărul total de proiecte active' : 'Total number of active projects',
        totalIst: lang === 'de' ? 'Abgeschlossene Tests im Zeitraum' : lang === 'pl' ? 'Zrealizowane testy w okresie' : lang === 'ro' ? 'Teste completate în perioadă' : 'Completed tests in period',
        totalSoll: lang === 'de' ? 'Geplante Tests im Zeitraum' : lang === 'pl' ? 'Planowane testy w okresie' : lang === 'ro' ? 'Teste planificate în perioadă' : 'Planned tests in period',
        realization: lang === 'de' ? 'Realisierungsgrad' : lang === 'pl' ? 'Stopień realizacji' : lang === 'ro' ? 'Grad de realizare' : 'Realization rate',
        activeCustomers: lang === 'de' ? 'Kunden mit aktiven Projekten' : lang === 'pl' ? 'Klienci z aktywnymi projektami' : lang === 'ro' ? 'Clienți cu proiecte active' : 'Customers with active projects',
        avgPerProject: lang === 'de' ? 'Durchschnittliche Tests pro Projekt' : lang === 'pl' ? 'Średnia testów na projekt' : lang === 'ro' ? 'Media testelor pe proiect' : 'Average tests per project'
      };
      
      const kpiData = [
        [t('export.projects'), analyticsData.totalProjects, kpiDescriptions.totalProjects],
        [t('export.testsIst'), analyticsData.totalIst.toLocaleString(dateLocale), kpiDescriptions.totalIst],
        [t('export.testsSoll'), analyticsData.totalSoll.toLocaleString(dateLocale), kpiDescriptions.totalSoll],
        [`${t('export.realization')} (%)`, `${analyticsData.totalPercent.toFixed(1)}%`, kpiDescriptions.realization],
        [t('export.activeCustomers'), analyticsData.customerStats.length, kpiDescriptions.activeCustomers],
        [t('export.avgPerProject'), Math.round(analyticsData.totalIst / Math.max(analyticsData.totalProjects, 1)), kpiDescriptions.avgPerProject]
      ];
      
      kpiData.forEach((row, idx) => {
        const dataRow = summarySheet.getRow(8 + idx);
        row.forEach((val, colIdx) => {
          const cell = dataRow.getCell(colIdx + 1);
          cell.value = val;
          cell.font = { name: 'Arial', size: 10 };
          cell.alignment = { horizontal: colIdx === 1 ? 'center' : 'left', vertical: 'middle' };
          if (idx % 2 === 0) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
          }
          if (colIdx === 1) {
            cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FF0097AC' } };
          }
        });
      });
      
      this.showExportProgress(true, 35, t('export.creatingProjectsSheet'));
      
      // ==================== SHEET 2: Projects Details ====================
      const projectsSheet = workbook.addWorksheet(`${sheetNames.projects}`);
      
      projectsSheet.mergeCells('A1:G1');
      const projTitle = projectsSheet.getCell('A1');
      projTitle.value = `${t('export.projectList')} - ${t('export.projectDetails')}`;
      projTitle.font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
      projTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0097AC' } };
      projTitle.alignment = { horizontal: 'center', vertical: 'middle' };
      projectsSheet.getRow(1).height = 35;
      
      const projHeaders = [t('export.customer'), t('export.type'), t('export.part'), t('export.test'), 'IST', 'SOLL', `${t('export.realization')} (%)`];
      const projHeaderRow = projectsSheet.getRow(3);
      projHeaders.forEach((h, i) => {
        const cell = projHeaderRow.getCell(i + 1);
        cell.value = h;
        cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      });
      
      [20, 15, 20, 20, 12, 12, 15].forEach((w, i) => {
        projectsSheet.getColumn(i + 1).width = w;
      });
      
      let rowIdx = 4;
      projects.forEach(project => {
        const customer = this.state.customers.find(c => c.id === project.customer_id);
        const type = this.state.types.find(t => t.id === project.type_id);
        const part = this.state.parts.find(p => p.id === project.part_id);
        const test = this.state.tests.find(t => t.id === project.test_id);
        
        let istTotal = 0, sollTotal = 0;
        for (let week = filterInfo.weekFrom; week <= filterInfo.weekTo; week++) {
          const weekKey = `KW${week.toString().padStart(2, '0')}`;
          const wd = this.getWeekData(project, weekKey);
          istTotal += wd.ist || 0; sollTotal += wd.soll || 0;
        }
        const percent = sollTotal > 0 ? (istTotal / sollTotal * 100) : 0;
        
        const row = projectsSheet.getRow(rowIdx);
        [customer?.name || '-', type?.name || '-', part?.name || '-', test?.name || '-', istTotal, sollTotal, `${percent.toFixed(1)}%`].forEach((val, colIdx) => {
          const cell = row.getCell(colIdx + 1);
          cell.value = val;
          cell.font = { name: 'Arial', size: 10 };
          cell.alignment = { horizontal: colIdx >= 4 ? 'center' : 'left', vertical: 'middle' };
          
          if (colIdx === 6) {
            if (percent >= 100) {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4ADE80' } };
              cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF166534' } };
            } else if (percent >= 50) {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFBBF24' } };
              cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF92400E' } };
            } else {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF87171' } };
              cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF991B1B' } };
            }
          }
          if (rowIdx % 2 === 0 && colIdx < 6) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
          }
        });
        rowIdx++;
      });
      
      this.showExportProgress(true, 50, t('export.creatingCustomersSheet'));
      
      // ==================== SHEET 3: Customers Statistics ====================
      const customersSheet = workbook.addWorksheet(`${sheetNames.customers}`);
      
      customersSheet.mergeCells('A1:E1');
      const custTitle = customersSheet.getCell('A1');
      custTitle.value = t('export.customerStats');
      custTitle.font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
      custTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0097AC' } };
      custTitle.alignment = { horizontal: 'center', vertical: 'middle' };
      customersSheet.getRow(1).height = 35;
      
      const custHeaders = [t('export.customer'), t('export.count'), t('export.testsIst'), t('export.testsSoll'), `${t('export.realization')} (%)`];
      const custHeaderRow = customersSheet.getRow(3);
      custHeaders.forEach((h, i) => {
        const cell = custHeaderRow.getCell(i + 1);
        cell.value = h;
        cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      });
      
      [25, 18, 15, 15, 15].forEach((w, i) => {
        customersSheet.getColumn(i + 1).width = w;
      });
      
      rowIdx = 4;
      analyticsData.customerStats.forEach((cs: any) => {
        const row = customersSheet.getRow(rowIdx);
        [cs.name, cs.count, cs.ist, cs.soll, `${cs.percent.toFixed(1)}%`].forEach((val, colIdx) => {
          const cell = row.getCell(colIdx + 1);
          cell.value = val;
          cell.font = { name: 'Arial', size: 10 };
          cell.alignment = { horizontal: colIdx > 0 ? 'center' : 'left', vertical: 'middle' };
          
          if (colIdx === 4) {
            if (cs.percent >= 100) {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4ADE80' } };
              cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF166534' } };
            } else if (cs.percent >= 50) {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFBBF24' } };
              cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF92400E' } };
            } else {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF87171' } };
              cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF991B1B' } };
            }
          }
          if (rowIdx % 2 === 0 && colIdx < 4) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
          }
        });
        rowIdx++;
      });
      
      this.showExportProgress(true, 65, t('export.creatingWeeklySheet'));
      
      // ==================== SHEET 4: Weekly Data ====================
      const weeklySheet = workbook.addWorksheet(`${sheetNames.weekly}`);
      
      weeklySheet.mergeCells('A1:D1');
      const weeklyTitle = weeklySheet.getCell('A1');
      weeklyTitle.value = `${t('export.weeklyData')} - ${t('analytics.historicalTrend')}`;
      weeklyTitle.font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
      weeklyTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0097AC' } };
      weeklyTitle.alignment = { horizontal: 'center', vertical: 'middle' };
      weeklySheet.getRow(1).height = 35;
      
      const weeklyHeaders = [t('export.week'), 'IST', 'SOLL', `${t('export.realization')} (%)`];
      const weeklyHeaderRow = weeklySheet.getRow(3);
      weeklyHeaders.forEach((h, i) => {
        const cell = weeklyHeaderRow.getCell(i + 1);
        cell.value = h;
        cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      });
      
      [15, 15, 15, 18].forEach((w, i) => {
        weeklySheet.getColumn(i + 1).width = w;
      });
      
      rowIdx = 4;
      for (let week = filterInfo.weekFrom; week <= filterInfo.weekTo; week++) {
        const weekKey = `KW${week.toString().padStart(2, '0')}`;
        let weekIst = 0, weekSoll = 0;
        
        projects.forEach(p => {
          const wd = p.weeks?.[week.toString()];
          if (wd) { weekIst += wd.ist || 0; weekSoll += wd.soll || 0; }
        });
        const percent = weekSoll > 0 ? (weekIst / weekSoll * 100) : 0;
        
        const row = weeklySheet.getRow(rowIdx);
        [weekKey, weekIst, weekSoll, `${percent.toFixed(1)}%`].forEach((val, colIdx) => {
          const cell = row.getCell(colIdx + 1);
          cell.value = val;
          cell.font = { name: 'Arial', size: 10 };
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
          
          if (colIdx === 3) {
            if (percent >= 100) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4ADE80' } };
            else if (percent >= 50) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFBBF24' } };
            else cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF87171' } };
          }
          if (rowIdx % 2 === 0 && colIdx < 3) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
          }
        });
        rowIdx++;
      }
      
      this.showExportProgress(true, 80, t('export.finalizingExcel'));
      
      // ==================== SHEET 5: Charts Data (numerical only) ====================
      const chartsSheet = workbook.addWorksheet(`${sheetNames.chartData}`);
      
      chartsSheet.mergeCells('A1:D1');
      const chartsTitle = chartsSheet.getCell('A1');
      chartsTitle.value = t('export.charts');
      chartsTitle.font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
      chartsTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0097AC' } };
      chartsTitle.alignment = { horizontal: 'center', vertical: 'middle' };
      chartsSheet.getRow(1).height = 35;
      
      chartsSheet.mergeCells('A3:G3');
      const chartInfo = lang === 'de' ? 'Unten finden Sie Daten zum Erstellen von Diagrammen. Wählen Sie Daten aus und klicken Sie auf "Diagramm einfügen" in Excel.' 
                      : lang === 'pl' ? 'Poniżej znajdują się dane do tworzenia wykresów. Zaznacz dane i wybierz "Wstaw wykres" w Excel.'
                      : lang === 'ro' ? 'Mai jos găsiți date pentru a crea grafice. Selectați datele și alegeți "Inserare grafic" în Excel.'
                      : 'Below you will find data to create charts. Select data and choose "Insert Chart" in Excel.';
      chartsSheet.getCell('A3').value = `ℹ️ ${chartInfo}`;
      chartsSheet.getCell('A3').font = { name: 'Arial', size: 10, italic: true, color: { argb: 'FF666666' } };
      
      // Customer bar chart data
      chartsSheet.getCell('A5').value = `📊 ${t('export.chartCustomerComparison')}`;
      chartsSheet.getCell('A5').font = { name: 'Arial', size: 11, bold: true };
      
      chartsSheet.getCell('A6').value = t('export.customer');
      chartsSheet.getCell('B6').value = 'IST';
      chartsSheet.getCell('C6').value = 'SOLL';
      chartsSheet.getCell('D6').value = `${t('export.realization')} %`;
      [chartsSheet.getCell('A6'), chartsSheet.getCell('B6'), chartsSheet.getCell('C6'), chartsSheet.getCell('D6')].forEach(cell => {
        cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
        cell.alignment = { horizontal: 'center' };
      });
      
      chartsSheet.getColumn(1).width = 25;
      chartsSheet.getColumn(2).width = 15;
      chartsSheet.getColumn(3).width = 15;
      chartsSheet.getColumn(4).width = 15;
      
      rowIdx = 7;
      analyticsData.customerStats.forEach((cs: any) => {
        chartsSheet.getCell(`A${rowIdx}`).value = cs.name;
        chartsSheet.getCell(`B${rowIdx}`).value = cs.ist;
        chartsSheet.getCell(`C${rowIdx}`).value = cs.soll;
        chartsSheet.getCell(`D${rowIdx}`).value = cs.percent;
        const percentCell = chartsSheet.getCell(`D${rowIdx}`);
        if (cs.percent >= 100) percentCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } };
        else if (cs.percent >= 50) percentCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
        else percentCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
        rowIdx++;
      });
      
      // Weekly trend data
      rowIdx += 2;
      chartsSheet.getCell(`A${rowIdx}`).value = `📈 ${t('export.chartTrend')}`;
      chartsSheet.getCell(`A${rowIdx}`).font = { name: 'Arial', size: 11, bold: true };
      rowIdx++;
      
      chartsSheet.getCell(`A${rowIdx}`).value = t('export.week');
      chartsSheet.getCell(`B${rowIdx}`).value = 'IST';
      chartsSheet.getCell(`C${rowIdx}`).value = 'SOLL';
      chartsSheet.getCell(`D${rowIdx}`).value = '%';
      [chartsSheet.getCell(`A${rowIdx}`), chartsSheet.getCell(`B${rowIdx}`), chartsSheet.getCell(`C${rowIdx}`), chartsSheet.getCell(`D${rowIdx}`)].forEach(cell => {
        cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
        cell.alignment = { horizontal: 'center' };
      });
      rowIdx++;
      
      for (let week = filterInfo.weekFrom; week <= filterInfo.weekTo; week++) {
        let weekIst = 0, weekSoll = 0;
        projects.forEach(p => {
          const wd = p.weeks?.[week.toString()];
          if (wd) { weekIst += wd.ist || 0; weekSoll += wd.soll || 0; }
        });
        const percent = weekSoll > 0 ? (weekIst / weekSoll * 100) : 0;
        
        chartsSheet.getCell(`A${rowIdx}`).value = `KW${week.toString().padStart(2, '0')}`;
        chartsSheet.getCell(`B${rowIdx}`).value = weekIst;
        chartsSheet.getCell(`C${rowIdx}`).value = weekSoll;
        chartsSheet.getCell(`D${rowIdx}`).value = Math.round(percent);
        rowIdx++;
      }
      
      // Status distribution data
      rowIdx += 2;
      chartsSheet.getCell(`A${rowIdx}`).value = `🥧 ${t('export.statusDistribution')}`;
      chartsSheet.getCell(`A${rowIdx}`).font = { name: 'Arial', size: 11, bold: true };
      rowIdx++;
      
      chartsSheet.getCell(`A${rowIdx}`).value = 'Status';
      chartsSheet.getCell(`B${rowIdx}`).value = t('export.count');
      [chartsSheet.getCell(`A${rowIdx}`), chartsSheet.getCell(`B${rowIdx}`)].forEach(cell => {
        cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
        cell.alignment = { horizontal: 'center' };
      });
      rowIdx++;
      
      let completed = 0, inProgress = 0, behind = 0;
      projects.forEach(p => {
        let pIst = 0, pSoll = 0;
        for (let w = filterInfo.weekFrom; w <= filterInfo.weekTo; w++) {
          const wd = p.weeks?.[w.toString()];
          if (wd) { pIst += wd.ist || 0; pSoll += wd.soll || 0; }
        }
        const pct = pSoll > 0 ? (pIst / pSoll * 100) : 0;
        if (pct >= 100) completed++;
        else if (pct >= 50) inProgress++;
        else behind++;
      });
      
      chartsSheet.getCell(`A${rowIdx}`).value = `✅ ${t('export.completedProjects')}`;
      chartsSheet.getCell(`B${rowIdx}`).value = completed;
      chartsSheet.getCell(`A${rowIdx}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } };
      rowIdx++;
      
      chartsSheet.getCell(`A${rowIdx}`).value = `🟡 ${t('export.inProgressProjects')}`;
      chartsSheet.getCell(`B${rowIdx}`).value = inProgress;
      chartsSheet.getCell(`A${rowIdx}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
      rowIdx++;
      
      chartsSheet.getCell(`A${rowIdx}`).value = `🔴 ${t('export.delayedProjects')}`;
      chartsSheet.getCell(`B${rowIdx}`).value = behind;
      chartsSheet.getCell(`A${rowIdx}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
      
      this.showExportProgress(true, 95, t('export.savingFile'));
      
      // Generate and download file
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const filename = `Kappaplannung_Analytics_${filterInfo.year}_KW${filterInfo.weekFrom.toString().padStart(2, '0')}-${filterInfo.weekTo.toString().padStart(2, '0')}_${new Date().toISOString().split('T')[0]}.xlsx`;
      saveAs(blob, filename);
      
      this.showExportProgress(false);
      this.showToast(t('export.excelGenerated'), 'success');
      
    } catch (error) {
      console.error('Excel export error:', error);
      this.showExportProgress(false);
      this.showToast(i18n.t('export.excelError'), 'error');
    }
  }

  private calculateAnalyticsData(): {
    totalProjects: number;
    totalIst: number;
    totalSoll: number;
    totalPercent: number;
    customerStats: Array<{ name: string; count: number; ist: number; soll: number; percent: number }>;
  } {
    const filterInfo = this.getFilterInfo();
    const projects = this.getFilteredProjects();
    
    let totalIst = 0;
    let totalSoll = 0;
    const customerMap = new Map<string, { name: string; count: number; ist: number; soll: number }>();
    
    projects.forEach(project => {
      const customer = this.state.customers.find(c => c.id === project.customer_id);
      const customerName = customer?.name || 'Unknown';
      
      if (!customerMap.has(project.customer_id)) {
        customerMap.set(project.customer_id, { name: customerName, count: 0, ist: 0, soll: 0 });
      }
      
      const cs = customerMap.get(project.customer_id)!;
      cs.count++;
      
      // Use getWeekData for year-aware lookup
      for (let week = filterInfo.weekFrom; week <= filterInfo.weekTo; week++) {
        const weekKey = `KW${week.toString().padStart(2, '0')}`;
        const wd = this.getWeekData(project, weekKey);
        totalIst += wd.ist || 0;
        totalSoll += wd.soll || 0;
        cs.ist += wd.ist || 0;
        cs.soll += wd.soll || 0;
      }
    });
    
    const customerStats = Array.from(customerMap.values()).map(cs => ({
      ...cs,
      percent: cs.soll > 0 ? (cs.ist / cs.soll * 100) : 0
    })).sort((a, b) => b.ist - a.ist);
    
    return {
      totalProjects: projects.length,
      totalIst,
      totalSoll,
      totalPercent: totalSoll > 0 ? (totalIst / totalSoll * 100) : 0,
      customerStats
    };
  }

  private importData(): void {
    // Redirect to settings view for import
    this.switchView('settings');
    this.showToast(i18n.t('settings.selectFileToImport'), 'warning');
  }

  // ==================== Backup & Import System ====================
  
  private pendingModuleImport: string = '';

  private async checkAutoBackup(): Promise<void> {
    const freq = this.state.settings.backupFrequency;
    if (freq === 'none') return;

    const lastBackup = this.state.settings.lastBackupDate;
    const now = new Date();
    let shouldBackup = false;

    if (!lastBackup) {
      shouldBackup = true;
    } else {
      const lastDate = new Date(lastBackup);
      const diffMs = now.getTime() - lastDate.getTime();
      const diffHours = diffMs / (1000 * 60 * 60);
      const diffDays = diffHours / 24;

      switch (freq) {
        case 'session':
          // Check if a different session (more than 30 min since last backup)
          shouldBackup = diffHours > 0.5;
          break;
        case 'daily':
          shouldBackup = diffDays >= 1;
          break;
        case 'weekly':
          shouldBackup = diffDays >= 7;
          break;
      }
    }

    if (shouldBackup) {
      try {
        const backupPath = this.state.settings.backupPath || undefined;
        const result = await db.createBackup(backupPath);
        if (result.success) {
          this.state.settings.lastBackupDate = new Date().toISOString();
          await this.saveSettings();
          console.log('✅ Auto-backup created:', result.filename);
        }
      } catch (error) {
        console.error('Auto-backup failed:', error);
      }
    }
  }

  private async createManualBackup(): Promise<void> {
    try {
      const backupPath = this.state.settings.backupPath || undefined;
      const result = await db.createBackup(backupPath);
      if (result.success) {
        this.state.settings.lastBackupDate = new Date().toISOString();
        await this.saveSettings();
        this.renderSettingsView();
        this.showToast(`${i18n.t('settings.backupCreated')} (${this.formatFileSize(result.size)})`, 'success');
      }
    } catch (error) {
      console.error('Backup error:', error);
      this.showToast(i18n.t('settings.backupFailed'), 'error');
    }
  }

  private async loadBackupList(): Promise<void> {
    const container = document.getElementById('backupListContainer');
    if (!container) return;

    try {
      const backupPath = this.state.settings.backupPath || undefined;
      const result = await db.getBackups(backupPath);
      
      if (!result.backups || result.backups.length === 0) {
        container.innerHTML = `<p class="setting-hint">${i18n.t('settings.noBackups')}</p>`;
        return;
      }

      container.innerHTML = result.backups.slice(0, 10).map((b: any) => {
        const date = new Date(b.created);
        const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
        const size = this.formatFileSize(b.size);
        return `
          <div class="backup-item">
            <div class="backup-info">
              <span class="backup-filename">${b.filename}</span>
              <span class="backup-meta">${dateStr} • ${size}</span>
            </div>
            <div class="backup-actions">
              <button class="btn-small btn-restore" data-filename="${b.filename}" title="${i18n.t('settings.restoreBackup')}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                  <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
                </svg>
              </button>
            </div>
          </div>
        `;
      }).join('');

      // Attach restore handlers
      container.querySelectorAll('.btn-restore').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const filename = (e.currentTarget as HTMLElement).dataset.filename!;
          if (confirm(i18n.t('settings.confirmRestore'))) {
            await this.restoreFromBackup(filename);
          }
        });
      });

    } catch (error) {
      console.error('Error loading backups:', error);
      container.innerHTML = `<p class="setting-hint" style="color:var(--color-danger);">Error loading backups</p>`;
    }
  }

  private async restoreFromBackup(filename: string): Promise<void> {
    try {
      const backupPath = this.state.settings.backupPath || undefined;
      const result = await db.restoreBackup(filename, backupPath);
      if (result.success && result.data) {
        // Import the data
        await db.importData(JSON.stringify(result.data));
        await this.loadData();
        this.renderCurrentView();
        this.showToast(i18n.t('settings.backupRestored'), 'success');
      }
    } catch (error) {
      console.error('Restore error:', error);
      this.showToast(i18n.t('settings.backupFailed'), 'error');
    }
  }

  private importFullBackup(): void {
    const fileInput = document.getElementById('settingsImportFileInput') as HTMLInputElement;
    if (fileInput) fileInput.click();
  }

  private async handleFullImportFile(file: File): Promise<void> {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      
      // Validate it looks like a backup
      if (!data.customers && !data.projects && !data.employees && !data.settings) {
        this.showToast(i18n.t('settings.invalidFileFormat'), 'error');
        return;
      }

      if (!confirm(i18n.t('settings.confirmRestore'))) return;

      await db.importData(JSON.stringify(data));
      await this.loadData();
      
      // If settings were imported, apply them
      if (data.settings) {
        this.state.settings = { ...this.state.settings, ...data.settings };
        await this.saveSettings();
        this.applyTheme();
      }

      this.renderCurrentView();
      this.showToast(i18n.t('settings.importSuccess'), 'success');
    } catch (error) {
      console.error('Import error:', error);
      this.showToast(i18n.t('settings.invalidFileFormat'), 'error');
    }
  }

  private importModuleFromFile(moduleName: string): void {
    this.pendingModuleImport = moduleName;
    const fileInput = document.getElementById('settingsModuleImportFileInput') as HTMLInputElement;
    if (fileInput) fileInput.click();
  }

  private async handleModuleImportFile(file: File): Promise<void> {
    const moduleName = this.pendingModuleImport;
    if (!moduleName) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      // Can accept a full backup or a module-specific export
      // If it's a full backup, extract only the relevant module data
      let moduleData = data;
      
      if (data.version && !data.module) {
        // Full backup - extract module-specific data
        switch (moduleName) {
          case 'planning':
            moduleData = { customers: data.customers, types: data.types, parts: data.parts, tests: data.tests, projects: data.projects, comments: data.comments };
            break;
          case 'employees':
            moduleData = { employees: data.employees, employeeDetails: data.employeeDetails, qualifications: data.qualifications };
            break;
          case 'schedule':
            moduleData = { scheduleAssignments: data.scheduleAssignments, templates: data.templates };
            break;
          case 'absences':
            moduleData = { absenceTypes: data.absenceTypes, absences: data.absences, absenceLimits: data.absenceLimits, holidays: data.holidays };
            break;
          // Individual table modules - extract from full backup
          case 'customers':
            moduleData = { customers: data.customers };
            break;
          case 'types':
            moduleData = { types: data.types };
            break;
          case 'parts':
            moduleData = { parts: data.parts };
            break;
          case 'tests':
            moduleData = { tests: data.tests };
            break;
          case 'projects':
            moduleData = { projects: data.projects, comments: data.comments };
            break;
        }
      }

      const moduleLabels: Record<string, string> = {
        planning: i18n.t('settings.modulePlanning'),
        employees: i18n.t('settings.moduleEmployees'),
        schedule: i18n.t('settings.moduleSchedule'),
        absences: i18n.t('settings.moduleAbsences'),
        customers: i18n.t('settings.moduleCustomers'),
        types: i18n.t('settings.moduleTypes'),
        parts: i18n.t('settings.moduleParts'),
        tests: i18n.t('settings.moduleTests'),
        projects: i18n.t('settings.moduleProjects'),
      };

      if (!confirm(`${i18n.t('settings.confirmRestore')}\n\nModule: ${moduleLabels[moduleName] || moduleName}`)) return;

      await db.importModule(moduleName, moduleData);
      await this.loadData();
      this.renderCurrentView();
      this.showToast(`${i18n.t('settings.importModuleSuccess')}: ${moduleLabels[moduleName] || moduleName}`, 'success');
    } catch (error) {
      console.error('Module import error:', error);
      this.showToast(i18n.t('settings.invalidFileFormat'), 'error');
    }
  }

  private async exportFullDatabase(): Promise<void> {
    try {
      const jsonData = await db.exportData();
      const blob = new Blob([jsonData], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
      a.href = url;
      a.download = `kappa-export-${timestamp}.json`;
      a.click();
      URL.revokeObjectURL(url);
      this.showToast(i18n.t('messages.exportSuccessfully'), 'success');
    } catch (error) {
      console.error('Export error:', error);
      this.showToast(i18n.t('common.error'), 'error');
    }
  }

  private async exportModuleToFile(moduleName: string): Promise<void> {
    try {
      const moduleLabels: Record<string, string> = {
        planning: i18n.t('settings.modulePlanning'),
        employees: i18n.t('settings.moduleEmployees'),
        schedule: i18n.t('settings.moduleSchedule'),
        absences: i18n.t('settings.moduleAbsences'),
        customers: i18n.t('settings.moduleCustomers'),
        types: i18n.t('settings.moduleTypes'),
        parts: i18n.t('settings.moduleParts'),
        tests: i18n.t('settings.moduleTests'),
        projects: i18n.t('settings.moduleProjects'),
      };

      const data = await db.exportModule(moduleName);
      const jsonData = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonData], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
      a.href = url;
      a.download = `kappa-${moduleName}-${timestamp}.json`;
      a.click();
      URL.revokeObjectURL(url);
      this.showToast(`${i18n.t('settings.exportModuleSuccess')}: ${moduleLabels[moduleName] || moduleName}`, 'success');
    } catch (error) {
      console.error('Module export error:', error);
      this.showToast(i18n.t('common.error'), 'error');
    }
  }

  private formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  private async downloadDatabaseFile(): Promise<void> {
    try {
      const blob = await db.downloadDatabase();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
      a.href = url;
      a.download = `kappa-database-${timestamp}.db`;
      a.click();
      URL.revokeObjectURL(url);
      this.showToast(i18n.t('settings.downloadDbSuccess'), 'success');
    } catch (error) {
      console.error('Download DB error:', error);
      this.showToast(i18n.t('common.error'), 'error');
    }
  }

  private async uploadDatabaseFile(file: File): Promise<void> {
    try {
      // Validate file extension
      if (!file.name.match(/\.(db|sqlite|sqlite3)$/i)) {
        this.showToast(i18n.t('settings.invalidDbFile'), 'error');
        return;
      }

      if (!confirm(i18n.t('settings.uploadDbConfirm'))) return;

      // Read file as ArrayBuffer then convert to base64
      const arrayBuffer = await file.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < uint8Array.length; i++) {
        binary += String.fromCharCode(uint8Array[i]);
      }
      const base64Data = btoa(binary);

      await db.uploadDatabase(base64Data);
      
      // Reload everything from the new database
      await this.loadData();
      this.renderCurrentView();
      this.showToast(i18n.t('settings.uploadDbSuccess'), 'success');
    } catch (error) {
      console.error('Upload DB error:', error);
      this.showToast(i18n.t('settings.invalidDbFile'), 'error');
    }
  }

  // ==================== Smart Import Wizard ====================
  private importWizardState: {
    currentStep: number;
    workbook: ExcelJS.Workbook | null;
    selectedSheet: string;
    columns: string[];
    rows: any[][];
    columnMapping: Record<string, string>;
    parsedData: any[];
  } = {
    currentStep: 1,
    workbook: null,
    selectedSheet: '',
    columns: [],
    rows: [],
    columnMapping: {},
    parsedData: []
  };

  private showImportWizard(): void {
    const modal = document.getElementById('importWizardModal');
    if (!modal) return;
    
    // Reset state
    this.importWizardState = {
      currentStep: 1,
      workbook: null,
      selectedSheet: '',
      columns: [],
      rows: [],
      columnMapping: {},
      parsedData: []
    };
    
    this.updateWizardStep(1);
    modal.classList.add('active');
    
    // Setup event listeners
    this.setupImportWizardListeners();
  }

  private setupImportWizardListeners(): void {
    const uploadZone = document.getElementById('uploadZone');
    const fileInput = document.getElementById('importFileInput') as HTMLInputElement;
    const closeBtn = document.getElementById('closeImportWizard');
    const prevBtn = document.getElementById('wizardPrevBtn');
    const nextBtn = document.getElementById('wizardNextBtn');
    const importBtn = document.getElementById('wizardImportBtn');
    const sheetSelect = document.getElementById('sheetSelect') as HTMLSelectElement;

    // Close
    closeBtn?.addEventListener('click', () => this.closeImportWizard());

    // Upload zone
    uploadZone?.addEventListener('click', () => fileInput?.click());
    uploadZone?.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadZone.classList.add('drag-over');
    });
    uploadZone?.addEventListener('dragleave', () => {
      uploadZone.classList.remove('drag-over');
    });
    uploadZone?.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadZone.classList.remove('drag-over');
      const files = e.dataTransfer?.files;
      if (files?.[0]) this.handleImportFile(files[0]);
    });

    fileInput?.addEventListener('change', (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) this.handleImportFile(file);
    });

    // Navigation
    prevBtn?.addEventListener('click', () => {
      if (this.importWizardState.currentStep > 1) {
        this.updateWizardStep(this.importWizardState.currentStep - 1);
      }
    });

    nextBtn?.addEventListener('click', () => {
      if (this.importWizardState.currentStep < 3) {
        this.updateWizardStep(this.importWizardState.currentStep + 1);
      }
    });

    importBtn?.addEventListener('click', () => this.executeImport());

    // Sheet selection
    sheetSelect?.addEventListener('change', () => {
      this.importWizardState.selectedSheet = sheetSelect.value;
      this.parseSelectedSheet();
      this.renderColumnMapping();
    });
  }

  private closeImportWizard(): void {
    document.getElementById('importWizardModal')?.classList.remove('active');
  }

  private updateWizardStep(step: number): void {
    this.importWizardState.currentStep = step;
    
    // Update step indicators
    document.querySelectorAll('.wizard-step').forEach((el, idx) => {
      el.classList.remove('active', 'completed');
      if (idx + 1 < step) el.classList.add('completed');
      if (idx + 1 === step) el.classList.add('active');
    });

    // Update panels
    document.querySelectorAll('.wizard-panel').forEach((el, idx) => {
      el.classList.toggle('active', idx + 1 === step);
    });

    // Update buttons
    const prevBtn = document.getElementById('wizardPrevBtn') as HTMLButtonElement;
    const nextBtn = document.getElementById('wizardNextBtn') as HTMLButtonElement;
    const importBtn = document.getElementById('wizardImportBtn') as HTMLButtonElement;

    prevBtn.disabled = step === 1;
    nextBtn.style.display = step < 3 ? 'flex' : 'none';
    importBtn.style.display = step === 3 ? 'flex' : 'none';

    // Enable/disable next based on state
    if (step === 1) {
      nextBtn.disabled = !this.importWizardState.workbook;
    } else if (step === 2) {
      nextBtn.disabled = this.importWizardState.columns.length === 0;
      this.renderColumnMapping();
    } else if (step === 3) {
      this.renderPreview();
    }
  }

  private async handleImportFile(file: File): Promise<void> {
    try {
      const workbook = new ExcelJS.Workbook();
      const buffer = await file.arrayBuffer();
      await workbook.xlsx.load(buffer);
      
      this.importWizardState.workbook = workbook;
      
      // Populate sheet selector
      const sheetSelect = document.getElementById('sheetSelect') as HTMLSelectElement;
      sheetSelect.innerHTML = '';
      workbook.worksheets.forEach(sheet => {
        const option = document.createElement('option');
        option.value = sheet.name;
        option.textContent = sheet.name;
        sheetSelect.appendChild(option);
      });
      
      // Select first sheet
      if (workbook.worksheets.length > 0) {
        this.importWizardState.selectedSheet = workbook.worksheets[0].name;
        sheetSelect.value = this.importWizardState.selectedSheet;
        this.parseSelectedSheet();
      }

      // Update upload zone to show file name
      const uploadZone = document.getElementById('uploadZone');
      if (uploadZone) {
        uploadZone.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" stroke-width="2" width="48" height="48">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
            <polyline points="22 4 12 14.01 9 11.01"/>
          </svg>
          <h4 style="color: var(--color-success);">File loaded: ${file.name}</h4>
          <p>${workbook.worksheets.length} sheet(s) found • Click to change file</p>
        `;
      }

      // Enable next button
      const nextBtn = document.getElementById('wizardNextBtn') as HTMLButtonElement;
      nextBtn.disabled = false;

    } catch (error) {
      console.error('Error loading file:', error);
      this.showToast('Error loading Excel file', 'error');
    }
  }

  private parseSelectedSheet(): void {
    const workbook = this.importWizardState.workbook;
    if (!workbook) return;

    const sheet = workbook.getWorksheet(this.importWizardState.selectedSheet);
    if (!sheet) return;

    // Find header row (first row with content)
    let headerRowNum = 1;
    const columns: string[] = [];
    const rows: any[][] = [];

    // Try to find header row (look for row with multiple non-empty cells)
    for (let r = 1; r <= Math.min(10, sheet.rowCount); r++) {
      const row = sheet.getRow(r);
      let nonEmptyCells = 0;
      row.eachCell({ includeEmpty: false }, () => nonEmptyCells++);
      if (nonEmptyCells >= 3) {
        headerRowNum = r;
        break;
      }
    }

    // Extract headers
    const headerRow = sheet.getRow(headerRowNum);
    headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      columns[colNumber - 1] = cell.value?.toString() || `Column ${colNumber}`;
    });

    // Extract data rows
    for (let r = headerRowNum + 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const rowData: any[] = [];
      let hasData = false;
      
      columns.forEach((_, idx) => {
        const cell = row.getCell(idx + 1);
        const value = cell.value;
        rowData[idx] = value !== null && value !== undefined ? value : '';
        if (value) hasData = true;
      });
      
      if (hasData) rows.push(rowData);
    }

    this.importWizardState.columns = columns.filter(c => c);
    this.importWizardState.rows = rows;

    // Auto-detect column mapping
    this.autoDetectMapping();
  }

  private autoDetectMapping(): void {
    const mapping: Record<string, string> = {};
    const columns = this.importWizardState.columns;

    // Define possible column name variations
    const fieldMappings: Record<string, string[]> = {
      'customer': ['customer', 'kunde', 'client', 'klient', 'firma', 'company', 'oem'],
      'type': ['type', 'typ', 'model', 'modell', 'serie', 'series'],
      'part': ['part', 'teil', 'component', 'komponente', 'bauteil', 'element'],
      'test': ['test', 'prüfung', 'pruefung', 'check', 'audit', 'kontrolle', 'testing']
    };

    // Try to match columns
    columns.forEach((col, idx) => {
      const colLower = col.toLowerCase().trim();
      
      for (const [field, variations] of Object.entries(fieldMappings)) {
        if (!mapping[field]) {
          for (const variation of variations) {
            if (colLower.includes(variation)) {
              mapping[field] = idx.toString();
              break;
            }
          }
        }
      }

      // Detect week columns (KW01, KW02, etc.)
      const kwMatch = colLower.match(/kw\s*(\d{1,2})/i);
      if (kwMatch) {
        const weekNum = parseInt(kwMatch[1]);
        const isIst = colLower.includes('ist') || colLower.includes('actual') || !colLower.includes('soll');
        const isSoll = colLower.includes('soll') || colLower.includes('plan') || colLower.includes('target');
        
        if (isIst && !isSoll) {
          mapping[`kw${weekNum.toString().padStart(2, '0')}_ist`] = idx.toString();
        } else if (isSoll) {
          mapping[`kw${weekNum.toString().padStart(2, '0')}_soll`] = idx.toString();
        }
      }
    });

    this.importWizardState.columnMapping = mapping;
  }

  private renderColumnMapping(): void {
    const grid = document.getElementById('columnMappingGrid');
    if (!grid) return;

    const columns = this.importWizardState.columns;
    const mapping = this.importWizardState.columnMapping;
    const rows = this.importWizardState.rows;

    // Required fields
    const requiredFields = [
      { key: 'customer', label: 'Customer', required: true },
      { key: 'type', label: 'Type', required: false },
      { key: 'part', label: 'Part', required: false },
      { key: 'test', label: 'Test', required: true }
    ];

    let html = '';

    requiredFields.forEach(field => {
      const mappedIdx = mapping[field.key];
      const isMatched = mappedIdx !== undefined;
      const sampleValues = isMatched && rows.length > 0 
        ? rows.slice(0, 3).map(r => r[parseInt(mappedIdx)]).filter(v => v).join(', ')
        : '';

      html += `
        <div class="mapping-item ${isMatched ? 'matched' : 'unmatched'}">
          <div class="mapping-item-header">
            <span class="mapping-field-name">${field.label}${field.required ? ' *' : ''}</span>
            <span class="mapping-status">${isMatched ? 'Matched' : 'Select column'}</span>
          </div>
          <select class="mapping-select" data-field="${field.key}">
            <option value="">-- Select column --</option>
            ${columns.map((col, idx) => `
              <option value="${idx}" ${mappedIdx === idx.toString() ? 'selected' : ''}>${col}</option>
            `).join('')}
          </select>
          ${sampleValues ? `<div class="mapping-preview"><strong>Sample:</strong> ${this.escapeHtml(sampleValues.substring(0, 50))}</div>` : ''}
        </div>
      `;
    });

    // Week columns summary
    const weekMappings = Object.keys(mapping).filter(k => k.startsWith('kw'));
    if (weekMappings.length > 0) {
      html += `
        <div class="mapping-item matched" style="grid-column: 1 / -1;">
          <div class="mapping-item-header">
            <span class="mapping-field-name">Week Data (KW columns)</span>
            <span class="mapping-status">${weekMappings.length} columns detected</span>
          </div>
          <div class="mapping-preview">
            <strong>Detected:</strong> ${weekMappings.slice(0, 10).map(k => k.toUpperCase().replace('_', ' ')).join(', ')}${weekMappings.length > 10 ? '...' : ''}
          </div>
        </div>
      `;
    }

    grid.innerHTML = html;

    // Add change listeners
    grid.querySelectorAll('.mapping-select').forEach(select => {
      select.addEventListener('change', (e) => {
        const field = (e.target as HTMLSelectElement).dataset.field!;
        const value = (e.target as HTMLSelectElement).value;
        if (value) {
          this.importWizardState.columnMapping[field] = value;
        } else {
          delete this.importWizardState.columnMapping[field];
        }
        this.renderColumnMapping();
      });
    });
  }

  private renderPreview(): void {
    const mapping = this.importWizardState.columnMapping;
    const rows = this.importWizardState.rows;
    
    // Parse data based on mapping
    const parsedData: any[] = [];
    const warnings: string[] = [];
    const newCustomers = new Set<string>();
    const newTypes = new Set<string>();
    const newParts = new Set<string>();
    const newTests = new Set<string>();

    rows.forEach((row, rowIdx) => {
      const customerName = mapping.customer ? row[parseInt(mapping.customer)]?.toString().trim() : '';
      const typeName = mapping.type ? row[parseInt(mapping.type)]?.toString().trim() : '';
      const partName = mapping.part ? row[parseInt(mapping.part)]?.toString().trim() : '';
      const testName = mapping.test ? row[parseInt(mapping.test)]?.toString().trim() : '';

      if (!customerName && !testName) return; // Skip empty rows

      // Check if entities exist
      const existingCustomer = this.state.customers.find(c => c.name.toLowerCase() === customerName.toLowerCase());
      const existingType = this.state.types.find(t => t.name.toLowerCase() === typeName.toLowerCase());
      const existingPart = this.state.parts.find(p => p.name.toLowerCase() === partName.toLowerCase());
      const existingTest = this.state.tests.find(t => t.name.toLowerCase() === testName.toLowerCase());

      if (customerName && !existingCustomer) newCustomers.add(customerName);
      if (typeName && !existingType) newTypes.add(typeName);
      if (partName && !existingPart) newParts.add(partName);
      if (testName && !existingTest) newTests.add(testName);

      // Extract week data
      const weeks: Record<string, { ist: number; soll: number }> = {};
      for (let w = 1; w <= 52; w++) {
        const kwKey = `kw${w.toString().padStart(2, '0')}`;
        const istIdx = mapping[`${kwKey}_ist`];
        const sollIdx = mapping[`${kwKey}_soll`];
        
        const ist = istIdx ? parseFloat(row[parseInt(istIdx)]) || 0 : 0;
        const soll = sollIdx ? parseFloat(row[parseInt(sollIdx)]) || 0 : 0;
        
        if (ist > 0 || soll > 0) {
          weeks[`${this.state.selectedYear}-${kwKey.toUpperCase()}`] = { ist, soll };
        }
      }

      parsedData.push({
        rowNum: rowIdx + 1,
        customer: customerName,
        type: typeName,
        part: partName,
        test: testName,
        weeks,
        isNew: !existingCustomer || !existingTest,
        existingCustomer,
        existingType,
        existingPart,
        existingTest
      });
    });

    this.importWizardState.parsedData = parsedData;

    // Render stats
    const statsEl = document.getElementById('previewStats');
    if (statsEl) {
      statsEl.innerHTML = `
        <div class="preview-stat"><span>Rows:</span> <span class="preview-stat-value">${parsedData.length}</span></div>
        <div class="preview-stat"><span>New Customers:</span> <span class="preview-stat-value">${newCustomers.size}</span></div>
        <div class="preview-stat"><span>New Tests:</span> <span class="preview-stat-value">${newTests.size}</span></div>
      `;
    }

    // Render preview table
    const thead = document.getElementById('previewTableHead');
    const tbody = document.getElementById('previewTableBody');
    
    if (thead && tbody) {
      thead.innerHTML = `
        <tr>
          <th>#</th>
          <th>Customer</th>
          <th>Type</th>
          <th>Part</th>
          <th>Test</th>
          <th>Weeks with data</th>
          <th>Status</th>
        </tr>
      `;

      tbody.innerHTML = parsedData.slice(0, 50).map(row => {
        const weekCount = Object.keys(row.weeks).length;
        const status = row.isNew ? 'New' : 'Update';
        const rowClass = row.isNew ? 'row-new' : 'row-update';
        
        return `
          <tr class="${rowClass}">
            <td>${row.rowNum}</td>
            <td>${this.escapeHtml(row.customer || '-')}</td>
            <td>${this.escapeHtml(row.type || '-')}</td>
            <td>${this.escapeHtml(row.part || '-')}</td>
            <td>${this.escapeHtml(row.test || '-')}</td>
            <td>${weekCount}</td>
            <td>${status}</td>
          </tr>
        `;
      }).join('');

      if (parsedData.length > 50) {
        tbody.innerHTML += `<tr><td colspan="7" style="text-align:center;color:var(--color-text-muted);">... and ${parsedData.length - 50} more rows</td></tr>`;
      }
    }

    // Render warnings
    const warningsEl = document.getElementById('importWarnings');
    if (warningsEl) {
      let warningsHtml = '';
      
      if (newCustomers.size > 0) {
        warningsHtml += `
          <div class="warning-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <span><strong>${newCustomers.size}</strong> new customer(s) will be created: ${Array.from(newCustomers).slice(0, 5).join(', ')}${newCustomers.size > 5 ? '...' : ''}</span>
          </div>
        `;
      }
      
      if (newTests.size > 0) {
        warningsHtml += `
          <div class="warning-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <span><strong>${newTests.size}</strong> new test(s) will be created: ${Array.from(newTests).slice(0, 5).join(', ')}${newTests.size > 5 ? '...' : ''}</span>
          </div>
        `;
      }

      warningsEl.innerHTML = warningsHtml;
    }
  }

  private async executeImport(): Promise<void> {
    const parsedData = this.importWizardState.parsedData;
    const createMissing = (document.getElementById('importCreateMissing') as HTMLInputElement)?.checked;
    const mergeData = (document.getElementById('importMergeData') as HTMLInputElement)?.checked;
    const updateExisting = (document.getElementById('importUpdateExisting') as HTMLInputElement)?.checked;

    try {
      let importedCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;

      // Create maps for quick lookup
      const customerMap = new Map(this.state.customers.map(c => [c.name.toLowerCase(), c]));
      const typeMap = new Map(this.state.types.map(t => [t.name.toLowerCase(), t]));
      const partMap = new Map(this.state.parts.map(p => [p.name.toLowerCase(), p]));
      const testMap = new Map(this.state.tests.map(t => [t.name.toLowerCase(), t]));

      for (const row of parsedData) {
        // Get or create customer
        let customer = customerMap.get(row.customer.toLowerCase());
        if (!customer && row.customer && createMissing) {
          const newCustomer: Customer = { id: this.generateId(), name: row.customer, createdAt: Date.now() };
          await db.put('customers', newCustomer);
          this.state.customers.push(newCustomer);
          customerMap.set(row.customer.toLowerCase(), newCustomer);
          customer = newCustomer;
        }

        // Get or create type
        let type = typeMap.get(row.type.toLowerCase());
        if (!type && row.type && createMissing) {
          const newType: Type = { id: this.generateId(), name: row.type, createdAt: Date.now() };
          await db.put('types', newType);
          this.state.types.push(newType);
          typeMap.set(row.type.toLowerCase(), newType);
          type = newType;
        }

        // Get or create part
        let part = partMap.get(row.part.toLowerCase());
        if (!part && row.part && createMissing) {
          const newPart: Part = { id: this.generateId(), name: row.part, createdAt: Date.now() };
          await db.put('parts', newPart);
          this.state.parts.push(newPart);
          partMap.set(row.part.toLowerCase(), newPart);
          part = newPart;
        }

        // Get or create test
        let test = testMap.get(row.test.toLowerCase());
        if (!test && row.test && createMissing) {
          const testColor = TEST_COLORS[this.state.tests.length % TEST_COLORS.length];
          const newTest: Test = { id: this.generateId(), name: row.test, color: testColor, createdAt: Date.now() };
          await db.put('tests', newTest);
          this.state.tests.push(newTest);
          testMap.set(row.test.toLowerCase(), newTest);
          test = newTest;
        }

        if (!customer || !test) {
          skippedCount++;
          continue;
        }

        // Find existing project
        const existingProject = this.state.projects.find(p =>
          p.customer_id === customer!.id &&
          (type ? p.type_id === type.id : true) &&
          (part ? p.part_id === part.id : true) &&
          p.test_id === test!.id
        );

        if (existingProject && updateExisting) {
          // Merge weeks data
          for (const [week, data] of Object.entries(row.weeks)) {
            existingProject.weeks[week] = {
              ...existingProject.weeks[week],
              ...(data as { ist?: number; soll?: number })
            };
          }
          existingProject.updated_at = Date.now();
          await db.put('projects', existingProject);
          updatedCount++;
        } else if (!existingProject) {
          // Create new project
          const newProject: Project = {
            id: this.generateId(),
            customer_id: customer.id,
            type_id: type?.id || '',
            part_id: part?.id || '',
            test_id: test.id,
            weeks: row.weeks,
            timePerUnit: 15,
            created_at: Date.now(),
            updated_at: Date.now()
          };
          await db.put('projects', newProject);
          this.state.projects.push(newProject);
          importedCount++;
        } else {
          skippedCount++;
        }
      }

      // Reload and close
      await this.loadData();
      this.renderCurrentView();
      this.closeImportWizard();
      
      this.showToast(`Import complete: ${importedCount} new, ${updatedCount} updated, ${skippedCount} skipped`, 'success');

    } catch (error) {
      console.error('Import error:', error);
      this.showToast('Error during import', 'error');
    }
  }

  private async importExcel(file: File): Promise<void> {
    const workbook = new ExcelJS.Workbook();
    const buffer = await file.arrayBuffer();
    await workbook.xlsx.load(buffer);
    
    const sheet = workbook.getWorksheet('Produkt Audyt');
    if (!sheet) {
      this.showToast('Invalid Excel file format', 'error');
      return;
    }

    // For now, show success - full import would require matching customer/type/etc names
    this.showToast(i18n.t('messages.importSuccessfully'), 'success');
  }

  private async importJson(file: File): Promise<void> {
    const data = JSON.parse(await file.text());

    // Clear existing
    for (const store of ['customers', 'types', 'parts', 'tests', 'projects', 'comments']) {
      await db.clear(store);
    }

    // Import
    for (const c of (data.customers || [])) await db.put('customers', c);
    for (const t of (data.types || [])) await db.put('types', t);
    for (const p of (data.parts || [])) await db.put('parts', p);
    for (const t of (data.tests || [])) await db.put('tests', t);
    
    for (const p of (data.projects || [])) {
      // Handle old format (camelCase to snake_case)
      if (p.customerId) p.customer_id = p.customerId;
      if (p.typeId) p.type_id = p.typeId;
      if (p.partId) p.part_id = p.partId;
      if (p.testId) p.test_id = p.testId;
      if (p.createdAt && !p.created_at) p.created_at = p.createdAt;
      if (p.updatedAt && !p.updated_at) p.updated_at = p.updatedAt;
      // Ensure timePerUnit exists
      if (!p.timePerUnit) p.timePerUnit = 15;
      await db.put('projects', p);
    }
    
    for (const c of (data.comments || [])) await db.put('comments', c);

    if (data.settings) {
      this.state.settings = data.settings;
      await this.saveSettings();
      this.applyTheme();
    }

    await this.loadData();
    this.renderCurrentView();
    this.showToast(`${i18n.t('messages.importSuccessfully')} - ${data.projects?.length || 0} projects`, 'success');
  }

  private async clearAllData(): Promise<void> {
    if (!confirm(i18n.t('settings.confirmDeleteAll'))) return;
    if (!confirm(i18n.t('settings.confirmDeleteAllFinal'))) return;

    for (const store of ['customers', 'types', 'parts', 'tests', 'projects', 'comments']) {
      await db.clear(store);
    }

    await this.loadData();
    this.renderCurrentView();
    this.showToast(i18n.t('settings.dataDeleted'), 'success');
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  private showToast(message: string, type: 'success' | 'error' | 'warning'): void {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const icons = { 
      success: '<svg viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2" width="20" height="20"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>', 
      error: '<svg viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2" width="20" height="20"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>', 
      warning: '<svg viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2" width="20" height="20"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>' 
    };
    toast.innerHTML = `<span>${icons[type]}</span> ${message}`;
    
    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private startAnimations(): void {
    // Pulse current week every minute
    setInterval(() => {
      document.querySelectorAll('.current-week').forEach(el => {
        el.classList.add('pulse');
        setTimeout(() => el.classList.remove('pulse'), 1000);
      });
    }, 60000);
  }

  // ==================== Schedule Module ====================
  
  private scheduleCurrentWeek: number = this.getCurrentWeek();
  private scheduleCurrentYear: number = new Date().getFullYear();
  private scheduleShiftSystem: 1 | 2 | 3 = 2;
  private scheduleViewMode: 'week' | 'multi' | 'year' | 'compact' | 'history' = 'week';
  private scheduleFilterEmployee: string = '';
  private scheduleFilterProject: string = '';
  private scheduleFilterTest: string = '';
  private scheduleSortMode: 'default' | 'alpha' | 'coverage' = 'default';
  private pinnedScheduleProjects: Set<string> = new Set();
  private draggedEmployeeId: string | null = null;
  private draggedEmployeeScope: 'project' | 'audit' | 'adhesion' | 'specific' = 'project';
  private scheduleListenersInitialized: boolean = false;
  
  private async loadPinnedScheduleProjects(): Promise<void> {
    try {
      const saved = await db.getPreference('pinnedScheduleProjects');
      if (saved && Array.isArray(saved)) {
        this.pinnedScheduleProjects = new Set(saved);
      }
    } catch (e) {
      console.warn('Failed to load pinned schedule projects');
    }
  }
  
  private async toggleScheduleProjectPin(groupKey: string): Promise<void> {
    if (this.pinnedScheduleProjects.has(groupKey)) {
      this.pinnedScheduleProjects.delete(groupKey);
    } else {
      this.pinnedScheduleProjects.add(groupKey);
    }
    await db.setPreference('pinnedScheduleProjects', [...this.pinnedScheduleProjects]);
    this.renderScheduleContent();
  }
  
  private async renderScheduleView(): Promise<void> {
    await this.loadPinnedScheduleProjects();
    // Load absences for schedule integration
    await this.loadAbsenceData();
    this.setupScheduleEventListeners();
    this.renderScheduleFilters();
    this.renderScheduleWeekNav();
    this.renderScheduleEmployeePanel();
    this.renderScheduleAlerts();
    this.renderScheduleContent();
  }
  
  private renderScheduleFilters(): void {
    const filterEmployee = document.getElementById('filterEmployee') as HTMLSelectElement;
    const filterProject = document.getElementById('filterProject') as HTMLSelectElement;
    const filterTest = document.getElementById('filterTest') as HTMLSelectElement;
    
    if (filterEmployee) {
      const currentValue = this.scheduleFilterEmployee;
      filterEmployee.innerHTML = '<option value="">Wszyscy</option>' + 
        this.state.employees
          .filter(e => !e.status || e.status === 'available')
          .map(e => `<option value="${e.id}" ${e.id === currentValue ? 'selected' : ''}>${e.firstName} ${e.lastName}</option>`)
          .join('');
    }
    
    if (filterProject) {
      const currentValue = this.scheduleFilterProject;
      const uniqueCustomers = new Map<string, string>();
      this.state.projects.forEach(p => {
        const customer = this.state.customers.find(c => c.id === p.customer_id);
        if (customer && !uniqueCustomers.has(customer.id)) {
          uniqueCustomers.set(customer.id, customer.name);
        }
      });
      filterProject.innerHTML = `<option value="">${i18n.t('schedule.allProjects')}</option>` + 
        Array.from(uniqueCustomers.entries())
          .sort((a, b) => a[1].localeCompare(b[1]))
          .map(([id, name]) => `<option value="${id}" ${id === currentValue ? 'selected' : ''}>${name}</option>`)
          .join('');
    }
    
    if (filterTest) {
      const currentValue = this.scheduleFilterTest;
      // Pobierz unikalne typy badań z projektów które mają SOLL > 0 w tym tygodniu
      const weekKey = `${this.scheduleCurrentYear}-KW${this.scheduleCurrentWeek.toString().padStart(2, '0')}`;
      const testsInUse = new Set<string>();
      this.state.projects.forEach(p => {
        const weekData = p.weeks[weekKey];
        if (weekData && weekData.soll > 0 && p.test_id) {
          testsInUse.add(p.test_id);
        }
      });
      
      const testsToShow = this.state.tests.filter(t => testsInUse.has(t.id) || this.state.tests.length <= 10);
      filterTest.innerHTML = `<option value="">${i18n.t('schedulePanel.allTests')}</option>` + 
        (testsToShow.length > 0 
          ? testsToShow.map(t => `<option value="${t.id}" ${t.id === currentValue ? 'selected' : ''}>${t.name}</option>`).join('')
          : this.state.tests.map(t => `<option value="${t.id}" ${t.id === currentValue ? 'selected' : ''}>${t.name}</option>`).join(''));
    }
  }
  
  private renderScheduleContent(): void {
    switch (this.scheduleViewMode) {
      case 'multi':
        this.renderMultiWeekView();
        break;
      case 'year':
        this.renderYearView();
        break;
      case 'compact':
        this.renderCompactView();
        break;
      case 'history':
        this.renderHistoryView();
        break;
      default:
        this.renderScheduleProjectsPanel();
    }
  }
  
  private refreshScheduleTopbarFilter(): void {
    const employeeFilterTopbar = document.getElementById('scheduleEmployeeFilter') as HTMLSelectElement;
    if (employeeFilterTopbar) {
      employeeFilterTopbar.innerHTML = `<option value="">${i18n.t('schedulePanel.allEmployees')}</option>` + 
        this.state.employees
          .filter(e => !e.status || e.status === 'available')
          .sort((a, b) => a.firstName.localeCompare(b.firstName))
          .map(e => `<option value="${e.id}" ${e.id === this.scheduleFilterEmployee ? 'selected' : ''}>${e.firstName} ${e.lastName}</option>`)
          .join('');
    }
  }
  
  private setupScheduleEventListeners(): void {
    // Prevent duplicate event listeners from stacking
    if (this.scheduleListenersInitialized) {
      // Only refresh dynamic content (filter options)
      this.refreshScheduleTopbarFilter();
      return;
    }
    this.scheduleListenersInitialized = true;

    // View toggle (week/history)
    document.querySelectorAll('.sched-view-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const view = (btn as HTMLElement).dataset.view;
        if (view === 'history') {
          this.scheduleViewMode = 'history';
        } else if (view === '3week') {
          this.scheduleViewMode = 'multi';
        } else {
          this.scheduleViewMode = 'week';
        }
        document.querySelectorAll('.sched-view-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.renderScheduleContent();
      });
    });
    
    // Shift toggle buttons
    document.querySelectorAll('.sched-shift-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const shift = parseInt((btn as HTMLElement).dataset.shift || '2') as 1 | 2 | 3;
        this.scheduleShiftSystem = shift;
        document.querySelectorAll('.sched-shift-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.renderScheduleContent();
      });
    });
    
    // Week navigation
    document.getElementById('schedulePrevWeek')?.addEventListener('click', () => {
      this.scheduleCurrentWeek--;
      if (this.scheduleCurrentWeek < 1) {
        this.scheduleCurrentWeek = 52;
        this.scheduleCurrentYear--;
      }
      this.renderScheduleWeekNav();
      this.renderScheduleAlerts();
      this.renderScheduleContent();
      this.renderScheduleEmployeePanel();
    });
    
    document.getElementById('scheduleNextWeek')?.addEventListener('click', () => {
      this.scheduleCurrentWeek++;
      if (this.scheduleCurrentWeek > 52) {
        this.scheduleCurrentWeek = 1;
        this.scheduleCurrentYear++;
      }
      this.renderScheduleWeekNav();
      this.renderScheduleAlerts();
      this.renderScheduleContent();
      this.renderScheduleEmployeePanel();
    });
    
    document.getElementById('scheduleToday')?.addEventListener('click', () => {
      this.scheduleCurrentWeek = this.getCurrentWeek();
      this.scheduleCurrentYear = new Date().getFullYear();
      this.renderScheduleWeekNav();
      this.renderScheduleAlerts();
      this.renderScheduleContent();
      this.renderScheduleEmployeePanel();
    });
    
    document.getElementById('addEmployeeQuick')?.addEventListener('click', () => this.showAddEmployeeModal());
    
    // Filtr pracownika w topbar - setup listener
    this.refreshScheduleTopbarFilter();
    const employeeFilterTopbar = document.getElementById('scheduleEmployeeFilter') as HTMLSelectElement;
    if (employeeFilterTopbar) {
      employeeFilterTopbar.addEventListener('change', (e) => {
        this.scheduleFilterEmployee = (e.target as HTMLSelectElement).value;
        this.renderScheduleContent();
        this.renderScheduleEmployeePanel();
      });
    }
    
    // Filtry
    document.getElementById('filterEmployee')?.addEventListener('change', (e) => {
      this.scheduleFilterEmployee = (e.target as HTMLSelectElement).value;
      this.renderScheduleContent();
    });
    
    document.getElementById('filterProject')?.addEventListener('change', (e) => {
      this.scheduleFilterProject = (e.target as HTMLSelectElement).value;
      this.renderScheduleContent();
    });
    
    document.getElementById('filterTest')?.addEventListener('change', (e) => {
      this.scheduleFilterTest = (e.target as HTMLSelectElement).value;
      this.renderScheduleContent();
    });
    
    // Sortowanie
    document.querySelectorAll('.sched-sort-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const sort = (btn as HTMLElement).dataset.sort as 'default' | 'alpha' | 'coverage';
        this.scheduleSortMode = sort;
        document.querySelectorAll('.sched-sort-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.renderScheduleContent();
      });
    });
    
    // Mini kalendarz
    document.getElementById('toggleMiniCalendar')?.addEventListener('click', () => this.toggleMiniCalendar());
    
    // Historia zmian
    document.getElementById('toggleHistory')?.addEventListener('click', () => this.showHistoryPanel());
    
    // Eksport
    document.getElementById('exportSchedule')?.addEventListener('click', () => this.showExportModal());
    
    // Wyślij email
    document.getElementById('sendEmailBtn')?.addEventListener('click', () => this.showSendEmailModal());
    
    // Shift Planner
    document.getElementById('shiftPlannerBtn')?.addEventListener('click', () => this.showShiftPlannerModal());
    
    // Szablony
    document.getElementById('templatesBtn')?.addEventListener('click', () => this.showTemplatesModal());
    
    // Powiadomienia
    document.getElementById('notificationsBtn')?.addEventListener('click', () => this.showNotificationsModal());
    
    // Widok Gantt
    document.getElementById('ganttViewBtn')?.addEventListener('click', () => this.showGanttView());
    
    // Statystyki pracownika
    document.getElementById('employeeStatsBtn')?.addEventListener('click', () => this.showEmployeeStatsModal());
    
    // Klikalne panele statystyk i historii
    document.getElementById('statsPanelContainer')?.addEventListener('click', () => this.showStatsModal());
    document.getElementById('historyPanelContainer')?.addEventListener('click', () => this.showHistoryPanel());
    
    // Schedule sidebar toggle/close
    document.getElementById('schedSidebarToggle')?.addEventListener('click', () => {
      const sidebar = document.getElementById('schedSidebar');
      const scheduleView = document.getElementById('scheduleView');
      const container = document.querySelector('.sched-container');
      if (sidebar) {
        sidebar.classList.add('open');
      }
      if (scheduleView) {
        scheduleView.classList.add('sidebar-open');
      }
      if (container) {
        container.classList.add('sidebar-open');
      }
    });
    
    document.getElementById('schedSidebarClose')?.addEventListener('click', () => {
      const sidebar = document.getElementById('schedSidebar');
      const scheduleView = document.getElementById('scheduleView');
      const container = document.querySelector('.sched-container');
      if (sidebar) {
        sidebar.classList.remove('open');
      }
      if (scheduleView) {
        scheduleView.classList.remove('sidebar-open');
      }
      if (container) {
        container.classList.remove('sidebar-open');
      }
    });
  }
  
  // Mini kalendarz miesięczny
  private toggleMiniCalendar(): void {
    const dropdown = document.getElementById('miniCalendarDropdown');
    if (!dropdown) return;
    
    if (dropdown.style.display === 'none') {
      this.renderMiniCalendar();
      dropdown.style.display = 'block';
      
      // Zamknij przy kliknięciu poza
      const closeHandler = (e: MouseEvent) => {
        if (!(e.target as HTMLElement).closest('.sched-mini-calendar')) {
          dropdown.style.display = 'none';
          document.removeEventListener('click', closeHandler);
        }
      };
      setTimeout(() => document.addEventListener('click', closeHandler), 10);
    } else {
      dropdown.style.display = 'none';
    }
  }
  
  private renderMiniCalendar(): void {
    const dropdown = document.getElementById('miniCalendarDropdown');
    const monthLabel = document.getElementById('miniCalendarMonth');
    if (!dropdown) return;
    
    const months = [
      i18n.t('planning.monthJan'), i18n.t('planning.monthFeb'), i18n.t('planning.monthMar'),
      i18n.t('planning.monthApr'), i18n.t('planning.monthMay'), i18n.t('planning.monthJun'),
      i18n.t('planning.monthJul'), i18n.t('planning.monthAug'), i18n.t('planning.monthSep'),
      i18n.t('planning.monthOct'), i18n.t('planning.monthNov'), i18n.t('planning.monthDec')
    ];
    const monthsFull = [
      i18n.t('schedule.monthFullJan'), i18n.t('schedule.monthFullFeb'), i18n.t('schedule.monthFullMar'),
      i18n.t('schedule.monthFullApr'), i18n.t('schedule.monthFullMay'), i18n.t('schedule.monthFullJun'),
      i18n.t('schedule.monthFullJul'), i18n.t('schedule.monthFullAug'), i18n.t('schedule.monthFullSep'),
      i18n.t('schedule.monthFullOct'), i18n.t('schedule.monthFullNov'), i18n.t('schedule.monthFullDec')
    ];
    const weekdays = [
      i18n.t('schedule.weekdayMon'), i18n.t('schedule.weekdayTue'), i18n.t('schedule.weekdayWed'),
      i18n.t('schedule.weekdayThu'), i18n.t('schedule.weekdayFri'), i18n.t('schedule.weekdaySat'), i18n.t('schedule.weekdaySun')
    ];
    
    // Określ miesiąc na podstawie obecnego tygodnia
    const weekDates = this.getWeekDateRange(this.scheduleCurrentYear, this.scheduleCurrentWeek);
    const [, monthStr] = weekDates.start.split('.');
    const currentMonth = parseInt(monthStr) - 1;
    
    if (monthLabel) {
      monthLabel.textContent = months[currentMonth];
    }
    
    // Generuj dni miesiąca
    const firstDay = new Date(this.scheduleCurrentYear, currentMonth, 1);
    const lastDay = new Date(this.scheduleCurrentYear, currentMonth + 1, 0);
    const startPadding = (firstDay.getDay() + 6) % 7; // Poniedziałek = 0
    
    // Pobierz pokrycie dla każdego tygodnia
    const getCoverageForDay = (date: Date): 'low' | 'medium' | 'high' | null => {
      const weekNum = this.getWeekNumber(date);
      const weekKey = `${date.getFullYear()}-KW${weekNum.toString().padStart(2, '0')}`;
      
      const weekAssignments = this.state.scheduleAssignments.filter((a: ScheduleAssignment) => a.week === weekKey);
      const availableEmployees = this.state.employees.filter(e => !e.status || e.status === 'available');
      const assignedIds = new Set(weekAssignments.map((a: ScheduleAssignment) => a.employeeId));
      const percent = availableEmployees.length > 0 
        ? (availableEmployees.filter(e => assignedIds.has(e.id)).length / availableEmployees.length) * 100 
        : 0;
      
      if (percent === 0) return null;
      return percent < 50 ? 'low' : percent < 80 ? 'medium' : 'high';
    };
    
    let daysHtml = weekdays.map(d => `<div class="sched-mini-cal-weekday">${d}</div>`).join('');
    
    // Puste dni przed początkiem miesiąca
    for (let i = 0; i < startPadding; i++) {
      daysHtml += '<div class="sched-mini-cal-day other-month"></div>';
    }
    
    // Dni miesiąca
    const today = new Date();
    
    for (let d = 1; d <= lastDay.getDate(); d++) {
      const date = new Date(this.scheduleCurrentYear, currentMonth, d);
      const isToday = date.toDateString() === today.toDateString();
      const dayWeek = this.getWeekNumber(date);
      const isSelectedWeek = dayWeek === this.scheduleCurrentWeek && date.getFullYear() === this.scheduleCurrentYear;
      const coverage = getCoverageForDay(date);
      
      daysHtml += `
        <div class="sched-mini-cal-day ${isToday ? 'today' : ''} ${isSelectedWeek ? 'selected-week' : ''}" 
             data-date="${date.toISOString()}" data-week="${dayWeek}">
          ${d}
          ${coverage ? `<span class="coverage-dot ${coverage}"></span>` : ''}
        </div>
      `;
    }
    
    dropdown.innerHTML = `
      <div class="sched-mini-cal-header">
        <span class="sched-mini-cal-title">${monthsFull[currentMonth]} ${this.scheduleCurrentYear}</span>
        <div class="sched-mini-cal-nav">
          <button data-dir="-1">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
          <button data-dir="1">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
          </button>
        </div>
      </div>
      <div class="sched-mini-cal-grid">${daysHtml}</div>
    `;
    
    // Event listeners
    dropdown.querySelectorAll('.sched-mini-cal-day:not(.other-month)').forEach(day => {
      day.addEventListener('click', () => {
        const week = parseInt((day as HTMLElement).dataset.week || '1');
        this.scheduleCurrentWeek = week;
        this.renderScheduleWeekNav();
        this.renderScheduleAlerts();
        this.renderScheduleContent();
        this.renderScheduleEmployeePanel();
        dropdown.style.display = 'none';
      });
    });
    
    dropdown.querySelectorAll('.sched-mini-cal-nav button').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        // TODO: nawigacja po miesiącach
      });
    });
  }
  
  private getWeekNumber(date: Date): number {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  }
  
  private getWeekStartDate(year: number, week: number): Date {
    const jan4 = new Date(year, 0, 4);
    const dayOfWeek = jan4.getDay() || 7;
    const startDate = new Date(jan4);
    startDate.setDate(jan4.getDate() - dayOfWeek + 1 + (week - 1) * 7);
    return startDate;
  }
  
  // Panel historii zmian
  private async showHistoryPanel(): Promise<void> {
    // Pobierz historię z lokalnego stanu (this.logs)
    let logs = this.logs
      .filter(log => log.entityType === 'Assignment' || log.entityType === 'Employee' || log.entityType === 'ScheduleEntry')
      .slice(0, 100); // Max 100 wpisów
    
    // Filtruj tylko wpisy z ostatnich 30 dni
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    logs = logs
      .filter(log => log.timestamp >= thirtyDaysAgo)
      .sort((a, b) => b.timestamp - a.timestamp);
    
    // Grupuj po datach
    const groupedLogs = new Map<string, typeof logs>();
    logs.forEach(log => {
      const date = new Date(log.timestamp).toLocaleDateString(i18n.getDateLocale(), { weekday: 'short', day: '2-digit', month: '2-digit' });
      if (!groupedLogs.has(date)) {
        groupedLogs.set(date, []);
      }
      groupedLogs.get(date)!.push(log);
    });
    
    const overlay = document.createElement('div');
    overlay.className = 'employee-modal-overlay';
    overlay.innerHTML = `
      <div class="employee-modal" style="max-width: 550px;">
        <div class="employee-modal-header">
          <div class="employee-modal-info">
            <h2>📋 Historia zmian (ostatnie 30 dni)</h2>
            <span style="font-size: 0.75rem; color: var(--color-text-muted);">${logs.length} zmian</span>
          </div>
          <button class="employee-modal-close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="employee-modal-body" style="max-height: 70vh;">
          <div class="sched-history-list">
            ${logs.length > 0 ? [...groupedLogs.entries()].map(([date, dayLogs]) => `
              <div class="sched-history-date-group">
                <div class="sched-history-date-header">${date}</div>
                ${dayLogs.map((log: any) => {
                  const isAdded = log.action === 'added' || log.action === 'created';
                  const isRemoved = log.action === 'deleted' || log.action === 'removed';
                  const iconClass = isAdded ? 'added' : isRemoved ? 'removed' : 'modified';
                  const iconSvg = isAdded 
                    ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>'
                    : isRemoved
                    ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/></svg>'
                    : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>';
                  
                  const time = new Date(log.timestamp).toLocaleString(i18n.getDateLocale(), { 
                    hour: '2-digit', minute: '2-digit' 
                  });
                  
                  return `
                    <div class="sched-history-item">
                      <div class="sched-history-icon ${iconClass}">${iconSvg}</div>
                      <div class="sched-history-content">
                        <div class="sched-history-text">${log.entityName || ''}${log.details ? ` - ${log.details}` : ''}</div>
                        <div class="sched-history-time">${time}</div>
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            `).join('') : '<p style="padding: 20px; text-align: center; color: var(--color-text-muted);">Brak historii zmian</p>'}
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    
    overlay.querySelector('.employee-modal-close')?.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
  }
  
  // Modal eksportu
  private showExportModal(): void {
    const t = (key: string) => i18n.t(key);
    const weekDates = this.getWeekDateRange(this.scheduleCurrentYear, this.scheduleCurrentWeek);
    
    const overlay = document.createElement('div');
    overlay.className = 'employee-modal-overlay';
    overlay.innerHTML = `
      <div class="employee-modal" style="max-width: 450px;">
        <div class="employee-modal-header">
          <div class="employee-modal-info">
            <h2>📥 ${t('export.exportSchedule')}</h2>
            <div class="employee-modal-stats">
              <span class="employee-modal-stat">KW${this.scheduleCurrentWeek} (${weekDates.start.slice(0, 5)} - ${weekDates.end.slice(0, 5)})</span>
            </div>
          </div>
          <button class="employee-modal-close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="employee-modal-body">
          <div style="display: flex; flex-direction: column; gap: 12px;">
            <button class="sched-export-btn" data-format="pdf">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 15v-2h2v2z"/></svg>
              <div>
                <strong>PDF</strong>
                <span>${t('export.pdfDescription')}</span>
              </div>
            </button>
            <button class="sched-export-btn" data-format="excel">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
              <div>
                <strong>Excel</strong>
                <span>${t('export.excelDescription')}</span>
              </div>
            </button>
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    
    overlay.querySelector('.employee-modal-close')?.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
    
    // Eksport handlers
    overlay.querySelectorAll('.sched-export-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const format = (btn as HTMLElement).dataset.format;
        if (format === 'pdf') {
          this.exportScheduleToPdf();
        } else if (format === 'excel') {
          this.exportScheduleToExcel();
        }
        overlay.remove();
      });
    });
  }

  private getScheduleExportData(): {
    weekKey: string;
    weekDates: { start: string; end: string };
    assignments: ScheduleAssignment[];
    byShift: Map<number, { employee: string; employeeId: string; customer: string; type: string; scope: string }[]>;
    byProject: Map<string, { customerName: string; typeName: string; employees: { name: string; shift: number; scope: string }[] }>;
    stats: { totalEmployees: number; assignedEmployees: number; totalProjects: number; coveragePercent: number };
  } {
    const weekKey = `${this.scheduleCurrentYear}-KW${this.scheduleCurrentWeek.toString().padStart(2, '0')}`;
    const weekDates = this.getWeekDateRange(this.scheduleCurrentYear, this.scheduleCurrentWeek);
    const assignments = this.state.scheduleAssignments.filter((a: ScheduleAssignment) => a.week === weekKey);

    // Group by shift
    const byShift = new Map<number, { employee: string; employeeId: string; customer: string; type: string; scope: string }[]>();
    [1, 2, 3].forEach(shift => byShift.set(shift, []));

    // Group by project
    const byProject = new Map<string, { customerName: string; typeName: string; employees: { name: string; shift: number; scope: string }[] }>();

    assignments.forEach((a: ScheduleAssignment) => {
      const emp = this.state.employees.find(e => e.id === a.employeeId);
      const project = this.state.projects.find(p => p.id === a.projectId || `${p.customer_id}-${p.type_id}` === a.projectId);
      const customer = project ? this.state.customers.find(c => c.id === project.customer_id) : null;
      const type = project ? this.state.types.find(t => t.id === project.type_id) : null;

      let scope = i18n.t('schedule.fullProject');
      if (a.scope === 'adhesion') scope = i18n.t('schedule.adhesion');
      else if (a.scope === 'audit') scope = i18n.t('schedule.audit');
      else if (a.testId) {
        const test = this.state.tests.find(t => t.id === a.testId);
        scope = test?.name || 'Test';
      } else if (a.partId) {
        const part = this.state.parts.find(p => p.id === a.partId);
        scope = part?.name || i18n.t('schedule.part');
      }

      const employeeName = emp ? `${emp.firstName} ${emp.lastName}` : '?';
      const customerName = customer?.name || '?';
      const typeName = type?.name || '?';

      // Add to shift grouping
      byShift.get(a.shift)?.push({
        employee: employeeName,
        employeeId: a.employeeId,
        customer: customerName,
        type: typeName,
        scope
      });

      // Add to project grouping
      const projectKey = `${customerName} - ${typeName}`;
      if (!byProject.has(projectKey)) {
        byProject.set(projectKey, { customerName, typeName, employees: [] });
      }
      byProject.get(projectKey)!.employees.push({ name: employeeName, shift: a.shift, scope });
    });

    // Calculate statistics
    const availableEmployees = this.state.employees.filter(e => !e.status || e.status === 'available');
    const assignedEmployeeIds = new Set(assignments.map((a: ScheduleAssignment) => a.employeeId));
    const assignedCount = availableEmployees.filter(e => assignedEmployeeIds.has(e.id)).length;
    
    const weekProjects = this.state.projects.filter(p => {
      const weekData = p.weeks[weekKey];
      return weekData && weekData.soll > 0 && !p.hidden;
    });

    const stats = {
      totalEmployees: availableEmployees.length,
      assignedEmployees: assignedCount,
      totalProjects: weekProjects.length,
      coveragePercent: availableEmployees.length > 0 ? Math.round((assignedCount / availableEmployees.length) * 100) : 0
    };

    return { weekKey, weekDates, assignments, byShift, byProject, stats };
  }

  private async exportScheduleToPdf(): Promise<void> {
    try {
      const t = (key: string) => i18n.t(key);
      const lang = i18n.getLanguage();
      const dateLocale = lang === 'de' ? 'de-DE' : lang === 'pl' ? 'pl-PL' : lang === 'ro' ? 'ro-RO' : 'en-US';

      this.showExportProgress(true, 5, t('export.preparingReport'));

      const data = this.getScheduleExportData();
      const dateStr = new Date().toLocaleDateString(dateLocale);
      const timeStr = new Date().toLocaleTimeString(dateLocale);

      // A4 ratio: 1000px width = 1414px height
      const pdfPageHeight = 1414;
      const headerHeight = 110;
      const footerHeight = 40;

      const createPageSection = (content: string, includeHeader: boolean = false): HTMLDivElement => {
        const section = document.createElement('div');
        section.style.cssText = `width: 1000px; height: ${pdfPageHeight}px; background: #f8fafc; padding: 0; position: relative; overflow: hidden;`;

        if (includeHeader) {
          section.innerHTML = `
            <div style="background: #000; color: #fff; padding: 20px 28px; display: flex; justify-content: space-between; align-items: center;">
              <div>
                <h1 style="margin: 0; font-size: 24px; font-weight: 700; letter-spacing: 1px;">DRÄXLMAIER Group</h1>
                <p style="margin: 5px 0 0 0; font-size: 14px; opacity: 0.85;">Produkt Audit 360</p>
              </div>
              <div style="text-align: right;">
                <p style="margin: 0; font-size: 13px; opacity: 0.9;">${t('export.scheduleReport')}</p>
                <p style="margin: 3px 0 0 0; font-size: 12px; opacity: 0.7;">${data.weekKey} (${data.weekDates.start} - ${data.weekDates.end})</p>
              </div>
            </div>
            <div style="background: #0097AC; color: #fff; padding: 10px 28px; display: flex; justify-content: space-between; font-size: 11px;">
              <span><strong>${t('export.generatedAt')}:</strong> ${dateStr} ${timeStr}</span>
              <span><strong>${t('export.user')}:</strong> ${this.state.settings.userName || 'System'}</span>
            </div>
          `;
        }

        const contentHeight = pdfPageHeight - (includeHeader ? headerHeight : 0) - footerHeight;
        section.innerHTML += `<div style="padding: 24px 28px; background: #f8fafc; min-height: ${contentHeight}px;">${content}</div>`;

        section.innerHTML += `
          <div style="background: #1e293b; color: #fff; padding: 12px 28px; text-align: center; font-size: 10px; position: absolute; bottom: 0; left: 0; right: 0;">
            <p style="margin: 0; opacity: 0.8;">© ${new Date().getFullYear()} ${t('export.copyright')}</p>
          </div>
        `;

        return section;
      };

      this.showExportProgress(true, 20, t('export.copyingContent'));

      // KPI Cards
      const kpiContent = `
        <div style="margin-bottom: 16px;">
          <h2 style="margin: 0 0 10px 0; font-size: 14px; color: #1e293b; border-bottom: 2px solid #0097AC; padding-bottom: 4px;">📊 ${t('export.kpiTitle')}</h2>
          <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px;">
            <div style="background: #fff; padding: 16px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">
              <div style="font-size: 28px; font-weight: 700; color: #0097AC;">${data.stats.totalEmployees}</div>
              <div style="font-size: 11px; color: #64748b;">${t('export.totalEmployees')}</div>
            </div>
            <div style="background: #fff; padding: 16px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">
              <div style="font-size: 28px; font-weight: 700; color: #10b981;">${data.stats.assignedEmployees}</div>
              <div style="font-size: 11px; color: #64748b;">${t('export.assignedEmployees')}</div>
            </div>
            <div style="background: #fff; padding: 16px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">
              <div style="font-size: 28px; font-weight: 700; color: #6366f1;">${data.stats.totalProjects}</div>
              <div style="font-size: 11px; color: #64748b;">${t('export.projectsCount')}</div>
            </div>
            <div style="background: #fff; padding: 16px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">
              <div style="font-size: 28px; font-weight: 700; color: ${data.stats.coveragePercent >= 80 ? '#10b981' : data.stats.coveragePercent >= 50 ? '#f59e0b' : '#ef4444'};">${data.stats.coveragePercent}%</div>
              <div style="font-size: 11px; color: #64748b;">${t('export.coverage')}</div>
            </div>
          </div>
        </div>
      `;

      // Shift tables side by side
      const shiftNames = [t('schedule.morning'), t('schedule.afternoon'), t('schedule.night')];
      const shiftColors = ['#3b82f6', '#8b5cf6', '#f97316'];
      
      let shiftsContent = `<div style="margin-bottom: 16px;">
        <h2 style="margin: 0 0 10px 0; font-size: 14px; color: #1e293b; border-bottom: 2px solid #0097AC; padding-bottom: 4px;">👥 ${t('export.assignmentsByShift')}</h2>
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px;">`;

      for (let shift = 1; shift <= 3; shift++) {
        const shiftData = data.byShift.get(shift) || [];
        shiftsContent += `
          <div style="background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">
            <div style="background: ${shiftColors[shift - 1]}; color: #fff; padding: 10px 14px; font-weight: 600; font-size: 13px;">
              ${t('export.shift')} ${shift} - ${shiftNames[shift - 1]} (${shiftData.length})
            </div>
            <div style="padding: 8px 12px; max-height: 280px; overflow: hidden;">
              ${shiftData.length > 0 ? shiftData.slice(0, 12).map(item => `
                <div style="padding: 6px 0; border-bottom: 1px solid #f1f5f9; font-size: 11px;">
                  <div style="font-weight: 600; color: #1e293b;">${item.employee}</div>
                  <div style="color: #64748b; font-size: 10px;">${item.customer} • ${item.type}</div>
                </div>
              `).join('') + (shiftData.length > 12 ? `<div style="padding: 6px 0; color: #94a3b8; font-size: 10px; text-align: center;">+${shiftData.length - 12} ${t('export.more')}</div>` : '') : `
                <div style="padding: 20px 0; text-align: center; color: #94a3b8; font-size: 11px;">${t('export.noAssignments')}</div>
              `}
            </div>
          </div>`;
      }
      shiftsContent += '</div></div>';

      // Projects with employees
      const projectRows = Array.from(data.byProject.entries());
      let projectsContent = `<div style="margin-top: 8px;">
        <h2 style="margin: 0 0 10px 0; font-size: 14px; color: #1e293b; border-bottom: 2px solid #0097AC; padding-bottom: 4px;">🏢 ${t('export.projectAssignments')}</h2>
        <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
          <thead>
            <tr style="background: #f8fafc;">
              <th style="padding: 10px 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #e2e8f0; color: #374151;">${t('export.project')}</th>
              <th style="padding: 10px 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #e2e8f0; color: #374151;">${t('export.employees')}</th>
              <th style="padding: 10px 12px; text-align: center; font-weight: 600; border-bottom: 2px solid #e2e8f0; color: #374151; width: 80px;">${t('export.count')}</th>
            </tr>
          </thead>
          <tbody>`;

      projectRows.slice(0, 18).forEach(([key, proj], idx) => {
        const employeeList = proj.employees.map(e => `${e.name} (${t('export.shift')} ${e.shift})`).join(', ');
        projectsContent += `
          <tr style="background: ${idx % 2 === 0 ? '#fff' : '#fafbfc'};">
            <td style="padding: 8px 12px; border-bottom: 1px solid #f1f5f9;">
              <div style="font-weight: 600; color: #1e293b;">${proj.customerName}</div>
              <div style="color: #64748b; font-size: 10px;">${proj.typeName}</div>
            </td>
            <td style="padding: 8px 12px; border-bottom: 1px solid #f1f5f9; color: #475569;">${employeeList.length > 80 ? employeeList.slice(0, 80) + '...' : employeeList}</td>
            <td style="padding: 8px 12px; border-bottom: 1px solid #f1f5f9; text-align: center; font-weight: 600; color: #0097AC;">${proj.employees.length}</td>
          </tr>`;
      });

      projectsContent += '</tbody></table>';
      if (projectRows.length > 18) {
        projectsContent += `<div style="padding: 8px 12px; color: #64748b; font-size: 10px; text-align: center;">+${projectRows.length - 18} ${t('export.moreProjects')}</div>`;
      }
      projectsContent += '</div>';

      // Create page 1
      const page1Content = kpiContent + shiftsContent + projectsContent;
      const page1 = createPageSection(page1Content, true);

      this.showExportProgress(true, 50, t('export.renderingPages'));

      // Render pages using html2canvas
      const container = document.createElement('div');
      container.style.cssText = 'position: absolute; left: -9999px; top: 0;';
      document.body.appendChild(container);

      container.appendChild(page1);

      const pages: HTMLCanvasElement[] = [];
      const canvas1 = await html2canvas(page1, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#f8fafc'
      });
      pages.push(canvas1);

      // If more projects, create page 2
      if (projectRows.length > 18) {
        const remainingProjects = projectRows.slice(18);
        let page2Content = `<div>
          <h2 style="margin: 0 0 10px 0; font-size: 14px; color: #1e293b; border-bottom: 2px solid #0097AC; padding-bottom: 4px;">🏢 ${t('export.projectAssignments')} (${t('export.continued')})</h2>
          <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
            <thead>
              <tr style="background: #f8fafc;">
                <th style="padding: 10px 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #e2e8f0; color: #374151;">${t('export.project')}</th>
                <th style="padding: 10px 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #e2e8f0; color: #374151;">${t('export.employees')}</th>
                <th style="padding: 10px 12px; text-align: center; font-weight: 600; border-bottom: 2px solid #e2e8f0; color: #374151; width: 80px;">${t('export.count')}</th>
              </tr>
            </thead>
            <tbody>`;

        remainingProjects.slice(0, 35).forEach(([key, proj], idx) => {
          const employeeList = proj.employees.map(e => `${e.name} (${t('export.shift')} ${e.shift})`).join(', ');
          page2Content += `
            <tr style="background: ${idx % 2 === 0 ? '#fff' : '#fafbfc'};">
              <td style="padding: 8px 12px; border-bottom: 1px solid #f1f5f9;">
                <div style="font-weight: 600; color: #1e293b;">${proj.customerName}</div>
                <div style="color: #64748b; font-size: 10px;">${proj.typeName}</div>
              </td>
              <td style="padding: 8px 12px; border-bottom: 1px solid #f1f5f9; color: #475569;">${employeeList.length > 80 ? employeeList.slice(0, 80) + '...' : employeeList}</td>
              <td style="padding: 8px 12px; border-bottom: 1px solid #f1f5f9; text-align: center; font-weight: 600; color: #0097AC;">${proj.employees.length}</td>
            </tr>`;
        });
        page2Content += '</tbody></table></div>';

        const page2 = createPageSection(page2Content, false);
        container.appendChild(page2);

        const canvas2 = await html2canvas(page2, {
          scale: 2,
          useCORS: true,
          logging: false,
          backgroundColor: '#f8fafc'
        });
        pages.push(canvas2);
      }

      document.body.removeChild(container);

      this.showExportProgress(true, 80, t('export.generatingFile'));

      // Create PDF
      const { jsPDF } = await import('jspdf');
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

      pages.forEach((canvas, index) => {
        if (index > 0) pdf.addPage();
        const imgData = canvas.toDataURL('image/jpeg', 0.95);
        pdf.addImage(imgData, 'JPEG', 0, 0, 210, 297);
      });

      this.showExportProgress(true, 95, t('export.savingFile'));

      pdf.save(`grafik_${data.weekKey}.pdf`);

      this.showExportProgress(false, 100);
      this.showToast(t('export.pdfExported'), 'success');

    } catch (error) {
      console.error('Schedule PDF export error:', error);
      this.showExportProgress(false, 0);
      this.showToast(i18n.t('export.exportError'), 'error');
    }
  }

  private async exportScheduleToExcel(): Promise<void> {
    try {
      const t = (key: string) => i18n.t(key);
      const ExcelJS = await import('exceljs');

      this.showExportProgress(true, 10, t('export.preparingData'));

      const data = this.getScheduleExportData();

      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Produkt Audit 360';
      workbook.created = new Date();

      // Colors
      const headerBg = '000000';
      const headerText = 'FFFFFF';
      const tealBg = '0097AC';
      const altRowBg = 'F8FAFC';

      this.showExportProgress(true, 30, t('export.creatingSheets'));

      // Sheet 1: Summary
      const summarySheet = workbook.addWorksheet(t('export.summary'));
      summarySheet.columns = [
        { header: '', key: 'label', width: 30 },
        { header: '', key: 'value', width: 25 }
      ];

      summarySheet.addRow([t('export.scheduleReport'), '']);
      summarySheet.getRow(1).font = { bold: true, size: 16 };
      summarySheet.addRow([t('export.week'), data.weekKey]);
      summarySheet.addRow([t('export.dateRange'), `${data.weekDates.start} - ${data.weekDates.end}`]);
      summarySheet.addRow([t('export.generatedAt'), new Date().toLocaleString()]);
      summarySheet.addRow(['', '']);
      summarySheet.addRow([t('export.totalEmployees'), data.stats.totalEmployees]);
      summarySheet.addRow([t('export.assignedEmployees'), data.stats.assignedEmployees]);
      summarySheet.addRow([t('export.projectsCount'), data.stats.totalProjects]);
      summarySheet.addRow([t('export.coverage'), `${data.stats.coveragePercent}%`]);

      this.showExportProgress(true, 50, t('export.creatingSheets'));

      // Sheet 2: All Assignments
      const assignmentsSheet = workbook.addWorksheet(t('export.assignments'));
      assignmentsSheet.columns = [
        { header: t('export.employee'), key: 'employee', width: 25 },
        { header: t('export.customer'), key: 'customer', width: 25 },
        { header: t('export.type'), key: 'type', width: 20 },
        { header: t('export.shift'), key: 'shift', width: 12 },
        { header: t('export.scope'), key: 'scope', width: 20 }
      ];

      // Style header
      const headerRow = assignmentsSheet.getRow(1);
      headerRow.font = { bold: true, color: { argb: headerText } };
      headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: headerBg } };
      headerRow.alignment = { horizontal: 'center' };

      // Add data rows
      let rowIndex = 2;
      [1, 2, 3].forEach(shift => {
        const shiftData = data.byShift.get(shift) || [];
        shiftData.forEach(item => {
          assignmentsSheet.addRow({
            employee: item.employee,
            customer: item.customer,
            type: item.type,
            shift: shift,
            scope: item.scope
          });
          if (rowIndex % 2 === 0) {
            assignmentsSheet.getRow(rowIndex).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: altRowBg } };
          }
          rowIndex++;
        });
      });

      this.showExportProgress(true, 70, t('export.creatingSheets'));

      // Sheet 3: By Shift
      const shiftNames = [t('schedule.morning'), t('schedule.afternoon'), t('schedule.night')];
      for (let shift = 1; shift <= 3; shift++) {
        const shiftSheet = workbook.addWorksheet(`${t('export.shift')} ${shift} - ${shiftNames[shift - 1]}`);
        shiftSheet.columns = [
          { header: t('export.employee'), key: 'employee', width: 25 },
          { header: t('export.customer'), key: 'customer', width: 25 },
          { header: t('export.type'), key: 'type', width: 20 },
          { header: t('export.scope'), key: 'scope', width: 20 }
        ];

        const shiftHeaderRow = shiftSheet.getRow(1);
        shiftHeaderRow.font = { bold: true, color: { argb: headerText } };
        shiftHeaderRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: tealBg } };

        const shiftData = data.byShift.get(shift) || [];
        shiftData.forEach((item, idx) => {
          shiftSheet.addRow({
            employee: item.employee,
            customer: item.customer,
            type: item.type,
            scope: item.scope
          });
          if (idx % 2 === 1) {
            shiftSheet.getRow(idx + 2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: altRowBg } };
          }
        });
      }

      this.showExportProgress(true, 90, t('export.savingFile'));

      // Generate and download
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `grafik_${data.weekKey}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);

      this.showExportProgress(false, 100);
      this.showToast(t('export.excelExported'), 'success');

    } catch (error) {
      console.error('Schedule Excel export error:', error);
      this.showExportProgress(false, 0);
      this.showToast(i18n.t('export.exportError'), 'error');
    }
  }

  private renderScheduleWeekNav(): void {
    const weekLabel = document.getElementById('scheduleWeekLabel');
    const weekDates = document.getElementById('scheduleWeekDates');
    const weekYear = document.getElementById('scheduleWeekYear');
    
    if (weekLabel) {
      weekLabel.textContent = `KW${this.scheduleCurrentWeek.toString().padStart(2, '0')}`;
    }
    
    if (weekYear) {
      weekYear.textContent = this.scheduleCurrentYear.toString();
    }
    
    if (weekDates) {
      const dates = this.getWeekDateRange(this.scheduleCurrentYear, this.scheduleCurrentWeek);
      weekDates.textContent = `${dates.start.slice(0, 5)} – ${dates.end.slice(0, 5)}`;
    }
    
    // Aktualizuj pasek pokrycia
    this.updateCoverageBar();
  }
  
  private updateCoverageBar(): void {
    const fill = document.getElementById('scheduleCoverageFill');
    const text = document.getElementById('scheduleCoverageText');
    if (!fill || !text) return;
    
    const weekKey = `${this.scheduleCurrentYear}-KW${this.scheduleCurrentWeek.toString().padStart(2, '0')}`;
    
    // Policz dostępnych pracowników
    const availableEmployees = this.state.employees.filter(e => !e.status || e.status === 'available');
    const total = availableEmployees.length;
    
    // Policz przypisanych
    const weekAssignments = this.state.scheduleAssignments.filter((a: ScheduleAssignment) => a.week === weekKey);
    const assignedIds = new Set(weekAssignments.map((a: ScheduleAssignment) => a.employeeId));
    const assignedCount = availableEmployees.filter(e => assignedIds.has(e.id)).length;
    
    // Procent pokrycia
    const percent = total > 0 ? Math.round((assignedCount / total) * 100) : 0;
    
    fill.style.width = `${percent}%`;
    fill.className = 'sched-coverage-fill ' + (percent < 50 ? 'low' : percent < 80 ? 'medium' : 'high');
    text.textContent = `${assignedCount}/${total}`;
  }
  
  private getWeekDateRange(year: number, week: number): { start: string; end: string } {
    const jan4 = new Date(year, 0, 4);
    const dayOfWeek = jan4.getDay() || 7;
    const startDate = new Date(jan4);
    startDate.setDate(jan4.getDate() - dayOfWeek + 1 + (week - 1) * 7);
    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 6);
    
    const format = (d: Date) => `${d.getDate().toString().padStart(2, '0')}.${(d.getMonth() + 1).toString().padStart(2, '0')}.${d.getFullYear()}`;
    return { start: format(startDate), end: format(endDate) };
  }
  
  // ==================== Schedule Alerts & Suggestions ====================
  
  private renderScheduleAlerts(): void {
    const container = document.getElementById('scheduleAlerts');
    if (!container) return;
    
    const weekKey = `${this.scheduleCurrentYear}-KW${this.scheduleCurrentWeek.toString().padStart(2, '0')}`;
    const alerts: Array<{ type: 'warning' | 'info' | 'success' | 'suggestion'; icon: string; message: string; action?: string }> = [];
    
    // Get projects with SOLL in this week
    const weekProjects = this.state.projects.filter(p => {
      const weekData = p.weeks[weekKey];
      return weekData && weekData.soll > 0 && !p.hidden;
    });
    
    // Get all assignments for this week
    const weekAssignments = this.state.scheduleAssignments.filter((a: ScheduleAssignment) => a.week === weekKey);
    
    // Check for unassigned employees
    const assignedEmployeeIds = new Set(weekAssignments.map((a: ScheduleAssignment) => a.employeeId));
    const unassignedEmployees = this.state.employees.filter(e => !assignedEmployeeIds.has(e.id));
    
    if (unassignedEmployees.length > 0) {
      alerts.push({
        type: 'warning',
        icon: '👤',
        message: i18n.t('schedule.unassignedEmployeesWarn').replace('{0}', String(unassignedEmployees.length)).replace('{1}', unassignedEmployees.map(e => e.firstName).join(', ')),
        action: 'assign'
      });
    }
    
    // Check for unassigned projects (projects with no assignments at all)
    const assignedProjectIds = new Set(weekAssignments.map((a: ScheduleAssignment) => a.projectId));
    const projectGroups = new Map<string, { name: string; hasAssignment: boolean }>();
    
    weekProjects.forEach(p => {
      const customer = this.state.customers.find(c => c.id === p.customer_id);
      const type = this.state.types.find(t => t.id === p.type_id);
      const groupKey = `${p.customer_id}-${p.type_id}`;
      
      if (!projectGroups.has(groupKey)) {
        const hasAssignment = assignedProjectIds.has(groupKey) || 
          weekProjects.filter(proj => proj.customer_id === p.customer_id && proj.type_id === p.type_id)
            .some(proj => assignedProjectIds.has(proj.id));
        
        projectGroups.set(groupKey, {
          name: `${customer?.name || '?'} – ${type?.name || '?'}`,
          hasAssignment
        });
      }
    });
    
    const unassignedProjects = Array.from(projectGroups.entries())
      .filter(([_, data]) => !data.hasAssignment)
      .map(([_, data]) => data.name);
    
    if (unassignedProjects.length > 0) {
      alerts.push({
        type: 'warning',
        icon: '📋',
        message: i18n.t('schedule.unassignedProjectsWarn').replace('{0}', String(unassignedProjects.length)).replace('{1}', unassignedProjects.slice(0, 3).join(', ') + (unassignedProjects.length > 3 ? '...' : ''))
      });
    }
    
    // Sprawdź nieobsadzone procesy (testy/części)
    const processWarnings: string[] = [];
    
    weekProjects.forEach(p => {
      const customer = this.state.customers.find(c => c.id === p.customer_id);
      const groupKey = `${p.customer_id}-${p.type_id}`;
      
      // Pobierz przypisania dla tego projektu
      const projectAssignments = weekAssignments.filter((a: ScheduleAssignment) => 
        a.projectId === p.id || a.projectId === groupKey
      );
      
      // Sprawdź czy są przypisania z zakresem przyczepność
      const hasAdhesion = projectAssignments.some((a: ScheduleAssignment) => a.scope === 'adhesion');
      const hasAudit = projectAssignments.some((a: ScheduleAssignment) => a.scope === 'audit');
      
      // Jeśli projekt wymaga przyczepności a jej nie ma
      const type = this.state.types.find(t => t.id === p.type_id);
      if (type?.name?.toLowerCase().includes('przyczepm') || type?.name?.toLowerCase().includes('adhesion')) {
        if (!hasAdhesion) {
          processWarnings.push(i18n.t('schedule.adhesionMissing').replace('{0}', customer?.name || '?'));
        }
      }
      
      // Jeśli brak jakichkolwiek przypisań
      if (projectAssignments.length === 0) {
        // Już obsługiwane w unassignedProjects
      }
    });
    
    if (processWarnings.length > 0) {
      alerts.push({
        type: 'warning',
        icon: '⚠️',
        message: i18n.t('schedule.uncoveredProcesses').replace('{0}', processWarnings.slice(0, 2).join(', ') + (processWarnings.length > 2 ? ` (${i18n.t('schedule.moreItems').replace('{0}', String(processWarnings.length - 2))})` : ''))
      });
    }

    // Shift rotation suggestions
    const prevWeekKey = this.getPreviousWeekKey(weekKey);
    const prevAssignments = this.state.scheduleAssignments.filter((a: ScheduleAssignment) => a.week === prevWeekKey);
    
    const rotationSuggestions: string[] = [];
    this.state.employees.forEach(emp => {
      const prevShifts = prevAssignments.filter((a: ScheduleAssignment) => a.employeeId === emp.id);
      const currentShifts = weekAssignments.filter((a: ScheduleAssignment) => a.employeeId === emp.id);
      
      if (prevShifts.length > 0 && currentShifts.length > 0) {
        const prevMainShift = this.getMostCommonShift(prevShifts);
        const currentMainShift = this.getMostCommonShift(currentShifts);
        
        if (prevMainShift === currentMainShift) {
          const suggestedShift = prevMainShift === 1 ? 2 : 1;
          rotationSuggestions.push(i18n.t('schedule.rotationHint').replace('{0}', emp.firstName).replace('{1}', String(prevMainShift)).replace('{2}', String(suggestedShift)));
        }
      }
    });
    
    if (rotationSuggestions.length > 0) {
      alerts.push({
        type: 'suggestion',
        icon: '🔄',
        message: i18n.t('schedule.rotationAlert').replace('{0}', rotationSuggestions.slice(0, 2).join(', ') + (rotationSuggestions.length > 2 ? '...' : ''))
      });
    }
    
    // Success message if all good
    if (alerts.length === 0 && weekProjects.length > 0) {
      alerts.push({
        type: 'success',
        icon: '✓',
        message: i18n.t('schedule.allProjectsAssigned')
      });
    }
    
    // Render alerts with new classes
    if (alerts.length === 0) {
      container.innerHTML = '';
      container.style.display = 'none';
      return;
    }
    
    container.style.display = 'flex';
    container.innerHTML = alerts.map(alert => `
      <div class="sched-alert sched-alert-${alert.type}">
        <span class="sched-alert-icon">${alert.icon}</span>
        <span class="sched-alert-text">${alert.message}</span>
        ${alert.action ? `<button class="sched-alert-action" data-action="${alert.action}">${i18n.t('schedule.assign')}</button>` : ''}
      </div>
    `).join('');
    
    // Dodaj konflikty urlopowe
    this.renderVacationConflicts();
  }
  
  private getPreviousWeekKey(weekKey: string): string {
    const [year, weekPart] = weekKey.split('-KW');
    let prevWeek = parseInt(weekPart) - 1;
    let prevYear = parseInt(year);
    
    if (prevWeek < 1) {
      prevWeek = 52;
      prevYear--;
    }
    
    return `${prevYear}-KW${prevWeek.toString().padStart(2, '0')}`;
  }
  
  private getMostCommonShift(assignments: ScheduleAssignment[]): number {
    const shiftCounts = { 1: 0, 2: 0, 3: 0 };
    assignments.forEach(a => shiftCounts[a.shift]++);
    return Object.entries(shiftCounts).sort((a, b) => b[1] - a[1])[0][0] as unknown as number;
  }
  
  // ==================== Multi-Week View ====================
  
  private renderMultiWeekView(): void {
    const container = document.getElementById('scheduleProjectsList');
    if (!container) return;
    
    const weeks = [
      { week: this.scheduleCurrentWeek - 1 < 1 ? 52 : this.scheduleCurrentWeek - 1, year: this.scheduleCurrentWeek - 1 < 1 ? this.scheduleCurrentYear - 1 : this.scheduleCurrentYear, label: i18n.t('schedule.previousWeek') },
      { week: this.scheduleCurrentWeek, year: this.scheduleCurrentYear, label: i18n.t('schedule.currentWeekLabel') },
      { week: this.scheduleCurrentWeek + 1 > 52 ? 1 : this.scheduleCurrentWeek + 1, year: this.scheduleCurrentWeek + 1 > 52 ? this.scheduleCurrentYear + 1 : this.scheduleCurrentYear, label: i18n.t('schedule.nextWeek') }
    ];
    
    // Update header for multi-week
    const headerContainer = document.getElementById('scheduleShiftsHeader');
    if (headerContainer) {
      headerContainer.className = 'sched-table-header sched-multiweek';
      headerContainer.innerHTML = `
        <div class="sched-col-project">${i18n.t('schedule.project')}</div>
        ${weeks.map(w => `
          <div class="sched-col-week ${w.label === 'Obecny' ? 'current' : ''}">
            <span class="sched-week-num">KW${w.week.toString().padStart(2, '0')}</span>
            <span class="sched-week-label">${w.label}</span>
          </div>
        `).join('')}
      `;
    }
    
    // Get all projects with SOLL in any of the 3 weeks
    const allProjectGroups = new Map<string, { customerName: string; typeName: string; weekData: Map<string, number>; projectIds: string[] }>();
    
    weeks.forEach(({ week, year }) => {
      const weekKey = `${year}-KW${week.toString().padStart(2, '0')}`;
      
      this.state.projects.filter(p => !p.hidden).forEach(p => {
        const weekData = p.weeks[weekKey];
        if (weekData && weekData.soll > 0) {
          const customer = this.state.customers.find(c => c.id === p.customer_id);
          const type = this.state.types.find(t => t.id === p.type_id);
          const groupKey = `${p.customer_id}-${p.type_id}`;
          
          if (!allProjectGroups.has(groupKey)) {
            allProjectGroups.set(groupKey, {
              customerName: customer?.name || '?',
              typeName: type?.name || '?',
              weekData: new Map(),
              projectIds: []
            });
          }
          
          const group = allProjectGroups.get(groupKey)!;
          if (!group.projectIds.includes(p.id)) {
            group.projectIds.push(p.id);
          }
          const currentSoll = group.weekData.get(weekKey) || 0;
          group.weekData.set(weekKey, currentSoll + weekData.soll);
        }
      });
    });
    
    if (allProjectGroups.size === 0) {
      container.innerHTML = `
        <div class="sched-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="40" height="40">
            <rect x="3" y="4" width="18" height="18" rx="2"/>
            <line x1="3" y1="10" x2="21" y2="10"/>
          </svg>
          <span>${i18n.t('schedule.noProjectsInPeriod')}</span>
        </div>
      `;
      return;
    }
    
    container.innerHTML = Array.from(allProjectGroups.entries()).map(([groupKey, group]) => {
      return `
        <div class="sched-row sched-multiweek">
          <div class="sched-project-cell">
            <span class="sched-customer">${group.customerName}</span>
            <span class="sched-type">${group.typeName}</span>
          </div>
          ${weeks.map(({ week, year, label }) => {
            const weekKey = `${year}-KW${week.toString().padStart(2, '0')}`;
            const soll = group.weekData.get(weekKey) || 0;
            const assignments = this.state.scheduleAssignments.filter((a: ScheduleAssignment) => 
              group.projectIds.includes(a.projectId) && a.week === weekKey
            );
            
            const hasAssignment = assignments.length > 0;
            const status = soll === 0 ? 'empty' : hasAssignment ? 'assigned' : 'unassigned';
            
            return `
              <div class="sched-week-cell ${label === 'Obecny' ? 'current' : ''} ${status}">
                ${soll > 0 ? `
                  <span class="sched-soll">${soll}</span>
                  <div class="sched-mini-team">
                    ${assignments.slice(0, 4).map((a: ScheduleAssignment) => {
                      const emp = this.state.employees.find(e => e.id === a.employeeId);
                      return emp ? `<span class="sched-mini-avatar" style="background:${emp.color}" title="${emp.firstName} ${emp.lastName}">${emp.firstName.charAt(0)}</span>` : '';
                    }).join('')}
                    ${assignments.length > 4 ? `<span class="sched-mini-more">+${assignments.length - 4}</span>` : ''}
                  </div>
                ` : '<span class="sched-no-data">—</span>'}
              </div>
            `;
          }).join('')}
        </div>
      `;
    }).join('');
  }

  // ==================== History View (3 weeks back + selected) ====================

  private renderHistoryView(): void {
    const headerContainer = document.getElementById('scheduleShiftsHeader');
    const projectsContainer = document.getElementById('scheduleProjectsList');
    if (!headerContainer || !projectsContainer) return;

    const realCurrentWeek = this.getCurrentWeek();
    const realCurrentYear = new Date().getFullYear();

    // Build 4 weeks: selected - 3, selected - 2, selected - 1, selected
    const weeks: { week: number; year: number; label: string; weekKey: string; isRealCurrent: boolean; isSelected: boolean; weeksAgo: number }[] = [];
    for (let offset = 3; offset >= 0; offset--) {
      let w = this.scheduleCurrentWeek - offset;
      let y = this.scheduleCurrentYear;
      if (w < 1) { w += 52; y--; }
      const weekKey = `${y}-KW${w.toString().padStart(2, '0')}`;
      const isRealCurrent = (w === realCurrentWeek && y === realCurrentYear);
      const isSelected = (offset === 0);
      let label: string;
      if (isRealCurrent) {
        label = i18n.t('schedule.currentWeekCurrent');
      } else if (offset === 1) {
        label = i18n.t('schedule.oneWeekAgo');
      } else if (offset === 2) {
        label = i18n.t('schedule.twoWeeksAgo');
      } else if (offset === 3) {
        label = i18n.t('schedule.threeWeeksAgo');
      } else {
        label = `KW${w.toString().padStart(2, '0')}`;
      }
      weeks.push({ week: w, year: y, label, weekKey, isRealCurrent, isSelected, weeksAgo: offset });
    }

    // Header 
    headerContainer.className = 'sched-table-header sched-history';
    headerContainer.innerHTML = `
      <div class="sched-header-cell sched-project-col sortable ${this.scheduleSortMode !== 'default' ? 'sorted' : ''}" id="schedProjectColHeaderHistory">
        <span>${i18n.t('schedule.project')}</span>
      </div>
      ${weeks.map(w => `
        <div class="sched-header-cell sched-history-week-col ${w.isRealCurrent ? 'real-current' : ''} ${w.isSelected ? 'selected' : ''}" data-history-week="${w.week}" data-history-year="${w.year}">
          <span class="sched-history-week-kw">KW${w.week.toString().padStart(2, '0')}</span>
          <span class="sched-history-week-label">${w.label}</span>
        </div>
      `).join('')}
    `;

    // Sort header click
    document.getElementById('schedProjectColHeaderHistory')?.addEventListener('click', () => {
      if (this.scheduleSortMode === 'default') this.scheduleSortMode = 'alpha';
      else if (this.scheduleSortMode === 'alpha') this.scheduleSortMode = 'coverage';
      else this.scheduleSortMode = 'default';
      this.renderScheduleContent();
    });

    // Week header click - navigate to that week
    const realYear = new Date().getFullYear();
    headerContainer.querySelectorAll('.sched-history-week-col').forEach(col => {
      (col as HTMLElement).style.cursor = 'pointer';
      col.addEventListener('click', () => {
        const targetWeek = parseInt((col as HTMLElement).dataset.historyWeek || '1');
        const targetYear = parseInt((col as HTMLElement).dataset.historyYear || String(realYear));
        this.scheduleCurrentWeek = targetWeek;
        this.scheduleCurrentYear = targetYear;
        this.renderScheduleWeekNav();
        this.renderScheduleAlerts();
        this.renderScheduleContent();
        this.renderScheduleEmployeePanel();
      });
    });

    // Gather all project groups that have SOLL > 0 in any of the 4 weeks
    const allProjectGroups = new Map<string, {
      customerName: string;
      typeName: string;
      customerId: string;
      items: Project[];
    }>();

    weeks.forEach(({ weekKey }) => {
      this.state.projects.filter(p => !p.hidden).forEach(p => {
        const weekData = p.weeks[weekKey];
        if (weekData && weekData.soll > 0) {
          const customer = this.state.customers.find(c => c.id === p.customer_id);
          const type = this.state.types.find(t => t.id === p.type_id);
          const groupKey = `${p.customer_id}-${p.type_id}`;

          if (!allProjectGroups.has(groupKey)) {
            allProjectGroups.set(groupKey, {
              customerName: customer?.name || '?',
              typeName: type?.name || '?',
              customerId: p.customer_id,
              items: []
            });
          }
          const group = allProjectGroups.get(groupKey)!;
          if (!group.items.some(item => item.id === p.id)) {
            group.items.push(p);
          }
        }
      });
    });

    // Apply filters
    if (this.scheduleFilterProject) {
      for (const [key, group] of allProjectGroups) {
        if (group.customerId !== this.scheduleFilterProject) allProjectGroups.delete(key);
      }
    }
    if (this.scheduleFilterEmployee) {
      const empWeekKeys = new Set<string>();
      weeks.forEach(w => {
        this.state.scheduleAssignments.filter((a: ScheduleAssignment) =>
          a.employeeId === this.scheduleFilterEmployee && a.week === w.weekKey
        ).forEach((a: ScheduleAssignment) => {
          empWeekKeys.add(a.projectId);
          // Also match groupKeys
          const project = this.state.projects.find(p => p.id === a.projectId);
          if (project) empWeekKeys.add(`${project.customer_id}-${project.type_id}`);
        });
      });
      for (const [key] of allProjectGroups) {
        if (!empWeekKeys.has(key)) allProjectGroups.delete(key);
      }
    }

    if (allProjectGroups.size === 0) {
      projectsContainer.innerHTML = `
        <div class="sched-empty-table">
          <span class="sched-empty-icon">📋</span>
          <p>${i18n.t('schedule.noProjectsInPeriod')}</p>
        </div>
      `;
      return;
    }

    // Sort groups
    let sortedGroups = Array.from(allProjectGroups.entries());
    const selectedWeekKey = weeks[3].weekKey;

    if (this.scheduleSortMode === 'alpha') {
      sortedGroups.sort((a, b) => a[1].customerName.localeCompare(b[1].customerName));
    } else if (this.scheduleSortMode === 'coverage') {
      sortedGroups.sort((a, b) => {
        const aAss = this.state.scheduleAssignments.filter((ass: ScheduleAssignment) =>
          (ass.projectId === a[0] || a[1].items.some(item => item.id === ass.projectId)) && ass.week === selectedWeekKey
        ).length;
        const bAss = this.state.scheduleAssignments.filter((ass: ScheduleAssignment) =>
          (ass.projectId === b[0] || b[1].items.some(item => item.id === ass.projectId)) && ass.week === selectedWeekKey
        ).length;
        return aAss - bAss;
      });
    }

    // Pinned on top
    sortedGroups.sort((a, b) => {
      const aPinned = this.pinnedScheduleProjects.has(a[0]) ? 0 : 1;
      const bPinned = this.pinnedScheduleProjects.has(b[0]) ? 0 : 1;
      return aPinned - bPinned;
    });

    projectsContainer.innerHTML = '';

    sortedGroups.forEach(([groupKey, group]) => {
      const row = document.createElement('div');
      row.className = 'sched-row sched-history';
      row.dataset.groupKey = groupKey;

      // Project cell - staffing status based on selected week
      const isPinned = this.pinnedScheduleProjects?.has(groupKey) || false;
      const selectedAssignments = this.state.scheduleAssignments.filter((a: ScheduleAssignment) =>
        (a.projectId === groupKey || group.items.some(item => item.id === a.projectId)) && a.week === selectedWeekKey
      );
      const staffingStatus = this.getProjectStaffingStatus(groupKey, group.items, selectedAssignments);

      const projectCell = document.createElement('div');
      projectCell.className = `sched-project-cell sched-history-project ${staffingStatus.class}`;
      projectCell.innerHTML = `
        <div class="sched-project-info">
          <button class="sched-project-pin ${isPinned ? 'pinned' : ''}" data-group="${groupKey}" title="${isPinned ? 'Unpin' : 'Pin'}">
            <svg viewBox="0 0 24 24" fill="${isPinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>
          </button>
          <span class="sched-staffing-indicator ${staffingStatus.class}" title="${staffingStatus.tooltip}">
            ${staffingStatus.icon}
          </span>
          <div class="sched-project-text">
            <span class="sched-project-customer">${group.customerName}</span>
            <span class="sched-project-type">${group.typeName}</span>
          </div>
        </div>
      `;

      projectCell.querySelector('.sched-project-pin')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleScheduleProjectPin(groupKey);
      });

      row.appendChild(projectCell);

      // Week cells - ALL are interactive
      weeks.forEach(weekInfo => {
        const weekCell = document.createElement('div');
        weekCell.className = `sched-history-week-cell ${weekInfo.isRealCurrent ? 'real-current' : ''} ${weekInfo.isSelected ? 'selected' : ''}`;

        const weekAssignments = this.state.scheduleAssignments.filter((a: ScheduleAssignment) =>
          (a.projectId === groupKey || group.items.some(item => item.id === a.projectId)) &&
          a.week === weekInfo.weekKey
        );

        // SOLL total for this group in this week  
        let totalSoll = 0;
        group.items.forEach(p => {
          const wd = p.weeks[weekInfo.weekKey];
          if (wd) totalSoll += wd.soll;
        });

        // Get project comment
        const projectComment = this.getProjectComment(groupKey, weekInfo.weekKey);
        let mainComment = projectComment || '';
        let repliesCount = 0;
        if (mainComment.includes('---REPLIES---')) {
          const parts = mainComment.split('---REPLIES---');
          mainComment = parts[0].trim();
          try {
            const parsedReplies = JSON.parse(parts[1]);
            repliesCount = Array.isArray(parsedReplies) ? parsedReplies.length : 0;
          } catch (e) { repliesCount = 0; }
        }
        const hasComment = mainComment.length > 0 || repliesCount > 0;

        if (totalSoll === 0) {
          weekCell.innerHTML = `<span class="sched-history-nodata">${i18n.t('schedule.noDataForWeek')}</span>`;
        } else {
          // Build shift breakdown - each shift is an interactive droppable zone
          const shiftBreakdown: string[] = [];
          for (let s = 1; s <= this.scheduleShiftSystem; s++) {
            const shiftAss = weekAssignments.filter((a: ScheduleAssignment) => a.shift === s);
            shiftBreakdown.push(`
              <div class="sched-history-shift shift-${s}" data-shift="${s}" data-week-key="${weekInfo.weekKey}" data-group-key="${groupKey}">
                <span class="sched-history-shift-label">Z${s}</span>
                <div class="sched-history-chips">
                  ${shiftAss.slice(0, 6).map((a: ScheduleAssignment) => {
                    const emp = this.state.employees.find(e => e.id === a.employeeId);
                    if (!emp) return '';
                    const fullName = `${emp.firstName} ${emp.lastName}`;
                    const scopeClass = a.scope === 'audit' ? 'scope-audit' : a.scope === 'adhesion' ? 'scope-adhesion' : '';
                    return `<span class="sched-history-chip ${scopeClass}" style="--chip-color: ${emp.color}" title="${fullName}${a.scope !== 'project' ? ' (' + this.getScopeLabel(a.scope) + ')' : ''}" data-assignment-id="${a.id}">${fullName}</span>`;
                  }).join('')}
                  ${shiftAss.length > 6 ? `<span class="sched-history-more">+${shiftAss.length - 6}</span>` : ''}
                </div>
                <button class="sched-history-shift-add" title="+">+</button>
              </div>
            `);
          }

          const assignedCount = weekAssignments.length;
          const statusClass = assignedCount === 0 ? 'unassigned' : assignedCount >= totalSoll ? 'full' : 'partial';

          const commentPreview = mainComment.length > 25 ? mainComment.slice(0, 25) + '...' : mainComment;

          weekCell.innerHTML = `
            <div class="sched-history-cell-header">
              <span class="sched-history-soll">SOLL: ${totalSoll}</span>
              <span class="sched-history-status ${statusClass}">${assignedCount}/${totalSoll}</span>
            </div>
            <div class="sched-history-shifts">
              ${shiftBreakdown.join('')}
            </div>
            ${hasComment ? `
              <div class="sched-history-comment clickable" data-week-key="${weekInfo.weekKey}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                <span class="sched-history-comment-text" title="${mainComment.replace(/"/g, '&quot;')}">${commentPreview}</span>
                ${repliesCount > 0 ? `<span class="sched-history-replies-badge">${repliesCount}</span>` : ''}
              </div>
            ` : ''}
          `;

          // Comment click - edit for any week
          const commentEl = weekCell.querySelector('.sched-history-comment');
          if (commentEl) {
            commentEl.addEventListener('click', () => {
              this.showProjectCommentModal(groupKey, weekInfo.weekKey, projectComment);
            });
          }

          // Add comment button for cells without comments
          if (!hasComment) {
            const addCommentBtn = document.createElement('button');
            addCommentBtn.className = 'sched-history-add-comment';
            addCommentBtn.title = i18n.t('schedule.addComment');
            addCommentBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
            addCommentBtn.addEventListener('click', () => {
              this.showProjectCommentModal(groupKey, weekInfo.weekKey, undefined);
            });
            weekCell.appendChild(addCommentBtn);
          }

          // Shift interaction: click + button to assign, drag-drop support
          weekCell.querySelectorAll('.sched-history-shift').forEach(shiftEl => {
            const shift = parseInt((shiftEl as HTMLElement).dataset.shift || '1') as 1 | 2 | 3;
            const wKey = (shiftEl as HTMLElement).dataset.weekKey || '';
            const gKey = (shiftEl as HTMLElement).dataset.groupKey || '';

            // Click + button to open picker
            const addBtn = shiftEl.querySelector('.sched-history-shift-add');
            if (addBtn) {
              addBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showSimpleEmployeePicker(gKey, group.items, wKey, shift, shiftEl as HTMLElement);
              });
            }

            // Click on shift area to open picker (not on chip/add btn)
            shiftEl.addEventListener('click', (e) => {
              const target = e.target as HTMLElement;
              if (target.closest('.sched-history-chip') || target.closest('.sched-history-shift-add')) return;
              this.showSimpleEmployeePicker(gKey, group.items, wKey, shift, shiftEl as HTMLElement);
            });

            // Drag & drop
            (shiftEl as HTMLElement).addEventListener('dragover', (e) => {
              e.preventDefault();
              (shiftEl as HTMLElement).classList.add('drag-over');
            });
            (shiftEl as HTMLElement).addEventListener('dragleave', () => {
              (shiftEl as HTMLElement).classList.remove('drag-over');
            });
            (shiftEl as HTMLElement).addEventListener('drop', async (e) => {
              e.preventDefault();
              (shiftEl as HTMLElement).classList.remove('drag-over');
              const dropX = (e as DragEvent).clientX;
              const dropY = (e as DragEvent).clientY;

              const assignmentId = (e as DragEvent).dataTransfer?.getData('assignmentId');
              if (assignmentId) {
                const sourceProject = (e as DragEvent).dataTransfer?.getData('sourceProject');
                const sourceShift = parseInt((e as DragEvent).dataTransfer?.getData('sourceShift') || '0');
                if (sourceProject !== gKey) {
                  const assignment = this.state.scheduleAssignments.find((a: ScheduleAssignment) => a.id === assignmentId);
                  if (assignment) {
                    // Nie usuwaj od razu - przekaż do pickera, usunie po potwierdzeniu
                    this.showScopePickerAtPosition(gKey, group.items, assignment.employeeId, wKey, shift, dropX, dropY, assignmentId);
                  }
                  return;
                }
                if (sourceShift !== shift) {
                  await this.moveAssignmentToShift(assignmentId, shift);
                }
                return;
              }

              if (this.draggedEmployeeId) {
                this.showScopePickerAtPosition(gKey, group.items, this.draggedEmployeeId, wKey, shift, dropX, dropY);
              }
            });

            // Right-click on chip: open note modal
            shiftEl.querySelectorAll('.sched-history-chip').forEach(chip => {
              chip.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                const aid = (chip as HTMLElement).dataset.assignmentId;
                if (aid) this.showAssignmentNoteModal(aid);
              });
            });
          });
        }

        row.appendChild(weekCell);
      });

      projectsContainer.appendChild(row);
    });
  }
  
  // ==================== Year View ====================
  
  private renderYearView(): void {
    const container = document.getElementById('scheduleProjectsList');
    const headerContainer = document.getElementById('scheduleShiftsHeader');
    if (!container || !headerContainer) return;
    
    // Generate all weeks of the year
    const weeks = Array.from({ length: 52 }, (_, i) => i + 1);
    const currentWeek = this.getCurrentWeek();
    
    // Header with months
    headerContainer.className = 'grid-header year-view';
    headerContainer.innerHTML = `
      <div class="header-cell project-col">${i18n.t('schedule.project')}</div>
      <div class="header-cell months-row">
        ${[i18n.t('planning.monthJan'), i18n.t('planning.monthFeb'), i18n.t('planning.monthMar'), i18n.t('planning.monthApr'), i18n.t('planning.monthMay'), i18n.t('planning.monthJun'), i18n.t('planning.monthJul'), i18n.t('planning.monthAug'), i18n.t('planning.monthSep'), i18n.t('planning.monthOct'), i18n.t('planning.monthNov'), i18n.t('planning.monthDec')].map((m, i) => 
          `<span class="month-label" style="left: ${(i / 12) * 100}%">${m}</span>`
        ).join('')}
      </div>
    `;
    
    // Get all unique project groups for the year
    const projectGroups = new Map<string, { customerName: string; typeName: string }>();
    
    this.state.projects.filter(p => !p.hidden).forEach(p => {
      const customer = this.state.customers.find(c => c.id === p.customer_id);
      const type = this.state.types.find(t => t.id === p.type_id);
      const groupKey = `${p.customer_id}-${p.type_id}`;
      
      if (!projectGroups.has(groupKey)) {
        projectGroups.set(groupKey, {
          customerName: customer?.name || '?',
          typeName: type?.name || '?'
        });
      }
    });
    
    container.innerHTML = Array.from(projectGroups.entries()).map(([groupKey, group]) => {
      const weekCells = weeks.map(week => {
        const weekKey = `${this.scheduleCurrentYear}-KW${week.toString().padStart(2, '0')}`;
        
        // Check if any project in this group has SOLL
        const hasSoll = this.state.projects.some(p => {
          if (`${p.customer_id}-${p.type_id}` !== groupKey) return false;
          const weekData = p.weeks[weekKey];
          return weekData && weekData.soll > 0;
        });
        
        // Check if has assignments
        const hasAssignment = this.state.scheduleAssignments.some((a: ScheduleAssignment) => 
          a.week === weekKey && (a.projectId === groupKey || a.projectId.includes(groupKey.split('-')[0]))
        );
        
        const isCurrent = week === currentWeek;
        
        return `<div class="year-cell ${hasSoll ? 'has-soll' : ''} ${hasAssignment ? 'assigned' : ''} ${isCurrent ? 'current' : ''}" 
                     data-week="${week}" title="KW${week}${hasSoll ? i18n.t('schedule.hasSollTooltip') : ''}${hasAssignment ? i18n.t('schedule.coveredTooltip') : ''}"></div>`;
      }).join('');
      
      return `
        <div class="year-row">
          <div class="project-name-cell">
            <div class="project-title">${group.customerName}</div>
            <div class="project-subtitle">${group.typeName}</div>
          </div>
          <div class="weeks-strip">${weekCells}</div>
        </div>
      `;
    }).join('');
    
    // Add click handlers to go to specific week
    container.querySelectorAll('.year-cell').forEach(cell => {
      cell.addEventListener('click', () => {
        const week = parseInt((cell as HTMLElement).dataset.week || '1');
        this.scheduleCurrentWeek = week;
        this.scheduleViewMode = 'week';
        document.querySelectorAll('.view-mode-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('.view-mode-btn[data-mode="week"]')?.classList.add('active');
        this.renderScheduleWeekNav();
        this.renderScheduleAlerts();
        this.renderScheduleContent();
      });
    });
  }
  
  // ==================== Compact View ====================
  
  private renderCompactView(): void {
    const container = document.getElementById('scheduleProjectsList');
    const headerContainer = document.getElementById('scheduleShiftsHeader');
    if (!container || !headerContainer) return;
    
    const weekKey = `${this.scheduleCurrentYear}-KW${this.scheduleCurrentWeek.toString().padStart(2, '0')}`;
    
    // Compact header
    headerContainer.className = 'grid-header compact-view';
    let headerHtml = `<div class="header-cell project-col compact">${i18n.t('schedule.project')}</div>`;
    headerHtml += `<div class="header-cell compact">${i18n.t('schedule.partsLabel')}</div>`;
    headerHtml += '<div class="header-cell compact">SOLL</div>';
    for (let s = 1; s <= this.scheduleShiftSystem; s++) {
      headerHtml += `<div class="header-cell shift-col compact shift-${s}">Z${s}</div>`;
    }
    headerHtml += '<div class="header-cell compact">Status</div>';
    headerContainer.innerHTML = headerHtml;
    
    // Get projects grouped
    const projectGroups = new Map<string, {
      customerName: string;
      typeName: string;
      partsCount: number;
      totalSoll: number;
      assignments: ScheduleAssignment[];
    }>();
    
    this.state.projects.filter(p => {
      const weekData = p.weeks[weekKey];
      return weekData && weekData.soll > 0 && !p.hidden;
    }).forEach(p => {
      const customer = this.state.customers.find(c => c.id === p.customer_id);
      const type = this.state.types.find(t => t.id === p.type_id);
      const groupKey = `${p.customer_id}-${p.type_id}`;
      const weekData = p.weeks[weekKey] || { soll: 0 };
      
      if (!projectGroups.has(groupKey)) {
        projectGroups.set(groupKey, {
          customerName: customer?.name || '?',
          typeName: type?.name || '?',
          partsCount: 0,
          totalSoll: 0,
          assignments: []
        });
      }
      
      const group = projectGroups.get(groupKey)!;
      group.partsCount++;
      group.totalSoll += weekData.soll;
    });
    
    // Get assignments for each group
    projectGroups.forEach((group, groupKey) => {
      group.assignments = this.state.scheduleAssignments.filter((a: ScheduleAssignment) =>
        a.week === weekKey && (a.projectId === groupKey || a.projectId.includes(groupKey.split('-')[0]))
      );
    });
    
    if (projectGroups.size === 0) {
      container.innerHTML = `<div class="grid-empty"><h3>${i18n.t('schedule.noProjects')}</h3></div>`;
      return;
    }
    
    container.innerHTML = Array.from(projectGroups.entries()).map(([groupKey, group]) => {
      const shiftAssignments: { [key: number]: ScheduleAssignment[] } = { 1: [], 2: [], 3: [] };
      group.assignments.forEach((a: ScheduleAssignment) => {
        shiftAssignments[a.shift].push(a);
      });
      
      const totalAssigned = group.assignments.length;
      const status = totalAssigned === 0 ? 'unassigned' : totalAssigned >= group.partsCount ? 'full' : 'partial';
      const statusLabel = status === 'unassigned' ? i18n.t('schedule.statusMissing') : status === 'full' ? i18n.t('schedule.statusOk') : i18n.t('schedule.statusPartial');
      
      return `
        <div class="compact-row ${status}">
          <div class="compact-cell project">
            <strong>${group.customerName}</strong>
            <small>${group.typeName}</small>
          </div>
          <div class="compact-cell center">${group.partsCount}</div>
          <div class="compact-cell center soll">${group.totalSoll}</div>
          ${Array.from({ length: this.scheduleShiftSystem }, (_, i) => i + 1).map(s => {
            const assigns = shiftAssignments[s];
            return `
              <div class="compact-cell shift shift-${s}">
                ${assigns.map((a: ScheduleAssignment) => {
                  const emp = this.state.employees.find(e => e.id === a.employeeId);
                  if (!emp) return '';
                  const scopeIcon = a.scope === 'project' ? 'P' : a.scope === 'audit' ? 'A' : a.scope === 'adhesion' ? 'H' : 'S';
                  return `<span class="compact-chip" style="--c:${emp.color}" title="${emp.firstName} ${emp.lastName} - ${this.getScopeLabel(a.scope)}">${scopeIcon}</span>`;
                }).join('')}
              </div>
            `;
          }).join('')}
          <div class="compact-cell status ${status}">${statusLabel}</div>
        </div>
      `;
    }).join('');
  }
  
  private getScopeLabel(scope?: string): string {
    switch(scope) {
      case 'audit': return i18n.t('schedule.scopeAudit');
      case 'adhesion': return i18n.t('schedule.scopeAdhesion');
      case 'specific': return i18n.t('schedule.scopeSpecific');
      default: return i18n.t('schedule.scopeFullProject');
    }
  }
  
  // ==================== Auto-Assign Modal ====================
  
  private showAutoAssignModal(): void {
    const modal = document.getElementById('modal')!;
    const modalTitle = document.getElementById('modalTitle')!;
    const modalBody = document.getElementById('modalBody')!;
    
    const weekKey = `${this.scheduleCurrentYear}-KW${this.scheduleCurrentWeek.toString().padStart(2, '0')}`;
    
    // Get unassigned projects
    const weekProjects = this.state.projects.filter(p => {
      const weekData = p.weeks[weekKey];
      return weekData && weekData.soll > 0 && !p.hidden;
    });
    
    const weekAssignments = this.state.scheduleAssignments.filter((a: ScheduleAssignment) => a.week === weekKey);
    const assignedProjectIds = new Set(weekAssignments.map((a: ScheduleAssignment) => a.projectId));
    
    modalTitle.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18" style="display:inline;vertical-align:middle;margin-right:8px">
        <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/>
      </svg>
      ${i18n.t('schedule.autoPlanner')}
    `;

    // Count peel-off projects
    const peelOffCount = weekProjects.filter(p => {
      const test = this.state.tests.find(t => t.id === p.test_id);
      if (!test) return false;
      const name = test.name.toLowerCase();
      return name.includes('peel') || name.includes('adhesion') || name.includes('przyczep');
    }).length;
    
    // Count available employees (not absent)
    const availableEmpCount = this.state.employees.filter(e => {
      if (e.status && e.status !== 'available') return false;
      const absence = this.getEmployeeAbsenceInWeek(e.id, this.scheduleCurrentYear, this.scheduleCurrentWeek);
      return !absence;
    }).length;

    modalBody.innerHTML = `
      <div class="auto-assign-modal">
        <div class="info-box">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
          </svg>
          <span>${i18n.t('schedule.autoPlannerDesc')}</span>
        </div>
        
        <div class="auto-stats">
          <div class="stat">
            <span class="stat-value">${weekProjects.length}</span>
            <span class="stat-label">${i18n.t('schedule.autoPlannerProjects')}</span>
          </div>
          <div class="stat">
            <span class="stat-value">${availableEmpCount}</span>
            <span class="stat-label">${i18n.t('schedule.autoPlannerEmployees')}</span>
          </div>
          <div class="stat">
            <span class="stat-value">${weekProjects.length - assignedProjectIds.size}</span>
            <span class="stat-label">${i18n.t('schedule.autoPlannerUnassigned')}</span>
          </div>
          <div class="stat">
            <span class="stat-value">${peelOffCount}</span>
            <span class="stat-label">${i18n.t('schedule.autoPlannerPeelOff')}</span>
          </div>
        </div>
        
        <div class="form-group">
          <label class="form-label">${i18n.t('schedule.autoPlannerStrategy')}</label>
          <select id="autoStrategy" class="form-control">
            <option value="fair" selected>${i18n.t('schedule.strategyFair')}</option>
            <option value="fairPeelOff">${i18n.t('schedule.strategyFairPeelOff')}</option>
            <option value="rotate">${i18n.t('schedule.strategyRotation')}</option>
            <option value="balance">${i18n.t('schedule.strategyBalance')}</option>
            <option value="copy">${i18n.t('schedule.strategyCopy')}</option>
          </select>
          <div id="autoStrategyDesc" class="auto-strategy-desc" style="margin-top: 6px; font-size: 0.82rem; color: var(--text-muted); line-height: 1.4;">
            ${i18n.t('schedule.strategyFairDesc')}
          </div>
        </div>
        
        <div class="form-group" id="autoScopeGroup">
          <label class="form-label">${i18n.t('schedule.autoPlannerDefaultScope')}</label>
          <select id="autoScope" class="form-control">
            <option value="project">${i18n.t('schedule.wholeProjectLabel')}</option>
            ${(() => {
              const weekTestIds = new Set(weekProjects.map(p => p.test_id).filter(Boolean));
              return this.state.tests
                .filter(t => weekTestIds.has(t.id))
                .map(t => `<option value="test-${t.id}">🧪 ${t.name}</option>`)
                .join('');
            })()}
          </select>
        </div>
      </div>
    `;
    
    // Dynamic description update based on strategy selection
    const strategySelect = document.getElementById('autoStrategy') as HTMLSelectElement;
    const strategyDesc = document.getElementById('autoStrategyDesc');
    const scopeGroup = document.getElementById('autoScopeGroup');
    
    const strategyDescriptions: Record<string, string> = {
      'fair': i18n.t('schedule.strategyFairDesc'),
      'fairPeelOff': i18n.t('schedule.strategyFairPeelOffDesc'),
      'rotate': i18n.t('schedule.strategyRotationDesc'),
      'balance': i18n.t('schedule.strategyBalanceDesc'),
      'copy': i18n.t('schedule.strategyCopyDesc')
    };
    
    strategySelect?.addEventListener('change', () => {
      if (strategyDesc) {
        strategyDesc.textContent = strategyDescriptions[strategySelect.value] || '';
      }
      // Hide scope selector for peel-off strategy (scope is always 'adhesion')
      if (scopeGroup) {
        scopeGroup.style.display = strategySelect.value === 'fairPeelOff' ? 'none' : '';
      }
    });
    
    const confirmBtn = modal.querySelector('.modal-confirm') as HTMLButtonElement;
    confirmBtn.style.display = '';
    confirmBtn.textContent = i18n.t('schedule.autoPlannerRun');
    confirmBtn.onclick = async () => {
      const strategy = (document.getElementById('autoStrategy') as HTMLSelectElement).value;
      const scopeVal = (document.getElementById('autoScope') as HTMLSelectElement).value;
      const scopeTestId = scopeVal.startsWith('test-') ? scopeVal.replace('test-', '') : undefined;
      const scope: 'project' | 'audit' | 'adhesion' | 'specific' = scopeTestId ? 'specific' : (scopeVal as any);
      
      if (strategy === 'fair') {
        await this.runFairAutoAssign(scope, scopeTestId);
      } else if (strategy === 'fairPeelOff') {
        await this.runFairPeelOffAssign();
      } else {
        await this.runAutoAssign(strategy, scope, scopeTestId);
      }
      this.hideModal();
    };
    
    modal.classList.add('active');
  }
  
  private async runAutoAssign(strategy: string, defaultScope: 'project' | 'audit' | 'adhesion' | 'specific', scopeTestId?: string): Promise<void> {
    const weekKey = `${this.scheduleCurrentYear}-KW${this.scheduleCurrentWeek.toString().padStart(2, '0')}`;
    
    if (strategy === 'copy') {
      await this.copyFromPreviousWeek();
      return;
    }
    
    // Get unassigned project groups
    const weekProjects = this.state.projects.filter(p => {
      const weekData = p.weeks[weekKey];
      return weekData && weekData.soll > 0 && !p.hidden;
    });
    
    const projectGroups = new Map<string, string[]>();
    weekProjects.forEach(p => {
      const groupKey = `${p.customer_id}-${p.type_id}`;
      if (!projectGroups.has(groupKey)) {
        projectGroups.set(groupKey, []);
      }
      projectGroups.get(groupKey)!.push(p.id);
    });
    
    const weekAssignments = this.state.scheduleAssignments.filter((a: ScheduleAssignment) => a.week === weekKey);
    const assignedGroupIds = new Set<string>();
    weekAssignments.forEach((a: ScheduleAssignment) => {
      if (scopeTestId) {
        // Only block if this exact test is already assigned to the group
        if (a.scope === 'specific' && a.testId === scopeTestId) {
          assignedGroupIds.add(a.projectId);
        }
      } else {
        assignedGroupIds.add(a.projectId);
      }
    });
    
    let unassignedGroups = Array.from(projectGroups.keys()).filter(g => !assignedGroupIds.has(g));
    
    // When assigning specific test, only include groups that actually have that test
    if (scopeTestId) {
      unassignedGroups = unassignedGroups.filter(g => {
        const itemIds = projectGroups.get(g)!;
        return itemIds.some(id => {
          const proj = weekProjects.find(p => p.id === id);
          return proj && proj.test_id === scopeTestId;
        });
      });
    }
    
    if (unassignedGroups.length === 0 || this.state.employees.length === 0) {
      this.showToast(i18n.t('schedule.allCoveredOrNoEmp'), 'warning');
      return;
    }
    
    // Assign employees to unassigned projects
    let employeeIndex = 0;
    let shift = 1;
    
    for (const groupKey of unassignedGroups) {
      const employee = this.state.employees[employeeIndex % this.state.employees.length];
      
      if (strategy === 'rotate') {
        // Get previous week's shift for this employee, respecting shiftSystem
        const empMax = employee.shiftSystem || 2;
        const prevWeekKey = this.getPreviousWeekKey(weekKey);
        const prevAssignment = this.state.scheduleAssignments.find((a: ScheduleAssignment) => 
          a.employeeId === employee.id && a.week === prevWeekKey
        );
        
        if (prevAssignment) {
          const nextShift = (prevAssignment.shift % Math.min(this.scheduleShiftSystem, empMax)) + 1;
          shift = nextShift;
        }
      }
      
      await this.addAssignmentWithScope(
        groupKey,
        scopeTestId,
        undefined,
        employee.id,
        weekKey,
        shift as 1 | 2 | 3,
        defaultScope
      );
      
      employeeIndex++;
      if (strategy === 'balance') {
        shift = (shift % this.scheduleShiftSystem) + 1;
      }
    }
    
    this.showToast(i18n.t('schedule.assignedNProjects').replace('{0}', String(unassignedGroups.length)), 'success');
    this.renderScheduleAlerts();
    this.renderScheduleContent();
  }
  
  // ==================== Fair Auto-Assignment Algorithm ====================
  
  private async runFairAutoAssign(defaultScope: 'project' | 'audit' | 'adhesion' | 'specific', scopeTestId?: string): Promise<void> {
    const weekKey = `${this.scheduleCurrentYear}-KW${this.scheduleCurrentWeek.toString().padStart(2, '0')}`;
    
    // 1. Get projects with SOLL > 0 this week
    const weekProjects = this.state.projects.filter(p => {
      const weekData = p.weeks[weekKey];
      return weekData && weekData.soll > 0 && !p.hidden;
    });
    
    // 2. Build project groups (customer-type)
    const projectGroups = new Map<string, { customerId: string; typeId: string; items: Project[] }>();
    weekProjects.forEach(p => {
      const groupKey = `${p.customer_id}-${p.type_id}`;
      if (!projectGroups.has(groupKey)) {
        projectGroups.set(groupKey, { customerId: p.customer_id, typeId: p.type_id, items: [] });
      }
      projectGroups.get(groupKey)!.items.push(p);
    });
    
    // 3. Find already assigned groups this week
    const weekAssignments = this.state.scheduleAssignments.filter((a: ScheduleAssignment) => a.week === weekKey);
    const assignedGroupIds = new Set<string>();
    weekAssignments.forEach((a: ScheduleAssignment) => {
      if (scopeTestId) {
        // Only block if this exact test is already assigned to the group
        if (a.scope === 'specific' && a.testId === scopeTestId) {
          assignedGroupIds.add(a.projectId);
        }
      } else {
        assignedGroupIds.add(a.projectId);
      }
    });
    
    let unassignedGroups = Array.from(projectGroups.keys()).filter(g => !assignedGroupIds.has(g));
    
    // When assigning specific test, only include groups that actually have that test
    if (scopeTestId) {
      unassignedGroups = unassignedGroups.filter(g => {
        const group = projectGroups.get(g)!;
        return group.items.some(p => p.test_id === scopeTestId);
      });
    }
    
    // 4. Get available employees (not absent, available status)
    const availableEmployees = this.state.employees.filter(e => {
      if (e.status && e.status !== 'available') return false;
      const absence = this.getEmployeeAbsenceInWeek(e.id, this.scheduleCurrentYear, this.scheduleCurrentWeek);
      return !absence;
    });
    
    if (unassignedGroups.length === 0 || availableEmployees.length === 0) {
      this.showToast(i18n.t('schedule.allCoveredOrNoEmp'), 'warning');
      return;
    }
    
    // 5. Build historical assignment counts per employee per project group
    const allAssignments = this.state.scheduleAssignments;
    const empProjectHistory = new Map<string, Map<string, number>>(); // empId -> (groupKey -> count)
    const empTotalAssignments = new Map<string, number>(); // empId -> total count this week
    const empConsecutive = new Map<string, Map<string, number>>(); // empId -> (groupKey -> consecutive weeks)
    
    availableEmployees.forEach(e => {
      empProjectHistory.set(e.id, new Map());
      empTotalAssignments.set(e.id, 0);
      empConsecutive.set(e.id, new Map());
    });
    
    // Count historical assignments per employee per project group
    allAssignments.forEach((a: ScheduleAssignment) => {
      const histMap = empProjectHistory.get(a.employeeId);
      if (histMap) {
        histMap.set(a.projectId, (histMap.get(a.projectId) || 0) + 1);
      }
    });
    
    // Count current week assignments
    weekAssignments.forEach((a: ScheduleAssignment) => {
      if (empTotalAssignments.has(a.employeeId)) {
        empTotalAssignments.set(a.employeeId, (empTotalAssignments.get(a.employeeId) || 0) + 1);
      }
    });
    
    // Calculate consecutive weeks per employee per project (check last N weeks)
    const maxConsecutiveCheck = 8;
    availableEmployees.forEach(emp => {
      const consecutiveMap = empConsecutive.get(emp.id)!;
      
      unassignedGroups.forEach(groupKey => {
        let consecutive = 0;
        let checkWeekKey = weekKey;
        
        for (let w = 0; w < maxConsecutiveCheck; w++) {
          checkWeekKey = this.getPreviousWeekKey(checkWeekKey);
          const wasAssigned = allAssignments.some((a: ScheduleAssignment) => 
            a.employeeId === emp.id && 
            a.projectId === groupKey && 
            a.week === checkWeekKey
          );
          if (wasAssigned) {
            consecutive++;
          } else {
            break;
          }
        }
        
        consecutiveMap.set(groupKey, consecutive);
      });
    });
    
    // 6. Fair assignment algorithm
    // For each unassigned project group, find the best employee:
    // - Prefer employees with FEWER total assignments this week (balance workload)
    // - Among those, prefer employee with FEWER historical assignments to this specific project
    // - Penalize employees with many consecutive weeks on the same project (encourage rotation)
    
    let assignedCount = 0;
    
    // Determine shift assignment strategy: balance across shifts
    const shiftCounts: Record<number, number> = {};
    for (let s = 1; s <= this.scheduleShiftSystem; s++) {
      shiftCounts[s] = weekAssignments.filter((a: ScheduleAssignment) => a.shift === s).length;
    }
    
    for (const groupKey of unassignedGroups) {
      // Score each available employee (lower = better)
      const scored = availableEmployees.map(emp => {
        const totalThisWeek = empTotalAssignments.get(emp.id) || 0;
        const historyOnProject = empProjectHistory.get(emp.id)?.get(groupKey) || 0;
        const consecutive = empConsecutive.get(emp.id)?.get(groupKey) || 0;
        
        // Score formula:
        // - Primary: total assignments this week (balance workload) x 100
        // - Secondary: historical assignments to this project x 10
        // - Tertiary: consecutive weeks penalty x 5
        // Lower score = better candidate
        const score = (totalThisWeek * 100) + (historyOnProject * 10) + (consecutive * 5);
        
        return { employee: emp, score, totalThisWeek };
      });
      
      // Sort by score (ascending = fairest first)
      scored.sort((a, b) => {
        if (a.score !== b.score) return a.score - b.score;
        // Tie-break: random
        return Math.random() - 0.5;
      });
      
      const bestEmployee = scored[0].employee;
      
      // Determine best shift (least loaded), respecting employee's shiftSystem
      const empMaxShift = bestEmployee.shiftSystem || 2;
      let bestShift = 1;
      let minShiftCount = Infinity;
      for (let s = 1; s <= Math.min(this.scheduleShiftSystem, empMaxShift); s++) {
        if ((shiftCounts[s] || 0) < minShiftCount) {
          minShiftCount = shiftCounts[s] || 0;
          bestShift = s;
        }
      }
      
      // Check employee's suggested shift preference (must be within their shiftSystem)
      if (bestEmployee.suggestedShift && bestEmployee.suggestedShift <= Math.min(this.scheduleShiftSystem, empMaxShift)) {
        bestShift = bestEmployee.suggestedShift;
      }
      
      await this.addScopedAssignment(
        groupKey,
        bestEmployee.id,
        weekKey,
        bestShift as 1 | 2 | 3,
        defaultScope,
        scopeTestId
      );
      
      // Update counters
      empTotalAssignments.set(bestEmployee.id, (empTotalAssignments.get(bestEmployee.id) || 0) + 1);
      const histMap = empProjectHistory.get(bestEmployee.id)!;
      histMap.set(groupKey, (histMap.get(groupKey) || 0) + 1);
      shiftCounts[bestShift] = (shiftCounts[bestShift] || 0) + 1;
      
      assignedCount++;
    }
    
    // ==================== SECOND PASS: Ensure everyone gets an assignment ====================
    // Find available employees who still have no assignment this week
    const allWeekAssignmentsAfter = this.state.scheduleAssignments.filter((a: ScheduleAssignment) => a.week === weekKey);
    const assignedEmpIdsAfter = new Set(allWeekAssignmentsAfter.map((a: ScheduleAssignment) => a.employeeId));
    
    const stillUnassigned = availableEmployees.filter(emp => !assignedEmpIdsAfter.has(emp.id));
    
    if (stillUnassigned.length > 0 && projectGroups.size > 0) {
      // Calculate workload (in minutes) per project group
      const groupWorkloadMinutes = new Map<string, number>();
      
      allWeekAssignmentsAfter.forEach((a: ScheduleAssignment) => {
        const gKey = a.projectId;
        if (!projectGroups.has(gKey)) return; // skip extra tasks etc.
        const empCount = allWeekAssignmentsAfter.filter(x => x.projectId === gKey).length;
        // We'll compute total project minutes and divide by employees on it
      });
      
      // For each project group: total minutes / number of assigned employees
      projectGroups.forEach((group, gKey) => {
        let totalMinutes = 0;
        group.items.forEach(p => {
          const wd = p.weeks?.[weekKey];
          if (wd && wd.soll > 0) {
            totalMinutes += wd.soll * (p.timePerUnit || 0);
          }
        });
        const empCount = allWeekAssignmentsAfter.filter(x => x.projectId === gKey).length;
        // Workload per person on this project (higher = more overloaded = needs help)
        groupWorkloadMinutes.set(gKey, empCount > 0 ? totalMinutes / empCount : totalMinutes);
      });
      
      // Sort groups by per-person workload descending (most loaded first = needs help most)
      const sortedGroups = Array.from(groupWorkloadMinutes.entries())
        .sort((a, b) => b[1] - a[1]);
      
      let groupIndex = 0;
      for (const unassignedEmp of stillUnassigned) {
        if (sortedGroups.length === 0) break;
        
        // Pick the most loaded group
        const [groupKey] = sortedGroups[groupIndex % sortedGroups.length];
        
        // Determine shift: use existing assignments' shift for this group, or balance
        // Respect employee's shiftSystem
        const empMax = unassignedEmp.shiftSystem || 2;
        const groupAssigns = allWeekAssignmentsAfter.filter(a => a.projectId === groupKey);
        let bestShift = 1;
        if (groupAssigns.length > 0) {
          // Use the most common shift for this group, but only if within employee's shiftSystem
          const shiftMap: Record<number, number> = {};
          groupAssigns.forEach(a => shiftMap[a.shift] = (shiftMap[a.shift] || 0) + 1);
          const sortedShifts = Object.entries(shiftMap).sort((a, b) => b[1] - a[1]);
          // Pick the most common shift that is within employee's shiftSystem
          for (const [shiftStr] of sortedShifts) {
            const s = parseInt(shiftStr);
            if (s <= empMax) {
              bestShift = s;
              break;
            }
          }
        } else {
          // Find least loaded shift within employee's shiftSystem
          let minCount = Infinity;
          for (let s = 1; s <= Math.min(this.scheduleShiftSystem, empMax); s++) {
            if ((shiftCounts[s] || 0) < minCount) {
              minCount = shiftCounts[s] || 0;
              bestShift = s;
            }
          }
        }
        
        await this.addScopedAssignment(
          groupKey,
          unassignedEmp.id,
          weekKey,
          bestShift as 1 | 2 | 3,
          defaultScope,
          scopeTestId
        );
        
        empTotalAssignments.set(unassignedEmp.id, (empTotalAssignments.get(unassignedEmp.id) || 0) + 1);
        shiftCounts[bestShift] = (shiftCounts[bestShift] || 0) + 1;
        
        // Recalculate per-person workload for the group we just assigned to
        const newEmpCount = allWeekAssignmentsAfter.filter(x => x.projectId === groupKey).length + 1;
        const group = projectGroups.get(groupKey)!;
        let totalMins = 0;
        group.items.forEach(p => {
          const wd = p.weeks?.[weekKey];
          if (wd && wd.soll > 0) totalMins += wd.soll * (p.timePerUnit || 0);
        });
        // Update and re-sort
        sortedGroups[groupIndex % sortedGroups.length] = [groupKey, totalMins / newEmpCount];
        sortedGroups.sort((a, b) => b[1] - a[1]);
        
        assignedCount++;
        groupIndex++;
      }
    }
    
    this.showToast(
      i18n.t('schedule.fairAssignComplete').replace('{0}', String(assignedCount)),
      'success'
    );
    this.renderScheduleAlerts();
    this.renderScheduleContent();
    this.renderScheduleEmployeePanel();
  }
  
  // ==================== Fair Peel-Off Test Assignment ====================
  
  private async runFairPeelOffAssign(): Promise<void> {
    const weekKey = `${this.scheduleCurrentYear}-KW${this.scheduleCurrentWeek.toString().padStart(2, '0')}`;
    
    // 1. Find all peel-off test projects with SOLL > 0 this week
    const peelOffProjects = this.state.projects.filter(p => {
      const weekData = p.weeks[weekKey];
      if (!weekData || weekData.soll <= 0 || p.hidden) return false;
      
      const test = this.state.tests.find(t => t.id === p.test_id);
      if (!test) return false;
      
      const testName = test.name.toLowerCase();
      return testName.includes('peel') || testName.includes('adhesion') || testName.includes('przyczep');
    });
    
    if (peelOffProjects.length === 0) {
      this.showToast(i18n.t('schedule.noPeelOffProjects'), 'warning');
      return;
    }
    
    // 2. Group peel-off projects by customer-type (assign as projects, not parts)
    const peelOffGroups = new Map<string, { 
      customerId: string; 
      typeName: string; 
      customerName: string;
      items: Project[]; 
      totalWorkload: number;
    }>();
    
    peelOffProjects.forEach(p => {
      const groupKey = `${p.customer_id}-${p.type_id}`;
      const weekData = p.weeks[weekKey];
      const workload = (p.timePerUnit || 1) * (weekData?.soll || 0);
      
      if (!peelOffGroups.has(groupKey)) {
        const customer = this.state.customers.find(c => c.id === p.customer_id);
        const type = this.state.types.find(t => t.id === p.type_id);
        peelOffGroups.set(groupKey, {
          customerId: p.customer_id,
          typeName: type?.name || '?',
          customerName: customer?.name || '?',
          items: [],
          totalWorkload: 0
        });
      }
      
      const group = peelOffGroups.get(groupKey)!;
      group.items.push(p);
      group.totalWorkload += workload;
    });
    
    // 3. Check already assigned peel-off groups
    const weekAssignments = this.state.scheduleAssignments.filter((a: ScheduleAssignment) => a.week === weekKey);
    const alreadyAssignedPeelOff = new Set<string>();
    
    weekAssignments.forEach((a: ScheduleAssignment) => {
      if (a.scope === 'adhesion' || peelOffGroups.has(a.projectId)) {
        alreadyAssignedPeelOff.add(a.projectId);
      }
    });
    
    const unassignedPeelOffKeys = Array.from(peelOffGroups.keys()).filter(k => !alreadyAssignedPeelOff.has(k));
    
    if (unassignedPeelOffKeys.length === 0) {
      this.showToast(i18n.t('schedule.allPeelOffAssigned'), 'warning');
      return;
    }
    
    // 4. Get available employees
    const availableEmployees = this.state.employees.filter(e => {
      if (e.status && e.status !== 'available') return false;
      const absence = this.getEmployeeAbsenceInWeek(e.id, this.scheduleCurrentYear, this.scheduleCurrentWeek);
      return !absence;
    });
    
    if (availableEmployees.length === 0) {
      this.showToast(i18n.t('schedule.allCoveredOrNoEmp'), 'warning');
      return;
    }
    
    // 5. Calculate current workload per employee (from all peel-off assignments, historical)
    const empPeelOffWorkload = new Map<string, number>(); // empId -> total workload (minutes)
    const empPeelOffHistory = new Map<string, Map<string, number>>(); // empId -> (groupKey -> count)
    
    availableEmployees.forEach(e => {
      empPeelOffWorkload.set(e.id, 0);
      empPeelOffHistory.set(e.id, new Map());
    });
    
    // Historical peel-off assignments
    this.state.scheduleAssignments.forEach((a: ScheduleAssignment) => {
      if (!empPeelOffHistory.has(a.employeeId)) return;
      
      // Check if this assignment is for a peel-off project
      const isPeelOff = a.scope === 'adhesion' || peelOffGroups.has(a.projectId);
      if (!isPeelOff) return;
      
      const histMap = empPeelOffHistory.get(a.employeeId)!;
      histMap.set(a.projectId, (histMap.get(a.projectId) || 0) + 1);
    });
    
    // Current week peel-off workload
    weekAssignments.forEach((a: ScheduleAssignment) => {
      if (!empPeelOffWorkload.has(a.employeeId)) return;
      
      const group = peelOffGroups.get(a.projectId);
      if (group || a.scope === 'adhesion') {
        const workload = group ? group.totalWorkload : 0;
        empPeelOffWorkload.set(a.employeeId, (empPeelOffWorkload.get(a.employeeId) || 0) + workload);
      }
    });
    
    // 6. Sort unassigned peel-off groups by workload (heaviest first for better balancing)
    const sortedPeelOff = unassignedPeelOffKeys
      .map(key => ({ key, group: peelOffGroups.get(key)! }))
      .sort((a, b) => b.group.totalWorkload - a.group.totalWorkload);
    
    // 7. Assign each peel-off project to the best employee
    // PRIORITY: First assign employees who have NO assignments at all this week,
    // then fall back to those with least workload.
    let assignedCount = 0;
    
    // Determine shift: balance across shifts
    const shiftCounts: Record<number, number> = {};
    for (let s = 1; s <= this.scheduleShiftSystem; s++) {
      shiftCounts[s] = weekAssignments.filter((a: ScheduleAssignment) => a.shift === s).length;
    }
    
    // Track which employees are fully unassigned (no assignments at all this week)
    const empTotalThisWeek = new Map<string, number>();
    availableEmployees.forEach(e => empTotalThisWeek.set(e.id, 0));
    weekAssignments.forEach((a: ScheduleAssignment) => {
      if (empTotalThisWeek.has(a.employeeId)) {
        empTotalThisWeek.set(a.employeeId, (empTotalThisWeek.get(a.employeeId) || 0) + 1);
      }
    });
    
    for (const { key: groupKey, group } of sortedPeelOff) {
      // Score: lower = better
      // PRIORITY 1: Employees with ZERO assignments this week (completely free)
      // PRIORITY 2: Employees with least peel-off workload
      // PRIORITY 3: Employees with least total assignments
      const scored = availableEmployees.map(emp => {
        const currentWorkload = empPeelOffWorkload.get(emp.id) || 0;
        const historyOnProject = empPeelOffHistory.get(emp.id)?.get(groupKey) || 0;
        const totalThisWeek = empTotalThisWeek.get(emp.id) || 0;
        const isUnassigned = totalThisWeek === 0;
        
        // Unassigned employees get huge priority bonus (lower score)
        const unassignedBonus = isUnassigned ? 0 : 100000;
        const score = unassignedBonus + currentWorkload + (historyOnProject * 10) + (totalThisWeek * 50);
        
        return { employee: emp, score, currentWorkload };
      });
      
      scored.sort((a, b) => {
        if (a.score !== b.score) return a.score - b.score;
        return Math.random() - 0.5;
      });
      
      const bestEmployee = scored[0].employee;
      
      // Pick least loaded shift, respecting employee's shiftSystem
      const empMaxShift = bestEmployee.shiftSystem || 2;
      let bestShift = 1;
      let minShiftCount = Infinity;
      for (let s = 1; s <= Math.min(this.scheduleShiftSystem, empMaxShift); s++) {
        if ((shiftCounts[s] || 0) < minShiftCount) {
          minShiftCount = shiftCounts[s] || 0;
          bestShift = s;
        }
      }
      
      if (bestEmployee.suggestedShift && bestEmployee.suggestedShift <= Math.min(this.scheduleShiftSystem, empMaxShift)) {
        bestShift = bestEmployee.suggestedShift;
      }
      
      // Assign as 'adhesion' scope (peel-off tests)
      await this.addScopedAssignment(
        groupKey,
        bestEmployee.id,
        weekKey,
        bestShift as 1 | 2 | 3,
        'adhesion'
      );
      
      // Update workload tracking
      empPeelOffWorkload.set(bestEmployee.id, (empPeelOffWorkload.get(bestEmployee.id) || 0) + group.totalWorkload);
      empTotalThisWeek.set(bestEmployee.id, (empTotalThisWeek.get(bestEmployee.id) || 0) + 1);
      shiftCounts[bestShift] = (shiftCounts[bestShift] || 0) + 1;
      
      assignedCount++;
    }
    
    this.showToast(
      i18n.t('schedule.fairPeelOffComplete').replace('{0}', String(assignedCount)),
      'success'
    );
    this.renderScheduleAlerts();
    this.renderScheduleContent();
    this.renderScheduleEmployeePanel();
  }
  
  // ==================== Shift Planner Modal ====================
  
  private projectShiftConfig: Map<string, Set<number>> = new Map(); // groupKey -> Set of shifts (1,2,3)
  private employeeWeekShift: Map<string, number> = new Map(); // empId -> shift (1 or 2 or 3) for this week
  private currentShiftSystem: number = 2; // 1, 2 or 3 - global shift system for this week
  private shiftPlannerGroupMode: 'project' | 'customer' = 'project'; // grouping mode
  
  private async loadShiftPlannerConfig(): Promise<void> {
    const weekKey = `${this.scheduleCurrentYear}-KW${this.scheduleCurrentWeek.toString().padStart(2, '0')}`;
    
    try {
      // Load global shift system for this week
      const shiftSystem = await db.getPreference(`shiftSystem_${weekKey}`);
      this.currentShiftSystem = (typeof shiftSystem === 'number' && [1, 2, 3].includes(shiftSystem)) ? shiftSystem : 2;
      
      // Load grouping mode
      const groupMode = await db.getPreference(`shiftGroupMode_${weekKey}`);
      this.shiftPlannerGroupMode = (groupMode === 'customer') ? 'customer' : 'project';
      
      // Load project shift config for this week
      const projectConfig = await db.getPreference(`shiftConfig_${weekKey}`);
      this.projectShiftConfig.clear();
      if (projectConfig && typeof projectConfig === 'object') {
        for (const [key, shifts] of Object.entries(projectConfig)) {
          this.projectShiftConfig.set(key, new Set(shifts as number[]));
        }
      }
      
      // Load employee shift assignments for this week
      const empShifts = await db.getPreference(`empShifts_${weekKey}`);
      this.employeeWeekShift.clear();
      if (empShifts && typeof empShifts === 'object') {
        for (const [empId, shift] of Object.entries(empShifts)) {
          this.employeeWeekShift.set(empId, shift as number);
        }
      }
    } catch (e) {
      console.warn('Failed to load shift planner config');
    }
  }
  
  private async saveShiftPlannerConfig(): Promise<void> {
    const weekKey = `${this.scheduleCurrentYear}-KW${this.scheduleCurrentWeek.toString().padStart(2, '0')}`;
    
    // Save global shift system
    await db.setPreference(`shiftSystem_${weekKey}`, this.currentShiftSystem);
    
    // Save grouping mode
    await db.setPreference(`shiftGroupMode_${weekKey}`, this.shiftPlannerGroupMode);
    
    // Save project shift config
    const projectConfig: Record<string, number[]> = {};
    this.projectShiftConfig.forEach((shifts, key) => {
      projectConfig[key] = Array.from(shifts);
    });
    await db.setPreference(`shiftConfig_${weekKey}`, projectConfig);
    
    // Save employee shifts
    const empShifts: Record<string, number> = {};
    this.employeeWeekShift.forEach((shift, empId) => {
      empShifts[empId] = shift;
    });
    await db.setPreference(`empShifts_${weekKey}`, empShifts);
  }
  
  private getEmployeeSuggestedShift(empId: string): number {
    const weekKey = `${this.scheduleCurrentYear}-KW${this.scheduleCurrentWeek.toString().padStart(2, '0')}`;
    const prevWeekKey = this.getPreviousWeekKey(weekKey);
    
    const emp = this.state.employees.find(e => e.id === empId);
    const empShiftSystem = emp?.shiftSystem || 2;
    
    // Limit to the global shift system setting
    const maxShift = Math.min(empShiftSystem, this.currentShiftSystem);
    
    // Check previous week's actual shift
    const prevAssignments = this.state.scheduleAssignments.filter((a: ScheduleAssignment) => 
      a.employeeId === empId && a.week === prevWeekKey
    );
    
    if (prevAssignments.length > 0) {
      const prevShift = this.getMostCommonShift(prevAssignments);
      // Rotate based on shift system: 1→2, 2→1 for 2-shift; 1→2→3→1 for 3-shift
      if (maxShift >= 3) {
        return prevShift === 1 ? 2 : prevShift === 2 ? 3 : 1;
      } else if (maxShift >= 2) {
        return prevShift === 1 ? 2 : 1;
      }
      return 1;
    }
    
    // Check employee's preference
    if (emp?.suggestedShift && emp.suggestedShift <= maxShift) {
      return emp.suggestedShift;
    }
    
    // Default: shift 1
    return 1;
  }
  
  private getDefaultProjectShifts(groupKey: string, groupItems: Project[]): Set<number> {
    // Check if there's a pattern in historical assignments
    const allAssignments = this.state.scheduleAssignments.filter((a: ScheduleAssignment) =>
      a.projectId === groupKey || groupItems.some(item => item.id === a.projectId)
    );
    
    if (allAssignments.length > 0) {
      const shifts = new Set<number>();
      allAssignments.forEach((a: ScheduleAssignment) => shifts.add(a.shift));
      if (shifts.size > 0) return shifts;
    }
    
    // Default: respect global shift system setting
    const defaults = new Set([1]);
    if (this.currentShiftSystem >= 2) defaults.add(2);
    if (this.currentShiftSystem >= 3) defaults.add(3);
    return defaults;
  }
  
  private async showShiftPlannerModal(): Promise<void> {
    const modal = document.getElementById('modal')!;
    const modalTitle = document.getElementById('modalTitle')!;
    const modalBody = document.getElementById('modalBody')!;
    
    await this.loadShiftPlannerConfig();
    
    const weekKey = `${this.scheduleCurrentYear}-KW${this.scheduleCurrentWeek.toString().padStart(2, '0')}`;
    const weekNum = this.scheduleCurrentWeek.toString().padStart(2, '0');
    
    // Get projects with SOLL > 0 this week
    const weekProjects = this.state.projects.filter(p => {
      const weekData = p.weeks[weekKey];
      return weekData && weekData.soll > 0 && !p.hidden;
    });
    
    // Group projects by customer-type OR customer only
    const projectGroups = new Map<string, { customerName: string; typeName: string; items: Project[] }>();
    weekProjects.forEach(p => {
      const groupKey = this.shiftPlannerGroupMode === 'customer' 
        ? p.customer_id 
        : `${p.customer_id}-${p.type_id}`;
      if (!projectGroups.has(groupKey)) {
        const customer = this.state.customers.find(c => c.id === p.customer_id);
        const type = this.state.types.find(t => t.id === p.type_id);
        projectGroups.set(groupKey, {
          customerName: customer?.name || '?',
          typeName: this.shiftPlannerGroupMode === 'customer' ? '' : (type?.name || '?'),
          items: []
        });
      }
      projectGroups.get(groupKey)!.items.push(p);
    });
    
    // In customer mode, collect all type names for display
    if (this.shiftPlannerGroupMode === 'customer') {
      projectGroups.forEach((group) => {
        const typeNames = [...new Set(group.items.map(p => {
          const type = this.state.types.find(t => t.id === p.type_id);
          return type?.name || '?';
        }))];
        group.typeName = typeNames.join(', ');
      });
    }
    
    // Initialize shift config for projects that don't have config yet
    projectGroups.forEach((group, groupKey) => {
      if (!this.projectShiftConfig.has(groupKey)) {
        this.projectShiftConfig.set(groupKey, this.getDefaultProjectShifts(groupKey, group.items));
      }
    });
    
    // Get available employees
    const availableEmployees = this.state.employees.filter(e => {
      if (e.status && e.status !== 'available') return false;
      const absence = this.getEmployeeAbsenceInWeek(e.id, this.scheduleCurrentYear, this.scheduleCurrentWeek);
      return !absence;
    });
    
    // Initialize employee shifts
    availableEmployees.forEach(emp => {
      if (!this.employeeWeekShift.has(emp.id)) {
        this.employeeWeekShift.set(emp.id, this.getEmployeeSuggestedShift(emp.id));
      }
    });
    
    // Current week assignments
    const weekAssignments = this.state.scheduleAssignments.filter((a: ScheduleAssignment) => a.week === weekKey);
    const assignedGroupIds = new Set<string>();
    weekAssignments.forEach((a: ScheduleAssignment) => assignedGroupIds.add(a.projectId));
    
    const unassignedCount = Array.from(projectGroups.keys()).filter(k => !assignedGroupIds.has(k)).length;
    
    // Count per shift
    const empOnShift1 = availableEmployees.filter(e => (this.employeeWeekShift.get(e.id) || 1) === 1).length;
    const empOnShift2 = availableEmployees.filter(e => (this.employeeWeekShift.get(e.id) || 1) === 2).length;
    const empOnShift3 = availableEmployees.filter(e => (this.employeeWeekShift.get(e.id) || 1) === 3).length;
    const projectsOnShift1 = Array.from(projectGroups.keys()).filter(k => this.projectShiftConfig.get(k)?.has(1)).length;
    const projectsOnShift2 = Array.from(projectGroups.keys()).filter(k => this.projectShiftConfig.get(k)?.has(2)).length;
    const projectsOnShift3 = Array.from(projectGroups.keys()).filter(k => this.projectShiftConfig.get(k)?.has(3)).length;
    
    modalTitle.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20" style="display:inline;vertical-align:middle;margin-right:8px">
        <rect x="3" y="4" width="18" height="18" rx="2"/>
        <line x1="3" y1="10" x2="21" y2="10"/>
        <line x1="9" y1="4" x2="9" y2="22"/>
        <line x1="15" y1="4" x2="15" y2="22"/>
      </svg>
      ${i18n.t('schedule.shiftPlanner')} – KW${weekNum}
    `;
    
    modalBody.innerHTML = `
      <div class="shift-planner-modal">
        <div class="shift-planner-summary">
          <div class="shift-planner-stat">
            <span class="stat-value">${projectGroups.size}</span>
            <span class="stat-label">${i18n.t('schedule.autoPlannerProjects')}</span>
          </div>
          <div class="shift-planner-stat">
            <span class="stat-value">${availableEmployees.length}</span>
            <span class="stat-label">${i18n.t('schedule.autoPlannerEmployees')}</span>
          </div>
          <div class="shift-planner-stat">
            <span class="stat-value">${unassignedCount}</span>
            <span class="stat-label">${i18n.t('schedule.autoPlannerUnassigned')}</span>
          </div>
        </div>
        
        <!-- SHIFT SYSTEM SELECTOR -->
        <div class="shift-system-selector">
          <div class="shift-system-selector-label">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
              <circle cx="12" cy="12" r="3"/><path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
            </svg>
            <span>${i18n.t('schedule.globalShiftSystem')}</span>
          </div>
          <div class="shift-system-buttons" id="shiftSystemButtons">
            <button class="shift-system-btn ${this.currentShiftSystem === 1 ? 'active' : ''}" data-system="1">
              <span class="shift-system-num">1</span>
              <span class="shift-system-label">${i18n.t('schedule.shiftSystem1Short')}</span>
            </button>
            <button class="shift-system-btn ${this.currentShiftSystem === 2 ? 'active' : ''}" data-system="2">
              <span class="shift-system-num">2</span>
              <span class="shift-system-label">${i18n.t('schedule.shiftSystem2Short')}</span>
            </button>
            <button class="shift-system-btn ${this.currentShiftSystem === 3 ? 'active' : ''}" data-system="3">
              <span class="shift-system-num">3</span>
              <span class="shift-system-label">${i18n.t('schedule.shiftSystem3Short')}</span>
            </button>
          </div>
        </div>
        
        <div class="shift-planner-columns">
          <!-- LEFT: Project shift configuration -->
          <div class="shift-planner-col shift-planner-projects">
            <h4>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
              ${i18n.t('schedule.shiftPlannerProjects')}
            </h4>
            <div class="shift-planner-info">${i18n.t('schedule.shiftPlannerProjectsDesc')}</div>
            
            <table class="shift-planner-table">
              <thead>
                <tr>
                  <th>${i18n.t('schedule.project')}</th>
                  <th class="shift-col">
                    <span class="shift-header-icon">☀️</span>
                    <span>Z1</span>
                  </th>
                  <th class="shift-col">
                    <span class="shift-header-icon">🌅</span>
                    <span>Z2</span>
                  </th>
                  <th class="shift-col">
                    <span class="shift-header-icon">🌙</span>
                    <span>Z3</span>
                  </th>
                </tr>
              </thead>
              <tbody id="shiftPlannerProjectsBody">
                ${Array.from(projectGroups.entries()).map(([groupKey, group]) => {
                  const shifts = this.projectShiftConfig.get(groupKey) || new Set([1, 2]);
                  const tests = group.items.map(p => this.state.tests.find(t => t.id === p.test_id)?.name || '').filter(Boolean);
                  const uniqueTests = [...new Set(tests)];
                  return `
                    <tr data-group="${groupKey}">
                      <td class="project-name-cell">
                        <span class="project-name">${group.customerName}</span>
                        <span class="project-type">${group.typeName}</span>
                        ${uniqueTests.length > 0 ? `<span class="project-tests">${uniqueTests.join(', ')}</span>` : ''}
                      </td>
                      <td class="shift-col">
                        <label class="shift-checkbox">
                          <input type="checkbox" data-group="${groupKey}" data-shift="1" ${shifts.has(1) ? 'checked' : ''}/>
                          <span class="shift-check-mark"></span>
                        </label>
                      </td>
                      <td class="shift-col">
                        <label class="shift-checkbox">
                          <input type="checkbox" data-group="${groupKey}" data-shift="2" ${shifts.has(2) ? 'checked' : ''}/>
                          <span class="shift-check-mark"></span>
                        </label>
                      </td>
                      <td class="shift-col">
                        <label class="shift-checkbox">
                          <input type="checkbox" data-group="${groupKey}" data-shift="3" ${shifts.has(3) ? 'checked' : ''}/>
                          <span class="shift-check-mark"></span>
                        </label>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
              <tfoot>
                <tr class="shift-planner-totals">
                  <td><strong>${i18n.t('schedule.total')}</strong></td>
                  <td class="shift-col" id="shiftPlannerTotal1"><strong>${projectsOnShift1}</strong></td>
                  <td class="shift-col" id="shiftPlannerTotal2"><strong>${projectsOnShift2}</strong></td>
                  <td class="shift-col" id="shiftPlannerTotal3"><strong>${projectsOnShift3}</strong></td>
                </tr>
              </tfoot>
            </table>
          </div>
          
          <!-- RIGHT: Employee shift rotation -->
          <div class="shift-planner-col shift-planner-employees">
            <h4>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
              </svg>
              ${i18n.t('schedule.shiftPlannerEmployees')}
            </h4>
            <div class="shift-planner-info">${i18n.t('schedule.shiftPlannerEmployeesDesc')}</div>
            
            <table class="shift-planner-table">
              <thead>
                <tr>
                  <th>${i18n.t('schedule.employeeLabel')}</th>
                  <th class="shift-col-wide">${i18n.t('schedule.shiftPlannerPrevWeek')}</th>
                  <th class="shift-col-wide">${i18n.t('schedule.shiftPlannerThisWeek')}</th>
                </tr>
              </thead>
              <tbody id="shiftPlannerEmployeesBody">
                ${availableEmployees.map(emp => {
                  const prevWeekKey = this.getPreviousWeekKey(weekKey);
                  const prevAssignments = this.state.scheduleAssignments.filter((a: ScheduleAssignment) => 
                    a.employeeId === emp.id && a.week === prevWeekKey
                  );
                  const prevShift = prevAssignments.length > 0 ? this.getMostCommonShift(prevAssignments) : '-';
                  const currentShift = this.employeeWeekShift.get(emp.id) || 1;
                  
                  return `
                    <tr data-employee="${emp.id}">
                      <td class="emp-name-cell">
                        <span class="emp-avatar-mini" style="background:${emp.color}">${emp.firstName.charAt(0)}${emp.lastName.charAt(0)}</span>
                        <span class="emp-name-text">${emp.firstName} ${emp.lastName}</span>
                        <span class="emp-shift-system-badge" title="${i18n.t('schedule.shiftSystemLabel')}">${emp.shiftSystem || 2}Z</span>
                      </td>
                      <td class="shift-col-wide">
                        <span class="prev-shift-badge shift-${prevShift}">${prevShift === '-' ? '–' : `Z${prevShift}`}</span>
                      </td>
                      <td class="shift-col-wide">
                        <select class="shift-select" data-employee="${emp.id}">
                          <option value="1" ${currentShift === 1 ? 'selected' : ''}>☀️ Z1</option>
                          ${(emp.shiftSystem || 2) >= 2 ? `<option value="2" ${currentShift === 2 ? 'selected' : ''}>🌅 Z2</option>` : ''}
                          ${(emp.shiftSystem || 2) >= 3 ? `<option value="3" ${currentShift === 3 ? 'selected' : ''}>🌙 Z3</option>` : ''}
                        </select>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
              <tfoot>
                <tr class="shift-planner-totals">
                  <td><strong>${i18n.t('schedule.total')}</strong></td>
                  <td class="shift-col-wide"></td>
                  <td class="shift-col-wide">
                    <span class="emp-shift-count"><span id="shiftPlannerEmp1">${availableEmployees.filter(e => (this.employeeWeekShift.get(e.id) || 1) === 1).length}</span> ☀️</span>
                    <span class="emp-shift-count"><span id="shiftPlannerEmp2">${availableEmployees.filter(e => (this.employeeWeekShift.get(e.id) || 1) === 2).length}</span> 🌅</span>
                    <span class="emp-shift-count" style="${this.currentShiftSystem >= 3 ? '' : 'display:none'}"><span id="shiftPlannerEmp3">${availableEmployees.filter(e => (this.employeeWeekShift.get(e.id) || 1) === 3).length}</span> 🌙</span>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
        
        <div class="shift-planner-footer">
          <div class="shift-planner-options-row">
            <div class="shift-planner-scope">
              <label class="form-label">${i18n.t('schedule.autoPlannerDefaultScope')}</label>
              <select id="shiftPlannerScope" class="form-control">
                <option value="project">${i18n.t('schedule.wholeProjectLabel')}</option>
                ${(() => {
                  const weekTestIds = new Set(weekProjects.map(p => p.test_id).filter(Boolean));
                  return this.state.tests
                    .filter(t => weekTestIds.has(t.id))
                    .map(t => `<option value="test-${t.id}">🧪 ${t.name}</option>`)
                    .join('');
                })()}
              </select>
            </div>
            <div class="shift-planner-group-mode">
              <label class="form-label">${i18n.t('schedule.groupModeLabel')}</label>
              <div class="group-mode-toggle" id="groupModeToggle">
                <button class="group-mode-btn ${this.shiftPlannerGroupMode === 'project' ? 'active' : ''}" data-mode="project">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
                  ${i18n.t('schedule.groupByProject')}
                </button>
                <button class="group-mode-btn ${this.shiftPlannerGroupMode === 'customer' ? 'active' : ''}" data-mode="customer">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                  ${i18n.t('schedule.groupByCustomer')}
                </button>
              </div>
            </div>
          </div>
          <div class="shift-planner-night-info" id="shiftPlannerNightInfo" style="${this.currentShiftSystem >= 3 ? '' : 'display:none'}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
            </svg>
            <span>${i18n.t('schedule.shiftPlannerNightInfo')}</span>
          </div>
        </div>
      </div>
    `;
    
    // Event listeners for shift system buttons
    modalBody.querySelectorAll('.shift-system-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const button = (e.currentTarget as HTMLElement);
        const system = parseInt(button.dataset.system!);
        this.currentShiftSystem = system;
        
        // Update active button state
        modalBody.querySelectorAll('.shift-system-btn').forEach(b => b.classList.remove('active'));
        button.classList.add('active');
        
        // Auto-configure project shifts based on shift system
        this.projectShiftConfig.forEach((shifts, groupKey) => {
          shifts.clear();
          shifts.add(1); // always include shift 1
          if (system >= 2) shifts.add(2);
          if (system >= 3) shifts.add(3);
        });
        
        // Update project checkboxes in the UI
        modalBody.querySelectorAll('.shift-checkbox input[type="checkbox"]').forEach(cb => {
          const input = cb as HTMLInputElement;
          const shift = parseInt(input.dataset.shift!);
          input.checked = shift <= system;
        });
        
        // Recalculate employee shifts based on new system
        availableEmployees.forEach(emp => {
          const currentEmpShift = this.employeeWeekShift.get(emp.id) || 1;
          const empShiftSystem = emp.shiftSystem || 2;
          const maxShift = Math.min(empShiftSystem, system);
          
          // If employee's current shift exceeds the new system, reassign
          if (currentEmpShift > maxShift) {
            const newShift = this.getEmployeeSuggestedShift(emp.id);
            this.employeeWeekShift.set(emp.id, Math.min(newShift, maxShift));
          }
        });
        
        // Update employee shift dropdowns
        modalBody.querySelectorAll('.shift-select').forEach(select => {
          const sel = select as HTMLSelectElement;
          const empId = sel.dataset.employee!;
          const emp = this.state.employees.find(e => e.id === empId);
          const empShiftSystem = emp?.shiftSystem || 2;
          const maxShift = Math.min(empShiftSystem, system);
          const currentValue = this.employeeWeekShift.get(empId) || 1;
          
          // Rebuild options
          sel.innerHTML = `
            <option value="1" ${currentValue === 1 ? 'selected' : ''}>☀️ Z1</option>
            ${maxShift >= 2 ? `<option value="2" ${currentValue === 2 ? 'selected' : ''}>🌅 Z2</option>` : ''}
            ${maxShift >= 3 ? `<option value="3" ${currentValue === 3 ? 'selected' : ''}>🌙 Z3</option>` : ''}
          `;
          
          // Ensure selected value is valid
          if (currentValue > maxShift) {
            sel.value = '1';
            this.employeeWeekShift.set(empId, 1);
          }
        });
        
        // Toggle night info visibility
        const nightInfo = document.getElementById('shiftPlannerNightInfo');
        if (nightInfo) nightInfo.style.display = system >= 3 ? '' : 'none';
        
        this.updateShiftPlannerTotals(projectGroups, availableEmployees);
      });
    });
    
    // Event listeners for project shift checkboxes
    modalBody.querySelectorAll('.shift-checkbox input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const input = e.target as HTMLInputElement;
        const groupKey = input.dataset.group!;
        const shift = parseInt(input.dataset.shift!);
        
        if (!this.projectShiftConfig.has(groupKey)) {
          this.projectShiftConfig.set(groupKey, new Set());
        }
        
        const shifts = this.projectShiftConfig.get(groupKey)!;
        if (input.checked) {
          shifts.add(shift);
        } else {
          shifts.delete(shift);
        }
        
        this.updateShiftPlannerTotals(projectGroups, availableEmployees);
      });
    });
    
    // Event listeners for employee shift selects
    modalBody.querySelectorAll('.shift-select').forEach(select => {
      select.addEventListener('change', (e) => {
        const sel = e.target as HTMLSelectElement;
        const empId = sel.dataset.employee!;
        this.employeeWeekShift.set(empId, parseInt(sel.value));
        
        this.updateShiftPlannerTotals(projectGroups, availableEmployees);
      });
    });
    
    // Helper to rebuild project groups based on current group mode
    const rebuildProjectGroups = () => {
      const newGroups = new Map<string, { customerName: string; typeName: string; items: Project[] }>();
      weekProjects.forEach(p => {
        const gk = this.shiftPlannerGroupMode === 'customer' 
          ? p.customer_id 
          : `${p.customer_id}-${p.type_id}`;
        if (!newGroups.has(gk)) {
          const customer = this.state.customers.find(c => c.id === p.customer_id);
          const type = this.state.types.find(t => t.id === p.type_id);
          newGroups.set(gk, {
            customerName: customer?.name || '?',
            typeName: this.shiftPlannerGroupMode === 'customer' ? '' : (type?.name || '?'),
            items: []
          });
        }
        newGroups.get(gk)!.items.push(p);
      });
      if (this.shiftPlannerGroupMode === 'customer') {
        newGroups.forEach((group) => {
          const typeNames = [...new Set(group.items.map(p => {
            const type = this.state.types.find(t => t.id === p.type_id);
            return type?.name || '?';
          }))];
          group.typeName = typeNames.join(', ');
        });
      }
      newGroups.forEach((group, gk) => {
        if (!this.projectShiftConfig.has(gk)) {
          this.projectShiftConfig.set(gk, this.getDefaultProjectShifts(gk, group.items));
        }
      });
      return newGroups;
    };
    
    // Helper to render project table rows and bind checkbox listeners
    const renderProjectRows = () => {
      const tbody = document.getElementById('shiftPlannerProjectsBody');
      if (!tbody) return;
      
      tbody.innerHTML = Array.from(projectGroups.entries()).map(([groupKey, group]) => {
        const shifts = this.projectShiftConfig.get(groupKey) || new Set([1, 2]);
        const tests = group.items.map(p => this.state.tests.find(t => t.id === p.test_id)?.name || '').filter(Boolean);
        const uniqueTests = [...new Set(tests)];
        return `
          <tr data-group="${groupKey}">
            <td class="project-name-cell">
              <span class="project-name">${group.customerName}</span>
              <span class="project-type">${group.typeName}</span>
              ${uniqueTests.length > 0 ? `<span class="project-tests">${uniqueTests.join(', ')}</span>` : ''}
            </td>
            <td class="shift-col">
              <label class="shift-checkbox">
                <input type="checkbox" data-group="${groupKey}" data-shift="1" ${shifts.has(1) ? 'checked' : ''}/>
                <span class="shift-check-mark"></span>
              </label>
            </td>
            <td class="shift-col">
              <label class="shift-checkbox">
                <input type="checkbox" data-group="${groupKey}" data-shift="2" ${shifts.has(2) ? 'checked' : ''}/>
                <span class="shift-check-mark"></span>
              </label>
            </td>
            <td class="shift-col">
              <label class="shift-checkbox">
                <input type="checkbox" data-group="${groupKey}" data-shift="3" ${shifts.has(3) ? 'checked' : ''}/>
                <span class="shift-check-mark"></span>
              </label>
            </td>
          </tr>
        `;
      }).join('');
      
      // Re-bind checkbox listeners on new rows
      tbody.querySelectorAll('.shift-checkbox input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', (ev) => {
          const input = ev.target as HTMLInputElement;
          const gk = input.dataset.group!;
          const shift = parseInt(input.dataset.shift!);
          if (!this.projectShiftConfig.has(gk)) {
            this.projectShiftConfig.set(gk, new Set());
          }
          const shifts = this.projectShiftConfig.get(gk)!;
          if (input.checked) { shifts.add(shift); } else { shifts.delete(shift); }
          this.updateShiftPlannerTotals(projectGroups, availableEmployees);
        });
      });
      
      this.updateShiftPlannerTotals(projectGroups, availableEmployees);
    };
    
    // Event listeners for group mode toggle
    modalBody.querySelectorAll('#groupModeToggle .group-mode-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const button = e.currentTarget as HTMLElement;
        const mode = button.dataset.mode as 'project' | 'customer';
        if (mode === this.shiftPlannerGroupMode) return;
        
        this.shiftPlannerGroupMode = mode;
        
        // Update active button state
        modalBody.querySelectorAll('#groupModeToggle .group-mode-btn').forEach(b => b.classList.remove('active'));
        button.classList.add('active');
        
        // Rebuild project groups with new mode
        projectGroups.clear();
        const newGroups = rebuildProjectGroups();
        newGroups.forEach((v, k) => projectGroups.set(k, v));
        
        // Update summary stats
        const statValues = modalBody.querySelectorAll('.shift-planner-stat .stat-value');
        if (statValues[0]) statValues[0].textContent = String(projectGroups.size);
        const newUnassigned = Array.from(projectGroups.keys()).filter(k => !assignedGroupIds.has(k)).length;
        if (statValues[2]) statValues[2].textContent = String(newUnassigned);
        
        // Re-render project rows in place
        renderProjectRows();
        
        await this.saveShiftPlannerConfig();
      });
    });
    
    // Confirm button
    const confirmBtn = modal.querySelector('.modal-confirm') as HTMLButtonElement;
    confirmBtn.style.display = '';
    confirmBtn.textContent = i18n.t('schedule.shiftPlannerRun');
    confirmBtn.onclick = async () => {
      await this.saveShiftPlannerConfig();
      const scopeVal = (document.getElementById('shiftPlannerScope') as HTMLSelectElement).value;
      const scopeTestId = scopeVal.startsWith('test-') ? scopeVal.replace('test-', '') : undefined;
      const scope: 'project' | 'audit' | 'adhesion' | 'specific' = scopeTestId ? 'specific' : (scopeVal as any);
      await this.runShiftBasedAssignment(scope, scopeTestId);
      this.hideModal();
    };
    
    modal.classList.add('active');
    
    // Make modal wider for shift planner
    const modalContent = modal.querySelector('.modal-content') as HTMLElement;
    if (modalContent) {
      modalContent.style.maxWidth = '900px';
      // Reset on close
      const origClose = modal.querySelector('.modal-close') as HTMLElement;
      if (origClose) {
        const origHandler = origClose.onclick;
        origClose.onclick = (e) => {
          modalContent.style.maxWidth = '';
          if (origHandler) (origHandler as Function).call(origClose, e);
        };
      }
    }
  }
  
  private updateShiftPlannerTotals(
    projectGroups: Map<string, any>,
    availableEmployees: Employee[]
  ): void {
    // Update project shift totals
    let total1 = 0, total2 = 0, total3 = 0;
    projectGroups.forEach((_, groupKey) => {
      const shifts = this.projectShiftConfig.get(groupKey);
      if (shifts?.has(1)) total1++;
      if (shifts?.has(2)) total2++;
      if (shifts?.has(3)) total3++;
    });
    
    const t1 = document.getElementById('shiftPlannerTotal1');
    const t2 = document.getElementById('shiftPlannerTotal2');
    const t3 = document.getElementById('shiftPlannerTotal3');
    if (t1) t1.innerHTML = `<strong>${total1}</strong>`;
    if (t2) t2.innerHTML = `<strong>${total2}</strong>`;
    if (t3) t3.innerHTML = `<strong>${total3}</strong>`;
    
    // Update employee shift counts
    let emp1 = 0, emp2 = 0, emp3 = 0;
    availableEmployees.forEach(e => {
      const shift = this.employeeWeekShift.get(e.id) || 1;
      if (shift === 1) emp1++;
      else if (shift === 2) emp2++;
      else if (shift === 3) emp3++;
    });
    
    const e1 = document.getElementById('shiftPlannerEmp1');
    const e2 = document.getElementById('shiftPlannerEmp2');
    const e3 = document.getElementById('shiftPlannerEmp3');
    if (e1) e1.textContent = String(emp1);
    if (e2) e2.textContent = String(emp2);
    if (e3) {
      e3.textContent = String(emp3);
      const e3Container = e3.closest('.emp-shift-count') as HTMLElement;
      if (e3Container) e3Container.style.display = this.currentShiftSystem >= 3 ? '' : 'none';
    }
  }
  
  private async runShiftBasedAssignment(defaultScope: 'project' | 'audit' | 'adhesion' | 'specific', scopeTestId?: string): Promise<void> {
    const weekKey = `${this.scheduleCurrentYear}-KW${this.scheduleCurrentWeek.toString().padStart(2, '0')}`;
    
    // 1. Get projects with SOLL > 0
    const weekProjects = this.state.projects.filter(p => {
      const weekData = p.weeks[weekKey];
      return weekData && weekData.soll > 0 && !p.hidden;
    });
    
    // 2. Build project groups
    const projectGroups = new Map<string, { items: Project[] }>();
    weekProjects.forEach(p => {
      const groupKey = this.shiftPlannerGroupMode === 'customer' 
        ? String(p.customer_id) 
        : `${p.customer_id}-${p.type_id}`;
      if (!projectGroups.has(groupKey)) {
        projectGroups.set(groupKey, { items: [] });
      }
      projectGroups.get(groupKey)!.items.push(p);
    });
    
    // 3. Get already assigned groups
    const weekAssignments = this.state.scheduleAssignments.filter((a: ScheduleAssignment) => a.week === weekKey);
    const assignedGroupIds = new Set<string>();
    weekAssignments.forEach((a: ScheduleAssignment) => {
      if (scopeTestId) {
        // Only block if this exact test is already assigned to the group
        if (a.scope === 'specific' && a.testId === scopeTestId) {
          assignedGroupIds.add(a.projectId);
        }
      } else {
        assignedGroupIds.add(a.projectId);
      }
    });
    
    let unassignedGroups = Array.from(projectGroups.keys()).filter(g => !assignedGroupIds.has(g));
    
    // When assigning specific test, only include groups that actually have that test
    if (scopeTestId) {
      unassignedGroups = unassignedGroups.filter(g => {
        const group = projectGroups.get(g)!;
        return group.items.some(p => p.test_id === scopeTestId);
      });
    }
    
    if (unassignedGroups.length === 0) {
      this.showToast(i18n.t('schedule.allCoveredOrNoEmp'), 'warning');
      return;
    }
    
    // 4. Get available employees grouped by their assigned shift
    const availableEmployees = this.state.employees.filter(e => {
      if (e.status && e.status !== 'available') return false;
      const absence = this.getEmployeeAbsenceInWeek(e.id, this.scheduleCurrentYear, this.scheduleCurrentWeek);
      return !absence;
    });
    
    const empByShift = new Map<number, Employee[]>();
    empByShift.set(1, []);
    empByShift.set(2, []);
    empByShift.set(3, []);
    
    availableEmployees.forEach(emp => {
      const shift = this.employeeWeekShift.get(emp.id) || this.getEmployeeSuggestedShift(emp.id);
      const empShiftSystem = emp.shiftSystem || 2;
      // Validate: employee can't be on a shift higher than their shiftSystem
      const validShift = shift <= empShiftSystem ? shift : 1;
      if (!empByShift.has(validShift)) empByShift.set(validShift, []);
      empByShift.get(validShift)!.push(emp);
    });
    
    // 5. Build historical assignment counts
    const allAssignments = this.state.scheduleAssignments;
    const empProjectHistory = new Map<string, Map<string, number>>();
    const empTotalThisWeek = new Map<string, number>();
    
    availableEmployees.forEach(e => {
      empProjectHistory.set(e.id, new Map());
      empTotalThisWeek.set(e.id, 0);
    });
    
    allAssignments.forEach((a: ScheduleAssignment) => {
      const histMap = empProjectHistory.get(a.employeeId);
      if (histMap) {
        histMap.set(a.projectId, (histMap.get(a.projectId) || 0) + 1);
      }
    });
    
    weekAssignments.forEach((a: ScheduleAssignment) => {
      if (empTotalThisWeek.has(a.employeeId)) {
        empTotalThisWeek.set(a.employeeId, (empTotalThisWeek.get(a.employeeId) || 0) + 1);
      }
    });
    
    // 6. For each unassigned project, assign worker from matching shift
    let assignedCount = 0;
    
    for (const groupKey of unassignedGroups) {
      const projectShifts = this.projectShiftConfig.get(groupKey) || new Set([1, 2]);
      
      // Determine which employee shift pool to use
      // If project runs on shift 1 and/or 2 -> use those employees
      // PRIORITY: Employee's shift determines which projects they can work on.
      // A Z2 employee can ONLY be assigned to projects running on Z2 (or Z3 night).
      // A Z1 employee can ONLY be assigned to projects running on Z1 (or Z3 night).
      // The assignment shift is always the employee's own shift.
      
      // Build candidate pool: only employees whose shift matches the project's shift(s)
      // Also respect employee's shiftSystem: a 2-shift employee cannot work on Z3
      let candidatePool: Employee[] = [];
      
      if (projectShifts.has(1)) {
        candidatePool.push(...(empByShift.get(1) || []));
      }
      if (projectShifts.has(2)) {
        candidatePool.push(...(empByShift.get(2) || []));
      }
      if (projectShifts.has(3)) {
        // Z3 projects: only employees in 3-shift system can be directly on Z3
        candidatePool.push(...(empByShift.get(3) || []));
        // If no Z3 employees available, Z1/Z2 employees from 3-shift system can cover
        if (candidatePool.length === 0) {
          const threeShiftEmps = availableEmployees.filter(e => (e.shiftSystem || 2) >= 3);
          candidatePool.push(...threeShiftEmps);
        }
      }
      
      // Remove duplicates (in case project runs on both Z1 and Z2)
      const seenIds = new Set<string>();
      candidatePool = candidatePool.filter(e => {
        if (seenIds.has(e.id)) return false;
        seenIds.add(e.id);
        return true;
      });
      
      // NO cross-shift fallback: if no matching employees, skip this project
      if (candidatePool.length === 0) continue;
      
      // Score each candidate (lower = better)
      const scored = candidatePool.map(emp => {
        const totalThisWeek = empTotalThisWeek.get(emp.id) || 0;
        const historyOnProject = empProjectHistory.get(emp.id)?.get(groupKey) || 0;
        const score = (totalThisWeek * 100) + (historyOnProject * 10);
        return { employee: emp, score };
      });
      
      scored.sort((a, b) => {
        if (a.score !== b.score) return a.score - b.score;
        return Math.random() - 0.5;
      });
      
      if (scored.length === 0) continue;
      
      const bestEmployee = scored[0].employee;
      
      // ALWAYS use the employee's actual shift as the assignment shift
      const empShift = this.employeeWeekShift.get(bestEmployee.id) || 1;
      // Exception: night-only projects (Z3) get shift 3
      const assignShift: 1 | 2 | 3 = (projectShifts.size === 1 && projectShifts.has(3))
        ? 3
        : (empShift as 1 | 2 | 3);
      
      await this.addScopedAssignment(
        groupKey,
        bestEmployee.id,
        weekKey,
        assignShift,
        defaultScope,
        scopeTestId
      );
      
      // Update counters
      empTotalThisWeek.set(bestEmployee.id, (empTotalThisWeek.get(bestEmployee.id) || 0) + 1);
      const histMap = empProjectHistory.get(bestEmployee.id)!;
      histMap.set(groupKey, (histMap.get(groupKey) || 0) + 1);
      
      assignedCount++;
    }
    
    // ==================== SECOND PASS: Ensure everyone gets an assignment ====================
    const allWeekAssignmentsAfter = this.state.scheduleAssignments.filter((a: ScheduleAssignment) => a.week === weekKey);
    const assignedEmpIdsAfter = new Set(allWeekAssignmentsAfter.map((a: ScheduleAssignment) => a.employeeId));
    
    const stillUnassigned = availableEmployees.filter(emp => !assignedEmpIdsAfter.has(emp.id));
    
    if (stillUnassigned.length > 0 && projectGroups.size > 0) {
      // Calculate workload per project group (total minutes / assigned employees)
      const groupWorkload: Array<[string, number]> = [];
      
      projectGroups.forEach((group, gKey) => {
        let totalMinutes = 0;
        group.items.forEach(p => {
          const wd = p.weeks?.[weekKey];
          if (wd && wd.soll > 0) {
            totalMinutes += wd.soll * (p.timePerUnit || 0);
          }
        });
        const empCount = allWeekAssignmentsAfter.filter(x => x.projectId === gKey).length;
        groupWorkload.push([gKey, empCount > 0 ? totalMinutes / empCount : totalMinutes]);
      });
      
      // Sort by per-person workload descending (most loaded = needs help most)
      groupWorkload.sort((a, b) => b[1] - a[1]);
      
      let gIdx = 0;
      for (const unassignedEmp of stillUnassigned) {
        if (groupWorkload.length === 0) break;
        
        const [groupKey] = groupWorkload[gIdx % groupWorkload.length];
        
        // Use employee's configured shift, validated against their shiftSystem
        const empMaxShiftVal = unassignedEmp.shiftSystem || 2;
        const configuredShift = this.employeeWeekShift.get(unassignedEmp.id) || 1;
        const empShiftVal = configuredShift <= empMaxShiftVal ? configuredShift : 1;
        
        await this.addScopedAssignment(
          groupKey,
          unassignedEmp.id,
          weekKey,
          empShiftVal as 1 | 2 | 3,
          defaultScope,
          scopeTestId
        );
        
        empTotalThisWeek.set(unassignedEmp.id, (empTotalThisWeek.get(unassignedEmp.id) || 0) + 1);
        
        // Recalculate per-person workload
        const group = projectGroups.get(groupKey)!;
        let totalMins = 0;
        group.items.forEach(p => {
          const wd = p.weeks?.[weekKey];
          if (wd && wd.soll > 0) totalMins += wd.soll * (p.timePerUnit || 0);
        });
        const newCount = allWeekAssignmentsAfter.filter(x => x.projectId === groupKey).length + 1;
        groupWorkload[gIdx % groupWorkload.length] = [groupKey, totalMins / newCount];
        groupWorkload.sort((a, b) => b[1] - a[1]);
        
        assignedCount++;
        gIdx++;
      }
    }
    
    this.showToast(
      i18n.t('schedule.shiftPlannerComplete').replace('{0}', String(assignedCount)),
      'success'
    );
    this.renderScheduleAlerts();
    this.renderScheduleContent();
    this.renderScheduleEmployeePanel();
  }
  
  // Check if employee has absence in a given week
  private getEmployeeAbsenceInWeek(employeeId: string, year: number, week: number): any | null {
    // Get the dates for the week
    const jan4 = new Date(year, 0, 4);
    const dayOfWeek = jan4.getDay() || 7;
    const weekStart = new Date(jan4);
    weekStart.setDate(jan4.getDate() - dayOfWeek + 1 + (week - 1) * 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 4); // Mon-Fri
    
    // Check if any absence overlaps with this week
    return this.absences.find(a => {
      if (a.employeeId !== employeeId) return false;
      const absStart = new Date(a.startDate);
      const absEnd = new Date(a.endDate);
      return absStart <= weekEnd && absEnd >= weekStart;
    }) || null;
  }

  private renderScheduleEmployeePanel(): void {
    const assignedList = document.getElementById('assignedList');
    const unassignedList = document.getElementById('unassignedList');
    const absentList = document.getElementById('absentList');
    const uncoveredList = document.getElementById('uncoveredProjectsList');
    
    const weekKey = `${this.scheduleCurrentYear}-KW${this.scheduleCurrentWeek.toString().padStart(2, '0')}`;
    const weekAssignments = this.state.scheduleAssignments.filter((a: ScheduleAssignment) => a.week === weekKey);
    const assignedEmployeeIds = new Set(weekAssignments.map((a: ScheduleAssignment) => a.employeeId));
    
    // Check employees with absences from absence module
    const employeesWithAbsences = new Map<string, any>();
    this.state.employees.forEach(e => {
      const absence = this.getEmployeeAbsenceInWeek(e.id, this.scheduleCurrentYear, this.scheduleCurrentWeek);
      if (absence) {
        employeesWithAbsences.set(e.id, absence);
      }
    });
    
    // Podziel pracowników - uwzględnij nieobecności z modułu urlopów
    const availableEmployees = this.state.employees.filter(e => 
      (!e.status || e.status === 'available') && !employeesWithAbsences.has(e.id)
    );
    const absentEmployees = this.state.employees.filter(e => 
      e.status === 'vacation' || e.status === 'sick' || employeesWithAbsences.has(e.id)
    );
    const assignedAvailable = availableEmployees.filter(e => assignedEmployeeIds.has(e.id));
    const unassignedAvailable = availableEmployees.filter(e => !assignedEmployeeIds.has(e.id));
    
    // Helper: calculate weekly workload in minutes for an employee
    const calcEmployeeWorkloadMinutes = (empId: string): number => {
      const empAssignments = weekAssignments.filter((a: ScheduleAssignment) => a.employeeId === empId);
      let totalMinutes = 0;
      
      empAssignments.forEach((a: ScheduleAssignment) => {
        // Find projects in this group
        const groupProjects = this.state.projects.filter(p => 
          `${p.customer_id}-${p.type_id}` === a.projectId || p.id === a.projectId
        );
        
        groupProjects.forEach(p => {
          const wd = p.weeks?.[weekKey];
          if (wd && wd.soll > 0) {
            // How many employees share this project group?
            const sharedCount = weekAssignments.filter((x: ScheduleAssignment) => x.projectId === a.projectId).length;
            totalMinutes += (wd.soll * (p.timePerUnit || 0)) / Math.max(sharedCount, 1);
          }
        });
      });
      
      return Math.round(totalMinutes);
    };
    
    // Weekly available minutes: 5 days × 8h = 2400 min
    const WEEKLY_AVAILABLE_MINUTES = 2400;
    
    // Helper: karta pracownika
    const renderEmployeeCard = (emp: Employee, isDraggable: boolean = true) => {
      const tasks = weekAssignments
        .filter((a: ScheduleAssignment) => a.employeeId === emp.id)
        .map((a: ScheduleAssignment) => {
          const project = this.state.projects.find(p => p.id === a.projectId || `${p.customer_id}-${p.type_id}` === a.projectId);
          if (project) {
            const customer = this.state.customers.find(c => c.id === project.customer_id);
            return customer?.name || '?';
          }
          return '?';
        });
      const uniqueTasks = [...new Set(tasks)];
      
      // Calculate workload
      const workloadMin = calcEmployeeWorkloadMinutes(emp.id);
      const workloadPct = WEEKLY_AVAILABLE_MINUTES > 0 ? Math.round((workloadMin / WEEKLY_AVAILABLE_MINUTES) * 100) : 0;
      const isOverloaded = workloadPct > 100;
      const workloadClass = workloadPct === 0 ? 'workload-empty' : workloadPct <= 60 ? 'workload-low' : workloadPct <= 90 ? 'workload-medium' : workloadPct <= 100 ? 'workload-high' : 'workload-over';
      const shiftSystemBadge = emp.shiftSystem || 2;
      
      return `
        <div class="sched-emp-card" ${isDraggable ? 'draggable="true"' : ''} data-employee-id="${emp.id}">
          <div class="sched-emp-avatar" style="background: ${emp.color}">${emp.firstName.charAt(0)}${emp.lastName.charAt(0)}</div>
          <div class="sched-emp-info">
            <span class="sched-emp-name">${emp.firstName} ${emp.lastName} <span class="emp-shift-sys-tag">${shiftSystemBadge}Z</span></span>
            ${uniqueTasks.length > 0 ? `<span class="sched-emp-tasks">${uniqueTasks.slice(0, 2).join(', ')}${uniqueTasks.length > 2 ? '...' : ''}</span>` : ''}
            ${workloadMin > 0 ? `
              <div class="sched-emp-workload">
                <div class="workload-bar-bg">
                  <div class="workload-bar-fill ${workloadClass}" style="width: ${Math.min(workloadPct, 100)}%"></div>
                </div>
                <span class="workload-text ${workloadClass}">${workloadMin} / ${WEEKLY_AVAILABLE_MINUTES} min (${workloadPct}%)${isOverloaded ? ' ⚠️' : ''}</span>
              </div>
            ` : ''}
          </div>
        </div>
      `;
    };
    
    // 1. Przypisani
    if (assignedList) {
      document.getElementById('assignedCount')!.textContent = String(assignedAvailable.length);
      assignedList.innerHTML = assignedAvailable.length > 0 
        ? assignedAvailable.map(e => renderEmployeeCard(e)).join('')
        : '<p class="sched-panel-empty">—</p>';
    }
    
    // 2. Bez przydziału (drag & drop)
    if (unassignedList) {
      document.getElementById('unassignedCount')!.textContent = String(unassignedAvailable.length);
      unassignedList.innerHTML = unassignedAvailable.length > 0 
        ? unassignedAvailable.map(e => renderEmployeeCard(e)).join('')
        : '<p class="sched-panel-empty">—</p>';
    }
    
    // 3. Nieobecni
    if (absentList) {
      document.getElementById('absentCount')!.textContent = String(absentEmployees.length);
      if (absentEmployees.length === 0) {
        absentList.innerHTML = '<p class="sched-panel-empty">—</p>';
      } else {
        absentList.innerHTML = absentEmployees.map(emp => {
          // Check if absence is from new module
          const absenceFromModule = employeesWithAbsences.get(emp.id);
          const absenceType = absenceFromModule ? this.absenceTypes.find(t => t.id === absenceFromModule.absenceTypeId) : null;
          
          const isVacation = emp.status === 'vacation' || absenceType?.id?.includes('vacation');
          const isSick = emp.status === 'sick' || absenceType?.id === 'sick';
          
          let icon: string;
          let label: string;
          let badgeClass: string;
          
          if (absenceType) {
            icon = `<span style="font-size: 1.1rem;">${absenceType.icon}</span>`;
            label = absenceType.name.length > 15 ? absenceType.name.substring(0, 12) + '...' : absenceType.name;
            badgeClass = isVacation ? 'vacation' : isSick ? 'sick' : 'vacation';
          } else {
            icon = isVacation 
              ? '<svg viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" width="18" height="18"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M21 15l-3-3m0 0l-3 3m3-3v9"/></svg>'
              : '<svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" width="18" height="18"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>';
            label = isVacation ? i18n.t('schedule.vacationLabel') : i18n.t('schedule.sickLeaveLabel');
            badgeClass = emp.status || 'vacation';
          }
          
          return `
            <div class="sched-absent-card" data-employee-id="${emp.id}" data-status="${emp.status || 'absent'}" ${absenceFromModule ? `data-absence-id="${absenceFromModule.id}"` : ''}>
              <span class="sched-absent-icon">${icon}</span>
              <span class="sched-absent-name">${emp.firstName} ${emp.lastName}</span>
              <span class="sched-absent-badge ${badgeClass}">${label}</span>
              <button class="sched-absent-return" data-emp-id="${emp.id}" title="${i18n.t('schedule.restore')}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
              </button>
            </div>
          `;
        }).join('');
        
        // Obsługa przywracania
        absentList.querySelectorAll('.sched-absent-return').forEach(btn => {
          btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const empId = (btn as HTMLElement).dataset.empId;
            if (empId) {
              const emp = this.state.employees.find(e => e.id === empId);
              if (emp) {
                emp.status = 'available';
                await db.put('employees', emp);
                this.showToast(i18n.t('schedule.returnedToWork').replace('{0}', emp.firstName), 'success');
                this.renderScheduleEmployeePanel();
              }
            }
          });
        });
      }
    }
    
    // 4. Projekty bez obsady - pokazuj tylko te które nie są w pełni obsadzone
    if (uncoveredList) {
      // Grupuj projekty wg Customer + Type
      const projectGroups = new Map<string, {
        customerName: string;
        typeName: string;
        customerId: string;
        items: Project[];
      }>();
      
      const projectsWithSoll = this.state.projects.filter(p => {
        if (p.hidden) return false;
        const weekData = p.weeks[weekKey];
        return weekData && weekData.soll > 0;
      });
      
      projectsWithSoll.forEach(p => {
        const customer = this.state.customers.find(c => c.id === p.customer_id);
        const type = this.state.types.find(t => t.id === p.type_id);
        const groupKey = `${p.customer_id}-${p.type_id}`;
        
        if (!projectGroups.has(groupKey)) {
          projectGroups.set(groupKey, {
            customerName: customer?.name || '?',
            typeName: type?.name || '?',
            customerId: p.customer_id,
            items: []
          });
        }
        projectGroups.get(groupKey)!.items.push(p);
      });
      
      // Sprawdź które grupy nie są w pełni obsadzone
      const uncoveredGroupsList: Array<{
        customer: string;
        type: string;
        missing: string[];
        staffingClass: string;
      }> = [];
      
      projectGroups.forEach((group, groupKey) => {
        const groupAssignments = weekAssignments.filter((a: ScheduleAssignment) =>
          a.projectId === groupKey || group.items.some(item => item.id === a.projectId)
        );
        
        const status = this.getProjectStaffingStatus(groupKey, group.items, groupAssignments);
        
        // Tylko dodaj jeśli NIE jest w pełni obsadzony
        if (status.class !== 'staffing-full') {
          // Znajdź brakujące testy
          const uniqueTestIds = new Set<string>();
          group.items.forEach(p => {
            if (p.test_id) uniqueTestIds.add(p.test_id);
          });
          
          const coveredTestIds = new Set<string>();
          const hasProjectScope = groupAssignments.some((a: ScheduleAssignment) => a.scope === 'project');
          
          if (!hasProjectScope) {
            groupAssignments.forEach((a: ScheduleAssignment) => {
              if (a.scope === 'specific' && a.testId) {
                coveredTestIds.add(a.testId);
              } else if (a.scope === 'audit') {
                group.items.forEach(p => {
                  const test = this.state.tests.find(t => t.id === p.test_id);
                  if (test?.name?.toLowerCase().includes('audit') || test?.name?.toLowerCase().includes('audyt')) {
                    coveredTestIds.add(p.test_id);
                  }
                });
              } else if (a.scope === 'adhesion') {
                group.items.forEach(p => {
                  const test = this.state.tests.find(t => t.id === p.test_id);
                  if (test?.name?.toLowerCase().includes('peel') || 
                      test?.name?.toLowerCase().includes('adhesion') ||
                      test?.name?.toLowerCase().includes('przyczep')) {
                    coveredTestIds.add(p.test_id);
                  }
                });
              }
            });
          }
          
          const missingTests = Array.from(uniqueTestIds)
            .filter(id => !coveredTestIds.has(id))
            .map(id => this.state.tests.find(t => t.id === id)?.name || '?');
          
          uncoveredGroupsList.push({
            customer: group.customerName,
            type: group.typeName,
            missing: missingTests,
            staffingClass: status.class
          });
        }
      });
      
      document.getElementById('uncoveredCount')!.textContent = String(uncoveredGroupsList.length);
      
      if (uncoveredGroupsList.length === 0) {
        uncoveredList.innerHTML = '<p class="sched-panel-empty">' + i18n.t('schedule.allCovered') + '</p>';
      } else {
        uncoveredList.innerHTML = uncoveredGroupsList.map(g => `
          <div class="sched-uncovered-item ${g.staffingClass}">
            <div class="sched-uncovered-header">
              <span class="sched-uncovered-customer">${g.customer}</span>
              <span class="sched-uncovered-type">${g.type}</span>
            </div>
            ${g.missing.length > 0 ? `
              <div class="sched-uncovered-missing">
                <span class="sched-uncovered-label">${i18n.t('schedule.missing')}</span>
                ${g.missing.map(m => `<span class="sched-uncovered-test">${m}</span>`).join('')}
              </div>
            ` : `
              <div class="sched-uncovered-missing">
                <span class="sched-uncovered-label">${i18n.t('schedule.noCoverageLabel')}</span>
              </div>
            `}
          </div>
        `).join('');
      }
    }
    
    // Event listeners dla drag & drop
    const allCards = document.querySelectorAll('.sched-emp-card[draggable="true"]');
    allCards.forEach(item => {
      item.addEventListener('dragstart', (e) => {
        this.draggedEmployeeId = (item as HTMLElement).dataset.employeeId || null;
        this.draggedEmployeeScope = 'project';
        (item as HTMLElement).classList.add('dragging');
        (e as DragEvent).dataTransfer?.setData('text/plain', this.draggedEmployeeId || '');
      });
      item.addEventListener('dragend', () => {
        (item as HTMLElement).classList.remove('dragging');
        this.draggedEmployeeId = null;
      });
      
      // Kliknięcie - modal
      item.addEventListener('click', (e) => {
        const empId = (item as HTMLElement).dataset.employeeId;
        if (empId) {
          this.hideEmployeeHoverPopup();
          this.showEmployeeModal(empId);
        }
      });
      
      // Hover
      item.addEventListener('mouseenter', (e) => {
        const empId = (item as HTMLElement).dataset.employeeId;
        if (empId) {
          this.highlightEmployeeAssignments(empId, true);
          this.showEmployeeHoverPopup(e as MouseEvent, empId);
        }
      });
      item.addEventListener('mouseleave', () => {
        const empId = (item as HTMLElement).dataset.employeeId;
        if (empId) {
          this.highlightEmployeeAssignments(empId, false);
          this.hideEmployeeHoverPopup();
        }
      });
    });
    
    // Quick add
    document.getElementById('addEmployeeQuick')?.addEventListener('click', () => this.showAddEmployeeModal());
    
    // Render stats and history panels
    this.renderScheduleStatsPanel();
    this.renderScheduleHistoryPanel();
    
    (window as any).kappaApp = this;
  }
  
  // Render stats panel in sidebar
  private renderScheduleStatsPanel(): void {
    const panel = document.getElementById('scheduleStatsPanel');
    if (!panel) return;
    
    const weekKey = `${this.scheduleCurrentYear}-KW${this.scheduleCurrentWeek.toString().padStart(2, '0')}`;
    const weekAssignments = this.state.scheduleAssignments.filter((a: ScheduleAssignment) => a.week === weekKey);
    const allAssignments = this.state.scheduleAssignments;
    
    // ===== PODSTAWOWE STATYSTYKI =====
    const availableEmployees = this.state.employees.filter(e => {
      if (e.status && e.status !== 'available') return false;
      const absence = this.getEmployeeAbsenceInWeek(e.id, this.scheduleCurrentYear, this.scheduleCurrentWeek);
      return !absence;
    });
    const absentEmployees = this.state.employees.filter(e => {
      if (e.status === 'vacation' || e.status === 'sick') return true;
      const absence = this.getEmployeeAbsenceInWeek(e.id, this.scheduleCurrentYear, this.scheduleCurrentWeek);
      return !!absence;
    });
    const assignedEmployeeIds = new Set(weekAssignments.map(a => a.employeeId));
    const unassignedCount = availableEmployees.filter(e => !assignedEmployeeIds.has(e.id)).length;
    
    // ===== ANALIZA OBCIĄŻENIA PRACOWNIKÓW (na podstawie minut z planera) =====
    // Oblicz obciążenie w minutach: soll × timePerUnit dla każdego przypisanego projektu
    const employeeWorkloadMinutes = new Map<string, number>(); // empId -> total minutes
    const employeeProjectCount = new Map<string, number>(); // empId -> project count
    const employeeWorkloadDetails = new Map<string, Array<{project: string; minutes: number; parts: number}>>(); // empId -> details
    
    weekAssignments.forEach((a: ScheduleAssignment) => {
      const empId = a.employeeId;
      employeeProjectCount.set(empId, (employeeProjectCount.get(empId) || 0) + 1);
      
      if (!employeeWorkloadDetails.has(empId)) employeeWorkloadDetails.set(empId, []);
      
      // Find all projects in the assigned group
      const groupProjects = this.state.projects.filter(p => {
        if (p.hidden) return false;
        const groupKey = `${p.customer_id}-${p.type_id}`;
        return (groupKey === a.projectId || p.id === a.projectId);
      });
      
      let groupMinutes = 0;
      let groupParts = 0;
      groupProjects.forEach(p => {
        const wd = p.weeks?.[weekKey];
        if (wd && wd.soll > 0) {
          const mins = wd.soll * (p.timePerUnit || 0);
          groupMinutes += mins;
          groupParts += wd.soll;
        }
      });
      
      // For extra tasks
      if (a.projectId.startsWith('extra-')) {
        const taskId = a.projectId.replace('extra-', '');
        const task = this.state.extraTasks.find(t => t.id === taskId);
        if (task) {
          groupMinutes = task.timePerUnit * task.units;
          groupParts = task.units;
        }
      }
      
      employeeWorkloadMinutes.set(empId, (employeeWorkloadMinutes.get(empId) || 0) + groupMinutes);
      
      const customer = groupProjects.length > 0 
        ? this.state.customers.find(c => c.id === groupProjects[0].customer_id)?.name || '?'
        : a.projectId;
      employeeWorkloadDetails.get(empId)!.push({ project: customer, minutes: groupMinutes, parts: groupParts });
    });
    
    const workloadMinValues = Array.from(employeeWorkloadMinutes.values());
    const maxWorkloadMin = Math.max(...workloadMinValues, 0);
    const avgWorkloadMin = workloadMinValues.length > 0 ? workloadMinValues.reduce((a, b) => a + b, 0) / workloadMinValues.length : 0;
    
    // Backwards compat: keep project count for basic stats
    const employeeWorkload = employeeProjectCount;
    const workloads = Array.from(employeeWorkload.values());
    const maxWorkload = Math.max(...workloads, 0);
    const avgWorkload = workloads.length > 0 ? workloads.reduce((a, b) => a + b, 0) / workloads.length : 0;
    
    // Znajdź pracowników z nierównomiernym obciążeniem (based on MINUTES, not project count)
    const overloadedEmployees: Array<{emp: Employee; count: number; minutes: number}> = [];
    const underloadedEmployees: Array<{emp: Employee; count: number; minutes: number}> = [];
    
    employeeWorkloadMinutes.forEach((minutes, empId) => {
      const emp = this.state.employees.find(e => e.id === empId);
      if (emp) {
        if (avgWorkloadMin > 0 && minutes >= avgWorkloadMin * 1.4) {
          overloadedEmployees.push({ emp, count: employeeProjectCount.get(empId) || 0, minutes });
        }
      }
    });
    
    // Pracownicy dostępni ale bez przypisań lub z małym obciążeniem (minuty)
    availableEmployees.forEach(emp => {
      const minutes = employeeWorkloadMinutes.get(emp.id) || 0;
      const count = employeeProjectCount.get(emp.id) || 0;
      if (avgWorkloadMin > 0 && minutes < avgWorkloadMin * 0.6) {
        underloadedEmployees.push({ emp, count, minutes });
      } else if (count === 0) {
        underloadedEmployees.push({ emp, count: 0, minutes: 0 });
      }
    });
    
    // ===== ANALIZA POKRYCIA PROJEKTÓW =====
    const projectsWithSoll = this.state.projects.filter(p => {
      if (p.hidden) return false;
      const weekData = p.weeks?.[weekKey];
      return weekData && weekData.soll > 0;
    });
    
    const projectGroups = new Map<string, { items: Project[]; customer: string; type: string }>();
    projectsWithSoll.forEach(p => {
      const groupKey = `${p.customer_id}-${p.type_id}`;
      if (!projectGroups.has(groupKey)) {
        const customer = this.state.customers.find(c => c.id === p.customer_id);
        const type = this.state.types.find(t => t.id === p.type_id);
        projectGroups.set(groupKey, { 
          items: [], 
          customer: customer?.name || '?',
          type: type?.name || '?'
        });
      }
      projectGroups.get(groupKey)!.items.push(p);
    });
    
    let fullyCovered = 0;
    let partiallyCovered = 0;
    let notCovered = 0;
    const uncoveredProjects: Array<{groupKey: string; customer: string; type: string}> = [];
    
    projectGroups.forEach((group, groupKey) => {
      const groupAssignments = weekAssignments.filter((a: ScheduleAssignment) =>
        a.projectId === groupKey || group.items.some(item => item.id === a.projectId)
      );
      
      if (groupAssignments.length === 0) {
        notCovered++;
        uncoveredProjects.push({ groupKey, customer: group.customer, type: group.type });
      } else {
        // Sprawdź pełne pokrycie:
        // 1. Ktoś jest przypisany do całego projektu (scope='project'), LUB
        // 2. Wszystkie unikalne testy w projekcie mają przypisania
        const hasProjectScope = groupAssignments.some((a: ScheduleAssignment) => a.scope === 'project');
        
        if (hasProjectScope) {
          fullyCovered++;
        } else {
          // Zbierz unikalne testy wymagane w tym tygodniu
          const requiredTests = new Set<string>();
          group.items.forEach(p => {
            const weekData = p.weeks?.[weekKey];
            if (weekData && weekData.soll > 0) {
              // Dodaj test_id projektu do wymaganych
              if (p.test_id) requiredTests.add(p.test_id);
            }
          });
          
          // Zbierz testy które mają przypisania
          const coveredTests = new Set<string>();
          groupAssignments.forEach((a: ScheduleAssignment) => {
            if (a.testId) {
              coveredTests.add(a.testId);
            } else if (a.scope === 'project') {
              // Jeśli ktoś ma scope='project', pokrywa wszystkie testy
              requiredTests.forEach(t => coveredTests.add(t));
            }
          });
          
          // Sprawdź czy wszystkie wymagane testy są pokryte
          const allTestsCovered = requiredTests.size > 0 && 
            [...requiredTests].every(testId => coveredTests.has(testId));
          
          if (allTestsCovered || requiredTests.size === 0) {
            fullyCovered++;
          } else if (coveredTests.size > 0) {
            partiallyCovered++;
          } else {
            partiallyCovered++;
          }
        }
      }
    });
    
    const coveragePercent = projectGroups.size > 0 
      ? Math.round((fullyCovered / projectGroups.size) * 100) 
      : 100;
    
    // ===== ANALIZA ROTACJI - ZBYT DŁUGO NA PROJEKCIE =====
    const consecutiveWeeksOnProject = new Map<string, Map<string, number>>(); // empId -> projectKey -> weeks
    
    // Sprawdź ostatnie 4 tygodnie
    for (let i = 0; i < 4; i++) {
      let checkWeek = this.scheduleCurrentWeek - i;
      let checkYear = this.scheduleCurrentYear;
      if (checkWeek < 1) {
        checkWeek += 52;
        checkYear--;
      }
      const checkKey = `${checkYear}-KW${checkWeek.toString().padStart(2, '0')}`;
      
      const weekAssigns = allAssignments.filter((a: ScheduleAssignment) => a.week === checkKey);
      weekAssigns.forEach(a => {
        const projectKey = a.projectId;
        if (!consecutiveWeeksOnProject.has(a.employeeId)) {
          consecutiveWeeksOnProject.set(a.employeeId, new Map());
        }
        const empProjects = consecutiveWeeksOnProject.get(a.employeeId)!;
        empProjects.set(projectKey, (empProjects.get(projectKey) || 0) + 1);
      });
    }
    
    const longTermAssignments: Array<{emp: Employee; project: string; weeks: number}> = [];
    consecutiveWeeksOnProject.forEach((projects, empId) => {
      const emp = this.state.employees.find(e => e.id === empId);
      if (!emp) return;
      
      projects.forEach((weeks, projectKey) => {
        if (weeks >= 3) {
          // Znajdź nazwę projektu
          const parts = projectKey.split('-');
          const customer = this.state.customers.find(c => c.id === parts[0]);
          const type = this.state.types.find(t => t.id === parts[1]);
          const projectName = customer && type ? `${customer.name} ${type.name}` : projectKey;
          longTermAssignments.push({ emp, project: projectName, weeks });
        }
      });
    });
    
    // ===== ANALIZA DOŚWIADCZENIA =====
    const projectExperience = new Map<string, Map<string, number>>(); // projectKey -> empId -> count
    
    allAssignments.forEach((a: ScheduleAssignment) => {
      const projectKey = a.projectId;
      if (!projectExperience.has(projectKey)) {
        projectExperience.set(projectKey, new Map());
      }
      const empExp = projectExperience.get(projectKey)!;
      empExp.set(a.employeeId, (empExp.get(a.employeeId) || 0) + 1);
    });
    
    const experienceImbalance: Array<{project: string; experienced: {emp: Employee; count: number}; inexperienced: {emp: Employee; count: number}}> = [];
    
    projectExperience.forEach((empCounts, projectKey) => {
      const counts = Array.from(empCounts.entries())
        .map(([empId, count]) => ({ emp: this.state.employees.find(e => e.id === empId), count }))
        .filter(x => x.emp && (!x.emp.status || x.emp.status === 'available')) as Array<{emp: Employee; count: number}>;
      
      if (counts.length < 2) return;
      
      counts.sort((a, b) => b.count - a.count);
      const max = counts[0];
      const min = counts[counts.length - 1];
      
      if (max.count >= 10 && min.count <= 3 && max.count > min.count * 3) {
        const parts = projectKey.split('-');
        const customer = this.state.customers.find(c => c.id === parts[0]);
        const type = this.state.types.find(t => t.id === parts[1]);
        const projectName = customer && type ? `${customer.name} ${type.name}` : projectKey;
        experienceImbalance.push({ project: projectName, experienced: max, inexperienced: min });
      }
    });
    
    // ===== KONFLIKTY - pracownik na 2 projektach w tej samej zmianie =====
    const shiftConflicts: Array<{emp: Employee; shift: number; projects: string[]}> = [];
    const empShiftProjects = new Map<string, Map<number, string[]>>(); // empId -> shift -> projects[]
    
    weekAssignments.forEach((a: ScheduleAssignment) => {
      if (!empShiftProjects.has(a.employeeId)) {
        empShiftProjects.set(a.employeeId, new Map());
      }
      const shifts = empShiftProjects.get(a.employeeId)!;
      if (!shifts.has(a.shift)) {
        shifts.set(a.shift, []);
      }
      
      const parts = a.projectId.split('-');
      const customer = this.state.customers.find(c => c.id === parts[0]);
      const type = this.state.types.find(t => t.id === parts[1]);
      const projectName = customer && type ? `${customer.name} ${type.name}` : a.projectId;
      shifts.get(a.shift)!.push(projectName);
    });
    
    empShiftProjects.forEach((shifts, empId) => {
      const emp = this.state.employees.find(e => e.id === empId);
      if (!emp) return;
      
      shifts.forEach((projects, shift) => {
        if (projects.length > 1) {
          shiftConflicts.push({ emp, shift, projects });
        }
      });
    });
    
    // ===== KONFLIKT - pracownik na urlopie ale przypisany =====
    const absentButAssigned: Array<{emp: Employee; status: string}> = [];
    weekAssignments.forEach((a: ScheduleAssignment) => {
      const emp = this.state.employees.find(e => e.id === a.employeeId);
      if (emp && (emp.status === 'vacation' || emp.status === 'sick')) {
        if (!absentButAssigned.find(x => x.emp.id === emp.id)) {
          absentButAssigned.push({ emp, status: emp.status === 'vacation' ? i18n.t('schedule.vacationLabel') : i18n.t('schedule.sickLeaveLabel') });
        }
      }
    });
    
    // ===== SUGESTIE OPTYMALNEGO PRZYPISANIA =====
    const optimalSuggestions: Array<{project: string; suggestedEmp: Employee; reason: string}> = [];
    
    uncoveredProjects.slice(0, 3).forEach(({ groupKey, customer, type }) => {
      // Znajdź pracownika z najmniejszym obciążeniem który ma doświadczenie
      const projectExp = projectExperience.get(groupKey);
      
      let bestCandidate: Employee | null = null;
      let bestScore = -1;
      
      availableEmployees.forEach((emp: Employee) => {
        if (assignedEmployeeIds.has(emp.id) && (employeeWorkload.get(emp.id) || 0) > avgWorkload) return;
        
        const experience = projectExp?.get(emp.id) || 0;
        const workload = employeeWorkload.get(emp.id) || 0;
        const score = experience * 2 - workload; // Preferuj doświadczenie, ale balansuj obciążenie
        
        const currentBestWorkload = bestCandidate ? (employeeWorkload.get(bestCandidate.id) || 0) : Infinity;
        if (score > bestScore || (score === bestScore && workload < currentBestWorkload)) {
          bestScore = score;
          bestCandidate = emp;
        }
      });
      
      if (bestCandidate) {
        const candidate = bestCandidate as Employee;
        const exp = projectExp?.get(candidate.id) || 0;
        const reason = exp > 0 
          ? i18n.t('schedule.experienceHint').replace('{0}', String(exp))
          : i18n.t('schedule.leastTasks');
        optimalSuggestions.push({ 
          project: `${customer} ${type}`, 
          suggestedEmp: candidate, 
          reason 
        });
      }
    });
    
    // ===== BALANS ZMIAN =====
    const shiftCounts = new Map<number, number>();
    weekAssignments.forEach((a: ScheduleAssignment) => {
      shiftCounts.set(a.shift, (shiftCounts.get(a.shift) || 0) + 1);
    });
    
    const shifts = [1, 2, 3].filter(s => this.state.settings.shiftSystem >= s);
    const shiftImbalance: {from: number; to: number; diff: number} | null = (() => {
      let maxShift = 1, minShift = 1, maxCount = 0, minCount = Infinity;
      shifts.forEach(s => {
        const count = shiftCounts.get(s) || 0;
        if (count > maxCount) { maxCount = count; maxShift = s; }
        if (count < minCount) { minCount = count; minShift = s; }
      });
      if (maxCount > minCount * 2 && maxCount - minCount >= 3) {
        return { from: maxShift, to: minShift, diff: maxCount - minCount };
      }
      return null;
    })();
    
    // ===== GENERUJ HTML =====
    const suggestions: string[] = [];
    const alerts: string[] = [];
    
    // Alerty krytyczne
    absentButAssigned.forEach(({ emp, status }) => {
      alerts.push(`<div class="sched-alert danger"><span class="alert-icon">⚠️</span><span class="alert-text">${i18n.t('schedule.absentButAssigned').replace('{0}', '<strong>' + emp.firstName + ' ' + emp.lastName + '</strong>').replace('{1}', status)}</span></div>`);
    });
    
    shiftConflicts.forEach(({ emp, shift, projects }) => {
      // Not an error - multiple projects on same shift is normal for workload distribution
      // alerts.push(...); // Removed: user confirmed this is not a problem
    });
    
    // Sugestie
    if (longTermAssignments.length > 0) {
      longTermAssignments.slice(0, 3).forEach(({ emp, project, weeks }) => {
        suggestions.push(`<div class="sched-suggestion rotate"><span class="sugg-icon">🔄</span><span class="sugg-text">${i18n.t('schedule.rotationSuggestion').replace('{0}', '<strong>' + emp.firstName + '</strong>').replace('{1}', '<em>' + project + '</em>').replace('{2}', String(weeks))}</span></div>`);
      });
    }
    
    if (experienceImbalance.length > 0) {
      experienceImbalance.slice(0, 2).forEach(({ project, experienced, inexperienced }) => {
        suggestions.push(`<div class="sched-suggestion balance"><span class="sugg-icon">📊</span><span class="sugg-text">${i18n.t('schedule.experienceSuggestion').replace('{0}', '<em>' + project + '</em>').replace('{1}', '<strong>' + experienced.emp.firstName + '</strong>').replace('{2}', String(experienced.count)).replace('{3}', '<strong>' + inexperienced.emp.firstName + '</strong>').replace('{4}', String(inexperienced.count))}</span></div>`);
      });
    }
    
    if (overloadedEmployees.length > 0 && underloadedEmployees.length > 0) {
      const over = overloadedEmployees[0];
      const under = underloadedEmployees[0];
      const overHours = (over.minutes / 60).toFixed(1);
      const underHours = (under.minutes / 60).toFixed(1);
      suggestions.push(`<div class="sched-suggestion workload"><span class="sugg-icon">⚖️</span><span class="sugg-text">${i18n.t('schedule.workloadBalanceSuggestion').replace('{0}', '<strong>' + over.emp.firstName + '</strong>').replace('{1}', overHours + 'h').replace('{2}', '<strong>' + under.emp.firstName + '</strong>').replace('{3}', underHours + 'h')}</span></div>`);
    } else if (underloadedEmployees.length > 0) {
      // Even if no one is overloaded, warn about underloaded
      const under = underloadedEmployees[0];
      const underHours = (under.minutes / 60).toFixed(1);
      suggestions.push(`<div class="sched-suggestion workload"><span class="sugg-icon">⚖️</span><span class="sugg-text">${i18n.t('schedule.underloadedWarn').replace('{0}', '<strong>' + under.emp.firstName + '</strong>').replace('{1}', underHours + 'h')}</span></div>`);
    }
    
    if (shiftImbalance) {
      suggestions.push(`<div class="sched-suggestion shift"><span class="sugg-icon">🔀</span><span class="sugg-text">${i18n.t('schedule.shiftImbalance').replace('{0}', String(shiftImbalance.from)).replace('{1}', String(shiftImbalance.diff)).replace('{2}', String(shiftImbalance.to))}</span></div>`);
    }
    
    optimalSuggestions.slice(0, 2).forEach(({ project, suggestedEmp, reason }) => {
      suggestions.push(`<div class="sched-suggestion optimal"><span class="sugg-icon">💡</span><span class="sugg-text">${i18n.t('schedule.assignSuggestion').replace('{0}', '<strong>' + suggestedEmp.firstName + '</strong>').replace('{1}', '<em>' + project + '</em>').replace('{2}', reason)}</span></div>`);
    });
    
    panel.innerHTML = `
      <div class="sched-stats-grid">
        <div class="sched-stat-item">
          <span class="sched-stat-value">${assignedEmployeeIds.size}</span>
          <span class="sched-stat-label">${i18n.t('schedule.assigned')}</span>
        </div>
        <div class="sched-stat-item">
          <span class="sched-stat-value">${unassignedCount}</span>
          <span class="sched-stat-label">${i18n.t('schedule.freeLabel')}</span>
        </div>
        <div class="sched-stat-item">
          <span class="sched-stat-value">${absentEmployees.length}</span>
          <span class="sched-stat-label">${i18n.t('schedule.absent')}</span>
        </div>
        <div class="sched-stat-item">
          <span class="sched-stat-value">${coveragePercent}%</span>
          <span class="sched-stat-label">${i18n.t('schedule.coverageLabel')}</span>
        </div>
      </div>
      
      <div class="sched-stats-coverage">
        <div class="sched-coverage-bar">
          <div class="sched-coverage-fill" style="width: ${coveragePercent}%"></div>
        </div>
        <div class="sched-coverage-legend">
          <span class="sched-coverage-item full"><span class="dot"></span>${fullyCovered} ${i18n.t('schedule.fullLabel')}</span>
          <span class="sched-coverage-item partial"><span class="dot"></span>${partiallyCovered} ${i18n.t('schedule.partialLabel')}</span>
          <span class="sched-coverage-item empty"><span class="dot"></span>${notCovered} ${i18n.t('schedule.noneLabel')}</span>
        </div>
      </div>
      
      ${alerts.length > 0 ? `
        <div class="sched-alerts-section">
          <h5>⚠️ ${i18n.t('schedule.alertsTitle')}</h5>
          ${alerts.join('')}
        </div>
      ` : ''}
      
      ${suggestions.length > 0 ? `
        <div class="sched-suggestions-section">
          <h5>💡 ${i18n.t('schedule.suggestionsTitle')}</h5>
          ${suggestions.join('')}
        </div>
      ` : '<div class="sched-no-suggestions">✅ ' + i18n.t('schedule.noSuggestions') + '</div>'}
    `;
  }
  
  // Render history panel in sidebar
  private renderScheduleHistoryPanel(): void {
    const panel = document.getElementById('scheduleHistoryPanel');
    if (!panel) return;
    
    // Pobierz logi z bazy danych zamiast localStorage
    const recentLogs = this.logs
      .filter(log => log.entityType === 'Assignment' || log.entityType === 'Employee' || log.entityType === 'ScheduleEntry')
      .slice(0, 5);
    
    if (recentLogs.length === 0) {
      panel.innerHTML = '<p class="sched-panel-empty">' + i18n.t('schedule.noRecentChanges') + '</p>';
      return;
    }
    
    panel.innerHTML = `
      <div class="sched-history-mini-list">
        ${recentLogs.map(log => {
          const isAdded = log.action === 'created';
          const isRemoved = log.action === 'deleted';
          const iconClass = isAdded ? 'added' : isRemoved ? 'removed' : 'modified';
          const iconSvg = isAdded 
            ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>'
            : isRemoved
            ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"/></svg>'
            : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>';
          
          const time = new Date(log.timestamp).toLocaleString(i18n.getDateLocale(), { 
            day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' 
          });
          
          return `
            <div class="sched-history-mini-item">
              <div class="sched-history-mini-icon ${iconClass}">${iconSvg}</div>
              <div class="sched-history-mini-content">
                <span class="sched-history-mini-text">${log.entityName}${log.details ? ` - ${log.details}` : ''}</span>
                <span class="sched-history-mini-time">${time}</span>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }
  
  // Show stats modal
  private showStatsModal(): void {
    const weekKey = `${this.scheduleCurrentYear}-KW${this.scheduleCurrentWeek.toString().padStart(2, '0')}`;
    const weekAssignments = this.state.scheduleAssignments.filter((a: ScheduleAssignment) => a.week === weekKey);
    const allAssignments = this.state.scheduleAssignments;
    
    // === STATYSTYKI PRACOWNIKÓW ===
    const availableEmployees = this.state.employees.filter(e => !e.status || e.status === 'available');
    const employeeStats = availableEmployees
      .map(emp => {
        const empAssignments = weekAssignments.filter(a => a.employeeId === emp.id);
        const shifts = empAssignments.map(a => a.shift);
        const projects = [...new Set(empAssignments.map(a => {
          const parts = a.projectId.split('-');
          const customer = this.state.customers.find(c => c.id === parts[0]);
          return customer?.name || '?';
        }))];
        return {
          id: emp.id,
          name: `${emp.firstName} ${emp.lastName}`,
          firstName: emp.firstName,
          tasks: empAssignments.length,
          shifts: [...new Set(shifts)],
          projects
        };
      })
      .sort((a, b) => b.tasks - a.tasks);
    
    const maxTasks = Math.max(...employeeStats.map(e => e.tasks), 1);
    const avgTasks = employeeStats.length > 0 ? employeeStats.reduce((sum, e) => sum + e.tasks, 0) / employeeStats.length : 0;
    
    // === STATYSTYKI ZMIAN ===
    const shiftStats = [1, 2, 3].map(shift => {
      const count = weekAssignments.filter(a => a.shift === shift).length;
      const employees = [...new Set(weekAssignments.filter(a => a.shift === shift).map(a => a.employeeId))].length;
      return { shift, count, employees };
    }).filter((_, i) => i < this.scheduleShiftSystem);
    
    const totalShiftAssignments = shiftStats.reduce((sum, s) => sum + s.count, 0);
    
    // === STATYSTYKI PROJEKTÓW ===
    const projectStats = new Map<string, {name: string; assignments: number; employees: Set<string>; shifts: Set<number>}>();
    weekAssignments.forEach(a => {
      const parts = a.projectId.split('-');
      const customer = this.state.customers.find(c => c.id === parts[0]);
      const type = this.state.types.find(t => t.id === parts[1]);
      const name = customer && type ? `${customer.name} ${type.name}` : a.projectId;
      
      if (!projectStats.has(a.projectId)) {
        projectStats.set(a.projectId, { name, assignments: 0, employees: new Set(), shifts: new Set() });
      }
      const stat = projectStats.get(a.projectId)!;
      stat.assignments++;
      stat.employees.add(a.employeeId);
      stat.shifts.add(a.shift);
    });
    
    const projectsWithSoll = this.state.projects.filter(p => {
      if (p.hidden) return false;
      const weekData = p.weeks?.[weekKey];
      return weekData && weekData.soll > 0;
    });
    
    const projectGroupsSet = new Set<string>();
    projectsWithSoll.forEach(p => projectGroupsSet.add(`${p.customer_id}-${p.type_id}`));
    const totalProjects = projectGroupsSet.size;
    const coveredProjects = projectStats.size;
    const coveragePercent = totalProjects > 0 ? Math.round((coveredProjects / totalProjects) * 100) : 100;
    
    // === HISTORIA TYGODNIOWA ===
    const weeklyHistory: Array<{week: string; assignments: number; employees: number}> = [];
    for (let i = 5; i >= 0; i--) {
      let checkWeek = this.scheduleCurrentWeek - i;
      let checkYear = this.scheduleCurrentYear;
      if (checkWeek < 1) { checkWeek += 52; checkYear--; }
      const checkKey = `${checkYear}-KW${checkWeek.toString().padStart(2, '0')}`;
      const weekAssigns = allAssignments.filter((a: ScheduleAssignment) => a.week === checkKey);
      weeklyHistory.push({
        week: `KW${checkWeek}`,
        assignments: weekAssigns.length,
        employees: new Set(weekAssigns.map(a => a.employeeId)).size
      });
    }
    const maxHistoryAssignments = Math.max(...weeklyHistory.map(w => w.assignments), 1);
    
    // === TOP PRACOWNICY W MIESIĄCU ===
    const monthlyStats = new Map<string, number>();
    for (let i = 0; i < 4; i++) {
      let checkWeek = this.scheduleCurrentWeek - i;
      let checkYear = this.scheduleCurrentYear;
      if (checkWeek < 1) { checkWeek += 52; checkYear--; }
      const checkKey = `${checkYear}-KW${checkWeek.toString().padStart(2, '0')}`;
      allAssignments.filter((a: ScheduleAssignment) => a.week === checkKey).forEach(a => {
        monthlyStats.set(a.employeeId, (monthlyStats.get(a.employeeId) || 0) + 1);
      });
    }
    const topMonthlyWorkers = [...monthlyStats.entries()]
      .map(([empId, count]) => {
        const emp = this.state.employees.find(e => e.id === empId);
        return { name: emp ? `${emp.firstName} ${emp.lastName}` : '?', count };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
    
    // === DOŚWIADCZENIE PRACOWNIKÓW NA PROJEKTACH ===
    const employeeProjectExperience = new Map<string, Map<string, number>>(); // empId -> projectName -> count
    allAssignments.forEach((a: ScheduleAssignment) => {
      const parts = a.projectId.split('-');
      const customer = this.state.customers.find(c => c.id === parts[0]);
      const projectName = customer?.name || '?';
      
      if (!employeeProjectExperience.has(a.employeeId)) {
        employeeProjectExperience.set(a.employeeId, new Map());
      }
      const empProjects = employeeProjectExperience.get(a.employeeId)!;
      empProjects.set(projectName, (empProjects.get(projectName) || 0) + 1);
    });
    
    // Przygotuj dane do wykresu - top 8 pracowników z największym doświadczeniem
    const experienceData = availableEmployees
      .map(emp => {
        const projects = employeeProjectExperience.get(emp.id) || new Map();
        const totalExp = [...projects.values()].reduce((sum, c) => sum + c, 0);
        const projectList = [...projects.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 4)
          .map(([name, count]) => ({ name, count }));
        return {
          name: `${emp.firstName} ${emp.lastName}`,
          firstName: emp.firstName,
          totalExp,
          projects: projectList
        };
      })
      .filter(e => e.totalExp > 0)
      .sort((a, b) => b.totalExp - a.totalExp)
      .slice(0, 8);
    
    const maxExp = Math.max(...experienceData.map(e => e.totalExp), 1);
    
    // Zbierz unikalne projekty dla legendy
    const allProjectNames = new Set<string>();
    experienceData.forEach(e => e.projects.forEach(p => allProjectNames.add(p.name)));
    const projectColors = ['#3b82f6', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];
    const projectColorMap = new Map<string, string>();
    [...allProjectNames].slice(0, 8).forEach((name, i) => projectColorMap.set(name, projectColors[i % projectColors.length]));
    
    // === GENERUJ HTML ===
    const overlay = document.createElement('div');
    overlay.className = 'employee-modal-overlay';
    overlay.innerHTML = `
      <div class="employee-modal stats-modal-wide">
        <div class="employee-modal-header">
          <div class="employee-modal-info">
            <h2>${i18n.t('schedule.detailedStatsTitle').replace('{0}', this.scheduleCurrentWeek.toString().padStart(2, '0')).replace('{1}', String(this.scheduleCurrentYear))}</h2>
          </div>
          <button class="employee-modal-close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="employee-modal-body stats-modal-body">
          
          <!-- SEKCJA 1: Podsumowanie -->
          <div class="stats-section stats-summary">
            <div class="stats-summary-card">
              <div class="stats-card-value">${weekAssignments.length}</div>
              <div class="stats-card-label">${i18n.t('schedule.assignmentsLabel')}</div>
            </div>
            <div class="stats-summary-card">
              <div class="stats-card-value">${new Set(weekAssignments.map(a => a.employeeId)).size}</div>
              <div class="stats-card-label">${i18n.t('schedule.employeesLabel')}</div>
            </div>
            <div class="stats-summary-card">
              <div class="stats-card-value">${coveredProjects}/${totalProjects}</div>
              <div class="stats-card-label">${i18n.t('schedule.projectsLabel')}</div>
            </div>
            <div class="stats-summary-card ${coveragePercent === 100 ? 'success' : coveragePercent >= 80 ? 'warning' : 'danger'}">
              <div class="stats-card-value">${coveragePercent}%</div>
              <div class="stats-card-label">${i18n.t('schedule.coverageLabel')}</div>
            </div>
          </div>
          
          <!-- SEKCJA 2: Wykres zmian -->
          <div class="stats-section">
            <h4>📈 ${i18n.t('schedule.shiftDistribution')}</h4>
            <div class="stats-shift-chart">
              ${shiftStats.map(s => `
                <div class="stats-shift-bar">
                  <div class="stats-bar-label">${i18n.t('schedule.shiftN').replace('{0}', String(s.shift))}</div>
                  <div class="stats-bar-track">
                    <div class="stats-bar-fill shift-${s.shift}" style="width: ${totalShiftAssignments > 0 ? (s.count / totalShiftAssignments * 100) : 0}%"></div>
                  </div>
                  <div class="stats-bar-value">${s.count} <small>(${i18n.t('schedule.personsAbbr').replace('{0}', String(s.employees))})</small></div>
                </div>
              `).join('')}
            </div>
          </div>
          
          <!-- SEKCJA 3: Wykres obciążenia pracowników -->
          <div class="stats-section">
            <h4>${i18n.t('schedule.workloadTitle')}</h4>
            <div class="stats-employee-chart">
              ${employeeStats.slice(0, 10).map(e => `
                <div class="stats-emp-bar ${e.tasks === 0 ? 'zero' : e.tasks > avgTasks * 1.5 ? 'high' : e.tasks < avgTasks * 0.5 ? 'low' : ''}">
                  <div class="stats-emp-name">${e.firstName}</div>
                  <div class="stats-emp-track">
                    <div class="stats-emp-fill" style="width: ${(e.tasks / maxTasks * 100)}%"></div>
                  </div>
                  <div class="stats-emp-value">${e.tasks}</div>
                </div>
              `).join('')}
              ${employeeStats.length > 10 ? `<div class="stats-more-hint">${i18n.t('schedule.andMore').replace('{0}', String(employeeStats.length - 10))}</div>` : ''}
            </div>
          </div>
          
          <!-- SEKCJA 4: Trend tygodniowy -->
          <div class="stats-section">
            <h4>📅 ${i18n.t('schedule.trendLastWeeks')}</h4>
            <div class="stats-trend-chart">
              ${weeklyHistory.map((w, i) => `
                <div class="stats-trend-bar ${i === weeklyHistory.length - 1 ? 'current' : ''}">
                  <div class="stats-trend-fill" style="height: ${(w.assignments / maxHistoryAssignments * 100)}%">
                    <span class="stats-trend-value">${w.assignments}</span>
                  </div>
                  <div class="stats-trend-label">${w.week}</div>
                </div>
              `).join('')}
            </div>
          </div>
          
          <!-- SEKCJA 5: Top pracownicy miesiąca -->
          <div class="stats-section">
            <h4>${i18n.t('schedule.topEmployees')}</h4>
            <div class="stats-top-list">
              ${topMonthlyWorkers.map((w, i) => `
                <div class="stats-top-item">
                  <span class="stats-top-rank">${i + 1}.</span>
                  <span class="stats-top-name">${w.name}</span>
                  <span class="stats-top-count">${i18n.t('schedule.assignmentsCount').replace('{0}', String(w.count))}</span>
                </div>
              `).join('')}
            </div>
          </div>
          
          <!-- SEKCJA 6: Doświadczenie pracowników na projektach -->
          <div class="stats-section stats-experience-section">
            <h4>${i18n.t('schedule.experienceTitle')}</h4>
            <div class="stats-experience-legend">
              ${[...projectColorMap.entries()].map(([name, color]) => `
                <span class="stats-legend-item"><span class="stats-legend-dot" style="background: ${color}"></span>${name}</span>
              `).join('')}
            </div>
            <div class="stats-experience-chart">
              ${experienceData.map(e => `
                <div class="stats-exp-row">
                  <div class="stats-exp-name">${e.firstName}</div>
                  <div class="stats-exp-bar-container">
                    <div class="stats-exp-bar">
                      ${e.projects.map(p => `
                        <div class="stats-exp-segment" style="width: ${(p.count / maxExp * 100)}%; background: ${projectColorMap.get(p.name) || '#888'}" title="${p.name}: ${i18n.t('schedule.timesCount').replace('{0}', String(p.count))}"></div>
                      `).join('')}
                    </div>
                  </div>
                  <div class="stats-exp-total">${e.totalExp}</div>
                </div>
              `).join('')}
            </div>
          </div>
          
          <!-- SEKCJA 7: Tabela szczegółowa -->
          <div class="stats-section">
            <h4>${i18n.t('schedule.employeeDetails')}</h4>
            <div class="stats-detail-table">
              <div class="stats-table-header">
                <span>${i18n.t('schedule.employeeLabel')}</span>
                <span>${i18n.t('schedule.assignmentsCol')}</span>
                <span>${i18n.t('schedule.shiftsCol')}</span>
                <span>${i18n.t('schedule.projectsCol')}</span>
              </div>
              ${employeeStats.map(e => `
                <div class="stats-table-row ${e.tasks === 0 ? 'inactive' : ''}">
                  <span class="stats-table-name">${e.name}</span>
                  <span class="stats-table-tasks">${e.tasks}</span>
                  <span class="stats-table-shifts">${e.shifts.length > 0 ? e.shifts.map(s => `Z${s}`).join(', ') : '-'}</span>
                  <span class="stats-table-projects">${e.projects.length > 0 ? e.projects.slice(0, 2).join(', ') + (e.projects.length > 2 ? '...' : '') : '-'}</span>
                </div>
              `).join('')}
            </div>
          </div>
          
        </div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    
    overlay.querySelector('.employee-modal-close')?.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
  }
  
  // Podświetlanie przypisań pracownika w tabeli
  private highlightEmployeeAssignments(employeeId: string, highlight: boolean): void {
    // Znajdź wszystkie chipy tego pracownika
    document.querySelectorAll(`.sched-chip[data-employee-id="${employeeId}"]`).forEach(chip => {
      if (highlight) {
        chip.classList.add('highlighted');
        // Podświetl też komórkę nadrzędną
        const cell = chip.closest('.sched-shift-cell');
        cell?.classList.add('employee-highlight');
      } else {
        chip.classList.remove('highlighted');
        const cell = chip.closest('.sched-shift-cell');
        cell?.classList.remove('employee-highlight');
      }
    });
    
    // Podświetl też w widoku multi-week
    document.querySelectorAll(`.sched-mini-avatar`).forEach(avatar => {
      const title = avatar.getAttribute('title') || '';
      const emp = this.state.employees.find(e => e.id === employeeId);
      if (emp && title.includes(emp.firstName)) {
        if (highlight) {
          avatar.classList.add('highlighted');
          avatar.closest('.sched-week-cell')?.classList.add('employee-highlight');
        } else {
          avatar.classList.remove('highlighted');
          avatar.closest('.sched-week-cell')?.classList.remove('employee-highlight');
        }
      }
    });
  }
  
  // Dodanie nieobecności dla pracownika
  private async addAbsenceForEmployee(employeeId: string, type: 'vacation' | 'sick'): Promise<void> {
    const emp = this.state.employees.find(e => e.id === employeeId);
    if (!emp) return;
    
    // Jeśli już ma ten status, przywróć do pracy
    if (emp.status === type) {
      emp.status = 'available';
      await db.put('employees', emp);
      this.showToast(i18n.t('schedule.returnedToWork').replace('{0}', emp.firstName + ' ' + emp.lastName), 'success');
    } else {
      emp.status = type;
      await db.put('employees', emp);
      this.showToast(type === 'vacation' ? i18n.t('schedule.onVacation').replace('{0}', emp.firstName + ' ' + emp.lastName) : i18n.t('schedule.onSickLeave').replace('{0}', emp.firstName + ' ' + emp.lastName), 'success');
    }
    
    this.renderScheduleEmployeePanel();
  }
  
  // Popup z detalami przypisań pracownika
  private showEmployeeHoverPopup(event: MouseEvent, employeeId: string): void {
    this.hideEmployeeHoverPopup();
    
    const emp = this.state.employees.find(e => e.id === employeeId);
    if (!emp) return;
    
    const weekKey = `${this.scheduleCurrentYear}-KW${this.scheduleCurrentWeek.toString().padStart(2, '0')}`;
    const assignments = this.state.scheduleAssignments.filter(
      (a: ScheduleAssignment) => a.employeeId === employeeId && a.week === weekKey
    );
    
    if (assignments.length === 0) return;
    
    // Grupuj po projekcie i zmianie
    const grouped = new Map<string, { customer: string; type: string; shifts: number[]; scopes: string[]; notes: string[] }>();
    
    assignments.forEach((a: ScheduleAssignment) => {
      const project = this.state.projects.find(p => p.id === a.projectId || `${p.customer_id}-${p.type_id}` === a.projectId);
      if (project) {
        const customer = this.state.customers.find(c => c.id === project.customer_id);
        const type = this.state.types.find(t => t.id === project.type_id);
        const key = a.projectId;
        
        if (!grouped.has(key)) {
          grouped.set(key, {
            customer: customer?.name || '?',
            type: type?.name || '?',
            shifts: [],
            scopes: [],
            notes: []
          });
        }
        const g = grouped.get(key)!;
        if (!g.shifts.includes(a.shift)) g.shifts.push(a.shift);
        
        // Dodaj konkretny zakres pracy zamiast 'specific'
        let scopeLabel = '';
        if (a.scope === 'adhesion') {
          scopeLabel = `🧪 ${i18n.t('schedule.scopeAdhesion')}`;
        } else if (a.scope === 'audit') {
          scopeLabel = `🔍 ${i18n.t('schedule.scopeAudit')}`;
        } else if (a.testId) {
          const test = this.state.tests.find(t => t.id === a.testId);
          scopeLabel = `⚙️ ${test?.name || 'Test'}`;
        } else if (a.partId) {
          const part = this.state.parts.find(p => p.id === a.partId);
          scopeLabel = `📦 ${part?.name || i18n.t('schedule.part')}`;
        } else if (a.scope === 'project') {
          scopeLabel = `📋 ${i18n.t('schedule.scopeFullProject')}`;
        }
        
        if (scopeLabel && !g.scopes.includes(scopeLabel)) g.scopes.push(scopeLabel);
        
        // Dodaj notatkę jeśli istnieje
        if (a.note && a.note.trim()) {
          g.notes.push(`Z${a.shift}: ${a.note}`);
        }
      }
    });
    
    // Sprawdź czy są jakiekolwiek notatki
    const hasAnyNotes = Array.from(grouped.values()).some(g => g.notes.length > 0);
    
    const popup = document.createElement('div');
    popup.className = 'sched-employee-popup';
    popup.innerHTML = `
      <div class="sched-popup-header" style="background: ${emp.color}">
        <span class="sched-popup-avatar">${emp.firstName.charAt(0)}${emp.lastName.charAt(0)}</span>
        <span class="sched-popup-name">${emp.firstName} ${emp.lastName}</span>
        ${hasAnyNotes ? '<span class="sched-popup-note-badge">📝</span>' : ''}
      </div>
      <div class="sched-popup-content">
        <div class="sched-popup-week">${i18n.t('schedule.weekAssignments').replace('{0}', String(this.scheduleCurrentWeek)).replace('{1}', String(assignments.length))}</div>
        ${Array.from(grouped.entries()).map(([_, g]) => `
          <div class="sched-popup-assignment">
            <div class="sched-popup-project">${g.customer}</div>
            <div class="sched-popup-details">
              <span class="sched-popup-type">${g.type}</span>
              <span class="sched-popup-shifts">${g.shifts.sort().map(s => `Z${s}`).join(', ')}</span>
              ${g.scopes.length > 0 ? `<span class="sched-popup-scopes">${g.scopes.join(', ')}</span>` : ''}
            </div>
            ${g.notes.length > 0 ? `
              <div class="sched-popup-notes">
                ${g.notes.map(n => `<div class="sched-popup-note">📝 ${n}</div>`).join('')}
              </div>
            ` : ''}
          </div>
        `).join('')}
      </div>
    `;
    
    document.body.appendChild(popup);
    
    // Pozycjonowanie
    const rect = (event.target as HTMLElement).getBoundingClientRect();
    const popupRect = popup.getBoundingClientRect();
    
    let left = rect.right + 8;
    let top = rect.top;
    
    // Sprawdź czy mieści się na ekranie
    if (left + popupRect.width > window.innerWidth) {
      left = rect.left - popupRect.width - 8;
    }
    if (top + popupRect.height > window.innerHeight) {
      top = window.innerHeight - popupRect.height - 8;
    }
    
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
  }
  
  private hideEmployeeHoverPopup(): void {
    document.querySelector('.sched-employee-popup')?.remove();
  }
  
  // Hover popup dla projektu
  private showProjectHoverPopup(
    event: MouseEvent, 
    groupKey: string, 
    group: { customerName: string; typeName: string; customerId: string; items: Project[] },
    assignments: ScheduleAssignment[],
    staffingStatus: { class: string; icon: string; tooltip: string }
  ): void {
    this.hideProjectHoverPopup();
    
    const weekKey = `${this.scheduleCurrentYear}-KW${this.scheduleCurrentWeek.toString().padStart(2, '0')}`;
    
    // Zbierz informacje o pracownikach przypisanych
    const employeesByShift = new Map<number, Array<{ name: string; scope: string; color: string }>>();
    
    assignments.forEach((a: ScheduleAssignment) => {
      const emp = this.state.employees.find(e => e.id === a.employeeId);
      if (!emp) return;
      
      if (!employeesByShift.has(a.shift)) {
        employeesByShift.set(a.shift, []);
      }
      
      let scopeLabel = '';
      if (a.scope === 'adhesion') scopeLabel = i18n.t('schedule.scopeAdhesion');
      else if (a.scope === 'audit') scopeLabel = i18n.t('schedule.scopeAudit');
      else if (a.scope === 'project') scopeLabel = i18n.t('schedule.scopeFullProject');
      else if (a.testId) {
        const test = this.state.tests.find(t => t.id === a.testId);
        scopeLabel = test?.name || 'Test';
      }
      
      employeesByShift.get(a.shift)!.push({
        name: `${emp.firstName} ${emp.lastName}`,
        scope: scopeLabel,
        color: emp.color
      });
    });
    
    // Zbierz wszystkie testy w tym projekcie
    const uniqueTests = new Map<string, { name: string; covered: boolean }>();
    group.items.forEach(p => {
      if (p.test_id) {
        const test = this.state.tests.find(t => t.id === p.test_id);
        if (test) {
          const isCovered = assignments.some(a => 
            a.scope === 'project' || 
            a.testId === test.id ||
            (a.scope === 'audit' && (test.name.toLowerCase().includes('audit') || test.name.toLowerCase().includes('audyt'))) ||
            (a.scope === 'adhesion' && (test.name.toLowerCase().includes('peel') || test.name.toLowerCase().includes('adhesion') || test.name.toLowerCase().includes('przyczep')))
          );
          uniqueTests.set(test.id, { name: test.name, covered: isCovered });
        }
      }
    });
    
    // Oblicz SOLL dla tego projektu
    let totalSoll = 0;
    let totalIst = 0;
    group.items.forEach(p => {
      const weekData = p.weeks[weekKey];
      if (weekData) {
        totalSoll += weekData.soll || 0;
        totalIst += weekData.ist || 0;
      }
    });
    
    const popup = document.createElement('div');
    popup.className = 'sched-project-popup';
    
    // Kolor nagłówka zależny od statusu
    const headerColor = staffingStatus.class === 'staffing-full' ? '#10b981' : 
                        staffingStatus.class === 'staffing-partial' ? '#f59e0b' : '#94a3b8';
    
    popup.innerHTML = `
      <div class="sched-popup-header" style="background: ${headerColor}">
        <span class="sched-popup-avatar">${group.customerName.charAt(0)}</span>
        <div class="sched-popup-project-info">
          <span class="sched-popup-name">${group.customerName}</span>
          <span class="sched-popup-type-label">${group.typeName}</span>
        </div>
        <span class="sched-popup-status-icon">${staffingStatus.icon}</span>
      </div>
      <div class="sched-popup-content">
        <div class="sched-popup-week">KW${this.scheduleCurrentWeek} • SOLL: ${totalSoll} | IST: ${totalIst}</div>
        
        ${uniqueTests.size > 0 ? `
          <div class="sched-popup-tests">
            <div class="sched-popup-section-title">Testy:</div>
            ${Array.from(uniqueTests.values()).map(t => `
              <span class="sched-popup-test ${t.covered ? 'covered' : 'uncovered'}">
                ${t.covered ? '✓' : '○'} ${t.name}
              </span>
            `).join('')}
          </div>
        ` : ''}
        
        ${employeesByShift.size > 0 ? `
          <div class="sched-popup-employees">
            <div class="sched-popup-section-title">Obsada:</div>
            ${[1, 2, 3].filter(s => employeesByShift.has(s)).map(s => `
              <div class="sched-popup-shift-group">
                <span class="sched-popup-shift-label">Z${s}:</span>
                ${employeesByShift.get(s)!.map(e => `
                  <span class="sched-popup-emp-chip" style="--emp-color: ${e.color}">
                    ${e.name}${e.scope ? ` (${e.scope})` : ''}
                  </span>
                `).join('')}
              </div>
            `).join('')}
          </div>
        ` : `
          <div class="sched-popup-no-staff">
            <span class="sched-popup-warning">${i18n.t('schedule.noAssignedEmployees')}</span>
          </div>
        `}
        
        ${staffingStatus.class === 'staffing-partial' ? `
          <div class="sched-popup-missing">
            <span class="sched-popup-missing-label">⚠️ ${staffingStatus.tooltip}</span>
          </div>
        ` : ''}
      </div>
    `;
    
    document.body.appendChild(popup);
    
    // Pozycjonowanie
    const rect = (event.target as HTMLElement).getBoundingClientRect();
    const popupRect = popup.getBoundingClientRect();
    
    let left = rect.right + 8;
    let top = rect.top;
    
    if (left + popupRect.width > window.innerWidth) {
      left = rect.left - popupRect.width - 8;
    }
    if (top + popupRect.height > window.innerHeight) {
      top = window.innerHeight - popupRect.height - 8;
    }
    if (top < 10) top = 10;
    
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
  }
  
  private hideProjectHoverPopup(): void {
    document.querySelector('.sched-project-popup')?.remove();
  }

  // Modal pracownika z pełnym grafikiem
  private showEmployeeModal(employeeId: string): void {
    const emp = this.state.employees.find(e => e.id === employeeId);
    if (!emp) return;
    
    // Zamknij hover popup
    this.hideEmployeeHoverPopup();
    
    const weekKey = `${this.scheduleCurrentYear}-KW${this.scheduleCurrentWeek.toString().padStart(2, '0')}`;
    const weekDates = this.getWeekDateRange(this.scheduleCurrentYear, this.scheduleCurrentWeek);
    
    // Pobierz wszystkie przypisania pracownika w tym tygodniu
    const assignments = this.state.scheduleAssignments.filter(
      (a: ScheduleAssignment) => a.employeeId === employeeId && a.week === weekKey
    );
    
    // Grupuj po projekcie
    const projectTasks = new Map<string, {
      customer: string;
      type: string;
      shifts: number[];
      scope: string;
      scopeClass: string;
      details: string[];
      notes: string[];
    }>();
    
    assignments.forEach((a: ScheduleAssignment) => {
      const project = this.state.projects.find(p => 
        p.id === a.projectId || `${p.customer_id}-${p.type_id}` === a.projectId
      );
      if (!project) return;
      
      const customer = this.state.customers.find(c => c.id === project.customer_id);
      const type = this.state.types.find(t => t.id === project.type_id);
      const key = a.projectId;
      
      // Określ zakres pracy
      let scope = i18n.t('schedule.scopeFullProject');
      let scopeClass = '';
      const details: string[] = [];
      
      if (a.scope === 'adhesion') {
        scope = i18n.t('schedule.scopeAdhesion');
        scopeClass = 'scope-adhesion';
      } else if (a.scope === 'audit') {
        scope = i18n.t('schedule.scopeAudit');
        scopeClass = 'scope-audit';
      } else if (a.testId) {
        const test = this.state.tests.find(t => t.id === a.testId);
        scope = test?.name || 'Test';
        scopeClass = 'scope-test';
      } else if (a.partId) {
        const part = this.state.parts.find(p => p.id === a.partId);
        scope = part?.name || i18n.t('schedule.partDefault');
        scopeClass = 'scope-part';
      }
      
      if (!projectTasks.has(key)) {
        projectTasks.set(key, {
          customer: customer?.name || '?',
          type: type?.name || '?',
          shifts: [],
          scope,
          scopeClass,
          details,
          notes: []
        });
      }
      
      const task = projectTasks.get(key)!;
      if (!task.shifts.includes(a.shift)) {
        task.shifts.push(a.shift);
      }
      if (a.note && a.note.trim()) {
        task.notes.push(`Z${a.shift}: ${a.note}`);
      }
    });
    
    // Oblicz statystyki
    const totalShifts = assignments.length;
    const uniqueProjects = projectTasks.size;
    
    // Dni tygodnia
    const days = [
      i18n.t('schedule.weekdayMon'), i18n.t('schedule.weekdayTue'), i18n.t('schedule.weekdayWed'),
      i18n.t('schedule.weekdayThu'), i18n.t('schedule.weekdayFri'), i18n.t('schedule.weekdaySat'), i18n.t('schedule.weekdaySun')
    ];
    const shiftNames = [i18n.t('schedule.shiftMorningShort'), i18n.t('schedule.shiftAfternoonShort'), i18n.t('schedule.shiftNightShort')];
    
    // Utwórz overlay
    const overlay = document.createElement('div');
    overlay.className = 'employee-modal-overlay';
    overlay.innerHTML = `
      <div class="employee-modal">
        <div class="employee-modal-header">
          <div class="employee-modal-avatar" style="background: ${emp.color}">${emp.firstName.charAt(0)}${emp.lastName.charAt(0)}</div>
          <div class="employee-modal-info">
            <h2>${emp.firstName} ${emp.lastName}</h2>
            <div class="employee-modal-stats">
              <span class="employee-modal-stat">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                KW${this.scheduleCurrentWeek} (${weekDates.start.slice(0, 5)} - ${weekDates.end.slice(0, 5)})
              </span>
              <span class="employee-modal-stat">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
                ${uniqueProjects === 1 ? i18n.t('schedule.nProjects1').replace('{0}', String(uniqueProjects)) : i18n.t('schedule.nProjectsMany').replace('{0}', String(uniqueProjects))}
              </span>
              <span class="employee-modal-stat">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                ${totalShifts} ${totalShifts === 1 ? i18n.t('schedule.shiftSingular') : i18n.t('schedule.shiftPlural')}
              </span>
            </div>
          </div>
          <button class="employee-modal-close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="employee-modal-body">
          ${projectTasks.size > 0 ? `
            <div class="employee-modal-section">
              <h3>📋 ${i18n.t('schedule.tasksThisWeek')}</h3>
              <div class="employee-tasks-list">
                ${Array.from(projectTasks.entries()).map(([_, task]) => `
                  <div class="employee-task-item">
                    <div class="employee-task-icon">${task.customer.charAt(0)}</div>
                    <div class="employee-task-content">
                      <div class="employee-task-project">${task.customer} – ${task.type}</div>
                      <div class="employee-task-details">
                        <span class="employee-task-tag ${task.scopeClass}">${task.scope}</span>
                        ${task.shifts.sort().map(s => `<span class="employee-task-tag shift">Z${s} ${shiftNames[s-1]}</span>`).join('')}
                        ${task.details.slice(0, 3).map(d => `<span class="employee-task-tag">${d}</span>`).join('')}
                        ${task.details.length > 3 ? `<span class="employee-task-tag">${i18n.t('schedule.moreItems').replace('{0}', String(task.details.length - 3))}</span>` : ''}
                      </div>
                      ${task.notes.length > 0 ? `
                        <div class="employee-task-notes">
                          ${task.notes.map(n => `<div class="employee-task-note">📝 ${n}</div>`).join('')}
                        </div>
                      ` : ''}
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : `
            <div class="employee-modal-section">
              <h3>📋 ${i18n.t('schedule.tasksThisWeek')}</h3>
              <p style="color: var(--color-text-muted); font-size: 0.85rem;">${i18n.t('schedule.noAssignedTasks')}</p>
            </div>
          `}
          
          <div class="employee-modal-section">
            <h3>📊 ${i18n.t('schedule.statisticsTitle')}</h3>
            <div class="employee-stats-grid">
              ${(() => {
                // Oblicz statystyki z całego roku
                const yearAssignments = this.state.scheduleAssignments.filter(
                  (a: ScheduleAssignment) => a.employeeId === employeeId && a.week.startsWith(String(this.scheduleCurrentYear))
                );
                const monthAssignments = this.state.scheduleAssignments.filter(
                  (a: ScheduleAssignment) => {
                    if (a.employeeId !== employeeId) return false;
                    const weekNum = parseInt(a.week.split('KW')[1]);
                    const currentMonth = Math.ceil(this.scheduleCurrentWeek / 4.33);
                    const assignmentMonth = Math.ceil(weekNum / 4.33);
                    return assignmentMonth === currentMonth;
                  }
                );
                const shiftsThisMonth = monthAssignments.length;
                const shiftsThisYear = yearAssignments.length;
                const uniqueProjectsYear = new Set(yearAssignments.map((a: ScheduleAssignment) => a.projectId)).size;
                
                // Policz zmiany
                const shiftCounts = { 1: 0, 2: 0, 3: 0 };
                yearAssignments.forEach((a: ScheduleAssignment) => shiftCounts[a.shift as 1|2|3]++);
                const preferredShift = Object.entries(shiftCounts).sort((a, b) => b[1] - a[1])[0];
                
                return `
                  <div class="employee-stat-card">
                    <span class="employee-stat-value">${shiftsThisMonth}</span>
                    <span class="employee-stat-label">${i18n.t('schedule.shiftsInMonth')}</span>
                  </div>
                  <div class="employee-stat-card">
                    <span class="employee-stat-value">${shiftsThisYear}</span>
                    <span class="employee-stat-label">${i18n.t('schedule.shiftsInYear')}</span>
                  </div>
                  <div class="employee-stat-card">
                    <span class="employee-stat-value">${uniqueProjectsYear}</span>
                    <span class="employee-stat-label">${i18n.t('schedule.projectsInYear')}</span>
                  </div>
                `;
              })()}
            </div>
          </div>
          
          <div class="employee-modal-section">
            <h3>⚡ ${i18n.t('stats.quickActions')}</h3>
            <div class="employee-quick-actions">
              <button class="employee-action-btn" data-action="edit">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                ${i18n.t('stats.editData')}
              </button>
              <button class="employee-action-btn" data-action="vacation">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2"/></svg>
                ${emp.status === 'vacation' ? i18n.t('schedule.endVacation') : i18n.t('schedule.setVacation')}
              </button>
              <button class="employee-action-btn" data-action="sick">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
                ${emp.status === 'sick' ? i18n.t('schedule.endSickLeave') : i18n.t('schedule.setSickLeave')}
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    
    // Zamykanie
    overlay.querySelector('.employee-modal-close')?.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
    
    // Obsługa szybkich akcji
    overlay.querySelectorAll('.employee-action-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const action = (btn as HTMLElement).dataset.action;
        
        if (action === 'edit') {
          overlay.remove();
          this.editEmployee(employeeId);
        } else if (action === 'vacation') {
          emp.status = emp.status === 'vacation' ? 'available' : 'vacation';
          await db.put('employees', emp);
          this.showToast(emp.status === 'vacation' ? i18n.t('schedule.onVacation').replace('{0}', emp.firstName) : i18n.t('schedule.returnedFromVacation').replace('{0}', emp.firstName), 'success');
          overlay.remove();
          this.renderScheduleEmployeePanel();
        } else if (action === 'sick') {
          emp.status = emp.status === 'sick' ? 'available' : 'sick';
          await db.put('employees', emp);
          this.showToast(emp.status === 'sick' ? i18n.t('schedule.onSickLeave').replace('{0}', emp.firstName) : i18n.t('schedule.returnedFromSickLeave').replace('{0}', emp.firstName), 'success');
          overlay.remove();
          this.renderScheduleEmployeePanel();
        }
      });
    });
    
    // Escape
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        overlay.remove();
        document.removeEventListener('keydown', handleEscape);
      }
    };
    document.addEventListener('keydown', handleEscape);
  }

  // ==================== KOPIOWANIE TYGODNIA ====================
  private showCopyWeekModal(): void {
    const modal = document.getElementById('modal')!;
    const modalTitle = document.getElementById('modalTitle')!;
    const modalBody = document.getElementById('modalBody')!;
    
    const weeks: { year: number; week: number; label: string }[] = [];
    for (let i = 1; i <= 10; i++) {
      let week = this.scheduleCurrentWeek - i;
      let year = this.scheduleCurrentYear;
      if (week < 1) { week += 52; year--; }
      const weekKey = `${year}-KW${week.toString().padStart(2, '0')}`;
      const count = this.state.scheduleAssignments.filter((a: ScheduleAssignment) => a.week === weekKey).length;
      if (count > 0) {
        weeks.push({ year, week, label: `KW${week.toString().padStart(2, '0')} ${year} (${count} ${i18n.t('schedule.assignmentsLabel').toLowerCase()})` });
      }
    }
    
    modalTitle.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18" style="display:inline;vertical-align:middle;margin-right:8px">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
      </svg>
      ${i18n.t('schedule.copyWeekTitle')}
    `;
    
    modalBody.innerHTML = `
      <div class="copy-week-modal">
        <div class="info-box">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
          </svg>
          <span>${i18n.t('schedule.copyAssignmentsHint').replace('{0}', String(this.scheduleCurrentWeek))}</span>
        </div>
        
        ${weeks.length > 0 ? `
          <div class="form-group">
            <label class="form-label">${i18n.t('schedule.copyFrom')}</label>
            <select id="copySourceWeek" class="form-control">
              ${weeks.map(w => `<option value="${w.year}-${w.week}">${w.label}</option>`).join('')}
            </select>
          </div>
          
          <div class="form-group">
            <label class="form-checkbox">
              <input type="checkbox" id="copyOverwrite" checked>
              <span>${i18n.t('schedule.replaceExisting')}</span>
            </label>
          </div>
        ` : `
          <p class="form-hint">${i18n.t('schedule.noWeeksToCopy')}</p>
        `}
      </div>
    `;
    
    const confirmBtn = modal.querySelector('.modal-confirm') as HTMLButtonElement;
    if (weeks.length > 0) {
      confirmBtn.style.display = '';
      confirmBtn.textContent = i18n.t('schedule.copy');
      confirmBtn.onclick = async () => {
        const sourceVal = (document.getElementById('copySourceWeek') as HTMLSelectElement).value;
        const overwrite = (document.getElementById('copyOverwrite') as HTMLInputElement).checked;
        const [year, week] = sourceVal.split('-').map(Number);
        await this.copyWeekAssignments(year, week, overwrite);
        this.hideModal();
      };
    } else {
      confirmBtn.style.display = 'none';
    }
    
    modal.classList.add('active');
  }
  
  private async copyWeekAssignments(sourceYear: number, sourceWeek: number, overwrite: boolean): Promise<void> {
    const sourceWeekKey = `${sourceYear}-KW${sourceWeek.toString().padStart(2, '0')}`;
    const targetWeekKey = `${this.scheduleCurrentYear}-KW${this.scheduleCurrentWeek.toString().padStart(2, '0')}`;
    
    const sourceAssignments = this.state.scheduleAssignments.filter((a: ScheduleAssignment) => a.week === sourceWeekKey);
    
    if (overwrite) {
      // Usuń istniejące
      const existing = this.state.scheduleAssignments.filter((a: ScheduleAssignment) => a.week === targetWeekKey);
      for (const a of existing) {
        const idx = this.state.scheduleAssignments.indexOf(a);
        if (idx !== -1) {
          this.state.scheduleAssignments.splice(idx, 1);
          await db.delete('scheduleAssignments', a.id);
        }
      }
    }
    
    let copied = 0;
    for (const src of sourceAssignments) {
      const exists = !overwrite && this.state.scheduleAssignments.find((a: ScheduleAssignment) =>
        a.projectId === src.projectId && a.employeeId === src.employeeId && 
        a.week === targetWeekKey && a.shift === src.shift
      );
      
      if (!exists) {
        const newAssign: ScheduleAssignment = {
          ...src,
          id: crypto.randomUUID(),
          week: targetWeekKey,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        this.state.scheduleAssignments.push(newAssign);
        await db.put('scheduleAssignments', newAssign);
        copied++;
      }
    }
    
    this.logScheduleChange('added', `${copied} ${i18n.t('schedule.assignmentsLabel').toLowerCase()}`, `${i18n.t('schedule.copiedAssignments').replace('{0}', String(copied)).replace('{1}', sourceWeekKey)}`);
    this.showToast(i18n.t('schedule.copiedAssignments').replace('{0}', String(copied)).replace('{1}', sourceWeekKey), 'success');
    this.renderScheduleContent();
    this.renderScheduleEmployeePanel();
    this.updateCoverageBar();
  }

  // ==================== SZABLONY GRAFIKÓW ====================
  private async showTemplatesModal(): Promise<void> {
    const modal = document.getElementById('modal')!;
    const modalTitle = document.getElementById('modalTitle')!;
    const modalBody = document.getElementById('modalBody')!;
    
    // Pobierz zapisane szablony z bazy danych
    let templates: Array<{id: string; name: string; assignments: ScheduleAssignment[]; createdAt: number}> = [];
    try { templates = await db.getTemplates(); } catch { templates = []; }
    
    modalTitle.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18" style="display:inline;vertical-align:middle;margin-right:8px">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
      </svg>
      ${i18n.t('schedule.templatesTitle')}
    `;
    
    const weekKey = `${this.scheduleCurrentYear}-KW${this.scheduleCurrentWeek.toString().padStart(2, '0')}`;
    const currentCount = this.state.scheduleAssignments.filter((a: ScheduleAssignment) => a.week === weekKey).length;
    
    modalBody.innerHTML = `
      <div class="templates-modal">
        <div class="templates-section">
          <h4>${i18n.t('schedule.saveCurrentWeek')}</h4>
          <div class="templates-save-form">
            <input type="text" id="templateName" class="form-control" placeholder="${i18n.t('schedule.templateNamePlaceholder')}">
            <button class="btn-primary" id="saveTemplateBtn" ${currentCount === 0 ? 'disabled' : ''}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
              ${i18n.t('schedule.saveBtn')}
            </button>
          </div>
          ${currentCount === 0 ? `<p class="form-hint">${i18n.t('schedule.noAssignmentsToSave')}</p>` : `<p class="form-hint">${i18n.t('schedule.assignmentsToSave').replace('{0}', String(currentCount))}</p>`}
        </div>
        
        <div class="templates-section">
          <h4>${i18n.t('schedule.availableTemplates')}</h4>
          ${templates.length === 0 ? `
            <p class="templates-empty">${i18n.t('schedule.noTemplates')}</p>
          ` : `
            <div class="templates-list">
              ${templates.map(t => `
                <div class="template-item" data-id="${t.id}">
                  <div class="template-info">
                    <span class="template-name">${t.name}</span>
                    <span class="template-meta">${i18n.t('schedule.templateAssignmentsCount').replace('{0}', String(t.assignments.length))} • ${new Date(t.createdAt).toLocaleDateString()}</span>
                  </div>
                  <div class="template-actions">
                    <button class="template-apply" data-id="${t.id}" title="${i18n.t('schedule.applyTitle')}">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg>
                    </button>
                    <button class="template-delete" data-id="${t.id}" title="${i18n.t('common.delete')}">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                    </button>
                  </div>
                </div>
              `).join('')}
            </div>
          `}
        </div>
      </div>
    `;
    
    const confirmBtn = modal.querySelector('.modal-confirm') as HTMLButtonElement;
    confirmBtn.style.display = 'none';
    
    // Save template
    modalBody.querySelector('#saveTemplateBtn')?.addEventListener('click', async () => {
      const name = (document.getElementById('templateName') as HTMLInputElement).value.trim();
      if (!name) { this.showToast(i18n.t('schedule.enterTemplateName'), 'warning'); return; }
      
      const assignments = this.state.scheduleAssignments
        .filter((a: ScheduleAssignment) => a.week === weekKey)
        .map((a: ScheduleAssignment) => ({ ...a, week: 'TEMPLATE' }));
      
      const template = { id: crypto.randomUUID(), name, data: assignments, createdAt: Date.now() };
      await db.addTemplate(template);
      
      this.showToast(i18n.t('schedule.templateSaved').replace('{0}', name), 'success');
      this.hideModal();
    });
    
    // Apply template
    modalBody.querySelectorAll('.template-apply').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = (btn as HTMLElement).dataset.id;
        const template = templates.find(t => t.id === id);
        if (!template) return;
        
        for (const ta of template.assignments) {
          const newAssign: ScheduleAssignment = {
            ...ta,
            id: crypto.randomUUID(),
            week: weekKey,
            createdAt: Date.now(),
            updatedAt: Date.now()
          };
          this.state.scheduleAssignments.push(newAssign);
          await db.put('scheduleAssignments', newAssign);
        }
        
        this.showToast(i18n.t('schedule.templateApplied').replace('{0}', template.name), 'success');
        this.hideModal();
        this.renderScheduleContent();
        this.renderScheduleEmployeePanel();
        this.updateCoverageBar();
      });
    });
    
    // Delete template
    modalBody.querySelectorAll('.template-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = (btn as HTMLElement).dataset.id;
        const template = templates.find(t => t.id === id);
        if (template) {
          await db.deleteTemplate(id!);
          this.showToast(i18n.t('schedule.templateDeleted').replace('{0}', template.name), 'success');
          this.showTemplatesModal(); // Refresh
        }
      });
    });
    
    modal.classList.add('active');
  }

  // ==================== POWIADOMIENIA ====================
  private async showNotificationsModal(): Promise<void> {
    const modal = document.getElementById('modal')!;
    const modalTitle = document.getElementById('modalTitle')!;
    const modalBody = document.getElementById('modalBody')!;
    
    // Pobierz ustawienia powiadomień z bazy danych
    let settings: {email?: string; enabled?: boolean; onAssign?: boolean; onUnassign?: boolean; dailyDigest?: boolean} = {};
    try { settings = await db.getPreference('kappa_notification_settings') || {}; } catch { settings = {}; }
    
    modalTitle.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18" style="display:inline;vertical-align:middle;margin-right:8px">
        <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/>
      </svg>
      ${i18n.t('schedule.notificationsTitle')}
    `;
    
    modalBody.innerHTML = `
      <div class="notifications-modal">
        <div class="info-box info-box-primary">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
          </svg>
          <span>${i18n.t('schedule.notificationsDesc')}</span>
        </div>
        
        <div class="form-group">
          <label class="form-label">Email:</label>
          <input type="email" id="notifyEmail" class="form-control" placeholder="email@example.com" value="${settings.email || ''}">
        </div>
        
        <div class="form-group">
          <label class="form-checkbox">
            <input type="checkbox" id="notifyEnabled" ${settings.enabled ? 'checked' : ''}>
            <span>${i18n.t('schedule.enableNotifications')}</span>
          </label>
        </div>
        
        <div class="form-group" style="margin-left: 24px;">
          <label class="form-checkbox">
            <input type="checkbox" id="notifyOnAssign" ${settings.onAssign !== false ? 'checked' : ''}>
            <span>${i18n.t('schedule.notifyOnAssign')}</span>
          </label>
          <label class="form-checkbox">
            <input type="checkbox" id="notifyOnUnassign" ${settings.onUnassign !== false ? 'checked' : ''}>
            <span>${i18n.t('schedule.notifyOnUnassign')}</span>
          </label>
          <label class="form-checkbox">
            <input type="checkbox" id="notifyDailyDigest" ${settings.dailyDigest ? 'checked' : ''}>
            <span>${i18n.t('schedule.dailyDigest')}</span>
          </label>
        </div>
        
        <div class="notification-preview">
          <h4>📧 ${i18n.t('schedule.messagePreview')}</h4>
          <div class="email-preview">
            <div class="email-preview-header">
              <strong>Od:</strong> grafik@kappa-system.pl<br>
              <strong>Do:</strong> <span id="previewEmail">${settings.email || 'email@example.com'}</span><br>
              <strong>${i18n.t('schedule.emailSubject')}:</strong> ${i18n.t('schedule.newAssignment')} - KW${this.scheduleCurrentWeek}
            </div>
            <div class="email-preview-body">
              ${i18n.t('schedule.assignedToProject')}:<br><br>
              <strong>${i18n.t('schedule.client')}:</strong> BMW<br>
              <strong>${i18n.t('schedule.type')}:</strong> Interior<br>
              <strong>${i18n.t('schedule.shift')}:</strong> Z1 (6:00-14:00)<br>
              <strong>${i18n.t('schedule.week')}:</strong> KW${this.scheduleCurrentWeek}
            </div>
          </div>
        </div>
      </div>
    `;
    
    const confirmBtn = modal.querySelector('.modal-confirm') as HTMLButtonElement;
    confirmBtn.style.display = '';
    confirmBtn.textContent = i18n.t('schedule.saveSettings');
    confirmBtn.onclick = async () => {
      const newSettings = {
        email: (document.getElementById('notifyEmail') as HTMLInputElement).value,
        enabled: (document.getElementById('notifyEnabled') as HTMLInputElement).checked,
        onAssign: (document.getElementById('notifyOnAssign') as HTMLInputElement).checked,
        onUnassign: (document.getElementById('notifyOnUnassign') as HTMLInputElement).checked,
        dailyDigest: (document.getElementById('notifyDailyDigest') as HTMLInputElement).checked
      };
      await db.setPreference('kappa_notification_settings', newSettings);
      this.showToast(i18n.t('schedule.notificationsSaved'), 'success');
      this.hideModal();
    };
    
    // Update preview email
    document.getElementById('notifyEmail')?.addEventListener('input', (e) => {
      const email = (e.target as HTMLInputElement).value || 'email@example.com';
      const preview = document.getElementById('previewEmail');
      if (preview) preview.textContent = email;
    });
    
    modal.classList.add('active');
  }

  // ==================== WYSYŁANIE GRAFIKU MAILEM ====================
  private async showSendEmailModal(): Promise<void> {
    const modal = document.getElementById('modal')!;
    const modalTitle = document.getElementById('modalTitle')!;
    const modalBody = document.getElementById('modalBody')!;
    
    const weekKey = `${this.scheduleCurrentYear}-KW${this.scheduleCurrentWeek.toString().padStart(2, '0')}`;
    const weekAssignments = this.state.scheduleAssignments.filter((a: ScheduleAssignment) => a.week === weekKey);
    
    // Pobierz zapisane adresy email z bazy danych
    const savedEmails = await db.getPreference('kappa_email_addresses') || '';
    
    modalTitle.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18" style="display:inline;vertical-align:middle;margin-right:8px">
        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>
      </svg>
      ${i18n.t('schedule.sendScheduleEmail')}
    `;
    
    // Grupuj przypisania wg pracownika
    const byEmployee = new Map<string, { emp: Employee; assignments: ScheduleAssignment[] }>();
    weekAssignments.forEach((a: ScheduleAssignment) => {
      const emp = this.state.employees.find(e => e.id === a.employeeId);
      if (emp) {
        if (!byEmployee.has(emp.id)) {
          byEmployee.set(emp.id, { emp, assignments: [] });
        }
        byEmployee.get(emp.id)!.assignments.push(a);
      }
    });
    
    modalBody.innerHTML = `
      <div class="send-email-modal">
        <div class="info-box info-box-primary">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
          </svg>
          <span>${i18n.t('schedule.sendScheduleDesc')}</span>
        </div>
        
        <div class="form-group">
          <label class="form-label">${i18n.t('schedule.emailAddressesLabel')}:</label>
          <textarea id="emailAddresses" class="form-control" rows="2" placeholder="user1@company.com, user2@company.com">${savedEmails}</textarea>
        </div>
        
        <div class="form-group">
          <label class="form-label">${i18n.t('schedule.messageType')}:</label>
          <div class="email-type-options">
            <label class="radio-option">
              <input type="radio" name="emailType" value="general" checked>
              <span>📋 ${i18n.t('schedule.generalSchedule')}</span>
            </label>
            <label class="radio-option">
              <input type="radio" name="emailType" value="individual">
              <span>👤 ${i18n.t('schedule.individualEmails')}</span>
            </label>
          </div>
        </div>
        
        <div class="email-preview-section">
          <h4>📧 ${i18n.t('schedule.messagePreview')}</h4>
          <div class="email-preview" id="emailPreviewContent">
            ${this.generateScheduleEmailHtml(weekKey, 'general')}
          </div>
        </div>
        
        <div class="form-actions" style="margin-top: 16px; display: flex; gap: 12px;">
          <button class="btn btn-primary" id="sendGeneralEmail">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"/><path d="M22 2L15 22L11 13L2 9L22 2Z"/></svg>
            ${i18n.t('schedule.openInOutlook')}
          </button>
          <button class="btn btn-secondary" id="sendIndividualEmails" style="display: none;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            ${i18n.t('schedule.sendToAll')}
          </button>
        </div>
      </div>
    `;
    
    // Obsługa zmiany typu
    modalBody.querySelectorAll('input[name="emailType"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        const type = (e.target as HTMLInputElement).value as 'general' | 'individual';
        document.getElementById('emailPreviewContent')!.innerHTML = this.generateScheduleEmailHtml(weekKey, type);
        document.getElementById('sendGeneralEmail')!.style.display = type === 'general' ? '' : 'none';
        document.getElementById('sendIndividualEmails')!.style.display = type === 'individual' ? '' : 'none';
      });
    });
    
    // Zapisz adresy email do bazy danych
    document.getElementById('emailAddresses')?.addEventListener('blur', async (e) => {
      await db.setPreference('kappa_email_addresses', (e.target as HTMLTextAreaElement).value);
    });
    
    // Wysyłanie ogólnego emaila
    document.getElementById('sendGeneralEmail')?.addEventListener('click', async () => {
      const emails = (document.getElementById('emailAddresses') as HTMLTextAreaElement).value
        .split(/[,\n]/)
        .map(e => e.trim())
        .filter(e => e);
      
      if (emails.length === 0) {
        this.showToast(i18n.t('schedule.enterEmailAddress'), 'warning');
        return;
      }
      
      await db.setPreference('kappa_email_addresses', emails.join(', '));
      this.openOutlookEmail(emails.join('; '), i18n.t('schedule.weeklySchedule') + ' ' + weekKey, this.generateScheduleEmailBody(weekKey, 'general'));
      this.hideModal();
    });
    
    // Wysyłanie indywidualnych maili
    document.getElementById('sendIndividualEmails')?.addEventListener('click', () => {
      let count = 0;
      byEmployee.forEach(({ emp }) => {
        const email = this.getEmployeeEmail(emp);
        if (email) {
          this.openOutlookEmail(email, i18n.t('schedule.yourScheduleFor').replace('{0}', weekKey) + ` - ${emp.firstName} ${emp.lastName}`, 
            this.generateEmployeeScheduleEmailBody(emp.id, weekKey));
          count++;
        }
      });
      
      if (count > 0) {
        this.showToast(i18n.t('schedule.outlookOpened').replace('{0}', String(count)), 'success');
      } else {
        this.showToast(i18n.t('schedule.noEmailAddresses'), 'warning');
      }
      this.hideModal();
    });
    
    // Ukryj domyślny przycisk potwierdzenia
    const confirmBtn = modal.querySelector('.modal-confirm') as HTMLButtonElement;
    confirmBtn.style.display = 'none';
    
    modal.classList.add('active');
  }
  
  private generateScheduleEmailHtml(weekKey: string, type: 'general' | 'individual'): string {
    const weekAssignments = this.state.scheduleAssignments.filter((a: ScheduleAssignment) => a.week === weekKey);
    
    if (type === 'general') {
      // Grupuj wg projektu
      const byProject = new Map<string, { customer: string; type: string; shifts: Map<number, string[]> }>();
      
      weekAssignments.forEach((a: ScheduleAssignment) => {
        const project = this.state.projects.find(p => p.id === a.projectId || `${p.customer_id}-${p.type_id}` === a.projectId);
        const emp = this.state.employees.find(e => e.id === a.employeeId);
        if (project && emp) {
          const customer = this.state.customers.find(c => c.id === project.customer_id);
          const ptype = this.state.types.find(t => t.id === project.type_id);
          const key = `${customer?.name || '?'} - ${ptype?.name || '?'}`;
          
          if (!byProject.has(key)) {
            byProject.set(key, { customer: customer?.name || '?', type: ptype?.name || '?', shifts: new Map() });
          }
          const data = byProject.get(key)!;
          if (!data.shifts.has(a.shift)) data.shifts.set(a.shift, []);
          data.shifts.get(a.shift)!.push(`${emp.firstName} ${emp.lastName}`);
        }
      });
      
      const shiftNames = [i18n.t('schedule.shiftName1'), i18n.t('schedule.shiftName2'), i18n.t('schedule.shiftName3')];
      
      return `
        <div style="font-family: Arial, sans-serif; max-width: 600px;">
          <div style="background: #0097AC; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
            <h2 style="margin: 0;">📅 ${i18n.t('schedule.weeklySchedule')} ${weekKey}</h2>
            <p style="margin: 8px 0 0; opacity: 0.9;">DRÄXLMAIER Kappa Plannung</p>
          </div>
          <div style="padding: 20px; background: #f8f9fa; border: 1px solid #e9ecef; border-top: none; border-radius: 0 0 8px 8px;">
            ${Array.from(byProject.entries()).map(([name, data]) => `
              <div style="background: white; border-radius: 8px; padding: 16px; margin-bottom: 16px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <h3 style="margin: 0 0 12px; color: #1e293b; border-bottom: 2px solid #0097AC; padding-bottom: 8px;">${name}</h3>
                ${[1, 2, 3].filter(s => data.shifts.has(s)).map(s => `
                  <div style="margin-bottom: 8px;">
                    <strong style="color: #64748b; font-size: 12px;">${shiftNames[s-1]}:</strong>
                    <div style="margin-top: 4px;">
                      ${data.shifts.get(s)!.map(emp => `
                        <span style="display: inline-block; background: #0097AC; color: white; padding: 4px 12px; border-radius: 16px; margin: 2px; font-size: 13px;">${emp}</span>
                      `).join('')}
                    </div>
                  </div>
                `).join('')}
              </div>
            `).join('')}
            ${byProject.size === 0 ? '<p style="text-align: center; color: #64748b;">' + i18n.t('schedule.noAssignmentsThisWeek') + '</p>' : ''}
          </div>
        </div>
      `;
    } else {
      // Podgląd indywidualny (przykład)
      return `
        <div style="font-family: Arial, sans-serif; max-width: 600px;">
          <div style="background: #0097AC; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
            <h2 style="margin: 0;">👤 ${i18n.t('schedule.yourScheduleFor').replace('{0}', weekKey)}</h2>
            <p style="margin: 8px 0 0; opacity: 0.9;">${i18n.t('schedule.individualMessage')}</p>
          </div>
          <div style="padding: 20px; background: #f8f9fa; border: 1px solid #e9ecef; border-top: none; border-radius: 0 0 8px 8px;">
            <p style="color: #64748b;">${i18n.t('schedule.eachEmployeeReceives')}:</p>
            <ul style="color: #1e293b;">
              <li>${i18n.t('schedule.projectsToRealize')}</li>
              <li>${i18n.t('schedule.shiftsAndHours')}</li>
              <li>${i18n.t('schedule.taskDetails')}</li>
            </ul>
          </div>
        </div>
      `;
    }
  }
  
  private generateScheduleEmailBody(weekKey: string, type: 'general'): string {
    const weekAssignments = this.state.scheduleAssignments.filter((a: ScheduleAssignment) => a.week === weekKey);
    const shiftNames = ['Z1 (6:00-14:00)', 'Z2 (14:00-22:00)', 'Z3 (22:00-6:00)'];
    
    // Grupuj wg projektu
    const byProject = new Map<string, { customer: string; type: string; shifts: Map<number, string[]> }>();
    
    weekAssignments.forEach((a: ScheduleAssignment) => {
      const project = this.state.projects.find(p => p.id === a.projectId || `${p.customer_id}-${p.type_id}` === a.projectId);
      const emp = this.state.employees.find(e => e.id === a.employeeId);
      if (project && emp) {
        const customer = this.state.customers.find(c => c.id === project.customer_id);
        const ptype = this.state.types.find(t => t.id === project.type_id);
        const key = `${customer?.name || '?'} - ${ptype?.name || '?'}`;
        
        if (!byProject.has(key)) {
          byProject.set(key, { customer: customer?.name || '?', type: ptype?.name || '?', shifts: new Map() });
        }
        const data = byProject.get(key)!;
        if (!data.shifts.has(a.shift)) data.shifts.set(a.shift, []);
        data.shifts.get(a.shift)!.push(`${emp.firstName} ${emp.lastName}`);
      }
    });
    
    let body = `GRAFIK TYGODNIOWY ${weekKey}\\n`;
    body += `DRÄXLMAIER Kappa Plannung\\n`;
    body += `================================\\n\\n`;
    
    byProject.forEach((data, name) => {
      body += `📦 ${name}\\n`;
      [1, 2, 3].forEach(s => {
        if (data.shifts.has(s)) {
          body += `   ${shiftNames[s-1]}: ${data.shifts.get(s)!.join(', ')}\\n`;
        }
      });
      body += `\\n`;
    });
    
    return body;
  }
  
  private generateEmployeeScheduleEmailBody(employeeId: string, weekKey: string): string {
    const emp = this.state.employees.find(e => e.id === employeeId);
    if (!emp) return '';
    
    const assignments = this.state.scheduleAssignments.filter(
      (a: ScheduleAssignment) => a.employeeId === employeeId && a.week === weekKey
    );
    
    const shiftNames = ['Z1 (6:00-14:00)', 'Z2 (14:00-22:00)', 'Z3 (22:00-6:00)'];
    
    let body = `${i18n.t('schedule.emailGreeting').replace('{0}', emp.firstName)}\\n\\n`;
    body += `${i18n.t('schedule.emailYourSchedule').replace('{0}', weekKey)}\\n`;
    body += `================================\\n\\n`;
    
    assignments.forEach((a: ScheduleAssignment) => {
      const project = this.state.projects.find(p => p.id === a.projectId || `${p.customer_id}-${p.type_id}` === a.projectId);
      if (project) {
        const customer = this.state.customers.find(c => c.id === project.customer_id);
        const ptype = this.state.types.find(t => t.id === project.type_id);
        
        body += `📦 ${customer?.name || '?'} - ${ptype?.name || '?'}\\n`;
        body += `   ⏰ ${shiftNames[a.shift - 1]}\\n`;
        
        if (a.scope !== 'project') {
          const scopeLabels: Record<string, string> = { audit: i18n.t('schedule.scopeAudit'), adhesion: i18n.t('schedule.scopeAdhesion'), specific: i18n.t('schedule.scopeSpecific') };
          body += `   📋 ${i18n.t('schedule.scope')}: ${scopeLabels[a.scope] || a.scope}\\n`;
        }
        body += `\\n`;
      }
    });
    
    body += `\\n${i18n.t('schedule.goodLuck')}\\n${i18n.t('schedule.teamKappa')}`;
    
    return body;
  }
  
  private getEmployeeEmail(emp: Employee): string | null {
    // Sprawdź czy pracownik ma email (możesz dodać pole email do Employee)
    // Na razie zwracamy null - trzeba będzie rozszerzyć model Employee
    return (emp as any).email || null;
  }
  
  private openOutlookEmail(to: string, subject: string, body: string): void {
    // Użyj protokołu mailto: który otworzy domyślny klient pocztowy (Outlook)
    const mailtoUrl = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body.replace(/\\n/g, '\n'))}`;
    window.open(mailtoUrl, '_blank');
  }

  // ==================== WIDOK GANTT OBCIĄŻENIA ====================
  private showGanttView(): void {
    const weekKey = `${this.scheduleCurrentYear}-KW${this.scheduleCurrentWeek.toString().padStart(2, '0')}`;
    
    // Zbierz dane obciążenia pracowników
    const employeeWorkload = new Map<string, { emp: Employee; shifts: number[]; total: number }>();
    
    this.state.employees.forEach(emp => {
      if (emp.status && emp.status !== 'available') return;
      employeeWorkload.set(emp.id, { emp, shifts: [0, 0, 0], total: 0 });
    });
    
    // Policz przypisania na każdą zmianę
    const weekAssignments = this.state.scheduleAssignments.filter((a: ScheduleAssignment) => a.week === weekKey);
    weekAssignments.forEach((a: ScheduleAssignment) => {
      const data = employeeWorkload.get(a.employeeId);
      if (data) {
        data.shifts[a.shift - 1]++;
        data.total++;
      }
    });
    
    // Sortuj po obciążeniu
    const sorted = Array.from(employeeWorkload.values()).sort((a, b) => b.total - a.total);
    const maxLoad = Math.max(...sorted.map(s => s.total), 1);
    
    // Utwórz overlay
    const overlay = document.createElement('div');
    overlay.className = 'employee-modal-overlay';
    overlay.innerHTML = `
      <div class="gantt-modal">
        <div class="gantt-modal-header">
          <h2>${i18n.t('schedule.workloadReport').replace('{0}', String(this.scheduleCurrentWeek))}</h2>
          <button class="employee-modal-close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="gantt-modal-body">
          <div class="gantt-legend">
            <span class="gantt-legend-item"><span class="gantt-bar-segment shift-1"></span> ${i18n.t('schedule.shift1Short')}</span>
            <span class="gantt-legend-item"><span class="gantt-bar-segment shift-2"></span> ${i18n.t('schedule.shift2Short')}</span>
            <span class="gantt-legend-item"><span class="gantt-bar-segment shift-3"></span> ${i18n.t('schedule.shift3Short')}</span>
          </div>
          
          <div class="gantt-chart">
            ${sorted.map(data => {
              const percent = (data.total / maxLoad) * 100;
              const isOverloaded = data.total > 5;
              
              return `
                <div class="gantt-row ${isOverloaded ? 'overloaded' : ''}">
                  <div class="gantt-employee">
                    <div class="gantt-avatar" style="background: ${data.emp.color}">${data.emp.firstName.charAt(0)}</div>
                    <span class="gantt-name">${data.emp.firstName} ${data.emp.lastName}</span>
                  </div>
                  <div class="gantt-bar-container">
                    <div class="gantt-bar" style="width: ${percent}%">
                      ${data.shifts[0] > 0 ? `<div class="gantt-bar-segment shift-1" style="flex: ${data.shifts[0]}">${data.shifts[0]}</div>` : ''}
                      ${data.shifts[1] > 0 ? `<div class="gantt-bar-segment shift-2" style="flex: ${data.shifts[1]}">${data.shifts[1]}</div>` : ''}
                      ${data.shifts[2] > 0 ? `<div class="gantt-bar-segment shift-3" style="flex: ${data.shifts[2]}">${data.shifts[2]}</div>` : ''}
                    </div>
                    <span class="gantt-total ${isOverloaded ? 'overloaded' : ''}">${data.total}</span>
                    ${isOverloaded ? '<span class="gantt-warning">⚠️</span>' : ''}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
          
          <div class="gantt-summary">
            <div class="gantt-stat">
              <span class="gantt-stat-value">${sorted.filter(s => s.total > 0).length}</span>
              <span class="gantt-stat-label">${i18n.t('schedule.assignedStat')}</span>
            </div>
            <div class="gantt-stat">
              <span class="gantt-stat-value">${sorted.filter(s => s.total === 0).length}</span>
              <span class="gantt-stat-label">${i18n.t('schedule.freeStat')}</span>
            </div>
            <div class="gantt-stat">
              <span class="gantt-stat-value">${sorted.filter(s => s.total > 5).length}</span>
              <span class="gantt-stat-label">${i18n.t('schedule.overloadedStat')}</span>
            </div>
            <div class="gantt-stat">
              <span class="gantt-stat-value">${weekAssignments.length}</span>
              <span class="gantt-stat-label">${i18n.t('schedule.totalShiftsStat')}</span>
            </div>
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    
    overlay.querySelector('.employee-modal-close')?.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.addEventListener('keydown', function handler(e) {
      if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', handler); }
    });
  }

  // ==================== KONFLIKTY URLOPOWE ====================
  private checkVacationConflicts(): Array<{employee: Employee; conflict: string}> {
    const weekKey = `${this.scheduleCurrentYear}-KW${this.scheduleCurrentWeek.toString().padStart(2, '0')}`;
    const conflicts: Array<{employee: Employee; conflict: string}> = [];
    
    // Sprawdź pracowników na urlopie
    this.state.employees.forEach(emp => {
      if (emp.status === 'vacation' || emp.status === 'sick') {
        // Sprawdź czy są przypisani
        const assignments = this.state.scheduleAssignments.filter((a: ScheduleAssignment) =>
          a.employeeId === emp.id && a.week === weekKey
        );
        
        if (assignments.length > 0) {
          const statusLabel = emp.status === 'vacation' ? i18n.t('schedule.onVacationStatus') : i18n.t('schedule.onSickLeaveStatus');
          conflicts.push({
            employee: emp,
            conflict: i18n.t('schedule.isOnStatusButHasAssignments').replace('{0}', emp.firstName).replace('{1}', emp.lastName).replace('{2}', statusLabel).replace('{3}', String(assignments.length))
          });
        }
      }
    });
    
    return conflicts;
  }
  
  private renderVacationConflicts(): void {
    const conflicts = this.checkVacationConflicts();
    const alertsContainer = document.getElementById('scheduleAlerts');
    if (!alertsContainer) return;
    
    // Usuń stare konflikty
    alertsContainer.querySelectorAll('.sched-alert.vacation-conflict').forEach(el => el.remove());
    
    conflicts.forEach(c => {
      const alert = document.createElement('div');
      alert.className = 'sched-alert vacation-conflict';
      alert.innerHTML = `
        <span class="sched-alert-icon">🏖️</span>
        <span class="sched-alert-text">${c.conflict}</span>
        <button class="sched-alert-action" data-employee="${c.employee.id}">${i18n.t('schedule.removeAssignmentsBtn')}</button>
      `;
      
      alert.querySelector('.sched-alert-action')?.addEventListener('click', async () => {
        const weekKey = `${this.scheduleCurrentYear}-KW${this.scheduleCurrentWeek.toString().padStart(2, '0')}`;
        const toRemove = this.state.scheduleAssignments.filter((a: ScheduleAssignment) =>
          a.employeeId === c.employee.id && a.week === weekKey
        );
        
        for (const a of toRemove) {
          await this.removeAssignment(a.id);
        }
        
        this.showToast(i18n.t('schedule.removedAssignments').replace('{0}', String(toRemove.length)).replace('{1}', c.employee.firstName), 'success');
        this.renderVacationConflicts();
      });
      
      alertsContainer.appendChild(alert);
    });
  }

  // ==================== STATYSTYKI PRACOWNIKA ====================
  private showEmployeeStatsModal(): void {
    const modal = document.getElementById('modal')!;
    const modalTitle = document.getElementById('modalTitle')!;
    const modalBody = document.getElementById('modalBody')!;
    
    // Zbierz statystyki dla wszystkich pracowników
    const stats = this.state.employees.map(emp => {
      const allAssignments = this.state.scheduleAssignments.filter((a: ScheduleAssignment) => a.employeeId === emp.id);
      const thisMonthAssignments = allAssignments.filter((a: ScheduleAssignment) => {
        const [year] = a.week.split('-KW');
        return parseInt(year) === this.scheduleCurrentYear;
      });
      
      // Policz zmiany
      const shiftCounts = { 1: 0, 2: 0, 3: 0 };
      thisMonthAssignments.forEach((a: ScheduleAssignment) => {
        shiftCounts[a.shift as 1|2|3]++;
      });
      
      // Policz zakresy
      const scopeCounts = { project: 0, adhesion: 0, audit: 0, specific: 0 };
      thisMonthAssignments.forEach((a: ScheduleAssignment) => {
        const scope = a.scope || 'project';
        scopeCounts[scope as keyof typeof scopeCounts]++;
      });
      
      return {
        employee: emp,
        total: thisMonthAssignments.length,
        shifts: shiftCounts,
        scopes: scopeCounts,
        weeks: new Set(thisMonthAssignments.map((a: ScheduleAssignment) => a.week)).size
      };
    }).sort((a, b) => b.total - a.total);
    
    modalTitle.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18" style="display:inline;vertical-align:middle;margin-right:8px">
        <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
      </svg>
      ${i18n.t('schedule.employeeStatsTitle').replace('{0}', String(this.scheduleCurrentYear))}
    `;
    
    const totalAssignments = stats.reduce((sum, s) => sum + s.total, 0);
    const avgPerEmployee = stats.length > 0 ? (totalAssignments / stats.length).toFixed(1) : '0';
    
    modalBody.innerHTML = `
      <div class="employee-stats-modal">
        <div class="stats-summary">
          <div class="stats-summary-item">
            <span class="stats-summary-value">${totalAssignments}</span>
            <span class="stats-summary-label">${i18n.t('schedule.totalAssignmentsLabel')}</span>
          </div>
          <div class="stats-summary-item">
            <span class="stats-summary-value">${avgPerEmployee}</span>
            <span class="stats-summary-label">${i18n.t('schedule.averagePerEmployee')}</span>
          </div>
          <div class="stats-summary-item">
            <span class="stats-summary-value">${stats.filter(s => s.total > 0).length}</span>
            <span class="stats-summary-label">${i18n.t('schedule.activeEmployees')}</span>
          </div>
        </div>
        
        <div class="stats-table-container">
          <table class="stats-table">
            <thead>
              <tr>
                <th>${i18n.t('schedule.employeeLabel')}</th>
                <th>${i18n.t('schedule.totalAssignmentsLabel')}</th>
                <th>Z1</th>
                <th>Z2</th>
                <th>Z3</th>
                <th>${i18n.t('schedule.projectsLabel')}</th>
                <th>${i18n.t('schedule.scopeAdhesion')}</th>
                <th>${i18n.t('schedule.scopeAudit')}</th>
                <th>${i18n.t('schedule.weeksLabel')}</th>
              </tr>
            </thead>
            <tbody>
              ${stats.map(s => `
                <tr>
                  <td>
                    <div class="stats-employee">
                      <span class="stats-avatar" style="background: ${s.employee.color}">${s.employee.firstName.charAt(0)}</span>
                      <span>${s.employee.firstName} ${s.employee.lastName}</span>
                    </div>
                  </td>
                  <td><strong>${s.total}</strong></td>
                  <td>${s.shifts[1]}</td>
                  <td>${s.shifts[2]}</td>
                  <td>${s.shifts[3]}</td>
                  <td>${s.scopes.project}</td>
                  <td>${s.scopes.adhesion}</td>
                  <td>${s.scopes.audit}</td>
                  <td>${s.weeks}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
    
    const confirmBtn = modal.querySelector('.modal-confirm') as HTMLButtonElement;
    confirmBtn.style.display = 'none';
    
    modal.classList.add('active');
  }

  // ==================== DRAG & DROP MIĘDZY ZMIANAMI ====================
  private enableChipDragDrop(): void {
    // Ta funkcja jest wywoływana przy renderowaniu chipów
    document.querySelectorAll('.sched-chip[data-id]').forEach(chip => {
      (chip as HTMLElement).draggable = true;
      
      chip.addEventListener('dragstart', (e) => {
        const assignmentId = (chip as HTMLElement).dataset.id;
        (e as DragEvent).dataTransfer?.setData('assignmentId', assignmentId || '');
        (chip as HTMLElement).classList.add('dragging');
      });
      
      chip.addEventListener('dragend', () => {
        (chip as HTMLElement).classList.remove('dragging');
      });
    });
  }
  
  // Modal do edycji notatki przypisania - nowy design jak na zdjęciu
  private showAssignmentNoteModal(assignmentId: string): void {
    const assignment = this.state.scheduleAssignments.find((a: ScheduleAssignment) => a.id === assignmentId);
    if (!assignment) return;
    
    const emp = this.state.employees.find(e => e.id === assignment.employeeId);
    const project = this.state.projects.find(p => p.id === assignment.projectId || `${p.customer_id}-${p.type_id}` === assignment.projectId);
    const customer = project ? this.state.customers.find(c => c.id === project.customer_id) : null;
    const type = project ? this.state.types.find(t => t.id === project.type_id) : null;
    
    // Pobierz istniejące odpowiedzi z notatki (format: główna notatka\n---REPLIES---\njson)
    let mainNote = assignment.note || '';
    let replies: Array<{text: string; date: string; author: string}> = [];
    
    if (mainNote.includes('---REPLIES---')) {
      const parts = mainNote.split('---REPLIES---');
      mainNote = parts[0].trim();
      try {
        replies = JSON.parse(parts[1]);
      } catch (e) {
        replies = [];
      }
    }
    
    const overlay = document.createElement('div');
    overlay.className = 'note-modal-overlay';
    overlay.innerHTML = `
      <div class="note-modal note-modal-modern">
        <div class="note-modal-header">
          <div class="note-modal-header-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
            </svg>
          </div>
          <h3>${i18n.t('schedule.noteTitle')}</h3>
          <button class="note-modal-close">×</button>
        </div>
        
        <div class="note-modal-info">
          <div class="note-info-tag note-info-employee" style="--emp-color: ${emp?.color || '#64748b'}">
            ${emp?.firstName} ${emp?.lastName}
          </div>
          <div class="note-info-tag note-info-project">
            ${customer?.name || '?'} / ${type?.name || '?'}
          </div>
          <div class="note-info-tag note-info-shift">
            Zmiana ${assignment.shift}
          </div>
        </div>
        
        <div class="note-modal-body">
          <textarea class="note-modal-textarea" placeholder="${i18n.t('schedule.notePlaceholder')}">${mainNote}</textarea>
          
          ${replies.length > 0 ? `
            <div class="note-replies-section">
              <div class="note-replies-header">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                  <polyline points="9 17 4 12 9 7"/>
                  <path d="M20 18v-2a4 4 0 0 0-4-4H4"/>
                </svg>
                ${i18n.t('schedule.replies').replace('{0}', String(replies.length))}
              </div>
              <div class="note-replies-list">
                ${replies.map((r, i) => `
                  <div class="note-reply-item">
                    <div class="note-reply-header">
                      <span class="note-reply-author">${r.author}</span>
                      <span class="note-reply-date">${r.date}</span>
                      <button class="note-reply-delete" data-index="${i}" title="${i18n.t('schedule.deleteReply')}">×</button>
                    </div>
                    <div class="note-reply-text">${r.text}</div>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}
          
          <div class="note-add-reply">
            <div class="note-reply-input-wrapper">
              <input type="text" class="note-reply-input" placeholder="${i18n.t('schedule.addReplyPlaceholder')}">
              <button class="note-reply-submit" title="${i18n.t('schedule.addReply')}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                  <line x1="22" y1="2" x2="11" y2="13"/>
                  <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
        
        <div class="note-modal-actions">
          ${mainNote || replies.length > 0 ? `
            <button class="note-modal-delete">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
              ${i18n.t('schedule.deleteBtn')}
            </button>
          ` : ''}
          <div class="note-modal-actions-right">
            <button class="note-modal-cancel">${i18n.t('schedule.cancel')}</button>
            <button class="note-modal-save">${i18n.t('schedule.save')}</button>
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    
    const textarea = overlay.querySelector('.note-modal-textarea') as HTMLTextAreaElement;
    textarea.focus();
    
    // Zamykanie
    overlay.querySelector('.note-modal-close')?.addEventListener('click', () => overlay.remove());
    overlay.querySelector('.note-modal-cancel')?.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
    
    // Dodawanie odpowiedzi
    const replyInput = overlay.querySelector('.note-reply-input') as HTMLInputElement;
    const submitReply = async () => {
      const replyText = replyInput.value.trim();
      if (!replyText) return;
      
      replies.push({
        text: replyText,
        date: new Date().toLocaleDateString(i18n.getDateLocale()),
        author: this.state.settings.userName || i18n.t('logs.user')
      });
      
      // Zapisz natychmiast do bazy
      const newNote = mainNote + '\n---REPLIES---\n' + JSON.stringify(replies);
      assignment.note = newNote;
      assignment.updatedAt = Date.now();
      await db.put('scheduleAssignments', assignment);
      
      // Odśwież modal
      overlay.remove();
      this.showAssignmentNoteModal(assignmentId);
      this.showToast(i18n.t('schedule.replyAdded'), 'success');
    };
    
    overlay.querySelector('.note-reply-submit')?.addEventListener('click', submitReply);
    replyInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') submitReply();
    });
    
    // Usuwanie odpowiedzi
    overlay.querySelectorAll('.note-reply-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const index = parseInt((btn as HTMLElement).dataset.index || '0');
        replies.splice(index, 1);
        
        // Zapisz natychmiast do bazy
        const newNote = textarea.value.trim() + (replies.length > 0 ? '\n---REPLIES---\n' + JSON.stringify(replies) : '');
        assignment.note = newNote || undefined;
        assignment.updatedAt = Date.now();
        await db.put('scheduleAssignments', assignment);
        
        overlay.remove();
        this.showAssignmentNoteModal(assignmentId);
        this.showToast(i18n.t('schedule.replyDeleted'), 'success');
      });
    });
    
    // Usuwanie całej notatki
    overlay.querySelector('.note-modal-delete')?.addEventListener('click', async () => {
      assignment.note = undefined;
      assignment.updatedAt = Date.now();
      await db.put('scheduleAssignments', assignment);
      this.showToast(i18n.t('schedule.noteDeleted'), 'success');
      overlay.remove();
      this.renderScheduleContent();
    });
    
    // Zapisywanie
    overlay.querySelector('.note-modal-save')?.addEventListener('click', async () => {
      const note = textarea.value.trim();
      const fullNote = note + (replies.length > 0 ? '\n---REPLIES---\n' + JSON.stringify(replies) : '');
      assignment.note = fullNote || undefined;
      assignment.updatedAt = Date.now();
      await db.put('scheduleAssignments', assignment);
      this.showToast(fullNote ? i18n.t('schedule.noteSaved') : i18n.t('schedule.noteDeleted'), 'success');
      overlay.remove();
      this.renderScheduleContent();
    });
    
    // Escape
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        overlay.remove();
        document.removeEventListener('keydown', handleEscape);
      }
    };
    document.addEventListener('keydown', handleEscape);
  }
  
  private async moveAssignmentToShift(assignmentId: string, newShift: 1 | 2 | 3, newProjectId?: string): Promise<void> {
    const assignment = this.state.scheduleAssignments.find((a: ScheduleAssignment) => a.id === assignmentId);
    if (!assignment) return;
    
    const emp = this.state.employees.find(e => e.id === assignment.employeeId);
    const empName = emp ? `${emp.firstName} ${emp.lastName}` : '?';
    const oldShift = assignment.shift;
    const oldProjectId = assignment.projectId;
    
    // Pobierz nazwy projektów
    const getProjectName = (projectId: string): string => {
      const parts = projectId.split('-');
      const customer = this.state.customers.find(c => c.id === parts[0]);
      const type = this.state.types.find(t => t.id === parts[1]);
      return customer && type ? `${customer.name} ${type.name}` : projectId;
    };
    
    const oldProjectName = getProjectName(oldProjectId);
    const newProjectName = newProjectId ? getProjectName(newProjectId) : oldProjectName;
    
    // Sprawdź czy coś się zmienia
    const shiftChanged = assignment.shift !== newShift;
    const projectChanged = newProjectId && assignment.projectId !== newProjectId;
    
    if (!shiftChanged && !projectChanged) return;
    
    // Sprawdź i usuń duplikaty - te same przypisania (employee+project+week+shift) 
    const targetProjectId = newProjectId || assignment.projectId;
    const duplicates = this.state.scheduleAssignments.filter((a: ScheduleAssignment) =>
      a.id !== assignmentId &&
      a.employeeId === assignment.employeeId &&
      a.projectId === targetProjectId &&
      a.week === assignment.week &&
      a.shift === newShift
    );
    for (const dup of duplicates) {
      const dupIdx = this.state.scheduleAssignments.indexOf(dup);
      if (dupIdx !== -1) {
        this.state.scheduleAssignments.splice(dupIdx, 1);
        await db.delete('scheduleAssignments', dup.id);
      }
    }
    
    if (shiftChanged) {
      assignment.shift = newShift;
    }
    if (projectChanged && newProjectId) {
      assignment.projectId = newProjectId;
    }
    
    assignment.updatedAt = Date.now();
    await db.put('scheduleAssignments', assignment);
    
    // Log zmiany - do głównej historii i historii grafiku
    if (projectChanged && shiftChanged) {
      const details = `${oldProjectName} Z${oldShift} → ${newProjectName} Z${newShift}`;
      await this.addLog('updated', 'Assignment', empName, details);
      this.logScheduleChange('modified', empName, details);
      this.showToast(`Przeniesiono na ${newProjectName}, zmiana ${newShift}`, 'success');
    } else if (projectChanged) {
      const details = `${oldProjectName} → ${newProjectName}`;
      await this.addLog('updated', 'Assignment', empName, details);
      this.logScheduleChange('modified', empName, details);
      this.showToast(`Przeniesiono na ${newProjectName}`, 'success');
    } else {
      const details = `${oldProjectName}: Z${oldShift} → Z${newShift}`;
      await this.addLog('updated', 'Assignment', empName, details);
      this.logScheduleChange('modified', empName, details);
      this.showToast(i18n.t('schedule.movedToShift').replace('{0}', String(newShift)), 'success');
    }
    
    this.renderScheduleContent();
    this.renderScheduleEmployeePanel();
  }

  private renderScheduleProjectsPanel(): void {
    const headerContainer = document.getElementById('scheduleShiftsHeader');
    const projectsContainer = document.getElementById('scheduleProjectsList');
    
    if (!headerContainer || !projectsContainer) return;
    
    const weekKey = `${this.scheduleCurrentYear}-KW${this.scheduleCurrentWeek.toString().padStart(2, '0')}`;
    
    // Header z nowymi klasami i sortowaniem
    const shiftNames = [i18n.t('schedule.morning'), i18n.t('schedule.afternoon'), i18n.t('schedule.night')];
    const shiftHours = ['6:00-14:00', '14:00-22:00', '22:00-6:00'];
    
    const sortIcon = this.scheduleSortMode === 'alpha' 
      ? '<svg class="sort-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><polyline points="18 15 12 9 6 15"/></svg>'
      : (this.scheduleSortMode === 'coverage' 
        ? '<svg class="sort-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><polyline points="6 9 12 15 18 9"/></svg>'
        : '');
    
    // Ikony dla zmian - słońce, zachód słońca, księżyc
    const shiftIcons = [
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><circle cx="12" cy="12" r="4" fill="currentColor"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>',
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M12 10V2M4.93 10.93l1.41-1.41M2 18h2M20 18h2M19.07 10.93l-1.41-1.41"/><path d="M17 18a5 5 0 1 0-10 0" fill="currentColor"/><line x1="2" y1="22" x2="22" y2="22"/></svg>',
      '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1" width="20" height="20"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>'
    ];
    
    headerContainer.className = `sched-table-header shifts-${this.scheduleShiftSystem}`;
    headerContainer.innerHTML = `
      <div class="sched-header-cell sched-project-col sortable ${this.scheduleSortMode !== 'default' ? 'sorted' : ''}" id="schedProjectColHeader">
        <span>${i18n.t('schedule.project')}</span>
        ${sortIcon}
      </div>
      ${Array.from({ length: this.scheduleShiftSystem }, (_, i) => `
        <div class="sched-header-cell sched-shift-col shift-${i + 1}">
          <div class="shift-icon-wrapper">${shiftIcons[i]}</div>
          <span class="sched-shift-num">${i + 1}</span>
          <span class="sched-shift-name">${shiftNames[i]}</span>
          <span class="sched-shift-hours">${shiftHours[i]}</span>
        </div>
      `).join('')}
    `;
    
    // Pobierz projekty z SOLL > 0 z uwzględnieniem filtrów
    let weekProjects = this.state.projects.filter(p => {
      const weekData = p.weeks[weekKey];
      if (!weekData || weekData.soll <= 0 || p.hidden) return false;
      
      // Filtr po projekcie (kliencie)
      if (this.scheduleFilterProject && p.customer_id !== this.scheduleFilterProject) return false;
      
      // Filtr po teście
      if (this.scheduleFilterTest && p.test_id !== this.scheduleFilterTest) return false;
      
      return true;
    });
    
    // Filtr po pracowniku - pokaż tylko projekty z tym pracownikiem
    if (this.scheduleFilterEmployee) {
      const employeeAssignments = this.state.scheduleAssignments.filter((a: ScheduleAssignment) =>
        a.employeeId === this.scheduleFilterEmployee && a.week === weekKey
      );
      const projectIdsWithEmployee = new Set(employeeAssignments.map((a: ScheduleAssignment) => a.projectId));
      weekProjects = weekProjects.filter(p => {
        const groupKey = `${p.customer_id}-${p.type_id}`;
        return projectIdsWithEmployee.has(p.id) || projectIdsWithEmployee.has(groupKey);
      });
    }
    
    if (weekProjects.length === 0) {
      projectsContainer.innerHTML = `
        <div class="sched-empty-table">
          <span class="sched-empty-icon">📋</span>
          <p>${this.scheduleFilterEmployee || this.scheduleFilterProject || this.scheduleFilterTest ? i18n.t('schedule.noFilterResults') : i18n.t('schedule.noProjectsThisWeek')}</p>
          <span class="sched-empty-hint">${i18n.t('schedule.projectsWithSollAppear')}</span>
        </div>
      `;
      return;
    }
    
    // Grupuj projekty wg Customer + Type
    const projectGroups = new Map<string, {
      customerName: string;
      typeName: string;
      customerId: string;
      items: typeof weekProjects;
    }>();
    
    weekProjects.forEach(p => {
      const customer = this.state.customers.find(c => c.id === p.customer_id);
      const type = this.state.types.find(t => t.id === p.type_id);
      const groupKey = `${p.customer_id}-${p.type_id}`;
      
      if (!projectGroups.has(groupKey)) {
        projectGroups.set(groupKey, {
          customerName: customer?.name || '?',
          typeName: type?.name || '?',
          customerId: p.customer_id,
          items: []
        });
      }
      projectGroups.get(groupKey)!.items.push(p);
    });
    
    // Sortowanie grup - przypięte zawsze na górze
    let sortedGroups = Array.from(projectGroups.entries());
    
    // Najpierw sortuj wg wybranego trybu
    if (this.scheduleSortMode === 'alpha') {
      sortedGroups.sort((a, b) => a[1].customerName.localeCompare(b[1].customerName));
    } else if (this.scheduleSortMode === 'coverage') {
      // Sortuj po ilości przypisań (rosnąco - najpierw nieobsadzone)
      sortedGroups.sort((a, b) => {
        const aAssignments = this.state.scheduleAssignments.filter((ass: ScheduleAssignment) =>
          (ass.projectId === a[0] || a[1].items.some(item => item.id === ass.projectId)) && ass.week === weekKey
        ).length;
        const bAssignments = this.state.scheduleAssignments.filter((ass: ScheduleAssignment) =>
          (ass.projectId === b[0] || b[1].items.some(item => item.id === ass.projectId)) && ass.week === weekKey
        ).length;
        return aAssignments - bAssignments;
      });
    }
    
    // Następnie przenieś przypięte na górę (zachowując kolejność sortowania wśród przypiętych i nieprzypiętych)
    sortedGroups.sort((a, b) => {
      const aPinned = this.pinnedScheduleProjects.has(a[0]) ? 0 : 1;
      const bPinned = this.pinnedScheduleProjects.has(b[0]) ? 0 : 1;
      return aPinned - bPinned;
    });
    
    projectsContainer.innerHTML = '';
    
    // Build employee multi-shift map for the current week
    const allWeekAssignments = this.state.scheduleAssignments.filter((a: ScheduleAssignment) => a.week === weekKey);
    const empShiftsInWeek = new Map<string, Set<number>>();
    allWeekAssignments.forEach((a: ScheduleAssignment) => {
      if (!empShiftsInWeek.has(a.employeeId)) empShiftsInWeek.set(a.employeeId, new Set());
      empShiftsInWeek.get(a.employeeId)!.add(a.shift);
    });
    
    sortedGroups.forEach(([groupKey, group]) => {
      const groupAssignments = this.state.scheduleAssignments.filter((a: ScheduleAssignment) =>
        (a.projectId === groupKey || group.items.some(item => item.id === a.projectId)) &&
        a.week === weekKey
      );
      
      // Wiersz projektu z nowymi klasami
      const projectRow = document.createElement('div');
      projectRow.className = `sched-row shifts-${this.scheduleShiftSystem}`;
      projectRow.dataset.groupKey = groupKey;
      
      // Pobierz komentarz dla tego projektu i policz odpowiedzi
      const projectComment = this.getProjectComment(groupKey, weekKey);
      const isPinned = this.pinnedScheduleProjects?.has(groupKey) || false;
      
      // Parsuj komentarz - oddziel główny komentarz od odpowiedzi
      let mainCommentText = projectComment || '';
      let projectRepliesCount = 0;
      if (mainCommentText.includes('---REPLIES---')) {
        const parts = mainCommentText.split('---REPLIES---');
        mainCommentText = parts[0].trim();
        try {
          const parsedReplies = JSON.parse(parts[1]);
          projectRepliesCount = Array.isArray(parsedReplies) ? parsedReplies.length : 0;
        } catch (e) { projectRepliesCount = 0; }
      }
      
      const hasProjectComment = mainCommentText.length > 0 || projectRepliesCount > 0;
      const commentPreviewText = mainCommentText.length > 30 ? mainCommentText.slice(0, 30) + '...' : mainCommentText;
      
      // Sprawdź status obsadzenia projektu
      const staffingStatus = this.getProjectStaffingStatus(groupKey, group.items, groupAssignments);
      const repliesBadgeHtml = projectRepliesCount > 0 ? `<span class="project-replies-badge">${projectRepliesCount}</span>` : '';
      
      // Komórka projektu z przyciskami akcji
      const projectCell = document.createElement('div');
      projectCell.className = `sched-project-cell ${hasProjectComment ? 'has-comment' : ''} ${staffingStatus.class}`;
      projectCell.innerHTML = `
        <div class="sched-project-info">
          <button class="sched-project-pin ${isPinned ? 'pinned' : ''}" data-group="${groupKey}" title="${isPinned ? 'Odepnij' : 'Przypnij'}">
            <svg viewBox="0 0 24 24" fill="${isPinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>
          </button>
          <span class="sched-staffing-indicator ${staffingStatus.class}" title="${staffingStatus.tooltip}">
            ${staffingStatus.icon}
          </span>
          <div class="sched-project-text">
            <span class="sched-project-customer">${group.customerName}</span>
            <span class="sched-project-type">${group.typeName}</span>
            ${mainCommentText ? `<span class="sched-project-comment-preview" data-full-comment="${mainCommentText.replace(/"/g, '&quot;')}">${commentPreviewText}</span>` : ''}
          </div>
        </div>
        <div class="sched-project-actions">
          <button class="sched-project-comment-btn ${hasProjectComment ? 'has-comment' : ''}" data-group="${groupKey}" title="${hasProjectComment ? i18n.t('schedule.editComment') : i18n.t('schedule.addComment')}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            ${repliesBadgeHtml}
          </button>
        </div>
      `;
      
      // Event listeners dla przycisków
      projectCell.querySelector('.sched-project-pin')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleScheduleProjectPin(groupKey);
      });
      
      const commentBtn = projectCell.querySelector('.sched-project-comment-btn');
      if (commentBtn) {
        commentBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.showProjectCommentModal(groupKey, weekKey, projectComment);
        });
        
        // Hover popup na przycisk komentarza pokazuje podgląd
        if (hasProjectComment) {
          commentBtn.addEventListener('mouseenter', (e) => {
            this.showProjectCommentHoverPopup(e as MouseEvent, groupKey, weekKey, projectComment || '');
          });
          commentBtn.addEventListener('mouseleave', () => {
            this.hideProjectCommentHoverPopup();
          });
        }
      }
      
      // Hover popup dla pełnego komentarza
      const commentPreview = projectCell.querySelector('.sched-project-comment-preview');
      if (commentPreview) {
        commentPreview.addEventListener('mouseenter', (e) => {
          const fullComment = (e.target as HTMLElement).dataset.fullComment || '';
          if (fullComment.length > 30) {
            this.showCommentPopup(e.target as HTMLElement, fullComment);
          }
        });
        commentPreview.addEventListener('mouseleave', () => {
          this.hideCommentPopup();
        });
      }
      
      // Hover popup dla projektu (podobny do pracownika)
      const projectText = projectCell.querySelector('.sched-project-text');
      if (projectText) {
        projectText.addEventListener('mouseenter', (e) => {
          this.showProjectHoverPopup(e as MouseEvent, groupKey, group, groupAssignments, staffingStatus);
        });
        projectText.addEventListener('mouseleave', () => {
          this.hideProjectHoverPopup();
        });
      }
      
      projectRow.appendChild(projectCell);
      
      // Kolumny zmian
      for (let s = 1; s <= this.scheduleShiftSystem; s++) {
        const shiftCell = document.createElement('div');
        shiftCell.className = `sched-shift-cell shift-${s}`;
        
        const shiftAssignments = groupAssignments.filter((a: ScheduleAssignment) => a.shift === s);
        
        // Renderuj chipy pracowników - eleganckie karty
        const chipsHtml = shiftAssignments.map((a: ScheduleAssignment) => {
          const emp = this.state.employees.find(e => e.id === a.employeeId);
          if (!emp) return '';
          
          // Pobierz szczegóły zakresu pracy
          let scopeLabel = '';
          let scopeClass = '';
          let scopeIcon = '';
          let exclusionLabel = '';
          
          if (a.scope === 'adhesion') {
            scopeLabel = i18n.t('schedule.scopeAdhesion');
            scopeClass = 'scope-adhesion';
            scopeIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>';
          } else if (a.scope === 'audit') {
            scopeLabel = i18n.t('schedule.scopeAudit');
            scopeClass = 'scope-audit';
            scopeIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
          } else if (a.testId) {
            const test = this.state.tests.find(t => t.id === a.testId);
            scopeLabel = test?.name || 'Test';
            scopeClass = 'scope-test';
            scopeIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
          } else if (a.partId) {
            const part = this.state.parts.find(p => p.id === a.partId);
            scopeLabel = part?.name || i18n.t('schedule.part');
            scopeClass = 'scope-part';
            scopeIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>';
          }
          
          // Smart scope exclusion: if this is a "whole project" assignment,
          // check if other employees have specific test assignments for same project
          if (a.scope === 'project' && !a.testId && !a.partId) {
            const specificAssignments = groupAssignments.filter((other: ScheduleAssignment) =>
              other.id !== a.id &&
              other.employeeId !== a.employeeId &&
              other.scope === 'specific' &&
              other.testId
            );
            
            if (specificAssignments.length > 0) {
              const excludedTestNames = [...new Set(specificAssignments.map((sa: ScheduleAssignment) => {
                const test = this.state.tests.find(t => t.id === sa.testId);
                return test?.name || 'Test';
              }))];
              exclusionLabel = `${i18n.t('schedule.scopeExcluding')} ${excludedTestNames.join(', ')}`;
              scopeClass = 'scope-project-excluding';
            }
          }
          
          const initials = `${emp.firstName.charAt(0)}${emp.lastName.charAt(0)}`;
          const fullName = `${emp.firstName} ${emp.lastName}`;
          
          // Check if employee is on multiple shifts this week
          const empShifts = empShiftsInWeek.get(emp.id);
          const isMultiShift = empShifts ? empShifts.size > 1 : false;
          const multiShiftLabel = isMultiShift ? `⚠️ ${i18n.t('schedule.multiShiftWarning')}` : '';
          
          // Parsowanie notatki - oddziel główną notatkę od odpowiedzi
          let mainNoteText = a.note || '';
          let repliesCount = 0;
          if (mainNoteText.includes('---REPLIES---')) {
            const parts = mainNoteText.split('---REPLIES---');
            mainNoteText = parts[0].trim();
            try {
              const parsedReplies = JSON.parse(parts[1]);
              repliesCount = Array.isArray(parsedReplies) ? parsedReplies.length : 0;
            } catch (e) { repliesCount = 0; }
          }
          
          const hasNote = mainNoteText.length > 0 || repliesCount > 0;
          const notePreview = mainNoteText.length > 15 ? mainNoteText.slice(0, 15) + '...' : mainNoteText;
          const commentIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
          const repliesBadge = repliesCount > 0 ? `<span class="chip-replies-badge">${repliesCount}</span>` : '';
          
          return `
            <div class="sched-chip ${hasNote ? 'has-note' : ''} ${isMultiShift ? 'multi-shift-warning' : ''} chip-shift-${s}" 
                 style="--chip-color: ${emp.color}" 
                 data-id="${a.id}" 
                 data-employee-id="${emp.id}"
                 data-assignment='${JSON.stringify({ id: a.id, scope: a.scope, testId: a.testId, partId: a.partId, note: a.note || '' })}'>
              <div class="sched-chip-main">
                <span class="sched-chip-avatar">${initials}</span>
                <div class="sched-chip-info">
                  <span class="sched-chip-name">${fullName}</span>
                  ${scopeLabel ? `<span class="sched-chip-badge ${scopeClass}">${scopeIcon} ${scopeLabel}</span>` : ''}
                  ${exclusionLabel ? `<span class="sched-chip-exclusion">${exclusionLabel}</span>` : ''}
                  ${multiShiftLabel ? `<span class="sched-chip-multi-shift">${multiShiftLabel}</span>` : ''}
                  ${mainNoteText ? `<span class="sched-chip-note-preview" data-full-note="${mainNoteText.replace(/"/g, '&quot;')}">${notePreview}</span>` : ''}
                </div>
                ${repliesBadge}
              </div>
              <button class="sched-chip-comment-btn ${hasNote ? 'has-comment' : ''}" data-aid="${a.id}" title="${hasNote ? i18n.t('schedule.editComment') : i18n.t('schedule.addComment')}">
                ${commentIcon}
              </button>
              <button class="sched-chip-remove" data-aid="${a.id}">×</button>
            </div>
          `;
        }).join('');
        
        shiftCell.innerHTML = chipsHtml || '<span class="sched-cell-add">+</span>';
        
        // Kliknięcie na chip = otwórz modal pracownika
        shiftCell.querySelectorAll('.sched-chip').forEach(chip => {
          // Kliknięcie na przycisk komentarza
          chip.querySelector('.sched-chip-comment-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            const assignmentId = (e.target as HTMLElement).closest('.sched-chip-comment-btn')?.getAttribute('data-aid');
            if (assignmentId) this.showAssignmentNoteModal(assignmentId);
          });
          
          // Hover na podglądzie notatki - pokaż popup
          const notePreview = chip.querySelector('.sched-chip-note-preview');
          if (notePreview) {
            notePreview.addEventListener('mouseenter', (e) => {
              const fullNote = (e.target as HTMLElement).dataset.fullNote || '';
              if (fullNote.length > 20) {
                this.showCommentPopup(e.target as HTMLElement, fullNote);
              }
            });
            notePreview.addEventListener('mouseleave', () => {
              this.hideCommentPopup();
            });
          }
          
          chip.addEventListener('click', (e) => {
            if ((e.target as HTMLElement).classList.contains('sched-chip-remove')) return;
            if ((e.target as HTMLElement).closest('.sched-chip-comment-btn')) return;
            const empId = (chip as HTMLElement).dataset.employeeId;
            if (empId) this.showEmployeeModal(empId);
          });
          
          // Hover na chipie - pokaż popup z notatką
          const chipData = (chip as HTMLElement).dataset.assignment;
          if (chipData) {
            try {
              const assignmentData = JSON.parse(chipData);
              if (assignmentData.note) {
                let hoverTimeout: number | null = null;
                
                chip.addEventListener('mouseenter', (e) => {
                  if (hoverTimeout) { clearTimeout(hoverTimeout); hoverTimeout = null; }
                  const assignment = this.state.scheduleAssignments.find((a: ScheduleAssignment) => a.id === assignmentData.id);
                  const employee = this.state.employees.find(emp => emp.id === (chip as HTMLElement).dataset.employeeId);
                  if (assignment && employee) {
                    this.showChipNotePopup(e as MouseEvent, assignment, employee);
                  }
                });
                
                chip.addEventListener('mouseleave', () => {
                  hoverTimeout = window.setTimeout(() => {
                    const popup = document.querySelector('.chip-note-popup');
                    if (popup && !popup.matches(':hover')) popup.remove();
                  }, 400);
                });
              }
            } catch (err) {}
          }
          
          // Prawy klik - edycja notatki
          chip.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const assignmentId = (chip as HTMLElement).dataset.id;
            if (assignmentId) this.showAssignmentNoteModal(assignmentId);
          });
          
          // Drag chip to move between shifts AND projects
          (chip as HTMLElement).draggable = true;
          chip.addEventListener('dragstart', (e) => {
            const assignmentId = (chip as HTMLElement).dataset.id;
            if (assignmentId) {
              (e as DragEvent).dataTransfer?.setData('assignmentId', assignmentId);
              (e as DragEvent).dataTransfer?.setData('sourceShift', String(s));
              (e as DragEvent).dataTransfer?.setData('sourceProject', groupKey);
            }
            (chip as HTMLElement).classList.add('dragging');
          });
          chip.addEventListener('dragend', () => {
            (chip as HTMLElement).classList.remove('dragging');
          });
        });
        
        // Drag & Drop
        shiftCell.addEventListener('dragover', (e) => {
          e.preventDefault();
          shiftCell.classList.add('drag-over');
        });
        shiftCell.addEventListener('dragleave', () => shiftCell.classList.remove('drag-over'));
        shiftCell.addEventListener('drop', async (e) => {
          e.preventDefault();
          shiftCell.classList.remove('drag-over');
          
          // Zapisz pozycję drop dla pickera
          const dropX = (e as DragEvent).clientX;
          const dropY = (e as DragEvent).clientY;
          
          // Sprawdź czy to przenoszenie istniejącego chipa (między zmianami lub projektami)
          const assignmentId = (e as DragEvent).dataTransfer?.getData('assignmentId');
          if (assignmentId) {
            const sourceProject = (e as DragEvent).dataTransfer?.getData('sourceProject');
            const sourceShift = parseInt((e as DragEvent).dataTransfer?.getData('sourceShift') || '0');
            
            // Jeśli przenosimy na INNY projekt - pokaż picker scope
            if (sourceProject !== groupKey) {
              const assignment = this.state.scheduleAssignments.find((a: ScheduleAssignment) => a.id === assignmentId);
              if (assignment) {
                // Nie usuwaj od razu - przekaż do pickera, usunie po potwierdzeniu
                this.showScopePickerAtPosition(groupKey, group.items, assignment.employeeId, weekKey, s as 1 | 2 | 3, dropX, dropY, assignmentId);
              }
              return;
            }
            
            // Jeśli tylko zmiana zmiany (ten sam projekt) - przenieś bez zmiany scope
            if (sourceShift !== s) {
              await this.moveAssignmentToShift(assignmentId, s as 1 | 2 | 3);
            }
            return;
          }
          
          // Inaczej to przeciąganie nowego pracownika
          if (this.draggedEmployeeId) {
            this.showScopePickerAtPosition(groupKey, group.items, this.draggedEmployeeId, weekKey, s as 1 | 2 | 3, dropX, dropY);
          }
        });
        
        // Click to add (tylko gdy nie klikamy na chip)
        shiftCell.addEventListener('click', (e) => {
          const target = e.target as HTMLElement;
          if (target.closest('.sched-chip')) return;
          this.showSimpleEmployeePicker(groupKey, group.items, weekKey, s as 1 | 2 | 3, shiftCell);
        });
        
        projectRow.appendChild(shiftCell);
      }
      
      projectsContainer.appendChild(projectRow);
      
      // Remove buttons
      projectRow.querySelectorAll('.sched-chip-remove').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const aid = (btn as HTMLElement).dataset.aid;
          if (aid) await this.removeAssignment(aid);
        });
      });
    });
    
    // ==================== EXTRA TASKS SECTION ====================
    this.renderExtraTasksInSchedule(projectsContainer, weekKey);
    
    // Dodaj kliknięcie na nagłówek kolumny PROJECT aby cyklicznie zmieniać sortowanie
    document.getElementById('schedProjectColHeader')?.addEventListener('click', () => {
      // Cykliczne przełączanie: default -> alpha -> coverage -> default
      if (this.scheduleSortMode === 'default') {
        this.scheduleSortMode = 'alpha';
      } else if (this.scheduleSortMode === 'alpha') {
        this.scheduleSortMode = 'coverage';
      } else {
        this.scheduleSortMode = 'default';
      }
      // Zaktualizuj przyciski sortowania
      document.querySelectorAll('.sched-sort-btn').forEach(b => {
        b.classList.toggle('active', (b as HTMLElement).dataset.sort === this.scheduleSortMode);
      });
      this.renderScheduleProjectsPanel();
    });
  }
  
  // ==================== EXTRA TASKS IN SCHEDULE ====================
  private renderExtraTasksInSchedule(container: HTMLElement, weekKey: string): void {
    const weekTasks = this.state.extraTasks.filter(t => t.week === weekKey);
    
    // Separator
    const separator = document.createElement('div');
    separator.className = `sched-row sched-extra-separator shifts-${this.scheduleShiftSystem}`;
    separator.innerHTML = `
      <div class="sched-extra-separator-cell" style="grid-column: 1 / -1">
        <div class="sched-extra-separator-line"></div>
        <span class="sched-extra-separator-label">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          ${i18n.t('schedule.extraTasks')}
        </span>
        <div class="sched-extra-separator-line"></div>
      </div>
    `;
    container.appendChild(separator);
    
    // Render each extra task
    weekTasks.forEach(task => {
      const taskRow = document.createElement('div');
      taskRow.className = `sched-row sched-extra-row shifts-${this.scheduleShiftSystem}`;
      taskRow.dataset.extraTaskId = task.id;
      
      // Task name cell
      const taskCell = document.createElement('div');
      taskCell.className = 'sched-project-cell sched-extra-task-cell';
      const totalTime = task.timePerUnit * task.units;
      const hours = Math.floor(totalTime / 60);
      const mins = totalTime % 60;
      const timeStr = hours > 0 ? `${hours}h ${mins > 0 ? mins + 'min' : ''}` : `${mins}min`;
      
      taskCell.innerHTML = `
        <div class="sched-project-info">
          <span class="sched-extra-icon">📌</span>
          <div class="sched-project-text">
            <span class="sched-project-customer sched-extra-name">${task.name}</span>
            <span class="sched-project-type sched-extra-time">${task.units} × ${task.timePerUnit}min = ${timeStr}</span>
            ${task.comment ? `<span class="sched-project-comment-preview">${task.comment.length > 30 ? task.comment.slice(0, 30) + '...' : task.comment}</span>` : ''}
          </div>
        </div>
        <div class="sched-project-actions">
          <button class="sched-extra-edit-btn" data-task-id="${task.id}" title="${i18n.t('schedule.editExtraTask')}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
          </button>
          <button class="sched-extra-delete-btn" data-task-id="${task.id}" title="${i18n.t('schedule.deleteExtraTask')}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      `;
      
      // Edit button handler
      taskCell.querySelector('.sched-extra-edit-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showExtraTaskModal(weekKey, task);
      });
      
      // Delete button handler
      taskCell.querySelector('.sched-extra-delete-btn')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        await this.deleteExtraTask(task.id);
      });
      
      taskRow.appendChild(taskCell);
      
      // Shift cells for extra task
      const extraProjectId = `extra-${task.id}`;
      for (let s = 1; s <= this.scheduleShiftSystem; s++) {
        const shiftCell = document.createElement('div');
        shiftCell.className = `sched-shift-cell shift-${s}`;
        
        const shiftAssignments = this.state.scheduleAssignments.filter((a: ScheduleAssignment) =>
          a.projectId === extraProjectId && a.week === weekKey && a.shift === s
        );
        
        const chipsHtml = shiftAssignments.map((a: ScheduleAssignment) => {
          const emp = this.state.employees.find(e => e.id === a.employeeId);
          if (!emp) return '';
          const initials = `${emp.firstName.charAt(0)}${emp.lastName.charAt(0)}`;
          const fullName = `${emp.firstName} ${emp.lastName}`;
          
          // Parsowanie notatki
          let mainNoteText = a.note || '';
          let repliesCount = 0;
          if (mainNoteText.includes('---REPLIES---')) {
            const parts = mainNoteText.split('---REPLIES---');
            mainNoteText = parts[0].trim();
            try {
              const parsedReplies = JSON.parse(parts[1]);
              repliesCount = Array.isArray(parsedReplies) ? parsedReplies.length : 0;
            } catch (e) { repliesCount = 0; }
          }
          
          const hasNote = mainNoteText.length > 0 || repliesCount > 0;
          const notePreview = mainNoteText.length > 15 ? mainNoteText.slice(0, 15) + '...' : mainNoteText;
          const commentIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
          const repliesBadge = repliesCount > 0 ? `<span class="chip-replies-badge">${repliesCount}</span>` : '';
          
          return `
            <div class="sched-chip ${hasNote ? 'has-note' : ''} chip-shift-${s}" 
                 style="--chip-color: ${emp.color}" 
                 data-id="${a.id}" 
                 data-employee-id="${emp.id}"
                 data-assignment='${JSON.stringify({ id: a.id, note: a.note || '' })}'>
              <div class="sched-chip-main">
                <span class="sched-chip-avatar">${initials}</span>
                <div class="sched-chip-info">
                  <span class="sched-chip-name">${fullName}</span>
                  ${mainNoteText ? `<span class="sched-chip-note-preview" data-full-note="${mainNoteText.replace(/"/g, '&quot;')}">${notePreview}</span>` : ''}
                </div>
                ${repliesBadge}
              </div>
              <button class="sched-chip-comment-btn ${hasNote ? 'has-comment' : ''}" data-aid="${a.id}" title="${hasNote ? i18n.t('schedule.editComment') : i18n.t('schedule.addComment')}">
                ${commentIcon}
              </button>
              <button class="sched-chip-remove" data-aid="${a.id}">×</button>
            </div>
          `;
        }).join('');
        
        shiftCell.innerHTML = chipsHtml || '<span class="sched-cell-add">+</span>';
        
        // Comment button handler
        shiftCell.querySelectorAll('.sched-chip-comment-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const assignmentId = (e.target as HTMLElement).closest('.sched-chip-comment-btn')?.getAttribute('data-aid');
            if (assignmentId) this.showAssignmentNoteModal(assignmentId);
          });
        });
        
        // Note preview hover - show popup
        shiftCell.querySelectorAll('.sched-chip-note-preview').forEach(preview => {
          preview.addEventListener('mouseenter', (e) => {
            const fullNote = (e.target as HTMLElement).dataset.fullNote || '';
            if (fullNote.length > 20) {
              this.showCommentPopup(e.target as HTMLElement, fullNote);
            }
          });
          preview.addEventListener('mouseleave', () => {
            this.hideCommentPopup();
          });
        });
        
        // Remove chip handler
        shiftCell.querySelectorAll('.sched-chip-remove').forEach(btn => {
          btn.addEventListener('click', async (ev) => {
            ev.stopPropagation();
            const aid = (btn as HTMLElement).dataset.aid;
            if (aid) await this.removeAssignment(aid);
          });
        });
        
        // Click on chip to see employee
        shiftCell.querySelectorAll('.sched-chip').forEach(chip => {
          chip.addEventListener('click', (ev) => {
            if ((ev.target as HTMLElement).classList.contains('sched-chip-remove')) return;
            if ((ev.target as HTMLElement).closest('.sched-chip-comment-btn')) return;
            const empId = (chip as HTMLElement).dataset.employeeId;
            if (empId) this.showEmployeeModal(empId);
          });
        });
        
        // Drag & Drop for extra tasks
        shiftCell.addEventListener('dragover', (ev) => { ev.preventDefault(); shiftCell.classList.add('drag-over'); });
        shiftCell.addEventListener('dragleave', () => shiftCell.classList.remove('drag-over'));
        shiftCell.addEventListener('drop', async (ev) => {
          ev.preventDefault();
          shiftCell.classList.remove('drag-over');
          
          const assignmentId = (ev as DragEvent).dataTransfer?.getData('assignmentId');
          if (assignmentId) {
            await this.moveAssignmentToShift(assignmentId, s as 1 | 2 | 3);
            return;
          }
          
          if (this.draggedEmployeeId) {
            await this.addExtraTaskAssignment(extraProjectId, this.draggedEmployeeId, weekKey, s as 1 | 2 | 3);
          }
        });
        
        // Click to add employee
        shiftCell.addEventListener('click', (ev) => {
          const target = ev.target as HTMLElement;
          if (target.closest('.sched-chip')) return;
          this.showExtraTaskEmployeePicker(extraProjectId, weekKey, s as 1 | 2 | 3, shiftCell);
        });
        
        taskRow.appendChild(shiftCell);
      }
      
      container.appendChild(taskRow);
    });
    
    // Add new extra task button
    const addRow = document.createElement('div');
    addRow.className = `sched-row sched-extra-add-row shifts-${this.scheduleShiftSystem}`;
    addRow.innerHTML = `
      <div class="sched-extra-add-cell" style="grid-column: 1 / -1">
        <button class="sched-extra-add-btn" id="addExtraTaskBtn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          ${i18n.t('schedule.addExtraTask')}
        </button>
      </div>
    `;
    addRow.querySelector('#addExtraTaskBtn')?.addEventListener('click', () => {
      this.showExtraTaskModal(weekKey);
    });
    container.appendChild(addRow);
  }
  
  // Modal do dodawania/edycji dodatkowego zadania
  private showExtraTaskModal(weekKey: string, existingTask?: ExtraTask): void {
    const modal = document.getElementById('modal')!;
    const modalTitle = document.getElementById('modalTitle')!;
    const modalBody = document.getElementById('modalBody')!;
    
    modalTitle.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18" style="display:inline;vertical-align:middle;margin-right:8px">
        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
      ${existingTask ? i18n.t('schedule.editExtraTask') : i18n.t('schedule.addExtraTask')}
    `;
    
    modalBody.innerHTML = `
      <div class="extra-task-modal">
        <div class="form-group">
          <label class="form-label">${i18n.t('schedule.extraTaskName')}</label>
          <input type="text" id="extraTaskName" class="form-control" placeholder="${i18n.t('schedule.extraTaskNamePlaceholder')}" value="${existingTask?.name || ''}">
        </div>
        <div class="form-row">
          <div class="form-group" style="flex:1">
            <label class="form-label">${i18n.t('schedule.extraTaskTimePerUnit')}</label>
            <input type="number" id="extraTaskTimePerUnit" class="form-control" min="1" value="${existingTask?.timePerUnit || 15}" placeholder="15">
          </div>
          <div class="form-group" style="flex:1">
            <label class="form-label">${i18n.t('schedule.extraTaskUnits')}</label>
            <input type="number" id="extraTaskUnits" class="form-control" min="1" value="${existingTask?.units || 1}" placeholder="1">
          </div>
          <div class="form-group" style="flex:1">
            <label class="form-label">${i18n.t('schedule.total')}</label>
            <div id="extraTaskTotal" class="extra-task-total">
              ${((existingTask?.timePerUnit || 15) * (existingTask?.units || 1))} min
            </div>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">${i18n.t('schedule.extraTaskComment')}</label>
          <input type="text" id="extraTaskComment" class="form-control" placeholder="${i18n.t('schedule.extraTaskCommentPlaceholder')}" value="${existingTask?.comment || ''}">
        </div>
      </div>
    `;
    
    // Dynamiczne aktualizowanie sumy
    const updateTotal = () => {
      const tpu = parseInt((document.getElementById('extraTaskTimePerUnit') as HTMLInputElement).value) || 0;
      const units = parseInt((document.getElementById('extraTaskUnits') as HTMLInputElement).value) || 0;
      const total = tpu * units;
      const hours = Math.floor(total / 60);
      const mins = total % 60;
      const totalEl = document.getElementById('extraTaskTotal');
      if (totalEl) {
        totalEl.textContent = hours > 0 ? `${hours}h ${mins > 0 ? mins + 'min' : ''}` : `${total}min`;
      }
    };
    
    document.getElementById('extraTaskTimePerUnit')?.addEventListener('input', updateTotal);
    document.getElementById('extraTaskUnits')?.addEventListener('input', updateTotal);
    
    const confirmBtn = modal.querySelector('.modal-confirm') as HTMLButtonElement;
    confirmBtn.style.display = '';
    confirmBtn.textContent = existingTask ? i18n.t('schedule.save') : i18n.t('common.add');
    confirmBtn.onclick = async () => {
      const name = (document.getElementById('extraTaskName') as HTMLInputElement)?.value.trim();
      if (!name) {
        this.showToast(i18n.t('schedule.extraTaskNameRequired'), 'warning');
        return;
      }
      
      const timePerUnit = parseInt((document.getElementById('extraTaskTimePerUnit') as HTMLInputElement).value) || 15;
      const units = parseInt((document.getElementById('extraTaskUnits') as HTMLInputElement).value) || 1;
      const comment = (document.getElementById('extraTaskComment') as HTMLInputElement)?.value.trim() || undefined;
      
      const task = {
        id: existingTask?.id || crypto.randomUUID(),
        name,
        week: weekKey,
        timePerUnit,
        units,
        comment: comment || null,
        created_at: existingTask?.created_at || Date.now()
      };
      
      try {
        if (existingTask) {
          await api.updateExtraTask(task.id, task);
        } else {
          await api.addExtraTask(task);
        }
        
        // Aktualizuj stan lokalny
        const idx = this.state.extraTasks.findIndex(t => t.id === task.id);
        if (idx >= 0) {
          this.state.extraTasks[idx] = task as ExtraTask;
        } else {
          this.state.extraTasks.push(task as ExtraTask);
        }
        
        this.showToast(existingTask ? i18n.t('schedule.extraTaskUpdated') : i18n.t('schedule.extraTaskAdded'), 'success');
        this.renderScheduleContent();
        this.renderPlanningGrid();
      } catch (err) {
        this.showToast(i18n.t('schedule.extraTaskError'), 'error');
      }
      
      this.hideModal();
    };
    
    modal.classList.add('active');
  }
  
  private async deleteExtraTask(taskId: string): Promise<void> {
    try {
      await api.deleteExtraTask(taskId);
      this.state.extraTasks = this.state.extraTasks.filter(t => t.id !== taskId);
      // Usuń też przypisania
      this.state.scheduleAssignments = this.state.scheduleAssignments.filter(
        (a: ScheduleAssignment) => a.projectId !== `extra-${taskId}`
      );
      this.showToast(i18n.t('schedule.extraTaskDeleted'), 'success');
      this.renderScheduleContent();
    } catch (err) {
      this.showToast(i18n.t('schedule.extraTaskError'), 'error');
    }
  }
  
  private async updateExtraTaskComment(taskId: string, comment: string): Promise<void> {
    try {
      const task = this.state.extraTasks.find(t => t.id === taskId);
      if (task) {
        await api.updateExtraTask(taskId, { ...task, comment });
        // Update all tasks with same name (grouped)
        const tasksWithSameName = this.state.extraTasks.filter(t => t.name === task.name);
        tasksWithSameName.forEach(t => t.comment = comment);
      }
    } catch (err) {
      this.showToast(i18n.t('schedule.extraTaskError'), 'error');
    }
  }

  private async addExtraTaskAssignment(
    extraProjectId: string,
    employeeId: string,
    week: string,
    shift: 1 | 2 | 3,
    note?: string
  ): Promise<void> {
    // Sprawdź duplikaty
    const exists = this.state.scheduleAssignments.find((a: ScheduleAssignment) =>
      a.projectId === extraProjectId && a.employeeId === employeeId && a.week === week && a.shift === shift
    );
    if (exists) {
      this.showToast(i18n.t('schedule.alreadyExists'), 'warning');
      return;
    }
    
    const assignment: ScheduleAssignment = {
      id: crypto.randomUUID(),
      projectId: extraProjectId,
      scope: 'project' as AssignmentScope,
      employeeId,
      week,
      shift,
      note,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    
    this.state.scheduleAssignments.push(assignment);
    await db.put('scheduleAssignments', assignment);
    
    const emp = this.state.employees.find(e => e.id === employeeId);
    this.showToast(`${emp?.firstName || ''} ${i18n.t('schedule.employeeAssigned')}`, 'success');
    this.renderScheduleContent();
  }
  
  private showExtraTaskEmployeePicker(
    extraProjectId: string,
    week: string,
    shift: 1 | 2 | 3,
    targetCell: HTMLElement
  ): void {
    document.querySelectorAll('.sched-picker').forEach(p => p.remove());
    document.querySelectorAll('.sched-scope-picker').forEach(p => p.remove());
    
    const picker = document.createElement('div');
    picker.className = 'sched-picker';
    
    const currentAssignments = this.state.scheduleAssignments.filter((a: ScheduleAssignment) =>
      a.projectId === extraProjectId && a.week === week && a.shift === shift
    );
    const assignedIds = new Set(currentAssignments.map((a: ScheduleAssignment) => a.employeeId));
    
    const availableEmployees = this.state.employees
      .filter(e => !assignedIds.has(e.id) && (!e.status || e.status === 'available'))
      .sort((a, b) => a.firstName.localeCompare(b.firstName));
    
    if (availableEmployees.length === 0) {
      picker.innerHTML = `<div class="sched-picker-empty">${i18n.t('schedule.noAvailableEmployees')}</div>`;
    } else {
      picker.innerHTML = availableEmployees.map(emp => `
        <button class="sched-picker-emp" data-id="${emp.id}">
          <span class="sched-picker-avatar" style="background:${emp.color}">${emp.firstName.charAt(0)}${emp.lastName.charAt(0)}</span>
          <span class="sched-picker-name">${emp.firstName} ${emp.lastName}</span>
        </button>
      `).join('');
    }
    
    const rect = targetCell.getBoundingClientRect();
    picker.style.position = 'fixed';
    picker.style.top = `${rect.bottom + 4}px`;
    picker.style.left = `${rect.left}px`;
    picker.style.zIndex = '1001';
    
    document.body.appendChild(picker);
    
    picker.querySelectorAll('.sched-picker-emp').forEach(btn => {
      btn.addEventListener('click', async () => {
        const empId = (btn as HTMLElement).dataset.id;
        if (empId) {
          await this.addExtraTaskAssignment(extraProjectId, empId, week, shift);
          picker.remove();
        }
      });
    });
    
    setTimeout(() => {
      document.addEventListener('click', function handler(e) {
        if (!picker.contains(e.target as Node)) {
          picker.remove();
          document.removeEventListener('click', handler);
        }
      });
    }, 10);
  }
  
  // Dodawanie przypisania z zakresem
  private async addScopedAssignment(
    projectId: string, 
    employeeId: string, 
    week: string, 
    shift: 1 | 2 | 3,
    scope: AssignmentScope,
    testId?: string,
    partId?: string
  ): Promise<void> {
    // Sprawdź czy taki sam przypisanie już istnieje (blokada duplikatów)
    const existingAssignment = this.state.scheduleAssignments.find((a: ScheduleAssignment) =>
      a.projectId === projectId &&
      a.employeeId === employeeId &&
      a.week === week &&
      a.shift === shift &&
      a.scope === scope &&
      a.testId === testId &&
      a.partId === partId
    );
    
    if (existingAssignment) {
      this.showToast(i18n.t('schedule.alreadyAssignedScope'), 'warning');
      return;
    }
    
    const assignment: ScheduleAssignment = {
      id: crypto.randomUUID(),
      projectId,
      employeeId,
      week,
      shift,
      scope,
      testId,
      partId,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    
    this.state.scheduleAssignments.push(assignment);
    await db.put('scheduleAssignments', assignment);
    
    // Loguj do historii
    const emp = this.state.employees.find(e => e.id === employeeId);
    const project = this.state.projects.find(p => p.id === projectId || `${p.customer_id}-${p.type_id}` === projectId);
    const customer = project ? this.state.customers.find(c => c.id === project.customer_id) : null;
    this.logScheduleChange('added', `${emp?.firstName} ${emp?.lastName}`, `${customer?.name || '?'} - ${i18n.t('schedule.shift')} ${shift}`);
    
    this.renderScheduleContent();
    this.renderScheduleAlerts();
    this.renderScheduleEmployeePanel();
    this.updateCoverageBar();
    
    const scopeText = scope === 'project' ? i18n.t('schedule.wholeProject') : (testId ? 'test' : i18n.t('schedule.scopePartText'));
    this.showToast(`${i18n.t('schedule.assignedTo')} ${shift} (${scopeText})`, 'success');
  }
  
  private async logScheduleChange(action: 'added' | 'removed' | 'modified', employee: string, details: string): Promise<void> {
    let history: Array<{action: string; type: string; details: string; timestamp: number}> = [];
    try {
      const historyData = await db.getPreference('kappa_schedule_history');
      history = Array.isArray(historyData) ? historyData : [];
    } catch (e) {
      history = [];
    }
    
    history.push({
      action,
      type: 'Assignment',
      details: `${action === 'added' ? i18n.t('schedule.logAdded') : action === 'removed' ? i18n.t('schedule.logRemoved') : i18n.t('schedule.logChanged')} <strong>${employee}</strong> → ${details}`,
      timestamp: Date.now()
    });
    
    // Zachowaj tylko ostatnie 100 wpisów
    if (history.length > 100) {
      history = history.slice(-100);
    }
    
    await db.setPreference('kappa_schedule_history', history);
  }

  // Picker pracownika - krok 1
  private showSimpleEmployeePicker(
    groupKey: string, 
    groupItems: Project[], 
    week: string, 
    shift: 1 | 2 | 3, 
    targetCell: HTMLElement
  ): void {
    document.querySelectorAll('.sched-picker').forEach(p => p.remove());
    document.querySelectorAll('.sched-scope-picker').forEach(p => p.remove());
    
    const picker = document.createElement('div');
    picker.className = 'sched-picker';
    
    const currentAssignments = this.state.scheduleAssignments.filter((a: ScheduleAssignment) =>
      (a.projectId === groupKey || groupItems.some(item => item.id === a.projectId)) && 
      a.week === week && a.shift === shift
    );
    const assignedIds = new Set(currentAssignments.map((a: ScheduleAssignment) => a.employeeId));
    const availableEmployees = this.state.employees.filter(e => !assignedIds.has(e.id) && (!e.status || e.status === 'available'));
    
    if (availableEmployees.length === 0) {
      picker.innerHTML = `<div class="sched-picker-empty">${i18n.t('schedule.noEmployees')}</div>`;
    } else {
      picker.innerHTML = `
        <div class="sched-picker-header">
          <span class="sched-picker-title">${i18n.t('schedule.selectEmployee')}</span>
        </div>
        <div class="sched-picker-list">
          ${availableEmployees.map(emp => `
            <button class="sched-picker-item" data-emp="${emp.id}">
              <span class="sched-picker-avatar" style="background:${emp.color}">${emp.firstName.charAt(0)}</span>
              <span class="sched-picker-name">${emp.firstName} ${emp.lastName}</span>
            </button>
          `).join('')}
        </div>
      `;
    }
    
    // Pozycjonowanie
    const rect = targetCell.getBoundingClientRect();
    picker.style.position = 'fixed';
    picker.style.zIndex = '1000';
    
    document.body.appendChild(picker);
    
    const pickerRect = picker.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    
    // Inteligentne pozycjonowanie - preferuj dół, ale jeśli nie mieści się ani u dołu ani u góry, wyśrodkuj
    let topPosition: number;
    if (rect.bottom + pickerRect.height + 10 <= viewportHeight) {
      // Mieści się na dole
      topPosition = rect.bottom + 4;
    } else if (rect.top - pickerRect.height - 4 >= 10) {
      // Mieści się na górze
      topPosition = rect.top - pickerRect.height - 4;
    } else {
      // Nie mieści się ani na górze ani na dole - wyśrodkuj w oknie
      topPosition = Math.max(10, (viewportHeight - pickerRect.height) / 2);
    }
    picker.style.top = `${topPosition}px`;
    
    if (rect.left + pickerRect.width > viewportWidth - 10) {
      picker.style.left = `${viewportWidth - pickerRect.width - 10}px`;
    } else {
      picker.style.left = `${rect.left}px`;
    }
    
    picker.querySelectorAll('.sched-picker-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const empId = (btn as HTMLElement).dataset.emp;
        if (empId) {
          picker.remove();
          this.showScopePicker(groupKey, groupItems, empId, week, shift, targetCell);
        }
      });
    });
    
    setTimeout(() => {
      document.addEventListener('click', function handler(e) {
        if (!picker.contains(e.target as Node)) {
          picker.remove();
          document.removeEventListener('click', handler);
        }
      });
    }, 10);
  }
  
  // Helper: generuj HTML opcji zakresu z WSZYSTKIMI testami z bazy
  private buildScopePickerHTML(groupItems: Project[], employee: Employee | undefined): string {
    const projectTestIds = new Set<string>();
    const uniqueParts = new Map<string, Part>();
    
    groupItems.forEach(p => {
      if (p.test_id) projectTestIds.add(p.test_id);
      if (p.part_id) {
        const part = this.state.parts.find(pt => pt.id === p.part_id);
        if (part) uniqueParts.set(part.id, part);
      }
    });
    
    // Testy z projektu
    const projectTests = this.state.tests.filter(t => projectTestIds.has(t.id));
    const parts = Array.from(uniqueParts.values());
    
    return `
      <div class="sched-scope-header">
        <span class="sched-scope-emp" style="--emp-color: ${employee?.color || '#888'}">${employee?.firstName || '?'}</span>
        <span class="sched-scope-title">${i18n.t('schedule.selectScope')}</span>
      </div>
      <div class="sched-scope-options">
        <button class="sched-scope-option primary" data-scope="project">
          <span class="sched-scope-icon">📦</span>
          <div class="sched-scope-text">
            <span class="sched-scope-label">${i18n.t('schedule.wholeProject')}</span>
            <span class="sched-scope-desc">${i18n.t('schedule.allTestsAndParts')}</span>
          </div>
        </button>
        
        ${projectTests.length > 0 ? `
          <div class="sched-scope-divider">${i18n.t('schedule.projectTests')}</div>
          ${projectTests.map(t => `
            <button class="sched-scope-option" data-scope="specific" data-test="${t.id}">
              <span class="sched-scope-icon">🧪</span>
              <span class="sched-scope-label">${t.name}</span>
            </button>
          `).join('')}
        ` : ''}
        
        ${parts.length > 1 ? `
          <div class="sched-scope-divider">${i18n.t('messages.part')}</div>
          ${parts.map(p => `
            <button class="sched-scope-option" data-scope="specific" data-part="${p.id}">
              <span class="sched-scope-icon">🔧</span>
              <span class="sched-scope-label">${p.name}</span>
            </button>
          `).join('')}
        ` : ''}
      </div>
    `;
  }

  // Picker zakresu przy pozycji drop
  private showScopePickerAtPosition(
    groupKey: string,
    groupItems: Project[],
    employeeId: string,
    week: string,
    shift: 1 | 2 | 3,
    x: number,
    y: number,
    replaceAssignmentId?: string
  ): void {
    document.querySelectorAll('.sched-scope-picker').forEach(p => p.remove());
    document.querySelectorAll('.sched-picker').forEach(p => p.remove());
    
    const picker = document.createElement('div');
    picker.className = 'sched-scope-picker';
    
    const employee = this.state.employees.find(e => e.id === employeeId);
    
    picker.innerHTML = this.buildScopePickerHTML(groupItems, employee);
    
    // Pozycjonowanie przy miejscu drop
    picker.style.position = 'fixed';
    picker.style.zIndex = '1001';
    
    document.body.appendChild(picker);
    
    const pickerRect = picker.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    
    // Pozycjonuj przy miejscu drop z inteligentnym dostosowaniem
    let topPosition = y + 10; // Trochę poniżej kursora
    let leftPosition = x - 20; // Lekko w lewo od kursora
    
    // Sprawdź czy mieści się w pionie
    if (topPosition + pickerRect.height > viewportHeight - 10) {
      topPosition = y - pickerRect.height - 10; // Pokaż powyżej
    }
    if (topPosition < 10) {
      topPosition = 10;
    }
    
    // Sprawdź czy mieści się w poziomie
    if (leftPosition + pickerRect.width > viewportWidth - 10) {
      leftPosition = viewportWidth - pickerRect.width - 10;
    }
    if (leftPosition < 10) {
      leftPosition = 10;
    }
    
    picker.style.top = `${topPosition}px`;
    picker.style.left = `${leftPosition}px`;
    
    // Event listeners
    picker.querySelectorAll('.sched-scope-option').forEach(btn => {
      btn.addEventListener('click', async () => {
        const scope = (btn as HTMLElement).dataset.scope as AssignmentScope;
        const testId = (btn as HTMLElement).dataset.test;
        const partId = (btn as HTMLElement).dataset.part;
        
        // Usuń stare przypisanie dopiero po potwierdzeniu scope
        if (replaceAssignmentId) {
          await this.removeAssignment(replaceAssignmentId);
        }
        await this.addScopedAssignment(groupKey, employeeId, week, shift, scope, testId, partId);
        picker.remove();
      });
    });
    
    setTimeout(() => {
      document.addEventListener('click', function handler(e) {
        if (!picker.contains(e.target as Node)) {
          picker.remove();
          document.removeEventListener('click', handler);
        }
      });
    }, 10);
  }
  
  // Picker zakresu - krok 2
  private showScopePicker(
    groupKey: string,
    groupItems: Project[],
    employeeId: string,
    week: string,
    shift: 1 | 2 | 3,
    targetCell: HTMLElement
  ): void {
    document.querySelectorAll('.sched-scope-picker').forEach(p => p.remove());
    document.querySelectorAll('.sched-picker').forEach(p => p.remove());
    
    const picker = document.createElement('div');
    picker.className = 'sched-scope-picker';
    
    const employee = this.state.employees.find(e => e.id === employeeId);
    
    picker.innerHTML = this.buildScopePickerHTML(groupItems, employee);
    
    // Pozycjonowanie
    const rect = targetCell.getBoundingClientRect();
    picker.style.position = 'fixed';
    picker.style.zIndex = '1001';
    
    document.body.appendChild(picker);
    
    const pickerRect = picker.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    
    // Inteligentne pozycjonowanie - preferuj dół, ale jeśli nie mieści się ani u dołu ani u góry, wyśrodkuj
    let topPosition: number;
    if (rect.bottom + pickerRect.height + 10 <= viewportHeight) {
      // Mieści się na dole
      topPosition = rect.bottom + 4;
    } else if (rect.top - pickerRect.height - 4 >= 10) {
      // Mieści się na górze
      topPosition = rect.top - pickerRect.height - 4;
    } else {
      // Nie mieści się ani na górze ani na dole - wyśrodkuj w oknie
      topPosition = Math.max(10, (viewportHeight - pickerRect.height) / 2);
    }
    picker.style.top = `${topPosition}px`;
    
    if (rect.left + pickerRect.width > viewportWidth - 10) {
      picker.style.left = `${viewportWidth - pickerRect.width - 10}px`;
    } else {
      picker.style.left = `${rect.left}px`;
    }
    
    // Event listeners
    picker.querySelectorAll('.sched-scope-option').forEach(btn => {
      btn.addEventListener('click', async () => {
        const scope = (btn as HTMLElement).dataset.scope as AssignmentScope;
        const testId = (btn as HTMLElement).dataset.test;
        const partId = (btn as HTMLElement).dataset.part;
        
        await this.addScopedAssignment(groupKey, employeeId, week, shift, scope, testId, partId);
        picker.remove();
      });
    });
    
    setTimeout(() => {
      document.addEventListener('click', function handler(e) {
        if (!picker.contains(e.target as Node)) {
          picker.remove();
          document.removeEventListener('click', handler);
        }
      });
    }, 10);
  }
  
  private renderOldScheduleProjectsPanel(): void {
    const headerContainer = document.getElementById('scheduleShiftsHeader');
    const projectsContainer = document.getElementById('scheduleProjectsList');
    
    if (!headerContainer || !projectsContainer) return;
    
    const weekKey = `${this.scheduleCurrentYear}-KW${this.scheduleCurrentWeek.toString().padStart(2, '0')}`;
    
    // Ikony SVG dla zmian
    const shiftIcons = [
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`,
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/><path d="M12 7a5 5 0 0 0 0 10" fill="currentColor" opacity="0.3"/></svg>`,
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`
    ];
    const shiftColors = ['#f59e0b', '#3b82f6', '#6366f1'];
    
    // Render modern header with icons
    headerContainer.className = `grid-header shifts-${this.scheduleShiftSystem}`;
    let headerHtml = `<div class="header-cell project-col">${i18n.t('schedule.project')} / Test</div>`;
    for (let s = 1; s <= this.scheduleShiftSystem; s++) {
      const shiftLabels = [i18n.t('schedule.shiftMorning'), i18n.t('schedule.shiftAfternoon'), i18n.t('schedule.shiftNight')];
      const shiftTimes = ['6:00-14:00', '14:00-22:00', '22:00-6:00'];
      headerHtml += `<div class="header-cell shift-col shift-${s}" style="--shift-color: ${shiftColors[s-1]}">
        <span class="shift-icon">${shiftIcons[s-1]}</span>
        <div class="shift-info">
          <span class="shift-number">${s}</span>
          <span class="shift-name">${shiftLabels[s-1] || i18n.t('schedule.shiftLabel').replace('{0}', String(s))}</span>
          <span class="shift-time">${shiftTimes[s-1]}</span>
        </div>
      </div>`;
    }
    headerContainer.innerHTML = headerHtml;
    
    // Get projects with SOLL > 0 in current week
    const weekProjects = this.state.projects.filter(p => {
      const weekData = p.weeks[weekKey];
      return weekData && weekData.soll > 0 && !p.hidden;
    });
    
    if (weekProjects.length === 0) {
      projectsContainer.innerHTML = `
        <div class="grid-empty">
          <div class="empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48">
              <rect x="3" y="4" width="18" height="18" rx="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
          </div>
          <h3>${i18n.t('schedule.noProjectsThisWeek')}</h3>
          <p>${i18n.t('schedule.projectsAppearAutomatically')}</p>
        </div>
      `;
      return;
    }
    
    // Group projects by Customer + Type
    const projectGroups = new Map<string, {
      customerName: string;
      typeName: string;
      customerId: string;
      typeId: string;
      items: typeof weekProjects;
      totalSoll: number;
    }>();
    
    weekProjects.forEach(p => {
      const customer = this.state.customers.find(c => c.id === p.customer_id);
      const type = this.state.types.find(t => t.id === p.type_id);
      const groupKey = `${p.customer_id}-${p.type_id}`;
      
      if (!projectGroups.has(groupKey)) {
        projectGroups.set(groupKey, {
          customerName: customer?.name || '?',
          typeName: type?.name || '?',
          customerId: p.customer_id,
          typeId: p.type_id,
          items: [],
          totalSoll: 0
        });
      }
      
      const group = projectGroups.get(groupKey)!;
      group.items.push(p);
      const weekData = p.weeks[weekKey] || { ist: 0, soll: 0 };
      group.totalSoll += weekData.soll;
    });
    
    projectsContainer.innerHTML = '';
    
    projectGroups.forEach((projectGroup, groupKey) => {
      const comment = this.getProjectComment(groupKey, weekKey);
      const partsCount = projectGroup.items.length;
      
      // Get all assignments for this project group (any scope)
      const groupAssignments = this.state.scheduleAssignments.filter((a: ScheduleAssignment) =>
        (a.projectId === groupKey || projectGroup.items.some(item => item.id === a.projectId)) &&
        a.week === weekKey
      );
      
      // Filtruj po wybranym pracowniku
      if (this.scheduleFilterEmployee) {
        const hasSelectedEmployee = groupAssignments.some(a => a.employeeId === this.scheduleFilterEmployee);
        if (!hasSelectedEmployee) return; // Pomiń projekt jeśli nie ma wybranego pracownika
      }
      
      // Get specific assignments (not project-level) to show in summary
      const specificAssignments = groupAssignments.filter((a: ScheduleAssignment) => 
        a.scope === 'audit' || a.scope === 'adhesion' || a.scope === 'specific'
      );
      
      // Oblicz pokrycie projektu - sprawdź jakie zakresy są obsadzone
      const hasProjectLevel = groupAssignments.some(a => !a.scope || a.scope === 'project');
      const hasAudit = groupAssignments.some(a => a.scope === 'audit');
      const hasAdhesion = groupAssignments.some(a => a.scope === 'adhesion');
      const hasSpecific = groupAssignments.some(a => a.scope === 'specific');
      
      // Określ status pokrycia
      let coverageStatus = 'uncovered'; // brak obsady
      let coverageLabel = '';
      let missingScopes: string[] = [];
      
      if (hasProjectLevel) {
        coverageStatus = 'full'; // pełna obsada
        coverageLabel = i18n.t('schedule.covered');
      } else if (hasAudit || hasAdhesion || hasSpecific) {
        coverageStatus = 'partial'; // częściowa obsada
        if (!hasAudit) missingScopes.push(i18n.t('schedule.scopeAudit'));
        if (!hasAdhesion) missingScopes.push(i18n.t('schedule.scopeAdhesion'));
        coverageLabel = i18n.t('schedule.partiallyCovered');
      }
      
      // Create project card
      const projectCard = document.createElement('div');
      projectCard.className = `project-card coverage-${coverageStatus}`;
      
      // Project header row
      const projectHeader = document.createElement('div');
      projectHeader.className = `project-header shifts-${this.scheduleShiftSystem}`;
      
      // Project info cell
      const projectInfo = document.createElement('div');
      projectInfo.className = 'project-info-cell';
      
      const coverageBadge = coverageStatus === 'partial' 
        ? `<span class="badge badge-partial" title="Brakuje: ${missingScopes.join(', ')}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            ${coverageLabel}
           </span>`
        : coverageStatus === 'full'
        ? `<span class="badge badge-full">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><polyline points="20 6 9 17 4 12"/></svg>
            ${coverageLabel}
           </span>`
        : '';
      
      projectInfo.innerHTML = `
        <button class="expand-btn">
          <svg class="expand-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
        <div class="project-details">
          <div class="project-title">${projectGroup.customerName}</div>
          <div class="project-subtitle">${projectGroup.typeName}</div>
        </div>
        <div class="project-badges">
          <span class="badge badge-parts">${partsCount} ${partsCount === 1 ? i18n.t('schedule.partSingular') : i18n.t('schedule.partPlural')}</span>
          <span class="badge badge-soll">SOLL: ${projectGroup.totalSoll}</span>
          ${coverageBadge}
          ${comment ? `<span class="badge badge-comment has-hover" data-comment="${comment.replace(/"/g, '&quot;')}" data-project="${groupKey}" data-week="${weekKey}">📝</span>` : ''}
        </div>
        <button class="btn-comment ${comment ? 'has-comment' : ''}" title="${i18n.t('schedule.addComment')}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        </button>
      `;
      
      // Hover popup for comments
      const commentBadge = projectInfo.querySelector('.badge-comment.has-hover');
      if (commentBadge) {
        commentBadge.addEventListener('mouseenter', (e) => {
          const badge = e.target as HTMLElement;
          this.showCommentHoverPopup(badge, comment || '', groupKey, weekKey);
        });
        commentBadge.addEventListener('mouseleave', () => {
          // Delay removal to allow clicking inside popup
          setTimeout(() => {
            const popup = document.querySelector('.comment-hover-popup:not(:hover)');
            if (popup) popup.remove();
          }, 200);
        });
      }
      
      // Toggle expansion
      const expandBtn = projectInfo.querySelector('.expand-btn');
      expandBtn?.addEventListener('click', () => {
        projectCard.classList.toggle('expanded');
      });
      
      // Comment button
      projectInfo.querySelector('.btn-comment')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showProjectCommentModal(groupKey, weekKey, comment);
      });
      
      projectHeader.appendChild(projectInfo);
      
      // Shift drop zones for project-level assignments
      for (let s = 1; s <= this.scheduleShiftSystem; s++) {
        const shiftCell = document.createElement('div');
        shiftCell.className = `shift-cell shift-${s}`;
        
        // Get project-level assignments for this shift (including legacy without scope)
        const shiftAssignments = groupAssignments.filter((a: ScheduleAssignment) =>
          a.shift === s && (!a.scope || a.scope === 'project')
        );
        
        // Render assigned employees
        shiftAssignments.forEach((assignment: ScheduleAssignment) => {
          const emp = this.state.employees.find(e => e.id === assignment.employeeId);
          if (!emp) return;
          
          // Pobierz notatkę bez odpowiedzi
          let noteDisplay = assignment.note || '';
          if (noteDisplay.includes('---REPLIES---')) {
            noteDisplay = noteDisplay.split('---REPLIES---')[0].trim();
          }
          
          const chip = document.createElement('div');
          chip.className = `assignment-chip scope-project ${assignment.note ? 'has-note' : ''}`;
          chip.style.setProperty('--emp-color', emp.color);
          chip.dataset.assignmentId = assignment.id;
          chip.innerHTML = `
            <span class="chip-badge">P</span>
            <span class="chip-name">${emp.firstName}</span>
            ${assignment.note ? `<span class="chip-note-icon">💬</span>` : ''}
            <button class="chip-comment-btn" title="${i18n.t('schedule.addEditNote')}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
            </button>
            <button class="chip-remove" data-id="${assignment.id}">×</button>
          `;
          
          // Hover dla notatki
          if (assignment.note) {
            let hideTimeout2: number | null = null;
            chip.addEventListener('mouseenter', (e) => {
              if (hideTimeout2) { clearTimeout(hideTimeout2); hideTimeout2 = null; }
              this.showChipNotePopup(e as MouseEvent, assignment, emp);
            });
            chip.addEventListener('mouseleave', () => {
              hideTimeout2 = window.setTimeout(() => {
                const popup = document.querySelector('.chip-note-popup');
                if (popup && !popup.matches(':hover')) popup.remove();
              }, 300);
            });
          }
          
          // Kliknięcie w ikonę komentarza - otwórz modal
          chip.querySelector('.chip-comment-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showAssignmentNoteModal(assignment.id);
          });
          
          chip.querySelector('.chip-remove')?.addEventListener('click', async (e) => {
            e.stopPropagation();
            await this.removeAssignment(assignment.id);
          });
          
          shiftCell.appendChild(chip);
        });
        
        // Show specific assignments summary in project row
        const specificShiftAssignments = specificAssignments.filter((a: ScheduleAssignment) => a.shift === s);
        specificShiftAssignments.forEach((assignment: ScheduleAssignment) => {
          const emp = this.state.employees.find(e => e.id === assignment.employeeId);
          if (!emp) return;
          
          const scopeLabel = assignment.scope === 'audit' ? 'A' : assignment.scope === 'adhesion' ? 'H' : 'S';
          const scopeTitle = assignment.scope === 'audit' ? i18n.t('schedule.scopeAudit') : assignment.scope === 'adhesion' ? i18n.t('schedule.scopeAdhesion') : (assignment.note || i18n.t('schedule.scopeSpecific'));
          const scopeIcon = assignment.scope === 'audit' ? '🔍' : assignment.scope === 'adhesion' ? '🔗' : '📌';
          
          // Pobierz notatkę bez odpowiedzi
          let noteDisplay = assignment.note || '';
          if (noteDisplay.includes('---REPLIES---')) {
            noteDisplay = noteDisplay.split('---REPLIES---')[0].trim();
          }
          
          const chip = document.createElement('div');
          chip.className = `assignment-chip scope-${assignment.scope} ${assignment.note ? 'has-note' : ''}`;
          chip.style.setProperty('--emp-color', emp.color);
          chip.dataset.assignmentId = assignment.id;
          chip.innerHTML = `
            <span class="chip-badge">${scopeLabel}</span>
            <span class="chip-name">${emp.firstName}</span>
            ${assignment.note ? `<span class="chip-note-icon">💬</span>` : ''}
            <button class="chip-comment-btn" title="${i18n.t('schedule.addEditNote')}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
            </button>
            <button class="chip-remove" data-id="${assignment.id}">×</button>
          `;
          
          // Hover dla notatki
          if (assignment.note) {
            let hideTimeout3: number | null = null;
            chip.addEventListener('mouseenter', (e) => {
              if (hideTimeout3) { clearTimeout(hideTimeout3); hideTimeout3 = null; }
              this.showChipNotePopup(e as MouseEvent, assignment, emp);
            });
            chip.addEventListener('mouseleave', () => {
              hideTimeout3 = window.setTimeout(() => {
                const popup = document.querySelector('.chip-note-popup');
                if (popup && !popup.matches(':hover')) popup.remove();
              }, 300);
            });
          }
          
          // Kliknięcie w ikonę komentarza - otwórz modal
          chip.querySelector('.chip-comment-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showAssignmentNoteModal(assignment.id);
          });
          
          chip.querySelector('.chip-remove')?.addEventListener('click', async (e) => {
            e.stopPropagation();
            await this.removeAssignment(assignment.id);
          });
          
          shiftCell.appendChild(chip);
        });
        
        // Drop zone for new assignments
        const dropIndicator = document.createElement('div');
        dropIndicator.className = 'drop-indicator';
        dropIndicator.innerHTML = `<span>+</span>`;
        shiftCell.appendChild(dropIndicator);
        
        // Drop events
        shiftCell.addEventListener('dragover', (e) => {
          e.preventDefault();
          shiftCell.classList.add('drag-over');
        });
        shiftCell.addEventListener('dragleave', () => shiftCell.classList.remove('drag-over'));
        shiftCell.addEventListener('drop', async (e) => {
          e.preventDefault();
          shiftCell.classList.remove('drag-over');
          if (this.draggedEmployeeId) {
            // Show assignment type modal
            this.showAssignmentTypeModal(groupKey, undefined, this.draggedEmployeeId, weekKey, s as 1 | 2 | 3);
          }
        });
        
        // Click to add via modal
        dropIndicator.addEventListener('click', () => {
          this.showSelectEmployeeModal(groupKey, undefined, weekKey, s as 1 | 2 | 3);
        });
        
        projectHeader.appendChild(shiftCell);
      }
      
      projectCard.appendChild(projectHeader);
      
      // Expandable details (tests/parts)
      const detailsSection = document.createElement('div');
      detailsSection.className = 'project-details-section';
      
      // Group items by test
      const testMap = new Map<string, { test: Test; parts: Array<{ part: Part; projectId: string; soll: number }> }>();
      
      projectGroup.items.forEach(item => {
        const test = this.state.tests.find(t => t.id === item.test_id);
        const part = this.state.parts.find(p => p.id === item.part_id);
        const weekData = item.weeks[weekKey] || { ist: 0, soll: 0 };
        
        if (test && part) {
          if (!testMap.has(test.id)) {
            testMap.set(test.id, { test, parts: [] });
          }
          testMap.get(test.id)!.parts.push({ part, projectId: item.id, soll: weekData.soll });
        }
      });
      
      testMap.forEach(({ test, parts }) => {
        const testSection = document.createElement('div');
        testSection.className = 'test-section';
        
        // Test header
        const testHeader = document.createElement('div');
        testHeader.className = `test-header shifts-${this.scheduleShiftSystem}`;
        testHeader.innerHTML = `
          <div class="test-info">
            <span class="test-indicator" style="background-color: ${test.color || '#0097AC'}"></span>
            <span class="test-name">${test.name}</span>
            <span class="test-count">${parts.length} ${parts.length === 1 ? i18n.t('schedule.partSingular') : i18n.t('schedule.partPlural')}</span>
          </div>
        `;
        
        // Shift cells for test-level - allow audit/adhesion assignments
        for (let s = 1; s <= this.scheduleShiftSystem; s++) {
          const testShiftCell = document.createElement('div');
          testShiftCell.className = `test-shift-cell shift-${s}`;
          testShiftCell.innerHTML = `<span class="test-drop-hint">${i18n.t('schedule.dragToScope')}</span>`;
          
          testShiftCell.addEventListener('dragover', (e) => {
            e.preventDefault();
            testShiftCell.classList.add('drag-over');
          });
          testShiftCell.addEventListener('dragleave', () => testShiftCell.classList.remove('drag-over'));
          testShiftCell.addEventListener('drop', async (e) => {
            e.preventDefault();
            testShiftCell.classList.remove('drag-over');
            if (this.draggedEmployeeId) {
              this.showAssignmentTypeModal(groupKey, test.id, this.draggedEmployeeId, weekKey, s as 1 | 2 | 3, true);
            }
          });
          
          testHeader.appendChild(testShiftCell);
        }
        
        testSection.appendChild(testHeader);
        
        // Parts grid
        const partsGrid = document.createElement('div');
        partsGrid.className = 'parts-grid';
        
        parts.forEach(({ part, projectId, soll }) => {
          const partRow = document.createElement('div');
          partRow.className = `part-row shifts-${this.scheduleShiftSystem}`;
          
          partRow.innerHTML = `
            <div class="part-info">
              <span class="part-name">${part.name}</span>
              <span class="part-soll">${soll}</span>
            </div>
          `;
          
          // Shift cells for part-specific assignments
          for (let s = 1; s <= this.scheduleShiftSystem; s++) {
            const partShiftCell = document.createElement('div');
            partShiftCell.className = `part-shift-cell shift-${s}`;
            
            // Get specific assignments for this part
            const partAssignments = this.state.scheduleAssignments.filter((a: ScheduleAssignment) =>
              a.projectId === projectId &&
              a.week === weekKey &&
              a.shift === s &&
              a.scope === 'specific'
            );
            
            partAssignments.forEach((assignment: ScheduleAssignment) => {
              const emp = this.state.employees.find(e => e.id === assignment.employeeId);
              if (!emp) return;
              
              const chip = document.createElement('span');
              chip.className = 'mini-chip';
              chip.style.setProperty('--emp-color', emp.color);
              chip.innerHTML = `${emp.firstName.charAt(0)}${emp.lastName.charAt(0)}`;
              chip.title = `${emp.firstName} ${emp.lastName}${assignment.note ? ': ' + assignment.note : ''}`;
              
              chip.addEventListener('click', async () => {
                if (confirm(i18n.t('schedule.confirmRemoveAssignment').replace('{0}', emp.firstName).replace('{1}', emp.lastName))) {
                  await this.removeAssignment(assignment.id);
                }
              });
              
              partShiftCell.appendChild(chip);
            });
            
            // Drop zone
            partShiftCell.addEventListener('dragover', (e) => {
              e.preventDefault();
              partShiftCell.classList.add('drag-over');
            });
            partShiftCell.addEventListener('dragleave', () => partShiftCell.classList.remove('drag-over'));
            partShiftCell.addEventListener('drop', async (e) => {
              e.preventDefault();
              partShiftCell.classList.remove('drag-over');
              if (this.draggedEmployeeId) {
                this.showSpecificAssignmentModal(projectId, test.id, part.id, this.draggedEmployeeId, weekKey, s as 1 | 2 | 3, part.name);
              }
            });
            
            partRow.appendChild(partShiftCell);
          }
          
          partsGrid.appendChild(partRow);
        });
        
        testSection.appendChild(partsGrid);
        detailsSection.appendChild(testSection);
      });
      
      projectCard.appendChild(detailsSection);
      projectsContainer.appendChild(projectCard);
    });
  }
  
  private showAssignmentTypeModal(projectId: string, testId: string | undefined, employeeId: string, week: string, shift: 1 | 2 | 3, testLevel: boolean = false): void {
    const emp = this.state.employees.find(e => e.id === employeeId);
    if (!emp) return;
    
    const modal = document.getElementById('modal')!;
    const modalTitle = document.getElementById('modalTitle')!;
    const modalBody = document.getElementById('modalBody')!;
    
    modalTitle.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18" style="display:inline;vertical-align:middle;margin-right:8px">
        <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/>
        <line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/>
      </svg>
      ${i18n.t('schedule.assignEmployee').replace('{0}', emp.firstName).replace('{1}', emp.lastName)}
    `;
    
    const scopeOptions = testLevel ? `
      <label class="scope-option">
        <input type="radio" name="assignmentScope" value="audit">
        <div class="scope-card">
          <span class="scope-badge scope-audit">A</span>
          <div class="scope-info">
            <strong>${i18n.t('schedule.scopeAudit')}</strong>
            <small>${i18n.t('schedule.scopeAuditDesc')}</small>
          </div>
        </div>
      </label>
      <label class="scope-option">
        <input type="radio" name="assignmentScope" value="adhesion">
        <div class="scope-card">
          <span class="scope-badge scope-adhesion">H</span>
          <div class="scope-info">
            <strong>${i18n.t('schedule.scopeAdhesion')}</strong>
            <small>${i18n.t('schedule.scopeAdhesionDesc')}</small>
          </div>
        </div>
      </label>
    ` : `
      <label class="scope-option">
        <input type="radio" name="assignmentScope" value="project" checked>
        <div class="scope-card">
          <span class="scope-badge scope-project">P</span>
          <div class="scope-info">
            <strong>${i18n.t('schedule.scopeFullProject')}</strong>
            <small>${i18n.t('schedule.scopeFullProjectDesc')}</small>
          </div>
        </div>
      </label>
      <label class="scope-option">
        <input type="radio" name="assignmentScope" value="audit">
        <div class="scope-card">
          <span class="scope-badge scope-audit">A</span>
          <div class="scope-info">
            <strong>${i18n.t('schedule.scopeAuditOnly')}</strong>
            <small>${i18n.t('schedule.scopeAuditOnlyDesc')}</small>
          </div>
        </div>
      </label>
      <label class="scope-option">
        <input type="radio" name="assignmentScope" value="adhesion">
        <div class="scope-card">
          <span class="scope-badge scope-adhesion">H</span>
          <div class="scope-info">
            <strong>${i18n.t('schedule.scopeAdhesionOnly')}</strong>
            <small>${i18n.t('schedule.scopeAdhesionOnlyDesc')}</small>
          </div>
        </div>
      </label>
    `;
    
    modalBody.innerHTML = `
      <div class="assignment-modal">
        <div class="employee-preview">
          <div class="employee-avatar-lg" style="background-color: ${emp.color}">
            ${emp.firstName.charAt(0)}${emp.lastName.charAt(0)}
          </div>
          <div>
            <strong>${emp.firstName} ${emp.lastName}</strong>
            <small>${i18n.t('schedule.shiftAndWeek').replace('{0}', String(shift)).replace('{1}', week)}</small>
          </div>
        </div>
        
        <div class="scope-selection">
          <label class="form-label">${i18n.t('schedule.workScopeLabel')}</label>
          <div class="scope-options">
            ${scopeOptions}
          </div>
        </div>
        
        <div class="form-group">
          <label class="form-label">${i18n.t('schedule.noteOptionalLabel')}</label>
          <input type="text" id="assignmentNote" class="form-control" placeholder="${i18n.t('schedule.notePlaceholderAssignment')}">
        </div>
      </div>
    `;
    
    const confirmBtn = modal.querySelector('.modal-confirm') as HTMLButtonElement;
    confirmBtn.style.display = '';
    confirmBtn.textContent = i18n.t('schedule.assign');
    confirmBtn.onclick = async () => {
      const scopeEl = document.querySelector('input[name="assignmentScope"]:checked') as HTMLInputElement;
      const scope = (scopeEl?.value || 'project') as 'project' | 'audit' | 'adhesion' | 'specific';
      const note = (document.getElementById('assignmentNote') as HTMLInputElement)?.value.trim() || undefined;
      
      await this.addAssignmentWithScope(projectId, testId, undefined, employeeId, week, shift, scope, note);
      this.hideModal();
    };
    
    modal.classList.add('active');
  }
  
  private showSpecificAssignmentModal(projectId: string, testId: string, partId: string, employeeId: string, week: string, shift: 1 | 2 | 3, partName: string): void {
    const emp = this.state.employees.find(e => e.id === employeeId);
    if (!emp) return;
    
    const modal = document.getElementById('modal')!;
    const modalTitle = document.getElementById('modalTitle')!;
    const modalBody = document.getElementById('modalBody')!;
    
    modalTitle.textContent = i18n.t('schedule.assignToPart').replace('{0}', partName);
    
    modalBody.innerHTML = `
      <div class="assignment-modal">
        <div class="employee-preview">
          <div class="employee-avatar-lg" style="background-color: ${emp.color}">
            ${emp.firstName.charAt(0)}${emp.lastName.charAt(0)}
          </div>
          <div>
            <strong>${emp.firstName} ${emp.lastName}</strong>
            <small>${i18n.t('schedule.shiftAndPart').replace('{0}', String(shift)).replace('{1}', partName)}</small>
          </div>
        </div>
        
        <div class="info-box">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
          </svg>
          <span>${i18n.t('schedule.specificPartNote')}</span>
        </div>
        
        <div class="form-group">
          <label class="form-label">${i18n.t('schedule.whatToDoRequired')}</label>
          <input type="text" id="specificNote" class="form-control" placeholder="${i18n.t('schedule.specificPartNotePlaceholder')}" required>
        </div>
      </div>
    `;
    
    const confirmBtn = modal.querySelector('.modal-confirm') as HTMLButtonElement;
    confirmBtn.style.display = '';
    confirmBtn.textContent = i18n.t('schedule.assignToPartBtn');
    confirmBtn.onclick = async () => {
      const note = (document.getElementById('specificNote') as HTMLInputElement)?.value.trim();
      if (!note) {
        this.showToast(i18n.t('schedule.specifyTask'), 'warning');
        return;
      }
      
      await this.addAssignmentWithScope(projectId, testId, partId, employeeId, week, shift, 'specific', note);
      this.hideModal();
    };
    
    modal.classList.add('active');
  }
  
  private showSelectEmployeeModal(projectId: string, testId: string | undefined, week: string, shift: 1 | 2 | 3): void {
    const modal = document.getElementById('modal')!;
    const modalTitle = document.getElementById('modalTitle')!;
    const modalBody = document.getElementById('modalBody')!;
    
    modalTitle.textContent = i18n.t('schedule.selectEmployee');
    
    if (this.state.employees.length === 0) {
      modalBody.innerHTML = `
        <div class="empty-state">
          <p>${i18n.t('schedule.noEmployeesMsg')}</p>
          <button class="btn-primary" onclick="window.kappaApp.hideModal(); window.kappaApp.showAddEmployeeModal();">${i18n.t('schedule.addEmployeeBtn')}</button>
        </div>
      `;
      const confirmBtn = modal.querySelector('.modal-confirm') as HTMLButtonElement;
      confirmBtn.style.display = 'none';
      modal.classList.add('active');
      return;
    }
    
    modalBody.innerHTML = `
      <div class="employee-select-grid">
        ${this.state.employees.map(emp => `
          <button class="employee-select-btn" data-employee-id="${emp.id}">
            <div class="employee-avatar" style="background-color: ${emp.color}">
              ${emp.firstName.charAt(0)}${emp.lastName.charAt(0)}
            </div>
            <span>${emp.firstName} ${emp.lastName}</span>
          </button>
        `).join('')}
      </div>
    `;
    
    modalBody.querySelectorAll('.employee-select-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const empId = (btn as HTMLElement).dataset.employeeId;
        if (empId) {
          this.hideModal();
          this.showAssignmentTypeModal(projectId, testId, empId, week, shift);
        }
      });
    });
    
    const confirmBtn = modal.querySelector('.modal-confirm') as HTMLButtonElement;
    confirmBtn.style.display = 'none';
    
    modal.classList.add('active');
  }
  
  private async addAssignmentWithScope(
    projectId: string, 
    testId: string | undefined, 
    partId: string | undefined,
    employeeId: string, 
    week: string, 
    shift: 1 | 2 | 3,
    scope: 'project' | 'audit' | 'adhesion' | 'specific',
    note?: string
  ): Promise<void> {
    // Check if already exists with same scope
    const exists = this.state.scheduleAssignments.find((a: ScheduleAssignment) =>
      a.projectId === projectId &&
      a.employeeId === employeeId &&
      a.week === week &&
      a.shift === shift &&
      a.scope === scope &&
      (scope === 'specific' ? a.partId === partId : true)
    );
    
    if (exists) {
      this.showToast(i18n.t('schedule.alreadyExists'), 'warning');
      return;
    }
    
    const assignment: ScheduleAssignment = {
      id: this.generateId(),
      projectId,
      scope,
      testId,
      partId,
      employeeId,
      week,
      shift,
      note,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    
    this.state.scheduleAssignments.push(assignment);
    await db.put('scheduleAssignments', assignment);
    
    const emp = this.state.employees.find(e => e.id === employeeId);
    const scopeLabels = { project: i18n.t('schedule.project'), audit: i18n.t('schedule.scopeAudit'), adhesion: i18n.t('schedule.scopeAdhesion'), specific: i18n.t('schedule.scopeSpecific') };
    await this.addLog('created', 'Assignment', `${emp?.firstName || ''} → ${week} Z${shift} [${scopeLabels[scope]}]`);
    
    this.showToast(i18n.t('schedule.employeeAssigned'), 'success');
    this.renderScheduleContent();
  }
  
  private createDropZone(projectId: string, testId: string | undefined, week: string, shift: 1 | 2 | 3, isGroupLevel: boolean = false): HTMLElement {
    const zone = document.createElement('div');
    zone.className = `drop-zone shift-${shift}`;
    zone.dataset.projectId = projectId;
    zone.dataset.week = week;
    zone.dataset.shift = shift.toString();
    if (testId) zone.dataset.testId = testId;
    
    // Get assignments for this zone (legacy compatibility)
    const assignments = this.state.scheduleAssignments.filter((a: ScheduleAssignment) =>
      a.projectId === projectId &&
      a.week === week &&
      a.shift === shift &&
      (testId ? a.testId === testId : !a.testId)
    );
    
    // Render assigned employees as chips
    assignments.forEach((assignment: ScheduleAssignment) => {
      const emp = this.state.employees.find(e => e.id === assignment.employeeId);
      if (!emp) return;
      
      const scopeBadge = assignment.scope === 'project' ? 'P' : assignment.scope === 'audit' ? 'A' : assignment.scope === 'adhesion' ? 'H' : 'S';
      
      const chip = document.createElement('div');
      chip.className = `emp-chip scope-${assignment.scope || 'project'}`;
      chip.style.backgroundColor = emp.color + '22';
      chip.style.color = emp.color;
      chip.innerHTML = `
        <span class="chip-scope">${scopeBadge}</span>
        <span>${emp.firstName}</span>
        <span class="remove" data-id="${assignment.id}">×</span>
      `;
      
      chip.querySelector('.remove')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        await this.removeAssignment(assignment.id);
      });
      
      zone.appendChild(chip);
    });
    
    // Drop events
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('drag-over');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', async (e) => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      
      if (this.draggedEmployeeId) {
        await this.addAssignmentWithScope(projectId, testId, undefined, this.draggedEmployeeId, week, shift, 'project');
      }
    });
    
    return zone;
  }
  
  private async removeAssignment(assignmentId: string): Promise<void> {
    const idx = this.state.scheduleAssignments.findIndex((a: ScheduleAssignment) => a.id === assignmentId);
    if (idx !== -1) {
      const assignment = this.state.scheduleAssignments[idx];
      const emp = this.state.employees.find(e => e.id === assignment.employeeId);
      const project = this.state.projects.find(p => p.id === assignment.projectId || `${p.customer_id}-${p.type_id}` === assignment.projectId);
      const customer = project ? this.state.customers.find(c => c.id === project.customer_id) : null;
      
      this.state.scheduleAssignments.splice(idx, 1);
      await db.delete('scheduleAssignments', assignmentId);
      
      // Czytelny log zamiast ID
      const empName = emp ? `${emp.firstName} ${emp.lastName}` : '?';
      const projectName = customer?.name || '?';
      const scopeLabels: Record<string, string> = { project: i18n.t('schedule.project'), audit: i18n.t('schedule.scopeAudit'), adhesion: i18n.t('schedule.scopeAdhesion'), specific: i18n.t('schedule.scopeSpecific') };
      const scopeLabel = scopeLabels[assignment.scope] || assignment.scope;
      await this.addLog('deleted', 'Assignment', `${empName} ← ${projectName}`, `Z${assignment.shift}, ${scopeLabel}`);
      
      // Loguj do historii
      this.logScheduleChange('removed', `${emp?.firstName} ${emp?.lastName}`, `${customer?.name || '?'} - ` + i18n.t('schedule.shift') + ` ${assignment.shift}`);
      
      this.renderScheduleContent();
      this.renderScheduleEmployeePanel();
      this.updateCoverageBar();
    }
  }
  
  private getProjectComment(projectId: string, week: string): string | undefined {
    const comment = this.state.projectComments.find((c: ProjectComment) =>
      c.projectId === projectId && c.week === week
    );
    return comment?.comment;
  }
  
  // Sprawdź status obsadzenia projektu
  // Logika: projekt jest "w pełni obsadzony" gdy:
  // 1. Ma przypisanie z scope='project' (osoba do całego projektu), LUB
  // 2. Wszystkie unikalne testy w projekcie mają przypisane osoby
  private getProjectStaffingStatus(
    groupKey: string, 
    groupItems: Project[], 
    assignments: ScheduleAssignment[]
  ): { class: string; icon: string; tooltip: string } {
    // Sprawdź czy jest przypisanie do całego projektu
    const hasProjectScope = assignments.some(a => a.scope === 'project');
    
    if (hasProjectScope) {
      return {
        class: 'staffing-full',
        icon: '✓',
        tooltip: i18n.t('schedule.fullyCovered')
      };
    }
    
    // Zbierz wszystkie unikalne testy w tej grupie projektów
    const uniqueTestIds = new Set<string>();
    groupItems.forEach(p => {
      if (p.test_id) uniqueTestIds.add(p.test_id);
    });
    
    if (uniqueTestIds.size === 0) {
      // Brak testów - sprawdź czy są jakiekolwiek przypisania
      if (assignments.length > 0) {
        return {
          class: 'staffing-full',
          icon: '✓',
          tooltip: i18n.t('schedule.staffingCovered')
        };
      }
      return {
        class: 'staffing-none',
        icon: '○',
        tooltip: i18n.t('schedule.noCoverage')
      };
    }
    
    // Sprawdź które testy mają przypisania
    const coveredTestIds = new Set<string>();
    
    assignments.forEach(a => {
      if (a.scope === 'specific' && a.testId) {
        coveredTestIds.add(a.testId);
      } else if (a.scope === 'audit') {
        // Audyt pokrywa testy typu "audit"
        groupItems.forEach(p => {
          const test = this.state.tests.find(t => t.id === p.test_id);
          if (test?.name?.toLowerCase().includes('audit') || test?.name?.toLowerCase().includes('audyt')) {
            coveredTestIds.add(p.test_id);
          }
        });
      } else if (a.scope === 'adhesion') {
        // Przyczepność pokrywa testy typu "adhesion/peel"
        groupItems.forEach(p => {
          const test = this.state.tests.find(t => t.id === p.test_id);
          if (test?.name?.toLowerCase().includes('peel') || 
              test?.name?.toLowerCase().includes('adhesion') ||
              test?.name?.toLowerCase().includes('przyczep')) {
            coveredTestIds.add(p.test_id);
          }
        });
      }
    });
    
    const totalTests = uniqueTestIds.size;
    const coveredTests = coveredTestIds.size;
    
    if (coveredTests === 0 && assignments.length === 0) {
      return {
        class: 'staffing-none',
        icon: '○',
        tooltip: i18n.t('schedule.noCoverage')
      };
    }
    
    if (coveredTests >= totalTests) {
      return {
        class: 'staffing-full',
        icon: '✓',
        tooltip: i18n.t('schedule.fullyCoveredTests').replace('{0}', String(coveredTests)).replace('{1}', String(totalTests))
      };
    }
    
    // Częściowo obsadzony
    const missingTests = Array.from(uniqueTestIds)
      .filter(id => !coveredTestIds.has(id))
      .map(id => this.state.tests.find(t => t.id === id)?.name || '?')
      .slice(0, 3);
    
    return {
      class: 'staffing-partial',
      icon: '◐',
      tooltip: i18n.t('schedule.partiallyCoveredDetail').replace('{0}', String(coveredTests)).replace('{1}', String(totalTests)).replace('{2}', missingTests.join(', ') + (missingTests.length < totalTests - coveredTests ? '...' : ''))
    };
  }

  // Hover popup dla notatki na chipie pracownika
  private showChipNotePopup(event: MouseEvent, assignment: ScheduleAssignment, emp: Employee): void {
    // Usuń istniejące popupy
    document.querySelectorAll('.chip-note-popup').forEach(p => p.remove());
    
    // Pobierz notatkę i odpowiedzi
    let mainNote = assignment.note || '';
    let replies: Array<{text: string; date: string; author: string}> = [];
    
    if (mainNote.includes('---REPLIES---')) {
      const parts = mainNote.split('---REPLIES---');
      mainNote = parts[0].trim();
      try {
        replies = JSON.parse(parts[1]);
      } catch (e) {
        replies = [];
      }
    }
    
    if (!mainNote && replies.length === 0) return;
    
    const popup = document.createElement('div');
    popup.className = 'chip-note-popup';
    popup.innerHTML = `
      <div class="chip-popup-header" style="background: ${emp.color}">
        <span class="chip-popup-avatar">${emp.firstName.charAt(0)}${emp.lastName.charAt(0)}</span>
        <div class="chip-popup-info">
          <span class="chip-popup-name">${emp.firstName} ${emp.lastName}</span>
          <span class="chip-popup-meta">Zmiana ${assignment.shift}</span>
        </div>
      </div>
      <div class="chip-popup-body">
        ${mainNote ? `
          <div class="chip-popup-note">
            <div class="chip-popup-note-label">${i18n.t('schedule.noteTitle')}:</div>
            <div class="chip-popup-note-text">${mainNote}</div>
          </div>
        ` : ''}
        ${replies.length > 0 ? `
          <div class="chip-popup-replies">
            <div class="chip-popup-replies-label">💬 ${i18n.t('schedule.repliesCount').replace('{0}', String(replies.length))}</div>
            ${replies.map(r => `
              <div class="chip-popup-reply">
                <span class="chip-reply-author">${r.author}</span>
                <span class="chip-reply-date">${r.date}</span>
                <div class="chip-reply-text">${r.text}</div>
              </div>
            `).join('')}
          </div>
        ` : ''}
      </div>
      <div class="chip-popup-quick-reply">
        <input type="text" class="chip-popup-reply-input" placeholder="${i18n.t('schedule.quickReply')}" />
        <button class="chip-popup-reply-send" title="${i18n.t('schedule.send')}">
          <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
            <path d="M2 21l21-9L2 3v7l15 2-15 2v7z"/>
          </svg>
        </button>
      </div>
      <div class="chip-popup-footer">
        <button class="chip-popup-edit-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
          Edytuj
        </button>
      </div>
    `;
    
    document.body.appendChild(popup);
    
    // Pozycjonowanie
    const rect = (event.target as HTMLElement).getBoundingClientRect();
    let left = rect.right + 10;
    let top = rect.top - 10;
    
    const popupRect = popup.getBoundingClientRect();
    if (left + popupRect.width > window.innerWidth) {
      left = rect.left - popupRect.width - 10;
    }
    if (top + popupRect.height > window.innerHeight) {
      top = window.innerHeight - popupRect.height - 10;
    }
    if (top < 10) top = 10;
    
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
    
    // Szybka odpowiedź
    const replyInput = popup.querySelector('.chip-popup-reply-input') as HTMLInputElement;
    const sendBtn = popup.querySelector('.chip-popup-reply-send') as HTMLButtonElement;
    
    const sendQuickReply = async () => {
      const text = replyInput.value.trim();
      if (!text) return;
      
      // Zapisz odpowiedź
      const newReply = {
        text,
        date: new Date().toLocaleString(i18n.getDateLocale()),
        author: i18n.t('logs.user')
      };
      
      let existingNote = assignment.note || '';
      let existingReplies: Array<{text: string; date: string; author: string}> = [];
      
      if (existingNote.includes('---REPLIES---')) {
        const parts = existingNote.split('---REPLIES---');
        existingNote = parts[0].trim();
        try {
          existingReplies = JSON.parse(parts[1]);
        } catch (e) {
          existingReplies = [];
        }
      }
      
      existingReplies.push(newReply);
      const newNoteContent = existingNote + '---REPLIES---' + JSON.stringify(existingReplies);
      
      // Aktualizuj w bazie
      await db.put('scheduleAssignments', {
        ...assignment,
        note: newNoteContent
      });
      
      // Aktualizuj w stanu lokalnym
      const idx = this.state.scheduleAssignments.findIndex(a => a.id === assignment.id);
      if (idx >= 0) {
        this.state.scheduleAssignments[idx].note = newNoteContent;
      }
      
      popup.remove();
      this.showToast(i18n.t('schedule.replyAdded'), 'success');
      this.renderScheduleView();
    };
    
    sendBtn.addEventListener('click', sendQuickReply);
    replyInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendQuickReply();
    });
    
    // Kliknięcie w edytuj
    popup.querySelector('.chip-popup-edit-btn')?.addEventListener('click', () => {
      popup.remove();
      this.showAssignmentNoteModal(assignment.id);
    });
    
    // Utrzymaj popup przy hover
    popup.addEventListener('mouseenter', () => {
      popup.classList.add('active');
    });
    popup.addEventListener('mouseleave', () => {
      popup.classList.remove('active');
      setTimeout(() => {
        if (!popup.classList.contains('active')) popup.remove();
      }, 300);
    });
  }
  
  // Popup dla pełnego komentarza przy hover
  private commentPopup: HTMLElement | null = null;
  
  private showCommentPopup(target: HTMLElement, text: string): void {
    this.hideCommentPopup();
    
    const popup = document.createElement('div');
    popup.className = 'comment-hover-popup';
    popup.innerHTML = `
      <div class="comment-popup-content">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="flex-shrink:0;opacity:0.6">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
        <span>${text}</span>
      </div>
    `;
    
    document.body.appendChild(popup);
    this.commentPopup = popup;
    
    // Pozycjonowanie popup
    const rect = target.getBoundingClientRect();
    const popupRect = popup.getBoundingClientRect();
    
    let top = rect.bottom + 8;
    let left = rect.left;
    
    // Sprawdź czy nie wychodzi poza ekran
    if (top + popupRect.height > window.innerHeight) {
      top = rect.top - popupRect.height - 8;
    }
    if (left + popupRect.width > window.innerWidth) {
      left = window.innerWidth - popupRect.width - 8;
    }
    
    popup.style.top = `${top}px`;
    popup.style.left = `${left}px`;
  }
  
  private hideCommentPopup(): void {
    if (this.commentPopup) {
      this.commentPopup.remove();
      this.commentPopup = null;
    }
  }

  // Hover popup dla komentarza projektu z odpowiedziami i szybką odpowiedzią
  private projectCommentHoverPopup: HTMLElement | null = null;
  
  private showProjectCommentHoverPopup(event: MouseEvent, projectId: string, week: string, comment: string): void {
    this.hideProjectCommentHoverPopup();
    
    // Parsuj komentarz i odpowiedzi
    let mainComment = comment;
    let replies: Array<{text: string; date: string; author: string}> = [];
    
    if (comment.includes('---REPLIES---')) {
      const parts = comment.split('---REPLIES---');
      mainComment = parts[0].trim();
      try {
        replies = JSON.parse(parts[1]);
      } catch (e) {
        replies = [];
      }
    }
    
    // Pobierz nazwę projektu
    const [customerId, typeId] = projectId.split('-');
    const customer = this.state.customers.find(c => c.id === customerId);
    const type = this.state.types.find(t => t.id === typeId);
    const projectName = `${customer?.name || 'Nieznany'} - ${type?.name || 'Nieznany'}`;
    
    const popup = document.createElement('div');
    popup.className = 'project-comment-hover-popup';
    popup.innerHTML = `
      <div class="pcf-header">
        <div class="pcf-header-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        </div>
        <div class="pcf-header-info">
          <span class="pcf-title">${i18n.t('schedule.projectComment')}</span>
          <span class="pcf-project">${projectName}</span>
        </div>
      </div>
      <div class="pcf-body">
        <div class="pcf-main-comment">
          <div class="pcf-comment-text">${mainComment}</div>
        </div>
        ${replies.length > 0 ? `
          <div class="pcf-replies">
            <div class="pcf-replies-title">💬 ${i18n.t('schedule.repliesCount').replace('{0}', String(replies.length))}</div>
            ${replies.map(r => `
              <div class="pcf-reply">
                <div class="pcf-reply-meta">
                  <span class="pcf-reply-author">${r.author}</span>
                  <span class="pcf-reply-date">${r.date}</span>
                </div>
                <div class="pcf-reply-text">${r.text}</div>
              </div>
            `).join('')}
          </div>
        ` : ''}
      </div>
      <div class="pcf-quick-reply">
        <input type="text" class="pcf-reply-input" placeholder="${i18n.t('schedule.quickReply')}" />
        <button class="pcf-reply-send" title="${i18n.t('schedule.send')}">
          <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
            <path d="M2 21l21-9L2 3v7l15 2-15 2v7z"/>
          </svg>
        </button>
      </div>
    `;
    
    document.body.appendChild(popup);
    this.projectCommentHoverPopup = popup;
    
    // Pozycjonowanie
    const target = event.target as HTMLElement;
    const rect = target.getBoundingClientRect();
    let top = rect.bottom + 8;
    let left = rect.left - 120;
    
    const popupRect = popup.getBoundingClientRect();
    if (top + popupRect.height > window.innerHeight) {
      top = rect.top - popupRect.height - 8;
    }
    if (left + popupRect.width > window.innerWidth) {
      left = window.innerWidth - popupRect.width - 8;
    }
    if (left < 8) left = 8;
    
    popup.style.top = `${top}px`;
    popup.style.left = `${left}px`;
    
    // Szybka odpowiedź
    const replyInput = popup.querySelector('.pcf-reply-input') as HTMLInputElement;
    const sendBtn = popup.querySelector('.pcf-reply-send') as HTMLButtonElement;
    
    const sendQuickReply = async () => {
      const text = replyInput.value.trim();
      if (!text) return;
      
      const newReply = {
        text,
        date: new Date().toLocaleString(i18n.getDateLocale()),
        author: i18n.t('logs.user')
      };
      
      replies.push(newReply);
      const newCommentContent = mainComment + '---REPLIES---' + JSON.stringify(replies);
      
      // Zapisz
      const existing = this.state.projectComments.find((c: ProjectComment) =>
        c.projectId === projectId && c.week === week
      );
      
      if (existing) {
        existing.comment = newCommentContent;
        existing.updatedAt = Date.now();
        await db.put('projectComments', existing);
      } else {
        const newCommentObj: ProjectComment = {
          id: this.generateId(),
          projectId,
          week,
          comment: newCommentContent,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        this.state.projectComments.push(newCommentObj);
        await db.put('projectComments', newCommentObj);
      }
      
      popup.remove();
      this.projectCommentHoverPopup = null;
      this.showToast(i18n.t('schedule.replyAdded'), 'success');
      this.renderScheduleView();
    };
    
    sendBtn.addEventListener('click', sendQuickReply);
    replyInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendQuickReply();
    });
    
    // Keep popup on hover
    popup.addEventListener('mouseenter', () => {
      popup.classList.add('active');
    });
    popup.addEventListener('mouseleave', () => {
      popup.classList.remove('active');
      setTimeout(() => {
        if (!popup.classList.contains('active') && this.projectCommentHoverPopup === popup) {
          popup.remove();
          this.projectCommentHoverPopup = null;
        }
      }, 200);
    });
  }
  
  private hideProjectCommentHoverPopup(): void {
    if (this.projectCommentHoverPopup && !this.projectCommentHoverPopup.classList.contains('active')) {
      this.projectCommentHoverPopup.remove();
      this.projectCommentHoverPopup = null;
    }
  }
  
  // Modal hover dla komentarzy z możliwością dodawania notatek
  private showCommentHoverPopup(target: HTMLElement, comment: string, projectId: string, week: string): void {
    // Usuń istniejący popup
    document.querySelectorAll('.comment-hover-popup').forEach(p => p.remove());
    
    const popup = document.createElement('div');
    popup.className = 'comment-hover-popup';
    popup.innerHTML = `
      <div class="comment-popup-header">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
        <span>Komentarz</span>
        <button class="popup-close-btn">&times;</button>
      </div>
      <div class="comment-popup-body">
        <div class="comment-main-text">${comment}</div>
        <div class="comment-reply-section">
          <textarea class="comment-reply-input" placeholder="${i18n.t('schedule.notePlaceholder')}"></textarea>
          <div class="comment-reply-actions">
            <button class="btn-reply-save">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              Zapisz
            </button>
            <button class="btn-reply-edit">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
              Edytuj
            </button>
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(popup);
    
    // Pozycjonowanie
    const rect = target.getBoundingClientRect();
    let top = rect.bottom + 8;
    let left = rect.left - 100;
    
    if (top + 300 > window.innerHeight) {
      top = rect.top - 300 - 8;
    }
    if (left + 280 > window.innerWidth) {
      left = window.innerWidth - 288;
    }
    if (left < 8) left = 8;
    
    popup.style.top = `${top}px`;
    popup.style.left = `${left}px`;
    
    // Event handlers
    popup.querySelector('.popup-close-btn')?.addEventListener('click', () => popup.remove());
    
    popup.querySelector('.btn-reply-edit')?.addEventListener('click', () => {
      popup.remove();
      this.showProjectCommentModal(projectId, week, comment);
    });
    
    popup.querySelector('.btn-reply-save')?.addEventListener('click', async () => {
      const replyText = (popup.querySelector('.comment-reply-input') as HTMLTextAreaElement).value.trim();
      if (!replyText) return;
      
      // Dodaj notatkę do komentarza
      const newComment = comment + `\n\n📌 [${new Date().toLocaleDateString(i18n.getDateLocale())}]: ${replyText}`;
      
      const existing = this.state.projectComments.find((c: ProjectComment) =>
        c.projectId === projectId && c.week === week
      );
      
      if (existing) {
        existing.comment = newComment;
        existing.updatedAt = Date.now();
        await db.put('projectComments', existing);
      } else {
        const newCommentObj: ProjectComment = {
          id: this.generateId(),
          projectId,
          week,
          comment: newComment,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        this.state.projectComments.push(newCommentObj);
        await db.put('projectComments', newCommentObj);
      }
      
      popup.remove();
      this.showToast(i18n.t('schedule.noteAdded'), 'success');
      this.renderScheduleContent();
    });
    
    // Keep popup on hover
    popup.addEventListener('mouseenter', () => {
      popup.classList.add('active');
    });
    popup.addEventListener('mouseleave', () => {
      popup.classList.remove('active');
      setTimeout(() => {
        if (!popup.classList.contains('active')) popup.remove();
      }, 200);
    });
  }

  private showProjectCommentModal(projectId: string, week: string, existingComment?: string): void {
    // Znajdź projekt i klienta
    const project = this.state.projects.find(p => p.id === projectId || `${p.customer_id}-${p.type_id}` === projectId);
    const customer = project ? this.state.customers.find(c => c.id === project.customer_id) : null;
    const type = project ? this.state.types.find(t => t.id === project.type_id) : null;
    const projectName = customer?.name || projectId;
    const typeName = type?.name || '';
    
    // Pobierz komentarz i odpowiedzi (format: główny komentarz\n---REPLIES---\njson)
    let mainComment = existingComment || '';
    let replies: Array<{text: string; date: string; author: string}> = [];
    
    if (mainComment.includes('---REPLIES---')) {
      const parts = mainComment.split('---REPLIES---');
      mainComment = parts[0].trim();
      try {
        replies = JSON.parse(parts[1]);
      } catch (e) {
        replies = [];
      }
    }
    
    const overlay = document.createElement('div');
    overlay.className = 'note-modal-overlay';
    overlay.innerHTML = `
      <div class="note-modal note-modal-modern note-modal-project">
        <div class="note-modal-header" style="background: linear-gradient(135deg, #10b981 0%, #059669 100%)">
          <div class="note-modal-header-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
          </div>
          <h3>${i18n.t('schedule.projectCommentTitle')}</h3>
          <button class="note-modal-close">×</button>
        </div>
        
        <div class="note-modal-info">
          <div class="note-info-tag note-info-project-green">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            ${projectName}${typeName ? ' / ' + typeName : ''}
          </div>
          <div class="note-info-tag note-info-shift">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            ${week}
          </div>
        </div>
        
        <div class="note-modal-body">
          <textarea class="note-modal-textarea" id="projectCommentText" placeholder="${i18n.t('schedule.addComment')}...">${mainComment}</textarea>
          
          ${replies.length > 0 ? `
            <div class="note-replies-section note-replies-project">
              <div class="note-replies-header">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                  <polyline points="9 17 4 12 9 7"/>
                  <path d="M20 18v-2a4 4 0 0 0-4-4H4"/>
                </svg>
                ${i18n.t('schedule.repliesCount').replace('{0}', String(replies.length))}
              </div>
              <div class="note-replies-list">
                ${replies.map((r, i) => `
                  <div class="note-reply-item note-reply-project">
                    <div class="note-reply-header">
                      <span class="note-reply-author">${r.author}</span>
                      <span class="note-reply-date">${r.date}</span>
                      <button class="note-reply-delete" data-index="${i}" title="${i18n.t('schedule.deleteReply')}">×</button>
                    </div>
                    <div class="note-reply-text">${r.text}</div>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}
          
          <div class="note-add-reply note-add-reply-project">
            <div class="note-reply-input-wrapper">
              <input type="text" class="note-reply-input" placeholder="${i18n.t('schedule.quickReply')}">
              <button class="note-reply-submit" title="${i18n.t('schedule.addReply')}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                  <line x1="22" y1="2" x2="11" y2="13"/>
                  <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
        
        <div class="note-modal-actions">
          ${mainComment || replies.length > 0 ? `
            <button class="note-modal-delete" id="deleteProjectComment">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
              ${i18n.t('schedule.deleteBtn')}
            </button>
          ` : '<div></div>'}
          <div class="note-modal-actions-right">
            <button class="note-modal-cancel">${i18n.t('schedule.cancel')}</button>
            <button class="note-modal-save">${i18n.t('schedule.save')}</button>
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    
    const textarea = overlay.querySelector('.note-modal-textarea') as HTMLTextAreaElement;
    textarea.focus();
    
    // Zamykanie
    overlay.querySelector('.note-modal-close')?.addEventListener('click', () => overlay.remove());
    overlay.querySelector('.note-modal-cancel')?.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
    
    // Dodawanie szybkiej odpowiedzi
    const replyInput = overlay.querySelector('.note-reply-input') as HTMLInputElement;
    const submitReply = async () => {
      const replyText = replyInput.value.trim();
      if (!replyText) return;
      
      replies.push({
        text: replyText,
        date: new Date().toLocaleDateString(i18n.getDateLocale()),
        author: this.state.settings.userName || i18n.t('logs.user')
      });
      
      // Zapisz natychmiast do bazy
      const currentMainComment = (overlay.querySelector('#projectCommentText') as HTMLTextAreaElement).value.trim();
      const newCommentText = currentMainComment + (replies.length > 0 ? '\n---REPLIES---\n' + JSON.stringify(replies) : '');
      
      const existing = this.state.projectComments.find((c: ProjectComment) =>
        c.projectId === projectId && c.week === week
      );
      
      if (existing) {
        existing.comment = newCommentText;
        existing.updatedAt = Date.now();
        await db.put('projectComments', existing);
      } else {
        const newComment: ProjectComment = {
          id: this.generateId(),
          projectId,
          week,
          comment: newCommentText,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        this.state.projectComments.push(newComment);
        await db.put('projectComments', newComment);
      }
      
      // Odśwież modal
      overlay.remove();
      this.showProjectCommentModal(projectId, week, newCommentText);
      this.showToast(i18n.t('schedule.replyAdded'), 'success');
    };
    
    overlay.querySelector('.note-reply-submit')?.addEventListener('click', submitReply);
    replyInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') submitReply();
    });
    
    // Usuwanie odpowiedzi
    overlay.querySelectorAll('.note-reply-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const index = parseInt((btn as HTMLElement).dataset.index || '0');
        replies.splice(index, 1);
        
        // Zapisz natychmiast do bazy
        const currentMainComment = (overlay.querySelector('#projectCommentText') as HTMLTextAreaElement).value.trim();
        const newCommentText = currentMainComment + (replies.length > 0 ? '\n---REPLIES---\n' + JSON.stringify(replies) : '');
        
        const existing = this.state.projectComments.find((c: ProjectComment) =>
          c.projectId === projectId && c.week === week
        );
        
        if (existing) {
          existing.comment = newCommentText || '';
          existing.updatedAt = Date.now();
          if (newCommentText) {
            await db.put('projectComments', existing);
          } else {
            const idx = this.state.projectComments.indexOf(existing);
            this.state.projectComments.splice(idx, 1);
            await db.delete('projectComments', existing.id);
          }
        }
        
        overlay.remove();
        if (newCommentText) {
          this.showProjectCommentModal(projectId, week, newCommentText);
        }
        this.renderScheduleContent();
        this.showToast(i18n.t('schedule.replyDeleted'), 'success');
      });
    });
    
    // Usuwanie całego komentarza
    overlay.querySelector('#deleteProjectComment')?.addEventListener('click', async () => {
      const existing = this.state.projectComments.find((c: ProjectComment) =>
        c.projectId === projectId && c.week === week
      );
      if (existing) {
        const idx = this.state.projectComments.indexOf(existing);
        this.state.projectComments.splice(idx, 1);
        await db.delete('projectComments', existing.id);
        this.showToast(i18n.t('schedule.commentDeleted'), 'success');
      }
      overlay.remove();
      this.renderScheduleContent();
    });
    
    // Zapisywanie
    overlay.querySelector('.note-modal-save')?.addEventListener('click', async () => {
      const text = (overlay.querySelector('#projectCommentText') as HTMLTextAreaElement).value.trim();
      const fullComment = text + (replies.length > 0 ? '\n---REPLIES---\n' + JSON.stringify(replies) : '');
      
      const existing = this.state.projectComments.find((c: ProjectComment) =>
        c.projectId === projectId && c.week === week
      );
      
      if (text || replies.length > 0) {
        if (existing) {
          existing.comment = fullComment;
          existing.updatedAt = Date.now();
          await db.put('projectComments', existing);
        } else {
          const newComment: ProjectComment = {
            id: this.generateId(),
            projectId,
            week,
            comment: fullComment,
            createdAt: Date.now(),
            updatedAt: Date.now()
          };
          this.state.projectComments.push(newComment);
          await db.put('projectComments', newComment);
        }
        this.showToast(i18n.t('schedule.commentSaved'), 'success');
      } else if (existing) {
        const idx = this.state.projectComments.indexOf(existing);
        this.state.projectComments.splice(idx, 1);
        await db.delete('projectComments', existing.id);
      }
      
      overlay.remove();
      this.renderScheduleContent();
    });
    
    // Escape
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        overlay.remove();
        document.removeEventListener('keydown', handleEscape);
      }
    };
    document.addEventListener('keydown', handleEscape);
  }
  
  private async copyFromPreviousWeek(): Promise<void> {
    const prevWeek = this.scheduleCurrentWeek === 1 ? 52 : this.scheduleCurrentWeek - 1;
    const prevYear = this.scheduleCurrentWeek === 1 ? this.scheduleCurrentYear - 1 : this.scheduleCurrentYear;
    const prevWeekKey = `${prevYear}-KW${prevWeek.toString().padStart(2, '0')}`;
    const currentWeekKey = `${this.scheduleCurrentYear}-KW${this.scheduleCurrentWeek.toString().padStart(2, '0')}`;
    
    const prevAssignments = this.state.scheduleAssignments.filter((a: ScheduleAssignment) => a.week === prevWeekKey);
    
    if (prevAssignments.length === 0) {
      this.showToast(i18n.t('schedule.noPrevWeekAssignments'), 'warning');
      return;
    }
    
    let copied = 0;
    for (const prev of prevAssignments) {
      // Check if already exists
      const exists = this.state.scheduleAssignments.find((a: ScheduleAssignment) =>
        a.projectId === prev.projectId &&
        a.employeeId === prev.employeeId &&
        a.week === currentWeekKey &&
        a.shift === prev.shift &&
        a.testId === prev.testId
      );
      
      if (!exists) {
        const newAssignment: ScheduleAssignment = {
          ...prev,
          id: this.generateId(),
          week: currentWeekKey,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        this.state.scheduleAssignments.push(newAssignment);
        await db.put('scheduleAssignments', newAssignment);
        copied++;
      }
    }
    
    this.showToast(i18n.t('schedule.copiedAssignments').replace('{0}', String(copied)).replace('{1}', prevWeekKey), 'success');
    this.renderScheduleContent();
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private initScheduleFilters(): void {
    // Legacy - kept for compatibility
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private renderEmployeePool(): void {
    // Legacy - redirects to new method
    this.renderScheduleEmployeePanel();
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private renderScheduleGrid(): void {
    // Legacy - redirects to new method
    this.renderScheduleContent();
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private getStatusIcon(status: string): string {
    switch (status) {
      case 'completed': return '<svg viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg>';
      case 'in-progress': return '<svg viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2" width="14" height="14"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>';
      case 'cancelled': return '<svg viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2" width="14" height="14"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
      default: return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private handleEmployeeDragStart(e: DragEvent, el: HTMLElement): void {
    el.classList.add('dragging');
    e.dataTransfer?.setData('text/plain', el.dataset.employeeId || '');
    e.dataTransfer?.setData('type', 'employee');
  }

  // Drag & Drop handlers (legacy)
  private handleDragStart(e: DragEvent, el: HTMLElement): void {
    this.draggedEntry = el;
    el.classList.add('dragging');
    e.dataTransfer?.setData('text/plain', el.dataset.entryId || '');
    e.dataTransfer?.setData('type', 'entry');
  }

  private handleDragEnd(el: HTMLElement): void {
    el.classList.remove('dragging');
    this.draggedEntry = null;
  }

  private handleDragOver(e: DragEvent, cell: HTMLElement): void {
    e.preventDefault();
    cell.classList.add('drag-over');
  }

  private handleDragLeave(cell: HTMLElement): void {
    cell.classList.remove('drag-over');
  }

  private async handleDropEmployee(e: DragEvent, cell: HTMLElement): Promise<void> {
    e.preventDefault();
    cell.classList.remove('drag-over');
    
    const type = e.dataTransfer?.getData('type');
    const id = e.dataTransfer?.getData('text/plain');
    const targetProjectId = cell.dataset.projectId;
    const targetWeek = cell.dataset.week;
    
    if (!targetProjectId || !targetWeek || !id) return;
    
    if (type === 'employee') {
      // Check if this employee is already assigned to this project/week
      const exists = this.state.scheduleEntries.find(
        e => e.employeeId === id && e.projectId === targetProjectId && e.week === targetWeek
      );
      
      if (exists) {
        this.showToast(i18n.t('schedule.alreadyAssignedWeek'), 'warning');
        return;
      }
      
      // Create new entry
      const newEntry: ScheduleEntry = {
        id: this.generateId(),
        projectId: targetProjectId,
        employeeId: id,
        week: targetWeek,
        year: this.state.selectedYear,
        status: 'planned',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      this.state.scheduleEntries.push(newEntry);
      await db.put('scheduleEntries', newEntry);
      
      const employee = this.state.employees.find(e => e.id === id);
      await this.addLog('created', 'ScheduleEntry', `${employee?.firstName || ''} → ${targetWeek}`);
      
    } else if (type === 'entry') {
      // Move existing entry to new cell
      const entry = this.state.scheduleEntries.find(en => en.id === id);
      if (entry) {
        entry.projectId = targetProjectId;
        entry.week = targetWeek;
        entry.updatedAt = Date.now();
        await db.put('scheduleEntries', entry);
        await this.addLog('updated', 'ScheduleEntry', id, `Moved to ${targetWeek}`);
      }
    }
    
    this.renderScheduleView();
  }

  private showManageEmployeesModal(): void {
    const modal = document.getElementById('modal')!;
    const modalTitle = document.getElementById('modalTitle')!;
    const modalBody = document.getElementById('modalBody')!;
    
    modalTitle.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18" style="display:inline;vertical-align:middle;margin-right:8px"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> ${i18n.t('schedule.manageEmployees')}`;
    
    const employeesList = this.state.employees.map(emp => `
      <div class="employee-item">
        <div class="employee-info">
          <div class="employee-color-circle" style="background-color: ${emp.color}">
            ${emp.firstName.charAt(0)}${emp.lastName.charAt(0)}
          </div>
          <span class="employee-name">${emp.firstName} ${emp.lastName}</span>
        </div>
        <div class="employee-actions">
          <button class="btn-icon" onclick="window.kappaApp.editEmployee('${emp.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
          <button class="btn-icon btn-del" onclick="window.kappaApp.deleteEmployee('${emp.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
        </div>
      </div>
    `).join('') || `<div class="empty-hint">${i18n.t('schedule.noEmployees')}</div>`;
    
    modalBody.innerHTML = `
      <div class="employee-list">${employeesList}</div>
      <button class="btn-primary" style="margin-top: 16px; width: 100%;" id="addEmployeeBtn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="display:inline;vertical-align:middle;margin-right:4px"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg> ${i18n.t('schedule.addEmployee')}
      </button>
    `;
    
    document.getElementById('addEmployeeBtn')?.addEventListener('click', () => {
      this.hideModal();
      this.showAddEmployeeModal();
    });
    
    // Hide confirm button
    const confirmBtn = modal.querySelector('.modal-confirm') as HTMLButtonElement;
    confirmBtn.style.display = 'none';
    
    modal.classList.add('active');
    
    // Expose methods globally for onclick handlers
    (window as any).kappaApp = this;
  }

  private showAddEmployeeModal(employee?: Employee): void {
    const modal = document.getElementById('modal')!;
    const modalTitle = document.getElementById('modalTitle')!;
    const modalBody = document.getElementById('modalBody')!;
    
    const isEdit = !!employee;
    modalTitle.textContent = `${isEdit ? '✏️' : '➕'} ${i18n.t(isEdit ? 'schedule.editEmployee' : 'schedule.addEmployee')}`;
    
    const selectedColor = employee?.color || EMPLOYEE_COLORS[this.state.employees.length % EMPLOYEE_COLORS.length];
    const currentStatus = employee?.status || 'available';
    const currentShift = employee?.suggestedShift || '';
    const currentShiftSystem = employee?.shiftSystem || 2;
    
    modalBody.innerHTML = `
      <div class="form-group">
        <label>${i18n.t('schedule.firstName')}:</label>
        <input type="text" id="employeeFirstName" class="form-control" value="${employee?.firstName || ''}" placeholder="${i18n.t('schedule.firstName')}..." />
      </div>
      <div class="form-group">
        <label>${i18n.t('schedule.lastName')}:</label>
        <input type="text" id="employeeLastName" class="form-control" value="${employee?.lastName || ''}" placeholder="${i18n.t('schedule.lastName')}..." />
      </div>
      <div class="form-group">
        <label>${i18n.t('schedule.employeeColor')}:</label>
        <div class="employee-color-picker" id="employeeColorPicker">
          ${EMPLOYEE_COLORS.map(color => `
            <div class="employee-color-option ${color === selectedColor ? 'selected' : ''}" 
                 data-color="${color}" 
                 style="background: ${color}"></div>
          `).join('')}
        </div>
      </div>
      <div class="form-group">
        <label>${i18n.t('schedule.status')}:</label>
        <select id="employeeStatus" class="form-control">
          <option value="available" ${currentStatus === 'available' ? 'selected' : ''}>✅ ${i18n.t('schedule.available')}</option>
          <option value="vacation" ${currentStatus === 'vacation' ? 'selected' : ''}>🏖️ ${i18n.t('schedule.vacation')}</option>
          <option value="sick" ${currentStatus === 'sick' ? 'selected' : ''}>🤒 ${i18n.t('schedule.sickLeave')}</option>
        </select>
      </div>
      <div class="form-group">
        <label>${i18n.t('schedule.shiftSystemLabel')}:</label>
        <select id="employeeShiftSystem" class="form-control">
          <option value="1" ${currentShiftSystem === 1 ? 'selected' : ''}>1️⃣ ${i18n.t('schedule.shiftSystem1')}</option>
          <option value="2" ${currentShiftSystem === 2 ? 'selected' : ''}>2️⃣ ${i18n.t('schedule.shiftSystem2')}</option>
          <option value="3" ${currentShiftSystem === 3 ? 'selected' : ''}>3️⃣ ${i18n.t('schedule.shiftSystem3')}</option>
        </select>
      </div>
    `;
    
    // Color picker logic
    document.querySelectorAll('.employee-color-option').forEach(el => {
      el.addEventListener('click', () => {
        document.querySelectorAll('.employee-color-option').forEach(e => e.classList.remove('selected'));
        el.classList.add('selected');
      });
    });
    
    const confirmBtn = modal.querySelector('.modal-confirm') as HTMLButtonElement;
    confirmBtn.style.display = '';
    confirmBtn.onclick = async () => {
      const firstName = (document.getElementById('employeeFirstName') as HTMLInputElement).value.trim();
      const lastName = (document.getElementById('employeeLastName') as HTMLInputElement).value.trim();
      const colorEl = document.querySelector('.employee-color-option.selected') as HTMLElement;
      const color = colorEl?.dataset.color || EMPLOYEE_COLORS[0];
      const status = (document.getElementById('employeeStatus') as HTMLSelectElement).value as EmployeeStatus;
      const shiftSelect = document.getElementById('employeeShift') as HTMLSelectElement | null;
      const shiftValue = shiftSelect?.value || '';
      const suggestedShift = shiftValue ? parseInt(shiftValue) as 1 | 2 | 3 : undefined;
      const shiftSystemSelect = document.getElementById('employeeShiftSystem') as HTMLSelectElement | null;
      const shiftSystem = shiftSystemSelect ? parseInt(shiftSystemSelect.value) as 1 | 2 | 3 : 2;
      
      if (!firstName || !lastName) {
        this.showToast(i18n.t('messages.errorOccurred'), 'error');
        return;
      }
      
      if (isEdit && employee) {
        employee.firstName = firstName;
        employee.lastName = lastName;
        employee.color = color;
        employee.status = status;
        employee.suggestedShift = suggestedShift;
        employee.shiftSystem = shiftSystem;
        await db.put('employees', employee);
        await this.addLog('updated', 'Employee', `${firstName} ${lastName}`);
      } else {
        const newEmployee: Employee = {
          id: this.generateId(),
          firstName,
          lastName,
          color,
          status,
          suggestedShift,
          shiftSystem,
          createdAt: Date.now(),
        };
        this.state.employees.push(newEmployee);
        await db.put('employees', newEmployee);
        await this.addLog('created', 'Employee', `${firstName} ${lastName}`);
      }
      
      this.hideModal();
      this.showToast(i18n.t('messages.savedSuccessfully'), 'success');
      this.renderScheduleView();
    };
    
    modal.classList.add('active');
  }

  public editEmployee(id: string): void {
    const employee = this.state.employees.find(e => e.id === id);
    if (employee) {
      this.hideModal();
      setTimeout(() => this.showAddEmployeeModal(employee), 100);
    }
  }

  public async deleteEmployee(id: string): Promise<void> {
    const confirmed = await this.confirmDeletion();
    if (!confirmed) return;
    
    const idx = this.state.employees.findIndex(e => e.id === id);
    if (idx !== -1) {
      const emp = this.state.employees[idx];
      this.state.employees.splice(idx, 1);
      await db.delete('employees', id);
      await this.addLog('deleted', 'Employee', `${emp.firstName} ${emp.lastName}`);
      this.showToast(i18n.t('messages.deletedSuccessfully'), 'success');
      this.showManageEmployeesModal();
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private showAddScheduleEntryModal(): void {
    // Legacy - no longer used, replaced by drag & drop
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private showEditScheduleEntryModal(_entry: ScheduleEntry): void {
    // Legacy - no longer used, replaced by inline assignment management
  }

  // ==================== Advanced Analytics ====================
  
  private renderAdvancedAnalytics(): void {
    this.renderKPIDashboard();
    this.renderWorkloadHeatmap();
    this.renderTrendChart();
    // New analytics sections
    this.renderNewAnalyticsSections();
  }

  private renderNewAnalyticsSections(): void {
    // Customer Analysis
    const customerGrid = document.getElementById('customerAnalysisGrid');
    if (customerGrid) {
      const customerData: { [key: string]: { count: number; ist: number; soll: number } } = {};
      
      this.state.projects.forEach(project => {
        const customer = this.state.customers.find(c => c.id === project.customer_id);
        const name = customer?.name || 'Unknown';
        if (!customerData[name]) customerData[name] = { count: 0, ist: 0, soll: 0 };
        customerData[name].count++;
        // Use year-aware week data lookup
        for (let w = 1; w <= 52; w++) {
          const weekKey = `KW${w.toString().padStart(2, '0')}`;
          if (!this.isWeekInFilter(weekKey)) continue;
          const data = this.getWeekData(project, weekKey);
          customerData[name].ist += data.ist;
          customerData[name].soll += data.soll;
        }
      });

      let html = '';
      Object.entries(customerData).forEach(([name, data]) => {
        const rate = data.soll > 0 ? Math.round((data.ist / data.soll) * 100) : 0;
        const color = rate >= 90 ? '#10B981' : rate >= 70 ? '#3B82F6' : rate >= 50 ? '#F59E0B' : '#EF4444';
        html += `
          <div style="background: var(--color-bg-secondary); border-radius: 8px; padding: 10px; border: 1px solid var(--color-border);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <strong style="font-size: 0.8rem;">${name}</strong>
              <span style="font-size: 0.65rem; padding: 2px 6px; background: var(--color-primary-subtle); border-radius: 10px;">${data.count} proj</span>
            </div>
            <div style="display: flex; gap: 8px; margin-bottom: 8px;">
              <div style="flex: 1; text-align: center; padding: 6px; background: var(--color-bg-primary); border-radius: 6px;">
                <div style="font-size: 1rem; font-weight: 700;">${data.ist}</div>
                <div style="font-size: 0.6rem; color: var(--color-text-muted);">IST</div>
              </div>
              <div style="flex: 1; text-align: center; padding: 6px; background: var(--color-bg-primary); border-radius: 6px;">
                <div style="font-size: 1rem; font-weight: 700;">${data.soll}</div>
                <div style="font-size: 0.6rem; color: var(--color-text-muted);">SOLL</div>
              </div>
              <div style="flex: 1; text-align: center; padding: 6px; background: ${color}15; border-radius: 6px;">
                <div style="font-size: 1rem; font-weight: 700; color: ${color};">${rate}%</div>
                <div style="font-size: 0.6rem; color: var(--color-text-muted);">Rate</div>
              </div>
            </div>
            <div style="height: 4px; background: var(--color-border); border-radius: 2px; overflow: hidden;">
              <div style="height: 100%; width: ${Math.min(rate, 100)}%; background: ${color}; border-radius: 2px;"></div>
            </div>
          </div>`;
      });
      customerGrid.innerHTML = html || '<p style="padding: 12px; color: var(--color-text-muted);">No customer data</p>';
    }

    // Test Performance
    const testBars = document.getElementById('testPerformanceBars');
    if (testBars) {
      const colors = ['#0097AC', '#10B981', '#3B82F6', '#8B5CF6', '#F59E0B', '#EC4899'];
      let html = '';
      let maxVal = 1;
      
      const testData = this.state.tests.map((test, idx) => {
        let ist = 0, soll = 0;
        this.state.projects.filter(p => p.test_id === test.id).forEach(p => {
          // Use year-aware week data lookup
          for (let w = 1; w <= 52; w++) {
            const weekKey = `KW${w.toString().padStart(2, '0')}`;
            if (!this.isWeekInFilter(weekKey)) continue;
            const data = this.getWeekData(p, weekKey);
            ist += data.ist;
            soll += data.soll;
          }
        });
        maxVal = Math.max(maxVal, ist);
        return { name: test.name, ist, soll, color: colors[idx % colors.length] };
      });

      testData.forEach(d => {
        const rate = d.soll > 0 ? Math.round((d.ist / d.soll) * 100) : 0;
        const width = (d.ist / maxVal) * 100;
        html += `
          <div style="display: grid; grid-template-columns: 90px 1fr auto; align-items: center; gap: 10px; margin-bottom: 6px;">
            <div style="font-weight: 500; font-size: 0.75rem;">${d.name}</div>
            <div style="height: 18px; background: var(--color-bg-secondary); border-radius: 9px; overflow: hidden;">
              <div style="height: 100%; width: ${width}%; background: ${d.color}; border-radius: 9px; display: flex; align-items: center; justify-content: flex-end; padding-right: 6px; min-width: 32px;">
                <span style="font-size: 0.6rem; font-weight: 600; color: white;">${rate}%</span>
              </div>
            </div>
            <div style="font-weight: 600; font-size: 0.7rem; min-width: 60px; text-align: right;">${d.ist}/${d.soll}</div>
          </div>`;
      });
      testBars.innerHTML = html || '<p style="padding: 12px; color: var(--color-text-muted);">No test data</p>';
    }

    // Top & Bottom Performers
    const topEl = document.getElementById('topPerformers');
    const bottomEl = document.getElementById('bottomPerformers');
    if (topEl && bottomEl) {
      const rates = this.state.projects.map(p => {
        const customer = this.state.customers.find(c => c.id === p.customer_id);
        let ist = 0, soll = 0;
        // Use year-aware week data lookup
        for (let w = 1; w <= 52; w++) {
          const weekKey = `KW${w.toString().padStart(2, '0')}`;
          if (!this.isWeekInFilter(weekKey)) continue;
          const data = this.getWeekData(p, weekKey);
          ist += data.ist;
          soll += data.soll;
        }
        const name = `${customer?.name || '?'} / ${this.state.types.find(t => t.id === p.type_id)?.name || '?'}`;
        return { name, ist, soll, rate: soll > 0 ? Math.round((ist / soll) * 100) : 0 };
      }).filter(r => r.soll > 0).sort((a, b) => b.rate - a.rate);

      const renderList = (items: typeof rates, isTop: boolean) => items.map((p, i) => `
        <div style="display: flex; align-items: center; gap: 8px; padding: 8px; background: var(--color-bg-secondary); border-radius: 6px; margin-bottom: 4px; border-left: 2px solid ${isTop ? '#10B981' : '#EF4444'};">
          <div style="width: 18px; height: 18px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.65rem; font-weight: 700; background: ${isTop ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)'}; color: ${isTop ? '#10B981' : '#EF4444'};">${i + 1}</div>
          <div style="flex: 1; min-width: 0;">
            <div style="font-weight: 500; font-size: 0.75rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${p.name}</div>
            <div style="font-size: 0.65rem; color: var(--color-text-muted);">${p.ist}/${p.soll}</div>
          </div>
          <div style="font-weight: 700; font-size: 0.8rem; color: ${isTop ? '#10B981' : '#EF4444'};">${p.rate}%</div>
        </div>`).join('');

      topEl.innerHTML = renderList(rates.slice(0, 5), true) || '<p style="color: var(--color-text-muted);">No data</p>';
      bottomEl.innerHTML = renderList(rates.slice(-5).reverse(), false) || '<p style="color: var(--color-text-muted);">No data</p>';
    }

    // Stoppage Report
    const stoppageEl = document.getElementById('stoppageReport');
    if (stoppageEl) {
      let stoppage = 0, prodLack = 0, normal = 0;
      this.state.projects.forEach(p => {
        // Use year-aware week data lookup
        for (let w = 1; w <= 52; w++) {
          const weekKey = `KW${w.toString().padStart(2, '0')}`;
          if (!this.isWeekInFilter(weekKey)) continue;
          const data = this.getWeekData(p, weekKey);
          if (data.stoppage) stoppage++;
          else if (data.productionLack) prodLack++;
          else if (data.soll > 0) normal++;
        }
      });
      const total = stoppage + prodLack + normal;
      stoppageEl.innerHTML = `
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; padding: 12px;">
          <div style="text-align: center; padding: 10px; background: var(--color-bg-secondary); border-radius: 8px;">
            <div style="width: 28px; height: 28px; margin: 0 auto 6px; border-radius: 50%; background: rgba(239,68,68,0.1); display: flex; align-items: center; justify-content: center;">
              <svg viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2" width="14" height="14"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
            </div>
            <div style="font-size: 1.5rem; font-weight: 700;">${stoppage}</div>
            <div style="font-size: 0.65rem; color: var(--color-text-muted);">STOPPAGE (${total > 0 ? Math.round((stoppage/total)*100) : 0}%)</div>
          </div>
          <div style="text-align: center; padding: 10px; background: var(--color-bg-secondary); border-radius: 8px;">
            <div style="width: 28px; height: 28px; margin: 0 auto 6px; border-radius: 50%; background: rgba(245,158,11,0.1); display: flex; align-items: center; justify-content: center;">
              <svg viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2" width="14" height="14"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            </div>
            <div style="font-size: 1.5rem; font-weight: 700;">${prodLack}</div>
            <div style="font-size: 0.65rem; color: var(--color-text-muted);">PROD. LACK (${total > 0 ? Math.round((prodLack/total)*100) : 0}%)</div>
          </div>
          <div style="text-align: center; padding: 10px; background: var(--color-bg-secondary); border-radius: 8px;">
            <div style="width: 28px; height: 28px; margin: 0 auto 6px; border-radius: 50%; background: rgba(16,185,129,0.1); display: flex; align-items: center; justify-content: center;">
              <svg viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2" width="14" height="14"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            </div>
            <div style="font-size: 1.5rem; font-weight: 700;">${normal}</div>
            <div style="font-size: 0.65rem; color: var(--color-text-muted);">NORMAL</div>
          </div>
        </div>`;
    }

    // Quarterly Summary
    const yoyContainer = document.getElementById('yoyComparison');
    if (yoyContainer) {
      const getData = () => {
        const quarters = { Q1: 0, Q2: 0, Q3: 0, Q4: 0 };
        const quartersSoll = { Q1: 0, Q2: 0, Q3: 0, Q4: 0 };
        this.state.projects.forEach(p => {
          // Use year-aware week data lookup
          for (let w = 1; w <= 52; w++) {
            const weekKey = `KW${w.toString().padStart(2, '0')}`;
            if (!this.isWeekInFilter(weekKey)) continue;
            const data = this.getWeekData(p, weekKey);
            if (w <= 13) { quarters.Q1 += data.ist; quartersSoll.Q1 += data.soll; }
            else if (w <= 26) { quarters.Q2 += data.ist; quartersSoll.Q2 += data.soll; }
            else if (w <= 39) { quarters.Q3 += data.ist; quartersSoll.Q3 += data.soll; }
            else { quarters.Q4 += data.ist; quartersSoll.Q4 += data.soll; }
          }
        });
        return { ist: quarters, soll: quartersSoll };
      };

      const data = getData();
      let html = `<table style="width: 100%; border-collapse: collapse; font-size: 0.75rem;"><thead><tr style="background: var(--color-bg-secondary);">
        <th style="padding: 8px; text-align: left;">Q</th><th style="padding: 8px;">IST</th><th style="padding: 8px;">SOLL</th><th style="padding: 8px;">Rate</th></tr></thead><tbody>`;
      
      (['Q1', 'Q2', 'Q3', 'Q4'] as const).forEach(q => {
        const rate = data.soll[q] > 0 ? Math.round((data.ist[q] / data.soll[q]) * 100) : 0;
        const color = rate >= 90 ? '#10B981' : rate >= 70 ? '#3B82F6' : rate >= 50 ? '#F59E0B' : '#EF4444';
        html += `<tr style="border-bottom: 1px solid var(--color-border);"><td style="padding: 8px; font-weight: 500;">${q}</td><td style="padding: 8px; text-align: center;">${data.ist[q]}</td><td style="padding: 8px; text-align: center;">${data.soll[q]}</td><td style="padding: 8px; text-align: center; color: ${color}; font-weight: 600;">${rate}%</td></tr>`;
      });
      html += '</tbody></table>';
      yoyContainer.innerHTML = `<div style="padding: 10px;">${html}</div>`;
    }

    // Monthly Summary
    const monthlyGrid = document.getElementById('monthlySummaryGrid');
    if (monthlyGrid) {
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const monthWeeks = [[1,4], [5,8], [9,13], [14,17], [18,22], [23,26], [27,30], [31,35], [36,39], [40,44], [45,48], [49,52]];
      const currentMonth = new Date().getMonth();
      const year = this.state.selectedYear;

      let html = '';
      months.forEach((name, idx) => {
        let ist = 0, soll = 0;
        const [start, end] = monthWeeks[idx];
        for (let w = start; w <= end; w++) {
          const weekKey = `KW${String(w).padStart(2, '0')}`;
          // Apply week filter
          if (!this.isWeekInFilter(weekKey)) continue;
          // Use year-aware week data lookup
          this.state.projects.forEach(p => {
            const data = this.getWeekData(p, weekKey);
            ist += data.ist;
            soll += data.soll;
          });
        }
        const rate = soll > 0 ? Math.round((ist / soll) * 100) : 0;
        const rateColor = rate >= 90 ? '#10B981' : rate >= 70 ? '#3B82F6' : rate >= 50 ? '#F59E0B' : '#EF4444';
        const isCurrent = idx === currentMonth && year === new Date().getFullYear();
        html += `
          <div style="background: var(--color-bg-secondary); border-radius: 8px; padding: 10px; text-align: center; border: 1px solid ${isCurrent ? 'var(--color-primary)' : 'var(--color-border)'};">
            <div style="font-size: 0.65rem; font-weight: 600; color: var(--color-text-muted); text-transform: uppercase; margin-bottom: 4px;">${name}</div>
            <div style="font-size: 1.1rem; font-weight: 700;">${ist}</div>
            <div style="font-size: 0.6rem; color: var(--color-text-muted);">/${soll}</div>
            ${soll > 0 ? `<div style="margin-top: 4px; font-size: 0.7rem; font-weight: 600; padding: 2px 6px; border-radius: 8px; display: inline-block; background: ${rateColor}20; color: ${rateColor};">${rate}%</div>` : ''}
          </div>`;
      });
      monthlyGrid.innerHTML = html;
    }
  }

  private renderKPIDashboard(): void {
    const currentWeek = this.getCurrentWeek();
    const weekKey = `KW${currentWeek.toString().padStart(2, '0')}`;
    
    let totalIst = 0;
    let totalSoll = 0;
    let totalTimePerUnit = 0;
    let projectCount = 0;
    
    this.state.projects.forEach(project => {
      // Use year-aware week data lookup
      const weekData = this.getWeekData(project, weekKey);
      totalIst += weekData.ist;
      totalSoll += weekData.soll;
      if (project.timePerUnit) {
        totalTimePerUnit += project.timePerUnit;
        projectCount++;
      }
    });
    
    // Weekly Realization %
    const realization = totalSoll > 0 ? Math.round((totalIst / totalSoll) * 100) : 0;
    const realizationValueEl = document.getElementById('realizationValue');
    if (realizationValueEl) realizationValueEl.textContent = `${realization}%`;
    
    // Draw gauge
    this.drawRealizationGauge(realization);
    
    // Avg Time per Test
    const avgTime = projectCount > 0 ? Math.round(totalTimePerUnit / projectCount) : 0;
    const avgTimeEl = document.getElementById('avgTimePerTest');
    if (avgTimeEl) avgTimeEl.textContent = `${avgTime} min`;
    
    // Capacity Utilization (simplified: based on completed tests ratio)
    let totalSollAll = 0;
    let totalIstAll = 0;
    this.state.projects.forEach(p => {
      // Use year-aware week data lookup
      for (let w = 1; w <= 52; w++) {
        const wKey = `KW${w.toString().padStart(2, '0')}`;
        if (!this.isWeekInFilter(wKey)) continue;
        const data = this.getWeekData(p, wKey);
        totalSollAll += data.soll;
        totalIstAll += data.ist;
      }
    });
    const capacity = totalSollAll > 0 ? Math.round((totalIstAll / totalSollAll) * 100) : 0;
    
    const capacityEl = document.getElementById('capacityUtilization');
    const capacityBar = document.getElementById('capacityBar');
    if (capacityEl) capacityEl.textContent = `${capacity}%`;
    if (capacityBar) capacityBar.style.width = `${Math.min(capacity, 100)}%`;
    
    // Backlog - count all incomplete tests (SOLL - IST for weeks before current week)
    let backlogCount = 0;
    this.state.projects.forEach(p => {
      // Use year-aware week data lookup
      for (let w = 1; w <= 52; w++) {
        const wKey = `KW${w.toString().padStart(2, '0')}`;
        if (!this.isWeekInFilter(wKey)) continue;
        const data = this.getWeekData(p, wKey);
        if (w <= currentWeek && data.soll > data.ist) {
          backlogCount += (data.soll - data.ist);
        }
      }
    });
    const backlogEl = document.getElementById('backlogValue');
    if (backlogEl) backlogEl.textContent = backlogCount.toString();
  }

  private drawRealizationGauge(value: number): void {
    const canvas = document.getElementById('realizationGauge') as HTMLCanvasElement;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const width = canvas.width;
    const height = canvas.height;
    const centerX = width / 2;
    const centerY = height - 10;
    const radius = Math.min(width, height) - 20;
    
    ctx.clearRect(0, 0, width, height);
    
    // Background arc
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius / 2, Math.PI, 0, false);
    ctx.lineWidth = 20;
    ctx.strokeStyle = this.state.settings.darkMode ? '#334155' : '#E2E8F0';
    ctx.stroke();
    
    // Value arc
    const progress = Math.min(value, 100) / 100;
    const endAngle = Math.PI + (Math.PI * progress);
    
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius / 2, Math.PI, endAngle, false);
    ctx.lineWidth = 20;
    ctx.lineCap = 'round';
    
    // Color based on value
    if (value >= 80) {
      ctx.strokeStyle = '#10B981';
    } else if (value >= 50) {
      ctx.strokeStyle = '#F59E0B';
    } else {
      ctx.strokeStyle = '#EF4444';
    }
    ctx.stroke();
  }

  private renderWorkloadHeatmap(): void {
    const container = document.getElementById('workloadHeatmap');
    if (!container) return;
    
    // Use date filter range instead of hardcoded weeks around current
    const weeks: number[] = [];
    for (let w = this.analyticsWeekFrom; w <= this.analyticsWeekTo; w++) {
      weeks.push(w);
    }
    
    // Header
    let html = `<div class="heatmap-header">`;
    weeks.forEach(w => {
      html += `<div class="heatmap-header-cell">KW${w.toString().padStart(2, '0')}</div>`;
    });
    html += `</div>`;
    
    // Rows by test type
    this.state.tests.forEach(test => {
      html += `<div class="heatmap-row">`;
      html += `<div class="heatmap-label">${test.name}</div>`;
      
      weeks.forEach(week => {
        const weekKey = `KW${week.toString().padStart(2, '0')}`;
        let ist = 0;
        let soll = 0;
        
        this.state.projects
          .filter(p => p.test_id === test.id)
          .forEach(p => {
            // Use year-aware week data lookup
            const weekData = this.getWeekData(p, weekKey);
            ist += weekData.ist;
            soll += weekData.soll;
          });
        
        // Pozostałe do wykonania
        const remaining = Math.max(0, soll - ist);
        const isComplete = soll > 0 && ist >= soll;
        const level = remaining === 0 ? 0 : remaining <= 2 ? 1 : remaining <= 5 ? 2 : remaining <= 10 ? 3 : 4;
        const cellClass = isComplete ? 'level-complete' : `level-${level}`;
        const tooltip = i18n.t('schedule.heatmapTooltip').replace('{0}', String(week)).replace('{1}', String(ist)).replace('{2}', String(soll)).replace('{3}', String(remaining));
        html += `<div class="heatmap-cell ${cellClass}" title="${tooltip}">${soll > 0 ? (isComplete ? '✓' : remaining) : ''}</div>`;
      });
      
      html += `</div>`;
    });
    
    container.innerHTML = html;
  }

  private renderTrendChart(): void {
    const canvas = document.getElementById('trendChart') as HTMLCanvasElement;
    if (!canvas) return;
    
    if (this.trendChart) this.trendChart.destroy();
    
    const weeks: string[] = [];
    const istData: number[] = [];
    const sollData: number[] = [];
    
    // Use week filter range instead of hardcoded range
    for (let w = this.analyticsWeekFrom; w <= this.analyticsWeekTo; w++) {
      const weekKey = `KW${w.toString().padStart(2, '0')}`;
      weeks.push(weekKey);
      
      let weekIst = 0;
      let weekSoll = 0;
      
      this.state.projects.forEach(p => {
        // Use year-aware week data lookup
        const weekData = this.getWeekData(p, weekKey);
        weekIst += weekData.ist;
        weekSoll += weekData.soll;
      });
      
      istData.push(weekIst);
      sollData.push(weekSoll);
    }
    
    const isDark = this.state.settings.darkMode;
    
    this.trendChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: weeks,
        datasets: [
          {
            label: 'IST',
            data: istData,
            borderColor: '#10B981',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            fill: true,
            tension: 0.4,
          },
          {
            label: 'SOLL',
            data: sollData,
            borderColor: '#0097AC',
            backgroundColor: 'rgba(0, 151, 172, 0.1)',
            fill: true,
            tension: 0.4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: isDark ? '#FFF' : '#333' } },
        },
        scales: {
          x: { ticks: { color: isDark ? '#FFF' : '#333' } },
          y: { ticks: { color: isDark ? '#FFF' : '#333' }, beginAtZero: true },
        },
      },
    });
  }

  // ==================== ABSENCE MODULE ====================
  
  private async renderAbsencesView(): Promise<void> {
    // Load data
    await this.loadAbsenceData();
    
    // Setup event listeners
    this.setupAbsenceEventListeners();
    
    // Update year label
    const yearLabel = document.getElementById('absenceYearLabel');
    if (yearLabel) yearLabel.textContent = this.absenceYear.toString();
    
    // Render filters
    this.renderAbsenceFilters();
    
    // Render stats
    this.renderAbsenceYearStats();
    
    // Render upcoming
    this.renderAbsenceUpcoming();
    
    // Render employee sidebar
    this.renderAbsenceEmployeesSidebar();
    
    // Render main content based on view mode
    this.renderAbsenceContent();
  }
  
  private async loadAbsenceData(): Promise<void> {
    try {
      // Synchronizuj pracowników z IndexedDB do backendu
      await this.syncEmployeesToBackend();
      
      this.absenceTypes = await api.getAbsenceTypes();
      this.absences = await api.getAbsences({ year: this.absenceYear });
      this.absenceLimits = await api.getAbsenceLimits({ year: this.absenceYear });
      this.holidays = await api.getHolidays(this.absenceYear);
    } catch (e) {
      console.error('Failed to load absence data:', e);
      this.absenceTypes = [];
      this.absences = [];
      this.absenceLimits = [];
      this.holidays = [];
    }
  }
  
  private async syncEmployeesToBackend(): Promise<void> {
    try {
      // Pobierz pracowników z lokalnej bazy (IndexedDB)
      const localEmployees = this.state.employees;
      console.log('Syncing employees to backend, count:', localEmployees.length);
      if (localEmployees.length === 0) {
        console.log('No local employees to sync');
        return;
      }
      
      // Wyślij każdego pracownika do backendu (upsert)
      for (const emp of localEmployees) {
        console.log('Syncing employee:', emp.id, emp.firstName, emp.lastName);
        await api.addEmployee(emp);
      }
      console.log('Employees synced successfully');
    } catch (e) {
      console.error('Failed to sync employees to backend:', e);
    }
  }
  
  private setupAbsenceEventListeners(): void {
    // Prevent multiple initializations
    if (this.absenceEventsInitialized) {
      console.log('Absence event listeners already initialized');
      return;
    }
    this.absenceEventsInitialized = true;
    console.log('Setting up absence event listeners...');
    
    const addBtn = document.getElementById('addAbsenceBtn');
    const settingsBtn = document.getElementById('absenceSettingsBtn');
    console.log('addAbsenceBtn found:', !!addBtn);
    console.log('absenceSettingsBtn found:', !!settingsBtn);
    
    // Year navigation
    document.getElementById('absencePrevYear')?.addEventListener('click', () => {
      this.absenceYear--;
      this.absenceCalendarMonth = 0;
      this.renderAbsencesView();
    });
    
    document.getElementById('absenceNextYear')?.addEventListener('click', () => {
      this.absenceYear++;
      this.absenceCalendarMonth = 0;
      this.renderAbsencesView();
    });
    
    // View toggle
    document.querySelectorAll('.absence-view-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const view = (btn as HTMLElement).dataset.view as any;
        this.absenceViewMode = view;
        document.querySelectorAll('.absence-view-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.renderAbsenceContent();
      });
    });
    
    // Filters
    document.getElementById('absenceFilterEmployee')?.addEventListener('change', (e) => {
      this.absenceFilterEmployee = (e.target as HTMLSelectElement).value;
      this.renderAbsenceContent();
    });
    
    document.getElementById('absenceFilterType')?.addEventListener('change', (e) => {
      this.absenceFilterType = (e.target as HTMLSelectElement).value;
      this.renderAbsenceContent();
    });
    
    document.getElementById('absenceFilterMonth')?.addEventListener('change', (e) => {
      this.absenceFilterMonth = (e.target as HTMLSelectElement).value;
      if (this.absenceFilterMonth) {
        this.absenceCalendarMonth = parseInt(this.absenceFilterMonth) - 1;
      }
      this.renderAbsenceContent();
    });
    
    // Add absence button
    document.getElementById('addAbsenceBtn')?.addEventListener('click', () => {
      console.log('Add absence button clicked!');
      this.showAddAbsenceWizard();
    });
    
    // Settings button
    document.getElementById('absenceSettingsBtn')?.addEventListener('click', () => {
      console.log('Settings button clicked!');
      this.showAbsenceSettingsModal();
    });
    
    // Export button
    document.getElementById('absenceExportBtn')?.addEventListener('click', () => {
      this.exportAbsences();
    });
    
    // Toggle absence employees sidebar - otwieranie
    document.getElementById('absenceEmployeesToggle')?.addEventListener('click', () => {
      const sidebar = document.getElementById('absenceEmployeesSidebar');
      const layout = sidebar?.closest('.absence-layout');
      if (sidebar && layout) {
        sidebar.classList.add('open');
        layout.classList.add('sidebar-open');
        localStorage.setItem('absenceEmployeesSidebarOpen', '1');
      }
    });
    
    // Close absence employees sidebar - zamykanie
    document.getElementById('absenceEmployeesClose')?.addEventListener('click', () => {
      const sidebar = document.getElementById('absenceEmployeesSidebar');
      const layout = sidebar?.closest('.absence-layout');
      if (sidebar && layout) {
        sidebar.classList.remove('open');
        layout.classList.remove('sidebar-open');
        localStorage.setItem('absenceEmployeesSidebarOpen', '0');
      }
    });
    
    // Przywróć stan sidebara z localStorage (domyślnie otwarty)
    const absenceSidebarOpen = localStorage.getItem('absenceEmployeesSidebarOpen') !== '0';
    const absenceSidebar = document.getElementById('absenceEmployeesSidebar');
    const absenceLayout = absenceSidebar?.closest('.absence-layout');
    if (absenceSidebar && absenceLayout) {
      if (absenceSidebarOpen) {
        absenceSidebar.classList.add('open');
        absenceLayout.classList.add('sidebar-open');
      } else {
        absenceSidebar.classList.remove('open');
        absenceLayout.classList.remove('sidebar-open');
      }
    }
  }

  private renderAbsenceFilters(): void {
    // Employee filter
    const empFilter = document.getElementById('absenceFilterEmployee') as HTMLSelectElement;
    if (empFilter) {
      empFilter.innerHTML = `<option value="">${i18n.t('absence.allEmployees')}</option>` +
        this.state.employees
          .filter(e => !e.status || e.status === 'available')
          .sort((a, b) => a.firstName.localeCompare(b.firstName))
          .map(e => `<option value="${e.id}" ${e.id === this.absenceFilterEmployee ? 'selected' : ''}>${e.firstName} ${e.lastName}</option>`)
          .join('');
    }
    
    // Type filter
    const typeFilter = document.getElementById('absenceFilterType') as HTMLSelectElement;
    if (typeFilter) {
      typeFilter.innerHTML = `<option value="">${i18n.t('absence.allTypes')}</option>` +
        this.absenceTypes
          .map(t => `<option value="${t.id}" ${t.id === this.absenceFilterType ? 'selected' : ''}>${t.icon} ${t.name}</option>`)
          .join('');
    }
  }
  
  private renderAbsenceYearStats(): void {
    const container = document.getElementById('absenceYearStats');
    if (!container) return;
    
    // Calculate stats
    const totalAbsences = this.absences.length;
    const totalDays = this.absences.reduce((sum, a) => sum + (a.workDays || 0), 0);
    const pendingCount = this.absences.filter(a => a.status === 'pending').length;
    const employeesOnLeave = new Set(this.absences.map(a => a.employeeId)).size;
    
    container.innerHTML = `
      <div class="absence-year-stats-grid">
        <div class="absence-stat-card">
          <div class="absence-stat-value">${totalAbsences}</div>
          <div class="absence-stat-label">${i18n.t('schedule.absenceStatAbsences')}</div>
        </div>
        <div class="absence-stat-card">
          <div class="absence-stat-value">${totalDays}</div>
          <div class="absence-stat-label">${i18n.t('schedule.absenceStatTotalDays')}</div>
        </div>
        <div class="absence-stat-card">
          <div class="absence-stat-value">${pendingCount}</div>
          <div class="absence-stat-label">${i18n.t('schedule.absenceStatPending')}</div>
        </div>
        <div class="absence-stat-card">
          <div class="absence-stat-value">${employeesOnLeave}</div>
          <div class="absence-stat-label">${i18n.t('schedule.absenceStatEmployees')}</div>
        </div>
      </div>
    `;
  }
  
  private renderAbsenceUpcoming(): void {
    const container = document.getElementById('absenceUpcoming');
    if (!container) return;
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const upcoming = this.absences
      .filter(a => new Date(a.startDate) >= today)
      .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())
      .slice(0, 5);
    
    if (upcoming.length === 0) {
      container.innerHTML = '<p style="text-align: center; color: var(--color-text-muted); font-size: 0.8rem;">' + i18n.t('schedule.noUpcomingAbsences') + '</p>';
      return;
    }
    
    container.innerHTML = upcoming.map(a => {
      const emp = this.state.employees.find(e => e.id === a.employeeId);
      const type = this.absenceTypes.find(t => t.id === a.absenceTypeId);
      const startDate = new Date(a.startDate).toLocaleDateString(i18n.getDateLocale(), { day: '2-digit', month: '2-digit' });
      
      return `
        <div class="absence-upcoming-item">
          <span class="absence-upcoming-icon">${type?.icon || '📅'}</span>
          <div class="absence-upcoming-info">
            <div class="absence-upcoming-name">${emp?.firstName || ''} ${emp?.lastName || ''}</div>
            <div class="absence-upcoming-date">${startDate} - ${a.workDays} ${i18n.t('absence.days')}</div>
          </div>
        </div>
      `;
    }).join('');
  }
  
  private renderAbsenceEmployeesSidebar(): void {
    const container = document.getElementById('absenceEmployeesList');
    if (!container) return;
    
    const availableEmployees = this.state.employees.filter(e => !e.status || e.status === 'available');
    
    container.innerHTML = availableEmployees.map(emp => {
      // Get limits for this employee
      const empLimits = this.absenceLimits.filter(l => l.employeeId === emp.id);
      const vacationLimit = empLimits.find(l => l.absenceTypeId === 'vacation');
      const vacationUsed = vacationLimit?.usedDays || 0;
      const vacationTotal = vacationLimit?.totalDays || 26;
      const vacationPercent = vacationTotal > 0 ? (vacationUsed / vacationTotal) * 100 : 0;
      
      const hoLimit = empLimits.find(l => l.absenceTypeId === 'home-office');
      const hoUsed = hoLimit?.usedDays || 0;
      const hoTotal = hoLimit?.totalDays || 12;
      const hoPercent = hoTotal > 0 ? (hoUsed / hoTotal) * 100 : 0;
      
      return `
        <div class="absence-employee-card" data-employee-id="${emp.id}">
          <div class="absence-employee-card-header">
            <div class="absence-employee-avatar" style="background: ${emp.color}">
              ${emp.firstName.charAt(0)}${emp.lastName.charAt(0)}
            </div>
            <div class="absence-employee-info">
              <h4>${emp.firstName} ${emp.lastName}</h4>
              <span>${vacationUsed}/${vacationTotal} dni urlopu</span>
            </div>
          </div>
          <div class="absence-employee-stats">
            <div class="absence-employee-stat">
              <span class="absence-employee-stat-icon">🏖️</span>
              <div class="absence-employee-stat-bar">
                <div class="absence-employee-stat-fill" style="width: ${Math.min(vacationPercent, 100)}%; background: ${vacationPercent > 80 ? '#ef4444' : '#10b981'}"></div>
              </div>
              <span class="absence-employee-stat-text">${vacationUsed}/${vacationTotal}</span>
            </div>
            <div class="absence-employee-stat">
              <span class="absence-employee-stat-icon">🏠</span>
              <div class="absence-employee-stat-bar">
                <div class="absence-employee-stat-fill" style="width: ${Math.min(hoPercent, 100)}%; background: ${hoPercent > 80 ? '#ef4444' : '#a855f7'}"></div>
              </div>
              <span class="absence-employee-stat-text">${hoUsed}/${hoTotal}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');
    
    // Add click handlers
    container.querySelectorAll('.absence-employee-card').forEach(card => {
      card.addEventListener('click', () => {
        const empId = (card as HTMLElement).dataset.employeeId;
        if (empId) this.showEmployeeAbsenceModal(empId);
      });
    });
  }
  
  private renderAbsenceContent(): void {
    switch (this.absenceViewMode) {
      case 'calendar':
        this.renderAbsenceCalendar();
        break;
      case 'list':
        this.renderAbsenceList();
        break;
      case 'heatmap':
        this.renderAbsenceHeatmap();
        break;
      case 'employees':
        this.renderAbsenceEmployeesGrid();
        break;
      case 'timeline':
        this.renderAbsenceTimeline();
        break;
    }
  }
  
  private renderAbsenceCalendar(): void {
    const container = document.getElementById('absenceContent');
    if (!container) return;
    
    const months = [
      i18n.t('schedule.monthFullJan'), i18n.t('schedule.monthFullFeb'), i18n.t('schedule.monthFullMar'),
      i18n.t('schedule.monthFullApr'), i18n.t('schedule.monthFullMay'), i18n.t('schedule.monthFullJun'),
      i18n.t('schedule.monthFullJul'), i18n.t('schedule.monthFullAug'), i18n.t('schedule.monthFullSep'),
      i18n.t('schedule.monthFullOct'), i18n.t('schedule.monthFullNov'), i18n.t('schedule.monthFullDec')
    ];
    const weekdays = [
      i18n.t('schedule.weekdayMon'), i18n.t('schedule.weekdayTue'), i18n.t('schedule.weekdayWed'),
      i18n.t('schedule.weekdayThu'), i18n.t('schedule.weekdayFri'), i18n.t('schedule.weekdaySat'), i18n.t('schedule.weekdaySun')
    ];
    
    const year = this.absenceYear;
    const month = this.absenceCalendarMonth;
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startPadding = (firstDay.getDay() + 6) % 7;
    
    // Get filtered absences
    let filteredAbsences = this.absences;
    if (this.absenceFilterEmployee) {
      filteredAbsences = filteredAbsences.filter(a => a.employeeId === this.absenceFilterEmployee);
    }
    if (this.absenceFilterType) {
      filteredAbsences = filteredAbsences.filter(a => a.absenceTypeId === this.absenceFilterType);
    }
    
    // Build calendar grid
    let daysHtml = weekdays.map(d => `<div class="absence-calendar-weekday">${d}</div>`).join('');
    
    // Padding days from previous month
    const prevMonth = new Date(year, month, 0);
    for (let i = startPadding - 1; i >= 0; i--) {
      const day = prevMonth.getDate() - i;
      daysHtml += `<div class="absence-calendar-day other-month"><div class="absence-calendar-day-number">${day}</div></div>`;
    }
    
    // Current month days
    const today = new Date();
    for (let d = 1; d <= lastDay.getDate(); d++) {
      const date = new Date(year, month, d);
      const dateStr = date.toISOString().split('T')[0];
      const isToday = date.toDateString() === today.toDateString();
      const isWeekend = date.getDay() === 0 || date.getDay() === 6;
      const holiday = this.holidays.find(h => h.date === dateStr);
      
      // Get absences for this day
      const dayAbsences = filteredAbsences.filter(a => {
        const start = new Date(a.startDate);
        const end = new Date(a.endDate);
        return date >= start && date <= end;
      });
      
      let classes = 'absence-calendar-day';
      if (isToday) classes += ' today';
      if (isWeekend) classes += ' weekend';
      if (holiday) classes += ' holiday';
      
      const eventsHtml = dayAbsences.slice(0, 3).map(a => {
        const emp = this.state.employees.find(e => e.id === a.employeeId);
        const type = this.absenceTypes.find(t => t.id === a.absenceTypeId);
        return `
          <div class="absence-calendar-event" style="background: ${type?.color || '#64748b'}" title="${emp?.firstName} ${emp?.lastName} - ${type?.name}">
            ${type?.icon || ''} ${emp?.firstName || ''}
          </div>
        `;
      }).join('');
      
      const moreCount = dayAbsences.length - 3;
      const moreHtml = moreCount > 0 ? `<div class="absence-calendar-event-more">+${moreCount} ${i18n.t('schedule.more')}</div>` : '';
      
      daysHtml += `
        <div class="${classes}" data-date="${dateStr}">
          <div class="absence-calendar-day-number">${isToday ? `<span>${d}</span>` : d}</div>
          ${holiday ? `<div class="absence-calendar-event" style="background: #f59e0b; font-size: 0.65rem;">🎉 ${holiday.name.substring(0, 12)}</div>` : ''}
          <div class="absence-calendar-day-events">
            ${eventsHtml}
            ${moreHtml}
          </div>
        </div>
      `;
    }
    
    // Padding days for next month
    const totalCells = startPadding + lastDay.getDate();
    const remainingCells = (7 - (totalCells % 7)) % 7;
    for (let i = 1; i <= remainingCells; i++) {
      daysHtml += `<div class="absence-calendar-day other-month"><div class="absence-calendar-day-number">${i}</div></div>`;
    }
    
    container.innerHTML = `
      <div class="absence-calendar">
        <div class="absence-calendar-header">
          <div class="absence-calendar-nav">
            <button class="absence-calendar-nav-btn" id="absenceCalendarPrev">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
            <span class="absence-calendar-month">${months[month]} ${year}</span>
            <button class="absence-calendar-nav-btn" id="absenceCalendarNext">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
            </button>
          </div>
          <button class="absence-calendar-today-btn" id="absenceCalendarToday">Dzisiaj</button>
        </div>
        <div class="absence-calendar-grid">
          ${daysHtml}
        </div>
      </div>
    `;
    
    // Add navigation handlers
    document.getElementById('absenceCalendarPrev')?.addEventListener('click', () => {
      this.absenceCalendarMonth--;
      if (this.absenceCalendarMonth < 0) {
        this.absenceCalendarMonth = 11;
        this.absenceYear--;
        document.getElementById('absenceYearLabel')!.textContent = this.absenceYear.toString();
      }
      this.renderAbsenceCalendar();
    });
    
    document.getElementById('absenceCalendarNext')?.addEventListener('click', () => {
      this.absenceCalendarMonth++;
      if (this.absenceCalendarMonth > 11) {
        this.absenceCalendarMonth = 0;
        this.absenceYear++;
        document.getElementById('absenceYearLabel')!.textContent = this.absenceYear.toString();
      }
      this.renderAbsenceCalendar();
    });
    
    document.getElementById('absenceCalendarToday')?.addEventListener('click', () => {
      const now = new Date();
      this.absenceYear = now.getFullYear();
      this.absenceCalendarMonth = now.getMonth();
      document.getElementById('absenceYearLabel')!.textContent = this.absenceYear.toString();
      this.renderAbsenceCalendar();
    });
    
    // Add click handlers for days
    container.querySelectorAll('.absence-calendar-day:not(.other-month)').forEach(day => {
      day.addEventListener('click', () => {
        const dateStr = (day as HTMLElement).dataset.date;
        if (dateStr) this.showAddAbsenceWizard(dateStr);
      });
    });
  }
  
  private renderAbsenceList(): void {
    const container = document.getElementById('absenceContent');
    if (!container) return;
    
    // Filter absences
    let filtered = this.absences;
    if (this.absenceFilterEmployee) {
      filtered = filtered.filter(a => a.employeeId === this.absenceFilterEmployee);
    }
    if (this.absenceFilterType) {
      filtered = filtered.filter(a => a.absenceTypeId === this.absenceFilterType);
    }
    if (this.absenceFilterMonth) {
      const month = parseInt(this.absenceFilterMonth);
      filtered = filtered.filter(a => {
        const start = new Date(a.startDate);
        const end = new Date(a.endDate);
        return start.getMonth() + 1 === month || end.getMonth() + 1 === month;
      });
    }
    
    // Sort by date descending
    filtered = filtered.sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
    
    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="absence-empty">
          <div class="absence-empty-icon">📅</div>
          <h3>${i18n.t('schedule.noAbsencesFound')}</h3>
          <p>${i18n.t('schedule.noAbsencesMatchCriteria')}</p>
          <button class="absence-action-btn primary" onclick="document.getElementById('addAbsenceBtn').click()">
            ${i18n.t('schedule.addFirstAbsence')}
          </button>
        </div>
      `;
      return;
    }
    
    const itemsHtml = filtered.map(a => {
      const emp = this.state.employees.find(e => e.id === a.employeeId);
      const type = this.absenceTypes.find(t => t.id === a.absenceTypeId);
      const startDate = new Date(a.startDate).toLocaleDateString(i18n.getDateLocale());
      const endDate = new Date(a.endDate).toLocaleDateString(i18n.getDateLocale());
      
      return `
        <div class="absence-list-item" data-absence-id="${a.id}">
          <div class="absence-list-employee">
            <div class="absence-list-avatar" style="background: ${emp?.color || '#64748b'}">
              ${emp?.firstName?.charAt(0) || ''}${emp?.lastName?.charAt(0) || ''}
            </div>
            <span class="absence-list-name">${emp?.firstName || ''} ${emp?.lastName || ''}</span>
          </div>
          <div class="absence-list-type">
            <span class="absence-list-type-icon">${type?.icon || '📅'}</span>
            <span class="absence-list-type-name">${type?.name || i18n.t('schedule.absenceDefault')}</span>
          </div>
          <div class="absence-list-dates">${startDate} - ${endDate}</div>
          <div class="absence-list-days">${a.workDays} ${i18n.t('schedule.days')}</div>
          <div class="absence-list-actions">
            <button class="absence-list-action-btn edit-absence" title="Edytuj">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
            <button class="absence-list-action-btn delete delete-absence" title="${i18n.t('schedule.deleteBtn')}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
            </button>
          </div>
        </div>
      `;
    }).join('');
    
    container.innerHTML = `
      <div class="absence-list">
        <div class="absence-list-header">
          <span>${i18n.t('schedule.absenceListEmployee')}</span>
          <span>${i18n.t('schedule.absenceListType')}</span>
          <span>${i18n.t('schedule.absenceListDates')}</span>
          <span>${i18n.t('schedule.absenceListDays')}</span>
          <span>${i18n.t('schedule.absenceListActions')}</span>
        </div>
        ${itemsHtml}
      </div>
    `;
    
    // Add action handlers
    container.querySelectorAll('.delete-absence').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const item = (btn as HTMLElement).closest('.absence-list-item') as HTMLElement | null;
        const id = item?.dataset?.absenceId;
        if (id && confirm(i18n.t('schedule.confirmDeleteAbsence'))) {
          await api.deleteAbsence(id);
          await this.loadAbsenceData();
          this.renderAbsenceContent();
          this.renderAbsenceYearStats();
          this.renderAbsenceUpcoming();
          this.renderAbsenceEmployeesSidebar();
        }
      });
    });
    
    container.querySelectorAll('.edit-absence').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const item = (btn as HTMLElement).closest('.absence-list-item') as HTMLElement | null;
        const id = item?.dataset?.absenceId;
        if (id) this.showEditAbsenceModal(id);
      });
    });
  }
  
  private renderAbsenceHeatmap(): void {
    const container = document.getElementById('absenceContent');
    if (!container) return;
    
    const months = [
      i18n.t('planning.monthJan'), i18n.t('planning.monthFeb'), i18n.t('planning.monthMar'),
      i18n.t('planning.monthApr'), i18n.t('planning.monthMay'), i18n.t('planning.monthJun'),
      i18n.t('planning.monthJul'), i18n.t('planning.monthAug'), i18n.t('planning.monthSep'),
      i18n.t('planning.monthOct'), i18n.t('planning.monthNov'), i18n.t('planning.monthDec')
    ];
    const employees = this.state.employees.filter(e => !e.status || e.status === 'available');
    
    // Header with months
    let headerHtml = '<div class="absence-heatmap-employee"></div>';
    headerHtml += months.map(m => `<div class="absence-heatmap-month">${m}</div>`).join('');
    
    // Rows for each employee
    const rowsHtml = employees.map(emp => {
      let row = `
        <div class="absence-heatmap-employee">
          <span style="width: 24px; height: 24px; border-radius: 50%; background: ${emp.color}; display: inline-flex; align-items: center; justify-content: center; color: white; font-size: 0.65rem; margin-right: 6px;">
            ${emp.firstName.charAt(0)}${emp.lastName.charAt(0)}
          </span>
          ${emp.firstName} ${emp.lastName.charAt(0)}.
        </div>
      `;
      
      for (let m = 0; m < 12; m++) {
        // Count absence days in this month
        const monthStart = new Date(this.absenceYear, m, 1);
        const monthEnd = new Date(this.absenceYear, m + 1, 0);
        
        let daysInMonth = 0;
        this.absences
          .filter(a => a.employeeId === emp.id)
          .forEach(a => {
            const start = new Date(a.startDate);
            const end = new Date(a.endDate);
            
            // Calculate overlap with this month
            const overlapStart = start > monthStart ? start : monthStart;
            const overlapEnd = end < monthEnd ? end : monthEnd;
            
            if (overlapStart <= overlapEnd) {
              // Count only working days
              let days = 0;
              const current = new Date(overlapStart);
              while (current <= overlapEnd) {
                if (current.getDay() !== 0 && current.getDay() !== 6) {
                  days++;
                }
                current.setDate(current.getDate() + 1);
              }
              daysInMonth += days;
            }
          });
        
        const level = daysInMonth === 0 ? 0 : daysInMonth <= 2 ? 1 : daysInMonth <= 5 ? 2 : daysInMonth <= 10 ? 3 : daysInMonth <= 15 ? 4 : 5;
        
        row += `<div class="absence-heatmap-cell level-${level}" title="${emp.firstName}: ${daysInMonth} dni w ${months[m]}">${daysInMonth || ''}</div>`;
      }
      
      return row;
    }).join('');
    
    container.innerHTML = `
      <div class="absence-heatmap">
        <div class="absence-heatmap-header">
          <h3>${i18n.t('schedule.absenceHeatmapTitle').replace('{0}', String(this.absenceYear))}</h3>
          <p>${i18n.t('schedule.absenceHeatmapDesc')}</p>
        </div>
        <div class="absence-heatmap-grid">
          ${headerHtml}
          ${rowsHtml}
        </div>
        <div class="absence-heatmap-legend">
          <span>${i18n.t('schedule.heatmapLess')}</span>
          <div class="absence-heatmap-legend-item"><div class="absence-heatmap-legend-color level-0"></div></div>
          <div class="absence-heatmap-legend-item"><div class="absence-heatmap-legend-color level-1"></div></div>
          <div class="absence-heatmap-legend-item"><div class="absence-heatmap-legend-color level-2"></div></div>
          <div class="absence-heatmap-legend-item"><div class="absence-heatmap-legend-color level-3"></div></div>
          <div class="absence-heatmap-legend-item"><div class="absence-heatmap-legend-color level-4"></div></div>
          <div class="absence-heatmap-legend-item"><div class="absence-heatmap-legend-color level-5"></div></div>
          <span>${i18n.t('schedule.heatmapMore')}</span>
        </div>
      </div>
    `;
  }
  
  private renderAbsenceEmployeesGrid(): void {
    const container = document.getElementById('absenceContent');
    if (!container) return;
    
    const employees = this.state.employees.filter(e => !e.status || e.status === 'available');
    
    const cardsHtml = employees.map(emp => {
      const empLimits = this.absenceLimits.filter(l => l.employeeId === emp.id);
      
      const limitsHtml = this.absenceTypes.slice(0, 5).map(type => {
        const limit = empLimits.find(l => l.absenceTypeId === type.id);
        const used = limit?.usedDays || 0;
        const total = limit?.totalDays || type.defaultDays || 0;
        const percent = total > 0 ? (used / total) * 100 : 0;
        
        if (total === 0) return '';
        
        return `
          <div class="absence-employee-limit-row">
            <span class="absence-employee-limit-icon">${type.icon}</span>
            <div class="absence-employee-limit-info">
              <div class="absence-employee-limit-name">${type.name}</div>
              <div class="absence-employee-limit-bar">
                <div class="absence-employee-limit-fill" style="width: ${Math.min(percent, 100)}%; background: ${type.color}"></div>
              </div>
            </div>
            <span class="absence-employee-limit-text">${used}/${total} dni</span>
          </div>
        `;
      }).filter(Boolean).join('');
      
      const totalUsed = empLimits.reduce((sum, l) => sum + (l.usedDays || 0), 0);
      
      return `
        <div class="absence-employee-full-card" data-employee-id="${emp.id}">
          <div class="absence-employee-full-header">
            <div class="absence-employee-full-avatar" style="background: ${emp.color}">
              ${emp.firstName.charAt(0)}${emp.lastName.charAt(0)}
            </div>
            <div class="absence-employee-full-info">
              <h4>${emp.firstName} ${emp.lastName}</h4>
              <span>${this.absenceYear}</span>
            </div>
          </div>
          <div class="absence-employee-full-body">
            ${limitsHtml || '<p style="text-align: center; color: var(--color-text-muted); font-size: 0.8rem;">' + i18n.t('schedule.noLimitsSet') + '</p>'}
          </div>
          <div class="absence-employee-full-footer">
            <span class="absence-employee-full-total">${i18n.t('schedule.total')}: <strong>${totalUsed} ${i18n.t('schedule.days')}</strong></span>
            <button class="absence-employee-edit-btn">${i18n.t('schedule.editLimits')}</button>
          </div>
        </div>
      `;
    }).join('');
    
    container.innerHTML = `
      <div class="absence-employees-grid">
        ${cardsHtml}
      </div>
    `;
    
    // Add click handlers
    container.querySelectorAll('.absence-employee-edit-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        console.log('Edit limits button clicked');
        const card = (btn as HTMLElement).closest('.absence-employee-full-card') as HTMLElement | null;
        const empId = card?.dataset?.employeeId;
        console.log('Employee ID:', empId);
        if (empId) this.showEmployeeLimitsModal(empId);
      });
    });
    
    container.querySelectorAll('.absence-employee-full-card').forEach(card => {
      card.addEventListener('click', () => {
        const empId = (card as HTMLElement).dataset.employeeId;
        if (empId) this.showEmployeeAbsenceModal(empId);
      });
    });
  }

  // ==================== ABSENCE TIMELINE VIEW (Yearly Spreadsheet) ====================
  private renderAbsenceTimeline(): void {
    const container = document.getElementById('absenceContent');
    if (!container) return;

    const year = this.absenceYear;
    const employees = this.state.employees.filter(e => !e.status || e.status === 'available');
    const locale = i18n.getDateLocale();

    // Get holidays set
    const holidayDates = new Set(this.holidays.map((h: any) => h.date));

    const isWeekend = (d: Date): boolean => {
      const day = d.getDay();
      return day === 0 || day === 6;
    };

    // Build absence lookup: dateStr -> { employeeId -> absence }
    const absenceMap = new Map<string, Map<string, any>>();
    this.absences.forEach((a: any) => {
      const start = new Date(a.startDate);
      const end = new Date(a.endDate);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0];
        if (!absenceMap.has(dateStr)) absenceMap.set(dateStr, new Map());
        absenceMap.get(dateStr)!.set(a.employeeId, a);
      }
    });

    // Build summary per type per employee
    const activeTypes = this.absenceTypes.filter((t: any) => t.isActive);
    const typeUsage = new Map<string, Map<string, number>>(); // typeId -> { empId -> days }
    this.absences.forEach((a: any) => {
      if (!typeUsage.has(a.absenceTypeId)) typeUsage.set(a.absenceTypeId, new Map());
      const empMap = typeUsage.get(a.absenceTypeId)!;
      empMap.set(a.employeeId, (empMap.get(a.employeeId) || 0) + (a.workDays || 0));
    });

    // Build employee limit totals
    const empLimitTotal = new Map<string, number>();
    const empUsedTotal = new Map<string, number>();
    employees.forEach(emp => {
      const total = this.absenceLimits
        .filter((l: any) => l.employeeId === emp.id && l.year === year)
        .reduce((sum: number, l: any) => sum + (l.totalDays || 0), 0);
      empLimitTotal.set(emp.id, total);
      const used = this.absences
        .filter((a: any) => a.employeeId === emp.id)
        .reduce((sum: number, a: any) => sum + (a.workDays || 0), 0);
      empUsedTotal.set(emp.id, used);
    });

    // Employee header columns (horizontal with avatar)
    const avatarColors = ['#0097AC', '#e74c3c', '#2ecc71', '#9b59b6', '#f39c12', '#1abc9c', '#e67e22', '#3498db'];
    const empHeaders = employees.map(emp => {
      const initials = `${(emp.firstName || '?')[0]}${(emp.lastName || '?')[0]}`.toUpperCase();
      const ci = (emp.firstName || '').charCodeAt(0) % avatarColors.length;
      return `<th class="atl-emp-col-header" data-employee-id="${emp.id}">
        <div class="atl-emp-avatar" style="background: ${avatarColors[ci]}">${initials}</div>
        <div class="atl-emp-col-name">${emp.firstName} ${emp.lastName}</div>
      </th>`;
    }).join('');

    // Summary rows per absence type - collapsible
    const summaryRows = activeTypes.map(t => {
      const empMap = typeUsage.get(t.id) || new Map();
      const totalForType = Array.from(empMap.values()).reduce((s, v) => s + v, 0);
      const cells = employees.map(emp => {
        const val = empMap.get(emp.id) || 0;
        return `<td class="atl-summary-cell${val > 0 ? ' has-value' : ''}">${val}</td>`;
      }).join('');
      return `<tr class="atl-summary-type-row atl-type-detail-row">
        <td colspan="3" class="atl-summary-type-label"><span class="atl-type-badge" style="background: ${t.color}">${t.icon}</span> ${t.name} <span class="atl-type-total">(${totalForType}d)</span></td>
        ${cells}
        <td class="atl-summary-cell atl-summary-count-cell"></td>
      </tr>`;
    }).join('');

    // Toggle header for type breakdown
    const typeToggleRow = `<tr class="atl-summary-toggle-row" id="atlTypeToggle">
      <td colspan="${3 + employees.length + 1}" class="atl-summary-toggle-cell">
        <button class="atl-summary-toggle-btn">
          <svg class="atl-toggle-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
          ${i18n.t('schedule.absenceTimelineByType')} (${activeTypes.length})
        </button>
      </td>
    </tr>`;

    // Entitled days row
    const entitledCells = employees.map(emp => {
      const val = empLimitTotal.get(emp.id) || 0;
      return `<td class="atl-entitled-cell">${val}</td>`;
    }).join('');

    // Used days total row
    const usedCells = employees.map(emp => {
      const val = empUsedTotal.get(emp.id) || 0;
      return `<td class="atl-used-cell">${val}</td>`;
    }).join('');

    // Remaining days row
    const remainingCells = employees.map(emp => {
      const total = empLimitTotal.get(emp.id) || 0;
      const used = empUsedTotal.get(emp.id) || 0;
      const remaining = total - used;
      const cls = remaining < 0 ? ' negative' : remaining === 0 ? ' zero' : '';
      return `<td class="atl-remaining-cell${cls}">${remaining}</td>`;
    }).join('');

    // Utilization % row
    const utilizationCells = employees.map(emp => {
      const total = empLimitTotal.get(emp.id) || 0;
      const used = empUsedTotal.get(emp.id) || 0;
      const pct = total > 0 ? Math.round((used / total) * 100) : 0;
      const barColor = pct > 90 ? '#ef4444' : pct > 70 ? '#eab308' : '#22c55e';
      return `<td class="atl-utilization-cell">
        <div class="atl-utilization-bar-bg"><div class="atl-utilization-bar" style="width: ${pct}%; background: ${barColor}"></div></div>
        <span class="atl-utilization-pct">${pct}%</span>
      </td>`;
    }).join('');

    // Build calendar rows - all days of the year
    const calendarRows: string[] = [];
    const startDate = new Date(year, 0, 1);
    const endDate = new Date(year, 11, 31);
    let currentMonth = -1;

    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      const dayOfWeek = d.getDay();
      const isWkend = isWeekend(d);
      const isHoliday = holidayDates.has(dateStr);
      const isToday = dateStr === new Date().toISOString().split('T')[0];

      // ISO week number
      const tempDate = new Date(d.getTime());
      tempDate.setDate(tempDate.getDate() + 3 - ((tempDate.getDay() + 6) % 7));
      const week1 = new Date(tempDate.getFullYear(), 0, 4);
      const weekNum = 1 + Math.round(((tempDate.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);

      // Month separator
      if (d.getMonth() !== currentMonth) {
        currentMonth = d.getMonth();
        const monthName = d.toLocaleDateString(locale, { month: 'long' });
        calendarRows.push(`<tr class="atl-month-separator">
          <td colspan="${3 + employees.length + 1}" class="atl-month-separator-cell">
            <span class="atl-month-separator-name">${monthName} ${year}</span>
          </td>
        </tr>`);
      }

      // Show week number only on Mondays (or first day of year)
      const showWeek = dayOfWeek === 1 || (d.getMonth() === 0 && d.getDate() === 1);

      const dayName = d.toLocaleDateString(locale, { weekday: 'long' });
      const dateDisplay = `${d.getDate()}.${d.toLocaleDateString(locale, { month: 'short' }).replace('.', '')}`;

      const rowClass = [
        'atl-day-row',
        isWkend ? 'weekend' : '',
        isHoliday ? 'holiday' : '',
        isToday ? 'today' : ''
      ].filter(Boolean).join(' ');

      // Employee cells for this day
      const empCells = employees.map(emp => {
        const empAbsMap = absenceMap.get(dateStr);
        const absence = empAbsMap?.get(emp.id);
        if (absence && !isWkend) {
          const type = this.absenceTypes.find((t: any) => t.id === absence.absenceTypeId);
          return `<td class="atl-day-cell has-absence" style="--abs-color: ${type?.color || '#64748b'}" 
            data-absence-id="${absence.id}" data-employee-id="${emp.id}" data-date="${dateStr}" title="${type?.icon || ''} ${type?.name || ''} (${absence.workDays}d)">
            <span class="atl-absence-marker">${type?.icon || '1'}</span>
          </td>`;
        }
        if (isWkend || isHoliday) {
          return `<td class="atl-day-cell off-day"></td>`;
        }
        return `<td class="atl-day-cell empty-cell" data-employee-id="${emp.id}" data-date="${dateStr}"></td>`;
      }).join('');

      // Count total absent on this day
      const absMap = absenceMap.get(dateStr);
      const totalAbsent = absMap ? absMap.size : 0;
      const commentCell = totalAbsent > 0 && !isWkend
        ? `<td class="atl-count-cell"><span class="atl-count-badge ${totalAbsent >= 4 ? 'high' : totalAbsent >= 2 ? 'med' : 'low'}">${totalAbsent}</span></td>`
        : `<td class="atl-count-cell"></td>`;

      calendarRows.push(`<tr class="${rowClass}">
        <td class="atl-week-cell">${showWeek ? weekNum : ''}</td>
        <td class="atl-date-cell">${dateDisplay}</td>
        <td class="atl-dayname-cell">${dayName}</td>
        ${empCells}
        ${commentCell}
      </tr>`);
    }

    // Bottom sticky footer cells
    const bottomEntitled = employees.map(emp => {
      const val = empLimitTotal.get(emp.id) || 0;
      return `<td>${val}</td>`;
    }).join('');
    const bottomUsed = employees.map(emp => {
      const val = empUsedTotal.get(emp.id) || 0;
      return `<td>${val}</td>`;
    }).join('');
    const bottomRemaining = employees.map(emp => {
      const total = empLimitTotal.get(emp.id) || 0;
      const used = empUsedTotal.get(emp.id) || 0;
      const rem = total - used;
      const cls = rem < 0 ? 'rem-negative' : rem === 0 ? 'rem-zero' : 'rem-positive';
      return `<td class="${cls}">${rem}</td>`;
    }).join('');

    // Colgroup + dynamic min-width
    const fixedColsWidth = 42 + 84 + 100 + 62; // week + date + day + count
    const minEmpColWidth = 100;
    const minTableWidth = fixedColsWidth + employees.length * minEmpColWidth;
    const colgroup = `<colgroup>
      <col class="atl-col-week">
      <col class="atl-col-date">
      <col class="atl-col-day">
      ${employees.map(() => '<col class="atl-col-emp">').join('')}
      <col class="atl-col-count">
    </colgroup>`;

    container.innerHTML = `
      <div class="atl-container">
        <div class="atl-table-wrapper">
          <table class="atl-table" style="min-width: ${minTableWidth}px">
            ${colgroup}
            <thead>
              <tr class="atl-main-header">
                <th class="atl-header-fixed" colspan="3">${i18n.t('schedule.absenceTimelineYearReport')} ${year}</th>
                ${empHeaders}
                <th class="atl-header-count">${i18n.t('schedule.absenceTimelineOverlap')}</th>
              </tr>
            </thead>
            <tbody class="atl-summary-body">
              ${typeToggleRow}
              ${summaryRows}
              <tr class="atl-total-row atl-entitled-row">
                <td colspan="3" class="atl-total-label">📋 ${i18n.t('schedule.absenceEntitledDays')}</td>
                ${entitledCells}
                <td class="atl-entitled-cell atl-total-count-cell"></td>
              </tr>
              <tr class="atl-total-row atl-used-row">
                <td colspan="3" class="atl-total-label">📊 ${i18n.t('schedule.absenceUsedDays')}</td>
                ${usedCells}
                <td class="atl-used-cell atl-total-count-cell"></td>
              </tr>
              <tr class="atl-total-row atl-remaining-row">
                <td colspan="3" class="atl-total-label">✅ ${i18n.t('schedule.absenceRemainingDays')}</td>
                ${remainingCells}
                <td class="atl-remaining-cell atl-total-count-cell"></td>
              </tr>
              <tr class="atl-total-row atl-utilization-row">
                <td colspan="3" class="atl-total-label">📈 ${i18n.t('utilization')}</td>
                ${utilizationCells}
                <td class="atl-utilization-cell atl-total-count-cell"></td>
              </tr>
            </tbody>
            <tbody class="atl-calendar-body">
              ${calendarRows.join('')}
            </tbody>
            <tfoot class="atl-bottom-summary">
              <tr class="atl-bottom-entitled">
                <td colspan="3" class="atl-bottom-footer-label">📋 ${i18n.t('schedule.absenceEntitledDays')}</td>
                ${bottomEntitled}
                <td class="atl-bottom-count-cell"></td>
              </tr>
              <tr class="atl-bottom-used">
                <td colspan="3" class="atl-bottom-footer-label">📊 ${i18n.t('schedule.absenceUsedDays')}</td>
                ${bottomUsed}
                <td class="atl-bottom-count-cell"></td>
              </tr>
              <tr class="atl-bottom-remaining">
                <td colspan="3" class="atl-bottom-footer-label">✅ ${i18n.t('schedule.absenceRemainingDays')}</td>
                ${bottomRemaining}
                <td class="atl-bottom-count-cell"></td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div class="atl-legend">
          ${activeTypes.map((t: any) => `
            <div class="atl-legend-item">
              <div class="atl-legend-color" style="background: ${t.color}"></div>
              <span>${t.icon} ${t.name}</span>
            </div>
          `).join('')}
          <div class="atl-legend-divider"></div>
          <div class="atl-legend-item"><div class="atl-legend-color" style="background: var(--color-bg-tertiary)"></div><span>🔒 ${i18n.t('schedule.absenceWeekend')}</span></div>
        </div>
      </div>
    `;

    // Event handlers
    // Toggle type breakdown rows
    const toggleBtn = container.querySelector('#atlTypeToggle');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        const detailRows = container.querySelectorAll('.atl-type-detail-row');
        const chevron = toggleBtn.querySelector('.atl-toggle-chevron');
        const isCollapsed = toggleBtn.classList.toggle('collapsed');
        detailRows.forEach(row => {
          (row as HTMLElement).style.display = isCollapsed ? 'none' : '';
        });
        if (chevron) {
          (chevron as HTMLElement).style.transform = isCollapsed ? 'rotate(-90deg)' : '';
        }
      });
    }

    // Click absence cell to edit
    container.querySelectorAll('.atl-day-cell.has-absence').forEach(cell => {
      (cell as HTMLElement).style.cursor = 'pointer';
      cell.addEventListener('click', () => {
        const absId = (cell as HTMLElement).dataset.absenceId;
        if (absId) this.showEditAbsenceModal(absId);
      });
    });

    // Click empty cell to add absence
    container.querySelectorAll('.atl-day-cell.empty-cell').forEach(cell => {
      cell.addEventListener('click', () => {
        const empId = (cell as HTMLElement).dataset.employeeId || '';
        const dateStr = (cell as HTMLElement).dataset.date || '';
        this.showAddAbsenceWizardForTimeline(empId, dateStr);
      });
    });

    // Scroll to today on load
    setTimeout(() => {
      const todayRow = container.querySelector('.atl-day-row.today');
      if (todayRow) {
        todayRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
  }

  // Quick add from timeline
  private async showAddAbsenceWizardForTimeline(employeeId: string, preselectedDate: string): Promise<void> {
    if (this.absenceTypes.length === 0) {
      try { this.absenceTypes = await api.getAbsenceTypes(); } catch { this.absenceTypes = []; }
    }

    const emp = this.state.employees.find(e => e.id === employeeId);
    const overlay = document.createElement('div');
    overlay.className = 'absence-modal-overlay';

    overlay.innerHTML = `
      <div class="absence-modal" style="max-width: 480px;">
        <div class="absence-modal-header">
          <h2>➕ ${i18n.t('schedule.addAbsence')}${emp ? ` – ${emp.firstName} ${emp.lastName}` : ''}</h2>
          <button class="absence-modal-close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div class="absence-modal-body">
          ${!emp ? `
          <div class="absence-form-group">
            <label class="absence-form-label">${i18n.t('schedule.absenceListEmployee')}</label>
            <select class="absence-form-select" id="tlWizardEmployee">
              <option value="">${i18n.t('schedule.selectOption')}</option>
              ${this.state.employees.filter(e => !e.status || e.status === 'available').map(e => `<option value="${e.id}">${e.firstName} ${e.lastName}</option>`).join('')}
            </select>
          </div>
          ` : ''}
          <div class="absence-form-group">
            <label class="absence-form-label">${i18n.t('schedule.absenceTypeLabel')}</label>
            <div class="atl-type-grid" id="tlTypeGrid">
              ${this.absenceTypes.filter((t: any) => t.isActive).map((t: any) => `
                <button class="atl-type-btn" data-type-id="${t.id}" style="--type-color: ${t.color}">
                  <span class="atl-type-icon">${t.icon}</span>
                  <span class="atl-type-name">${t.name}</span>
                </button>
              `).join('')}
            </div>
          </div>
          <div class="absence-form-row">
            <div class="absence-form-group">
              <label class="absence-form-label">${i18n.t('schedule.dateFrom')}</label>
              <input type="date" class="absence-form-input" id="tlStartDate" value="${preselectedDate}">
            </div>
            <div class="absence-form-group">
              <label class="absence-form-label">${i18n.t('schedule.dateTo')}</label>
              <input type="date" class="absence-form-input" id="tlEndDate" value="${preselectedDate}">
            </div>
          </div>
          <div class="absence-form-group">
            <div class="atl-workdays-preview" id="tlWorkDaysPreview">
              <span class="atl-workdays-count">1</span>
              <span class="atl-workdays-label">${i18n.t('schedule.absenceListDays')}</span>
            </div>
          </div>
          <div class="absence-form-group">
            <label class="absence-form-label">${i18n.t('schedule.noteOptional')}</label>
            <input type="text" class="absence-form-input" id="tlNote" placeholder="${i18n.t('schedule.additionalInfo')}">
          </div>
        </div>
        <div class="absence-modal-footer">
          <button class="absence-modal-btn secondary" id="tlCancel">${i18n.t('schedule.cancel')}</button>
          <button class="absence-modal-btn primary" id="tlSave" disabled>${i18n.t('schedule.save')}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    let selectedType = '';
    const saveBtn = overlay.querySelector('#tlSave') as HTMLButtonElement;

    const updatePreview = () => {
      const start = (overlay.querySelector('#tlStartDate') as HTMLInputElement)?.value;
      const end = (overlay.querySelector('#tlEndDate') as HTMLInputElement)?.value;
      if (start && end) {
        const wd = this.calculateWorkDays(start, end);
        const preview = overlay.querySelector('#tlWorkDaysPreview');
        if (preview) {
          preview.querySelector('.atl-workdays-count')!.textContent = String(wd);
        }
      }
    };

    const checkValid = () => {
      const empVal = emp ? employeeId : (overlay.querySelector('#tlWizardEmployee') as HTMLSelectElement)?.value || '';
      const start = (overlay.querySelector('#tlStartDate') as HTMLInputElement)?.value;
      const end = (overlay.querySelector('#tlEndDate') as HTMLInputElement)?.value;
      saveBtn.disabled = !selectedType || !empVal || !start || !end;
    };

    // Type buttons
    overlay.querySelectorAll('.atl-type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        overlay.querySelectorAll('.atl-type-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedType = (btn as HTMLElement).dataset.typeId || '';
        checkValid();
      });
    });

    overlay.querySelector('#tlStartDate')?.addEventListener('change', () => { updatePreview(); checkValid(); });
    overlay.querySelector('#tlEndDate')?.addEventListener('change', () => { updatePreview(); checkValid(); });
    overlay.querySelector('#tlWizardEmployee')?.addEventListener('change', checkValid);

    saveBtn.addEventListener('click', async () => {
      const empVal = emp ? employeeId : (overlay.querySelector('#tlWizardEmployee') as HTMLSelectElement)?.value || '';
      const startDate = (overlay.querySelector('#tlStartDate') as HTMLInputElement).value;
      const endDate = (overlay.querySelector('#tlEndDate') as HTMLInputElement).value;
      const note = (overlay.querySelector('#tlNote') as HTMLInputElement).value;
      const workDays = this.calculateWorkDays(startDate, endDate);

      await api.addAbsence({
        id: `abs-${Date.now()}`,
        employeeId: empVal,
        absenceTypeId: selectedType,
        startDate, endDate, workDays,
        status: 'approved',
        note
      });

      overlay.remove();
      await this.loadAbsenceData();
      this.renderAbsenceContent();
      this.renderAbsenceYearStats();
      this.renderAbsenceUpcoming();
      this.renderAbsenceEmployeesSidebar();
    });

    overlay.querySelector('#tlCancel')?.addEventListener('click', () => overlay.remove());
    overlay.querySelector('.absence-modal-close')?.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    updatePreview();
  }

  // ========== ABSENCE MODALS ==========
  
  private async showAddAbsenceWizard(preselectedDate?: string): Promise<void> {
    // Load data first if not loaded
    if (this.absenceTypes.length === 0) {
      try {
        this.absenceTypes = await api.getAbsenceTypes();
      } catch (e) {
        console.error('Failed to load absence types:', e);
        this.absenceTypes = [];
      }
    }
    
    const overlay = document.createElement('div');
    overlay.className = 'absence-modal-overlay';
    
    const employees = this.state.employees.filter(e => !e.status || e.status === 'available');
    
    overlay.innerHTML = `
      <div class="absence-modal" style="max-width: 550px;">
        <div class="absence-modal-header">
          <h2>➕ ${i18n.t('schedule.addAbsenceWizardTitle')}</h2>
          <button class="absence-modal-close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div class="absence-wizard-steps">
          <div class="absence-wizard-step active" data-step="1">
            <span class="absence-wizard-step-number">1</span>
            <span class="absence-wizard-step-label">${i18n.t('schedule.wizardStepEmployee')}</span>
          </div>
          <div class="absence-wizard-step-connector"></div>
          <div class="absence-wizard-step" data-step="2">
            <span class="absence-wizard-step-number">2</span>
            <span class="absence-wizard-step-label">${i18n.t('schedule.wizardStepDetails')}</span>
          </div>
          <div class="absence-wizard-step-connector"></div>
          <div class="absence-wizard-step" data-step="3">
            <span class="absence-wizard-step-number">3</span>
            <span class="absence-wizard-step-label">${i18n.t('schedule.wizardStepSummary')}</span>
          </div>
        </div>
        <div class="absence-modal-body" id="absenceWizardContent">
          <!-- Step 1: Select Employee -->
          <div class="absence-form-group">
            <label class="absence-form-label">Wybierz pracownika</label>
            <select class="absence-form-select" id="wizardEmployee">
              <option value="">${i18n.t('schedule.selectOption')}</option>
              ${employees.map(e => `<option value="${e.id}">${e.firstName} ${e.lastName}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="absence-modal-footer">
          <button class="absence-modal-btn secondary" id="wizardCancel">Anuluj</button>
          <button class="absence-modal-btn primary" id="wizardNext" disabled>Dalej</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    
    let currentStep = 1;
    let selectedEmployee = '';
    let selectedType = '';
    let startDate = preselectedDate || '';
    let endDate = preselectedDate || '';
    let note = '';
    
    // Get button references
    const nextBtn = overlay.querySelector('#wizardNext') as HTMLButtonElement;
    const cancelBtn = overlay.querySelector('#wizardCancel') as HTMLButtonElement;
    
    // Setup initial step 1 listener
    const employeeSelect = overlay.querySelector('#wizardEmployee') as HTMLSelectElement;
    if (employeeSelect) {
      employeeSelect.addEventListener('change', (e) => {
        selectedEmployee = (e.target as HTMLSelectElement).value;
        if (nextBtn) nextBtn.disabled = !selectedEmployee;
      });
    }
    
    const updateStep = (step: number) => {
      currentStep = step;
      
      // Update step indicators
      overlay.querySelectorAll('.absence-wizard-step').forEach((s, i) => {
        s.classList.remove('active', 'completed');
        if (i + 1 < step) s.classList.add('completed');
        if (i + 1 === step) s.classList.add('active');
      });
      
      const content = overlay.querySelector('#absenceWizardContent') as HTMLElement;
      
      if (step === 1) {
        content!.innerHTML = `
          <div class="absence-form-group">
            <label class="absence-form-label">Wybierz pracownika</label>
            <select class="absence-form-select" id="wizardEmployee">
              <option value="">${i18n.t('schedule.selectOption')}</option>
              ${employees.map(e => `<option value="${e.id}" ${e.id === selectedEmployee ? 'selected' : ''}>${e.firstName} ${e.lastName}</option>`).join('')}
            </select>
          </div>
        `;
        nextBtn.textContent = i18n.t('schedule.next');
        nextBtn.disabled = !selectedEmployee;
        
        overlay.querySelector('#wizardEmployee')?.addEventListener('change', (e) => {
          selectedEmployee = (e.target as HTMLSelectElement).value;
          nextBtn.disabled = !selectedEmployee;
        });
        
      } else if (step === 2) {
        content!.innerHTML = `
          <div class="absence-form-group">
            <label class="absence-form-label">${i18n.t('schedule.absenceTypeLabel')}</label>
            <select class="absence-form-select" id="wizardType">
              <option value="">${i18n.t('schedule.selectOption')}</option>
              ${this.absenceTypes.map(t => `<option value="${t.id}" ${t.id === selectedType ? 'selected' : ''}>${t.icon} ${t.name}</option>`).join('')}
            </select>
          </div>
          <div class="absence-form-row">
            <div class="absence-form-group">
              <label class="absence-form-label">${i18n.t('schedule.dateFrom')}</label>
              <input type="date" class="absence-form-input" id="wizardStartDate" value="${startDate}">
            </div>
            <div class="absence-form-group">
              <label class="absence-form-label">${i18n.t('schedule.dateTo')}</label>
              <input type="date" class="absence-form-input" id="wizardEndDate" value="${endDate}">
            </div>
          </div>
          <div class="absence-form-group">
            <label class="absence-form-label">${i18n.t('schedule.noteOptional')}</label>
            <textarea class="absence-form-textarea" id="wizardNote" rows="2" placeholder="${i18n.t('schedule.additionalInfo')}">${note}</textarea>
          </div>
        `;
        nextBtn.textContent = i18n.t('schedule.next');
        
        const checkValid = () => {
          selectedType = (overlay.querySelector('#wizardType') as HTMLSelectElement)?.value || '';
          startDate = (overlay.querySelector('#wizardStartDate') as HTMLInputElement)?.value || '';
          endDate = (overlay.querySelector('#wizardEndDate') as HTMLInputElement)?.value || '';
          note = (overlay.querySelector('#wizardNote') as HTMLTextAreaElement)?.value || '';
          nextBtn.disabled = !selectedType || !startDate || !endDate;
        };
        
        checkValid();
        overlay.querySelector('#wizardType')?.addEventListener('change', checkValid);
        overlay.querySelector('#wizardStartDate')?.addEventListener('change', checkValid);
        overlay.querySelector('#wizardEndDate')?.addEventListener('change', checkValid);
        
      } else if (step === 3) {
        const emp = employees.find(e => e.id === selectedEmployee);
        const type = this.absenceTypes.find(t => t.id === selectedType);
        
        // Calculate work days
        const workDays = this.calculateWorkDays(startDate, endDate);
        
        content!.innerHTML = `
          <div style="text-align: center; padding: 20px;">
            <div style="font-size: 3rem; margin-bottom: 16px;">${type?.icon || '📅'}</div>
            <h3 style="margin: 0 0 8px 0;">${emp?.firstName} ${emp?.lastName}</h3>
            <p style="color: var(--color-text-secondary); margin: 0 0 20px 0;">${type?.name}</p>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; text-align: left; background: var(--color-bg-secondary); padding: 16px; border-radius: 8px;">
              <div>
                <div style="font-size: 0.75rem; color: var(--color-text-muted);">Od</div>
                <div style="font-weight: 500;">${new Date(startDate).toLocaleDateString(i18n.getDateLocale(), { weekday: 'short', day: '2-digit', month: 'long' })}</div>
              </div>
              <div>
                <div style="font-size: 0.75rem; color: var(--color-text-muted);">Do</div>
                <div style="font-weight: 500;">${new Date(endDate).toLocaleDateString(i18n.getDateLocale(), { weekday: 'short', day: '2-digit', month: 'long' })}</div>
              </div>
            </div>
            <div style="margin-top: 16px; padding: 12px; background: ${type?.color}20; border-radius: 8px; border-left: 4px solid ${type?.color};">
              <span style="font-size: 1.5rem; font-weight: 700; color: ${type?.color};">${workDays}</span>
              <span style="color: var(--color-text-secondary);"> dni roboczych</span>
            </div>
            ${note ? `<p style="margin-top: 16px; font-style: italic; color: var(--color-text-secondary);">"${note}"</p>` : ''}
          </div>
        `;
        nextBtn.textContent = 'Zapisz';
        nextBtn.disabled = false;
      }
    };
    
    // Next/Save button
    nextBtn?.addEventListener('click', async () => {
      if (currentStep < 3) {
        updateStep(currentStep + 1);
      } else {
        // Save absence
        const workDays = this.calculateWorkDays(startDate, endDate);
        await api.addAbsence({
          id: `abs-${Date.now()}`,
          employeeId: selectedEmployee,
          absenceTypeId: selectedType,
          startDate,
          endDate,
          workDays,
          status: 'approved',
          note
        });
        
        overlay.remove();
        await this.loadAbsenceData();
        this.renderAbsenceContent();
        this.renderAbsenceYearStats();
        this.renderAbsenceUpcoming();
        this.renderAbsenceEmployeesSidebar();
      }
    });
    
    // Cancel button - go back or close
    cancelBtn?.addEventListener('click', () => {
      if (currentStep > 1) {
        updateStep(currentStep - 1);
      } else {
        overlay.remove();
      }
    });
    
    // Close button
    overlay.querySelector('.absence-modal-close')?.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
  }
  
  private calculateWorkDays(startDate: string, endDate: string): number {
    const start = new Date(startDate);
    const end = new Date(endDate);
    let days = 0;
    const current = new Date(start);
    
    while (current <= end) {
      const dayOfWeek = current.getDay();
      const dateStr = current.toISOString().split('T')[0];
      const isHoliday = this.holidays.some(h => h.date === dateStr);
      
      if (dayOfWeek !== 0 && dayOfWeek !== 6 && !isHoliday) {
        days++;
      }
      current.setDate(current.getDate() + 1);
    }
    
    return days;
  }
  
  private async showAbsenceSettingsModal(): Promise<void> {
    // Load data first if not loaded
    if (this.absenceTypes.length === 0) {
      try {
        this.absenceTypes = await api.getAbsenceTypes();
      } catch (e) {
        console.error('Failed to load absence types:', e);
        this.absenceTypes = [];
      }
    }
    if (this.holidays.length === 0) {
      try {
        this.holidays = await api.getHolidays(this.absenceYear);
      } catch (e) {
        console.error('Failed to load holidays:', e);
        this.holidays = [];
      }
    }
    
    const overlay = document.createElement('div');
    overlay.className = 'absence-modal-overlay';
    
    const typesHtml = this.absenceTypes.map(type => `
      <div class="absence-type-row" data-type-id="${type.id}">
        <div class="absence-type-icon-picker" style="background: ${type.color}20; color: ${type.color};">
          ${type.icon}
        </div>
        <input type="text" class="absence-type-name-input" value="${type.name}" data-field="name">
        <input type="number" class="absence-type-days-input" value="${type.defaultDays}" data-field="defaultDays" min="0" placeholder="Dni">
        <input type="color" value="${type.color}" data-field="color" style="width: 40px; height: 32px; border: none; cursor: pointer;">
        <div class="absence-type-toggle">
          <input type="checkbox" ${type.isActive ? 'checked' : ''} data-field="isActive">
        </div>
      </div>
    `).join('');
    
    overlay.innerHTML = `
      <div class="absence-modal" style="max-width: 700px;">
        <div class="absence-modal-header">
          <h2>⚙️ ${i18n.t('schedule.absenceSettingsTitle')}</h2>
          <button class="absence-modal-close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div class="absence-modal-body">
          <div class="absence-settings-section">
            <h3>${i18n.t('schedule.absenceTypesTitle')}</h3>
            <p style="font-size: 0.8rem; color: var(--color-text-secondary); margin-bottom: 12px;">
              ${i18n.t('schedule.absenceTypesDesc')}
            </p>
            <div style="display: grid; grid-template-columns: 40px 1fr 80px 50px 50px; gap: 12px; padding: 8px 10px; background: var(--color-bg-tertiary); border-radius: 6px; font-size: 0.7rem; color: var(--color-text-secondary); text-transform: uppercase; margin-bottom: 8px;">
              <span>${i18n.t('schedule.absenceSettingsIcon')}</span>
              <span>${i18n.t('schedule.absenceSettingsName')}</span>
              <span>${i18n.t('schedule.absenceSettingsDefaultDays')}</span>
              <span>${i18n.t('schedule.absenceSettingsColor')}</span>
              <span>${i18n.t('schedule.absenceSettingsActive')}</span>
            </div>
            ${typesHtml || '<p style="color: var(--color-text-muted);">' + i18n.t('schedule.noAbsenceTypes') + '</p>'}
          </div>
          
          <div class="absence-settings-section" style="margin-top: 24px;">
            <h3>${i18n.t('schedule.holidaysTitle').replace('{0}', String(this.absenceYear))}</h3>
            <p style="font-size: 0.8rem; color: var(--color-text-secondary); margin-bottom: 12px;">
              ${i18n.t('schedule.holidaysDesc').replace('{0}', String(this.holidays.length))}
            </p>
            <div style="display: flex; flex-wrap: wrap; gap: 8px;">
              ${this.holidays.slice(0, 8).map(h => `
                <span style="padding: 4px 10px; background: var(--color-warning-bg); color: var(--color-warning); border-radius: 4px; font-size: 0.75rem;">
                  🎉 ${new Date(h.date).toLocaleDateString(i18n.getDateLocale(), { day: '2-digit', month: '2-digit' })} - ${h.name}
                </span>
              `).join('')}
              ${this.holidays.length > 8 ? `<span style="padding: 4px 10px; color: var(--color-text-muted); font-size: 0.75rem;">+${this.holidays.length - 8} ${i18n.t('schedule.more')}</span>` : ''}
            </div>
          </div>
        </div>
        <div class="absence-modal-footer">
          <button class="absence-modal-btn secondary" id="settingsCancel">${i18n.t('schedule.cancel')}</button>
          <button class="absence-modal-btn primary" id="settingsSave">${i18n.t('schedule.saveChanges')}</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    
    // Save handler
    overlay.querySelector('#settingsSave')?.addEventListener('click', async () => {
      const rows = overlay.querySelectorAll('.absence-type-row');
      
      for (const row of rows) {
        const typeId = (row as HTMLElement).dataset.typeId;
        const name = (row.querySelector('[data-field="name"]') as HTMLInputElement).value;
        const defaultDays = parseInt((row.querySelector('[data-field="defaultDays"]') as HTMLInputElement).value) || 0;
        const color = (row.querySelector('[data-field="color"]') as HTMLInputElement).value;
        const isActive = (row.querySelector('[data-field="isActive"]') as HTMLInputElement).checked;
        
        const type = this.absenceTypes.find(t => t.id === typeId);
        if (type) {
          await api.updateAbsenceType(typeId!, {
            ...type,
            name,
            defaultDays,
            color,
            isActive
          });
        }
      }
      
      overlay.remove();
      await this.loadAbsenceData();
      this.renderAbsenceFilters();
    });
    
    // Cancel/close handlers
    overlay.querySelector('#settingsCancel')?.addEventListener('click', () => overlay.remove());
    overlay.querySelector('.absence-modal-close')?.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
  }
  
  private async showEmployeeLimitsModal(employeeId: string): Promise<void> {
    console.log('showEmployeeLimitsModal called for:', employeeId);
    const emp = this.state.employees.find(e => e.id === employeeId);
    if (!emp) {
      console.log('Employee not found!');
      return;
    }
    
    // Always try to load data for this modal
    try {
      console.log('Loading absence types...');
      this.absenceTypes = await api.getAbsenceTypes();
      console.log('Loaded absence types:', this.absenceTypes.length);
    } catch (e) {
      console.error('Failed to load absence types:', e);
      if (this.absenceTypes.length === 0) {
        alert(i18n.t('schedule.cannotLoadTypes'));
        return;
      }
    }
    
    try {
      console.log('Loading absence limits...');
      this.absenceLimits = await api.getAbsenceLimits({ year: this.absenceYear });
      console.log('Loaded absence limits:', this.absenceLimits.length);
    } catch (e) {
      console.error('Failed to load absence limits:', e);
    }
    
    const empLimits = this.absenceLimits.filter(l => l.employeeId === employeeId);
    
    const overlay = document.createElement('div');
    overlay.className = 'absence-modal-overlay';
    
    const limitsHtml = this.absenceTypes.map(type => {
      const limit = empLimits.find(l => l.absenceTypeId === type.id);
      const totalDays = limit?.totalDays ?? type.defaultDays;
      const usedDays = limit?.usedDays || 0;
      
      return `
        <div class="absence-type-row" data-type-id="${type.id}">
          <div class="absence-type-icon-picker" style="background: ${type.color}20; color: ${type.color};">
            ${type.icon}
          </div>
          <span style="flex: 1; font-size: 0.85rem;">${type.name}</span>
          <input type="number" class="absence-type-days-input" value="${totalDays}" data-field="totalDays" min="0" style="width: 70px;">
          <span style="font-size: 0.8rem; color: var(--color-text-secondary); min-width: 70px; text-align: right;">
            ${i18n.t('schedule.used')}: ${usedDays}
          </span>
        </div>
      `;
    }).join('');
    
    overlay.innerHTML = `
      <div class="absence-modal" style="max-width: 550px;">
        <div class="absence-modal-header">
          <h2>
            <span style="width: 32px; height: 32px; border-radius: 50%; background: ${emp.color}; display: inline-flex; align-items: center; justify-content: center; color: white; font-size: 0.8rem; margin-right: 8px;">
              ${emp.firstName.charAt(0)}${emp.lastName.charAt(0)}
            </span>
            ${i18n.t('schedule.absenceLimitsTitle').replace('{0}', emp.firstName + ' ' + emp.lastName)}
          </h2>
          <button class="absence-modal-close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div class="absence-modal-body">
          <p style="font-size: 0.85rem; color: var(--color-text-secondary); margin-bottom: 16px;">
            ${i18n.t('schedule.setIndividualLimits')} <strong>${this.absenceYear}</strong>
          </p>
          ${limitsHtml}
        </div>
        <div class="absence-modal-footer">
          <button class="absence-modal-btn secondary" id="limitsCancel">${i18n.t('schedule.cancel')}</button>
          <button class="absence-modal-btn primary" id="limitsSave">${i18n.t('schedule.saveLimits')}</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    
    // Save handler
    overlay.querySelector('#limitsSave')?.addEventListener('click', async () => {
      const limits: any[] = [];
      const rows = overlay.querySelectorAll('.absence-type-row');
      
      rows.forEach(row => {
        const typeId = (row as HTMLElement).dataset.typeId;
        const totalDays = parseInt((row.querySelector('[data-field="totalDays"]') as HTMLInputElement).value) || 0;
        limits.push({ absenceTypeId: typeId, totalDays });
      });
      
      await api.setAbsenceLimitsBulk(employeeId, this.absenceYear, limits);
      
      overlay.remove();
      await this.loadAbsenceData();
      this.renderAbsenceEmployeesSidebar();
      if (this.absenceViewMode === 'employees') {
        this.renderAbsenceEmployeesGrid();
      }
    });
    
    // Cancel/close handlers
    overlay.querySelector('#limitsCancel')?.addEventListener('click', () => overlay.remove());
    overlay.querySelector('.absence-modal-close')?.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
  }
  
  private async showEmployeeAbsenceModal(employeeId: string): Promise<void> {
    const emp = this.state.employees.find(e => e.id === employeeId);
    if (!emp) return;
    
    const empAbsences = this.absences.filter(a => a.employeeId === employeeId);
    const empLimits = this.absenceLimits.filter(l => l.employeeId === employeeId);
    
    // Fetch employee details and qualifications
    let empDetails: any = null;
    let empQualifications: any[] = [];
    try {
      empDetails = await api.getEmployeeDetails(employeeId);
      empQualifications = await api.getQualifications(employeeId);
    } catch (e) {
      console.log('No employee details found');
    }
    
    const overlay = document.createElement('div');
    overlay.className = 'absence-modal-overlay';
    
    // Contact info section
    const contactHtml = `
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; padding: 12px; background: var(--color-bg-secondary); border-radius: 8px; margin-bottom: 16px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 1rem;">📧</span>
          <div>
            <div style="font-size: 0.65rem; color: var(--color-text-muted); text-transform: uppercase;">Email</div>
            <div style="font-size: 0.8rem;">${empDetails?.email || '-'}</div>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 1rem;">📱</span>
          <div>
            <div style="font-size: 0.65rem; color: var(--color-text-muted); text-transform: uppercase;">${i18n.t('schedule.phone')}</div>
            <div style="font-size: 0.8rem;">${empDetails?.phone || '-'}</div>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 1rem;">📍</span>
          <div>
            <div style="font-size: 0.65rem; color: var(--color-text-muted); text-transform: uppercase;">${i18n.t('schedule.position')}</div>
            <div style="font-size: 0.8rem;">${empDetails?.position || '-'}</div>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 1rem;">🏢</span>
          <div>
            <div style="font-size: 0.65rem; color: var(--color-text-muted); text-transform: uppercase;">${i18n.t('schedule.department')}</div>
            <div style="font-size: 0.8rem;">${empDetails?.department || '-'}</div>
          </div>
        </div>
      </div>
    `;
    
    // Qualifications section
    const qualificationsHtml = empQualifications.length > 0 ? `
      <div style="display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 16px;">
        ${empQualifications.map(q => `
          <span style="padding: 4px 10px; background: ${q.level === 'expert' ? '#10b981' : q.level === 'advanced' ? '#3b82f6' : '#64748b'}20; 
                       color: ${q.level === 'expert' ? '#10b981' : q.level === 'advanced' ? '#3b82f6' : '#64748b'}; 
                       border-radius: 12px; font-size: 0.7rem; font-weight: 500;">
            ${q.level === 'expert' ? '⭐' : q.level === 'advanced' ? '✓' : '○'} ${q.skillName}
          </span>
        `).join('')}
      </div>
    ` : '';
    
    // Limits summary
    const limitsHtml = this.absenceTypes.slice(0, 5).map(type => {
      const limit = empLimits.find(l => l.absenceTypeId === type.id);
      const total = limit?.totalDays || type.defaultDays || 0;
      const used = limit?.usedDays || 0;
      const remaining = total - used;
      const percent = total > 0 ? (used / total) * 100 : 0;
      
      if (total === 0) return '';
      
      return `
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
          <span style="font-size: 1rem;">${type.icon}</span>
          <div style="flex: 1;">
            <div style="display: flex; justify-content: space-between; font-size: 0.75rem; margin-bottom: 2px;">
              <span>${type.name}</span>
              <span style="color: ${remaining <= 0 ? 'var(--color-danger)' : 'var(--color-text-secondary)'};">${i18n.t('schedule.remainingLabel').replace('{0}', String(remaining))}</span>
            </div>
            <div style="height: 4px; background: var(--color-bg-tertiary); border-radius: 2px;">
              <div style="height: 100%; width: ${Math.min(percent, 100)}%; background: ${type.color}; border-radius: 2px;"></div>
            </div>
          </div>
          <span style="font-size: 0.75rem; color: var(--color-text-muted); min-width: 45px; text-align: right;">${used}/${total}</span>
        </div>
      `;
    }).filter(Boolean).join('');
    
    // Absences list
    const absencesHtml = empAbsences.length > 0 ? empAbsences.slice(0, 10).map(a => {
      const type = this.absenceTypes.find(t => t.id === a.absenceTypeId);
      return `
        <div style="display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--color-border-light);">
          <span style="font-size: 1.1rem;">${type?.icon || '📅'}</span>
          <div style="flex: 1;">
            <div style="font-size: 0.8rem; font-weight: 500;">${type?.name || i18n.t('schedule.absenceDefault')}</div>
            <div style="font-size: 0.7rem; color: var(--color-text-muted);">
              ${new Date(a.startDate).toLocaleDateString(i18n.getDateLocale())} - ${new Date(a.endDate).toLocaleDateString(i18n.getDateLocale())}
            </div>
          </div>
          <span style="font-size: 0.8rem; font-weight: 600;">${a.workDays} ${i18n.t('schedule.days')}</span>
        </div>
      `;
    }).join('') : '<p style="text-align: center; color: var(--color-text-muted); padding: 20px;">' + i18n.t('schedule.noAbsencesThisYear') + '</p>';
    
    overlay.innerHTML = `
      <div class="absence-modal" style="max-width: 550px;">
        <div class="absence-modal-header">
          <h2>
            <span style="width: 42px; height: 42px; border-radius: 50%; background: ${emp.color}; display: inline-flex; align-items: center; justify-content: center; color: white; font-size: 0.9rem; margin-right: 12px;">
              ${emp.firstName.charAt(0)}${emp.lastName.charAt(0)}
            </span>
            <div>
              <div>${emp.firstName} ${emp.lastName}</div>
              <div style="font-size: 0.75rem; font-weight: 400; color: var(--color-text-secondary);">${empDetails?.position || i18n.t('schedule.employeeDefault')}</div>
            </div>
          </h2>
          <button class="absence-modal-close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div class="absence-modal-body">
          ${contactHtml}
          ${empQualifications.length > 0 ? `<h4 style="font-size: 0.85rem; font-weight: 600; margin: 0 0 8px 0;">🎓 ${i18n.t('schedule.qualifications')}</h4>` + qualificationsHtml : ''}
          <h4 style="font-size: 0.85rem; font-weight: 600; margin: 0 0 12px 0;">📊 ${i18n.t('schedule.limitsYear').replace('{0}', String(this.absenceYear))}</h4>
          ${limitsHtml || '<p style="color: var(--color-text-muted); font-size: 0.8rem;">' + i18n.t('schedule.noLimitsSet') + '</p>'}
          <h4 style="font-size: 0.85rem; font-weight: 600; margin: 20px 0 12px 0;">📅 ${i18n.t('schedule.absenceHistory')}</h4>
          ${absencesHtml}
        </div>
        <div class="absence-modal-footer">
          <button class="absence-modal-btn secondary" id="empEditDetails">✏️ ${i18n.t('schedule.editProfile')}</button>
          <button class="absence-modal-btn secondary" id="empEditLimits">${i18n.t('schedule.editLimits')}</button>
          <button class="absence-modal-btn primary" id="empAddAbsence">${i18n.t('schedule.addAbsence')}</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    
    // Handlers
    document.getElementById('empEditDetails')?.addEventListener('click', () => {
      overlay.remove();
      this.showEditEmployeeDetailsModal(employeeId, empDetails);
    });
    
    document.getElementById('empEditLimits')?.addEventListener('click', () => {
      overlay.remove();
      this.showEmployeeLimitsModal(employeeId);
    });
    
    document.getElementById('empAddAbsence')?.addEventListener('click', () => {
      overlay.remove();
      this.showAddAbsenceWizard();
      setTimeout(() => {
        const select = document.getElementById('wizardEmployee') as HTMLSelectElement;
        if (select) {
          select.value = employeeId;
          select.dispatchEvent(new Event('change'));
        }
      }, 100);
    });
    
    overlay.querySelector('.absence-modal-close')?.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
  }
  
  private showEditEmployeeDetailsModal(employeeId: string, currentDetails: any): void {
    const emp = this.state.employees.find(e => e.id === employeeId);
    if (!emp) return;
    
    const overlay = document.createElement('div');
    overlay.className = 'absence-modal-overlay';
    
    overlay.innerHTML = `
      <div class="absence-modal" style="max-width: 500px;">
        <div class="absence-modal-header">
          <h2>✏️ Edytuj profil pracownika</h2>
          <button class="absence-modal-close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div class="absence-modal-body">
          <div class="absence-form-row">
            <div class="absence-form-group">
              <label class="absence-form-label">📧 Email</label>
              <input type="email" class="absence-form-input" id="editEmpEmail" value="${currentDetails?.email || ''}" placeholder="${i18n.t('schedule.emailPlaceholder')}">
            </div>
            <div class="absence-form-group">
              <label class="absence-form-label">📱 Telefon</label>
              <input type="tel" class="absence-form-input" id="editEmpPhone" value="${currentDetails?.phone || ''}" placeholder="${i18n.t('schedule.phonePlaceholder')}">
            </div>
          </div>
          <div class="absence-form-row">
            <div class="absence-form-group">
              <label class="absence-form-label">📍 ${i18n.t('schedule.position')}</label>
              <input type="text" class="absence-form-input" id="editEmpPosition" value="${currentDetails?.position || ''}" placeholder="${i18n.t('schedule.positionPlaceholder')}">
            </div>
            <div class="absence-form-group">
              <label class="absence-form-label">🏢 ${i18n.t('schedule.department')}</label>
              <input type="text" class="absence-form-input" id="editEmpDepartment" value="${currentDetails?.department || ''}" placeholder="${i18n.t('schedule.departmentPlaceholder')}">
            </div>
          </div>
          <div class="absence-form-group">
            <label class="absence-form-label">📝 Notatki</label>
            <textarea class="absence-form-textarea" id="editEmpNotes" rows="3" placeholder="${i18n.t('schedule.notesPlaceholder')}">${currentDetails?.notes || ''}</textarea>
          </div>
          
          <h4 style="font-size: 0.85rem; font-weight: 600; margin: 20px 0 12px 0;">🎓 ${i18n.t('schedule.qualifications')}</h4>
          <div id="qualificationsList" style="margin-bottom: 12px;"></div>
          <div style="display: flex; gap: 8px;">
            <input type="text" class="absence-form-input" id="newQualName" placeholder="${i18n.t('schedule.qualificationName')}" style="flex: 1;">
            <select class="absence-form-select" id="newQualLevel" style="width: 120px;">
              <option value="basic">${i18n.t('schedule.levelBasic')}</option>
              <option value="advanced">${i18n.t('schedule.levelAdvanced')}</option>
              <option value="expert">${i18n.t('schedule.levelExpert')}</option>
            </select>
            <button class="absence-modal-btn primary" id="addQualBtn" style="padding: 8px 12px;">+</button>
          </div>
        </div>
        <div class="absence-modal-footer">
          <button class="absence-modal-btn secondary" id="editDetailsCancel">${i18n.t('schedule.cancel')}</button>
          <button class="absence-modal-btn primary" id="editDetailsSave">${i18n.t('schedule.saveChanges')}</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    
    // Qualifications management
    let qualifications: Array<{skillName: string, level: string}> = [];
    
    const renderQualifications = () => {
      const list = document.getElementById('qualificationsList')!;
      list.innerHTML = qualifications.map((q, i) => `
        <div style="display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: var(--color-bg-secondary); border-radius: 6px; margin-bottom: 6px;">
          <span style="color: ${q.level === 'expert' ? '#10b981' : q.level === 'advanced' ? '#3b82f6' : '#64748b'};">
            ${q.level === 'expert' ? '⭐' : q.level === 'advanced' ? '✓' : '○'}
          </span>
          <span style="flex: 1; font-size: 0.85rem;">${q.skillName}</span>
          <span style="font-size: 0.7rem; color: var(--color-text-muted);">${q.level === 'expert' ? 'Ekspert' : q.level === 'advanced' ? 'Zaawansowany' : 'Podstawowy'}</span>
          <button style="background: none; border: none; color: var(--color-danger); cursor: pointer; padding: 2px 6px;" onclick="this.parentElement.remove(); window._removeQual(${i});">✕</button>
        </div>
      `).join('') || '<p style="color: var(--color-text-muted); font-size: 0.8rem; text-align: center;">Brak dodanych kwalifikacji</p>';
    };
    
    (window as any)._removeQual = (index: number) => {
      qualifications.splice(index, 1);
      renderQualifications();
    };
    
    // Load existing qualifications
    api.getQualifications(employeeId).then(quals => {
      qualifications = quals.map((q: any) => ({ skillName: q.skillName, level: q.level }));
      renderQualifications();
    }).catch(() => renderQualifications());
    
    document.getElementById('addQualBtn')?.addEventListener('click', () => {
      const name = (document.getElementById('newQualName') as HTMLInputElement).value.trim();
      const level = (document.getElementById('newQualLevel') as HTMLSelectElement).value;
      if (name) {
        qualifications.push({ skillName: name, level });
        renderQualifications();
        (document.getElementById('newQualName') as HTMLInputElement).value = '';
      }
    });
    
    // Save handler
    document.getElementById('editDetailsSave')?.addEventListener('click', async () => {
      const details = {
        email: (document.getElementById('editEmpEmail') as HTMLInputElement).value,
        phone: (document.getElementById('editEmpPhone') as HTMLInputElement).value,
        position: (document.getElementById('editEmpPosition') as HTMLInputElement).value,
        department: (document.getElementById('editEmpDepartment') as HTMLInputElement).value,
        notes: (document.getElementById('editEmpNotes') as HTMLTextAreaElement).value,
      };
      
      await api.updateEmployeeDetails(employeeId, details);
      
      // Save qualifications
      for (const q of qualifications) {
        await api.setQualification({ employeeId, ...q });
      }
      
      overlay.remove();
      this.showEmployeeAbsenceModal(employeeId);
    });
    
    document.getElementById('editDetailsCancel')?.addEventListener('click', () => overlay.remove());
    overlay.querySelector('.absence-modal-close')?.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
  }
  
  private showEditAbsenceModal(absenceId: string): void {
    const absence = this.absences.find(a => a.id === absenceId);
    if (!absence) return;
    
    const emp = this.state.employees.find(e => e.id === absence.employeeId);
    
    const overlay = document.createElement('div');
    overlay.className = 'absence-modal-overlay';
    
    overlay.innerHTML = `
      <div class="absence-modal" style="max-width: 450px;">
        <div class="absence-modal-header">
          <h2>✏️ ${i18n.t('schedule.editAbsenceTitle')}</h2>
          <button class="absence-modal-close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div class="absence-modal-body">
          <div class="absence-form-group">
            <label class="absence-form-label">${i18n.t('schedule.absenceListEmployee')}</label>
            <input type="text" class="absence-form-input" value="${emp?.firstName} ${emp?.lastName}" disabled>
          </div>
          <div class="absence-form-group">
            <label class="absence-form-label">${i18n.t('schedule.absenceTypeLabel')}</label>
            <select class="absence-form-select" id="editType">
              ${this.absenceTypes.map(t => `<option value="${t.id}" ${t.id === absence.absenceTypeId ? 'selected' : ''}>${t.icon} ${t.name}</option>`).join('')}
            </select>
          </div>
          <div class="absence-form-row">
            <div class="absence-form-group">
              <label class="absence-form-label">${i18n.t('schedule.dateFrom')}</label>
              <input type="date" class="absence-form-input" id="editStartDate" value="${absence.startDate}">
            </div>
            <div class="absence-form-group">
              <label class="absence-form-label">${i18n.t('schedule.dateTo')}</label>
              <input type="date" class="absence-form-input" id="editEndDate" value="${absence.endDate}">
            </div>
          </div>
          <div class="absence-form-group">
            <label class="absence-form-label">${i18n.t('schedule.noteLabel')}</label>
            <textarea class="absence-form-textarea" id="editNote" rows="2">${absence.note || ''}</textarea>
          </div>
        </div>
        <div class="absence-modal-footer">
          <button class="absence-modal-btn danger" id="editDelete">${i18n.t('schedule.deleteBtn')}</button>
          <button class="absence-modal-btn secondary" id="editCancel">${i18n.t('schedule.cancel')}</button>
          <button class="absence-modal-btn primary" id="editSave">${i18n.t('schedule.save')}</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    
    // Save handler
    document.getElementById('editSave')?.addEventListener('click', async () => {
      const absenceTypeId = (document.getElementById('editType') as HTMLSelectElement).value;
      const startDate = (document.getElementById('editStartDate') as HTMLInputElement).value;
      const endDate = (document.getElementById('editEndDate') as HTMLInputElement).value;
      const note = (document.getElementById('editNote') as HTMLTextAreaElement).value;
      const workDays = this.calculateWorkDays(startDate, endDate);
      
      await api.updateAbsence(absenceId, {
        employeeId: absence.employeeId,
        absenceTypeId,
        startDate,
        endDate,
        workDays,
        status: 'approved',
        note
      });
      
      overlay.remove();
      await this.loadAbsenceData();
      this.renderAbsenceContent();
      this.renderAbsenceYearStats();
      this.renderAbsenceUpcoming();
      this.renderAbsenceEmployeesSidebar();
    });
    
    // Delete handler
    document.getElementById('editDelete')?.addEventListener('click', async () => {
      if (confirm(i18n.t('schedule.confirmDeleteAbsence'))) {
        await api.deleteAbsence(absenceId);
        overlay.remove();
        await this.loadAbsenceData();
        this.renderAbsenceContent();
        this.renderAbsenceYearStats();
        this.renderAbsenceUpcoming();
        this.renderAbsenceEmployeesSidebar();
      }
    });
    
    // Cancel/close handlers
    document.getElementById('editCancel')?.addEventListener('click', () => overlay.remove());
    overlay.querySelector('.absence-modal-close')?.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
  }
  
  private exportAbsences(): void {
    // Show export dropdown
    const existing = document.querySelector('.absence-export-dropdown');
    if (existing) { existing.remove(); return; }

    const btn = document.getElementById('absenceExportBtn');
    if (!btn) return;

    const dropdown = document.createElement('div');
    dropdown.className = 'absence-export-dropdown';
    dropdown.innerHTML = `
      <button class="absence-export-option" data-format="pdf">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
        <div>
          <span class="absence-export-option-title">PDF</span>
          <span class="absence-export-option-desc">${i18n.t('schedule.exportPdfDesc')}</span>
        </div>
      </button>
      <button class="absence-export-option" data-format="excel">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
        <div>
          <span class="absence-export-option-title">Excel</span>
          <span class="absence-export-option-desc">${i18n.t('schedule.exportExcelDesc')}</span>
        </div>
      </button>
    `;

    const rect = btn.getBoundingClientRect();
    dropdown.style.position = 'fixed';
    dropdown.style.top = `${rect.bottom + 4}px`;
    dropdown.style.right = `${window.innerWidth - rect.right}px`;
    dropdown.style.zIndex = '1000';
    document.body.appendChild(dropdown);

    dropdown.querySelector('[data-format="pdf"]')?.addEventListener('click', () => {
      dropdown.remove();
      this.exportAbsencesToPdf();
    });
    dropdown.querySelector('[data-format="excel"]')?.addEventListener('click', () => {
      dropdown.remove();
      this.exportAbsencesToExcel();
    });

    setTimeout(() => {
      document.addEventListener('click', function handler(e) {
        if (!dropdown.contains(e.target as Node)) {
          dropdown.remove();
          document.removeEventListener('click', handler);
        }
      });
    }, 10);
  }

  // ==================== ABSENCE PDF EXPORT ====================
  private async exportAbsencesToPdf(): Promise<void> {
    try {
      const dateLocale = i18n.getDateLocale();
      const dateStr = new Date().toLocaleDateString(dateLocale);
      const timeStr = new Date().toLocaleTimeString(dateLocale);
      const year = this.absenceYear;
      const employees = this.state.employees.filter(e => !e.status || e.status === 'available');
      const months = [
        i18n.t('planning.monthJan'), i18n.t('planning.monthFeb'), i18n.t('planning.monthMar'),
        i18n.t('planning.monthApr'), i18n.t('planning.monthMay'), i18n.t('planning.monthJun'),
        i18n.t('planning.monthJul'), i18n.t('planning.monthAug'), i18n.t('planning.monthSep'),
        i18n.t('planning.monthOct'), i18n.t('planning.monthNov'), i18n.t('planning.monthDec')
      ];

      this.showToast(i18n.t('schedule.exportGenerating'), 'success');

      // A4 landscape: 297mm x 210mm at 96dpi ~ 1123 x 794
      const pageWidth = 1123;
      const pageHeight = 794;
      const padding = 28;
      const contentWidth = pageWidth - padding * 2;
      const pages: HTMLDivElement[] = [];

      // Load employee details for HR data
      const empDetailsMap = new Map<string, any>();
      for (const emp of employees) {
        try {
          const details = await api.getEmployeeDetails(emp.id);
          if (details) empDetailsMap.set(emp.id, details);
        } catch { /* ignore */ }
      }

      const headerHtml = `
        <div style="background: #1a1a2e; color: #fff; padding: 16px ${padding}px; display: flex; justify-content: space-between; align-items: center;">
          <div>
            <h1 style="margin: 0; font-size: 22px; font-weight: 700; letter-spacing: 1px;">DRÄXLMAIER Group</h1>
            <p style="margin: 3px 0 0 0; font-size: 11px; opacity: 0.7;">Kappa Planning – ${i18n.t('schedule.absences')}</p>
          </div>
          <div style="text-align: right;">
            <p style="margin: 0; font-size: 13px; font-weight: 600;">${i18n.t('schedule.absences')} ${year}</p>
            <p style="margin: 2px 0 0 0; font-size: 10px; opacity: 0.7;">${i18n.t('schedule.absenceTimelineYearReport')}</p>
          </div>
        </div>
        <div style="background: #0097AC; color: #fff; padding: 6px ${padding}px; display: flex; justify-content: space-between; font-size: 9px;">
          <span><strong>${i18n.t('export.generatedAt')}:</strong> ${dateStr} ${timeStr}</span>
          <span><strong>${i18n.t('export.user')}:</strong> ${this.state.settings.userName || 'System'}</span>
        </div>
      `;

      const footerHtml = (pageNum: number, total: number) => `
        <div style="position: absolute; bottom: 8px; left: ${padding}px; right: ${padding}px; display: flex; justify-content: space-between; font-size: 8px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 6px;">
          <span>DRÄXLMAIER Group – Kappa Planning | ${i18n.t('schedule.absences')} ${year}</span>
          <span>${i18n.t('schedule.absenceTimelineYearReport')} | ${dateStr} | ${pageNum}/${total}</span>
        </div>
      `;

      // ---- PAGE 1: Statistics Overview ----
      const totalAbsences = this.absences.length;
      const totalDays = this.absences.reduce((s: number, a: any) => s + (a.workDays || 0), 0);
      const affectedEmployees = new Set(this.absences.map((a: any) => a.employeeId)).size;
      const avgPerEmp = employees.length > 0 ? (totalDays / employees.length).toFixed(1) : '0';
      const activeTypes = this.absenceTypes.filter((t: any) => t.isActive);

      // Per-type breakdown with more data
      const typeBreakdown = activeTypes.map((t: any) => {
        const typeAbs = this.absences.filter((a: any) => a.absenceTypeId === t.id);
        const typeDays = typeAbs.reduce((s: number, a: any) => s + (a.workDays || 0), 0);
        const typeEmps = new Set(typeAbs.map((a: any) => a.employeeId)).size;
        const avgDays = typeAbs.length > 0 ? (typeDays / typeAbs.length).toFixed(1) : '0';
        return `<tr>
          <td style="padding: 5px 8px; font-size: 10px; border-bottom: 1px solid #f1f5f9;">
            <div style="display: flex; align-items: center; gap: 6px;">
              <div style="width: 10px; height: 10px; border-radius: 3px; background: ${t.color}; flex-shrink: 0;"></div>
              ${t.icon} ${t.name}
            </div>
          </td>
          <td style="padding: 5px 6px; font-size: 10px; text-align: center; border-bottom: 1px solid #f1f5f9; font-weight: 600;">${typeDays}</td>
          <td style="padding: 5px 6px; font-size: 10px; text-align: center; border-bottom: 1px solid #f1f5f9;">${typeAbs.length}</td>
          <td style="padding: 5px 6px; font-size: 10px; text-align: center; border-bottom: 1px solid #f1f5f9;">${typeEmps}</td>
          <td style="padding: 5px 6px; font-size: 10px; text-align: center; border-bottom: 1px solid #f1f5f9;">${avgDays}</td>
        </tr>`;
      }).join('');

      // Per-employee summary table with HR data
      const empSummaryRows = employees.map((emp) => {
        const details = empDetailsMap.get(emp.id);
        const empAbs = this.absences.filter((a: any) => a.employeeId === emp.id);
        const usedDays = empAbs.reduce((s: number, a: any) => s + (a.workDays || 0), 0);
        const limitTotal = this.absenceLimits
          .filter((l: any) => l.employeeId === emp.id && l.year === year)
          .reduce((sum: number, l: any) => sum + (l.totalDays || 0), 0);
        const remaining = limitTotal - usedDays;
        const remColor = remaining < 0 ? '#dc2626' : remaining === 0 ? '#d97706' : '#16a34a';
        const percent = limitTotal > 0 ? Math.round((usedDays / limitTotal) * 100) : 0;
        
        return `<tr>
          <td style="padding: 5px 8px; font-size: 10px; border-bottom: 1px solid #f1f5f9;">
            <div style="display: flex; align-items: center; gap: 5px;">
              <div style="width: 18px; height: 18px; border-radius: 50%; background: ${emp.color || '#64748b'}; color: white; display: flex; align-items: center; justify-content: center; font-size: 7px; font-weight: 700; flex-shrink: 0;">${emp.firstName?.charAt(0) || ''}${emp.lastName?.charAt(0) || ''}</div>
              <span style="font-weight: 500;">${emp.firstName} ${emp.lastName}</span>
            </div>
          </td>
          <td style="padding: 5px 6px; font-size: 9px; text-align: center; border-bottom: 1px solid #f1f5f9; color: #64748b;">${details?.department || '–'}</td>
          <td style="padding: 5px 6px; font-size: 9px; text-align: center; border-bottom: 1px solid #f1f5f9; color: #64748b;">${details?.position || '–'}</td>
          <td style="padding: 5px 6px; font-size: 10px; text-align: center; border-bottom: 1px solid #f1f5f9; color: #3b82f6; font-weight: 600;">${limitTotal}</td>
          <td style="padding: 5px 6px; font-size: 10px; text-align: center; border-bottom: 1px solid #f1f5f9; font-weight: 600;">${usedDays}</td>
          <td style="padding: 5px 6px; font-size: 10px; text-align: center; border-bottom: 1px solid #f1f5f9; color: ${remColor}; font-weight: 700;">${remaining}</td>
          <td style="padding: 5px 6px; font-size: 9px; text-align: center; border-bottom: 1px solid #f1f5f9;">
            <div style="display: flex; align-items: center; gap: 4px;">
              <div style="flex: 1; height: 4px; background: #e2e8f0; border-radius: 2px; overflow: hidden;">
                <div style="height: 100%; width: ${Math.min(percent, 100)}%; background: ${percent > 90 ? '#dc2626' : percent > 70 ? '#d97706' : '#0097AC'}; border-radius: 2px;"></div>
              </div>
              <span style="font-size: 8px; color: #64748b; min-width: 24px;">${percent}%</span>
            </div>
          </td>
          <td style="padding: 5px 6px; font-size: 10px; text-align: center; border-bottom: 1px solid #f1f5f9;">${empAbs.length}</td>
        </tr>`;
      }).join('');

      const page1 = document.createElement('div');
      page1.style.cssText = `width: ${pageWidth}px; height: ${pageHeight}px; background: white; padding: 0; font-family: Inter, system-ui, sans-serif; position: relative; overflow: hidden;`;
      page1.innerHTML = `
        ${headerHtml}
        <div style="padding: ${padding}px;">
          <h2 style="margin: 0 0 14px 0; font-size: 16px; color: #1e293b;">${i18n.t('schedule.absenceTimelineYearReport')} ${year}</h2>
          <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 18px;">
            <div style="background: #f1f5f9; border-radius: 8px; padding: 12px; text-align: center; border-left: 3px solid #0097AC;">
              <div style="font-size: 24px; font-weight: 700; color: #0097AC;">${totalAbsences}</div>
              <div style="font-size: 9px; color: #64748b; margin-top: 2px; text-transform: uppercase; letter-spacing: 0.5px;">${i18n.t('schedule.absenceStatAbsences')}</div>
            </div>
            <div style="background: #f1f5f9; border-radius: 8px; padding: 12px; text-align: center; border-left: 3px solid #3b82f6;">
              <div style="font-size: 24px; font-weight: 700; color: #3b82f6;">${totalDays}</div>
              <div style="font-size: 9px; color: #64748b; margin-top: 2px; text-transform: uppercase; letter-spacing: 0.5px;">${i18n.t('schedule.absenceStatTotalDays')}</div>
            </div>
            <div style="background: #f1f5f9; border-radius: 8px; padding: 12px; text-align: center; border-left: 3px solid #8b5cf6;">
              <div style="font-size: 24px; font-weight: 700; color: #8b5cf6;">${affectedEmployees}</div>
              <div style="font-size: 9px; color: #64748b; margin-top: 2px; text-transform: uppercase; letter-spacing: 0.5px;">${i18n.t('schedule.absenceStatEmployees')}</div>
            </div>
            <div style="background: #f1f5f9; border-radius: 8px; padding: 12px; text-align: center; border-left: 3px solid #f59e0b;">
              <div style="font-size: 24px; font-weight: 700; color: #f59e0b;">${avgPerEmp}</div>
              <div style="font-size: 9px; color: #64748b; margin-top: 2px; text-transform: uppercase; letter-spacing: 0.5px;">${i18n.t('schedule.absenceTimelineAvgPerEmp')}</div>
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
            <!-- Left: Type breakdown -->
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
              <div style="padding: 8px 12px; background: #1e293b; color: white;">
                <h3 style="margin: 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;">${i18n.t('schedule.absenceTimelineByType')}</h3>
              </div>
              <table style="width: 100%; border-collapse: collapse;">
                <thead>
                  <tr style="background: #f1f5f9;">
                    <th style="padding: 5px 8px; text-align: left; font-size: 8px; text-transform: uppercase; color: #64748b; border-bottom: 1px solid #e2e8f0;">${i18n.t('schedule.absenceListType')}</th>
                    <th style="padding: 5px 6px; text-align: center; font-size: 8px; text-transform: uppercase; color: #64748b; border-bottom: 1px solid #e2e8f0;">${i18n.t('schedule.absenceListDays')}</th>
                    <th style="padding: 5px 6px; text-align: center; font-size: 8px; text-transform: uppercase; color: #64748b; border-bottom: 1px solid #e2e8f0;">${i18n.t('schedule.absenceStatAbsences')}</th>
                    <th style="padding: 5px 6px; text-align: center; font-size: 8px; text-transform: uppercase; color: #64748b; border-bottom: 1px solid #e2e8f0;">${i18n.t('schedule.absenceStatEmployees')}</th>
                    <th style="padding: 5px 6px; text-align: center; font-size: 8px; text-transform: uppercase; color: #64748b; border-bottom: 1px solid #e2e8f0;">Ø ${i18n.t('schedule.absenceListDays')}</th>
                  </tr>
                </thead>
                <tbody>${typeBreakdown}</tbody>
              </table>
            </div>

            <!-- Right: Monthly distribution -->
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
              <div style="padding: 8px 12px; background: #1e293b; color: white;">
                <h3 style="margin: 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;">${i18n.t('schedule.monthlyDistribution') || 'Rozkład miesięczny'}</h3>
              </div>
              <div style="padding: 10px 12px;">
                ${months.map((m, idx) => {
                  const monthStart = new Date(year, idx, 1);
                  const monthEnd = new Date(year, idx + 1, 0);
                  let monthDays = 0;
                  this.absences.forEach((a: any) => {
                    const s = new Date(a.startDate);
                    const e = new Date(a.endDate);
                    const os = s > monthStart ? s : monthStart;
                    const oe = e < monthEnd ? e : monthEnd;
                    if (os <= oe) {
                      const cur = new Date(os);
                      while (cur <= oe) { if (cur.getDay() !== 0 && cur.getDay() !== 6) monthDays++; cur.setDate(cur.getDate() + 1); }
                    }
                  });
                  const barWidth = totalDays > 0 ? Math.round((monthDays / totalDays) * 100) : 0;
                  return `<div style="display: flex; align-items: center; gap: 6px; margin-bottom: 3px;">
                    <span style="font-size: 8px; color: #64748b; width: 24px; text-align: right;">${m.substring(0, 3)}</span>
                    <div style="flex: 1; height: 6px; background: #e2e8f0; border-radius: 3px; overflow: hidden;">
                      <div style="height: 100%; width: ${barWidth}%; background: #0097AC; border-radius: 3px;"></div>
                    </div>
                    <span style="font-size: 8px; color: #334155; font-weight: 600; min-width: 16px; text-align: right;">${monthDays}</span>
                  </div>`;
                }).join('')}
              </div>
            </div>
          </div>
        </div>
        FOOTER_PLACEHOLDER_1
      `;
      pages.push(page1);

      // ---- PAGE 2: Employee Summary (VDA / HR compliant) ----
      const page2 = document.createElement('div');
      page2.style.cssText = `width: ${pageWidth}px; height: ${pageHeight}px; background: white; padding: 0; font-family: Inter, system-ui, sans-serif; position: relative; overflow: hidden;`;
      page2.innerHTML = `
        ${headerHtml}
        <div style="padding: ${padding}px;">
          <h2 style="margin: 0 0 14px 0; font-size: 16px; color: #1e293b;">👥 ${i18n.t('schedule.employeeSummary') || 'Podsumowanie pracowników'} – ${year}</h2>
          <table style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="background: #1e293b;">
                <th style="padding: 6px 8px; text-align: left; font-size: 8px; text-transform: uppercase; color: white; letter-spacing: 0.5px;">${i18n.t('schedule.absenceListEmployee')}</th>
                <th style="padding: 6px 6px; text-align: center; font-size: 8px; text-transform: uppercase; color: white; letter-spacing: 0.5px;">${i18n.t('schedule.department') || 'Dział'}</th>
                <th style="padding: 6px 6px; text-align: center; font-size: 8px; text-transform: uppercase; color: white; letter-spacing: 0.5px;">${i18n.t('schedule.position') || 'Stanowisko'}</th>
                <th style="padding: 6px 6px; text-align: center; font-size: 8px; text-transform: uppercase; color: white; letter-spacing: 0.5px;">${i18n.t('schedule.absenceEntitledDays')}</th>
                <th style="padding: 6px 6px; text-align: center; font-size: 8px; text-transform: uppercase; color: white; letter-spacing: 0.5px;">${i18n.t('schedule.absenceUsedDays')}</th>
                <th style="padding: 6px 6px; text-align: center; font-size: 8px; text-transform: uppercase; color: white; letter-spacing: 0.5px;">${i18n.t('schedule.absenceRemainingDays')}</th>
                <th style="padding: 6px 6px; text-align: center; font-size: 8px; text-transform: uppercase; color: white; letter-spacing: 0.5px;">${i18n.t('schedule.utilization') || 'Wykorzystanie'}</th>
                <th style="padding: 6px 6px; text-align: center; font-size: 8px; text-transform: uppercase; color: white; letter-spacing: 0.5px;">${i18n.t('schedule.absenceStatAbsences')}</th>
              </tr>
            </thead>
            <tbody>${empSummaryRows}</tbody>
          </table>

          <div style="margin-top: 16px; padding: 10px 14px; background: #fffbeb; border: 1px solid #fbbf24; border-radius: 6px; font-size: 9px; color: #92400e;">
            <strong>⚠️ ${i18n.t('schedule.vdaNotice') || 'Uwaga VDA/HR'}:</strong> 
            ${i18n.t('schedule.vdaNoticeText') || 'Dane dotyczące urlopów zgodne z wymogami VDA 6.3 (P6.3.2) – ewidencja czasu pracy. Urlop wypoczynkowy powinien być planowany równomiernie w ciągu roku. Pracownicy z pozostałym urlopem >5 dni powinni zaplanować wykorzystanie do końca Q4.'}
          </div>
        </div>
        FOOTER_PLACEHOLDER_2
      `;
      pages.push(page2);

      // ---- PAGE 3: Absence List (detailed) ----
      const page3 = document.createElement('div');
      page3.style.cssText = `width: ${pageWidth}px; min-height: ${pageHeight}px; background: white; padding: 0; font-family: Inter, system-ui, sans-serif; position: relative; overflow: hidden;`;
      page3.innerHTML = `
        ${headerHtml}
        <div style="padding: ${padding}px;">
          ${this.buildPdfListSection(employees, year)}
        </div>
        FOOTER_PLACEHOLDER_3
      `;
      pages.push(page3);

      // Render pages to PDF
      const totalPages = pages.length;
      pages.forEach((page, i) => {
        page.innerHTML = page.innerHTML.replace(`FOOTER_PLACEHOLDER_${i + 1}`, footerHtml(i + 1, totalPages));
        document.body.appendChild(page);
      });

      const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [pageWidth, pageHeight] });

      for (let p = 0; p < pages.length; p++) {
        const canvas = await html2canvas(pages[p], { scale: 2, useCORS: true, logging: false, backgroundColor: '#ffffff' });
        const imgData = canvas.toDataURL('image/png');
        if (p > 0) pdf.addPage([pageWidth, pageHeight], 'landscape');
        pdf.addImage(imgData, 'PNG', 0, 0, pageWidth, pageHeight);
      }

      pages.forEach(p => p.remove());
      pdf.save(`Absences_${year}_${dateStr.replace(/\./g, '-')}.pdf`);
      this.showToast(i18n.t('messages.exportSuccessfully'), 'success');
    } catch (e) {
      console.error('PDF export error:', e);
      this.showToast('Export failed', 'error');
    }
  }

  private buildPdfListSection(employees: any[], year: number): string {
    if (this.absences.length === 0) return `<p style="color: #94a3b8; text-align: center; padding: 20px;">${i18n.t('schedule.noAbsencesFound')}</p>`;

    const sorted = [...this.absences].sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
    const rows = sorted.map((a: any, idx: number) => {
      const emp = employees.find(e => e.id === a.employeeId) || this.state.employees.find(e => e.id === a.employeeId);
      const type = this.absenceTypes.find((t: any) => t.id === a.absenceTypeId);
      const startD = new Date(a.startDate);
      const endD = new Date(a.endDate);
      const start = startD.toLocaleDateString(i18n.getDateLocale(), { day: '2-digit', month: 'short', year: 'numeric' });
      const end = endD.toLocaleDateString(i18n.getDateLocale(), { day: '2-digit', month: 'short', year: 'numeric' });
      const weekday = startD.toLocaleDateString(i18n.getDateLocale(), { weekday: 'short' });
      const bg = idx % 2 === 0 ? '#f8fafc' : 'white';
      return `<tr style="background: ${bg};">
        <td style="padding: 5px 8px; font-size: 10px; border-bottom: 1px solid #f1f5f9;">
          <div style="display: flex; align-items: center; gap: 5px;">
            <div style="width: 18px; height: 18px; border-radius: 50%; background: ${emp?.color || '#64748b'}; color: white; display: flex; align-items: center; justify-content: center; font-size: 7px; font-weight: 700; flex-shrink: 0;">${emp?.firstName?.charAt(0) || ''}${emp?.lastName?.charAt(0) || ''}</div>
            <span style="font-weight: 500;">${emp?.firstName || ''} ${emp?.lastName || ''}</span>
          </div>
        </td>
        <td style="padding: 5px 8px; font-size: 10px; border-bottom: 1px solid #f1f5f9;">
          <div style="display: flex; align-items: center; gap: 4px;">
            <div style="width: 8px; height: 8px; border-radius: 2px; background: ${type?.color || '#64748b'}; flex-shrink: 0;"></div>
            ${type?.icon || ''} ${type?.name || ''}
          </div>
        </td>
        <td style="padding: 5px 8px; font-size: 10px; border-bottom: 1px solid #f1f5f9;">${weekday}, ${start}</td>
        <td style="padding: 5px 8px; font-size: 10px; border-bottom: 1px solid #f1f5f9;">${end}</td>
        <td style="padding: 5px 8px; font-size: 10px; text-align: center; border-bottom: 1px solid #f1f5f9; font-weight: 700; color: #0097AC;">${a.workDays}</td>
        <td style="padding: 5px 8px; font-size: 9px; border-bottom: 1px solid #f1f5f9; color: #64748b; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${a.note || '–'}</td>
      </tr>`;
    }).join('');

    return `
      <h3 style="margin: 0 0 10px 0; font-size: 14px; color: #1e293b;">📋 ${i18n.t('schedule.absenceHistory')} (${sorted.length})</h3>
      <table style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr style="background: #1e293b;">
            <th style="padding: 6px 8px; text-align: left; font-size: 8px; text-transform: uppercase; color: white; letter-spacing: 0.5px;">${i18n.t('schedule.absenceListEmployee')}</th>
            <th style="padding: 6px 8px; text-align: left; font-size: 8px; text-transform: uppercase; color: white; letter-spacing: 0.5px;">${i18n.t('schedule.absenceListType')}</th>
            <th style="padding: 6px 8px; text-align: left; font-size: 8px; text-transform: uppercase; color: white; letter-spacing: 0.5px;">${i18n.t('schedule.dateFrom')}</th>
            <th style="padding: 6px 8px; text-align: left; font-size: 8px; text-transform: uppercase; color: white; letter-spacing: 0.5px;">${i18n.t('schedule.dateTo')}</th>
            <th style="padding: 6px 8px; text-align: center; font-size: 8px; text-transform: uppercase; color: white; letter-spacing: 0.5px;">${i18n.t('schedule.absenceListDays')}</th>
            <th style="padding: 6px 8px; text-align: left; font-size: 8px; text-transform: uppercase; color: white; letter-spacing: 0.5px;">${i18n.t('schedule.noteLabel')}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  // ==================== ABSENCE EXCEL EXPORT ====================
  private async exportAbsencesToExcel(): Promise<void> {
    try {
      const year = this.absenceYear;
      const employees = this.state.employees.filter(e => !e.status || e.status === 'available');
      const months = [
        i18n.t('planning.monthJan'), i18n.t('planning.monthFeb'), i18n.t('planning.monthMar'),
        i18n.t('planning.monthApr'), i18n.t('planning.monthMay'), i18n.t('planning.monthJun'),
        i18n.t('planning.monthJul'), i18n.t('planning.monthAug'), i18n.t('planning.monthSep'),
        i18n.t('planning.monthOct'), i18n.t('planning.monthNov'), i18n.t('planning.monthDec')
      ];

      this.showToast(i18n.t('schedule.exportGenerating'), 'success');

      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Kappa Planning';
      workbook.created = new Date();

      const brandColor = 'FF0097AC';
      const black = 'FF000000';
      const white = 'FFFFFFFF';
      const lightGray = 'FFF1F5F9';
      const headerFont = { name: 'Calibri', size: 11, bold: true, color: { argb: white } };
      const subFont = { name: 'Calibri', size: 10, color: { argb: 'FF334155' } };
      const thinBorder: Partial<ExcelJS.Borders> = {
        top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
      };

      // ==================== SHEET 1: Overview ====================
      const overviewSheet = workbook.addWorksheet(i18n.t('schedule.absences'), {
        views: [{ state: 'frozen', xSplit: 0, ySplit: 4 }]
      });

      // Header - DRÄXLMAIER branding
      overviewSheet.mergeCells('A1:G1');
      const titleCell = overviewSheet.getCell('A1');
      titleCell.value = 'DRÄXLMAIER Group';
      titleCell.font = { name: 'Calibri', size: 18, bold: true, color: { argb: white } };
      titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: black } };
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
      overviewSheet.getRow(1).height = 35;

      overviewSheet.mergeCells('A2:G2');
      const subCell = overviewSheet.getCell('A2');
      subCell.value = `Kappa Planning – ${i18n.t('schedule.absences')} ${year}`;
      subCell.font = { name: 'Calibri', size: 13, bold: true, color: { argb: white } };
      subCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: brandColor } };
      subCell.alignment = { horizontal: 'center', vertical: 'middle' };
      overviewSheet.getRow(2).height = 28;

      overviewSheet.mergeCells('A3:G3');
      const infoCell = overviewSheet.getCell('A3');
      infoCell.value = `${i18n.t('export.generatedAt')}: ${new Date().toLocaleDateString(i18n.getDateLocale())} ${new Date().toLocaleTimeString(i18n.getDateLocale())} | ${i18n.t('export.user')}: ${this.state.settings.userName || 'System'}`;
      infoCell.font = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FF94A3B8' } };
      infoCell.alignment = { horizontal: 'center' };
      overviewSheet.getRow(3).height = 20;

      // Column headers
      const headers = [
        i18n.t('schedule.absenceListEmployee'),
        i18n.t('schedule.absenceListType'),
        i18n.t('schedule.dateFrom'),
        i18n.t('schedule.dateTo'),
        i18n.t('schedule.absenceListDays'),
        i18n.t('schedule.noteLabel'),
        i18n.t('schedule.absenceTypeLabel')
      ];
      overviewSheet.columns = [
        { width: 25 }, { width: 20 }, { width: 14 }, { width: 14 }, { width: 10 }, { width: 30 }, { width: 15 }
      ];

      const headerRow = overviewSheet.getRow(4);
      headers.forEach((h, i) => {
        const cell = headerRow.getCell(i + 1);
        cell.value = h;
        cell.font = headerFont;
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: brandColor } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = thinBorder;
      });
      headerRow.height = 24;

      // Data rows
      const sorted = [...this.absences].sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
      sorted.forEach((a: any, idx: number) => {
        const emp = this.state.employees.find(e => e.id === a.employeeId);
        const type = this.absenceTypes.find((t: any) => t.id === a.absenceTypeId);
        const row = overviewSheet.getRow(idx + 5);
        row.getCell(1).value = `${emp?.firstName || ''} ${emp?.lastName || ''}`;
        row.getCell(2).value = `${type?.icon || ''} ${type?.name || ''}`;
        row.getCell(3).value = a.startDate;
        row.getCell(4).value = a.endDate;
        row.getCell(5).value = a.workDays;
        row.getCell(6).value = a.note || '';
        row.getCell(7).value = type?.name || '';

        for (let c = 1; c <= 7; c++) {
          const cell = row.getCell(c);
          cell.font = subFont;
          cell.border = thinBorder;
          if (idx % 2 === 0) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: lightGray } };
        }
        row.getCell(5).alignment = { horizontal: 'center' };
      });

      // ==================== SHEET 2: Per Employee Summary ====================
      const empSheet = workbook.addWorksheet(i18n.t('schedule.absenceListEmployee'), {
        views: [{ state: 'frozen', xSplit: 1, ySplit: 3 }]
      });

      empSheet.mergeCells('A1:N1');
      empSheet.getCell('A1').value = 'DRÄXLMAIER Group';
      empSheet.getCell('A1').font = { name: 'Calibri', size: 16, bold: true, color: { argb: white } };
      empSheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: black } };
      empSheet.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
      empSheet.getRow(1).height = 30;

      empSheet.mergeCells('A2:N2');
      empSheet.getCell('A2').value = `${i18n.t('schedule.absenceListEmployee')} – ${i18n.t('schedule.absences')} ${year}`;
      empSheet.getCell('A2').font = { name: 'Calibri', size: 12, bold: true, color: { argb: white } };
      empSheet.getCell('A2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: brandColor } };
      empSheet.getCell('A2').alignment = { horizontal: 'center', vertical: 'middle' };
      empSheet.getRow(2).height = 26;

      // Headers: Employee, Jan, Feb, ... Dec, Total
      const empHeaders = [i18n.t('schedule.absenceListEmployee'), ...months, i18n.t('schedule.total')];
      empSheet.columns = [
        { width: 25 }, ...months.map(() => ({ width: 10 })), { width: 12 }
      ];
      const empHeaderRow = empSheet.getRow(3);
      empHeaders.forEach((h, i) => {
        const cell = empHeaderRow.getCell(i + 1);
        cell.value = h;
        cell.font = headerFont;
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: brandColor } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = thinBorder;
      });
      empHeaderRow.height = 22;

      employees.forEach((emp, idx) => {
        const row = empSheet.getRow(idx + 4);
        row.getCell(1).value = `${emp.firstName} ${emp.lastName}`;
        row.getCell(1).font = { name: 'Calibri', size: 10, bold: true };
        row.getCell(1).border = thinBorder;

        let empTotal = 0;
        for (let m = 0; m < 12; m++) {
          const monthStart = new Date(year, m, 1);
          const monthEnd = new Date(year, m + 1, 0);
          let days = 0;
          this.absences.filter((a: any) => a.employeeId === emp.id).forEach((a: any) => {
            const s = new Date(a.startDate);
            const e = new Date(a.endDate);
            const os = s > monthStart ? s : monthStart;
            const oe = e < monthEnd ? e : monthEnd;
            if (os <= oe) {
              const cur = new Date(os);
              while (cur <= oe) {
                if (cur.getDay() !== 0 && cur.getDay() !== 6) days++;
                cur.setDate(cur.getDate() + 1);
              }
            }
          });
          
          const cell = row.getCell(m + 2);
          cell.value = days || '';
          cell.font = subFont;
          cell.alignment = { horizontal: 'center' };
          cell.border = thinBorder;
          
          // Color coding
          if (days > 0) {
            const intensity = Math.min(days * 10, 80);
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${Math.round(255 - intensity * 0.6).toString(16).padStart(2, '0')}${Math.round(255 - intensity * 0.2).toString(16).padStart(2, '0')}${Math.round(255 - intensity * 0.6).toString(16).padStart(2, '0')}` } };
          } else if (idx % 2 === 0) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: lightGray } };
          }
          empTotal += days;
        }

        const totalCell = row.getCell(14);
        totalCell.value = empTotal;
        totalCell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF0097AC' } };
        totalCell.alignment = { horizontal: 'center' };
        totalCell.border = thinBorder;
        if (idx % 2 === 0) {
          row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: lightGray } };
        }
      });

      // ==================== SHEET 3: Per Type Breakdown ====================
      const typeSheet = workbook.addWorksheet(i18n.t('schedule.absenceTypeLabel'), {
        views: [{ state: 'frozen', xSplit: 0, ySplit: 3 }]
      });

      typeSheet.mergeCells('A1:E1');
      typeSheet.getCell('A1').value = 'DRÄXLMAIER Group';
      typeSheet.getCell('A1').font = { name: 'Calibri', size: 16, bold: true, color: { argb: white } };
      typeSheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: black } };
      typeSheet.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
      typeSheet.getRow(1).height = 30;

      typeSheet.mergeCells('A2:E2');
      typeSheet.getCell('A2').value = `${i18n.t('schedule.absenceTypeLabel')} – ${year}`;
      typeSheet.getCell('A2').font = { name: 'Calibri', size: 12, bold: true, color: { argb: white } };
      typeSheet.getCell('A2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: brandColor } };
      typeSheet.getCell('A2').alignment = { horizontal: 'center', vertical: 'middle' };
      typeSheet.getRow(2).height = 26;

      const typeHeaders = [i18n.t('schedule.absenceTypeLabel'), i18n.t('schedule.absenceStatAbsences'), i18n.t('schedule.absenceListDays'), i18n.t('schedule.absenceStatEmployees'), `Ø ${i18n.t('schedule.absenceListDays')}`];
      typeSheet.columns = [{ width: 25 }, { width: 14 }, { width: 14 }, { width: 16 }, { width: 14 }];
      const typeHeaderRow = typeSheet.getRow(3);
      typeHeaders.forEach((h, i) => {
        const cell = typeHeaderRow.getCell(i + 1);
        cell.value = h;
        cell.font = headerFont;
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: brandColor } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = thinBorder;
      });

      this.absenceTypes.filter((t: any) => t.isActive).forEach((t: any, idx: number) => {
        const typeAbs = this.absences.filter((a: any) => a.absenceTypeId === t.id);
        const typeDays = typeAbs.reduce((s: number, a: any) => s + (a.workDays || 0), 0);
        const typeEmps = new Set(typeAbs.map((a: any) => a.employeeId)).size;
        const avg = typeAbs.length > 0 ? (typeDays / typeAbs.length).toFixed(1) : '0';

        const row = typeSheet.getRow(idx + 4);
        row.getCell(1).value = `${t.icon} ${t.name}`;
        row.getCell(2).value = typeAbs.length;
        row.getCell(3).value = typeDays;
        row.getCell(4).value = typeEmps;
        row.getCell(5).value = parseFloat(avg);

        for (let c = 1; c <= 5; c++) {
          const cell = row.getCell(c);
          cell.font = subFont;
          cell.alignment = { horizontal: c === 1 ? 'left' : 'center' };
          cell.border = thinBorder;
          if (idx % 2 === 0) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: lightGray } };
        }
      });

      // Save
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      saveAs(blob, `Absences_${year}.xlsx`);
      this.showToast(i18n.t('messages.exportSuccessfully'), 'success');
    } catch (e) {
      console.error('Excel export error:', e);
      this.showToast('Export failed', 'error');
    }
  }
}

// Initialize
const app = new KappaApp();
app.init();
