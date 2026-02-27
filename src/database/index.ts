import { api } from '../api/client';
import { Customer, Type, Part, Test, Project, AppSettings, Employee, ScheduleAssignment } from '../types';

/**
 * Database class - uses SQLite backend via REST API
 * This is a drop-in replacement for the old IndexedDB-based database
 */
class Database {
  async init(): Promise<void> {
    // Check if API is available
    try {
      const ok = await api.healthCheck();
      if (ok) {
        console.log('✅ Connected to SQLite backend');
      }
    } catch (error) {
      console.warn('⚠️ API not available, using fallback');
    }
  }

  // Generic get method for compatibility
  async get<T>(store: string, key: string): Promise<T | undefined> {
    try {
      if (store === 'settings') {
        const settings = await api.getSettings();
        return { key, value: settings } as unknown as T;
      }
      return undefined;
    } catch (error) {
      console.error(`Error getting ${store}/${key}:`, error);
      return undefined;
    }
  }

  // Generic getAll method for compatibility
  async getAll<T>(store: string): Promise<T[]> {
    try {
      switch (store) {
        case 'customers':
          return await api.getCustomers() as unknown as T[];
        case 'types':
          return await api.getTypes() as unknown as T[];
        case 'parts':
          return await api.getParts() as unknown as T[];
        case 'tests':
          return await api.getTests() as unknown as T[];
        case 'projects':
          return await api.getProjects() as unknown as T[];
        case 'employees':
          return await api.getEmployees() as unknown as T[];
        case 'scheduleAssignments':
          return await api.getScheduleAssignments() as unknown as T[];
        case 'logs':
          return await api.getLogs() as unknown as T[];
        case 'comments':
          return await api.getComments() as unknown as T[];
        case 'projectComments':
          return await api.getComments() as unknown as T[];
        case 'scheduleEntries':
          return [] as T[]; // Deprecated
        default:
          console.warn(`Unknown store: ${store}`);
          return [];
      }
    } catch (error) {
      console.error(`Error getting all from ${store}:`, error);
      return [];
    }
  }

  // Generic put method for compatibility (upsert)
  async put<T extends { id?: string; key?: string }>(store: string, item: T): Promise<void> {
    try {
      switch (store) {
        case 'customers':
          await api.addCustomer(item as unknown as Customer);
          break;
        case 'types':
          await api.addType(item as unknown as Type);
          break;
        case 'parts':
          await api.addPart(item as unknown as Part);
          break;
        case 'tests':
          await api.addTest(item as unknown as Test);
          break;
        case 'projects':
          await api.addProject(item as unknown as Project);
          break;
        case 'employees':
          await api.addEmployee(item);
          break;
        case 'scheduleAssignments':
          await api.addScheduleAssignment(item);
          break;
        case 'logs':
          await api.addLog(item);
          break;
        case 'comments':
        case 'projectComments':
          await api.addComment(item);
          break;
        case 'settings':
          await api.updateSettings((item as any).value);
          break;
        default:
          console.warn(`Unknown store for put: ${store}`);
      }
    } catch (error) {
      console.error(`Error putting to ${store}:`, error);
    }
  }

  // Generic add method (same as put for API)
  async add<T extends { id: string }>(store: string, item: T): Promise<void> {
    return this.put(store, item);
  }

  // Generic delete method
  async delete(store: string, id: string): Promise<void> {
    try {
      switch (store) {
        case 'customers':
          await api.deleteCustomer(id);
          break;
        case 'types':
          await api.deleteType(id);
          break;
        case 'parts':
          await api.deletePart(id);
          break;
        case 'tests':
          await api.deleteTest(id);
          break;
        case 'projects':
          await api.deleteProject(id);
          break;
        case 'employees':
          await api.deleteEmployee(id);
          break;
        case 'scheduleAssignments':
          await api.deleteScheduleAssignment(id);
          break;
        case 'comments':
        case 'projectComments':
          await api.deleteComment(id);
          break;
        default:
          console.warn(`Unknown store for delete: ${store}`);
      }
    } catch (error) {
      console.error(`Error deleting from ${store}:`, error);
    }
  }

  // Customers
  async getCustomers(): Promise<Customer[]> {
    return api.getCustomers();
  }

  async addCustomer(customer: Customer): Promise<void> {
    await api.addCustomer(customer);
  }

  async updateCustomer(customer: Customer): Promise<void> {
    await api.updateCustomer(customer);
  }

  async deleteCustomer(id: string): Promise<void> {
    await api.deleteCustomer(id);
  }

  // Types
  async getTypes(): Promise<Type[]> {
    return api.getTypes();
  }

  async addType(type: Type): Promise<void> {
    await api.addType(type);
  }

  async updateType(type: Type): Promise<void> {
    await api.updateType(type);
  }

  async deleteType(id: string): Promise<void> {
    await api.deleteType(id);
  }

  // Parts
  async getParts(): Promise<Part[]> {
    return api.getParts();
  }

  async addPart(part: Part): Promise<void> {
    await api.addPart(part);
  }

  async updatePart(part: Part): Promise<void> {
    await api.updatePart(part);
  }

  async deletePart(id: string): Promise<void> {
    await api.deletePart(id);
  }

  // Tests
  async getTests(): Promise<Test[]> {
    return api.getTests();
  }

  async addTest(test: Test): Promise<void> {
    await api.addTest(test);
  }

  async updateTest(test: Test): Promise<void> {
    await api.updateTest(test);
  }

  async deleteTest(id: string): Promise<void> {
    await api.deleteTest(id);
  }

  // Projects
  async getProjects(): Promise<Project[]> {
    return api.getProjects();
  }

  async addProject(project: Project): Promise<void> {
    await api.addProject(project);
  }

  async updateProject(project: Project): Promise<void> {
    await api.updateProject(project);
  }

  async deleteProject(id: string): Promise<void> {
    await api.deleteProject(id);
  }

  // Settings
  async getSettings(): Promise<AppSettings> {
    try {
      return await api.getSettings();
    } catch {
      return {
        language: 'en',
        darkMode: true,
        animations: true,
        highlightMissing: true,
        blinkAlerts: true,
        deletePassword: '',
        userName: '',
        zoomLevel: 100,
        editMode: false,
        shiftSystem: 2,
        backupPath: '',
        backupFrequency: 'none',
        lastBackupDate: '',
      };
    }
  }

  async updateSettings(settings: AppSettings): Promise<void> {
    await api.updateSettings(settings);
  }

  // Employees
  async getEmployees(): Promise<Employee[]> {
    return api.getEmployees();
  }

  async addEmployee(employee: Employee): Promise<void> {
    await api.addEmployee(employee);
  }

  async updateEmployee(employee: Employee): Promise<void> {
    await api.updateEmployee(employee);
  }

  async deleteEmployee(id: string): Promise<void> {
    await api.deleteEmployee(id);
  }

  // Schedule Assignments
  async getScheduleAssignments(): Promise<ScheduleAssignment[]> {
    return api.getScheduleAssignments();
  }

  async addScheduleAssignment(assignment: ScheduleAssignment): Promise<void> {
    await api.addScheduleAssignment(assignment);
  }

  async deleteScheduleAssignment(id: string): Promise<void> {
    await api.deleteScheduleAssignment(id);
  }

  // Logs
  async getLogs(): Promise<any[]> {
    return api.getLogs();
  }

  async addLog(log: any): Promise<void> {
    await api.addLog(log);
  }

  async clearLogs(): Promise<void> {
    await api.clearLogs();
  }

  // Clear all data
  async clearAll(): Promise<void> {
    await api.clearAll();
  }

  // Clear specific store/table
  async clear(storeName: string): Promise<void> {
    try {
      // Map store names to table names
      const tableMap: Record<string, string> = {
        'customers': 'customers',
        'types': 'types',
        'parts': 'parts',
        'tests': 'tests',
        'projects': 'projects',
        'comments': 'comments',
        'logs': 'logs',
        'employees': 'employees',
        'scheduleAssignments': 'schedule_assignments',
        'scheduleEntries': 'schedule_assignments',
        'projectComments': 'comments',
        'project_weeks': 'project_weeks',
      };
      
      const tableName = tableMap[storeName] || storeName;
      await api.clearTable(tableName);
    } catch (error) {
      console.error(`Error clearing ${storeName}:`, error);
    }
  }

  // Export data
  async exportData(): Promise<string> {
    return api.exportData();
  }

  async exportDataRaw(): Promise<any> {
    return api.exportDataRaw();
  }

  async exportModule(moduleName: string): Promise<any> {
    return api.exportModule(moduleName);
  }

  // Import data
  async importData(jsonData: string): Promise<void> {
    await api.importData(jsonData);
  }

  async importModule(moduleName: string, data: any): Promise<void> {
    await api.importModule(moduleName, data);
  }

  // Backup management
  async createBackup(backupPath?: string): Promise<any> {
    return api.createBackup(backupPath);
  }

  async getBackups(backupPath?: string): Promise<any> {
    return api.getBackups(backupPath);
  }

  async restoreBackup(filename: string, backupPath?: string): Promise<any> {
    return api.restoreBackup(filename, backupPath);
  }

  async downloadDatabase(): Promise<Blob> {
    return api.downloadDatabase();
  }

  async uploadDatabase(base64Data: string): Promise<any> {
    return api.uploadDatabase(base64Data);
  }

  // User Preferences (replaces localStorage)
  async getAllPreferences(): Promise<Record<string, any>> {
    try {
      return await api.getAllPreferences();
    } catch {
      return {};
    }
  }

  async getPreference(key: string): Promise<any> {
    try {
      return await api.getPreference(key);
    } catch {
      return null;
    }
  }

  async setPreference(key: string, value: any): Promise<void> {
    await api.setPreference(key, value);
  }

  async deletePreference(key: string): Promise<void> {
    await api.deletePreference(key);
  }

  // Schedule Templates
  async getTemplates(): Promise<any[]> {
    try {
      return await api.getTemplates();
    } catch {
      return [];
    }
  }

  async addTemplate(template: any): Promise<void> {
    await api.addTemplate(template);
  }

  async deleteTemplate(id: string): Promise<void> {
    await api.deleteTemplate(id);
  }
}

export const db = new Database();
