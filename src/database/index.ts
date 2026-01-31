import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { Customer, Type, Part, Test, Project, AppSettings } from '../types';

interface KappaDB extends DBSchema {
  customers: {
    key: string;
    value: Customer;
  };
  types: {
    key: string;
    value: Type;
  };
  parts: {
    key: string;
    value: Part;
  };
  tests: {
    key: string;
    value: Test;
  };
  projects: {
    key: string;
    value: Project;
  };
  settings: {
    key: string;
    value: AppSettings;
  };
}

class Database {
  private db: IDBPDatabase<KappaDB> | null = null;
  private readonly DB_NAME = 'kappaplannung';
  private readonly DB_VERSION = 1;

  async init(): Promise<void> {
    this.db = await openDB<KappaDB>(this.DB_NAME, this.DB_VERSION, {
      upgrade(db) {
        // Create object stores
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
      },
    });
  }

  // Customers
  async getCustomers(): Promise<Customer[]> {
    if (!this.db) await this.init();
    return await this.db!.getAll('customers');
  }

  async addCustomer(customer: Customer): Promise<void> {
    if (!this.db) await this.init();
    await this.db!.add('customers', customer);
  }

  async updateCustomer(customer: Customer): Promise<void> {
    if (!this.db) await this.init();
    await this.db!.put('customers', customer);
  }

  async deleteCustomer(id: string): Promise<void> {
    if (!this.db) await this.init();
    await this.db!.delete('customers', id);
  }

  // Types
  async getTypes(): Promise<Type[]> {
    if (!this.db) await this.init();
    return await this.db!.getAll('types');
  }

  async addType(type: Type): Promise<void> {
    if (!this.db) await this.init();
    await this.db!.add('types', type);
  }

  async updateType(type: Type): Promise<void> {
    if (!this.db) await this.init();
    await this.db!.put('types', type);
  }

  async deleteType(id: string): Promise<void> {
    if (!this.db) await this.init();
    await this.db!.delete('types', id);
  }

  // Parts
  async getParts(): Promise<Part[]> {
    if (!this.db) await this.init();
    return await this.db!.getAll('parts');
  }

  async addPart(part: Part): Promise<void> {
    if (!this.db) await this.init();
    await this.db!.add('parts', part);
  }

  async updatePart(part: Part): Promise<void> {
    if (!this.db) await this.init();
    await this.db!.put('parts', part);
  }

  async deletePart(id: string): Promise<void> {
    if (!this.db) await this.init();
    await this.db!.delete('parts', id);
  }

  // Tests
  async getTests(): Promise<Test[]> {
    if (!this.db) await this.init();
    return await this.db!.getAll('tests');
  }

  async addTest(test: Test): Promise<void> {
    if (!this.db) await this.init();
    await this.db!.add('tests', test);
  }

  async updateTest(test: Test): Promise<void> {
    if (!this.db) await this.init();
    await this.db!.put('tests', test);
  }

  async deleteTest(id: string): Promise<void> {
    if (!this.db) await this.init();
    await this.db!.delete('tests', id);
  }

  // Projects
  async getProjects(): Promise<Project[]> {
    if (!this.db) await this.init();
    return await this.db!.getAll('projects');
  }

  async addProject(project: Project): Promise<void> {
    if (!this.db) await this.init();
    await this.db!.add('projects', project);
  }

  async updateProject(project: Project): Promise<void> {
    if (!this.db) await this.init();
    await this.db!.put('projects', project);
  }

  async deleteProject(id: string): Promise<void> {
    if (!this.db) await this.init();
    await this.db!.delete('projects', id);
  }

  // Settings
  async getSettings(): Promise<AppSettings> {
    if (!this.db) await this.init();
    const settings = await this.db!.get('settings', 'app-settings');
    return settings || {
      language: 'en',
      darkMode: true,
      animations: true,
      highlightMissing: true,
      blinkAlerts: true,
      deletePassword: '',
      userName: '',
      zoomLevel: 100,
      editMode: false,
    };
  }

  async updateSettings(settings: AppSettings): Promise<void> {
    if (!this.db) await this.init();
    await this.db!.put('settings', { key: 'app-settings', ...settings } as any);
  }

  // Clear all data
  async clearAll(): Promise<void> {
    if (!this.db) await this.init();
    await this.db!.clear('customers');
    await this.db!.clear('types');
    await this.db!.clear('parts');
    await this.db!.clear('tests');
    await this.db!.clear('projects');
  }

  // Export data
  async exportData(): Promise<string> {
    const data = {
      customers: await this.getCustomers(),
      types: await this.getTypes(),
      parts: await this.getParts(),
      tests: await this.getTests(),
      projects: await this.getProjects(),
      settings: await this.getSettings(),
    };
    return JSON.stringify(data, null, 2);
  }

  // Import data
  async importData(jsonData: string): Promise<void> {
    const data = JSON.parse(jsonData);
    
    // Clear existing data
    await this.clearAll();
    
    // Import new data
    for (const customer of data.customers || []) {
      await this.addCustomer(customer);
    }
    for (const type of data.types || []) {
      await this.addType(type);
    }
    for (const part of data.parts || []) {
      await this.addPart(part);
    }
    for (const test of data.tests || []) {
      await this.addTest(test);
    }
    for (const project of data.projects || []) {
      await this.addProject(project);
    }
    if (data.settings) {
      await this.updateSettings(data.settings);
    }
  }
}

export const db = new Database();
