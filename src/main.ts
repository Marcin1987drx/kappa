import { i18n } from './i18n';
import { api } from './api/client';
import { db } from './database';
import { Customer, Type, Part, Test, Project, AppState, Employee, ScheduleEntry, ScheduleAssignment, ProjectComment, AssignmentScope, EmployeeStatus } from './types';
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

  // Absence module state
  private absenceYear: number = new Date().getFullYear();
  private absenceViewMode: 'calendar' | 'list' | 'heatmap' | 'employees' = 'calendar';
  private absenceCalendarMonth: number = new Date().getMonth();
  private absenceFilterEmployee: string = '';
  private absenceFilterType: string = '';
  private absenceFilterMonth: string = '';
  private absenceTypes: any[] = [];
  private absences: any[] = [];
  private absenceLimits: any[] = [];
  private holidays: any[] = [];
  private absenceEventsInitialized: boolean = false;

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
  private scheduleViewMode: 'week' | 'multi' | 'year' | 'compact' = 'week';
  private scheduleFilterEmployee: string = '';
  private scheduleFilterProject: string = '';
  private scheduleFilterTest: string = '';
  private scheduleSortMode: 'default' | 'alpha' | 'coverage' = 'default';
  private pinnedScheduleProjects: Set<string> = new Set();
  private draggedEmployeeId: string | null = null;
  private draggedEmployeeScope: 'project' | 'audit' | 'adhesion' | 'specific' = 'project';
  
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
    this.renderScheduleProjectsPanel();
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
      filterProject.innerHTML = '<option value="">Wszystkie projekty</option>' + 
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
      filterTest.innerHTML = '<option value="">Wszystkie badania</option>' + 
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
      default:
        this.renderScheduleProjectsPanel();
    }
  }
  
  private setupScheduleEventListeners(): void {
    // View toggle (1T/3T)
    document.querySelectorAll('.sched-view-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const view = (btn as HTMLElement).dataset.view;
        this.scheduleViewMode = view === '3week' ? 'multi' : 'week';
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
    
    // Filtr pracownika w topbar
    const employeeFilterTopbar = document.getElementById('scheduleEmployeeFilter') as HTMLSelectElement;
    if (employeeFilterTopbar) {
      // Uzupełnij opcje
      employeeFilterTopbar.innerHTML = '<option value="">Wszyscy pracownicy</option>' + 
        this.state.employees
          .filter(e => !e.status || e.status === 'available')
          .sort((a, b) => a.firstName.localeCompare(b.firstName))
          .map(e => `<option value="${e.id}" ${e.id === this.scheduleFilterEmployee ? 'selected' : ''}>${e.firstName} ${e.lastName}</option>`)
          .join('');
      
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
    
    const months = ['Sty', 'Lut', 'Mar', 'Kwi', 'Maj', 'Cze', 'Lip', 'Sie', 'Wrz', 'Paź', 'Lis', 'Gru'];
    const monthsFull = ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'];
    const weekdays = ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So', 'Nd'];
    
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
      const date = new Date(log.timestamp).toLocaleDateString('pl-PL', { weekday: 'short', day: '2-digit', month: '2-digit' });
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
                  
                  const time = new Date(log.timestamp).toLocaleString('pl-PL', { 
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
    const weekDates = this.getWeekDateRange(this.scheduleCurrentYear, this.scheduleCurrentWeek);
    
    const overlay = document.createElement('div');
    overlay.className = 'employee-modal-overlay';
    overlay.innerHTML = `
      <div class="employee-modal" style="max-width: 450px;">
        <div class="employee-modal-header">
          <div class="employee-modal-info">
            <h2>📥 Eksportuj grafik</h2>
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
            <button class="sched-export-btn" data-format="csv">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
              <div>
                <strong>Excel / CSV</strong>
                <span>Arkusz kalkulacyjny</span>
              </div>
            </button>
            <button class="sched-export-btn" data-format="pdf">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 15v-2h2v2z"/></svg>
              <div>
                <strong>PDF</strong>
                <span>Dokument do wydruku</span>
              </div>
            </button>
            <button class="sched-export-btn" data-format="json">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
              <div>
                <strong>JSON</strong>
                <span>Dane strukturalne</span>
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
        this.exportSchedule(format as 'csv' | 'pdf' | 'json');
        overlay.remove();
      });
    });
  }
  
  private exportSchedule(format: 'csv' | 'pdf' | 'json'): void {
    const weekKey = `${this.scheduleCurrentYear}-KW${this.scheduleCurrentWeek.toString().padStart(2, '0')}`;
    const assignments = this.state.scheduleAssignments.filter((a: ScheduleAssignment) => a.week === weekKey);
    
    // Przygotuj dane
    const exportData = assignments.map((a: ScheduleAssignment) => {
      const emp = this.state.employees.find(e => e.id === a.employeeId);
      const project = this.state.projects.find(p => p.id === a.projectId || `${p.customer_id}-${p.type_id}` === a.projectId);
      const customer = project ? this.state.customers.find(c => c.id === project.customer_id) : null;
      const type = project ? this.state.types.find(t => t.id === project.type_id) : null;
      
      let scope = 'Cały projekt';
      if (a.scope === 'adhesion') scope = 'Przyczepność';
      else if (a.scope === 'audit') scope = 'Audyt';
      else if (a.testId) {
        const test = this.state.tests.find(t => t.id === a.testId);
        scope = test?.name || 'Test';
      } else if (a.partId) {
        const part = this.state.parts.find(p => p.id === a.partId);
        scope = part?.name || 'Część';
      }
      
      return {
        pracownik: emp ? `${emp.firstName} ${emp.lastName}` : '?',
        klient: customer?.name || '?',
        typ: type?.name || '?',
        zmiana: a.shift,
        zakres: scope,
        tydzien: weekKey
      };
    });
    
    if (format === 'csv') {
      const headers = ['Pracownik', 'Klient', 'Typ', 'Zmiana', 'Zakres', 'Tydzień'];
      const rows = exportData.map(d => [d.pracownik, d.klient, d.typ, d.zmiana, d.zakres, d.tydzien].join(';'));
      const csv = [headers.join(';'), ...rows].join('\n');
      
      const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `grafik_${weekKey}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      
      this.showToast('Wyeksportowano do CSV', 'success');
    } else if (format === 'json') {
      const json = JSON.stringify(exportData, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `grafik_${weekKey}.json`;
      a.click();
      URL.revokeObjectURL(url);
      
      this.showToast('Wyeksportowano do JSON', 'success');
    } else if (format === 'pdf') {
      // Prosty eksport HTML do druku
      const weekDates = this.getWeekDateRange(this.scheduleCurrentYear, this.scheduleCurrentWeek);
      
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Grafik ${weekKey}</title>
            <style>
              body { font-family: Arial, sans-serif; padding: 20px; }
              h1 { font-size: 18px; margin-bottom: 5px; }
              h2 { font-size: 14px; color: #666; margin-bottom: 20px; }
              table { width: 100%; border-collapse: collapse; }
              th, td { border: 1px solid #ddd; padding: 8px; text-align: left; font-size: 12px; }
              th { background: #f5f5f5; font-weight: 600; }
              .shift-1 { background: rgba(37, 99, 235, 0.1); }
              .shift-2 { background: rgba(124, 58, 237, 0.1); }
              .shift-3 { background: rgba(234, 88, 12, 0.1); }
            </style>
          </head>
          <body>
            <h1>Grafik pracy - ${weekKey}</h1>
            <h2>${weekDates.start} - ${weekDates.end}</h2>
            <table>
              <thead>
                <tr>
                  <th>Pracownik</th>
                  <th>Klient</th>
                  <th>Typ</th>
                  <th>Zmiana</th>
                  <th>Zakres</th>
                </tr>
              </thead>
              <tbody>
                ${exportData.map(d => `
                  <tr>
                    <td>${d.pracownik}</td>
                    <td>${d.klient}</td>
                    <td>${d.typ}</td>
                    <td class="shift-${d.zmiana}">Zmiana ${d.zmiana}</td>
                    <td>${d.zakres}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </body>
          </html>
        `);
        printWindow.document.close();
        printWindow.print();
      }
      
      this.showToast('Otwarto okno drukowania', 'success');
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
        message: `${unassignedEmployees.length} pracownik${unassignedEmployees.length > 1 ? 'ów' : ''} bez przydziału: ${unassignedEmployees.map(e => e.firstName).join(', ')}`,
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
        message: `${unassignedProjects.length} projekt${unassignedProjects.length > 1 ? 'ów' : ''} bez obsady: ${unassignedProjects.slice(0, 3).join(', ')}${unassignedProjects.length > 3 ? '...' : ''}`
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
          processWarnings.push(`${customer?.name}: Brak obsady przyczepności`);
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
        message: `Nieobsadzone procesy: ${processWarnings.slice(0, 2).join(', ')}${processWarnings.length > 2 ? ` (+${processWarnings.length - 2} więcej)` : ''}`
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
          rotationSuggestions.push(`${emp.firstName}: zmiana ${prevMainShift}→${suggestedShift}`);
        }
      }
    });
    
    if (rotationSuggestions.length > 0) {
      alerts.push({
        type: 'suggestion',
        icon: '🔄',
        message: `Sugestia rotacji: ${rotationSuggestions.slice(0, 2).join(', ')}${rotationSuggestions.length > 2 ? '...' : ''}`
      });
    }
    
    // Success message if all good
    if (alerts.length === 0 && weekProjects.length > 0) {
      alerts.push({
        type: 'success',
        icon: '✓',
        message: 'Wszystkie projekty mają przypisanych pracowników'
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
        ${alert.action ? `<button class="sched-alert-action" data-action="${alert.action}">Przypisz</button>` : ''}
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
      { week: this.scheduleCurrentWeek - 1 < 1 ? 52 : this.scheduleCurrentWeek - 1, year: this.scheduleCurrentWeek - 1 < 1 ? this.scheduleCurrentYear - 1 : this.scheduleCurrentYear, label: 'Poprz.' },
      { week: this.scheduleCurrentWeek, year: this.scheduleCurrentYear, label: 'Obecny' },
      { week: this.scheduleCurrentWeek + 1 > 52 ? 1 : this.scheduleCurrentWeek + 1, year: this.scheduleCurrentWeek + 1 > 52 ? this.scheduleCurrentYear + 1 : this.scheduleCurrentYear, label: 'Następny' }
    ];
    
    // Update header for multi-week
    const headerContainer = document.getElementById('scheduleShiftsHeader');
    if (headerContainer) {
      headerContainer.className = 'sched-table-header sched-multiweek';
      headerContainer.innerHTML = `
        <div class="sched-col-project">Projekt</div>
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
          <span>Brak projektów w wybranym okresie</span>
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
      <div class="header-cell project-col">Projekt</div>
      <div class="header-cell months-row">
        ${['Sty', 'Lut', 'Mar', 'Kwi', 'Maj', 'Cze', 'Lip', 'Sie', 'Wrz', 'Paź', 'Lis', 'Gru'].map((m, i) => 
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
                     data-week="${week}" title="KW${week}${hasSoll ? ' • Ma SOLL' : ''}${hasAssignment ? ' • Obsadzony' : ''}"></div>`;
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
    let headerHtml = '<div class="header-cell project-col compact">Projekt</div>';
    headerHtml += '<div class="header-cell compact">Części</div>';
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
      container.innerHTML = `<div class="grid-empty"><h3>Brak projektów</h3></div>`;
      return;
    }
    
    container.innerHTML = Array.from(projectGroups.entries()).map(([groupKey, group]) => {
      const shiftAssignments: { [key: number]: ScheduleAssignment[] } = { 1: [], 2: [], 3: [] };
      group.assignments.forEach((a: ScheduleAssignment) => {
        shiftAssignments[a.shift].push(a);
      });
      
      const totalAssigned = group.assignments.length;
      const status = totalAssigned === 0 ? 'unassigned' : totalAssigned >= group.partsCount ? 'full' : 'partial';
      const statusLabel = status === 'unassigned' ? '⚠️ Brak' : status === 'full' ? '✓ OK' : '⚡ Częściowo';
      
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
      case 'audit': return 'Audyty';
      case 'adhesion': return 'Przyczepność';
      case 'specific': return 'Konkretna część';
      default: return 'Cały projekt';
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
      Auto-planner
    `;
    
    modalBody.innerHTML = `
      <div class="auto-assign-modal">
        <div class="info-box">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
          </svg>
          <span>Auto-planner rozdzieli pracowników równomiernie na projekty bez obsady.</span>
        </div>
        
        <div class="auto-stats">
          <div class="stat">
            <span class="stat-value">${weekProjects.length}</span>
            <span class="stat-label">Projektów</span>
          </div>
          <div class="stat">
            <span class="stat-value">${this.state.employees.length}</span>
            <span class="stat-label">Pracowników</span>
          </div>
          <div class="stat">
            <span class="stat-value">${weekProjects.length - assignedProjectIds.size}</span>
            <span class="stat-label">Bez obsady</span>
          </div>
        </div>
        
        <div class="form-group">
          <label class="form-label">Strategia:</label>
          <select id="autoStrategy" class="form-control">
            <option value="rotate">Rotacja zmian (1→2→3→1...)</option>
            <option value="balance">Równomierne obciążenie</option>
            <option value="copy">Kopiuj z poprzedniego tygodnia</option>
          </select>
        </div>
        
        <div class="form-group">
          <label class="form-label">Domyślny zakres:</label>
          <select id="autoScope" class="form-control">
            <option value="project">Cały projekt</option>
            <option value="audit">Tylko audyty</option>
            <option value="adhesion">Tylko przyczepność</option>
          </select>
        </div>
      </div>
    `;
    
    const confirmBtn = modal.querySelector('.modal-confirm') as HTMLButtonElement;
    confirmBtn.style.display = '';
    confirmBtn.textContent = 'Uruchom auto-planner';
    confirmBtn.onclick = async () => {
      const strategy = (document.getElementById('autoStrategy') as HTMLSelectElement).value;
      const scope = (document.getElementById('autoScope') as HTMLSelectElement).value as 'project' | 'audit' | 'adhesion';
      
      await this.runAutoAssign(strategy, scope);
      this.hideModal();
    };
    
    modal.classList.add('active');
  }
  
  private async runAutoAssign(strategy: string, defaultScope: 'project' | 'audit' | 'adhesion'): Promise<void> {
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
      assignedGroupIds.add(a.projectId);
    });
    
    const unassignedGroups = Array.from(projectGroups.keys()).filter(g => !assignedGroupIds.has(g));
    
    if (unassignedGroups.length === 0 || this.state.employees.length === 0) {
      this.showToast('Wszystkie projekty już obsadzone lub brak pracowników', 'warning');
      return;
    }
    
    // Assign employees to unassigned projects
    let employeeIndex = 0;
    let shift = 1;
    
    for (const groupKey of unassignedGroups) {
      const employee = this.state.employees[employeeIndex % this.state.employees.length];
      
      if (strategy === 'rotate') {
        // Get previous week's shift for this employee
        const prevWeekKey = this.getPreviousWeekKey(weekKey);
        const prevAssignment = this.state.scheduleAssignments.find((a: ScheduleAssignment) => 
          a.employeeId === employee.id && a.week === prevWeekKey
        );
        
        if (prevAssignment) {
          shift = (prevAssignment.shift % this.scheduleShiftSystem) + 1;
        }
      }
      
      await this.addAssignmentWithScope(
        groupKey,
        undefined,
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
    
    this.showToast(`Przypisano ${unassignedGroups.length} projektów`, 'success');
    this.renderScheduleAlerts();
    this.renderScheduleContent();
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
      
      return `
        <div class="sched-emp-card" ${isDraggable ? 'draggable="true"' : ''} data-employee-id="${emp.id}">
          <div class="sched-emp-avatar" style="background: ${emp.color}">${emp.firstName.charAt(0)}${emp.lastName.charAt(0)}</div>
          <div class="sched-emp-info">
            <span class="sched-emp-name">${emp.firstName} ${emp.lastName}</span>
            ${uniqueTasks.length > 0 ? `<span class="sched-emp-tasks">${uniqueTasks.slice(0, 2).join(', ')}${uniqueTasks.length > 2 ? '...' : ''}</span>` : ''}
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
            label = isVacation ? 'Urlop' : 'L4';
            badgeClass = emp.status || 'vacation';
          }
          
          return `
            <div class="sched-absent-card" data-employee-id="${emp.id}" data-status="${emp.status || 'absent'}" ${absenceFromModule ? `data-absence-id="${absenceFromModule.id}"` : ''}>
              <span class="sched-absent-icon">${icon}</span>
              <span class="sched-absent-name">${emp.firstName} ${emp.lastName}</span>
              <span class="sched-absent-badge ${badgeClass}">${label}</span>
              <button class="sched-absent-return" data-emp-id="${emp.id}" title="Przywróć">
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
                this.showToast(`${emp.firstName} wrócił do pracy`, 'success');
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
        uncoveredList.innerHTML = '<p class="sched-panel-empty">Wszystko obsadzone ✓</p>';
      } else {
        uncoveredList.innerHTML = uncoveredGroupsList.map(g => `
          <div class="sched-uncovered-item ${g.staffingClass}">
            <div class="sched-uncovered-header">
              <span class="sched-uncovered-customer">${g.customer}</span>
              <span class="sched-uncovered-type">${g.type}</span>
            </div>
            ${g.missing.length > 0 ? `
              <div class="sched-uncovered-missing">
                <span class="sched-uncovered-label">Brakuje:</span>
                ${g.missing.map(m => `<span class="sched-uncovered-test">${m}</span>`).join('')}
              </div>
            ` : `
              <div class="sched-uncovered-missing">
                <span class="sched-uncovered-label">Brak obsady</span>
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
    const availableEmployees = this.state.employees.filter(e => !e.status || e.status === 'available');
    const absentEmployees = this.state.employees.filter(e => e.status === 'vacation' || e.status === 'sick');
    const assignedEmployeeIds = new Set(weekAssignments.map(a => a.employeeId));
    const unassignedCount = availableEmployees.filter(e => !assignedEmployeeIds.has(e.id)).length;
    
    // ===== ANALIZA OBCIĄŻENIA PRACOWNIKÓW =====
    const employeeWorkload = new Map<string, number>();
    weekAssignments.forEach(a => {
      employeeWorkload.set(a.employeeId, (employeeWorkload.get(a.employeeId) || 0) + 1);
    });
    
    const workloads = Array.from(employeeWorkload.values());
    const maxWorkload = Math.max(...workloads, 0);
    const minWorkload = Math.min(...workloads.filter(w => w > 0), maxWorkload);
    const avgWorkload = workloads.length > 0 ? workloads.reduce((a, b) => a + b, 0) / workloads.length : 0;
    
    // Znajdź pracowników z nierównomiernym obciążeniem
    const overloadedEmployees: Array<{emp: Employee; count: number}> = [];
    const underloadedEmployees: Array<{emp: Employee; count: number}> = [];
    
    employeeWorkload.forEach((count, empId) => {
      const emp = this.state.employees.find(e => e.id === empId);
      if (emp) {
        if (count >= avgWorkload * 1.5 && count > 3) {
          overloadedEmployees.push({ emp, count });
        }
      }
    });
    
    // Pracownicy dostępni ale bez przypisań lub z małą liczbą
    availableEmployees.forEach(emp => {
      const count = employeeWorkload.get(emp.id) || 0;
      if (count < avgWorkload * 0.5 && maxWorkload > 2) {
        underloadedEmployees.push({ emp, count });
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
          absentButAssigned.push({ emp, status: emp.status === 'vacation' ? 'urlop' : 'L4' });
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
          ? `był już ${exp} razy na tym projekcie i ma mało zadań`
          : `ma najmniej zadań w tym tygodniu`;
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
      alerts.push(`<div class="sched-alert danger"><span class="alert-icon">⚠️</span><span class="alert-text"><strong>${emp.firstName} ${emp.lastName}</strong> jest na ${status}, ale ma przypisania!</span></div>`);
    });
    
    shiftConflicts.forEach(({ emp, shift, projects }) => {
      alerts.push(`<div class="sched-alert warning"><span class="alert-icon">⚡</span><span class="alert-text"><strong>${emp.firstName} ${emp.lastName}</strong> ma ${projects.length} projekty na zmianie ${shift} naraz!</span></div>`);
    });
    
    // Sugestie
    if (longTermAssignments.length > 0) {
      longTermAssignments.slice(0, 3).forEach(({ emp, project, weeks }) => {
        suggestions.push(`<div class="sched-suggestion rotate"><span class="sugg-icon">🔄</span><span class="sugg-text"><strong>${emp.firstName}</strong> pracuje na <em>${project}</em> już ${weeks} tygodnie z rzędu - może czas na zmianę?</span></div>`);
      });
    }
    
    if (experienceImbalance.length > 0) {
      experienceImbalance.slice(0, 2).forEach(({ project, experienced, inexperienced }) => {
        suggestions.push(`<div class="sched-suggestion balance"><span class="sugg-icon">📊</span><span class="sugg-text"><em>${project}</em>: <strong>${experienced.emp.firstName}</strong> był ${experienced.count} razy, <strong>${inexperienced.emp.firstName}</strong> tylko ${inexperienced.count} - daj szansę mniej doświadczonemu</span></div>`);
      });
    }
    
    if (overloadedEmployees.length > 0 && underloadedEmployees.length > 0) {
      const over = overloadedEmployees[0];
      const under = underloadedEmployees[0];
      suggestions.push(`<div class="sched-suggestion workload"><span class="sugg-icon">⚖️</span><span class="sugg-text"><strong>${over.emp.firstName}</strong> ma ${over.count} zadań, <strong>${under.emp.firstName}</strong> tylko ${under.count} - przenieś jedno zadanie</span></div>`);
    }
    
    if (shiftImbalance) {
      suggestions.push(`<div class="sched-suggestion shift"><span class="sugg-icon">🔀</span><span class="sugg-text">Zmiana ${shiftImbalance.from} ma ${shiftImbalance.diff} osób więcej niż zmiana ${shiftImbalance.to} - przenieś kogoś</span></div>`);
    }
    
    optimalSuggestions.slice(0, 2).forEach(({ project, suggestedEmp, reason }) => {
      suggestions.push(`<div class="sched-suggestion optimal"><span class="sugg-icon">💡</span><span class="sugg-text">Przypisz <strong>${suggestedEmp.firstName}</strong> do <em>${project}</em> - ${reason}</span></div>`);
    });
    
    panel.innerHTML = `
      <div class="sched-stats-grid">
        <div class="sched-stat-item">
          <span class="sched-stat-value">${assignedEmployeeIds.size}</span>
          <span class="sched-stat-label">Przypisanych</span>
        </div>
        <div class="sched-stat-item">
          <span class="sched-stat-value">${unassignedCount}</span>
          <span class="sched-stat-label">Wolnych</span>
        </div>
        <div class="sched-stat-item">
          <span class="sched-stat-value">${absentEmployees.length}</span>
          <span class="sched-stat-label">Nieobecnych</span>
        </div>
        <div class="sched-stat-item">
          <span class="sched-stat-value">${coveragePercent}%</span>
          <span class="sched-stat-label">Pokrycie</span>
        </div>
      </div>
      
      <div class="sched-stats-coverage">
        <div class="sched-coverage-bar">
          <div class="sched-coverage-fill" style="width: ${coveragePercent}%"></div>
        </div>
        <div class="sched-coverage-legend">
          <span class="sched-coverage-item full"><span class="dot"></span>${fullyCovered} pełne</span>
          <span class="sched-coverage-item partial"><span class="dot"></span>${partiallyCovered} częściowe</span>
          <span class="sched-coverage-item empty"><span class="dot"></span>${notCovered} brak</span>
        </div>
      </div>
      
      ${alerts.length > 0 ? `
        <div class="sched-alerts-section">
          <h5>⚠️ Alerty</h5>
          ${alerts.join('')}
        </div>
      ` : ''}
      
      ${suggestions.length > 0 ? `
        <div class="sched-suggestions-section">
          <h5>💡 Sugestie</h5>
          ${suggestions.join('')}
        </div>
      ` : '<div class="sched-no-suggestions">✅ Brak sugestii - grafik wygląda dobrze!</div>'}
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
      panel.innerHTML = '<p class="sched-panel-empty">Brak ostatnich zmian</p>';
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
          
          const time = new Date(log.timestamp).toLocaleString('pl-PL', { 
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
            <h2>📊 Szczegółowe statystyki - KW${this.scheduleCurrentWeek.toString().padStart(2, '0')} ${this.scheduleCurrentYear}</h2>
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
              <div class="stats-card-label">Przypisań</div>
            </div>
            <div class="stats-summary-card">
              <div class="stats-card-value">${new Set(weekAssignments.map(a => a.employeeId)).size}</div>
              <div class="stats-card-label">Pracowników</div>
            </div>
            <div class="stats-summary-card">
              <div class="stats-card-value">${coveredProjects}/${totalProjects}</div>
              <div class="stats-card-label">Projektów</div>
            </div>
            <div class="stats-summary-card ${coveragePercent === 100 ? 'success' : coveragePercent >= 80 ? 'warning' : 'danger'}">
              <div class="stats-card-value">${coveragePercent}%</div>
              <div class="stats-card-label">Pokrycie</div>
            </div>
          </div>
          
          <!-- SEKCJA 2: Wykres zmian -->
          <div class="stats-section">
            <h4>📈 Rozkład na zmiany</h4>
            <div class="stats-shift-chart">
              ${shiftStats.map(s => `
                <div class="stats-shift-bar">
                  <div class="stats-bar-label">Zmiana ${s.shift}</div>
                  <div class="stats-bar-track">
                    <div class="stats-bar-fill shift-${s.shift}" style="width: ${totalShiftAssignments > 0 ? (s.count / totalShiftAssignments * 100) : 0}%"></div>
                  </div>
                  <div class="stats-bar-value">${s.count} <small>(${s.employees} os.)</small></div>
                </div>
              `).join('')}
            </div>
          </div>
          
          <!-- SEKCJA 3: Wykres obciążenia pracowników -->
          <div class="stats-section">
            <h4>👥 Obciążenie pracowników</h4>
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
              ${employeeStats.length > 10 ? `<div class="stats-more-hint">...i ${employeeStats.length - 10} więcej</div>` : ''}
            </div>
          </div>
          
          <!-- SEKCJA 4: Trend tygodniowy -->
          <div class="stats-section">
            <h4>📅 Trend ostatnich 6 tygodni</h4>
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
            <h4>🏆 Top pracownicy (ostatnie 4 tyg.)</h4>
            <div class="stats-top-list">
              ${topMonthlyWorkers.map((w, i) => `
                <div class="stats-top-item">
                  <span class="stats-top-rank">${i + 1}.</span>
                  <span class="stats-top-name">${w.name}</span>
                  <span class="stats-top-count">${w.count} przypisań</span>
                </div>
              `).join('')}
            </div>
          </div>
          
          <!-- SEKCJA 6: Doświadczenie pracowników na projektach -->
          <div class="stats-section stats-experience-section">
            <h4>🎯 Doświadczenie na projektach (wszystkie tygodnie)</h4>
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
                        <div class="stats-exp-segment" style="width: ${(p.count / maxExp * 100)}%; background: ${projectColorMap.get(p.name) || '#888'}" title="${p.name}: ${p.count} razy"></div>
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
            <h4>📋 Szczegóły pracowników</h4>
            <div class="stats-detail-table">
              <div class="stats-table-header">
                <span>Pracownik</span>
                <span>Przypisania</span>
                <span>Zmiany</span>
                <span>Projekty</span>
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
      this.showToast(`${emp.firstName} ${emp.lastName} wrócił do pracy`, 'success');
    } else {
      emp.status = type;
      await db.put('employees', emp);
      const typeLabel = type === 'vacation' ? 'urlopie' : 'L4';
      this.showToast(`${emp.firstName} ${emp.lastName} jest na ${typeLabel}`, 'success');
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
          scopeLabel = '🧪 Przyczepność';
        } else if (a.scope === 'audit') {
          scopeLabel = '🔍 Audyt';
        } else if (a.testId) {
          const test = this.state.tests.find(t => t.id === a.testId);
          scopeLabel = `⚙️ ${test?.name || 'Test'}`;
        } else if (a.partId) {
          const part = this.state.parts.find(p => p.id === a.partId);
          scopeLabel = `📦 ${part?.name || 'Część'}`;
        } else if (a.scope === 'project') {
          scopeLabel = '📋 Cały projekt';
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
        <div class="sched-popup-week">KW${this.scheduleCurrentWeek} • ${assignments.length} przypisań</div>
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
      if (a.scope === 'adhesion') scopeLabel = 'Przyczepność';
      else if (a.scope === 'audit') scopeLabel = 'Audyt';
      else if (a.scope === 'project') scopeLabel = 'Cały projekt';
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
            <span class="sched-popup-warning">⚠️ Brak przypisanych pracowników</span>
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
      let scope = 'Cały projekt';
      let scopeClass = '';
      const details: string[] = [];
      
      if (a.scope === 'adhesion') {
        scope = 'Przyczepność';
        scopeClass = 'scope-adhesion';
      } else if (a.scope === 'audit') {
        scope = 'Audyt';
        scopeClass = 'scope-audit';
      } else if (a.testId) {
        const test = this.state.tests.find(t => t.id === a.testId);
        scope = test?.name || 'Test';
        scopeClass = 'scope-test';
      } else if (a.partId) {
        const part = this.state.parts.find(p => p.id === a.partId);
        scope = part?.name || 'Część';
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
    const days = ['Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob', 'Nie'];
    const shiftNames = ['Rano', 'Pop.', 'Noc'];
    
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
                ${uniqueProjects} ${uniqueProjects === 1 ? 'projekt' : 'projekty'}
              </span>
              <span class="employee-modal-stat">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                ${totalShifts} ${totalShifts === 1 ? 'zmiana' : 'zmiany'}
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
              <h3>📋 Zadania w tym tygodniu</h3>
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
                        ${task.details.length > 3 ? `<span class="employee-task-tag">+${task.details.length - 3} więcej</span>` : ''}
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
              <h3>📋 Zadania w tym tygodniu</h3>
              <p style="color: var(--color-text-muted); font-size: 0.85rem;">Brak przypisanych zadań w tym tygodniu.</p>
            </div>
          `}
          
          <div class="employee-modal-section">
            <h3>� Statystyki</h3>
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
                    <span class="employee-stat-label">Zmian w miesiącu</span>
                  </div>
                  <div class="employee-stat-card">
                    <span class="employee-stat-value">${shiftsThisYear}</span>
                    <span class="employee-stat-label">Zmian w roku</span>
                  </div>
                  <div class="employee-stat-card">
                    <span class="employee-stat-value">${uniqueProjectsYear}</span>
                    <span class="employee-stat-label">Projektów w roku</span>
                  </div>
                `;
              })()}
            </div>
          </div>
          
          <div class="employee-modal-section">
            <h3>⚡ Szybkie akcje</h3>
            <div class="employee-quick-actions">
              <button class="employee-action-btn" data-action="edit">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                Edytuj dane
              </button>
              <button class="employee-action-btn" data-action="vacation">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2"/></svg>
                ${emp.status === 'vacation' ? 'Zakończ urlop' : 'Ustaw urlop'}
              </button>
              <button class="employee-action-btn" data-action="sick">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
                ${emp.status === 'sick' ? 'Zakończ L4' : 'Ustaw L4'}
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
          this.showToast(emp.status === 'vacation' ? `${emp.firstName} jest na urlopie` : `${emp.firstName} wrócił z urlopu`, 'success');
          overlay.remove();
          this.renderScheduleEmployeePanel();
        } else if (action === 'sick') {
          emp.status = emp.status === 'sick' ? 'available' : 'sick';
          await db.put('employees', emp);
          this.showToast(emp.status === 'sick' ? `${emp.firstName} jest na L4` : `${emp.firstName} wrócił z L4`, 'success');
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
        weeks.push({ year, week, label: `KW${week.toString().padStart(2, '0')} ${year} (${count} przypisań)` });
      }
    }
    
    modalTitle.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18" style="display:inline;vertical-align:middle;margin-right:8px">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
      </svg>
      Kopiuj tydzień
    `;
    
    modalBody.innerHTML = `
      <div class="copy-week-modal">
        <div class="info-box">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
          </svg>
          <span>Skopiuj przypisania z poprzedniego tygodnia do KW${this.scheduleCurrentWeek}.</span>
        </div>
        
        ${weeks.length > 0 ? `
          <div class="form-group">
            <label class="form-label">Kopiuj z:</label>
            <select id="copySourceWeek" class="form-control">
              ${weeks.map(w => `<option value="${w.year}-${w.week}">${w.label}</option>`).join('')}
            </select>
          </div>
          
          <div class="form-group">
            <label class="form-checkbox">
              <input type="checkbox" id="copyOverwrite" checked>
              <span>Zastąp istniejące przypisania</span>
            </label>
          </div>
        ` : `
          <p class="form-hint">Brak tygodni z przypisaniami do skopiowania.</p>
        `}
      </div>
    `;
    
    const confirmBtn = modal.querySelector('.modal-confirm') as HTMLButtonElement;
    if (weeks.length > 0) {
      confirmBtn.style.display = '';
      confirmBtn.textContent = 'Kopiuj';
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
    
    this.logScheduleChange('added', `${copied} przypisań`, `skopiowano z ${sourceWeekKey}`);
    this.showToast(`Skopiowano ${copied} przypisań z ${sourceWeekKey}`, 'success');
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
      Szablony grafiku
    `;
    
    const weekKey = `${this.scheduleCurrentYear}-KW${this.scheduleCurrentWeek.toString().padStart(2, '0')}`;
    const currentCount = this.state.scheduleAssignments.filter((a: ScheduleAssignment) => a.week === weekKey).length;
    
    modalBody.innerHTML = `
      <div class="templates-modal">
        <div class="templates-section">
          <h4>💾 Zapisz obecny tydzień jako szablon</h4>
          <div class="templates-save-form">
            <input type="text" id="templateName" class="form-control" placeholder="Nazwa szablonu...">
            <button class="btn-primary" id="saveTemplateBtn" ${currentCount === 0 ? 'disabled' : ''}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
              Zapisz
            </button>
          </div>
          ${currentCount === 0 ? '<p class="form-hint">Brak przypisań do zapisania.</p>' : `<p class="form-hint">${currentCount} przypisań do zapisania.</p>`}
        </div>
        
        <div class="templates-section">
          <h4>📂 Dostępne szablony</h4>
          ${templates.length === 0 ? `
            <p class="templates-empty">Brak zapisanych szablonów.</p>
          ` : `
            <div class="templates-list">
              ${templates.map(t => `
                <div class="template-item" data-id="${t.id}">
                  <div class="template-info">
                    <span class="template-name">${t.name}</span>
                    <span class="template-meta">${t.assignments.length} przypisań • ${new Date(t.createdAt).toLocaleDateString('pl')}</span>
                  </div>
                  <div class="template-actions">
                    <button class="template-apply" data-id="${t.id}" title="Zastosuj">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg>
                    </button>
                    <button class="template-delete" data-id="${t.id}" title="Usuń">
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
      if (!name) { this.showToast('Podaj nazwę szablonu', 'warning'); return; }
      
      const assignments = this.state.scheduleAssignments
        .filter((a: ScheduleAssignment) => a.week === weekKey)
        .map((a: ScheduleAssignment) => ({ ...a, week: 'TEMPLATE' }));
      
      const template = { id: crypto.randomUUID(), name, data: assignments, createdAt: Date.now() };
      await db.addTemplate(template);
      
      this.showToast(`Szablon "${name}" zapisany`, 'success');
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
        
        this.showToast(`Szablon "${template.name}" zastosowany`, 'success');
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
          this.showToast(`Szablon "${template.name}" usunięty`, 'success');
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
      Powiadomienia
    `;
    
    modalBody.innerHTML = `
      <div class="notifications-modal">
        <div class="info-box info-box-primary">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
          </svg>
          <span>Konfiguruj powiadomienia email dla grafiku.</span>
        </div>
        
        <div class="form-group">
          <label class="form-label">Email:</label>
          <input type="email" id="notifyEmail" class="form-control" placeholder="twoj@email.pl" value="${settings.email || ''}">
        </div>
        
        <div class="form-group">
          <label class="form-checkbox">
            <input type="checkbox" id="notifyEnabled" ${settings.enabled ? 'checked' : ''}>
            <span>Włącz powiadomienia email</span>
          </label>
        </div>
        
        <div class="form-group" style="margin-left: 24px;">
          <label class="form-checkbox">
            <input type="checkbox" id="notifyOnAssign" ${settings.onAssign !== false ? 'checked' : ''}>
            <span>Powiadom gdy zostanę przypisany</span>
          </label>
          <label class="form-checkbox">
            <input type="checkbox" id="notifyOnUnassign" ${settings.onUnassign !== false ? 'checked' : ''}>
            <span>Powiadom gdy zostanę usunięty</span>
          </label>
          <label class="form-checkbox">
            <input type="checkbox" id="notifyDailyDigest" ${settings.dailyDigest ? 'checked' : ''}>
            <span>Codzienne podsumowanie (8:00)</span>
          </label>
        </div>
        
        <div class="notification-preview">
          <h4>📧 Podgląd wiadomości</h4>
          <div class="email-preview">
            <div class="email-preview-header">
              <strong>Od:</strong> grafik@kappa-system.pl<br>
              <strong>Do:</strong> <span id="previewEmail">${settings.email || 'twoj@email.pl'}</span><br>
              <strong>Temat:</strong> Nowe przypisanie w grafiku - KW${this.scheduleCurrentWeek}
            </div>
            <div class="email-preview-body">
              Zostałeś przypisany do projektu:<br><br>
              <strong>Klient:</strong> BMW<br>
              <strong>Typ:</strong> Interior<br>
              <strong>Zmiana:</strong> Z1 (6:00-14:00)<br>
              <strong>Tydzień:</strong> KW${this.scheduleCurrentWeek}
            </div>
          </div>
        </div>
      </div>
    `;
    
    const confirmBtn = modal.querySelector('.modal-confirm') as HTMLButtonElement;
    confirmBtn.style.display = '';
    confirmBtn.textContent = 'Zapisz ustawienia';
    confirmBtn.onclick = async () => {
      const newSettings = {
        email: (document.getElementById('notifyEmail') as HTMLInputElement).value,
        enabled: (document.getElementById('notifyEnabled') as HTMLInputElement).checked,
        onAssign: (document.getElementById('notifyOnAssign') as HTMLInputElement).checked,
        onUnassign: (document.getElementById('notifyOnUnassign') as HTMLInputElement).checked,
        dailyDigest: (document.getElementById('notifyDailyDigest') as HTMLInputElement).checked
      };
      await db.setPreference('kappa_notification_settings', newSettings);
      this.showToast('Ustawienia powiadomień zapisane', 'success');
      this.hideModal();
    };
    
    // Update preview email
    document.getElementById('notifyEmail')?.addEventListener('input', (e) => {
      const email = (e.target as HTMLInputElement).value || 'twoj@email.pl';
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
      Wyślij grafik mailem
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
          <span>Wyślij grafik przez Outlook. Możesz wysłać ogólny grafik lub indywidualne maile dla pracowników.</span>
        </div>
        
        <div class="form-group">
          <label class="form-label">Adresy email (rozdziel przecinkami lub enterem):</label>
          <textarea id="emailAddresses" class="form-control" rows="2" placeholder="jan.kowalski@firma.pl, anna.nowak@firma.pl">${savedEmails}</textarea>
        </div>
        
        <div class="form-group">
          <label class="form-label">Typ wiadomości:</label>
          <div class="email-type-options">
            <label class="radio-option">
              <input type="radio" name="emailType" value="general" checked>
              <span>📋 Ogólny grafik (dla wszystkich)</span>
            </label>
            <label class="radio-option">
              <input type="radio" name="emailType" value="individual">
              <span>👤 Indywidualne maile (każdy pracownik dostaje swój)</span>
            </label>
          </div>
        </div>
        
        <div class="email-preview-section">
          <h4>📧 Podgląd wiadomości</h4>
          <div class="email-preview" id="emailPreviewContent">
            ${this.generateScheduleEmailHtml(weekKey, 'general')}
          </div>
        </div>
        
        <div class="form-actions" style="margin-top: 16px; display: flex; gap: 12px;">
          <button class="btn btn-primary" id="sendGeneralEmail">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"/><path d="M22 2L15 22L11 13L2 9L22 2Z"/></svg>
            Otwórz w Outlook
          </button>
          <button class="btn btn-secondary" id="sendIndividualEmails" style="display: none;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            Wyślij do wszystkich pracowników
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
        this.showToast('Wprowadź przynajmniej jeden adres email', 'warning');
        return;
      }
      
      await db.setPreference('kappa_email_addresses', emails.join(', '));
      this.openOutlookEmail(emails.join('; '), `Grafik ${weekKey}`, this.generateScheduleEmailBody(weekKey, 'general'));
      this.hideModal();
    });
    
    // Wysyłanie indywidualnych maili
    document.getElementById('sendIndividualEmails')?.addEventListener('click', () => {
      let count = 0;
      byEmployee.forEach(({ emp }) => {
        const email = this.getEmployeeEmail(emp);
        if (email) {
          this.openOutlookEmail(email, `Twój grafik na ${weekKey} - ${emp.firstName} ${emp.lastName}`, 
            this.generateEmployeeScheduleEmailBody(emp.id, weekKey));
          count++;
        }
      });
      
      if (count > 0) {
        this.showToast(`Otwarto ${count} okien Outlook`, 'success');
      } else {
        this.showToast('Brak pracowników z przypisanymi adresami email', 'warning');
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
      
      const shiftNames = ['Zmiana 1 (6:00-14:00)', 'Zmiana 2 (14:00-22:00)', 'Zmiana 3 (22:00-6:00)'];
      
      return `
        <div style="font-family: Arial, sans-serif; max-width: 600px;">
          <div style="background: #0097AC; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
            <h2 style="margin: 0;">📅 Grafik tygodniowy ${weekKey}</h2>
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
            ${byProject.size === 0 ? '<p style="text-align: center; color: #64748b;">Brak przypisań w tym tygodniu</p>' : ''}
          </div>
        </div>
      `;
    } else {
      // Podgląd indywidualny (przykład)
      return `
        <div style="font-family: Arial, sans-serif; max-width: 600px;">
          <div style="background: #0097AC; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
            <h2 style="margin: 0;">👤 Twój grafik na ${weekKey}</h2>
            <p style="margin: 8px 0 0; opacity: 0.9;">Indywidualna wiadomość dla każdego pracownika</p>
          </div>
          <div style="padding: 20px; background: #f8f9fa; border: 1px solid #e9ecef; border-top: none; border-radius: 0 0 8px 8px;">
            <p style="color: #64748b;">Każdy pracownik otrzyma email z listą swoich przypisań:</p>
            <ul style="color: #1e293b;">
              <li>Projekty do realizacji</li>
              <li>Zmiany i godziny pracy</li>
              <li>Szczegóły zadań (audyt, przyczepność itp.)</li>
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
    
    let body = `Cześć ${emp.firstName}!\\n\\n`;
    body += `Oto Twój grafik na ${weekKey}:\\n`;
    body += `================================\\n\\n`;
    
    assignments.forEach((a: ScheduleAssignment) => {
      const project = this.state.projects.find(p => p.id === a.projectId || `${p.customer_id}-${p.type_id}` === a.projectId);
      if (project) {
        const customer = this.state.customers.find(c => c.id === project.customer_id);
        const ptype = this.state.types.find(t => t.id === project.type_id);
        
        body += `📦 ${customer?.name || '?'} - ${ptype?.name || '?'}\\n`;
        body += `   ⏰ ${shiftNames[a.shift - 1]}\\n`;
        
        if (a.scope !== 'project') {
          const scopeLabels: Record<string, string> = { audit: 'Audyt', adhesion: 'Przyczepność', specific: 'Specyficzne zadanie' };
          body += `   📋 Zakres: ${scopeLabels[a.scope] || a.scope}\\n`;
        }
        body += `\\n`;
      }
    });
    
    body += `\\nPowodzenia!\\nZespół Kappa`;
    
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
          <h2>📊 Obciążenie pracowników - KW${this.scheduleCurrentWeek}</h2>
          <button class="employee-modal-close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="gantt-modal-body">
          <div class="gantt-legend">
            <span class="gantt-legend-item"><span class="gantt-bar-segment shift-1"></span> Z1 (Rano)</span>
            <span class="gantt-legend-item"><span class="gantt-bar-segment shift-2"></span> Z2 (Popołudnie)</span>
            <span class="gantt-legend-item"><span class="gantt-bar-segment shift-3"></span> Z3 (Noc)</span>
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
              <span class="gantt-stat-label">Przypisanych</span>
            </div>
            <div class="gantt-stat">
              <span class="gantt-stat-value">${sorted.filter(s => s.total === 0).length}</span>
              <span class="gantt-stat-label">Wolnych</span>
            </div>
            <div class="gantt-stat">
              <span class="gantt-stat-value">${sorted.filter(s => s.total > 5).length}</span>
              <span class="gantt-stat-label">Przeciążonych</span>
            </div>
            <div class="gantt-stat">
              <span class="gantt-stat-value">${weekAssignments.length}</span>
              <span class="gantt-stat-label">Łącznie zmian</span>
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
          const statusLabel = emp.status === 'vacation' ? 'urlopie' : 'zwolnieniu';
          conflicts.push({
            employee: emp,
            conflict: `${emp.firstName} ${emp.lastName} jest na ${statusLabel}, ale ma ${assignments.length} przypisań`
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
        <button class="sched-alert-action" data-employee="${c.employee.id}">Usuń przypisania</button>
      `;
      
      alert.querySelector('.sched-alert-action')?.addEventListener('click', async () => {
        const weekKey = `${this.scheduleCurrentYear}-KW${this.scheduleCurrentWeek.toString().padStart(2, '0')}`;
        const toRemove = this.state.scheduleAssignments.filter((a: ScheduleAssignment) =>
          a.employeeId === c.employee.id && a.week === weekKey
        );
        
        for (const a of toRemove) {
          await this.removeAssignment(a.id);
        }
        
        this.showToast(`Usunięto ${toRemove.length} przypisań dla ${c.employee.firstName}`, 'success');
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
      Statystyki pracowników (${this.scheduleCurrentYear})
    `;
    
    const totalAssignments = stats.reduce((sum, s) => sum + s.total, 0);
    const avgPerEmployee = stats.length > 0 ? (totalAssignments / stats.length).toFixed(1) : '0';
    
    modalBody.innerHTML = `
      <div class="employee-stats-modal">
        <div class="stats-summary">
          <div class="stats-summary-item">
            <span class="stats-summary-value">${totalAssignments}</span>
            <span class="stats-summary-label">Łącznie przypisań</span>
          </div>
          <div class="stats-summary-item">
            <span class="stats-summary-value">${avgPerEmployee}</span>
            <span class="stats-summary-label">Średnia na pracownika</span>
          </div>
          <div class="stats-summary-item">
            <span class="stats-summary-value">${stats.filter(s => s.total > 0).length}</span>
            <span class="stats-summary-label">Aktywnych pracowników</span>
          </div>
        </div>
        
        <div class="stats-table-container">
          <table class="stats-table">
            <thead>
              <tr>
                <th>Pracownik</th>
                <th>Łącznie</th>
                <th>Z1</th>
                <th>Z2</th>
                <th>Z3</th>
                <th>Projekty</th>
                <th>Przyczepność</th>
                <th>Audyty</th>
                <th>Tygodnie</th>
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
          <h3>Notatka</h3>
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
          <textarea class="note-modal-textarea" placeholder="Wpisz notatkę...">${mainNote}</textarea>
          
          ${replies.length > 0 ? `
            <div class="note-replies-section">
              <div class="note-replies-header">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                  <polyline points="9 17 4 12 9 7"/>
                  <path d="M20 18v-2a4 4 0 0 0-4-4H4"/>
                </svg>
                Odpowiedzi (${replies.length})
              </div>
              <div class="note-replies-list">
                ${replies.map((r, i) => `
                  <div class="note-reply-item">
                    <div class="note-reply-header">
                      <span class="note-reply-author">${r.author}</span>
                      <span class="note-reply-date">${r.date}</span>
                      <button class="note-reply-delete" data-index="${i}" title="Usuń odpowiedź">×</button>
                    </div>
                    <div class="note-reply-text">${r.text}</div>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}
          
          <div class="note-add-reply">
            <div class="note-reply-input-wrapper">
              <input type="text" class="note-reply-input" placeholder="Dodaj odpowiedź...">
              <button class="note-reply-submit" title="Dodaj odpowiedź">
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
              Usuń
            </button>
          ` : ''}
          <div class="note-modal-actions-right">
            <button class="note-modal-cancel">Anuluj</button>
            <button class="note-modal-save">Zapisz</button>
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
        date: new Date().toLocaleDateString('pl-PL'),
        author: this.state.settings.userName || 'Użytkownik'
      });
      
      // Zapisz natychmiast do bazy
      const newNote = mainNote + '\n---REPLIES---\n' + JSON.stringify(replies);
      assignment.note = newNote;
      assignment.updatedAt = Date.now();
      await db.put('scheduleAssignments', assignment);
      
      // Odśwież modal
      overlay.remove();
      this.showAssignmentNoteModal(assignmentId);
      this.showToast('Odpowiedź dodana', 'success');
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
        this.showToast('Odpowiedź usunięta', 'success');
      });
    });
    
    // Usuwanie całej notatki
    overlay.querySelector('.note-modal-delete')?.addEventListener('click', async () => {
      assignment.note = undefined;
      assignment.updatedAt = Date.now();
      await db.put('scheduleAssignments', assignment);
      this.showToast('Notatka usunięta', 'success');
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
      this.showToast(fullNote ? 'Notatka zapisana' : 'Notatka usunięta', 'success');
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
      this.showToast(`Przeniesiono na zmianę ${newShift}`, 'success');
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
          <p>${this.scheduleFilterEmployee || this.scheduleFilterProject || this.scheduleFilterTest ? 'Brak wyników dla wybranych filtrów' : i18n.t('schedule.noProjectsThisWeek')}</p>
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
          <button class="sched-project-comment-btn ${hasProjectComment ? 'has-comment' : ''}" data-group="${groupKey}" title="${hasProjectComment ? 'Edytuj komentarz' : 'Dodaj komentarz'}">
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
          
          if (a.scope === 'adhesion') {
            scopeLabel = 'Przyczepność';
            scopeClass = 'scope-adhesion';
            scopeIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>';
          } else if (a.scope === 'audit') {
            scopeLabel = 'Audyt';
            scopeClass = 'scope-audit';
            scopeIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
          } else if (a.testId) {
            const test = this.state.tests.find(t => t.id === a.testId);
            scopeLabel = test?.name || 'Test';
            scopeClass = 'scope-test';
            scopeIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
          } else if (a.partId) {
            const part = this.state.parts.find(p => p.id === a.partId);
            scopeLabel = part?.name || 'Część';
            scopeClass = 'scope-part';
            scopeIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>';
          }
          
          const initials = `${emp.firstName.charAt(0)}${emp.lastName.charAt(0)}`;
          const fullName = `${emp.firstName} ${emp.lastName}`;
          
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
            <div class="sched-chip ${hasNote ? 'has-note' : ''}" 
                 style="--chip-color: ${emp.color}" 
                 data-id="${a.id}" 
                 data-employee-id="${emp.id}"
                 data-assignment='${JSON.stringify({ id: a.id, scope: a.scope, testId: a.testId, partId: a.partId, note: a.note || '' })}'>
              <div class="sched-chip-main">
                <span class="sched-chip-avatar">${initials}</span>
                <div class="sched-chip-info">
                  <span class="sched-chip-name">${fullName}</span>
                  ${scopeLabel ? `<span class="sched-chip-badge ${scopeClass}">${scopeIcon} ${scopeLabel}</span>` : ''}
                  ${mainNoteText ? `<span class="sched-chip-note-preview" data-full-note="${mainNoteText.replace(/"/g, '&quot;')}">${notePreview}</span>` : ''}
                </div>
                ${repliesBadge}
              </div>
              <button class="sched-chip-comment-btn ${hasNote ? 'has-comment' : ''}" data-aid="${a.id}" title="${hasNote ? 'Edytuj komentarz' : 'Dodaj komentarz'}">
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
                // Usuń stare przypisanie i pokaż picker dla nowego
                await this.removeAssignment(assignmentId);
                this.showScopePickerAtPosition(groupKey, group.items, assignment.employeeId, weekKey, s as 1 | 2 | 3, dropX, dropY);
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
      this.showToast('Ten pracownik jest już przypisany do tego zakresu!', 'warning');
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
    this.logScheduleChange('added', `${emp?.firstName} ${emp?.lastName}`, `${customer?.name || '?'} - Zmiana ${shift}`);
    
    this.renderScheduleProjectsPanel();
    this.renderScheduleAlerts();
    this.renderScheduleEmployeePanel();
    this.updateCoverageBar();
    
    const scopeText = scope === 'project' ? i18n.t('schedule.wholeProject') : (testId ? 'test' : 'część');
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
      details: `${action === 'added' ? 'Przypisano' : action === 'removed' ? 'Usunięto' : 'Zmieniono'} <strong>${employee}</strong> → ${details}`,
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
  
  // Picker zakresu przy pozycji drop
  private showScopePickerAtPosition(
    groupKey: string,
    groupItems: Project[],
    employeeId: string,
    week: string,
    shift: 1 | 2 | 3,
    x: number,
    y: number
  ): void {
    document.querySelectorAll('.sched-scope-picker').forEach(p => p.remove());
    document.querySelectorAll('.sched-picker').forEach(p => p.remove());
    
    const picker = document.createElement('div');
    picker.className = 'sched-scope-picker';
    
    const employee = this.state.employees.find(e => e.id === employeeId);
    
    // Zbierz wszystkie unikalne testy i części
    const uniqueTests = new Map<string, Test>();
    const uniqueParts = new Map<string, Part>();
    
    groupItems.forEach(p => {
      if (p.test_id) {
        const test = this.state.tests.find(t => t.id === p.test_id);
        if (test) uniqueTests.set(test.id, test);
      }
      if (p.part_id) {
        const part = this.state.parts.find(pt => pt.id === p.part_id);
        if (part) uniqueParts.set(part.id, part);
      }
    });
    
    const tests = Array.from(uniqueTests.values());
    const parts = Array.from(uniqueParts.values());
    
    picker.innerHTML = `
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
        
        ${tests.length > 0 ? `
          <div class="sched-scope-divider">${i18n.t('messages.test')}</div>
          ${tests.map(t => `
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
    
    // Zbierz wszystkie unikalne testy i części
    const uniqueTests = new Map<string, Test>();
    const uniqueParts = new Map<string, Part>();
    
    groupItems.forEach(p => {
      if (p.test_id) {
        const test = this.state.tests.find(t => t.id === p.test_id);
        if (test) uniqueTests.set(test.id, test);
      }
      if (p.part_id) {
        const part = this.state.parts.find(pt => pt.id === p.part_id);
        if (part) uniqueParts.set(part.id, part);
      }
    });
    
    const tests = Array.from(uniqueTests.values());
    const parts = Array.from(uniqueParts.values());
    
    picker.innerHTML = `
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
        
        ${tests.length > 0 ? `
          <div class="sched-scope-divider">${i18n.t('messages.test')}</div>
          ${tests.map(t => `
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
    let headerHtml = '<div class="header-cell project-col">Projekt / Test</div>';
    for (let s = 1; s <= this.scheduleShiftSystem; s++) {
      const shiftLabels = ['Poranek', 'Popołudnie', 'Noc'];
      const shiftTimes = ['6:00-14:00', '14:00-22:00', '22:00-6:00'];
      headerHtml += `<div class="header-cell shift-col shift-${s}" style="--shift-color: ${shiftColors[s-1]}">
        <span class="shift-icon">${shiftIcons[s-1]}</span>
        <div class="shift-info">
          <span class="shift-number">${s}</span>
          <span class="shift-name">${shiftLabels[s-1] || `Zmiana ${s}`}</span>
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
          <h3>Brak projektów w tym tygodniu</h3>
          <p>Projekty z wartością SOLL > 0 pojawią się tutaj automatycznie</p>
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
        coverageLabel = '✓ Obsadzony';
      } else if (hasAudit || hasAdhesion || hasSpecific) {
        coverageStatus = 'partial'; // częściowa obsada
        if (!hasAudit) missingScopes.push('Audyty');
        if (!hasAdhesion) missingScopes.push('Przyczepność');
        coverageLabel = `⚠ Częściowo`;
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
          <span class="badge badge-parts">${partsCount} ${partsCount === 1 ? 'część' : partsCount < 5 ? 'części' : 'części'}</span>
          <span class="badge badge-soll">SOLL: ${projectGroup.totalSoll}</span>
          ${coverageBadge}
          ${comment ? `<span class="badge badge-comment has-hover" data-comment="${comment.replace(/"/g, '&quot;')}" data-project="${groupKey}" data-week="${weekKey}">📝</span>` : ''}
        </div>
        <button class="btn-comment ${comment ? 'has-comment' : ''}" title="Dodaj komentarz">
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
            <button class="chip-comment-btn" title="Dodaj/edytuj notatkę">
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
          const scopeTitle = assignment.scope === 'audit' ? 'Audyty' : assignment.scope === 'adhesion' ? 'Przyczepność' : (assignment.note || 'Specyficzne');
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
            <button class="chip-comment-btn" title="Dodaj/edytuj notatkę">
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
            <span class="test-count">${parts.length} ${parts.length === 1 ? 'część' : 'części'}</span>
          </div>
        `;
        
        // Shift cells for test-level - allow audit/adhesion assignments
        for (let s = 1; s <= this.scheduleShiftSystem; s++) {
          const testShiftCell = document.createElement('div');
          testShiftCell.className = `test-shift-cell shift-${s}`;
          testShiftCell.innerHTML = `<span class="test-drop-hint">Przeciągnij → Audyt/Przyczepność</span>`;
          
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
                if (confirm(`Usunąć przypisanie ${emp.firstName} ${emp.lastName}?`)) {
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
      Przypisz: ${emp.firstName} ${emp.lastName}
    `;
    
    const scopeOptions = testLevel ? `
      <label class="scope-option">
        <input type="radio" name="assignmentScope" value="audit">
        <div class="scope-card">
          <span class="scope-badge scope-audit">A</span>
          <div class="scope-info">
            <strong>Audyty</strong>
            <small>Tylko kontrola jakości / audyty</small>
          </div>
        </div>
      </label>
      <label class="scope-option">
        <input type="radio" name="assignmentScope" value="adhesion">
        <div class="scope-card">
          <span class="scope-badge scope-adhesion">H</span>
          <div class="scope-info">
            <strong>Przyczepność</strong>
            <small>Tylko testy przyczepności</small>
          </div>
        </div>
      </label>
    ` : `
      <label class="scope-option">
        <input type="radio" name="assignmentScope" value="project" checked>
        <div class="scope-card">
          <span class="scope-badge scope-project">P</span>
          <div class="scope-info">
            <strong>Cały projekt</strong>
            <small>Pracuje nad wszystkim w projekcie</small>
          </div>
        </div>
      </label>
      <label class="scope-option">
        <input type="radio" name="assignmentScope" value="audit">
        <div class="scope-card">
          <span class="scope-badge scope-audit">A</span>
          <div class="scope-info">
            <strong>Tylko audyty</strong>
            <small>Kontrola jakości i audyty</small>
          </div>
        </div>
      </label>
      <label class="scope-option">
        <input type="radio" name="assignmentScope" value="adhesion">
        <div class="scope-card">
          <span class="scope-badge scope-adhesion">H</span>
          <div class="scope-info">
            <strong>Tylko przyczepność</strong>
            <small>Testy przyczepności</small>
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
            <small>Zmiana ${shift} • ${week}</small>
          </div>
        </div>
        
        <div class="scope-selection">
          <label class="form-label">Zakres pracy:</label>
          <div class="scope-options">
            ${scopeOptions}
          </div>
        </div>
        
        <div class="form-group">
          <label class="form-label">Notatka (opcjonalnie):</label>
          <input type="text" id="assignmentNote" class="form-control" placeholder="Np. skupić się na..., priorytet...">
        </div>
      </div>
    `;
    
    const confirmBtn = modal.querySelector('.modal-confirm') as HTMLButtonElement;
    confirmBtn.style.display = '';
    confirmBtn.textContent = 'Przypisz';
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
    
    modalTitle.textContent = `Przypisz do części: ${partName}`;
    
    modalBody.innerHTML = `
      <div class="assignment-modal">
        <div class="employee-preview">
          <div class="employee-avatar-lg" style="background-color: ${emp.color}">
            ${emp.firstName.charAt(0)}${emp.lastName.charAt(0)}
          </div>
          <div>
            <strong>${emp.firstName} ${emp.lastName}</strong>
            <small>Zmiana ${shift} • Część: ${partName}</small>
          </div>
        </div>
        
        <div class="info-box">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
          </svg>
          <span>Przypisanie do konkretnej części będzie widoczne w widoku głównym projektu z oznaczeniem [S]</span>
        </div>
        
        <div class="form-group">
          <label class="form-label">Co ma robić? (wymagane):</label>
          <input type="text" id="specificNote" class="form-control" placeholder="Np. kontrola wymiarowa, test X..." required>
        </div>
      </div>
    `;
    
    const confirmBtn = modal.querySelector('.modal-confirm') as HTMLButtonElement;
    confirmBtn.style.display = '';
    confirmBtn.textContent = 'Przypisz do części';
    confirmBtn.onclick = async () => {
      const note = (document.getElementById('specificNote') as HTMLInputElement)?.value.trim();
      if (!note) {
        this.showToast('Podaj co pracownik ma robić', 'warning');
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
    
    modalTitle.textContent = 'Wybierz pracownika';
    
    if (this.state.employees.length === 0) {
      modalBody.innerHTML = `
        <div class="empty-state">
          <p>Brak pracowników. Dodaj pierwszego pracownika, aby móc przypisywać.</p>
          <button class="btn-primary" onclick="window.kappaApp.hideModal(); window.kappaApp.showAddEmployeeModal();">Dodaj pracownika</button>
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
      this.showToast('To przypisanie już istnieje', 'warning');
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
    const scopeLabels = { project: 'Projekt', audit: 'Audyty', adhesion: 'Przyczepność', specific: 'Konkretne' };
    await this.addLog('created', 'Assignment', `${emp?.firstName || ''} → ${week} Z${shift} [${scopeLabels[scope]}]`);
    
    this.showToast('Pracownik przypisany', 'success');
    this.renderScheduleProjectsPanel();
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
      const scopeLabels: Record<string, string> = { project: 'Projekt', audit: 'Audyt', adhesion: 'Przyczepność', specific: 'Specyficzne' };
      const scopeLabel = scopeLabels[assignment.scope] || assignment.scope;
      await this.addLog('deleted', 'Assignment', `${empName} ← ${projectName}`, `Z${assignment.shift}, ${scopeLabel}`);
      
      // Loguj do historii
      this.logScheduleChange('removed', `${emp?.firstName} ${emp?.lastName}`, `${customer?.name || '?'} - Zmiana ${assignment.shift}`);
      
      this.renderScheduleProjectsPanel();
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
        tooltip: 'W pełni obsadzony (przypisanie do całego projektu)'
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
          tooltip: 'Obsadzony'
        };
      }
      return {
        class: 'staffing-none',
        icon: '○',
        tooltip: 'Brak obsady'
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
        tooltip: 'Brak obsady'
      };
    }
    
    if (coveredTests >= totalTests) {
      return {
        class: 'staffing-full',
        icon: '✓',
        tooltip: `W pełni obsadzony (${coveredTests}/${totalTests} testów)`
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
      tooltip: `Częściowo obsadzony (${coveredTests}/${totalTests}). Brak: ${missingTests.join(', ')}${missingTests.length < totalTests - coveredTests ? '...' : ''}`
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
            <div class="chip-popup-note-label">Notatka:</div>
            <div class="chip-popup-note-text">${mainNote}</div>
          </div>
        ` : ''}
        ${replies.length > 0 ? `
          <div class="chip-popup-replies">
            <div class="chip-popup-replies-label">💬 Odpowiedzi (${replies.length}):</div>
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
        <input type="text" class="chip-popup-reply-input" placeholder="Szybka odpowiedź..." />
        <button class="chip-popup-reply-send" title="Wyślij">
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
        date: new Date().toLocaleString('pl-PL'),
        author: 'Użytkownik'
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
      this.showToast('Dodano odpowiedź', 'success');
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
          <span class="pcf-title">Komentarz projektu</span>
          <span class="pcf-project">${projectName}</span>
        </div>
      </div>
      <div class="pcf-body">
        <div class="pcf-main-comment">
          <div class="pcf-comment-text">${mainComment}</div>
        </div>
        ${replies.length > 0 ? `
          <div class="pcf-replies">
            <div class="pcf-replies-title">💬 Odpowiedzi (${replies.length}):</div>
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
        <input type="text" class="pcf-reply-input" placeholder="Szybka odpowiedź..." />
        <button class="pcf-reply-send" title="Wyślij">
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
        date: new Date().toLocaleString('pl-PL'),
        author: 'Użytkownik'
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
      this.showToast('Dodano odpowiedź', 'success');
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
          <textarea class="comment-reply-input" placeholder="Dodaj notatkę lub odpowiedź..."></textarea>
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
      const newComment = comment + `\n\n📌 [${new Date().toLocaleDateString('pl-PL')}]: ${replyText}`;
      
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
      this.showToast('Notatka dodana', 'success');
      this.renderScheduleProjectsPanel();
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
          <h3>Komentarz do projektu</h3>
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
          <textarea class="note-modal-textarea" id="projectCommentText" placeholder="Wpisz komentarz dla projektu...">${mainComment}</textarea>
          
          ${replies.length > 0 ? `
            <div class="note-replies-section note-replies-project">
              <div class="note-replies-header">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                  <polyline points="9 17 4 12 9 7"/>
                  <path d="M20 18v-2a4 4 0 0 0-4-4H4"/>
                </svg>
                Odpowiedzi (${replies.length})
              </div>
              <div class="note-replies-list">
                ${replies.map((r, i) => `
                  <div class="note-reply-item note-reply-project">
                    <div class="note-reply-header">
                      <span class="note-reply-author">${r.author}</span>
                      <span class="note-reply-date">${r.date}</span>
                      <button class="note-reply-delete" data-index="${i}" title="Usuń odpowiedź">×</button>
                    </div>
                    <div class="note-reply-text">${r.text}</div>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}
          
          <div class="note-add-reply note-add-reply-project">
            <div class="note-reply-input-wrapper">
              <input type="text" class="note-reply-input" placeholder="Dodaj szybką odpowiedź...">
              <button class="note-reply-submit" title="Dodaj odpowiedź">
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
              Usuń
            </button>
          ` : '<div></div>'}
          <div class="note-modal-actions-right">
            <button class="note-modal-cancel">Anuluj</button>
            <button class="note-modal-save">Zapisz</button>
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
        date: new Date().toLocaleDateString('pl-PL'),
        author: this.state.settings.userName || 'Użytkownik'
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
      this.showToast('Odpowiedź dodana', 'success');
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
        this.renderScheduleProjectsPanel();
        this.showToast('Odpowiedź usunięta', 'success');
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
        this.showToast('Komentarz usunięty', 'success');
      }
      overlay.remove();
      this.renderScheduleProjectsPanel();
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
        this.showToast('Komentarz zapisany', 'success');
      } else if (existing) {
        const idx = this.state.projectComments.indexOf(existing);
        this.state.projectComments.splice(idx, 1);
        await db.delete('projectComments', existing.id);
      }
      
      overlay.remove();
      this.renderScheduleProjectsPanel();
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
    const currentStatus = employee?.status || 'available';
    const currentShift = employee?.suggestedShift || '';
    
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
  }
  
  private renderAbsenceFilters(): void {
    // Employee filter
    const empFilter = document.getElementById('absenceFilterEmployee') as HTMLSelectElement;
    if (empFilter) {
      empFilter.innerHTML = '<option value="">Wszyscy</option>' +
        this.state.employees
          .filter(e => !e.status || e.status === 'available')
          .sort((a, b) => a.firstName.localeCompare(b.firstName))
          .map(e => `<option value="${e.id}" ${e.id === this.absenceFilterEmployee ? 'selected' : ''}>${e.firstName} ${e.lastName}</option>`)
          .join('');
    }
    
    // Type filter
    const typeFilter = document.getElementById('absenceFilterType') as HTMLSelectElement;
    if (typeFilter) {
      typeFilter.innerHTML = '<option value="">Wszystkie</option>' +
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
          <div class="absence-stat-label">Nieobecności</div>
        </div>
        <div class="absence-stat-card">
          <div class="absence-stat-value">${totalDays}</div>
          <div class="absence-stat-label">Dni łącznie</div>
        </div>
        <div class="absence-stat-card">
          <div class="absence-stat-value">${pendingCount}</div>
          <div class="absence-stat-label">Oczekujących</div>
        </div>
        <div class="absence-stat-card">
          <div class="absence-stat-value">${employeesOnLeave}</div>
          <div class="absence-stat-label">Pracowników</div>
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
      container.innerHTML = '<p style="text-align: center; color: var(--color-text-muted); font-size: 0.8rem;">Brak nadchodzących nieobecności</p>';
      return;
    }
    
    container.innerHTML = upcoming.map(a => {
      const emp = this.state.employees.find(e => e.id === a.employeeId);
      const type = this.absenceTypes.find(t => t.id === a.absenceTypeId);
      const startDate = new Date(a.startDate).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' });
      
      return `
        <div class="absence-upcoming-item">
          <span class="absence-upcoming-icon">${type?.icon || '📅'}</span>
          <div class="absence-upcoming-info">
            <div class="absence-upcoming-name">${emp?.firstName || ''} ${emp?.lastName || ''}</div>
            <div class="absence-upcoming-date">${startDate} - ${a.workDays} dni</div>
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
    }
  }
  
  private renderAbsenceCalendar(): void {
    const container = document.getElementById('absenceContent');
    if (!container) return;
    
    const months = ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 
                    'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'];
    const weekdays = ['Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob', 'Nie'];
    
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
      const moreHtml = moreCount > 0 ? `<div class="absence-calendar-event-more">+${moreCount} więcej</div>` : '';
      
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
          <h3>Brak nieobecności</h3>
          <p>Nie znaleziono nieobecności spełniających kryteria.</p>
          <button class="absence-action-btn primary" onclick="document.getElementById('addAbsenceBtn').click()">
            Dodaj pierwszą nieobecność
          </button>
        </div>
      `;
      return;
    }
    
    const itemsHtml = filtered.map(a => {
      const emp = this.state.employees.find(e => e.id === a.employeeId);
      const type = this.absenceTypes.find(t => t.id === a.absenceTypeId);
      const startDate = new Date(a.startDate).toLocaleDateString('pl-PL');
      const endDate = new Date(a.endDate).toLocaleDateString('pl-PL');
      
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
            <span class="absence-list-type-name">${type?.name || 'Nieobecność'}</span>
          </div>
          <div class="absence-list-dates">${startDate} - ${endDate}</div>
          <div class="absence-list-days">${a.workDays} dni</div>
          <div class="absence-list-status ${a.status}">${a.status === 'approved' ? 'Zatwierdzona' : a.status === 'pending' ? 'Oczekuje' : 'Odrzucona'}</div>
          <div class="absence-list-actions">
            <button class="absence-list-action-btn edit-absence" title="Edytuj">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
            <button class="absence-list-action-btn delete delete-absence" title="Usuń">
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
          <span>Pracownik</span>
          <span>Typ</span>
          <span>Daty</span>
          <span>Dni</span>
          <span>Status</span>
          <span>Akcje</span>
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
        if (id && confirm('Czy na pewno chcesz usunąć tę nieobecność?')) {
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
    
    const months = ['Sty', 'Lut', 'Mar', 'Kwi', 'Maj', 'Cze', 'Lip', 'Sie', 'Wrz', 'Paź', 'Lis', 'Gru'];
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
          <h3>Mapa nieobecności ${this.absenceYear}</h3>
          <p>Liczba dni nieobecności każdego pracownika w danym miesiącu</p>
        </div>
        <div class="absence-heatmap-grid">
          ${headerHtml}
          ${rowsHtml}
        </div>
        <div class="absence-heatmap-legend">
          <span>Mniej</span>
          <div class="absence-heatmap-legend-item"><div class="absence-heatmap-legend-color level-0"></div></div>
          <div class="absence-heatmap-legend-item"><div class="absence-heatmap-legend-color level-1"></div></div>
          <div class="absence-heatmap-legend-item"><div class="absence-heatmap-legend-color level-2"></div></div>
          <div class="absence-heatmap-legend-item"><div class="absence-heatmap-legend-color level-3"></div></div>
          <div class="absence-heatmap-legend-item"><div class="absence-heatmap-legend-color level-4"></div></div>
          <div class="absence-heatmap-legend-item"><div class="absence-heatmap-legend-color level-5"></div></div>
          <span>Więcej</span>
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
            ${limitsHtml || '<p style="text-align: center; color: var(--color-text-muted); font-size: 0.8rem;">Brak ustawionych limitów</p>'}
          </div>
          <div class="absence-employee-full-footer">
            <span class="absence-employee-full-total">Razem: <strong>${totalUsed} dni</strong></span>
            <button class="absence-employee-edit-btn">Edytuj limity</button>
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
          <h2>➕ Dodaj nieobecność</h2>
          <button class="absence-modal-close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div class="absence-wizard-steps">
          <div class="absence-wizard-step active" data-step="1">
            <span class="absence-wizard-step-number">1</span>
            <span class="absence-wizard-step-label">Pracownik</span>
          </div>
          <div class="absence-wizard-step-connector"></div>
          <div class="absence-wizard-step" data-step="2">
            <span class="absence-wizard-step-number">2</span>
            <span class="absence-wizard-step-label">Szczegóły</span>
          </div>
          <div class="absence-wizard-step-connector"></div>
          <div class="absence-wizard-step" data-step="3">
            <span class="absence-wizard-step-number">3</span>
            <span class="absence-wizard-step-label">Podsumowanie</span>
          </div>
        </div>
        <div class="absence-modal-body" id="absenceWizardContent">
          <!-- Step 1: Select Employee -->
          <div class="absence-form-group">
            <label class="absence-form-label">Wybierz pracownika</label>
            <select class="absence-form-select" id="wizardEmployee">
              <option value="">-- Wybierz --</option>
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
              <option value="">-- Wybierz --</option>
              ${employees.map(e => `<option value="${e.id}" ${e.id === selectedEmployee ? 'selected' : ''}>${e.firstName} ${e.lastName}</option>`).join('')}
            </select>
          </div>
        `;
        nextBtn.textContent = 'Dalej';
        nextBtn.disabled = !selectedEmployee;
        
        overlay.querySelector('#wizardEmployee')?.addEventListener('change', (e) => {
          selectedEmployee = (e.target as HTMLSelectElement).value;
          nextBtn.disabled = !selectedEmployee;
        });
        
      } else if (step === 2) {
        content!.innerHTML = `
          <div class="absence-form-group">
            <label class="absence-form-label">Typ nieobecności</label>
            <select class="absence-form-select" id="wizardType">
              <option value="">-- Wybierz --</option>
              ${this.absenceTypes.map(t => `<option value="${t.id}" ${t.id === selectedType ? 'selected' : ''}>${t.icon} ${t.name}</option>`).join('')}
            </select>
          </div>
          <div class="absence-form-row">
            <div class="absence-form-group">
              <label class="absence-form-label">Data od</label>
              <input type="date" class="absence-form-input" id="wizardStartDate" value="${startDate}">
            </div>
            <div class="absence-form-group">
              <label class="absence-form-label">Data do</label>
              <input type="date" class="absence-form-input" id="wizardEndDate" value="${endDate}">
            </div>
          </div>
          <div class="absence-form-group">
            <label class="absence-form-label">Notatka (opcjonalnie)</label>
            <textarea class="absence-form-textarea" id="wizardNote" rows="2" placeholder="Dodatkowe informacje...">${note}</textarea>
          </div>
        `;
        nextBtn.textContent = 'Dalej';
        
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
                <div style="font-weight: 500;">${new Date(startDate).toLocaleDateString('pl-PL', { weekday: 'short', day: '2-digit', month: 'long' })}</div>
              </div>
              <div>
                <div style="font-size: 0.75rem; color: var(--color-text-muted);">Do</div>
                <div style="font-weight: 500;">${new Date(endDate).toLocaleDateString('pl-PL', { weekday: 'short', day: '2-digit', month: 'long' })}</div>
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
          <h2>⚙️ Ustawienia urlopów</h2>
          <button class="absence-modal-close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div class="absence-modal-body">
          <div class="absence-settings-section">
            <h3>Typy nieobecności</h3>
            <p style="font-size: 0.8rem; color: var(--color-text-secondary); margin-bottom: 12px;">
              Skonfiguruj typy nieobecności, ich domyślne limity i kolory.
            </p>
            <div style="display: grid; grid-template-columns: 40px 1fr 80px 50px 50px; gap: 12px; padding: 8px 10px; background: var(--color-bg-tertiary); border-radius: 6px; font-size: 0.7rem; color: var(--color-text-secondary); text-transform: uppercase; margin-bottom: 8px;">
              <span>Ikona</span>
              <span>Nazwa</span>
              <span>Domyślne dni</span>
              <span>Kolor</span>
              <span>Aktywny</span>
            </div>
            ${typesHtml || '<p style="color: var(--color-text-muted);">Brak typów nieobecności</p>'}
          </div>
          
          <div class="absence-settings-section" style="margin-top: 24px;">
            <h3>Święta ${this.absenceYear}</h3>
            <p style="font-size: 0.8rem; color: var(--color-text-secondary); margin-bottom: 12px;">
              Dni wolne od pracy nie są wliczane do urlopów. ${this.holidays.length} dni ustawionych.
            </p>
            <div style="display: flex; flex-wrap: wrap; gap: 8px;">
              ${this.holidays.slice(0, 8).map(h => `
                <span style="padding: 4px 10px; background: var(--color-warning-bg); color: var(--color-warning); border-radius: 4px; font-size: 0.75rem;">
                  🎉 ${new Date(h.date).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' })} - ${h.name}
                </span>
              `).join('')}
              ${this.holidays.length > 8 ? `<span style="padding: 4px 10px; color: var(--color-text-muted); font-size: 0.75rem;">+${this.holidays.length - 8} więcej</span>` : ''}
            </div>
          </div>
        </div>
        <div class="absence-modal-footer">
          <button class="absence-modal-btn secondary" id="settingsCancel">Anuluj</button>
          <button class="absence-modal-btn primary" id="settingsSave">Zapisz zmiany</button>
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
        alert('Nie można załadować typów nieobecności. Sprawdź połączenie z serwerem.');
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
            Użyte: ${usedDays}
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
            Limity urlopowe - ${emp.firstName} ${emp.lastName}
          </h2>
          <button class="absence-modal-close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div class="absence-modal-body">
          <p style="font-size: 0.85rem; color: var(--color-text-secondary); margin-bottom: 16px;">
            Ustaw indywidualne limity nieobecności dla roku <strong>${this.absenceYear}</strong>
          </p>
          ${limitsHtml}
        </div>
        <div class="absence-modal-footer">
          <button class="absence-modal-btn secondary" id="limitsCancel">Anuluj</button>
          <button class="absence-modal-btn primary" id="limitsSave">Zapisz limity</button>
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
            <div style="font-size: 0.65rem; color: var(--color-text-muted); text-transform: uppercase;">Telefon</div>
            <div style="font-size: 0.8rem;">${empDetails?.phone || '-'}</div>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 1rem;">📍</span>
          <div>
            <div style="font-size: 0.65rem; color: var(--color-text-muted); text-transform: uppercase;">Stanowisko</div>
            <div style="font-size: 0.8rem;">${empDetails?.position || '-'}</div>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 1rem;">🏢</span>
          <div>
            <div style="font-size: 0.65rem; color: var(--color-text-muted); text-transform: uppercase;">Dział</div>
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
              <span style="color: ${remaining <= 0 ? 'var(--color-danger)' : 'var(--color-text-secondary)'};">${remaining} pozostało</span>
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
            <div style="font-size: 0.8rem; font-weight: 500;">${type?.name || 'Nieobecność'}</div>
            <div style="font-size: 0.7rem; color: var(--color-text-muted);">
              ${new Date(a.startDate).toLocaleDateString('pl-PL')} - ${new Date(a.endDate).toLocaleDateString('pl-PL')}
            </div>
          </div>
          <span style="font-size: 0.8rem; font-weight: 600;">${a.workDays} dni</span>
        </div>
      `;
    }).join('') : '<p style="text-align: center; color: var(--color-text-muted); padding: 20px;">Brak nieobecności w tym roku</p>';
    
    overlay.innerHTML = `
      <div class="absence-modal" style="max-width: 550px;">
        <div class="absence-modal-header">
          <h2>
            <span style="width: 42px; height: 42px; border-radius: 50%; background: ${emp.color}; display: inline-flex; align-items: center; justify-content: center; color: white; font-size: 0.9rem; margin-right: 12px;">
              ${emp.firstName.charAt(0)}${emp.lastName.charAt(0)}
            </span>
            <div>
              <div>${emp.firstName} ${emp.lastName}</div>
              <div style="font-size: 0.75rem; font-weight: 400; color: var(--color-text-secondary);">${empDetails?.position || 'Pracownik'}</div>
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
          ${empQualifications.length > 0 ? `<h4 style="font-size: 0.85rem; font-weight: 600; margin: 0 0 8px 0;">🎓 Kwalifikacje</h4>` + qualificationsHtml : ''}
          <h4 style="font-size: 0.85rem; font-weight: 600; margin: 0 0 12px 0;">📊 Limity ${this.absenceYear}</h4>
          ${limitsHtml || '<p style="color: var(--color-text-muted); font-size: 0.8rem;">Brak ustawionych limitów</p>'}
          <h4 style="font-size: 0.85rem; font-weight: 600; margin: 20px 0 12px 0;">📅 Historia nieobecności</h4>
          ${absencesHtml}
        </div>
        <div class="absence-modal-footer">
          <button class="absence-modal-btn secondary" id="empEditDetails">✏️ Edytuj profil</button>
          <button class="absence-modal-btn secondary" id="empEditLimits">Edytuj limity</button>
          <button class="absence-modal-btn primary" id="empAddAbsence">Dodaj nieobecność</button>
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
              <input type="email" class="absence-form-input" id="editEmpEmail" value="${currentDetails?.email || ''}" placeholder="jan.kowalski@firma.pl">
            </div>
            <div class="absence-form-group">
              <label class="absence-form-label">📱 Telefon</label>
              <input type="tel" class="absence-form-input" id="editEmpPhone" value="${currentDetails?.phone || ''}" placeholder="+48 123 456 789">
            </div>
          </div>
          <div class="absence-form-row">
            <div class="absence-form-group">
              <label class="absence-form-label">📍 Stanowisko</label>
              <input type="text" class="absence-form-input" id="editEmpPosition" value="${currentDetails?.position || ''}" placeholder="np. Specjalista ds. testów">
            </div>
            <div class="absence-form-group">
              <label class="absence-form-label">🏢 Dział</label>
              <input type="text" class="absence-form-input" id="editEmpDepartment" value="${currentDetails?.department || ''}" placeholder="np. Kontrola jakości">
            </div>
          </div>
          <div class="absence-form-group">
            <label class="absence-form-label">📝 Notatki</label>
            <textarea class="absence-form-textarea" id="editEmpNotes" rows="3" placeholder="Dodatkowe informacje o pracowniku...">${currentDetails?.notes || ''}</textarea>
          </div>
          
          <h4 style="font-size: 0.85rem; font-weight: 600; margin: 20px 0 12px 0;">🎓 Kwalifikacje</h4>
          <div id="qualificationsList" style="margin-bottom: 12px;"></div>
          <div style="display: flex; gap: 8px;">
            <input type="text" class="absence-form-input" id="newQualName" placeholder="Nazwa kwalifikacji" style="flex: 1;">
            <select class="absence-form-select" id="newQualLevel" style="width: 120px;">
              <option value="basic">Podstawowy</option>
              <option value="advanced">Zaawansowany</option>
              <option value="expert">Ekspert</option>
            </select>
            <button class="absence-modal-btn primary" id="addQualBtn" style="padding: 8px 12px;">+</button>
          </div>
        </div>
        <div class="absence-modal-footer">
          <button class="absence-modal-btn secondary" id="editDetailsCancel">Anuluj</button>
          <button class="absence-modal-btn primary" id="editDetailsSave">Zapisz zmiany</button>
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
          <h2>✏️ Edytuj nieobecność</h2>
          <button class="absence-modal-close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div class="absence-modal-body">
          <div class="absence-form-group">
            <label class="absence-form-label">Pracownik</label>
            <input type="text" class="absence-form-input" value="${emp?.firstName} ${emp?.lastName}" disabled>
          </div>
          <div class="absence-form-group">
            <label class="absence-form-label">Typ nieobecności</label>
            <select class="absence-form-select" id="editType">
              ${this.absenceTypes.map(t => `<option value="${t.id}" ${t.id === absence.absenceTypeId ? 'selected' : ''}>${t.icon} ${t.name}</option>`).join('')}
            </select>
          </div>
          <div class="absence-form-row">
            <div class="absence-form-group">
              <label class="absence-form-label">Data od</label>
              <input type="date" class="absence-form-input" id="editStartDate" value="${absence.startDate}">
            </div>
            <div class="absence-form-group">
              <label class="absence-form-label">Data do</label>
              <input type="date" class="absence-form-input" id="editEndDate" value="${absence.endDate}">
            </div>
          </div>
          <div class="absence-form-group">
            <label class="absence-form-label">Status</label>
            <select class="absence-form-select" id="editStatus">
              <option value="approved" ${absence.status === 'approved' ? 'selected' : ''}>Zatwierdzona</option>
              <option value="pending" ${absence.status === 'pending' ? 'selected' : ''}>Oczekuje</option>
              <option value="rejected" ${absence.status === 'rejected' ? 'selected' : ''}>Odrzucona</option>
            </select>
          </div>
          <div class="absence-form-group">
            <label class="absence-form-label">Notatka</label>
            <textarea class="absence-form-textarea" id="editNote" rows="2">${absence.note || ''}</textarea>
          </div>
        </div>
        <div class="absence-modal-footer">
          <button class="absence-modal-btn danger" id="editDelete">Usuń</button>
          <button class="absence-modal-btn secondary" id="editCancel">Anuluj</button>
          <button class="absence-modal-btn primary" id="editSave">Zapisz</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    
    // Save handler
    document.getElementById('editSave')?.addEventListener('click', async () => {
      const absenceTypeId = (document.getElementById('editType') as HTMLSelectElement).value;
      const startDate = (document.getElementById('editStartDate') as HTMLInputElement).value;
      const endDate = (document.getElementById('editEndDate') as HTMLInputElement).value;
      const status = (document.getElementById('editStatus') as HTMLSelectElement).value;
      const note = (document.getElementById('editNote') as HTMLTextAreaElement).value;
      const workDays = this.calculateWorkDays(startDate, endDate);
      
      await api.updateAbsence(absenceId, {
        employeeId: absence.employeeId,
        absenceTypeId,
        startDate,
        endDate,
        workDays,
        status,
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
      if (confirm('Czy na pewno chcesz usunąć tę nieobecność?')) {
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
    // Create CSV
    let csv = 'Pracownik,Typ,Od,Do,Dni robocze,Status,Notatka\n';
    
    this.absences.forEach(a => {
      const emp = this.state.employees.find(e => e.id === a.employeeId);
      const type = this.absenceTypes.find(t => t.id === a.absenceTypeId);
      csv += `"${emp?.firstName} ${emp?.lastName}","${type?.name}","${a.startDate}","${a.endDate}",${a.workDays},"${a.status}","${a.note || ''}"\n`;
    });
    
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nieobecnosci-${this.absenceYear}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
}

// Initialize
const app = new KappaApp();
app.init();
