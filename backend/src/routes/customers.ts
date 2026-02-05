import { Router } from 'express';
import { runQuery, getAll, getOne } from '../database/db.js';
import type { Customer } from '../types.js';

export const customersRouter = Router();

// Get all customers
customersRouter.get('/', (req, res) => {
  try {
    const customers = getAll('SELECT * FROM customers ORDER BY name');
    res.json(customers);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch customers' });
  }
});

// Get customer by ID
customersRouter.get('/:id', (req, res) => {
  try {
    const customer = getOne('SELECT * FROM customers WHERE id = ?', [req.params.id]);
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    res.json(customer);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch customer' });
  }
});

// Create customer (upsert)
customersRouter.post('/', (req, res) => {
  try {
    const { id, name, created_at } = req.body;
    const existing = getOne('SELECT id FROM customers WHERE id = ?', [id]);
    
    if (existing) {
      runQuery('UPDATE customers SET name = ? WHERE id = ?', [name, id]);
    } else {
      runQuery('INSERT INTO customers (id, name, created_at) VALUES (?, ?, ?)', [id, name, created_at]);
    }
    res.status(201).json({ id, name, created_at });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create customer' });
  }
});

// Update customer
customersRouter.put('/:id', (req, res) => {
  try {
    const { name } = req.body;
    runQuery('UPDATE customers SET name = ? WHERE id = ?', [name, req.params.id]);
    res.json({ id: req.params.id, name });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update customer' });
  }
});

// Delete customer
customersRouter.delete('/:id', (req, res) => {
  try {
    runQuery('DELETE FROM customers WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete customer' });
  }
});
