import type { Customer, Type, Part, Test, Project, AppSettings } from '../types';

// Używamy relatywnych ścieżek - Vite proxy przekieruje do backendu
const API_BASE_URL = '/api';

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

  async exportDataRaw(): Promise<any> {
    return this.request('/data/export');
  }

  async exportModule(moduleName: string): Promise<any> {
    return this.request(`/data/export/${moduleName}`);
  }

  async importData(jsonData: string): Promise<void> {
    const data = JSON.parse(jsonData);
    await this.request('/data/import', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async importModule(moduleName: string, data: any): Promise<void> {
    await this.request(`/data/import/${moduleName}`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async createBackup(backupPath?: string): Promise<any> {
    return this.request('/data/backup', {
      method: 'POST',
      body: JSON.stringify({ path: backupPath }),
    });
  }

  async getBackups(backupPath?: string): Promise<any> {
    const query = backupPath ? `?path=${encodeURIComponent(backupPath)}` : '';
    return this.request(`/data/backups${query}`);
  }

  async restoreBackup(filename: string, backupPath?: string): Promise<any> {
    return this.request('/data/backup/restore', {
      method: 'POST',
      body: JSON.stringify({ filename, backupPath }),
    });
  }

  async downloadDatabase(): Promise<Blob> {
    const response = await fetch(`${API_BASE_URL}/data/download-db`);
    if (!response.ok) {
      throw new Error(`API Error: ${response.statusText}`);
    }
    return response.blob();
  }

  async uploadDatabase(base64Data: string): Promise<any> {
    return this.request('/data/upload-db', {
      method: 'POST',
      body: JSON.stringify({ data: base64Data }),
    });
  }

  async clearAll(): Promise<void> {
    await this.request('/data/clear', { method: 'DELETE' });
  }

  // Clear specific table
  async clearTable(table: string): Promise<void> {
    await this.request(`/data/clear/${table}`, { method: 'DELETE' });
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

  // Employees
  async getEmployees(): Promise<any[]> {
    return this.request('/employees');
  }

  async addEmployee(employee: any): Promise<void> {
    await this.request('/employees', {
      method: 'POST',
      body: JSON.stringify(employee),
    });
  }

  async updateEmployee(employee: any): Promise<void> {
    await this.request(`/employees/${employee.id}`, {
      method: 'PUT',
      body: JSON.stringify(employee),
    });
  }

  async deleteEmployee(id: string): Promise<void> {
    await this.request(`/employees/${id}`, { method: 'DELETE' });
  }

  // Schedule Assignments
  async getScheduleAssignments(): Promise<any[]> {
    return this.request('/schedule-assignments');
  }

  async addScheduleAssignment(assignment: any): Promise<void> {
    await this.request('/schedule-assignments', {
      method: 'POST',
      body: JSON.stringify(assignment),
    });
  }

  async deleteScheduleAssignment(id: string): Promise<void> {
    await this.request(`/schedule-assignments/${id}`, { method: 'DELETE' });
  }

  // Logs
  async getLogs(): Promise<any[]> {
    return this.request('/logs');
  }

  async addLog(log: any): Promise<void> {
    await this.request('/logs', {
      method: 'POST',
      body: JSON.stringify(log),
    });
  }

  async clearLogs(): Promise<void> {
    await this.request('/logs/clear', { method: 'DELETE' });
  }

  // Comments
  async getComments(): Promise<any[]> {
    return this.request('/comments');
  }

  async addComment(comment: any): Promise<void> {
    await this.request('/comments', {
      method: 'POST',
      body: JSON.stringify(comment),
    });
  }

  async deleteComment(id: string): Promise<void> {
    await this.request(`/comments/${id}`, { method: 'DELETE' });
  }

  // User Preferences (replaces localStorage)
  async getAllPreferences(): Promise<Record<string, any>> {
    return this.request('/preferences');
  }

  async getPreference(key: string): Promise<any> {
    return this.request(`/preferences/${key}`);
  }

  async setPreference(key: string, value: any): Promise<void> {
    await this.request(`/preferences/${key}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    });
  }

  async deletePreference(key: string): Promise<void> {
    await this.request(`/preferences/${key}`, { method: 'DELETE' });
  }

  // Schedule Templates
  async getTemplates(): Promise<any[]> {
    return this.request('/templates');
  }

  async addTemplate(template: any): Promise<void> {
    await this.request('/templates', {
      method: 'POST',
      body: JSON.stringify(template),
    });
  }

  async deleteTemplate(id: string): Promise<void> {
    await this.request(`/templates/${id}`, { method: 'DELETE' });
  }

  // ==================== ABSENCE MANAGEMENT ====================

  // Absence Types
  async getAbsenceTypes(): Promise<any[]> {
    return this.request('/absence-types');
  }

  async getAllAbsenceTypes(): Promise<any[]> {
    return this.request('/absence-types/all');
  }

  async updateAbsenceType(id: string, data: any): Promise<void> {
    await this.request(`/absence-types/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async addAbsenceType(data: any): Promise<void> {
    await this.request('/absence-types', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Absence Limits
  async getAbsenceLimits(params?: { employeeId?: string; year?: number }): Promise<any[]> {
    const query = new URLSearchParams();
    if (params?.employeeId) query.append('employeeId', params.employeeId);
    if (params?.year) query.append('year', params.year.toString());
    return this.request(`/absence-limits?${query.toString()}`);
  }

  async setAbsenceLimit(data: any): Promise<void> {
    await this.request('/absence-limits', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async setAbsenceLimitsBulk(employeeId: string, year: number, limits: any[]): Promise<void> {
    await this.request('/absence-limits/bulk', {
      method: 'POST',
      body: JSON.stringify({ employeeId, year, limits }),
    });
  }

  // Absences
  async getAbsences(params?: { employeeId?: string; year?: number; month?: number; status?: string }): Promise<any[]> {
    const query = new URLSearchParams();
    if (params?.employeeId) query.append('employeeId', params.employeeId);
    if (params?.year) query.append('year', params.year.toString());
    if (params?.month) query.append('month', params.month.toString());
    if (params?.status) query.append('status', params.status);
    return this.request(`/absences?${query.toString()}`);
  }

  async addAbsence(data: any): Promise<void> {
    await this.request('/absences', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateAbsence(id: string, data: any): Promise<void> {
    await this.request(`/absences/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteAbsence(id: string): Promise<void> {
    await this.request(`/absences/${id}`, { method: 'DELETE' });
  }

  // Employee Details
  async getEmployeeDetails(employeeId: string): Promise<any> {
    return this.request(`/employee-details/${employeeId}`);
  }

  async updateEmployeeDetails(employeeId: string, data: any): Promise<void> {
    await this.request(`/employee-details/${employeeId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  // Qualifications
  async getQualifications(employeeId?: string): Promise<any[]> {
    const query = employeeId ? `?employeeId=${employeeId}` : '';
    return this.request(`/qualifications${query}`);
  }

  async setQualification(data: any): Promise<void> {
    await this.request('/qualifications', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async deleteQualification(id: string): Promise<void> {
    await this.request(`/qualifications/${id}`, { method: 'DELETE' });
  }

  // Holidays
  async getHolidays(year?: number): Promise<any[]> {
    const query = year ? `?year=${year}` : '';
    return this.request(`/holidays${query}`);
  }

  async addHoliday(data: any): Promise<void> {
    await this.request('/holidays', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async deleteHoliday(date: string): Promise<void> {
    await this.request(`/holidays/${date}`, { method: 'DELETE' });
  }

  // Extra Tasks (Dodatkowe zadania)
  async getExtraTasks(week?: string): Promise<any[]> {
    const query = week ? `?week=${encodeURIComponent(week)}` : '';
    return this.request(`/extra-tasks${query}`);
  }

  async addExtraTask(task: any): Promise<void> {
    await this.request('/extra-tasks', {
      method: 'POST',
      body: JSON.stringify(task),
    });
  }

  async updateExtraTask(id: string, task: any): Promise<void> {
    await this.request(`/extra-tasks/${id}`, {
      method: 'PUT',
      body: JSON.stringify(task),
    });
  }

  async deleteExtraTask(id: string): Promise<void> {
    await this.request(`/extra-tasks/${id}`, { method: 'DELETE' });
  }
}

export const api = new ApiClient();
