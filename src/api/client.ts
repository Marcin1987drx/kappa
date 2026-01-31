import type { Customer, Type, Part, Test, Project, AppSettings } from '../types';

const API_BASE_URL = 'http://localhost:3001/api';

class ApiClient {
  private async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      ...options,
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.statusText}`);
    }

    return response.json();
  }

  // Customers
  async getCustomers(): Promise<Customer[]> {
    return this.request('/customers');
  }

  async addCustomer(customer: Customer): Promise<void> {
    await this.request('/customers', {
      method: 'POST',
      body: JSON.stringify(customer),
    });
  }

  async updateCustomer(customer: Customer): Promise<void> {
    await this.request(`/customers/${customer.id}`, {
      method: 'PUT',
      body: JSON.stringify(customer),
    });
  }

  async deleteCustomer(id: string): Promise<void> {
    await this.request(`/customers/${id}`, { method: 'DELETE' });
  }

  // Types
  async getTypes(): Promise<Type[]> {
    return this.request('/types');
  }

  async addType(type: Type): Promise<void> {
    await this.request('/types', {
      method: 'POST',
      body: JSON.stringify(type),
    });
  }

  async updateType(type: Type): Promise<void> {
    await this.request(`/types/${type.id}`, {
      method: 'PUT',
      body: JSON.stringify(type),
    });
  }

  async deleteType(id: string): Promise<void> {
    await this.request(`/types/${id}`, { method: 'DELETE' });
  }

  // Parts
  async getParts(): Promise<Part[]> {
    return this.request('/parts');
  }

  async addPart(part: Part): Promise<void> {
    await this.request('/parts', {
      method: 'POST',
      body: JSON.stringify(part),
    });
  }

  async updatePart(part: Part): Promise<void> {
    await this.request(`/parts/${part.id}`, {
      method: 'PUT',
      body: JSON.stringify(part),
    });
  }

  async deletePart(id: string): Promise<void> {
    await this.request(`/parts/${id}`, { method: 'DELETE' });
  }

  // Tests
  async getTests(): Promise<Test[]> {
    return this.request('/tests');
  }

  async addTest(test: Test): Promise<void> {
    await this.request('/tests', {
      method: 'POST',
      body: JSON.stringify(test),
    });
  }

  async updateTest(test: Test): Promise<void> {
    await this.request(`/tests/${test.id}`, {
      method: 'PUT',
      body: JSON.stringify(test),
    });
  }

  async deleteTest(id: string): Promise<void> {
    await this.request(`/tests/${id}`, { method: 'DELETE' });
  }

  // Projects
  async getProjects(): Promise<Project[]> {
    return this.request('/projects');
  }

  async addProject(project: Project): Promise<void> {
    await this.request('/projects', {
      method: 'POST',
      body: JSON.stringify(project),
    });
  }

  async updateProject(project: Project): Promise<void> {
    await this.request(`/projects/${project.id}`, {
      method: 'PUT',
      body: JSON.stringify(project),
    });
  }

  async updateProjectWeek(projectId: string, week: string, ist: number, soll: number): Promise<void> {
    await this.request(`/projects/${projectId}/weeks/${week}`, {
      method: 'PATCH',
      body: JSON.stringify({ ist, soll }),
    });
  }

  async deleteProject(id: string): Promise<void> {
    await this.request(`/projects/${id}`, { method: 'DELETE' });
  }

  // Settings
  async getSettings(): Promise<AppSettings> {
    return this.request('/settings');
  }

  async updateSettings(settings: AppSettings): Promise<void> {
    await this.request('/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
  }

  // Data management
  async exportData(): Promise<string> {
    const data = await this.request('/data/export');
    return JSON.stringify(data, null, 2);
  }

  async importData(jsonData: string): Promise<void> {
    const data = JSON.parse(jsonData);
    await this.request('/data/import', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async clearAll(): Promise<void> {
    await this.request('/data/clear', { method: 'DELETE' });
  }

  // Health check
  async healthCheck(): Promise<boolean> {
    try {
      await this.request('/health');
      return true;
    } catch {
      return false;
    }
  }
}

export const api = new ApiClient();
