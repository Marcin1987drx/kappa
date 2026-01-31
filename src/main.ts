import { i18n } from './i18n';
import { Customer, Type, Part, Test, Project, AppState, Employee, ScheduleEntry, ScheduleAssignment, ProjectComment } from './types';
import { Chart, registerables } from 'chart.js';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';

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

// ==================== IndexedDB Database ====================
class Database {
  private db: IDBDatabase | null = null;
  private readonly DB_NAME = 'KappaPlannungDB';
  private readonly DB_VERSION = 5;

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        if (!db.objectStoreNames.contains('customers')) {
          db.createObjectStore('customers', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('types')) {
          db.createObjectStore('types', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('parts')) {
          db.createObjectStore('parts', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('tests')) {
          db.createObjectStore('tests', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('projects')) {
          db.createObjectStore('projects', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('comments')) {
          db.createObjectStore('comments', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('logs')) {
          db.createObjectStore('logs', { keyPath: 'id' });
        }
        // New stores for Schedule module
        if (!db.objectStoreNames.contains('employees')) {
          db.createObjectStore('employees', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('scheduleEntries')) {
          db.createObjectStore('scheduleEntries', { keyPath: 'id' });
        }
        // New stores for enhanced Schedule (v5)
        if (!db.objectStoreNames.contains('scheduleAssignments')) {
          db.createObjectStore('scheduleAssignments', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('projectComments')) {
          db.createObjectStore('projectComments', { keyPath: 'id' });
        }
      };
    });
  }

  private getStore(storeName: string, mode: IDBTransactionMode = 'readonly'): IDBObjectStore {
    if (!this.db) throw new Error('Database not initialized');
    return this.db.transaction(storeName, mode).objectStore(storeName);
  }

  async getAll<T>(storeName: string): Promise<T[]> {
    return new Promise((resolve, reject) => {
      const request = this.getStore(storeName).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async get<T>(storeName: string, key: string): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      const request = this.getStore(storeName).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async put<T>(storeName: string, item: T): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = this.getStore(storeName, 'readwrite').put(item);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async delete(storeName: string, key: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = this.getStore(storeName, 'readwrite').delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async clear(storeName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = this.getStore(storeName, 'readwrite').clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
}

const db = new Database();

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

  async init(): Promise<void> {
    try {
      await db.init();
      await this.loadData();
      
      // Load pinned projects from localStorage
      this.loadPinnedProjects();
      
      // Load item tags from localStorage
      this.loadItemTags();
      
      // Load example data if database is empty
      if (this.state.projects.length === 0 && this.state.customers.length === 0) {
        await this.loadExampleData();
      }
      
      this.setupEventListeners();
      this.applyTheme();
      this.applyZoom();
      this.renderCurrentView();
      this.startAnimations();
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
    document.getElementById('importData')?.addEventListener('click', () => this.importData());

    // Toolbar collapse toggle
    document.getElementById('toggleToolbarExpand')?.addEventListener('click', () => {
      const toolbar = document.getElementById('planningToolbar');
      if (toolbar) {
        toolbar.classList.toggle('collapsed');
        // Save preference
        localStorage.setItem('toolbarCollapsed', toolbar.classList.contains('collapsed') ? 'true' : 'false');
      }
    });

    // Restore toolbar state
    const toolbarCollapsed = localStorage.getItem('toolbarCollapsed');
    if (toolbarCollapsed === 'true') {
      document.getElementById('planningToolbar')?.classList.add('collapsed');
    }

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
  private togglePin(projectId: string): void {
    if (this.pinnedProjects.has(projectId)) {
      this.pinnedProjects.delete(projectId);
    } else {
      this.pinnedProjects.add(projectId);
    }
    // Save pinned projects to localStorage
    localStorage.setItem('pinnedProjects', JSON.stringify([...this.pinnedProjects]));
    this.renderPlanningGrid();
  }
  
  // Load pinned projects from localStorage
  private loadPinnedProjects(): void {
    try {
      const saved = localStorage.getItem('pinnedProjects');
      if (saved) {
        this.pinnedProjects = new Set(JSON.parse(saved));
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
        break;
      case 'projects':
        this.renderProjectsView();
        break;
      case 'analytics':
        this.renderAnalyticsView();
        break;
      case 'schedule':
        this.renderScheduleView();
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
    const start = new Date(now.getFullYear(), 0, 1);
    const diff = now.getTime() - start.getTime();
    const oneWeek = 1000 * 60 * 60 * 24 * 7;
    return Math.floor(diff / oneWeek) + 1;
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
          pinBtn.title = isPinned ? 'Odepnij' : 'Przypnij na górze';
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
          progressBar.title = `Postęp: ${progressPercent}% (${totalIst}/${totalSoll})`;
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
      timeCell.title = 'Kliknij aby ustawić czas na 1 test';
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
    
    const statusName = statusType === 'stoppage' ? 'Postój projektu' : 'Brak części';
    const isActive = project.weeks[week][statusType];
    this.showToast(`${statusName}: ${isActive ? 'włączony' : 'wyłączony'}`, 'success');
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
            <span>Komentarz</span>
          </div>
          <p>${this.escapeHtml(comment.text)}</p>
        </div>
      `;
    }
    
    // Action buttons
    html += `
      <div class="cell-action-buttons">
        <button class="cell-action-btn action-comment ${comment ? 'active' : ''}" data-action="comment" title="Komentarz">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        </button>
        <button class="cell-action-btn action-stoppage ${weekData?.stoppage ? 'active' : ''}" data-action="stoppage" title="Postój projektu">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
          </svg>
        </button>
        <button class="cell-action-btn action-lack ${weekData?.productionLack ? 'active' : ''}" data-action="lack" title="Brak części">
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
    const statusText = percentage >= 100 ? 'Zakończone' : percentage > 0 ? 'W trakcie' : 'Nie rozpoczęte';
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
          Postój projektu
        </button>
        <button class="stoppage-option ${hasProductionLack ? 'active' : ''}" data-action="production-lack">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="1" y="3" width="15" height="13"/>
            <polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/>
            <circle cx="5.5" cy="18.5" r="2.5"/>
            <circle cx="18.5" cy="18.5" r="2.5"/>
          </svg>
          Brak produkcji (brak części)
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
        this.showToast('Status zaktualizowany', 'success');
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
        <label>Wartość:</label>
        <input type="number" id="cellValue" class="form-control" value="${currentValue}" min="0" autofocus />
      </div>
      <p class="hint"><svg viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2" width="14" height="14" style="display:inline;vertical-align:middle;margin-right:4px"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg> Tip: Lewy klik = +1, Prawy klik = -1</p>
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

    modalTitle.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18" style="display:inline;vertical-align:middle;margin-right:8px"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> Komentarz - ${week}`;
    
    modalBody.innerHTML = `
      <div class="form-group">
        <label>Komentarz:</label>
        <textarea id="commentText" class="form-control" rows="4" placeholder="Dodaj komentarz...">${existingComment?.text || ''}</textarea>
      </div>
      ${existingComment ? `<button id="deleteComment" class="btn btn-danger"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="display:inline;vertical-align:middle;margin-right:4px"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> Usuń komentarz</button>` : ''}
    `;

    document.getElementById('deleteComment')?.addEventListener('click', async () => {
      if (existingComment) {
        await db.delete('comments', existingComment.id);
        this.comments = this.comments.filter(c => c.id !== existingComment.id);
        this.hideModal();
        this.renderPlanningGrid();
        this.showToast('Komentarz usunięty', 'success');
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
        this.showToast('Komentarz zapisany', 'success');
      }
      
      this.hideModal();
      this.renderPlanningGrid();
    };

    modal.classList.add('active');
  }

  private showTimeEditPopup(project: Project, cell: HTMLElement): void {
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
      await db.put('projects', project);
      
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
          Kopiuj komentarze
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
      this.showToast(`Sortowanie: ${this.getSortColumnName(column)} (${this.sortDirection === 'asc' ? '↑' : '↓'})`, 'success');
    } else {
      this.showToast('Sortowanie wyłączone', 'success');
    }
  }

  private getSortColumnName(column: string): string {
    const names: { [key: string]: string } = {
      'customer': 'Klient',
      'type': 'Typ',
      'part': 'Część',
      'test': 'Test',
      'time': 'Czas'
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
    
    // Setup tabs
    this.setupProjectsTabs();
    
    // Render lists with extended info
    this.renderItemsListExtended('customers', this.state.customers);
    this.renderItemsListExtended('types', this.state.types);
    this.renderItemsListExtended('parts', this.state.parts);
    this.renderItemsListExtended('tests', this.state.tests);
    
    // Setup event listeners for new features
    this.setupProjectsEventListeners();
    
    // Render tree view
    this.renderProjectsTree();
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
      if (detailEl) detailEl.textContent = `${stat.used} używanych`;
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
      list.innerHTML = '<li class="empty-state">Brak elementów spełniających kryteria.</li>';
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
          <button class="btn-delete" title="Usuń">
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
    this.showToast('Kolejność zmieniona', 'success');
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
    noTag.title = 'Usuń tag';
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
  
  private saveItemTags(): void {
    localStorage.setItem('itemTags', JSON.stringify([...this.itemTags]));
  }
  
  private loadItemTags(): void {
    try {
      const saved = localStorage.getItem('itemTags');
      if (saved) {
        this.itemTags = new Map(JSON.parse(saved));
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
      btn.querySelector('span')!.textContent = totalSelected > 0 ? `Usuń zaznaczone (${totalSelected})` : 'Usuń zaznaczone';
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
    
    // Export/Import CSV
    document.getElementById('exportProjectsCSV')?.addEventListener('click', () => this.exportAllProjectsCSV());
    document.getElementById('importProjectsCSV')?.addEventListener('click', () => this.importProjectsCSV());
    
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
    
    if (!confirm(`Czy na pewno chcesz usunąć ${totalSelected} zaznaczonych elementów?`)) return;
    
    for (const [type, ids] of this.selectedItems) {
      for (const id of ids) {
        await this.deleteItem(type, id, false);
      }
      ids.clear();
    }
    
    await this.loadData();
    this.renderProjectsView();
    this.showToast(`Usunięto ${totalSelected} elementów`, 'success');
  }
  
  private exportCategoryCSV(type: string): void {
    const items = (this.state as any)[type] as any[];
    let csv = 'Nazwa,Data utworzenia,Liczba projektów\n';
    
    items.forEach(item => {
      const usage = this.getItemUsageCount(type, item.id);
      const date = item.createdAt ? new Date(item.createdAt).toLocaleDateString('pl-PL') : '-';
      csv += `"${item.name}","${date}",${usage}\n`;
    });
    
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${type}_export_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    
    this.showToast(`Eksportowano ${type}`, 'success');
  }
  
  private exportAllProjectsCSV(): void {
    let csv = 'Kategoria,Nazwa,Data utworzenia,Liczba projektów\n';
    
    ['customers', 'types', 'parts', 'tests'].forEach(type => {
      const items = (this.state as any)[type] as any[];
      items.forEach(item => {
        const usage = this.getItemUsageCount(type, item.id);
        const date = item.createdAt ? new Date(item.createdAt).toLocaleDateString('pl-PL') : '-';
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
    
    this.showToast('Eksportowano wszystkie kategorie', 'success');
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
        this.showToast(`Zaimportowano ${imported} elementów`, 'success');
      } else {
        this.showToast('Brak nowych elementów do zaimportowania', 'warning');
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
          <p>Brak projektów do wyświetlenia w drzewie.</p>
          <p style="font-size: 0.85rem; margin-top: 8px;">Dodaj projekty w widoku <strong>Planning</strong></p>
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
  }

  private analyticsOptionsUnlocked: boolean = false;
  private projectStoppages: Map<string, Set<string>> = new Map(); // projectId -> Set of weeks
  private analyticsWeekFrom: number = 1;
  private analyticsWeekTo: number = 52;

  private setupAnalyticsEventListeners(): void {
    // Initialize week filter dropdowns
    this.initWeekFilters();
    
    // Unlock options button
    document.getElementById('unlockAnalyticsOptions')?.addEventListener('click', async () => {
      if (this.state.settings.deletePassword) {
        const password = prompt('Wprowadź hasło aby odblokować opcje:');
        if (password !== this.state.settings.deletePassword) {
          this.showToast('Nieprawidłowe hasło', 'error');
          return;
        }
      }
      this.analyticsOptionsUnlocked = !this.analyticsOptionsUnlocked;
      this.toggleAnalyticsOptions();
    });

    // Export analytics button
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
      yearInfo.textContent = `Rok ${this.state.selectedYear} | Aktualny tydzień: KW${currentWeek.toString().padStart(2, '0')}`;
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
      yearInfo.textContent = `Rok ${this.state.selectedYear} | Aktualny tydzień: KW${currentWeek.toString().padStart(2, '0')}`;
    }
  }

  private applyAnalyticsDateFilter(): void {
    const fromSelect = document.getElementById('analyticsWeekFrom') as HTMLSelectElement;
    const toSelect = document.getElementById('analyticsWeekTo') as HTMLSelectElement;
    
    if (!fromSelect || !toSelect) return;
    
    const fromWeek = parseInt(fromSelect.value) || 1;
    const toWeek = parseInt(toSelect.value) || 52;
    
    if (fromWeek > toWeek) {
      this.showToast('Data "Od" nie może być późniejsza niż "Do"', 'error');
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
    // Use ONLY year-prefixed key (e.g., "2026-KW05") - no fallback to old keys
    // This ensures each year has its own separate data
    const yearWeekKey = `${this.state.selectedYear}-${weekKey}`;
    return project.weeks[yearWeekKey] || { ist: 0, soll: 0 };
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

  private renderAnalyticsTable(): void {
    const tbody = document.getElementById('analyticsTableBody');
    if (!tbody) return;

    const filterStatus = (document.getElementById('analyticsFilterStatus') as HTMLSelectElement)?.value || 'all';

    tbody.innerHTML = '';

    this.state.projects.forEach((project) => {
      const customer = this.state.customers.find(c => c.id === project.customer_id);
      const type = this.state.types.find(t => t.id === project.type_id);
      const part = this.state.parts.find(p => p.id === project.part_id);
      const test = this.state.tests.find(t => t.id === project.test_id);

      let totalIst = 0;
      let totalSoll = 0;
      let hasStoppage = this.projectStoppages.has(project.id);

      // Use year-aware week data lookup
      for (let w = 1; w <= 52; w++) {
        const weekKey = `KW${w.toString().padStart(2, '0')}`;
        // Apply week filter
        if (!this.isWeekInFilter(weekKey)) continue;
        const data = this.getWeekData(project, weekKey);
        totalIst += data.ist;
        totalSoll += data.soll;
      }

      const percentage = totalSoll > 0 ? Math.round((totalIst / totalSoll) * 100) : 0;
      
      // Determine status
      let status: 'complete' | 'partial' | 'zero' | 'stoppage' = 'zero';
      if (hasStoppage) {
        status = 'stoppage';
      } else if (totalSoll === 0) {
        status = 'zero';
      } else if (totalIst >= totalSoll) {
        status = 'complete';
      } else if (totalIst > 0) {
        status = 'partial';
      }

      // Apply filter
      if (filterStatus !== 'all' && filterStatus !== status) return;

      const tr = document.createElement('tr');
      tr.dataset.projectId = project.id;
      
      tr.innerHTML = `
        <td class="td-sticky">${customer?.name || '-'}</td>
        <td>${type?.name || '-'}</td>
        <td>${part?.name || '-'}</td>
        <td>
          <span class="test-badge" style="background: ${(test as any)?.color || '#0097AC'}">
            ${test?.name || '-'}
          </span>
        </td>
        <td class="status-cell">
          ${this.getStatusSvg(status)}
        </td>
        <td class="ist-cell">${totalIst}</td>
        <td class="soll-cell">${totalSoll}</td>
        <td class="percentage-cell ${percentage >= 100 ? 'pct-100' : percentage > 0 ? 'pct-partial' : 'pct-zero'}">
          ${totalSoll > 0 ? percentage + '%' : '-'}
        </td>
        <td class="analytics-options-col ${this.analyticsOptionsUnlocked ? '' : 'hidden'}">
          <div class="options-cell">
            <button class="btn-option btn-stoppage ${hasStoppage ? 'active' : ''}" title="Oznacz postój" data-project-id="${project.id}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
              </svg>
            </button>
            <button class="btn-option btn-details" title="Szczegóły" data-project-id="${project.id}">
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
        <h4>🚫 Postój projektu</h4>
        <button class="stoppage-popup-close">✕</button>
      </div>
      <div class="stoppage-options">
        <button class="stoppage-option ${stoppages.has(`KW${currentWeek.toString().padStart(2, '0')}`) ? 'active' : ''}" data-week="${currentWeek}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
          </svg>
          Brak produkcji w bieżącym tygodniu (KW${currentWeek.toString().padStart(2, '0')})
        </button>
        <button class="stoppage-option ${stoppages.size > 0 ? 'active' : ''}" data-action="toggle-all">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <line x1="9" y1="9" x2="15" y2="15"/>
            <line x1="15" y1="9" x2="9" y2="15"/>
          </svg>
          ${stoppages.size > 0 ? 'Usuń oznaczenie postoju' : 'Oznacz projekt jako wstrzymany'}
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

  private renderCharts(): void {
    this.renderWeeklyChart();
    this.renderTestChart();
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

  private importData(): void {
    this.showImportWizard();
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
    if (!confirm('Usunąć WSZYSTKIE dane?')) return;
    if (!confirm('NA PEWNO? Nie da się tego cofnąć!')) return;

    for (const store of ['customers', 'types', 'parts', 'tests', 'projects', 'comments']) {
      await db.clear(store);
    }

    await this.loadData();
    this.renderCurrentView();
    this.showToast('Dane usunięte!', 'success');
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
  private draggedEmployeeId: string | null = null;
  
  private renderScheduleView(): void {
    this.setupScheduleEventListeners();
    this.renderScheduleWeekNav();
    this.renderScheduleEmployeePanel();
    this.renderScheduleProjectsPanel();
  }
  
  private setupScheduleEventListeners(): void {
    // Shift toggle buttons
    document.querySelectorAll('.shift-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        const shift = parseInt((btn as HTMLElement).dataset.shift || '2') as 1 | 2 | 3;
        this.scheduleShiftSystem = shift;
        document.querySelectorAll('.shift-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.renderScheduleProjectsPanel();
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
      this.renderScheduleProjectsPanel();
    });
    
    document.getElementById('scheduleNextWeek')?.addEventListener('click', () => {
      this.scheduleCurrentWeek++;
      if (this.scheduleCurrentWeek > 52) {
        this.scheduleCurrentWeek = 1;
        this.scheduleCurrentYear++;
      }
      this.renderScheduleWeekNav();
      this.renderScheduleProjectsPanel();
    });
    
    document.getElementById('scheduleToday')?.addEventListener('click', () => {
      this.scheduleCurrentWeek = this.getCurrentWeek();
      this.scheduleCurrentYear = new Date().getFullYear();
      this.renderScheduleWeekNav();
      this.renderScheduleProjectsPanel();
    });
    
    document.getElementById('scheduleCopyPrev')?.addEventListener('click', () => this.copyFromPreviousWeek());
    document.getElementById('addEmployeeQuick')?.addEventListener('click', () => this.showAddEmployeeModal());
    document.getElementById('manageEmployees')?.addEventListener('click', () => this.showManageEmployeesModal());
  }
  
  private renderScheduleWeekNav(): void {
    const weekLabel = document.getElementById('scheduleWeekLabel');
    const weekDates = document.getElementById('scheduleWeekDates');
    
    if (weekLabel) {
      weekLabel.textContent = `KW${this.scheduleCurrentWeek.toString().padStart(2, '0')}`;
    }
    
    if (weekDates) {
      const dates = this.getWeekDateRange(this.scheduleCurrentYear, this.scheduleCurrentWeek);
      // Shorter format for compact display
      weekDates.textContent = `${dates.start.slice(0, 5)} - ${dates.end.slice(0, 5)}`;
    }
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
  
  private renderScheduleEmployeePanel(): void {
    const container = document.getElementById('employeeDragList');
    if (!container) return;
    
    if (this.state.employees.length === 0) {
      container.innerHTML = `
        <div class="schedule-empty" style="padding: 20px;">
          <p style="font-size: 0.85rem;">Brak pracowników</p>
          <button class="btn-secondary btn-sm" onclick="window.kappaApp.showAddEmployeeModal()">+ Dodaj</button>
        </div>
      `;
      (window as any).kappaApp = this;
      return;
    }
    
    container.innerHTML = this.state.employees.map(emp => `
      <div class="employee-drag-item" draggable="true" data-employee-id="${emp.id}">
        <span class="emp-color" style="background-color: ${emp.color}"></span>
        <span class="emp-name">${emp.firstName} ${emp.lastName}</span>
      </div>
    `).join('');
    
    // Add drag events
    container.querySelectorAll('.employee-drag-item').forEach(item => {
      item.addEventListener('dragstart', (e) => {
        this.draggedEmployeeId = (item as HTMLElement).dataset.employeeId || null;
        (item as HTMLElement).classList.add('dragging');
        (e as DragEvent).dataTransfer?.setData('text/plain', this.draggedEmployeeId || '');
      });
      item.addEventListener('dragend', () => {
        (item as HTMLElement).classList.remove('dragging');
        this.draggedEmployeeId = null;
      });
    });
    
    (window as any).kappaApp = this;
  }
  
  private renderScheduleProjectsPanel(): void {
    const headerContainer = document.getElementById('scheduleShiftsHeader');
    const projectsContainer = document.getElementById('scheduleProjectsList');
    
    if (!headerContainer || !projectsContainer) return;
    
    const weekKey = `${this.scheduleCurrentYear}-KW${this.scheduleCurrentWeek.toString().padStart(2, '0')}`;
    
    // Render clean header
    headerContainer.className = `table-header shifts-${this.scheduleShiftSystem}`;
    let headerHtml = '<div class="col-header">Projekt</div>';
    for (let s = 1; s <= this.scheduleShiftSystem; s++) {
      headerHtml += `<div class="col-header shift-col shift-${s}">Zmiana ${s}</div>`;
    }
    headerContainer.innerHTML = headerHtml;
    
    // Get projects with SOLL > 0 in current week
    const weekProjects = this.state.projects.filter(p => {
      const weekData = p.weeks[weekKey];
      return weekData && weekData.soll > 0;
    });
    
    if (weekProjects.length === 0) {
      projectsContainer.innerHTML = `
        <div class="schedule-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="40" height="40">
            <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
          </svg>
          <p>Brak projektów z SOLL w tym tygodniu</p>
        </div>
      `;
      return;
    }
    
    // Group projects by Customer + Type
    const projectGroups = new Map<string, {
      customerName: string;
      typeName: string;
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
      
      // Main row
      const row = document.createElement('div');
      row.className = `project-row shifts-${this.scheduleShiftSystem}`;
      
      // Project cell
      const projectCell = document.createElement('div');
      projectCell.className = 'project-cell';
      projectCell.innerHTML = `
        <svg class="expand-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
        <div class="project-info">
          <div class="project-name">${projectGroup.customerName} – ${projectGroup.typeName}</div>
          <div class="project-meta">
            <span>${partsCount} część${partsCount > 4 ? 'i' : partsCount > 1 ? 'i' : ''}</span>
            <span class="soll">SOLL ${projectGroup.totalSoll}</span>
          </div>
        </div>
        <button class="project-comment-btn ${comment ? 'has-comment' : ''}" title="${comment || 'Komentarz'}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        </button>
      `;
      
      projectCell.querySelector('.project-comment-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showProjectCommentModal(groupKey, weekKey, comment);
      });
      
      projectCell.addEventListener('click', () => {
        projectCell.classList.toggle('expanded');
        const details = row.nextElementSibling;
        details?.classList.toggle('expanded');
      });
      
      row.appendChild(projectCell);
      
      // Drop zones for each shift
      for (let s = 1; s <= this.scheduleShiftSystem; s++) {
        const dropZone = this.createDropZone(groupKey, undefined, weekKey, s as 1 | 2 | 3, true);
        row.appendChild(dropZone);
      }
      
      projectsContainer.appendChild(row);
      
      // Details row (expandable) - simpler structure
      const detailsRow = document.createElement('div');
      detailsRow.className = 'project-details-row';
      
      const detailsContent = document.createElement('div');
      detailsContent.className = 'details-content';
      
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
        const testGroup = document.createElement('div');
        testGroup.className = 'test-group';
        
        testGroup.innerHTML = `
          <div class="test-label">
            <span class="test-dot" style="background:${test.color || '#0097AC'}"></span>
            ${test.name}
          </div>
        `;
        
        const partGrid = document.createElement('div');
        partGrid.className = `part-grid shifts-${this.scheduleShiftSystem}`;
        
        parts.forEach(({ part, projectId, soll }) => {
          const partItem = document.createElement('div');
          partItem.className = 'part-item';
          
          const partName = document.createElement('div');
          partName.className = 'part-name';
          partName.textContent = `${part.name} (${soll})`;
          partItem.appendChild(partName);
          
          for (let s = 1; s <= this.scheduleShiftSystem; s++) {
            const dropZone = this.createDropZone(projectId, test.id, weekKey, s as 1 | 2 | 3, false);
            dropZone.className = 'part-drop';
            partItem.appendChild(dropZone);
          }
          
          partGrid.appendChild(partItem);
        });
        
        testGroup.appendChild(partGrid);
        detailsContent.appendChild(testGroup);
      });
      
      detailsRow.appendChild(detailsContent);
      projectsContainer.appendChild(detailsRow);
    });
  }
  
  private createDropZone(projectId: string, testId: string | undefined, week: string, shift: 1 | 2 | 3, isGroupLevel: boolean = false): HTMLElement {
    const zone = document.createElement('div');
    zone.className = `drop-zone shift-${shift}`;
    zone.dataset.projectId = projectId;
    zone.dataset.week = week;
    zone.dataset.shift = shift.toString();
    if (testId) zone.dataset.testId = testId;
    
    // Get assignments for this zone
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
      
      const chip = document.createElement('div');
      chip.className = 'emp-chip';
      chip.style.backgroundColor = emp.color + '22';
      chip.style.color = emp.color;
      chip.innerHTML = `
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
        await this.addAssignment(projectId, testId, this.draggedEmployeeId, week, shift);
      }
    });
    
    return zone;
  }
  
  private async addAssignment(projectId: string, testId: string | undefined, employeeId: string, week: string, shift: 1 | 2 | 3): Promise<void> {
    // Check if already exists
    const exists = this.state.scheduleAssignments.find((a: ScheduleAssignment) =>
      a.projectId === projectId &&
      a.employeeId === employeeId &&
      a.week === week &&
      a.shift === shift &&
      (testId ? a.testId === testId : !a.testId)
    );
    
    if (exists) {
      this.showToast('Ten pracownik jest już przypisany', 'warning');
      return;
    }
    
    const assignment: ScheduleAssignment = {
      id: this.generateId(),
      projectId,
      testId,
      employeeId,
      week,
      shift,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    
    this.state.scheduleAssignments.push(assignment);
    await db.put('scheduleAssignments', assignment);
    
    const emp = this.state.employees.find(e => e.id === employeeId);
    await this.addLog('created', 'Assignment', `${emp?.firstName || ''} → ${week} Z${shift}`);
    
    this.renderScheduleProjectsPanel();
  }
  
  private async removeAssignment(assignmentId: string): Promise<void> {
    const idx = this.state.scheduleAssignments.findIndex((a: ScheduleAssignment) => a.id === assignmentId);
    if (idx !== -1) {
      this.state.scheduleAssignments.splice(idx, 1);
      await db.delete('scheduleAssignments', assignmentId);
      await this.addLog('deleted', 'Assignment', assignmentId);
      this.renderScheduleProjectsPanel();
    }
  }
  
  private getProjectComment(projectId: string, week: string): string | undefined {
    const comment = this.state.projectComments.find((c: ProjectComment) =>
      c.projectId === projectId && c.week === week
    );
    return comment?.comment;
  }
  
  private showProjectCommentModal(projectId: string, week: string, existingComment?: string): void {
    const modal = document.getElementById('modal')!;
    const modalTitle = document.getElementById('modalTitle')!;
    const modalBody = document.getElementById('modalBody')!;
    
    modalTitle.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18" style="display:inline;vertical-align:middle;margin-right:8px">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
      Komentarz do projektu
    `;
    
    modalBody.innerHTML = `
      <div class="form-group">
        <label>Komentarz:</label>
        <textarea id="projectCommentText" class="form-control" rows="4" placeholder="Np. priorytet, uwagi...">${existingComment || ''}</textarea>
      </div>
    `;
    
    const confirmBtn = modal.querySelector('.modal-confirm') as HTMLButtonElement;
    confirmBtn.style.display = '';
    confirmBtn.onclick = async () => {
      const text = (document.getElementById('projectCommentText') as HTMLTextAreaElement).value.trim();
      
      // Find existing
      const existing = this.state.projectComments.find((c: ProjectComment) =>
        c.projectId === projectId && c.week === week
      );
      
      if (text) {
        if (existing) {
          existing.comment = text;
          existing.updatedAt = Date.now();
          await db.put('projectComments', existing);
        } else {
          const newComment: ProjectComment = {
            id: this.generateId(),
            projectId,
            week,
            comment: text,
            createdAt: Date.now(),
            updatedAt: Date.now()
          };
          this.state.projectComments.push(newComment);
          await db.put('projectComments', newComment);
        }
      } else if (existing) {
        // Remove if empty
        const idx = this.state.projectComments.indexOf(existing);
        this.state.projectComments.splice(idx, 1);
        await db.delete('projectComments', existing.id);
      }
      
      this.hideModal();
      this.renderScheduleProjectsPanel();
    };
    
    modal.classList.add('active');
  }
  
  private async copyFromPreviousWeek(): Promise<void> {
    const prevWeek = this.scheduleCurrentWeek === 1 ? 52 : this.scheduleCurrentWeek - 1;
    const prevYear = this.scheduleCurrentWeek === 1 ? this.scheduleCurrentYear - 1 : this.scheduleCurrentYear;
    const prevWeekKey = `${prevYear}-KW${prevWeek.toString().padStart(2, '0')}`;
    const currentWeekKey = `${this.scheduleCurrentYear}-KW${this.scheduleCurrentWeek.toString().padStart(2, '0')}`;
    
    const prevAssignments = this.state.scheduleAssignments.filter((a: ScheduleAssignment) => a.week === prevWeekKey);
    
    if (prevAssignments.length === 0) {
      this.showToast('Brak przypisań w poprzednim tygodniu', 'warning');
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
    
    this.showToast(`Skopiowano ${copied} przypisań z ${prevWeekKey}`, 'success');
    this.renderScheduleProjectsPanel();
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
    this.renderScheduleProjectsPanel();
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
        this.showToast('Ten pracownik jest już przypisany do tego projektu w tym tygodniu', 'warning');
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
      
      if (!firstName || !lastName) {
        this.showToast(i18n.t('messages.errorOccurred'), 'error');
        return;
      }
      
      if (isEdit && employee) {
        employee.firstName = firstName;
        employee.lastName = lastName;
        employee.color = color;
        await db.put('employees', employee);
        await this.addLog('updated', 'Employee', `${firstName} ${lastName}`);
      } else {
        const newEmployee: Employee = {
          id: this.generateId(),
          firstName,
          lastName,
          color,
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
          <div style="background: var(--color-bg-secondary); border-radius: 12px; padding: 16px; border: 1px solid var(--color-border);">
            <div style="display: flex; justify-content: space-between; margin-bottom: 12px;">
              <strong>${name}</strong>
              <span style="font-size: 0.75rem; padding: 2px 8px; background: var(--color-primary-subtle); border-radius: 12px;">${data.count} projects</span>
            </div>
            <div style="display: flex; gap: 12px; margin-bottom: 12px;">
              <div style="flex: 1; text-align: center; padding: 8px; background: var(--color-bg-primary); border-radius: 8px;">
                <div style="font-size: 1.25rem; font-weight: 700;">${data.ist}</div>
                <div style="font-size: 0.7rem; color: var(--color-text-muted);">IST</div>
              </div>
              <div style="flex: 1; text-align: center; padding: 8px; background: var(--color-bg-primary); border-radius: 8px;">
                <div style="font-size: 1.25rem; font-weight: 700;">${data.soll}</div>
                <div style="font-size: 0.7rem; color: var(--color-text-muted);">SOLL</div>
              </div>
              <div style="flex: 1; text-align: center; padding: 8px; background: var(--color-bg-primary); border-radius: 8px;">
                <div style="font-size: 1.25rem; font-weight: 700;">${rate}%</div>
                <div style="font-size: 0.7rem; color: var(--color-text-muted);">Rate</div>
              </div>
            </div>
            <div style="height: 8px; background: var(--color-border); border-radius: 4px; overflow: hidden;">
              <div style="height: 100%; width: ${Math.min(rate, 100)}%; background: ${color}; border-radius: 4px;"></div>
            </div>
          </div>`;
      });
      customerGrid.innerHTML = html || '<p style="padding: 20px; color: var(--color-text-muted);">No customer data</p>';
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
          <div style="display: grid; grid-template-columns: 120px 1fr auto; align-items: center; gap: 16px; margin-bottom: 12px;">
            <div style="font-weight: 500;">${d.name}</div>
            <div style="height: 24px; background: var(--color-bg-secondary); border-radius: 12px; overflow: hidden;">
              <div style="height: 100%; width: ${width}%; background: ${d.color}; border-radius: 12px; display: flex; align-items: center; justify-content: flex-end; padding-right: 8px; min-width: 40px;">
                <span style="font-size: 0.7rem; font-weight: 600; color: white;">${rate}%</span>
              </div>
            </div>
            <div style="font-weight: 600; min-width: 80px; text-align: right;">${d.ist} / ${d.soll}</div>
          </div>`;
      });
      testBars.innerHTML = html || '<p style="padding: 20px; color: var(--color-text-muted);">No test data</p>';
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
        <div style="display: flex; align-items: center; gap: 12px; padding: 12px; background: var(--color-bg-secondary); border-radius: 8px; margin-bottom: 8px; border-left: 3px solid ${isTop ? '#10B981' : '#EF4444'};">
          <div style="width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 700; background: ${isTop ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)'}; color: ${isTop ? '#10B981' : '#EF4444'};">${i + 1}</div>
          <div style="flex: 1; min-width: 0;">
            <div style="font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${p.name}</div>
            <div style="font-size: 0.75rem; color: var(--color-text-muted);">${p.ist}/${p.soll}</div>
          </div>
          <div style="font-weight: 700; color: ${isTop ? '#10B981' : '#EF4444'};">${p.rate}%</div>
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
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; padding: 20px;">
          <div style="text-align: center; padding: 16px; background: var(--color-bg-secondary); border-radius: 12px;">
            <div style="width: 40px; height: 40px; margin: 0 auto 8px; border-radius: 50%; background: rgba(239,68,68,0.1); display: flex; align-items: center; justify-content: center;">
              <svg viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2" width="20" height="20"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
            </div>
            <div style="font-size: 2rem; font-weight: 700;">${stoppage}</div>
            <div style="font-size: 0.75rem; color: var(--color-text-muted);">STOPPAGE (${total > 0 ? Math.round((stoppage/total)*100) : 0}%)</div>
          </div>
          <div style="text-align: center; padding: 16px; background: var(--color-bg-secondary); border-radius: 12px;">
            <div style="width: 40px; height: 40px; margin: 0 auto 8px; border-radius: 50%; background: rgba(245,158,11,0.1); display: flex; align-items: center; justify-content: center;">
              <svg viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2" width="20" height="20"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            </div>
            <div style="font-size: 2rem; font-weight: 700;">${prodLack}</div>
            <div style="font-size: 0.75rem; color: var(--color-text-muted);">PROD. LACK (${total > 0 ? Math.round((prodLack/total)*100) : 0}%)</div>
          </div>
          <div style="text-align: center; padding: 16px; background: var(--color-bg-secondary); border-radius: 12px;">
            <div style="width: 40px; height: 40px; margin: 0 auto 8px; border-radius: 50%; background: rgba(16,185,129,0.1); display: flex; align-items: center; justify-content: center;">
              <svg viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2" width="20" height="20"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            </div>
            <div style="font-size: 2rem; font-weight: 700;">${normal}</div>
            <div style="font-size: 0.75rem; color: var(--color-text-muted);">NORMAL</div>
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
      let html = `<table style="width: 100%; border-collapse: collapse;"><thead><tr style="background: var(--color-bg-secondary);">
        <th style="padding: 12px; text-align: left;">Quarter</th><th style="padding: 12px;">IST</th><th style="padding: 12px;">SOLL</th><th style="padding: 12px;">Rate</th></tr></thead><tbody>`;
      
      (['Q1', 'Q2', 'Q3', 'Q4'] as const).forEach(q => {
        const rate = data.soll[q] > 0 ? Math.round((data.ist[q] / data.soll[q]) * 100) : 0;
        const color = rate >= 90 ? '#10B981' : rate >= 70 ? '#3B82F6' : rate >= 50 ? '#F59E0B' : '#EF4444';
        html += `<tr style="border-bottom: 1px solid var(--color-border);"><td style="padding: 12px; font-weight: 500;">${q}</td><td style="padding: 12px; text-align: center;">${data.ist[q]}</td><td style="padding: 12px; text-align: center;">${data.soll[q]}</td><td style="padding: 12px; text-align: center; color: ${color}; font-weight: 600;">${rate}%</td></tr>`;
      });
      html += '</tbody></table>';
      yoyContainer.innerHTML = `<div style="padding: 16px;">${html}</div>`;
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
          <div style="background: var(--color-bg-secondary); border-radius: 12px; padding: 16px; text-align: center; border: 1px solid ${isCurrent ? 'var(--color-primary)' : 'var(--color-border)'};">
            <div style="font-size: 0.75rem; font-weight: 600; color: var(--color-text-muted); text-transform: uppercase; margin-bottom: 8px;">${name}</div>
            <div style="font-size: 1.5rem; font-weight: 700;">${ist}</div>
            <div style="font-size: 0.75rem; color: var(--color-text-muted);">/ ${soll} SOLL</div>
            ${soll > 0 ? `<div style="margin-top: 8px; font-size: 0.875rem; font-weight: 600; padding: 4px 8px; border-radius: 12px; display: inline-block; background: ${rateColor}20; color: ${rateColor};">${rate}%</div>` : ''}
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
        const tooltip = `KW${week}: ${ist}/${soll} (pozostało: ${remaining})`;
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
}

// Initialize
const app = new KappaApp();
app.init();
